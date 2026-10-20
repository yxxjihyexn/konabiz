"""데모 데이터 넣기 — konabiz DB의 users · reservations · cards · chats를 비우고 다시 넣음.

실행 (backend 폴더에서): python -m scripts.seed
- 몇 번을 실행해도 결과가 같음 (4개 컬렉션을 지우고 인덱스까지 다시 만듦)
- 이 4개 외의 컬렉션·DB는 건드리지 않음
- 날짜는 KST 기준 값을 UTC datetime으로 저장 (날짜만 있는 값은 KST 00:00)
"""
import sys
from datetime import datetime, timedelta, timezone

from bson import ObjectId
from pymongo import ASCENDING, DESCENDING, IndexModel, MongoClient

from app.auth import hash_password
from app.config import settings
from scripts import seed_data as D

COLLECTIONS = ("users", "reservations", "cards", "chats")

KST = timezone(timedelta(hours=9))
YEAR = 2026

INDEXES = {
    "users": [
        IndexModel([("email", ASCENDING)], unique=True, name="email_unique"),
        IndexModel([("company", ASCENDING), ("dept", ASCENDING), ("status", ASCENDING)], name="company_dept_status"),
    ],
    "cards": [
        IndexModel([("user_id", ASCENDING)], unique=True, name="user_id_unique"),
    ],
    "reservations": [
        # 같은 시간 이중 예약 방지 — 확정된 예약끼리만
        IndexModel([("preferred_at", ASCENDING)], unique=True, name="preferred_at_confirmed_unique",
                   partialFilterExpression={"status": "confirmed"}),
        IndexModel([("created_at", DESCENDING)], name="created_at_desc"),
    ],
    "chats": [
        IndexModel([("conversation_id", ASCENDING)], unique=True, name="conversation_id_unique"),
        IndexModel([("uid", ASCENDING), ("updated_at", DESCENDING)], name="uid_updated_at"),
    ],
}


def kst(month, day, hour=0, minute=0, second=0, year=YEAR):
    return datetime(year, month, day, hour, minute, second, tzinfo=KST).astimezone(timezone.utc)


def build_users():
    admin = {
        "_id": ObjectId(), "email": D.ADMIN["email"], "name": D.ADMIN["name"], "role": "admin",
        "company": D.COMPANY, "dept": None, "status": "active",
        "invited_at": None, "created_at": kst(*D.ADMIN["created"][1:], year=D.ADMIN["created"][0]),
        "password_hash": hash_password(D.DEMO_PASSWORD),
    }
    employees = []
    for name, email, dept, _last4, status, (y, m, d) in D.MEMBERS:
        if name == D.DEMO_EMPLOYEE_NAME:
            email = D.DEMO_EMPLOYEE_EMAIL
        invited_at = kst(m, d, year=y)
        user = {
            "_id": ObjectId(), "email": email.lower(), "name": name, "role": "employee",
            "company": D.COMPANY, "dept": dept, "status": status,
            "invited_at": invited_at, "created_at": invited_at,
        }
        if name == D.DEMO_EMPLOYEE_NAME:
            user["password_hash"] = hash_password(D.DEMO_PASSWORD)   # 데모 계정만
        employees.append(user)
    return admin, employees


def build_demo_transactions():
    txs = []
    for (m, d), merchant, pocket, amount, blocked in D.DEMO_PAYMENTS:
        txs.append({
            "paid_at": kst(m, d), "merchant": merchant, "pocket": pocket, "amount": amount,
            "status": "blocked" if blocked else "approved", "blocked_reason": blocked,
        })
    return txs


def points_after(transactions):
    """남은 잔액 = 시작 잔액 − 승인 결제 (차단은 차감 없음)."""
    bal = dict(D.START_POINTS)
    for t in transactions:
        if t["status"] == "approved":
            bal[t["pocket"]] -= t["amount"]
    return {k: {"start": D.START_POINTS[k], "balance": bal[k]} for k in D.START_POINTS}


def build_cards(user_ids_by_email):
    seeded_at = kst(10, 16)
    cards = []
    for name, email, _dept, last4, status, _invited in D.MEMBERS:
        if name == D.DEMO_EMPLOYEE_NAME:
            email = D.DEMO_EMPLOYEE_EMAIL
        txs = build_demo_transactions() if name == D.DEMO_EMPLOYEE_NAME else []
        cards.append({
            "user_id": user_ids_by_email[email.lower()], "last4": last4,
            "status": D.CARD_STATUS[status], "points": points_after(txs),
            "transactions": txs, "updated_at": seeded_at,
        })
    return cards


