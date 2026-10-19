"""코나비즈 FastAPI 앱 — /api는 API, 나머지는 프론트 정적 파일.

실행 (backend 폴더에서): uvicorn app.main:app --reload --port 8000
"""
from fastapi import FastAPI

from app.routers import health
from app.static_site import router as static_router

app = FastAPI(
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
