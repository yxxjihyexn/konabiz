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

### 상담 예약 API

03 상담예약 모달이 쓰는 API. 로그인 없이 씁니다 (예약자는 아직 계정이 없는 잠재 고객). 예약 내용은 `reservations` 컬렉션에 저장하고, 브라우저의 `kona.reservation`(Sandbox 상단 바 표시용)에도 그대로 남깁니다.

**예약 가능 시간 규칙** — `backend/app/reservation_rules.py`와 `js/landing.js`가 같은 규칙을 씀 (한쪽을 고치면 같이 고침)
- 오늘(KST)이 속한 주의 월요일부터 2주, 월~금, 10·11·14·15·16·17시 (1시간)
- 지난 시간은 예약할 수 없음 (화면에서도 마감 칸과 같은 Disabled). 이번 주 남은 칸이 없으면 다음 주를 먼저 보여줌
- 시간은 KST로 계산하고 DB에는 UTC로 저장

| API | 설명 |
|---|---|
| `GET /api/reservations/slots?from=YYYY-MM-DD&to=YYYY-MM-DD` | 기간(KST, 양끝 포함, 31일 이내) 안의 **확정 예약 시각만** — `{"closed": ["2026-10-21T11:00:00+09:00", …]}`. 예약자 정보는 넣지 않음 |
| `POST /api/reservations` | 예약 저장. 성공 201 `{id, preferred_at, consultation_type}` |

`POST` 본문 (JSON):

```json
{
  "company_name": "코나비즈(주)", "employee_count": "100", "card_count": "30",
  "contact_name": "홍길동", "contact_title": "", "phone": "010-1234-5678", "email": "",
  "consultation_type": "phone", "address": "",
  "preferred_at": "2026-10-23T14:00:00+09:00",
  "custom_preset": {"time_range": [9, 20], "limit_amount": 50000, "categories": ["restaurant", "office"]},
  "source": "hero"
}
```

- 서버에서 프론트와 같은 규칙으로 다시 검사: 회사명·담당자명 필수, 임직원·카드 수는 1~1,000,000 정수(쉼표 허용), 휴대폰 번호 형식, 이메일은 입력했을 때만 형식 검사, 직책·이메일은 빈 값 허용, `consultation_type`은 `phone` | `inperson`(대면이면 주소 필수), `source`는 `hero` · `closing-cta` · `chatbot` · `simulator` · `landing`, 선택 조건은 시간 0~24 · 한도 0~100,000(10,000 단위) · 업종 7종 중에서
- 검사 실패 422: `{"detail": "입력값을 확인해주세요.", "errors": {"phone": "연락 가능한 휴대폰 번호를 입력해주세요."}}` — 항목별 한국어 문구만, 입력값은 돌려주지 않음. 시간 오류는 `preferred_at` ("이미 지난 시간이에요…" · "예약할 수 없는 시간이에요…")
- 이미 확정된 시간 409: "방금 다른 예약이 확정된 시간이에요. 다른 시간을 골라주세요." — 먼저 조회하지 않고 DB 고유 인덱스(`preferred_at`, `status: "confirmed"`일 때만)의 중복 오류로 판단하므로 동시에 들어와도 하나만 저장됨
- 저장 값: 전화번호는 `010-1234-5678` 모양, 인원·카드 수는 숫자, 전화 상담이면 `address: null`, `status: "confirmed"`, `created_at`
- seed의 예약 3건은 **seed 실행일 다음 평일들**(첫째 날 11:00·15:00, 둘째 날 10:00)로 들어가서 언제 시연해도 마감 칸이 보입니다. 시간이 지나 마감 칸이 지난 시간이 되면 seed를 다시 실행하세요. 테스트로 만든 예약도 seed를 다시 실행하면 지워집니다.
- `?sandbox=1`이 붙은 화면에서는 예약 API를 부르지 않습니다 (마감 칸 없이 브라우저에만 저장).
- 규칙·검사 테스트 (DB 없이, `backend` 폴더에서): `python -m unittest discover -s tests -t . -v`
