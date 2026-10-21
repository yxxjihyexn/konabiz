"""챗봇 지식 임베딩 만들기 — app/knowledge/faq.json → app/knowledge/faq_embeddings.json

실행 (backend 폴더에서): python -m scripts.build_knowledge
- faq.json을 고친 뒤에는 꼭 다시 실행 (서버는 faq.json 해시가 다르면 검색 없이 지식 전체로 답함)
- OpenAI 임베딩 API를 한 번 호출 (항목 전체를 한 요청으로). 키는 backend/.env의 OPENAI_API_KEY
- 저장 후 서버를 다시 시작해야 새 임베딩을 씀
"""
import json
import sys

import openai

from app import rag
from app.config import settings

DIGITS = 6   # 벡터 소수 자릿수 — 파일 크기를 줄임 (검색 순위에는 영향 없음)


def main() -> int:
    if not settings.OPENAI_API_KEY:
        print("OPENAI_API_KEY가 비어 있어요 (backend/.env).")
        return 1
    items, digest = rag.load_faq()
    ids = [x["id"] for x in items]
    if len(set(ids)) != len(ids):
        print("faq.json에 같은 id가 있어요.")
        return 1

    client = openai.OpenAI(api_key=settings.OPENAI_API_KEY, timeout=60, max_retries=1)
    res = client.embeddings.create(model=rag.EMBED_MODEL, input=[rag.embed_text(x) for x in items])
    vectors = [d.embedding for d in sorted(res.data, key=lambda d: d.index)]

    data = {
        "model": rag.EMBED_MODEL,
        "faq_hash": digest,
        "dimensions": len(vectors[0]),
        "items": [{"id": i, "vector": [round(v, DIGITS) for v in vec]} for i, vec in zip(ids, vectors)],
    }
    rag.EMBEDDINGS_PATH.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    print(f"{len(items)}개 저장 — {rag.EMBEDDINGS_PATH.name} ({rag.EMBED_MODEL}, {data['dimensions']}차원)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
