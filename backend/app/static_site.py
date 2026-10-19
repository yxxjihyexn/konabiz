"""정적 페이지 서빙 — 프로젝트 루트의 프론트 파일을 그대로 제공.

허용 목록 방식: 루트의 *.html · *.css, assets/ · js/ 아래 파일만 연다.
그 밖(backend/, .git/, .env, 점으로 시작하는 파일·폴더, *.md 등)은 모두 404.
없는 경로도 404 (index.html로 돌리지 않음).
"""
import mimetypes
import re
from pathlib import PurePosixPath

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

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


@router.api_route("/{path:path}", methods=["GET", "HEAD"], include_in_schema=False)
def static_file(path: str):
    file = resolve_public_file(path)
    if file is None:
        raise HTTPException(status_code=404)
    media_type = MEDIA_TYPES.get(file.suffix) or mimetypes.guess_type(file.name)[0]
    return FileResponse(file, media_type=media_type)
