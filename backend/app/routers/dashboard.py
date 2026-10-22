"""관리자 대시보드 API — /api/dashboard/summary · /api/dashboard/payments (05, 관리자 전용).

DB에서 세는 것: 인원·카드 상태 숫자(summary), 최근 결제 알림 4건 · 이번 달 차단 건수(payments).
사용액·예산·카테고리·부서별 금액은 아직 화면의 예시값(js/mock-data.js).
"""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from pymongo.database import Database

from app import member_rules as MR
from app.auth import require_admin
from app.db import get_db

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

CARD_STATUSES = ("active", "issuing", "suspended", "revoked")
KST = timezone(timedelta(hours=9))
ALERT_LIMIT = 4


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


def month_start_kst(now: datetime) -> datetime:
    """now가 속한 달(KST)의 1일 00:00 — UTC로."""
    k = now.astimezone(KST)
    return k.replace(day=1, hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)


def payments_overview(db: Database, company: str, now: datetime) -> dict:
    """회사 임직원 카드의 결제내역(cards.transactions) — 최신 4건 + 이번 달(KST) 차단 건수.
    알림에는 이름·이메일 없이 부서만."""
    users = db.users.find({"company": company, "role": "employee"}, {"dept": 1})
    dept_of = {u["_id"]: u.get("dept") for u in users}
    base = [{"$match": {"user_id": {"$in": list(dept_of)}}}, {"$unwind": "$transactions"}]

    recent = db.cards.aggregate(base + [
        {"$sort": {"transactions.paid_at": -1}},
        {"$limit": ALERT_LIMIT},
        {"$project": {"_id": 0, "user_id": 1, "transactions": 1}},
    ])
    alerts = [{
        "merchant": r["transactions"]["merchant"],
        "amount": r["transactions"]["amount"],
        "status": r["transactions"]["status"],
        "blocked_reason": r["transactions"].get("blocked_reason"),
        "dept": dept_of.get(r["user_id"]),
        "paid_at": r["transactions"]["paid_at"].astimezone(KST).isoformat(),
    } for r in recent]

    counted = list(db.cards.aggregate(base + [
        {"$match": {"transactions.status": "blocked", "transactions.paid_at": {"$gte": month_start_kst(now)}}},
        {"$count": "n"},
    ]))
    return {"alerts": alerts, "blocked_this_month": counted[0]["n"] if counted else 0}


@router.get("/payments")
def payments(admin: dict = Depends(require_admin), db: Database = Depends(get_db)):
    return payments_overview(db, admin["company"], datetime.now(timezone.utc))
