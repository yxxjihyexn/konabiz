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

### 로그인 (데모 계정)

`.env`에 `JWT_SECRET=`(긴 임의 문자열)을 넣어야 로그인이 됩니다. 만들기: `python -c "import secrets; print(secrets.token_urlsafe(48))"`

| 역할 | 이메일 | 비밀번호 | 로그인 후 |
|---|---|---|---|
| 관리자 (김철수) | admin@ganada.co.kr | kona-demo-1234 | admin.html |
| 임직원 (김민준) | employee@ganada.co.kr | kona-demo-1234 | employee.html |

- seed를 실행하면 위 2개 계정에만 비밀번호가 들어갑니다. 나머지 임직원 23명은 비밀번호가 없어 로그인되지 않습니다 (초대 기능에서 임시 비밀번호 발급 예정). 회원가입·비밀번호 찾기는 없습니다.
- 이메일은 앞뒤 공백을 빼고 소문자로 비교합니다. 모달에서 고른 탭과 상관없이 실제 역할의 화면으로 이동합니다.
- 비밀번호는 Argon2 해시(`pwdlib`)로만 저장합니다. 로그인하면 JWT(유효 8시간, 내용은 user_id·role)를 HttpOnly · SameSite=Lax 쿠키로 줍니다. 배포(https)에서는 `.env`의 `COOKIE_SECURE=true`.
- 틀린 이메일·비밀번호는 같은 문구로 안내하고, 정지·회수된 계정은 비밀번호가 맞을 때만 이용 중지 안내를 보여줍니다. 초대됨 상태의 임직원은 첫 로그인에 사용 중으로 바뀝니다.
- 페이지 보호: `admin.html`·`admin-members.html`은 관리자, `employee.html`은 임직원만 열립니다. 로그인하지 않았으면 `index.html?login=1`(로그인 모달), 만료됐으면 만료 안내까지, 다른 역할이면 자기 화면으로 보냅니다. `sandbox.html`과 `?sandbox=1`이 붙은 `admin.html`·`employee.html`은 로그인 없이 열립니다.
- API: `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/me`. 다른 라우터에서는 `app.auth`의 `require_login` · `require_admin` 의존성을 씁니다.
- 로그인은 8000 서버에서만 동작합니다 (5500 정적 서버에는 API가 없음).
