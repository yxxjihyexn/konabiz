"""챗봇 API 테스트 — mongomock(메모리 DB) + 가짜 OpenAI · 가짜 임베딩. 실제 OpenAI·Atlas에는 붙지 않음.

실행 (backend 폴더에서): python -m unittest discover -s tests -t . -v
"""
import json
import re
import tempfile
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
from app import rag
from app.routers import chat as C

NOW = datetime(2026, 10, 1, tzinfo=timezone.utc)


def request_with(token=None, ip="10.0.0.1"):
    headers = [(b"cookie", f"{A.COOKIE_NAME}={token}".encode())] if token else []
    return Request({"type": "http", "method": "POST", "path": "/api/chat", "headers": headers, "client": (ip, 5000)})


def fake_answer(text="도입비는 최초 1회 300,000원이에요.", cta="booking", used_ids=()):
    return C.ChatAnswer(text=text, cta=cta, used_ids=list(used_ids))


# 가짜 지식 벡터 — 항목마다 한 축(one-hot). 질문 벡터 qvec({"F6": 0.9, ...})의 항목 유사도 = 가중치 / 길이
FAQ_ITEMS, _ = rag.load_faq()
AXIS = {x["id"]: i for i, x in enumerate(FAQ_ITEMS)}


def qvec(weights: dict) -> list[float]:
    v = [0.0] * len(FAQ_ITEMS)
    for i, w in weights.items():
        v[AXIS[i]] = w
    return v


def fake_knowledge() -> rag.Knowledge:
    return rag.Knowledge(FAQ_ITEMS, {i: qvec({i: 1.0}) for i in AXIS})


# 도입비(F6)가 1위, 다음으로 F7·F8·F9·F10·F1 — 1위 유사도 0.8 이상
PRICE_VEC = qvec({"F6": 0.9, "F7": 0.3, "F8": 0.25, "F9": 0.2, "F10": 0.15, "F1": 0.1})
KNOWLEDGE_ID_RE = re.compile(r"^\[([FN]\d+)\] ", re.M)


