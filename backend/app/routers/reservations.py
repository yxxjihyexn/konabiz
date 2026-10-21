"""상담 예약 API — /api/reservations/slots · /api/reservations.

로그인 없이 씀 (예약자는 아직 계정이 없는 잠재 고객).
검사 규칙은 js/landing.js 03 상담예약(RULES·예약 가능 시간)과 같게 맞춤.
응답에는 입력값·다른 예약자의 정보를 넣지 않음.
"""
import re
from datetime import date, datetime, time, timedelta, timezone

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from pymongo.database import Database
from pymongo.errors import DuplicateKeyError

from app import reservation_rules as R
from app.db import get_db

router = APIRouter(prefix="/reservations", tags=["reservations"])

MSG_TAKEN = "방금 다른 예약이 확정된 시간이에요. 다른 시간을 골라주세요."
MSG_INVALID = "입력값을 확인해주세요."

PHONE_RE = re.compile(r"^01[016789]-?\d{3,4}-?\d{4}$")
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
TEXT_MAX = 100        # 회사명·이름·직책
ADDRESS_MAX = 200
EMAIL_MAX = 320
COUNT_MAX = 1_000_000
CONSULTATION_TYPES = ("phone", "inperson")
SOURCES = ("hero", "closing-cta", "chatbot", "simulator", "landing")
CATEGORIES = ("restaurant", "cafe", "book", "fitness", "hospital", "office", "travel", "entertain")   # 상담예약 칩 순서
LIMIT_MAX, LIMIT_STEP = 100000, 10000
SLOTS_MAX_DAYS = 31


def _text(body: dict, key: str) -> str:
    v = body.get(key)
    if v is None:
        return ""
    return v.strip() if isinstance(v, str) else str(v).strip()


def _count(raw: str) -> int | None:
    """'1,200' → 1200. 1 ~ COUNT_MAX 정수만."""
    v = raw.replace(",", "")
    if not v.isdigit() or len(v) > 7:
        return None
    n = int(v)
    return n if 0 < n <= COUNT_MAX else None


def _phone(raw: str) -> str | None:
    v = re.sub(r"\s", "", raw)
    if not PHONE_RE.match(v):
        return None
    d = re.sub(r"\D", "", v)
    return f"{d[:3]}-{d[3:-4]}-{d[-4:]}"


def _preferred_at(raw) -> datetime | None:
    """시간대가 붙은 ISO 문자열만 (예: 2026-10-21T11:00:00+09:00)."""
    if not isinstance(raw, str):
        return None
    try:
        at = datetime.fromisoformat(raw.strip())
    except ValueError:
        return None
    return at if at.tzinfo else None


def _custom_preset(raw) -> dict | None:
    """선택 조건 — 결제 시간대 [시작, 끝] · 1회 한도 · 허용 업종."""
    if not isinstance(raw, dict):
        return None
    tr, limit, cats = raw.get("time_range"), raw.get("limit_amount"), raw.get("categories")
    ints = lambda *xs: all(isinstance(x, int) and not isinstance(x, bool) for x in xs)
    if not (isinstance(tr, list) and len(tr) == 2 and ints(*tr) and 0 <= tr[0] <= tr[1] <= 24):
        return None
    if not (ints(limit) and 0 <= limit <= LIMIT_MAX and limit % LIMIT_STEP == 0):
        return None
    if not (isinstance(cats, list) and all(isinstance(c, str) and c in CATEGORIES for c in cats)):
        return None
    return {"time_range": list(tr), "limit_amount": limit, "categories": sorted(set(cats), key=CATEGORIES.index)}