def build_reservations():
    docs = []
    for r in D.RESERVATIONS:
        m, d, h = r["slot"]
        cm, cd, ch, cmin = r["created"]
        docs.append({
            "company_name": r["company_name"], "employee_count": r["employee_count"], "card_count": r["card_count"],
            "contact_name": r["contact_name"], "contact_title": r["contact_title"],
            "phone": r["phone"], "email": r["email"],
            "consultation_type": r["consultation_type"], "address": r["address"],
            "preferred_at": kst(m, d, h), "custom_preset": r["custom_preset"],
            "source": r["source"], "status": "confirmed", "created_at": kst(cm, cd, ch, cmin),
        })
    return docs


def build_chats(demo_user_id):
    msgs = []
    for i, (who, text, cta, when) in enumerate(D.DEMO_CHAT["messages"], start=1):
        msg = {"id": f"demo-msg-{i}", "from": who, "text": text, "created_at": kst(*when)}
        if cta:
            msg["cta"] = cta
        msgs.append(msg)
    return [{
        "uid": str(demo_user_id), "conversation_id": D.DEMO_CHAT["conversation_id"],
        "messages": msgs, "created_at": msgs[0]["created_at"], "updated_at": msgs[-1]["created_at"],
    }]


def check(users, cards):
    """mock-data.js와 숫자가 맞는지 — 어긋나면 넣기 전에 멈춤."""
    employees = [u for u in users if u["role"] == "employee"]
    assert len(employees) == 24, "임직원은 24명이어야 함"
    active = [c for c in cards if c["status"] in ("issuing", "active")]
    by_dept = {}
    dept_of = {u["_id"]: u["dept"] for u in employees}
    for c in active:
        by_dept[dept_of[c["user_id"]]] = by_dept.get(dept_of[c["user_id"]], 0) + 1
    assert len(active) == 21, f"활성 카드 21장이어야 함 (지금 {len(active)})"
    assert by_dept == {"영업1팀": 6, "마케팅팀": 7, "개발팀": 8}, f"부서별 활성 카드 불일치: {by_dept}"
    demo = next(c for c in cards if c["transactions"])
    got = {k: v["balance"] for k, v in demo["points"].items()}
    assert got == D.DEMO_BALANCES, f"김민준 잔액 불일치: {got}"
    with_pw = sorted(u["email"] for u in users if u.get("password_hash"))
    assert with_pw == sorted([D.ADMIN["email"], D.DEMO_EMPLOYEE_EMAIL]), "비밀번호는 데모 계정 2개에만"


def main():
    if not settings.MONGODB_URI:
        print("MONGODB_URI가 비어 있습니다. backend/.env에 Atlas 접속 주소를 넣고 다시 실행하세요.")
        sys.exit(1)

    db_name = settings.MONGODB_DB
    print(f"{db_name} DB의 users·reservations·cards·chats를 비우고 다시 넣습니다")

    client = MongoClient(settings.MONGODB_URI, serverSelectionTimeoutMS=10000, tz_aware=True)
    try:
        try:
            client.admin.command("ping")
        except Exception as e:
            # 예외 메시지에 접속 주소가 섞일 수 있어 종류만 출력
            print(f"DB 연결 실패 ({type(e).__name__})")
            sys.exit(1)

        db = client[db_name]

        # 1) 넣을 문서를 먼저 다 만들고 검사 — 실패하면 DB를 건드리기 전에 멈춤
        admin, employees = build_users()
        users = [admin] + employees
        ids = {u["email"]: u["_id"] for u in employees}
        cards = build_cards(ids)
        check(users, cards)
        reservations = build_reservations()
        chats = build_chats(ids[D.DEMO_EMPLOYEE_EMAIL])

        # 2) 4개 컬렉션만 지우고 인덱스 다시 만들기
        for name in COLLECTIONS:
            db.drop_collection(name)
            db[name].create_indexes(INDEXES[name])

        # 3) 넣기
        db.users.insert_many(users)
        db.cards.insert_many(cards)
        db.reservations.insert_many(reservations)
        db.chats.insert_many(chats)

        print()
        print(f"{'컬렉션':<14}문서 수")
        for name in COLLECTIONS:
            print(f"{name:<16}{db[name].count_documents({})}")
        print()
        print(f"로그인 가능(데모) 계정:{db.users.count_documents({'password_hash': {'$exists': True}})}개")
    finally:
        client.close()


if __name__ == "__main__":
    main()
