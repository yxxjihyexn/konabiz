from fastapi import APIRouter

from app import db

router = APIRouter(tags=["health"])


@router.get("/health")
def health():
    # 서버는 DB와 상관없이 ok. DB 상세(주소·오류 내용)는 넣지 않음
    return {"status": "ok", "db": "ok" if db.ping() else "error"}
