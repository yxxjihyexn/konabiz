"""챗봇 API — POST /api/chat (하이브리드: 빠른 답변은 규칙, 직접 입력은 OpenAI).

- 로그인 없이 씀. uid = 로그인했으면 users._id 문자열, 아니면 anon_id (localStorage 임시 ID)
- 빠른 답변(quick_reply_id)은 chat_rules.ANSWERS 그대로 — OpenAI 호출 없음
- 직접 입력: 질문을 임베딩해 관련 지식 상위 5개만 찾음(app/rag.py) → 시스템 프롬프트(규칙 + 그 5개) + 같은 대화의
  최근 6개 메시지 → {text, cta, used_ids} 구조화 응답을 서버에서 다시 검증 → {text, cta, sources}
  · 1위 유사도가 rag.THRESHOLD 미만이고 키워드 일치도 없으면 [참고 지식: 관련 지식 없음]으로 호출 (규칙대로 상담·범위 안내, sources 없음)
  · 임베딩 파일 없음·해시 불일치·임베딩 API 실패 → 검색 없이 지식 전체를 넣음 (화면 오류 없음, sources 없음 —
    전체 중에서는 비슷한 id(F24·N24)를 잘못 고르는 경우가 있어 검증할 수 없음)
  · used_ids는 검색해서 프롬프트에 넣은 항목 안에 있는 것만 sources로 (빠른 답변·대체 답변은 sources 없음)
  OpenAI에는 사용자 이름·이메일을 보내지 않고, 질문 안의 이메일·전화번호·카드번호 형태는 가려서 보냄
- OpenAI 실패·타임아웃·키 없음 → chat_rules.FALLBACK (오류 문구로 끝내지 않음). 로그에는 오류 종류만
- 사용량 제한: 같은 uid 1분 10회 · 같은 IP 1분 30회 → 429 (서버 메모리 기준, 재시작하면 초기화)
- 질문과 답변을 chats에 저장 ({uid, conversation_id}). DB가 없으면 답변만 하고 저장은 건너뜀
API 키는 이 서버에서만 씀 — 응답·로그에 넣지 않음.
"""
import logging
import re
import threading
import time
import uuid
from collections import deque
from datetime import datetime, timezone
from typing import Literal

import openai
from fastapi import APIRouter, Body, Depends, HTTPException, Request
from pydantic import BaseModel
from pymongo.database import Database
from pymongo.errors import DuplicateKeyError, PyMongoError

from app import auth
from app import chat_rules as CR
from app import rag
from app.config import settings
from app.db import get_db

log = logging.getLogger("uvicorn.error")

router = APIRouter(prefix="/chat", tags=["chat"])

MSG_EMPTY = "질문을 입력해주세요."
MSG_TOO_LONG = "질문은 500자까지 입력할 수 있어요."
MSG_INVALID = "대화 정보를 확인할 수 없어요. 새 대화를 시작해주세요."
MSG_RATE = "잠시 후 다시 질문해주세요."

MAX_LEN = 500              # chatbot.js MAX_LEN과 같음
ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
HISTORY = 6                # OpenAI에 보내는 같은 대화의 최근 메시지 수
MAX_TOKENS = 300
ANSWER_MAX = 600           # 서버 검증 — 이보다 길면 자름
TIMEOUT = 15               # 초. chatbot.js TIMEOUT(20초)보다 짧게
EMBED_TIMEOUT = 5          # 초. 질문 임베딩 — 넘으면 지식 전체로 답함

RATE_WINDOW = 60           # 초
RATE_UID = 10              # 같은 uid가 RATE_WINDOW 안에 보낼 수 있는 수
RATE_IP = 30               # 같은 IP (anon_id를 바꿔가며 보내는 경우 대비)


# ---------- 사용량 제한 (메모리) ----------

class RateLimiter:
    def __init__(self):
        self._hits: dict[str, deque] = {}
        self._lock = threading.Lock()

    def allow(self, keys_limits: list[tuple[str, int]], now: float | None = None) -> bool:
        """모든 키가 한도 안이면 기록하고 True. 하나라도 넘으면 기록 없이 False."""
        now = time.monotonic() if now is None else now
        with self._lock:
            queues = []
            for key, limit in keys_limits:
                q = self._hits.setdefault(key, deque())
                while q and now - q[0] >= RATE_WINDOW:
                    q.popleft()
                if len(q) >= limit:
                    return False
                queues.append(q)
            for q in queues:
                q.append(now)
            return True

    def reset(self):
        with self._lock:
            self._hits.clear()


limiter = RateLimiter()


# ---------- OpenAI ----------

class ChatAnswer(BaseModel):
    """OpenAI 구조화 응답 형식."""
    text: str
    cta: Literal["booking", "simulator", "none"]
    used_ids: list[str]


_client: openai.OpenAI | None = None
_client_key = ""
_client_lock = threading.Lock()


