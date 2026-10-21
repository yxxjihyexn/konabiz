"""챗봇 지식 검색 (RAG) — knowledge/faq.json + 미리 계산한 임베딩(faq_embeddings.json).

- 지식이 수십 개라 벡터 DB 없이 표준 라이브러리로 코사인 유사도를 계산함
- 임베딩 파일은 scripts/build_knowledge.py로 만듦. 파일이 없거나 faq.json 해시·모델이 다르면
  경고 로그 + 검색 없이 지식 전체를 프롬프트에 넣음 (routers/chat.py)
- 질문 임베딩은 routers/chat.py가 OpenAI로 계산해서 search()에 넘김
"""
import hashlib
import json
import logging
import math
import re
from collections import defaultdict
from pathlib import Path

log = logging.getLogger("uvicorn.error")

KNOWLEDGE_DIR = Path(__file__).resolve().parent / "knowledge"
FAQ_PATH = KNOWLEDGE_DIR / "faq.json"
EMBEDDINGS_PATH = KNOWLEDGE_DIR / "faq_embeddings.json"

EMBED_MODEL = "text-embedding-3-small"
TOP_K = 5
# 1위 유사도가 이보다 낮고 키워드 일치도 없으면 "관련 지식 없음" — 근거는 README "챗봇 지식·RAG" (관련·무관 질문 시험)
THRESHOLD = 0.40

# 키워드 일치 — "사원증형이 뭐예요?"처럼 짧은 질문은 임베딩 점수가 낮게 나와서, 지식에만 있는 낱말이 질문에 들어 있으면
# 관련 있음으로 보고 그 항목을 먼저 넣음. 낱말 = 3글자 이상 · 3개 항목 이하에만 나옴 · "~요"·"~면"으로 끝나지 않음(서술어 제외)
KEYWORD_MIN_LEN = 3
KEYWORD_MAX_ITEMS = 3
JOSA = sorted(("은", "는", "이", "가", "을", "를", "에", "에서", "으로", "로", "와", "과", "도", "만", "의",
               "까지", "부터", "이고", "하고"), key=len, reverse=True)
WORD_RE = re.compile(r"[가-힣A-Za-z0-9]+")


def faq_hash(raw: bytes) -> str:
    """줄바꿈을 LF로 맞춰서 계산 — Windows에서 git이 CRLF로 바꿔 받아도 같은 해시."""
    return hashlib.sha256(raw.replace(b"\r\n", b"\n")).hexdigest()


def load_faq() -> tuple[list[dict], str]:
    raw = FAQ_PATH.read_bytes()
    return json.loads(raw.decode("utf-8")), faq_hash(raw)


def questions_of(item: dict) -> list[str]:
    """대표 질문 + 비슷한 질문 표현(alt_questions, 없어도 됨)."""
    return [item["question"], *item.get("alt_questions", [])]


def embed_text(item: dict) -> str:
    """지식 항목을 임베딩할 문장 — 카테고리 · 질문(비슷한 표현 포함) · 답변."""
    return f"[{item['category']}] {' / '.join(questions_of(item))}\n{item['answer']}"


def normalize(vec: list[float]) -> list[float]:
    n = math.sqrt(sum(x * x for x in vec)) or 1.0
    return [x / n for x in vec]


def dot(a: list[float], b: list[float]) -> float:
    return sum(x * y for x, y in zip(a, b))


def terms_of(text: str) -> set[str]:
    """낱말과 조사를 뗀 낱말 (3글자 이상만)."""
    out = set()
    for w in WORD_RE.findall(text):
        out.add(w)
        for j in JOSA:
            if w.endswith(j) and len(w) - len(j) >= 2:
                out.add(w[: -len(j)])
                break
    return {t for t in out if len(t) >= KEYWORD_MIN_LEN}


def build_keywords(items: list[dict]) -> dict[str, set[str]]:
    """낱말 → 그 낱말이 나오는 항목 id. 여러 항목에 흔히 나오는 낱말·서술어·숫자만인 낱말은 뺌."""
    found = defaultdict(set)
    for x in items:
        for t in terms_of(" ".join(questions_of(x)) + " " + x["answer"]):
            found[t].add(x["id"])
    return {t: ids for t, ids in found.items()
            if len(ids) <= KEYWORD_MAX_ITEMS and not t.endswith(("요", "면")) and not t.isdigit()}


class Knowledge:
    """지식 목록 + (있으면) 정규화한 벡터. vectors가 None이면 검색 없이 전체 사용."""

    def __init__(self, items: list[dict], vectors: dict[str, list[float]] | None):
        self.items = items
        self.by_id = {x["id"]: x for x in items}
        self.vectors = vectors
        self.keywords = build_keywords(items)

    @property
    def searchable(self) -> bool:
        return self.vectors is not None

    def keyword_ids(self, question: str) -> set[str]:
        """질문 안에 들어 있는 지식 낱말의 항목 id."""
        return {i for t, ids in self.keywords.items() if t in question for i in ids}

    def search(self, query_vecs: list[list[float]], hits: set[str] = frozenset(), k: int = TOP_K) -> list[tuple[float, dict]]:
        """상위 k개 [(유사도, 항목)] — 키워드 일치 항목을 먼저, 그다음 유사도 높은 순.
        질문 벡터가 여러 개면 항목마다 가장 높은 점수."""
        qs = [normalize(q) for q in query_vecs]
        scored = [(max(dot(q, self.vectors[x["id"]]) for q in qs), x) for x in self.items]
        scored.sort(key=lambda s: (s[1]["id"] in hits, s[0]), reverse=True)
        return scored[:k]


def load_knowledge() -> Knowledge:
    items, digest = load_faq()
    try:
        data = json.loads(EMBEDDINGS_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError:
        log.warning("챗봇 지식: %s 없음 — 검색 없이 지식 전체 사용 (scripts/build_knowledge.py 실행 필요)", EMBEDDINGS_PATH.name)
        return Knowledge(items, None)
    except (OSError, ValueError) as e:
        log.warning("챗봇 지식: 임베딩 파일 읽기 실패 (%s) — 검색 없이 지식 전체 사용", type(e).__name__)
        return Knowledge(items, None)
    if data.get("faq_hash") != digest or data.get("model") != EMBED_MODEL:
        log.warning("챗봇 지식: faq.json이 임베딩 파일과 달라요 — 검색 없이 지식 전체 사용 (scripts/build_knowledge.py 다시 실행)")
        return Knowledge(items, None)
    vectors = {v["id"]: normalize(v["vector"]) for v in data.get("items", [])}
    if set(vectors) != {x["id"] for x in items}:
        log.warning("챗봇 지식: 임베딩 항목이 faq.json과 맞지 않아요 — 검색 없이 지식 전체 사용")
        return Knowledge(items, None)
    log.info("챗봇 지식: %d개 · 검색 사용", len(items))
    return Knowledge(items, vectors)
