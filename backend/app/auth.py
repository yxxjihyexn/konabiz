"""로그인 공통 — 비밀번호 해시, JWT(httpOnly 쿠키), 다른 라우터에서 쓰는 의존성.

- 해시: pwdlib + Argon2 (FastAPI 공식 문서 권장). DB에는 users.password_hash만 저장
- 토큰: PyJWT HS256, 내용은 user_id · role · exp(만료)뿐
- 쿠키: HttpOnly · SameSite=Lax · Secure는 설정값(COOKIE_SECURE)

라우터에서 쓰기:
    from app.auth import require_login, require_admin

    @router.get("/something")
    def something(user: dict = Depends(require_login)): ...

    @router.get("/admin-only")
    def admin_only(user: dict = Depends(require_admin)): ...

비밀번호·해시·토큰은 로그와 응답에 넣지 않음.
"""
from datetime import datetime, timedelta, timezone

import jwt
from bson import ObjectId
from bson.errors import InvalidId
from fastapi import Depends, HTTPException, Request, Response
from pwdlib import PasswordHash
from pymongo.database import Database

from app.config import settings
from app.db import get_db

COOKIE_NAME = "kona_session"
ALGORITHM = "HS256"
BLOCKED_STATUSES = ("suspended", "revoked")
HOME_PAGE = {"admin": "admin.html", "employee": "employee.html"}

MSG_LOGIN_REQUIRED = "로그인이 필요합니다."
MSG_EXPIRED = "로그인이 만료되었습니다. 다시 로그인해주세요."
MSG_ADMIN_ONLY = "관리자만 이용할 수 있습니다."

# /api/auth/me 401에서 원인을 프론트에 알려 주는 헤더 (expired | required)
AUTH_ERROR_HEADER = "X-Auth-Error"

password_hash = PasswordHash.recommended()

# 없는 이메일·해시 없는 계정도 같은 시간이 걸리게 비교할 더미 해시 (계정 존재 여부 추측 방지)
DUMMY_HASH = password_hash.hash("kona-dummy-password-for-timing")


def hash_password(password: str) -> str:
    return password_hash.hash(password)


def verify_password(password: str, hashed: str | None) -> bool:
    """hashed가 없으면 더미 해시로 비교만 하고 False."""
    if not hashed:
        password_hash.verify(password, DUMMY_HASH)
        return False
    try:
        return password_hash.verify(password, hashed)
    except Exception:
        # 저장된 값이 해시 형식이 아니면 로그인 실패로 처리
        return False


# ---------- 토큰 ----------

def create_token(user_id, role: str, expires_minutes: float | None = None) -> str:
    minutes = settings.JWT_EXPIRE_MINUTES if expires_minutes is None else expires_minutes
    payload = {
        "user_id": str(user_id),
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=minutes),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=ALGORITHM)


def read_token(request: Request) -> tuple[str, dict | None]:
    """쿠키의 토큰 상태 → ("ok", payload) | ("expired", None) | ("invalid", None) | ("none", None)."""
    token = request.cookies.get(COOKIE_NAME)
    if not token or not settings.JWT_SECRET:
        return "none", None
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[ALGORITHM],
                             options={"require": ["exp", "user_id", "role"]})
    except jwt.ExpiredSignatureError:
        return "expired", None
    except jwt.InvalidTokenError:
        return "invalid", None
    if payload.get("role") not in HOME_PAGE:
        return "invalid", None
    return "ok", payload


# ---------- 쿠키 ----------

def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        COOKIE_NAME, token,
        max_age=settings.JWT_EXPIRE_MINUTES * 60,
        path="/", httponly=True, samesite="lax", secure=settings.COOKIE_SECURE,
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(COOKIE_NAME, path="/", httponly=True, samesite="lax", secure=settings.COOKIE_SECURE)


# ---------- 의존성 ----------

def authenticate(request: Request, db: Database) -> tuple[dict | None, str | None]:
    """쿠키 → DB 사용자. 실패하면 (None, "expired" | "required").

    토큰이 유효해도 DB에서 지워졌거나 정지·회수됐거나 역할이 바뀌었으면 로그인 안 된 것으로 봄.
    """
    state, payload = read_token(request)
    if state == "expired":
        return None, "expired"
    if state != "ok":
        return None, "required"
    try:
        user_id = ObjectId(payload["user_id"])
    except (InvalidId, TypeError):
        return None, "required"
    user = db.users.find_one({"_id": user_id}, {"password_hash": 0})
    if not user or user.get("status") in BLOCKED_STATUSES or user.get("role") != payload["role"]:
        return None, "required"
    return user, None


def auth_error(reason: str) -> HTTPException:
    msg = MSG_EXPIRED if reason == "expired" else MSG_LOGIN_REQUIRED
    return HTTPException(status_code=401, detail=msg, headers={AUTH_ERROR_HEADER: reason})


def require_login(request: Request, db: Database = Depends(get_db)) -> dict:
    """로그인 필요 — 로그인한 사용자 문서(password_hash 제외)를 돌려줌."""
    user, reason = authenticate(request, db)
    if user is None:
        raise auth_error(reason)
    return user


def require_admin(user: dict = Depends(require_login)) -> dict:
    """관리자만."""
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail=MSG_ADMIN_ONLY)
    return user
