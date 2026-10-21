"""가맹점 판별 API — POST /api/ml/classify (랜딩 · 마이페이지 · 대시보드 판별기).

- 로그인 없이 씀 (랜딩은 비로그인 체험, Sandbox도 실제 API). DB를 읽거나 쓰지 않음
- 입력: {name} 앞뒤 공백 제거 → 빈 값 · 50자 초과 422
- 응답: {category, confidence, industry, source: model|rule, level: block|warn|high|low}
  level은 서버가 ml_rules 기준값으로 계산 — 화면은 level만 보고 그림
- 모델은 서버 시작 시 한 번만 불러옴. 파일이 없으면 서버는 켜지고 이 API만 503
- 사용량 제한: 같은 IP 1분 30회 → 429 (챗봇과 같은 메모리 방식, 한도는 따로)
"""
import logging

from fastapi import APIRouter, Body, HTTPException, Request

from app import ml_rules as M
from app.routers.chat import RateLimiter

log = logging.getLogger("uvicorn.error")

router = APIRouter(prefix="/ml", tags=["ml"])

MSG_EMPTY = "가맹점 이름을 입력해주세요."
MSG_TOO_LONG = f"가맹점 이름은 {M.NAME_MAX_LEN}자까지 입력할 수 있어요."
MSG_RATE = "잠시 후 다시 판별해주세요."
MSG_UNAVAILABLE = "지금은 판별할 수 없어요. 잠시 후 다시 시도해주세요."

RATE_IP = 30   # 같은 IP가 1분 안에 보낼 수 있는 수

limiter = RateLimiter()

# 서버 시작 시 한 번 불러옴
model = M.load_model()
if model is None:
    log.warning("가맹점 판별: 모델 파일이 없어 /api/ml/classify는 503 (%s)", M.MODEL_PATH.name)


@router.post("/classify")
def classify(request: Request, body: dict = Body(...)):
    name = body.get("name")
    name = name.strip() if isinstance(name, str) else ""
    if not name:
        raise HTTPException(status_code=422, detail=MSG_EMPTY)
    if len(name) > M.NAME_MAX_LEN:
        raise HTTPException(status_code=422, detail=MSG_TOO_LONG)

    ip = request.client.host if request.client else "unknown"
    if not limiter.allow([("ip:" + ip, RATE_IP)]):
        raise HTTPException(status_code=429, detail=MSG_RATE)

    if model is None:
        raise HTTPException(status_code=503, detail=MSG_UNAVAILABLE)
    try:
        return M.judge(model, name)
    except Exception as e:
        log.warning("가맹점 판별 실패 (%s)", type(e).__name__)
        raise HTTPException(status_code=503, detail=MSG_UNAVAILABLE)