def _openai_client() -> openai.OpenAI:
    global _client, _client_key
    with _client_lock:
        if _client is None or _client_key != settings.OPENAI_API_KEY:
            _client = openai.OpenAI(api_key=settings.OPENAI_API_KEY, timeout=TIMEOUT, max_retries=0)
            _client_key = settings.OPENAI_API_KEY
        return _client


def call_openai(messages: list[dict]) -> ChatAnswer | None:
    """OpenAI 한 번 호출. 거절·형식 오류면 None. (테스트에서 이 함수를 가짜로 바꿈)"""
    log.info("챗봇: OpenAI 호출")
    completion = _openai_client().chat.completions.parse(
        model=settings.OPENAI_MODEL,
        messages=messages,
        response_format=ChatAnswer,
        max_completion_tokens=MAX_TOKENS,
        temperature=0.2,
    )
    msg = completion.choices[0].message
    return None if msg.refusal else msg.parsed


def call_embedding(texts: list[str]) -> list[list[float]]:
    """질문 임베딩 한 번 호출 (여러 문장을 한 번에). (테스트에서 이 함수를 가짜로 바꿈)"""
    log.info("챗봇: 임베딩 호출")
    res = _openai_client().with_options(timeout=EMBED_TIMEOUT).embeddings.create(model=rag.EMBED_MODEL, input=texts)
    return [d.embedding for d in sorted(res.data, key=lambda d: d.index)]


# 서버 시작 시 한 번 불러옴 (faq.json + faq_embeddings.json)
knowledge = rag.load_knowledge()


def retrieve(question: str, history: list[dict]) -> tuple[list[dict], bool]:
    """([참고 지식]에 넣을 항목, 검색했는지) — 상위 5개 · 1위 유사도가 기준값 미만이고 키워드 일치도 없으면 []
    · 검색할 수 없으면 전체(검색 안 함).
    직전 사용자 질문이 있으면 '직전 질문 + 이번 질문'도 같이 임베딩해서 더 높은 점수를 씀 ("그건 얼마예요?" 같은 이어지는 질문)."""
    if not knowledge.searchable:
        return knowledge.items, False
    texts = [question]
    prev = next((m.get("text") for m in reversed(history) if m.get("from") == "user"), None)
    if isinstance(prev, str) and prev.strip():
        texts.append(mask_personal(prev) + "\n" + question)
    try:
        vecs = call_embedding(texts)
        if len(vecs) != len(texts):
            raise ValueError("embedding count")
        hits = knowledge.keyword_ids(question)
        top = knowledge.search(vecs, hits)
    except Exception as e:
        log.warning("챗봇: 임베딩 실패 (%s) — 지식 전체로 답함", type(e).__name__)
        return knowledge.items, False
    best = max((score for score, _ in top), default=0.0)
    log.info("챗봇: 검색 %s · 키워드 %s", " ".join(f"{x['id']}={score:.3f}" for score, x in top), sorted(hits) or "-")
    if best < rag.THRESHOLD and not hits:
        return [], True
    return [x for _, x in top], True


EMAIL_RE = re.compile(r"[^\s@]+@[^\s@]+\.[^\s@]+")
CARD_RE = re.compile(r"\b(?:\d[ -]?){13,19}\b")
PHONE_RE = re.compile(r"\b0\d{1,2}[ -]?\d{3,4}[ -]?\d{4}\b")


def mask_personal(text: str) -> str:
    """OpenAI로 보내기 전에 개인정보 형태를 가림."""
    text = EMAIL_RE.sub("[이메일]", text)
    text = CARD_RE.sub("[카드번호]", text)
    return PHONE_RE.sub("[전화번호]", text)


ENDING_RE = re.compile(r"이어요")


def fix_endings(text: str) -> str:
    """'300,000원이어요' → '300,000원이에요'. 프롬프트로 막아도 gpt-4o-mini가 자주 써서 서버에서 고침
    (이 서비스 답변에서 '이어요'는 '이다'의 어미로만 나옴)."""
    return ENDING_RE.sub("이에요", text)


def clean_answer(raw, allowed: list[dict] | None = None) -> dict | None:
    """구조화 응답 검증 — text가 비면 None, cta가 목록 밖이면 none,
    used_ids는 프롬프트에 넣은 항목(allowed) 안의 id만 sources로 (순서 유지, 중복 제거)."""
    text = getattr(raw, "text", None) if raw is not None else None
    if not isinstance(text, str) or not text.strip():
        return None
    text = fix_endings(text.strip())
    if len(text) > ANSWER_MAX:
        text = text[:ANSWER_MAX].rstrip() + "…"
    cta = getattr(raw, "cta", None)
    if cta not in CR.CTAS:
        cta = "none"
    answer = {"text": text, "cta": None if cta == "none" else cta}
    by_id = {x["id"]: x for x in (allowed or [])}
    used = getattr(raw, "used_ids", None)
    sources, seen = [], set()
    for i in used if isinstance(used, list) else []:
        if isinstance(i, str) and i in by_id and i not in seen:
            seen.add(i)
            sources.append({"id": i, "category": by_id[i]["category"]})
    if sources:
        answer["sources"] = sources
    return answer


