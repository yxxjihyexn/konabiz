"""임직원 마이페이지 API — /api/me/card (06, 임직원 본인만).

본인 확인은 토큰의 user_id로만 함 — 주소·파라미터로 다른 사람 id를 받지 않음.
합계(summary.remaining)는 식대·체력단련·복지 3종만, 법인경비P(expense)는 별도 예산이라 따로.
"""
from datetime import timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pymongo.database import Database

from app.auth import require_login
from app.db import get_db

router = APIRouter(prefix="/me", tags=["me"])

KST = timezone(timedelta(hours=9))
SUMMARY_POCKETS = ("meal", "fitness", "welfare")

MSG_EMPLOYEE_ONLY = "임직원만 이용할 수 있습니다."
MSG_NO_CARD = "카드 정보를 찾을 수 없습니다."


def require_employee(user: dict = Depends(require_login)) -> dict:
    """임직원만 (관리자는 403)."""
    if user["role"] != "employee":
        raise HTTPException(status_code=403, detail=MSG_EMPLOYEE_ONLY)
    return user


def _transaction(t: dict) -> dict:
    # ai: seed 때 가맹점 판별 모델로 계산해 저장한 값 {category, confidence, industry, source, level} (없으면 None)
    return {
        "paid_at": t["paid_at"].astimezone(KST).isoformat(),
        "merchant": t["merchant"], "pocket": t.get("pocket"), "amount": t["amount"],
        "status": t["status"], "blocked_reason": t.get("blocked_reason"), "ai": t.get("ai"),
    }


@router.get("/card")
def card(user: dict = Depends(require_employee), db: Database = Depends(get_db)):
    c = db.cards.find_one({"user_id": user["_id"]}, {"_id": 0, "user_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail=MSG_NO_CARD)
    points = {k: {"start": v["start"], "balance": v["balance"]} for k, v in c["points"].items()}
    txs = sorted(c.get("transactions", []), key=lambda t: t["paid_at"], reverse=True)
    return {
        "last4": c["last4"], "status": c["status"], "holder": user["name"],
        "points": points,
        "summary": {
            "remaining": sum(points[k]["balance"] for k in SUMMARY_POCKETS),
            "expense": points["expense"]["balance"],
        },
        "transactions": [_transaction(t) for t in txs],
    }
