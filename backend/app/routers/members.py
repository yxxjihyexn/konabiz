"""임직원 관리 API — /api/members (08 임직원관리, 관리자 전용).

- 관리자는 자기 회사(company)의 임직원(role=employee)만 조회·변경. 그 밖(다른 회사·관리자·없는 id)은 404
- 응답에 password_hash는 넣지 않음. 임시 비밀번호 평문은 초대·재발급 응답에서 한 번만 돌려주고
  DB에는 해시만 저장 (로그에도 남기지 않음)
- 상태 전이 규칙은 app/member_rules.py. 규칙에 없는 동작(이미 상태가 바뀐 경우 포함)은 409
- CSV 일괄 초대·정보 수정은 없음
"""
import re
import secrets
from datetime import datetime, timedelta, timezone

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from pymongo.database import Database
from pymongo.errors import DuplicateKeyError

from app import member_rules as MR
from app.auth import hash_password, require_admin
from app.db import get_db

router = APIRouter(prefix="/members", tags=["members"])

KST = timezone(timedelta(hours=9))

MSG_INVALID = "입력값을 확인해주세요."
MSG_DUPLICATE = "이미 등록된 이메일이에요."
MSG_DUPLICATE_REVOKED = "카드가 회수된 직원의 이메일이에요. 다른 이메일로 초대해주세요."
MSG_CONFLICT = "이미 상태가 변경된 직원이에요. 목록을 새로고침할게요."
MSG_NOT_FOUND = "임직원을 찾을 수 없어요."

# 08 초대 모달(js/admin-members.js)과 같은 규칙
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$")
NAME_MAX = 50
EMAIL_MAX = 320
Q_MAX = 100


# ---------- 도우미 ----------

def _scope(admin: dict) -> dict:
    return {"company": admin["company"], "role": "employee"}


def _oid(member_id: str) -> ObjectId:
    try:
        return ObjectId(member_id)
    except (InvalidId, TypeError):
        raise HTTPException(status_code=404, detail=MSG_NOT_FOUND)


def _public(user: dict, card: dict | None) -> dict:
    """화면에 필요한 값만 — password_hash 등은 넣지 않음."""
    invited = user.get("invited_at")
    return {
        "id": str(user["_id"]),
        "name": user["name"],
        "email": user["email"],
        "dept": user.get("dept") or "",
        "status": user["status"],
        "invited_at": invited.astimezone(KST).isoformat() if invited else None,
        "last4": card["last4"] if card else "",
        "card_status": card["status"] if card else None,
    }


def _with_cards(db: Database, users: list[dict]) -> list[dict]:
    cards = db.cards.find({"user_id": {"$in": [u["_id"] for u in users]}}, {"user_id": 1, "last4": 1, "status": 1})
    by_user = {c["user_id"]: c for c in cards}
    return [_public(u, by_user.get(u["_id"])) for u in users]


def _member(db: Database, oid: ObjectId) -> dict:
    user = db.users.find_one({"_id": oid}, {"password_hash": 0})
    return _with_cards(db, [user])[0]


def _new_last4(db: Database) -> str:
    for _ in range(50):
        n = f"{secrets.randbelow(10000):04d}"
        if not db.cards.find_one({"last4": n}, {"_id": 1}):
            return n
    return f"{secrets.randbelow(10000):04d}"   # 거의 일어나지 않음 — 끝자리는 겹쳐도 됨


def _text(body: dict, key: str) -> str:
    v = body.get(key)
    return v.strip() if isinstance(v, str) else ""


def validate_invite(body: dict) -> tuple[dict, dict]:
    """(값, 오류 {항목: 문구}). 이메일은 소문자로."""
    errors: dict[str, str] = {}
    name = _text(body, "name")
    email = _text(body, "email").lower()
    dept = _text(body, "dept")

    if not name:
        errors["name"] = "이름을 입력해주세요."
    elif len(name) > NAME_MAX:
        errors["name"] = f"{NAME_MAX}자 이내로 입력해주세요."

    if not email:
        errors["email"] = "이메일을 입력해주세요."
    elif len(email) > EMAIL_MAX or not EMAIL_RE.match(email):
        errors["email"] = "이메일 형식이 아니에요. @ 뒤에 도메인 전체를 입력해주세요. (예: company.co.kr)"

    if not dept:
        errors["dept"] = "부서를 입력해주세요."
    elif dept not in MR.DEPTS:
        errors["dept"] = "목록에서 부서를 골라주세요."

    return {"name": name, "email": email, "dept": dept}, errors


def _duplicate(db: Database, email: str) -> JSONResponse | None:
    """이미 있는 이메일 → 409 (회수된 직원이면 다른 문구). 다른 회사·관리자 이메일도 같은 문구."""
    found = db.users.find_one({"email": email}, {"status": 1})
    if not found:
        return None
    msg = MSG_DUPLICATE_REVOKED if found.get("status") == "revoked" else MSG_DUPLICATE
    return JSONResponse(status_code=409, content={"detail": msg, "field": "email"})