def prompt_ids(messages) -> list[str]:
    return KNOWLEDGE_ID_RE.findall(messages[0]["content"])


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
        self.embed = mock.patch.object(C, "call_embedding", side_effect=lambda texts: [PRICE_VEC for _ in texts]).start()
        mock.patch.object(C, "knowledge", fake_knowledge()).start()
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
            self.assertEqual(res, {"text": ans["text"], "cta": ans["cta"]})   # sources 없음
        self.ai.assert_not_called()
        self.embed.assert_not_called()

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

    def test_wrong_ending_is_fixed(self):
        self.ai.return_value = fake_answer(text="도입비는 최초 1회 300,000원이어요. 월 이용료는 0원이어요.")
        self.assertEqual(self.send("도입비 얼마예요?")["text"], "도입비는 최초 1회 300,000원이에요. 월 이용료는 0원이에요.")

    def test_prompt_ends_with_final_check(self):
        self.send("도입비 얼마예요?")
        system = self.ai.call_args.args[0][0]["content"]
        self.assertTrue(system.endswith(CR.FINAL_CHECK))
        self.assertIn('"카드 바로 나와요?"', system)   # cta booking 예시

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
        self.embed.assert_not_called()

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

    # ---------- RAG ----------
    def test_prompt_has_top5_knowledge_only(self):
        self.send("한 달에 얼마 들어요?")
        ids = prompt_ids(self.ai.call_args.args[0])
        self.assertEqual(ids, ["F6", "F7", "F8", "F9", "F10"])
        self.assertNotIn(CR.NO_KNOWLEDGE, self.ai.call_args.args[0][0]["content"])
        self.embed.assert_called_once_with(["한 달에 얼마 들어요?"])

    def test_below_threshold_means_no_knowledge(self):
        ten = ("F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10")
        self.embed.side_effect = lambda texts: [qvec({i: 0.3 for i in ten}) for _ in texts]   # 유사도 0.316
        self.ai.return_value = fake_answer(text="코나비즈 도입·이용 질문에만 답할 수 있어요.", used_ids=["F6"])
        res = self.send("오늘 날씨 어때요?")
        self.assertIn(CR.NO_KNOWLEDGE, self.ai.call_args.args[0][0]["content"])
        self.assertEqual(prompt_ids(self.ai.call_args.args[0]), [])
        self.assertNotIn("sources", res)   # 넣지 않은 지식 id는 근거가 될 수 없음

    def test_keyword_match_passes_low_score(self):
        low = {i: 0.2 for i in ("F1", "F2", "F3", "F4", "F5", "F6", "F7")}
        self.embed.side_effect = lambda texts: [qvec({**low, "F8": 0.1, "N24": 0.1}) for _ in texts]   # 1위 0.365
        self.ai.return_value = fake_answer(used_ids=["N24"])
        res = self.send("사원증형이 뭐예요?")
        ids = prompt_ids(self.ai.call_args.args[0])
        self.assertEqual(ids[:2], ["F8", "N24"])   # 키워드 일치 항목이 먼저
        self.assertEqual(len(ids), rag.TOP_K)
        self.assertEqual(res["sources"], [{"id": "N24", "category": "카드 제작"}])

    def test_used_ids_outside_retrieved_are_removed(self):
        self.ai.return_value = mock.Mock(text="답", cta="booking", used_ids=["F6", "N99", "F6", "N24", 7, "F8"])
        res = self.send("도입비 얼마예요?")
        self.assertEqual(res["sources"], [{"id": "F6", "category": "가격"}, {"id": "F8", "category": "가격"}])

    def test_no_used_ids_means_no_sources(self):
        res = self.send("도입비 얼마예요?")
        self.assertNotIn("sources", res)
        doc = self.db.chats.find_one({"conversation_id": "conv1"})
        self.assertNotIn("sources", doc["messages"][1])

    def test_sources_are_returned_and_saved(self):
        self.ai.return_value = fake_answer(used_ids=["F6", "F7"])
        res = self.send("도입비 얼마예요?")
        sources = [{"id": "F6", "category": "가격"}, {"id": "F7", "category": "가격"}]
        self.assertEqual(res, {"text": "도입비는 최초 1회 300,000원이에요.", "cta": "booking", "sources": sources})
        doc = self.db.chats.find_one({"conversation_id": "conv1"})
        self.assertEqual(doc["messages"][1]["sources"], sources)
        self.assertNotIn("sources", doc["messages"][0])

    def test_follow_up_question_also_searched_with_previous_question(self):
        self.send("카드 제작비 얼마예요?")
        self.embed.reset_mock()
        self.send("그건 언제 나와요? 010-1234-5678")
        texts = self.embed.call_args.args[0]
        self.assertEqual(len(texts), 2)   # 한 번 호출에 두 문장
        self.assertEqual(texts[1], "카드 제작비 얼마예요?\n" + texts[0])
        self.assertNotIn("010-1234-5678", str(texts))   # 임베딩에도 개인정보 가림

    def test_embedding_failure_uses_all_knowledge(self):
        req = httpx2.Request("POST", "https://api.openai.com/v1/embeddings")
        for err in (openai.APITimeoutError(request=req), RuntimeError("x")):
            self.embed.side_effect = err
            self.ai.return_value = fake_answer(used_ids=["N24"])
            C.limiter.reset()
            with self.assertLogs("uvicorn.error", "WARNING") as logs:
                res = self.send("사원증형이 뭐예요?")
            self.assertEqual(len(prompt_ids(self.ai.call_args.args[0])), len(FAQ_ITEMS))
            self.assertNotIn("sources", res)   # 전체 중에서 고른 id는 검증할 수 없어 표시하지 않음
            self.assertIn(type(err).__name__, logs.output[0])

    def test_not_searchable_uses_all_knowledge_without_embedding(self):
        self.ai.return_value = fake_answer(used_ids=["F6"])
        with mock.patch.object(C, "knowledge", rag.Knowledge(FAQ_ITEMS, None)):
            res = self.send("도입비 얼마예요?")
        self.embed.assert_not_called()
        self.assertNotIn("sources", res)
        self.assertEqual(len(prompt_ids(self.ai.call_args.args[0])), len(FAQ_ITEMS))


