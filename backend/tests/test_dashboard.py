"""대시보드 결제 API 테스트 (최근 결제 알림 · 이번 달 차단 건수) — mongomock(메모리 DB). Atlas에 붙지 않음.

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
from app.routers import dashboard as Dash

COMPANY = "가나다테크(주)"
OTHER = "다른회사(주)"
KST = timezone(timedelta(hours=9))
NOW = datetime(2026, 10, 22, 12, 0, tzinfo=KST).astimezone(timezone.utc)


def at(month, day, hour=12, minute=0):
    return datetime(2026, month, day, hour, minute, tzinfo=KST).astimezone(timezone.utc)


def tx(when, merchant, status="approved", reason=None, amount=9000):
    return {"paid_at": when, "merchant": merchant, "pocket": "meal" if status == "approved" else None,
            "amount": amount, "status": status, "blocked_reason": reason}


def request_with(token=None):
    headers = [(b"cookie", f"{A.COOKIE_NAME}={token}".encode())] if token else []
    return Request({"type": "http", "method": "GET", "path": "/api/dashboard/payments", "headers": headers})


class DashboardPaymentsTest(unittest.TestCase):
    def setUp(self):
        self.db = mongomock.MongoClient(tz_aware=True).konabiz
        patcher = mock.patch.object(A.settings, "JWT_SECRET", "test-secret-" + "x" * 32)
        patcher.start()
        self.addCleanup(patcher.stop)

        self.admin = self._user("admin@ganada.co.kr", "김철수", role="admin")
        self.minjun = self._user("employee@ganada.co.kr", "김민준", dept="개발팀", txs=[
            tx(at(10, 16), "스타벅스 강남점"),
            tx(at(10, 15), "블루문 유흥주점", "blocked", "유흥주점은 제한 업종이에요"),
            tx(at(9, 30), "9월 차단", "blocked", "잔액 부족"),            # 지난달 — 차단 건수에서 빠짐
            tx(at(10, 1, 0, 0), "10월 첫 차단", "blocked", "제한 업종"),   # KST 10/1 00:00 — 이번 달
        ])
        self.soyul = self._user("soyul.han@company.co.kr", "한소율", dept="마케팅팀", txs=[
            tx(at(10, 22, 11, 50), "스타벅스", "review", "AI 확신도가 낮아 관리자 확인이 필요해요"),
            tx(at(10, 21), "달빛우동 성수점"),
        ])
        self.other = self._user("x@other.co.kr", "남", company=OTHER, dept="개발팀", txs=[
            tx(at(10, 22, 11, 59), "다른 회사 결제", "blocked", "제한 업종"),
        ])

    def _user(self, email, name, role="employee", company=COMPANY, dept=None, txs=None):
        u = {"email": email, "name": name, "role": role, "company": company, "dept": dept,
             "status": "active", "password_hash": "secret-hash"}
        uid = self.db.users.insert_one(u).inserted_id
        if role == "employee":
            self.db.cards.insert_one({"user_id": uid, "last4": "1234", "status": "active",
                                      "points": MR.start_points(), "transactions": txs or []})
        return uid

    def overview(self):
        return Dash.payments_overview(self.db, COMPANY, NOW)

    def test_latest_four_newest_first(self):
        alerts = self.overview()["alerts"]
        self.assertEqual([a["merchant"] for a in alerts],
                         ["스타벅스", "달빛우동 성수점", "스타벅스 강남점", "블루문 유흥주점"])
        self.assertEqual(alerts[0]["status"], "review")
        self.assertEqual(alerts[0]["dept"], "마케팅팀")
        self.assertEqual(alerts[3]["blocked_reason"], "유흥주점은 제한 업종이에요")
        self.assertTrue(alerts[0]["paid_at"].startswith("2026-10-22T11:50"))
        self.assertTrue(alerts[0]["paid_at"].endswith("+09:00"))

    def test_only_own_company(self):
        r = self.overview()
        self.assertNotIn("다른 회사 결제", [a["merchant"] for a in r["alerts"]])
        self.assertEqual(Dash.payments_overview(self.db, OTHER, NOW)["blocked_this_month"], 1)

    def test_blocked_this_month_kst(self):
        """10/15 · 10/1 00:00(KST) 차단만 — 9월 차단 · review · 다른 회사는 제외"""
        self.assertEqual(self.overview()["blocked_this_month"], 2)
        self.assertEqual(Dash.month_start_kst(NOW), datetime(2026, 9, 30, 15, 0, tzinfo=timezone.utc))

    def test_counts_new_payment(self):
        self.db.cards.update_one({"user_id": self.minjun}, {"$push": {"transactions": {
            "$each": [tx(at(10, 22, 11, 59), "새 차단", "blocked", "제한 업종")], "$position": 0}}})
        r = self.overview()
        self.assertEqual(r["blocked_this_month"], 3)
        self.assertEqual(r["alerts"][0]["merchant"], "새 차단")

    def test_no_personal_fields(self):
        r = self.overview()
        for a in r["alerts"]:
            self.assertEqual(set(a), {"merchant", "amount", "status", "blocked_reason", "dept", "paid_at"})
        self.assertNotIn("김민준", str(r))
        self.assertNotIn("@", str(r))

    def test_empty_company(self):
        self.assertEqual(Dash.payments_overview(self.db, "없는회사", NOW), {"alerts": [], "blocked_this_month": 0})

    def test_admin_only(self):
        with self.assertRaises(HTTPException) as ctx:
            A.require_login(request_with(None), self.db)
        self.assertEqual(ctx.exception.status_code, 401)
        emp = A.require_login(request_with(A.create_token(self.minjun, "employee")), self.db)
        with self.assertRaises(HTTPException) as ctx:
            A.require_admin(emp)
        self.assertEqual(ctx.exception.status_code, 403)
        admin = A.require_admin(A.require_login(request_with(A.create_token(self.admin, "admin")), self.db))
        with mock.patch.object(Dash, "datetime", wraps=datetime) as dt:
            dt.now.return_value = NOW
            self.assertEqual(Dash.payments(admin, self.db)["blocked_this_month"], 2)


if __name__ == "__main__":
    unittest.main()
