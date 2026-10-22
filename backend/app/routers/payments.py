"""결제 테스트(시연용) API — POST /api/payments/test (06 마이페이지, 임직원 본인만).

결제 입력 → AI 업종 판별(ml_rules.judge) → 규칙 확인 → 포인트 차감 → cards.transactions 저장을 한 번에.
- 판정 순서: 카드 active 아님 → 키워드 규칙(block) → 확신도 낮음·모델 restricted(low·warn)는 review(차감 없음)
  → 카드 포인트에 없는 분류 → 잔액 부족 → 승인. AI만으로 차단하지 않는 기존 정책(ml_rules.WARN) 그대로
- 차감은 "잔액 ≥ 금액" 조건을 건 update_one 한 번($inc + $push) — 마이너스가 될 수 없음
- 차단·확인 필요도 결제내역에 남김. 새 결제는 $position 0 (Atlas에서 맨 앞). 화면 순서는 /api/me/card가 시각으로 정렬
- 사용량 제한: 같은 사용자 1분 20회 → 429 (챗봇과 같은 메모리 방식)
"""
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, HTTPException
from fastapi.responses import JSONResponse
from pymongo.database import Database

from app import ml_rules as M
from app.db import get_db
from app.routers import ml
from app.routers.chat import RateLimiter
from app.routers.me import MSG_NO_CARD, SUMMARY_POCKETS, _transaction, require_employee

log = logging.getLogger("uvicorn.error")

router = APIRouter(prefix="/payments", tags=["payments"])

NAME_MAX = 40
AMOUNT_MIN = 100
AMOUNT_MAX = 1_000_000
RATE_UID = 20   # 같은 사용자가 1분 안에 보낼 수 있는 수

MSG_INVALID = "입력값을 확인해주세요."
MSG_RATE = "잠시 후 다시 결제해주세요."
MSG_UNAVAILABLE = "결제를 처리하지 못했어요. 잠시 후 다시 시도해 주세요."

REASON_CARD = "카드가 사용 중지 상태예요"
REASON_RESTRICTED = "제한 업종"
REASON_REVIEW = "AI 확신도가 낮아 관리자 확인이 필요해요"
REASON_NOT_ALLOWED = "허용되지 않은 업종"
REASON_BALANCE = "잔액 부족"

limiter = RateLimiter()


def validate(body: dict) -> tuple[dict, dict]:
    """(값, 오류 {항목: 문구}). 금액은 정수만 (문자열·소수·true 안 받음)."""
    errors: dict[str, str] = {}
    merchant = body.get("merchant")
    merchant = merchant.strip() if isinstance(merchant, str) else ""
    amount = body.get("amount")

    if not merchant:
        errors["merchant"] = "가맹점 이름을 입력해주세요."
    elif len(merchant) > NAME_MAX:
        errors["merchant"] = f"가맹점 이름은 {NAME_MAX}자까지 입력할 수 있어요."

    if amount is None or amount == "":
        errors["amount"] = "금액을 입력해주세요."
    elif not isinstance(amount, int) or isinstance(amount, bool):
        errors["amount"] = "금액은 숫자로만 입력해주세요."
    elif not AMOUNT_MIN <= amount <= AMOUNT_MAX:
        errors["amount"] = f"{AMOUNT_MIN:,}원부터 {AMOUNT_MAX:,}원까지 입력할 수 있어요."

    return {"merchant": merchant, "amount": amount}, errors


def classify_merchant(name: str) -> dict:
    """서버 시작 때 불러둔 판별 모델(routers/ml.py)로 판정. 모델이 없으면 RuntimeError."""
    if ml.model is None:
        raise RuntimeError("model not loaded")
    return M.judge(ml.model, name)


def decide(card: dict, ai: dict, amount: int) -> tuple[str, str | None, str | None]:
    """(status approved|blocked|review, 차감 포인트, 사유)."""
    if card["status"] != "active":
        return "blocked", None, REASON_CARD
    if ai["level"] == "block":
        return "blocked", None, REASON_RESTRICTED
    if ai["level"] in ("low", "warn"):
        return "review", None, REASON_REVIEW
    cat = ai["category"]
    if cat not in card["points"]:
        return "blocked", None, REASON_NOT_ALLOWED
    if card["points"][cat]["balance"] < amount:
        return "blocked", None, REASON_BALANCE
    return "approved", cat, None


def _push(tx: dict) -> dict:
    return {"transactions": {"$each": [tx], "$position": 0}}


def record(db: Database, user: dict, merchant: str, amount: int, ai: dict) -> dict | None:
    """판정 후 저장. 승인은 조건부 차감 — 그 사이 다른 결제가 잔액을 썼거나 카드가 정지됐으면
    다시 읽어 판정 (마지막엔 잔액 부족). 카드가 없으면 None."""
    for attempt in range(3):
        card = db.cards.find_one({"user_id": user["_id"]})
        if not card:
            return None
        status, pocket, reason = decide(card, ai, amount)
        if status == "approved" and attempt == 2:
            status, pocket, reason = "blocked", None, REASON_BALANCE
        now = datetime.now(timezone.utc)
        tx = {
            "paid_at": now, "merchant": merchant, "pocket": pocket, "amount": amount,
            "status": status, "blocked_reason": reason, "ai": ai,
            "category": ai["category"], "confidence": ai["confidence"], "source": "test",
            "user_id": user["_id"], "card_id": card["_id"], "company": user.get("company"),
        }
        if status != "approved":
            db.cards.update_one({"_id": card["_id"]}, {"$push": _push(tx), "$set": {"updated_at": now}})
            return tx
        res = db.cards.update_one(
            {"_id": card["_id"], "status": "active", f"points.{pocket}.balance": {"$gte": amount}},
            {"$inc": {f"points.{pocket}.balance": -amount}, "$push": _push(tx), "$set": {"updated_at": now}},
        )
        if res.matched_count == 1:
            return tx
    return None   # 도달하지 않음 (세 번째는 항상 차단으로 저장)


@router.post("/test")
def create_test_payment(body: dict = Body(...), user: dict = Depends(require_employee),
                        db: Database = Depends(get_db)):
    """응답 {transaction (마이페이지 결제내역 모양), points, summary} — 갱신된 잔액까지."""
    values, errors = validate(body)
    if errors:
        return JSONResponse(status_code=422, content={"detail": MSG_INVALID, "errors": errors})
    if not limiter.allow([("uid:" + str(user["_id"]), RATE_UID)]):
        raise HTTPException(status_code=429, detail=MSG_RATE)
    try:
        ai = classify_merchant(values["merchant"])
    except Exception as e:
        log.warning("결제 테스트: 판별 실패 (%s)", type(e).__name__)
        raise HTTPException(status_code=503, detail=MSG_UNAVAILABLE)

    tx = record(db, user, values["merchant"], values["amount"], ai)
    if tx is None:
        raise HTTPException(status_code=404, detail=MSG_NO_CARD)

    card = db.cards.find_one({"user_id": user["_id"]}, {"points": 1})
    points = {k: {"start": v["start"], "balance": v["balance"]} for k, v in card["points"].items()}
    return {
        "transaction": _transaction(tx),
        "points": points,
        "summary": {
            "remaining": sum(points[k]["balance"] for k in SUMMARY_POCKETS),
            "expense": points["expense"]["balance"],
        },
    }
