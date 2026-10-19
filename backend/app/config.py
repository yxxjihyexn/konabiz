"""설정 — backend/.env를 읽고, 경로는 실행 위치(cwd)와 상관없이 이 파일 위치 기준으로 계산."""
import os
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent   # backend/
ROOT_DIR = BACKEND_DIR.parent                          # 프로젝트 루트 (HTML·CSS·JS)

load_dotenv(BACKEND_DIR / ".env")


class Settings:
    MONGODB_URI: str = os.getenv("MONGODB_URI", "")
    MONGODB_DB: str = os.getenv("MONGODB_DB", "konabiz")
    JWT_SECRET: str = os.getenv("JWT_SECRET", "")
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
    OPENAI_MODEL: str = os.getenv("OPENAI_MODEL", "gpt-4o-mini")


settings = Settings()
