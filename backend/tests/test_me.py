"""임직원 마이페이지 API 테스트 — mongomock(메모리 DB). Atlas에 붙지 않음.

실행 (backend 폴더에서): python -m unittest discover -s tests -t . -v
"""
import unittest
from datetime import datetime, timedelta, timezone
from unittest import mock

import mongomock
from fastapi import HTTPException
from starlette.requests import Request

from app import auth as A
from app import member_rules as MR
from app.routers import me

COMPANY = "가나다테크(주)"
KST = timezone(timedelta(hours=9))
NOW = datetime(2026, 10, 1, tzinfo=timezone.utc)

# 김민준 데모 거래 (scripts/seed_data.py DEMO_PAYMENTS와 같은 값) — 일부러 순서를 섞어 넣음
DEMO = [
    (10, "김밥천국", "meal", 7500, None),
    (16, "스타벅스 강남점", "meal", 4500, None),
    (13, "교보문고", "welfare", 18000, None),
    (15, "라운지바 강남", None, 30000, "유흥주점은 제한 업종이에요"),
    (14, "애니타임피트니스", "fitness", 30000, None),
    (8, "한솥도시락", "meal", 18000, None),
    (12, "오피스디포", "expense", 12000, None),
]


def request_with(token=None):
    headers = [(b"cookie", f"{A.COOKIE_NAME}={token}".encode())] if token else []
    return Request({"type": "http", "method": "GET", "path": "/api/me/card", "headers": headers})


class MeCardTest(unittest.TestCase):
    def setUp(self):
        self.db = mongomock.MongoClient(tz_aware=True).konabiz
        patcher = mock.patch.object(A.settings, "JWT_SECRET", "test-secret-" + "x" * 32)
        patcher.start()
        self.addCleanup(patcher.stop)

        txs = [{"paid_at": datetime(2026, 10, d, tzinfo=KST).astimezone(timezone.utc), "merchant": m,
                "pocket": p, "amount": a, "status": "blocked" if r else "approved", "blocked_reason": r}
               for d, m, p, a, r in DEMO]
        pts = MR.start_points()
        for t in txs:
            if t["status"] == "approved":
                pts[t["pocket"]]["balance"] -= t["amount"]
        self.minjun = self._user("employee@ganada.co.kr", "김민준", last4="4821", points=pts, txs=txs)
        self.new = self._user("new@ganada.co.kr", "정다은", last4="5555")
        self.admin = self._user("admin@ganada.co.kr", "김철수", role="admin")

    def _user(self, email, name, role="employee", last4="1234", points=None, txs=None):
        u = {"email": email, "name": name, "role": role, "company": COMPANY,
             "dept": "개발팀" if role == "employee" else None, "status": "active",
             "invited_at": NOW, "created_at": NOW, "password_hash": "secret-hash"}
        uid = self.db.users.insert_one(u).inserted_id
        if role == "employee":
            self.db.cards.insert_one({"user_id": uid, "last4": last4, "status": "active",
                                      "points": points or MR.start_points(), "transactions": txs or []})
        return uid

    def card_for(self, uid):
        """쿠키 토큰 → require_login → require_employee → card (실제 요청과 같은 순서)."""
        u = self.db.users.find_one({"_id": uid})
        token = A.create_token(uid, u["role"])
        user = A.require_login(request_with(token), self.db)
        return me.card(me.require_employee(user), self.db)

    def assert_http(self, code, fn, *args):
        with self.assertRaises(HTTPException) as ctx:
            fn(*args)
        self.assertEqual(ctx.exception.status_code, code)
        return ctx.exception

    def test_demo_employee_balances_and_transactions(self):
        r = self.card_for(self.minjun)
        self.assertEqual(r["last4"], "4821")
        self.assertEqual(r["holder"], "김민준")
        got = {k: v["balance"] for k, v in r["points"].items()}
        self.assertEqual(got, {"meal": 120000, "fitness": 70000, "welfare": 82000, "expense": 488000})
        self.assertEqual(len(r["transactions"]), 7)
        self.assertEqual(sum(t["status"] == "blocked" for t in r["transactions"]), 1)

    def test_summary_excludes_expense(self):
        s = self.card_for(self.minjun)["summary"]
        self.assertEqual(s["remaining"], 120000 + 70000 + 82000)
        self.assertEqual(s["expense"], 488000)

    def test_transactions_newest_first_in_kst(self):
        txs = self.card_for(self.minjun)["transactions"]
        self.assertEqual([t["paid_at"][:10] for t in txs],
                         ["2026-10-16", "2026-10-15", "2026-10-14", "2026-10-13", "2026-10-12", "2026-10-10", "2026-10-08"])
        self.assertTrue(txs[0]["paid_at"].endswith("+09:00"))
        self.assertEqual(txs[1]["blocked_reason"], "유흥주점은 제한 업종이에요")

    def test_only_own_card(self):
        r = self.card_for(self.new)
        self.assertEqual(r["holder"], "정다은")
        self.assertEqual(r["last4"], "5555")
        self.assertEqual(r["transactions"], [])
        self.assertEqual(r["points"], MR.start_points())   # 사용 0원 = 시작 잔액 그대로
        self.assertEqual(r["summary"]["remaining"], sum(MR.START_POINTS[k] for k in ("meal", "fitness", "welfare")))
        self.assertNotIn("김민준", str(r))

    def test_no_sensitive_fields(self):
        r = self.card_for(self.minjun)
        for key in ("_id", "user_id", "password_hash", "email"):
            self.assertNotIn(key, r)
        self.assertNotIn("secret-hash", str(r))

    def test_admin_forbidden(self):
        user = A.require_login(request_with(A.create_token(self.admin, "admin")), self.db)
        self.assert_http(403, me.require_employee, user)

    def test_not_logged_in(self):
        e = self.assert_http(401, A.require_login, request_with(None), self.db)
        self.assertEqual(e.headers[A.AUTH_ERROR_HEADER], "required")

    def test_card_missing_404(self):
        self.db.cards.delete_one({"user_id": self.new})
        self.assert_http(404, self.card_for, self.new)


if __name__ == "__main__":
    unittest.main()
