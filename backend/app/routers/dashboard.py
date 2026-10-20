"""관리자 대시보드 API — /api/dashboard/summary (05, 관리자 전용).

DB에서 세는 것은 인원·카드 상태 숫자뿐. 사용액·예산·카테고리·결제 알림은 아직 화면의 예시값(js/mock-data.js).
"""
from fastapi import APIRouter, Depends
from pymongo.database import Database

from app import member_rules as MR
from app.auth import require_admin
from app.db import get_db

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

CARD_STATUSES = ("active", "issuing", "suspended", "revoked")


@router.get("/summary")
def summary(admin: dict = Depends(require_admin), db: Database = Depends(get_db)):
    users = list(db.users.find({"company": admin["company"], "role": "employee"}, {"dept": 1, "status": 1}))
    dept_of = {u["_id"]: u.get("dept") for u in users}
    cards = db.cards.find({"user_id": {"$in": list(dept_of)}}, {"user_id": 1, "status": 1})

    employees = {s: 0 for s in MR.STATUSES}
    for u in users:
        employees[u["status"]] = employees.get(u["status"], 0) + 1
    employees["total"] = len(users)

    card_count = {s: 0 for s in CARD_STATUSES}
    depts = {d: {"name": d, "members": 0, "active": 0, "issuing": 0} for d in MR.DEPTS}
    for u in users:
        if u.get("dept") in depts and u["status"] != "revoked":
            depts[u["dept"]]["members"] += 1
    for c in cards:
        card_count[c["status"]] = card_count.get(c["status"], 0) + 1
        d = depts.get(dept_of.get(c["user_id"]))
        if d and c["status"] in ("active", "issuing"):
            d[c["status"]] += 1

    # 활성 카드 = active만 (발급 중은 따로)
    return {"employees": employees, "cards": card_count, "departments": list(depts.values())}
