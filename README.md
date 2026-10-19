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

### MongoDB(Atlas) 연결 · 데모 데이터

1. MongoDB Atlas(무료 M0)에서 클러스터의 접속 주소(Connect → Drivers의 `mongodb+srv://…`)를 받아 `backend/.env`의 `MONGODB_URI=` 뒤에 넣습니다. DB 이름은 `MONGODB_DB=konabiz`. 주소에는 비밀번호가 들어 있으니 다른 파일·채팅에 붙여 넣지 마세요.
2. Atlas Network Access에 지금 PC의 IP가 허용되어 있어야 접속됩니다.
3. 데모 데이터 넣기 (`backend` 폴더에서):

```powershell
python -m scripts.seed
```

- `konabiz` DB의 `users`·`reservations`·`cards`·`chats` 4개만 비우고 다시 넣습니다 (몇 번 실행해도 결과가 같음). 끝나면 컬렉션별 문서 수를 출력합니다.
- 데이터는 `backend/scripts/seed_data.py` — `js/mock-data.js`를 옮겨 적은 것이라 mock을 고치면 같이 고칩니다. 숫자가 어긋나면 넣기 전에 멈춥니다.
- 서버를 켜면 http://localhost:8000/api/health 가 `{"status":"ok","db":"ok"}`를 돌려줍니다. 주소가 비어 있거나 접속이 안 되면 `"db":"error"` (페이지는 그대로 열림).
