"""로그인 API — /api/auth/login · logout · me.

회원가입·비밀번호 찾기는 없음 (관리자 계정은 계약 후 발급, 임직원은 관리자가 초대).
"""
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from pymongo.database import Database

from app import auth
from app.config import settings
from app.db import get_db

router = APIRouter(prefix="/auth", tags=["auth"])

MSG_INVALID = "이메일 또는 비밀번호가 올바르지 않습니다."
MSG_BLOCKED = "이용이 중지된 계정입니다. 회사 관리자에게 문의해주세요."


class LoginIn(BaseModel):
    email: str = Field(max_length=320)
    password: str = Field(max_length=1024)


@router.post("/login")
def login(body: LoginIn, response: Response, db: Database = Depends(get_db)):
    if not settings.JWT_SECRET:
        raise HTTPException(status_code=503, detail="login unavailable")

    email = body.email.strip().lower()
    user = db.users.find_one({"email": email}) if email else None

    # 이메일 없음 · 해시 없음 · 비밀번호 틀림 → 모두 같은 401 (어느 쪽인지 알 수 없게)
    if not auth.verify_password(body.password, user.get("password_hash") if user else None):
        raise HTTPException(status_code=401, detail=MSG_INVALID)

    # 정지·회수 안내는 비밀번호가 맞을 때만
    if user.get("status") in auth.BLOCKED_STATUSES:
        raise HTTPException(status_code=403, detail=MSG_BLOCKED)

    # 초대받은 임직원의 첫 로그인 → 사용 중
    if user["role"] == "employee" and user.get("status") == "invited":
        db.users.update_one({"_id": user["_id"], "status": "invited"}, {"$set": {"status": "active"}})

    auth.set_session_cookie(response, auth.create_token(user["_id"], user["role"]))
    # 모달에서 고른 탭과 상관없이 실제 역할의 화면으로
    return {"name": user["name"], "role": user["role"], "redirect": auth.HOME_PAGE[user["role"]]}


@router.post("/logout")
def logout(response: Response):
    auth.clear_session_cookie(response)
    return {"ok": True}


@router.get("/me")
def me(request: Request, db: Database = Depends(get_db)):
    user, reason = auth.authenticate(request, db)
    if user is None:
        # 정지·삭제된 계정의 쿠키도 여기서 지움 (X-Auth-Error: expired | required)
        err = auth.auth_error(reason)
        res = JSONResponse(status_code=401, content={"detail": err.detail}, headers=err.headers)
        auth.clear_session_cookie(res)
        return res
    return {
        "name": user["name"], "email": user["email"], "role": user["role"],
        "company": user.get("company"), "dept": user.get("dept"),
    }
