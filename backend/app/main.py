"""코나비즈 FastAPI 앱 — /api는 API, 나머지는 프론트 정적 파일.

실행 (backend 폴더에서): uvicorn app.main:app --reload --port 8000
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app import db
from app.routers import health
from app.static_site import router as static_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.connect()   # 실패해도 예외를 올리지 않음 — 정적 페이지는 계속 제공
    yield
    db.close()


app = FastAPI(
    lifespan=lifespan,
    title="KonaBiz API",
    docs_url="/api/docs",
    redoc_url=None,
    openapi_url="/api/openapi.json",
)

# API 라우터 — 다음 단계: auth, reservations, users, chat을 여기에 추가
API_ROUTERS = [
    health.router,
]
for api_router in API_ROUTERS:
    app.include_router(api_router, prefix="/api")

# 정적 파일은 모든 경로를 받으므로 반드시 마지막에 붙임 (/api가 먼저 처리됨)
app.include_router(static_router)