# ---------- API ----------

@router.get("")
def list_members(
    dept: str = Query("", max_length=20),
    status: str = Query("", max_length=20),
    q: str = Query("", max_length=Q_MAX),
    admin: dict = Depends(require_admin),
    db: Database = Depends(get_db),
):
    """자기 회사 임직원 목록 — 초대일 최신순. 목록에 없는 dept·status 값은 무시."""
    query = _scope(admin)
    if dept in MR.DEPTS:
        query["dept"] = dept
    if status in MR.STATUSES:
        query["status"] = status
    q = q.strip()
    if q:
        pattern = re.compile(re.escape(q), re.IGNORECASE)
        query["$or"] = [{"name": pattern}, {"email": pattern}]
    users = list(db.users.find(query, {"password_hash": 0}).sort([("invited_at", -1), ("_id", 1)]))
    return {"members": _with_cards(db, users)}


@router.post("", status_code=201)
def invite(body: dict = Body(...), admin: dict = Depends(require_admin), db: Database = Depends(get_db)):
    """초대 — users(invited) + cards(issuing). 임시 비밀번호는 이 응답에서만."""
    values, errors = validate_invite(body)
    if errors:
        return JSONResponse(status_code=422, content={"detail": MSG_INVALID, "errors": errors})
    dup = _duplicate(db, values["email"])
    if dup:
        return dup

    now = datetime.now(timezone.utc)
    temp_password = MR.new_temp_password()
    user = {
        "_id": ObjectId(), "email": values["email"], "name": values["name"], "role": "employee",
        "company": admin["company"], "dept": values["dept"], "status": "invited",
        "invited_at": now, "created_at": now,
        "password_hash": hash_password(temp_password),
    }
    try:
        db.users.insert_one(user)   # 동시에 같은 이메일이 들어와도 고유 인덱스(email_unique)로 하나만
    except DuplicateKeyError:
        return _duplicate(db, values["email"]) or JSONResponse(status_code=409, content={"detail": MSG_DUPLICATE, "field": "email"})

    card = {
        "user_id": user["_id"], "last4": _new_last4(db), "status": MR.CARD_STATUS["invited"],
        "points": MR.start_points(), "transactions": [], "updated_at": now,
    }
    try:
        db.cards.insert_one(card)
    except Exception:
        db.users.delete_one({"_id": user["_id"]})   # 카드 없이 사용자만 남지 않게
        raise

    return {"member": _public(user, card), "temp_password": temp_password}


@router.post("/{member_id}/temp-password")
def reissue_temp_password(member_id: str, admin: dict = Depends(require_admin), db: Database = Depends(get_db)):
    """임시 비밀번호 재발급 — 초대됨만. 이전 임시 비밀번호는 바로 무효."""
    oid = _oid(member_id)
    temp_password = MR.new_temp_password()
    res = db.users.update_one(
        {"_id": oid, **_scope(admin), "status": "invited"},
        {"$set": {"password_hash": hash_password(temp_password)}},
    )
    if res.matched_count == 0:
        _not_changed(db, oid, admin)
    return {"member": _member(db, oid), "temp_password": temp_password}


def _not_changed(db: Database, oid: ObjectId, admin: dict):
    """조건부 변경이 안 됐을 때 — 내 회사 임직원이면 409(상태가 이미 다름), 아니면 404."""
    if db.users.find_one({"_id": oid, **_scope(admin)}, {"_id": 1}):
        raise HTTPException(status_code=409, detail=MSG_CONFLICT)
    raise HTTPException(status_code=404, detail=MSG_NOT_FOUND)


def _change_status(member_id: str, action: str, admin: dict, db: Database) -> dict:
    allowed, new_status = MR.ACTIONS[action]
    oid = _oid(member_id)
    # 지금 상태 확인 + 변경을 한 번에 — 두 탭에서 동시에 눌러도 하나만 바뀜
    res = db.users.update_one(
        {"_id": oid, **_scope(admin), "status": {"$in": list(allowed)}},
        {"$set": {"status": new_status}},
    )
    if res.matched_count == 0:
        _not_changed(db, oid, admin)
    db.cards.update_one(
        {"user_id": oid},
        {"$set": {"status": MR.CARD_STATUS[new_status], "updated_at": datetime.now(timezone.utc)}},
    )
    return {"member": _member(db, oid)}


@router.post("/{member_id}/suspend")
def suspend(member_id: str, admin: dict = Depends(require_admin), db: Database = Depends(get_db)):
    return _change_status(member_id, "suspend", admin, db)


@router.post("/{member_id}/resume")
def resume(member_id: str, admin: dict = Depends(require_admin), db: Database = Depends(get_db)):
    return _change_status(member_id, "resume", admin, db)


@router.post("/{member_id}/revoke")
def revoke(member_id: str, admin: dict = Depends(require_admin), db: Database = Depends(get_db)):
    return _change_status(member_id, "revoke", admin, db)
