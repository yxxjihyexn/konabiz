"""챗봇 API 테스트 — mongomock(메모리 DB) + 가짜 OpenAI. 실제 OpenAI·Atlas에는 붙지 않음.

실행 (backend 폴더에서): python -m unittest discover -s tests -t . -v
"""
import unittest
from datetime import datetime, timezone
from unittest import mock

import httpx2
import mongomock
import openai
from fastapi import HTTPException
from pymongo import ASCENDING, DESCENDING, IndexModel
from starlette.requests import Request

from app import auth as A
from app import chat_rules as CR
from app.routers import chat as C

NOW = datetime(2026, 10, 1, tzinfo=timezone.utc)


def request_with(token=None, ip="10.0.0.1"):
    headers = [(b"cookie", f"{A.COOKIE_NAME}={token}".encode())] if token else []
    return Request({"type": "http", "method": "POST", "path": "/api/chat", "headers": headers, "client": (ip, 5000)})


def fake_answer(text="도입비는 최초 1회 300,000원이에요.", cta="booking"):
    return C.ChatAnswer(text=text, cta=cta)


class ChatTest(unittest.TestCase):
    def setUp(self):
        self.db = mongomock.MongoClient(tz_aware=True).konabiz
        self.db.chats.create_indexes([
            IndexModel([("conversation_id", ASCENDING)], unique=True),
            IndexModel([("uid", ASCENDING), ("updated_at", DESCENDING)]),
        ])
        for name, value in (("JWT_SECRET", "test-secret-" + "x" * 32), ("OPENAI_API_KEY", "sk-test-fake")):
            p = mock.patch.object(C.settings, name, value)
            p.start()
            self.addCleanup(p.stop)
        C.limiter.reset()
        self.addCleanup(C.limiter.reset)
        self.ai = mock.patch.object(C, "call_openai", return_value=fake_answer()).start()
        self.addCleanup(mock.patch.stopall)

        uid = self.db.users.insert_one({
            "email": "employee@ganada.co.kr", "name": "김민준", "role": "employee", "company": "가나다테크(주)",
            "dept": "개발팀", "status": "active", "invited_at": NOW, "created_at": NOW,
        }).inserted_id
        self.user_id = str(uid)
        self.token = A.create_token(uid, "employee")

    def send(self, message, quick=None, conv="conv1", anon="anon1", token=None, ip="10.0.0.1"):
        body = {"message": message, "conversation_id": conv, "anon_id": anon}
        if quick:
            body["quick_reply_id"] = quick
        return C.chat(request_with(token, ip), body, self.db)

    def assert_http(self, status, detail, fn):
        with self.assertRaises(HTTPException) as cm:
            fn()
        self.assertEqual(cm.exception.status_code, status)
        self.assertEqual(cm.exception.detail, detail)

    # ---------- 규칙 답변 ----------
    def test_quick_reply_uses_rule_without_openai(self):
        for qid, ans in CR.ANSWERS.items():
            res = self.send("버튼", quick=qid, conv="c-" + qid)
            self.assertEqual(res, {"text": ans["text"], "cta": ans["cta"]})
        self.ai.assert_not_called()

    def test_unknown_quick_reply_is_422(self):
        self.assert_http(422, C.MSG_INVALID, lambda: self.send("x", quick="nope"))

    # ---------- AI 답변 ----------
    def test_free_text_calls_openai_with_faq_and_history(self):
        self.send("버튼", quick="pricing")
        res = self.send("한 달에 얼마 들어요?")
        self.assertEqual(res, {"text": "도입비는 최초 1회 300,000원이에요.", "cta": "booking"})
        self.ai.assert_called_once()
        messages = self.ai.call_args.args[0]
        self.assertEqual(messages[0]["role"], "system")
        self.assertIn("300,000원", messages[0]["content"])
        self.assertIn("코나아이(주)", messages[0]["content"])
        # 맥락: 앞의 빠른 답변 질문·답변 + 이번 질문
        self.assertEqual([m["role"] for m in messages[1:]], ["user", "assistant", "user"])
        self.assertEqual(messages[-1]["content"], "한 달에 얼마 들어요?")

    def test_history_is_last_six_messages_only(self):
        for i in range(5):
            self.send(f"질문 {i}")
        self.send("마지막 질문")
        messages = self.ai.call_args.args[0]
        self.assertEqual(len(messages), 1 + C.HISTORY + 1)

    def test_personal_info_is_masked_before_openai(self):
        self.send("제 메일은 hong@company.com 이고 번호는 010-1234-5678, 카드 1234-5678-9012-3456")
        sent = self.ai.call_args.args[0][-1]["content"]
        for raw in ("hong@company.com", "010-1234-5678", "1234-5678-9012-3456"):
            self.assertNotIn(raw, sent)
        self.assertNotIn("김민준", str(self.ai.call_args))

    def test_user_name_and_email_not_sent_when_logged_in(self):
        self.send("카드 바로 나와요?", token=self.token)
        sent = str(self.ai.call_args)
        self.assertNotIn("김민준", sent)
        self.assertNotIn("employee@ganada.co.kr", sent)

    # ---------- cta 검증 ----------
    def test_cta_none_becomes_null_and_unknown_cta_becomes_null(self):
        self.ai.return_value = fake_answer(cta="none")
        self.assertIsNone(self.send("질문1", conv="a")["cta"])
        self.ai.return_value = mock.Mock(text="답", cta="kakao")
        self.assertIsNone(self.send("질문2", conv="b")["cta"])
        self.ai.return_value = fake_answer(cta="simulator")
        self.assertEqual(self.send("질문3", conv="c")["cta"], "simulator")

    def test_empty_or_refused_answer_falls_back(self):
        self.ai.return_value = None
        self.assertEqual(self.send("질문"), CR.FALLBACK)
        self.ai.return_value = fake_answer(text="   ")
        self.assertEqual(self.send("질문", conv="c2"), CR.FALLBACK)

    def test_long_answer_is_cut(self):
        self.ai.return_value = fake_answer(text="가" * 1000)
        self.assertLessEqual(len(self.send("질문")["text"]), C.ANSWER_MAX + 1)

    # ---------- 대체 답변 ----------
    def test_timeout_falls_back_to_booking(self):
        req = httpx2.Request("POST", "https://api.openai.com/v1/chat/completions")
        for err in (openai.APITimeoutError(request=req), openai.APIConnectionError(request=req), RuntimeError("x")):
            self.ai.side_effect = err
            C.limiter.reset()
            with self.assertLogs("uvicorn.error", "WARNING") as logs:
                res = self.send("질문")
            self.assertEqual(res, {"text": CR.FALLBACK["text"], "cta": "booking"})
            self.assertIn(type(err).__name__, logs.output[0])
            self.assertNotIn("sk-test-fake", "".join(logs.output))

    def test_missing_key_falls_back_without_calling_openai(self):
        with mock.patch.object(C.settings, "OPENAI_API_KEY", ""):
            res = self.send("한 달에 얼마예요?")
        self.assertEqual(res, {"text": CR.FALLBACK["text"], "cta": "booking"})
        self.ai.assert_not_called()

    # ---------- 입력 검사 ----------
    def test_message_length_and_empty(self):
        self.assert_http(422, C.MSG_EMPTY, lambda: self.send("   "))
        self.assert_http(422, C.MSG_TOO_LONG, lambda: self.send("가" * 501))
        self.assertIn("text", self.send("  " + "가" * 500 + "  "))   # 앞뒤 공백은 빼고 셈

    def test_conversation_and_anon_id_required(self):
        self.assert_http(422, C.MSG_INVALID, lambda: self.send("질문", conv=None))
        self.assert_http(422, C.MSG_INVALID, lambda: self.send("질문", anon=None))
        self.assert_http(422, C.MSG_INVALID, lambda: self.send("질문", anon="bad id!"))
        self.send("질문", anon=None, token=self.token)   # 로그인했으면 anon_id 없어도 됨

    # ---------- 사용량 제한 ----------
    def test_rate_limit_per_uid(self):
        for i in range(C.RATE_UID):
            self.send("버튼", quick="booking", conv=f"c{i}")
        self.assert_http(429, C.MSG_RATE, lambda: self.send("버튼", quick="booking", conv="cx"))
        # 다른 uid는 그대로
        self.send("버튼", quick="booking", conv="cy", anon="anon2")

    def test_rate_limit_per_ip(self):
        for i in range(C.RATE_IP):
            self.send("버튼", quick="booking", conv=f"c{i}", anon=f"anon{i}")
        self.assert_http(429, C.MSG_RATE, lambda: self.send("버튼", quick="booking", conv="cx", anon="other"))
        self.send("버튼", quick="booking", conv="cy", anon="other", ip="10.0.0.2")

    def test_rate_window_expires(self):
        lim = C.RateLimiter()
        for _ in range(3):
            self.assertTrue(lim.allow([("k", 3)], now=0))
        self.assertFalse(lim.allow([("k", 3)], now=59))
        self.assertTrue(lim.allow([("k", 3)], now=60))

    # ---------- 저장 ----------
    def test_anonymous_saved_with_anon_id(self):
        self.send("버튼", quick="pricing", conv="conv-anon", anon="anonABC")
        doc = self.db.chats.find_one({"conversation_id": "conv-anon"})
        self.assertEqual(doc["uid"], "anonABC")
        self.assertEqual([m["from"] for m in doc["messages"]], ["user", "bot"])
        self.assertEqual(doc["messages"][0]["quick_reply_id"], "pricing")
        self.assertEqual(doc["messages"][1]["cta"], "booking")

    def test_logged_in_saved_with_user_id(self):
        self.send("카드 바로 나와요?", conv="conv-login", anon="anonABC", token=self.token)
        doc = self.db.chats.find_one({"conversation_id": "conv-login"})
        self.assertEqual(doc["uid"], self.user_id)
        self.assertEqual(doc["messages"][0]["text"], "카드 바로 나와요?")
        self.assertIn("created_at", doc)
        self.assertIn("updated_at", doc)

    def test_other_users_conversation_not_read_or_written(self):
        self.send("내 질문", conv="shared", anon="owner")
        self.ai.reset_mock()
        self.send("남의 대화", conv="shared", anon="intruder")
        self.assertEqual(len(self.ai.call_args.args[0]), 2)   # 시스템 + 이번 질문만 (남의 맥락 없음)
        doc = self.db.chats.find_one({"conversation_id": "shared"})
        self.assertEqual(doc["uid"], "owner")
        self.assertEqual(len(doc["messages"]), 2)

    def test_works_without_db(self):
        res = C.chat(request_with(), {"message": "질문", "conversation_id": "c", "anon_id": "a"}, None)
        self.assertEqual(res["cta"], "booking")


if __name__ == "__main__":
    unittest.main()
