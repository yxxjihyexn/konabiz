"""정적 페이지 서빙 — 프로젝트 루트의 프론트 파일을 그대로 제공.

허용 목록 방식: 루트의 *.html · *.css, assets/ · js/ 아래 파일만 연다.
그 밖(backend/, .git/, .env, 점으로 시작하는 파일·폴더, *.md 등)은 모두 404.
없는 경로도 404 (index.html로 돌리지 않음).

admin.html · admin-members.html · employee.html은 로그인·역할 확인 (guard_page).
"""
import mimetypes
import re
from pathlib import PurePosixPath

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, RedirectResponse

from app import auth
from app.config import ROOT_DIR

router = APIRouter()

ROOT_SUFFIXES = {".html", ".css"}
ASSET_DIRS = {"assets", "js"}

# 경로 한 칸: 영문·숫자로 시작, 확장자는 하나까지.
# 점으로 시작(.git, .env), "..", "~"(8.3 짧은 이름), ":"(::$DATA), 끝의 점·공백 같은
# Windows에서 다른 파일로 풀리는 변형을 여기서 모두 막음.
SEGMENT = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]*(\.[A-Za-z0-9]+)?")

# Windows 레지스트리에 따라 .js가 text/plain으로 잡히는 경우가 있어 직접 정함
MEDIA_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
}


def resolve_public_file(path: str):
    """URL 경로 → 열어도 되는 실제 파일. 아니면 None."""
    if path == "":
        path = "index.html"
    parts = path.split("/")
    if not all(SEGMENT.fullmatch(p) for p in parts):
        return None

    if len(parts) == 1:
        base = ROOT_DIR
        if PurePosixPath(parts[0]).suffix not in ROOT_SUFFIXES:
            return None
    elif parts[0] in ASSET_DIRS:
        base = ROOT_DIR / parts[0]
    else:
        return None

    file = ROOT_DIR.joinpath(*parts).resolve()
    if not file.is_relative_to(base.resolve()) or not file.is_file():
        return None
    return file


# 로그인해야 열리는 페이지 → 필요한 역할. 나머지(index·sandbox·css·js·assets)는 공개
PROTECTED_PAGES = {"admin.html": "admin", "admin-members.html": "admin", "employee.html": "employee"}
# ?sandbox=1이면 비로그인 체험용으로 공개 (sandbox.html의 iframe)
SANDBOX_PAGES = {"admin.html", "employee.html"}

LOGIN_URL = "/index.html?login=1"
EXPIRED_URL = "/index.html?login=1&expired=1"


def guard_page(name: str, request: Request):
    """보호 페이지면 들어갈 수 있는지 판단 — 막히면 RedirectResponse, 통과하면 None.

    토큰(서명·만료·역할)만 봄. 정지·삭제 같은 DB 상태는 페이지의 /api/auth/me가 확인.
    """
    need = PROTECTED_PAGES.get(name)
    if need is None:
        return None
    if name in SANDBOX_PAGES and request.query_params.get("sandbox") == "1":
        return None

    state, payload = auth.read_token(request)
    if state == "ok":
        if payload["role"] == need:
            return None
        return RedirectResponse("/" + auth.HOME_PAGE[payload["role"]], status_code=303)

    res = RedirectResponse(EXPIRED_URL if state == "expired" else LOGIN_URL, status_code=303)
    if state != "none":
        auth.clear_session_cookie(res)
    return res


@router.api_route("/{path:path}", methods=["GET", "HEAD"], include_in_schema=False)
def static_file(path: str, request: Request):
    file = resolve_public_file(path)
    if file is None:
        raise HTTPException(status_code=404)

    # Windows는 대소문자를 구분하지 않으므로(ADMIN.HTML) 소문자로 비교
    name = file.name.lower()
    blocked = guard_page(name, request)
    if blocked is not None:
        return blocked

    media_type = MEDIA_TYPES.get(file.suffix) or mimetypes.guess_type(file.name)[0]
    res = FileResponse(file, media_type=media_type)
    if name in PROTECTED_PAGES:
        # 로그아웃 뒤 뒤로 가기로 캐시된 화면이 보이지 않게
        res.headers["Cache-Control"] = "no-store"
    return res