class KnowledgeFileTest(unittest.TestCase):
    """faq.json · faq_embeddings.json 불러오기 — 없거나 해시가 다르면 검색 없이 전체."""

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        p = mock.patch.object(rag, "EMBEDDINGS_PATH", rag.Path(self.dir.name) / "faq_embeddings.json")
        p.start()
        self.addCleanup(p.stop)
        self.items, self.digest = rag.load_faq()

    def write(self, **over):
        data = {"model": rag.EMBED_MODEL, "faq_hash": self.digest,
                "items": [{"id": x["id"], "vector": qvec({x["id"]: 1.0})} for x in self.items]}
        data.update(over)
        rag.EMBEDDINGS_PATH.write_text(json.dumps(data), encoding="utf-8")

    def test_faq_has_55_unique_items_with_fields(self):
        self.assertEqual(len(self.items), 55)
        self.assertEqual(len({x["id"] for x in self.items}), 55)
        for x in self.items:
            self.assertLessEqual({"id", "category", "question", "answer", "source"}, set(x))
            self.assertLessEqual(set(x), {"id", "category", "question", "alt_questions", "answer", "source"})
            self.assertTrue(all(x[k].strip() for k in ("id", "category", "question", "answer", "source")))
            alts = x.get("alt_questions", [])
            self.assertTrue(isinstance(alts, list) and all(isinstance(a, str) and a.strip() for a in alts), x["id"])
        by_id = {x["id"]: x for x in self.items}
        self.assertIn("사무용품, 출장(항공·숙박), 거래처 접대", by_id["F18"]["answer"])
        self.assertIn("유흥주점은 제한 업종", by_id["N27"]["answer"])
        self.assertIn("한 달에 얼마 내야 해요", by_id["F7"]["alt_questions"])

    def test_embed_text_includes_alt_questions(self):
        f7 = next(x for x in self.items if x["id"] == "F7")
        text = rag.embed_text(f7)
        self.assertTrue(text.startswith("[가격] 월 이용료는 얼마예요? / 한 달에 얼마 내야 해요"))
        self.assertTrue(text.endswith(f7["answer"]))
        f1 = next(x for x in self.items if x["id"] == "F1")   # 비슷한 표현 없는 항목
        self.assertEqual(rag.embed_text(f1), f"[서비스] {f1['question']}\n{f1['answer']}")

    def test_hash_ignores_crlf(self):
        raw = rag.FAQ_PATH.read_bytes().replace(b"\r\n", b"\n")
        self.assertEqual(rag.faq_hash(raw), rag.faq_hash(raw.replace(b"\n", b"\r\n")))

    def test_valid_file_is_searchable(self):
        self.write()
        self.assertTrue(rag.load_knowledge().searchable)

    def test_missing_file_falls_back_with_warning(self):
        with self.assertLogs("uvicorn.error", "WARNING"):
            kn = rag.load_knowledge()
        self.assertFalse(kn.searchable)
        self.assertEqual(len(kn.items), len(self.items))

    def test_hash_or_model_mismatch_falls_back_with_warning(self):
        for over in ({"faq_hash": "0" * 64}, {"model": "text-embedding-ada-002"}):
            self.write(**over)
            with self.assertLogs("uvicorn.error", "WARNING") as logs:
                self.assertFalse(rag.load_knowledge().searchable)
            self.assertIn("build_knowledge", logs.output[0])

    def test_keywords_skip_common_words_and_endings(self):
        kn = rag.Knowledge(self.items, None)
        self.assertEqual(kn.keyword_ids("사원증형이 뭐예요?"), {"F8", "N24"})
        for q in ("오늘 날씨 어때요?", "주식 추천해줘", "서울에서 부산 KTX 몇 시간 걸려요?"):
            self.assertEqual(kn.keyword_ids(q), set(), q)


if __name__ == "__main__":
    unittest.main()
