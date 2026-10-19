# 코나비즈

## 백엔드 실행

FastAPI 서버 하나(8000 포트)가 프론트 페이지와 `/api`를 같이 제공합니다. Python 3.12 기준, `backend` 폴더에서 실행합니다.

```powershell
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
uvicorn app.main:app --reload --port 8000
```

- 브라우저: http://localhost:8000/ (상태 확인: http://localhost:8000/api/health)
- 비밀값은 `backend/.env`에만 적고 커밋하지 않습니다.
- 외장하드의 드라이브 문자가 바뀌면 `.venv`가 동작하지 않으니 `.venv`를 지우고 다시 만드세요.
