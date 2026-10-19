"""MongoDB 연결 — 앱 시작 시 한 번 연결하고 종료 시 닫음 (main.py의 lifespan).

라우터에서 쓰기:
    from fastapi import Depends
    from pymongo.database import Database
    from app.db import get_db

    @router.get("/something")
    def something(db: Database = Depends(get_db)):
        db.users.find_one(...)

MONGODB_URI가 비어 있거나 접속에 실패해도 서버(정적 페이지)는 켜짐.
로그에는 오류 종류만 남김 — 접속 주소·계정이 섞일 수 있어 예외 메시지는 출력하지 않음.
"""
import logging

from fastapi import HTTPException
from pymongo import MongoClient
from pymongo.database import Database

from app.config import settings

log = logging.getLogger("uvicorn.error")

TIMEOUT_MS = 3000

_client: MongoClient | None = None


def connect() -> None:
    global _client
    if not settings.MONGODB_URI:
        log.warning("MongoDB: MONGODB_URI가 비어 있어 DB 없이 시작합니다")
        return
    try:
        # mongodb+srv 주소는 여기서 DNS 조회를 하므로 생성 자체가 실패할 수 있음
        _client = MongoClient(
            settings.MONGODB_URI,
            serverSelectionTimeoutMS=TIMEOUT_MS,
            connectTimeoutMS=TIMEOUT_MS,
            tz_aware=True,
        )
        _client.admin.command("ping")
        log.info("MongoDB: 연결됨 (DB: %s)", settings.MONGODB_DB)
    except Exception as e:
        # 클라이언트는 남겨 둠 — 일시적인 네트워크 문제면 다음 요청에서 다시 붙음
        log.warning("MongoDB: 연결 실패 (%s) — DB 없이 시작합니다", type(e).__name__)


def close() -> None:
    global _client
    if _client is not None:
        _client.close()
        _client = None


def ping() -> bool:
    """/api/health용 — 지금 DB에 닿는지."""
    if _client is None:
        return False
    try:
        _client.admin.command("ping")
        return True
    except Exception:
        return False


def get_db() -> Database:
    """FastAPI 의존성. DB가 없으면 503."""
    if _client is None:
        raise HTTPException(status_code=503, detail="database unavailable")
    return _client[settings.MONGODB_DB]