def validate(body: dict, now: datetime) -> tuple[dict, dict]:
    """(저장할 문서, 오류 {항목: 문구}). 오류가 없을 때만 문서를 씀."""
    errors: dict[str, str] = {}
    doc: dict = {}

    def required_text(key, msg, max_len=TEXT_MAX):
        v = _text(body, key)
        if not v:
            errors[key] = msg
        elif len(v) > max_len:
            errors[key] = f"{max_len}자 이내로 입력해주세요."
        doc[key] = v

    required_text("company_name", "회사명을 입력해주세요.")
    for key, msg in (("employee_count", "임직원 수를 숫자로 입력해주세요."), ("card_count", "필요한 카드 수를 숫자로 입력해주세요.")):
        n = _count(_text(body, key))
        if n is None:
            errors[key] = msg
        doc[key] = n
    required_text("contact_name", "담당자 이름을 입력해주세요.")

    title = _text(body, "contact_title")   # 선택
    if len(title) > TEXT_MAX:
        errors["contact_title"] = f"{TEXT_MAX}자 이내로 입력해주세요."
    doc["contact_title"] = title

    phone = _phone(_text(body, "phone"))
    if phone is None:
        errors["phone"] = "연락 가능한 휴대폰 번호를 입력해주세요."
    doc["phone"] = phone

    email = _text(body, "email")   # 선택 — 입력했을 때만 형식 검사
    if email and (len(email) > EMAIL_MAX or not EMAIL_RE.match(email)):
        errors["email"] = "이메일 형식을 확인해주세요."
    doc["email"] = email

    ctype = _text(body, "consultation_type")
    if ctype not in CONSULTATION_TYPES:
        errors["consultation_type"] = "상담 방법을 골라주세요."
    doc["consultation_type"] = ctype

    address = _text(body, "address")   # 대면 방문일 때만 필수 · 저장
    if ctype == "inperson":
        if not address:
            errors["address"] = "방문 주소를 입력해주세요."
        elif len(address) > ADDRESS_MAX:
            errors["address"] = f"{ADDRESS_MAX}자 이내로 입력해주세요."
    doc["address"] = address if ctype == "inperson" else None

    at = _preferred_at(body.get("preferred_at"))
    if at is None:
        errors["preferred_at"] = "상담 시간을 골라주세요."
    else:
        reason = R.slot_error(at, now)
        if reason == "past":
            errors["preferred_at"] = "이미 지난 시간이에요. 다른 시간을 골라주세요."
        elif reason:
            errors["preferred_at"] = "예약할 수 없는 시간이에요. 다른 시간을 골라주세요."
        doc["preferred_at"] = at.astimezone(timezone.utc)

    preset = _custom_preset(body.get("custom_preset"))
    if preset is None:
        errors["custom_preset"] = "선택 조건을 확인해주세요."
    doc["custom_preset"] = preset

    source = _text(body, "source")
    if source not in SOURCES:
        errors["source"] = "유입 경로를 확인해주세요."
    doc["source"] = source

    return doc, errors


def _parse_date(raw: str) -> date | None:
    try:
        return date.fromisoformat(raw)
    except ValueError:
        return None


@router.get("/slots")
def slots(
    date_from: str = Query(alias="from", max_length=10),
    date_to: str = Query(alias="to", max_length=10),
    db: Database = Depends(get_db),
):
    """기간(KST 날짜, 양끝 포함) 안의 확정 예약 시각만 — 예약자 정보는 넣지 않음."""
    d1, d2 = _parse_date(date_from), _parse_date(date_to)
    if d1 is None or d2 is None:
        raise HTTPException(status_code=422, detail="날짜는 YYYY-MM-DD 형식으로 보내주세요.")
    if d1 > d2:
        raise HTTPException(status_code=422, detail="from은 to보다 늦을 수 없어요.")
    if (d2 - d1).days >= SLOTS_MAX_DAYS:
        raise HTTPException(status_code=422, detail=f"기간은 {SLOTS_MAX_DAYS}일 이내로 보내주세요.")

    start = datetime.combine(d1, time(), tzinfo=R.KST)
    end = datetime.combine(d2 + timedelta(days=1), time(), tzinfo=R.KST)
    cur = db.reservations.find(
        {"status": "confirmed", "preferred_at": {"$gte": start, "$lt": end}},
        {"_id": 0, "preferred_at": 1},
    ).sort("preferred_at", 1)
    return {"closed": [r["preferred_at"].astimezone(R.KST).isoformat() for r in cur]}


@router.post("", status_code=201)
def create(body: dict = Body(...), db: Database = Depends(get_db)):
    now = datetime.now(timezone.utc)
    doc, errors = validate(body, now)
    if errors:
        return JSONResponse(status_code=422, content={"detail": MSG_INVALID, "errors": errors})

    doc.update(status="confirmed", created_at=now)
    try:
        # 이중 예약은 DB 고유 인덱스(preferred_at, status=confirmed)로 막음 — 동시에 들어와도 하나만 저장됨
        result = db.reservations.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail=MSG_TAKEN)

    return {
        "id": str(result.inserted_id),
        "preferred_at": doc["preferred_at"].astimezone(R.KST).isoformat(),
        "consultation_type": doc["consultation_type"],
    }
