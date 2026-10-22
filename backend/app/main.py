"""코나비즈 FastAPI 앱 — /api는 API, 나머지는 프론트 정적 파일.

실행 (backend 폴더에서): uvicorn app.main:app --reload --port 8000
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app import db
from app.routers import auth, chat, dashboard, health, me, members, ml, payments, reservations
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


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    # 기본 422 응답은 보낸 값(input)을 그대로 돌려줌 — 비밀번호가 섞일 수 있어 위치·종류만
    errors = [{"loc": e["loc"], "msg": e["msg"], "type": e["type"]} for e in exc.errors()]
    return JSONResponse(status_code=422, content={"detail": errors})


# API 라우터
API_ROUTERS = [
    health.router,
    auth.router,
    reservations.router,
    members.router,
    dashboard.router,
    me.router,
    chat.router,
    ml.router,
    payments.router,
]
for api_router in API_ROUTERS:
    app.include_router(api_router, prefix="/api")

# 정적 파일은 모든 경로를 받으므로 반드시 마지막에 붙임 (/api가 먼저 처리됨)
app.include_router(static_router)
