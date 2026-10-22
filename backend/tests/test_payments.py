"""결제 테스트(시연용) API 테스트 — mongomock(메모리 DB). Atlas에 붙지 않음.

판별 모델은 classify_merchant를 바꿔 끼워 판정을 고정함 (모델 파일 없이도 돌아가게).
실행 (backend 폴더에서): python -m unittest discover -s tests -t . -v
"""
import json
import unittest
from datetime import datetime, timezone
from unittest import mock

import mongomock
from fastapi import HTTPException
from starlette.requests import Request

from app import auth as A
from app import member_rules as MR
from app.routers import me, payments as P

COMPANY = "가나다테크(주)"
NOW = datetime(2026, 10, 1, tzinfo=timezone.utc)


def ai(category, level, confidence=0.94, source="model"):
    return {"category": category, "confidence": confidence, "industry": "일식", "source": source, "level": level}


MEAL_HIGH = ai("meal", "high")
RULE_BLOCK = ai("restricted", "block", 1.0, "rule")


def request_with(token=None):
    headers = [(b"cookie", f"{A.COOKIE_NAME}={token}".encode())] if token else []
    return Request({"type": "http", "method": "POST", "path": "/api/payments/test", "headers": headers})


class TestPaymentTest(unittest.TestCase):
    def setUp(self):
        self.db = mongomock.MongoClient(tz_aware=True).konabiz
        patcher = mock.patch.object(A.settings, "JWT_SECRET", "test-secret-" + "x" * 32)
        patcher.start()
        self.addCleanup(patcher.stop)
        P.limiter.reset()

        self.emp = self._user("employee@ganada.co.kr", "김민준")
        self.admin = self._user("admin@ganada.co.kr", "김철수", role="admin")

    def _user(self, email, name, role="employee"):
        u = {"email": email, "name": name, "role": role, "company": COMPANY,
             "dept": "개발팀" if role == "employee" else None, "status": "active",
             "invited_at": NOW, "created_at": NOW, "password_hash": "secret-hash"}
        uid = self.db.users.insert_one(u).inserted_id
        if role == "employee":
            old = {"paid_at": datetime(2026, 10, 16, tzinfo=timezone.utc), "merchant": "스타벅스 강남점",
                   "pocket": "meal", "amount": 4500, "status": "approved", "blocked_reason": None}
            self.db.cards.insert_one({"user_id": uid, "last4": "4821", "status": "active",
                                      "points": MR.start_points(), "transactions": [old]})
        return uid

    def login(self, uid):
        u = self.db.users.find_one({"_id": uid})
        return A.require_login(request_with(A.create_token(uid, u["role"])), self.db)

    def pay(self, merchant="달빛우동 성수점", amount=9000, result=MEAL_HIGH, uid=None):
        user = P.require_employee(self.login(uid or self.emp))
        with mock.patch.object(P, "classify_merchant", return_value=result):
            return P.create_test_payment({"merchant": merchant, "amount": amount}, user, self.db)

    def card(self):
        return self.db.cards.find_one({"user_id": self.emp})

    def balance(self, pocket):
        return self.card()["points"][pocket]["balance"]

    def assert_http(self, code, fn, *args):
        with self.assertRaises(HTTPException) as ctx:
            fn(*args)
        self.assertEqual(ctx.exception.status_code, code)
        return ctx.exception

    # ---------- 판정 ----------

    def test_approved_deducts_and_saves(self):
        r = self.pay()
        self.assertEqual(r["transaction"]["status"], "approved")
        self.assertEqual(r["transaction"]["pocket"], "meal")
        self.assertEqual(r["points"]["meal"]["balance"], 150000 - 9000)
        self.assertEqual(r["summary"]["remaining"], 150000 - 9000 + 100000 + 100000)
        self.assertTrue(r["transaction"]["paid_at"].endswith("+09:00"))
        self.assertEqual(self.balance("meal"), 141000)
        saved = self.card()["transactions"][0]   # $position 0 — 배열 맨 앞
        self.assertEqual(saved["merchant"], "달빛우동 성수점")
        self.assertEqual(saved["source"], "test")
        self.assertEqual((saved["category"], saved["confidence"]), ("meal", 0.94))
        self.assertEqual(saved["user_id"], self.emp)
        self.assertEqual(saved["card_id"], self.card()["_id"])
        self.assertEqual(saved["company"], COMPANY)

    def test_expense_uses_separate_budget(self):
        r = self.pay("새벽별문구", 30000, ai("expense", "high", 0.8))
        self.assertEqual(r["points"]["expense"]["balance"], 470000)
        self.assertEqual(r["summary"]["remaining"], 350000)   # 3종 합계는 그대로

    def test_keyword_rule_blocked(self):
        r = self.pay("블루문 유흥주점", 30000, RULE_BLOCK)
        self.assertEqual(r["transaction"]["status"], "blocked")
        self.assertEqual(r["transaction"]["blocked_reason"], P.REASON_RESTRICTED)
        self.assertEqual(self.card()["points"], MR.start_points())

    def test_insufficient_balance_blocked_and_recorded(self):
        r = self.pay(amount=150001)
        self.assertEqual(r["transaction"]["status"], "blocked")
        self.assertEqual(r["transaction"]["blocked_reason"], P.REASON_BALANCE)
        self.assertEqual(self.balance("meal"), 150000)
        self.assertEqual(self.card()["transactions"][0]["blocked_reason"], P.REASON_BALANCE)

    def test_low_confidence_review_no_deduction(self):
        r = self.pay("스타벅스", 9000, ai("meal", "low", 0.41))
        self.assertEqual(r["transaction"]["status"], "review")
        self.assertIsNone(r["transaction"]["pocket"])
        self.assertEqual(self.balance("meal"), 150000)
        self.assertEqual(self.card()["transactions"][0]["status"], "review")

    def test_model_restricted_warn_is_review_not_block(self):
        r = self.pay("라운지바 강남", 9000, ai("restricted", "warn", 0.95))
        self.assertEqual(r["transaction"]["status"], "review")

    def test_suspended_card_blocked(self):
        self.db.cards.update_one({"user_id": self.emp}, {"$set": {"status": "suspended"}})
        r = self.pay()
        self.assertEqual(r["transaction"]["blocked_reason"], P.REASON_CARD)
        self.assertEqual(self.balance("meal"), 150000)

    def test_category_not_on_card_blocked(self):
        self.db.cards.update_one({"user_id": self.emp}, {"$unset": {"points.fitness": ""}})
        card = self.card()
        self.assertEqual(P.decide(card, ai("fitness", "high"), 1000), ("blocked", None, P.REASON_NOT_ALLOWED))

    def test_balance_never_negative(self):
        """잔액을 정확히 다 쓰면 0, 그 뒤는 잔액 부족. 오래된 잔액을 보고 승인하려 해도 조건부 차감이 막음"""
        self.pay(amount=150000)
        self.assertEqual(self.balance("meal"), 0)
        r = self.pay(amount=100)
        self.assertEqual(r["transaction"]["blocked_reason"], P.REASON_BALANCE)
        self.assertEqual(self.balance("meal"), 0)

        stale = {**self.card(), "points": MR.start_points()}   # 다른 요청이 차감하기 전에 읽은 값
        real = self.db.cards.find_one
        calls = iter([stale])
        with mock.patch.object(self.db.cards, "find_one",
                               side_effect=lambda *a, **k: next(calls, None) or real(*a, **k)):
            tx = P.record(self.db, self.db.users.find_one({"_id": self.emp}), "달빛우동 성수점", 9000, MEAL_HIGH)
        self.assertEqual((tx["status"], tx["blocked_reason"]), ("blocked", P.REASON_BALANCE))
        self.assertEqual(self.balance("meal"), 0)

    def test_newest_first_on_mypage(self):
        """Atlas 배열은 맨 앞, 마이페이지는 시각 최신순 — 둘 다 방금 결제가 첫 번째"""
        self.pay()
        txs = me.card(me.require_employee(self.login(self.emp)), self.db)["transactions"]
        self.assertEqual(txs[0]["merchant"], "달빛우동 성수점")
        self.assertEqual(txs[1]["merchant"], "스타벅스 강남점")

    # ---------- 입력 · 권한 ----------

    def test_validation_422(self):
        cases = [
            ({"merchant": "  ", "amount": 9000}, "merchant"),
            ({"merchant": "가" * 41, "amount": 9000}, "merchant"),
            ({"merchant": "달빛우동", "amount": 99}, "amount"),
            ({"merchant": "달빛우동", "amount": 1_000_001}, "amount"),
            ({"merchant": "달빛우동", "amount": 9000.5}, "amount"),
            ({"merchant": "달빛우동", "amount": "9000"}, "amount"),
            ({"merchant": "달빛우동", "amount": True}, "amount"),
            ({"merchant": "달빛우동"}, "amount"),
        ]
        user = P.require_employee(self.login(self.emp))
        for body, field in cases:
            res = P.create_test_payment(body, user, self.db)
            self.assertEqual(res.status_code, 422, body)
            self.assertIn(field, json.loads(res.body)["errors"], body)
        self.assertEqual(len(self.card()["transactions"]), 1)   # 저장 안 함
        self.assertEqual(P.validate({"merchant": "  가" * 1 + "나 ", "amount": 100})[0]["merchant"], "가나")

    def test_not_logged_in_401(self):
        self.assert_http(401, A.require_login, request_with(None), self.db)

    def test_admin_403(self):
        self.assert_http(403, P.require_employee, self.login(self.admin))

    def test_rate_limit_429(self):
        for _ in range(P.RATE_UID):
            self.pay(amount=100)
        self.assert_http(429, self.pay)

    def test_model_unavailable_503(self):
        user = P.require_employee(self.login(self.emp))
        with mock.patch.object(P.ml, "model", None):
            self.assert_http(503, P.create_test_payment, {"merchant": "달빛우동", "amount": 9000}, user, self.db)
        self.assertEqual(len(self.card()["transactions"]), 1)


if __name__ == "__main__":
    unittest.main()