def ai_answer(message: str, history: list[dict]) -> dict:
    if not settings.OPENAI_API_KEY:
        log.warning("챗봇: OPENAI_API_KEY가 비어 있어 대체 답변")
        return dict(CR.FALLBACK)
    items, searched = retrieve(mask_personal(message), history)
    messages = [{"role": "system", "content": CR.system_prompt(items)}]
    for m in history:
        role = "user" if m.get("from") == "user" else "assistant"
        messages.append({"role": role, "content": mask_personal(str(m.get("text", "")))})
    messages.append({"role": "user", "content": mask_personal(message)})
    try:
        answer = clean_answer(call_openai(messages), items if searched else None)
    except Exception as e:
        # 예외 메시지에 요청 내용이 섞일 수 있어 종류만
        log.warning("챗봇: OpenAI 실패 (%s) — 대체 답변", type(e).__name__)
        return dict(CR.FALLBACK)
    if answer is None:
        log.warning("챗봇: OpenAI 응답 형식 오류 — 대체 답변")
        return dict(CR.FALLBACK)
    return answer


# ---------- DB ----------

def optional_db() -> Database | None:
    """챗봇은 DB 없이도 답함 (저장·맥락·로그인 확인만 건너뜀)."""
    try:
        return get_db()
    except HTTPException:
        return None


def load_history(db: Database | None, uid: str, conversation_id: str) -> list[dict]:
    if db is None:
        return []
    try:
        doc = db.chats.find_one({"uid": uid, "conversation_id": conversation_id},
                                {"messages": {"$slice": -HISTORY}})
    except PyMongoError as e:
        log.warning("챗봇: 대화 불러오기 실패 (%s)", type(e).__name__)
        return []
    return (doc or {}).get("messages", [])


def save_turn(db: Database | None, uid: str, conversation_id: str, question: dict, answer: dict) -> None:
    if db is None:
        return
    now = datetime.now(timezone.utc)
    q = {"id": uuid.uuid4().hex, "from": "user", "text": question["text"], "created_at": now}
    if question.get("quick"):
        q["quick_reply_id"] = question["quick"]
    a = {"id": uuid.uuid4().hex, "from": "bot", "text": answer["text"], "created_at": now}
    if answer.get("cta"):
        a["cta"] = answer["cta"]
    if answer.get("sources"):
        a["sources"] = answer["sources"]
    try:
        db.chats.update_one(
            {"uid": uid, "conversation_id": conversation_id},
            {"$push": {"messages": {"$each": [q, a]}}, "$set": {"updated_at": now}, "$setOnInsert": {"created_at": now}},
            upsert=True,
        )
    except DuplicateKeyError:
        # 다른 uid의 대화 ID — 남의 대화에 붙이지 않음
        log.warning("챗봇: 다른 사용자의 conversation_id라 저장하지 않음")
    except PyMongoError as e:
        log.warning("챗봇: 대화 저장 실패 (%s)", type(e).__name__)


# ---------- API ----------

def _id(body: dict, key: str) -> str | None:
    v = body.get(key)
    return v if isinstance(v, str) and ID_RE.match(v) else None


@router.post("")
def chat(request: Request, body: dict = Body(...), db: Database | None = Depends(optional_db)):
    message = body.get("message")
    message = message.strip() if isinstance(message, str) else ""
    if not message:
        raise HTTPException(status_code=422, detail=MSG_EMPTY)
    if len(message) > MAX_LEN:
        raise HTTPException(status_code=422, detail=MSG_TOO_LONG)

    quick = body.get("quick_reply_id")
    if quick is not None and quick not in CR.ANSWERS:
        raise HTTPException(status_code=422, detail=MSG_INVALID)
    conversation_id = _id(body, "conversation_id")
    if conversation_id is None:
        raise HTTPException(status_code=422, detail=MSG_INVALID)

    user = None
    if db is not None:
        try:
            user = auth.authenticate(request, db)[0]
        except PyMongoError as e:
            log.warning("챗봇: 로그인 확인 실패 (%s) — 비로그인으로 처리", type(e).__name__)
    if user is not None:
        uid = str(user["_id"])
    else:
        uid = _id(body, "anon_id")
        if uid is None:
            raise HTTPException(status_code=422, detail=MSG_INVALID)

    ip = request.client.host if request.client else "unknown"
    if not limiter.allow([("uid:" + uid, RATE_UID), ("ip:" + ip, RATE_IP)]):
        raise HTTPException(status_code=429, detail=MSG_RATE)

    if quick:
        answer = dict(CR.ANSWERS[quick])
    else:
        answer = ai_answer(message, load_history(db, uid, conversation_id))

    save_turn(db, uid, conversation_id, {"text": message, "quick": quick}, answer)
    res = {"text": answer["text"], "cta": answer.get("cta")}
    if answer.get("sources"):
        res["sources"] = answer["sources"]
    return res
