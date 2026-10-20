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

- seed를 실행하면 위 2개 계정에만 비밀번호가 들어갑니다. 나머지 임직원 23명은 비밀번호가 없어 로그인되지 않습니다 (새로 초대하거나, 초대됨 상태면 08에서 임시 비밀번호를 다시 발급). 회원가입·비밀번호 찾기는 없습니다.
- 이메일은 앞뒤 공백을 빼고 소문자로 비교합니다. 모달에서 고른 탭과 상관없이 실제 역할의 화면으로 이동합니다.
- 비밀번호는 Argon2 해시(`pwdlib`)로만 저장합니다. 로그인하면 JWT(유효 8시간, 내용은 user_id·role)를 HttpOnly · SameSite=Lax 쿠키로 줍니다. 배포(https)에서는 `.env`의 `COOKIE_SECURE=true`.
- 틀린 이메일·비밀번호는 같은 문구로 안내하고, 정지·회수된 계정은 비밀번호가 맞을 때만 이용 중지 안내를 보여줍니다. 초대됨 상태의 임직원은 첫 로그인에 사용 중으로 바뀌고, 카드도 발급 중 → 사용 중으로 바뀝니다.
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

### 임직원 관리 API

08 임직원관리(`admin-members.html`)와 05 대시보드의 인원·카드 숫자가 쓰는 API. 모두 **관리자 로그인 필요**(`require_admin`, 임직원 계정은 403). 관리자는 자기 회사(`company`)의 임직원(`role: "employee"`)만 보고 바꿀 수 있고, 다른 회사 직원·관리자 계정·없는 id는 모두 404입니다.

| API | 설명 |
|---|---|
| `GET /api/members?dept=&status=&q=` | 자기 회사 임직원 목록 (초대일 최신순). `dept`는 영업1팀·마케팅팀·개발팀, `status`는 invited·active·suspended·revoked, `q`는 이름·이메일 일부(대소문자 무시). 화면은 전체를 받아 필터·검색·페이지를 브라우저에서 처리 |
| `POST /api/members` | 초대 `{name, email, dept}` → 201 `{member, temp_password}` |
| `POST /api/members/{id}/temp-password` | 임시 비밀번호 재발급 (초대됨만) → `{member, temp_password}` |
| `POST /api/members/{id}/suspend` · `/resume` · `/revoke` | 정지 · 정지 해제 · 회수 → `{member}` |
| `GET /api/dashboard/summary` | 인원·카드 상태 숫자 `{employees, cards: {active, issuing, suspended, revoked}, departments: [{name, members, active, issuing}]}` |

**상태 전이** — `backend/app/member_rules.py` (회원 상태를 바꾸면 카드 상태도 같이 바뀜)

| 지금 | 할 수 있는 것 | 결과 |
|---|---|---|
| 초대됨 (카드 발급 중) | 임시 비밀번호 재발급 · 회수(초대 취소) | 상태 유지(이전 임시 비밀번호 무효) · 회수됨 / 카드 회수 |
| 사용 중 | 정지 · 회수 | 정지 / 카드 정지 · 회수됨 / 카드 회수 |
| 정지 | 정지 해제 · 회수 | 사용 중 / 카드 사용 중 · 회수됨 / 카드 회수 |
| 회수됨 | 없음 (되돌릴 수 없음) | — |

- 첫 로그인(초대됨 → 사용 중)에 카드도 발급 중 → 사용 중.
- 표에 없는 동작(다른 탭에서 이미 바뀐 경우 포함)은 409 "이미 상태가 변경된 직원이에요. 목록을 새로고침할게요." 상태 확인과 변경을 조건부 업데이트 한 번으로 해서 동시에 눌러도 하나만 바뀝니다.
- 초대 검사: 이름 필수, 이메일 형식(소문자로 저장), 부서는 정해진 3개 중 하나 → 422 `{"detail": "입력값을 확인해주세요.", "errors": {"dept": "목록에서 부서를 골라주세요."}}`. 이미 있는 이메일 409 `{"detail": "이미 등록된 이메일이에요.", "field": "email"}`, 회수된 직원의 이메일이면 "카드가 회수된 직원의 이메일이에요. 다른 이메일로 초대해주세요." (회수된 이메일은 다시 초대할 수 없음)
- 초대하면 `users`(초대됨, 임시 비밀번호의 Argon2 해시)와 `cards`(발급 중, 포인트 4종 seed와 같은 시작 잔액, 끝 4자리 새로 만듦)가 함께 생깁니다. 새 컬렉션은 없습니다.
- **임시 비밀번호**: 12자, 헷갈리는 문자(0 O o 1 l I) 제외. 평문은 초대·재발급 응답에서 한 번만 돌려주고 DB·로그에는 남기지 않습니다(해시만 저장). 메일 발송은 없고, 화면의 완료 창에서 [로그인 정보 복사](이메일 + 임시 비밀번호, `[코나비즈] 로그인 정보` 형식)로 복사해 직접 전달합니다. 완료 창은 바깥 클릭·ESC로 닫히지 않고 [확인]으로만 닫히며, 닫으면 다시 볼 수 없습니다(잊으면 재발급).
- 대시보드 "활성 카드 수"는 사용 중(active)만 세고 발급 중은 "18장 · 발급 중 3"처럼 따로 보여줍니다. 부서 줄의 카드 수도 사용 중만. 사용액·예산·카테고리·결제 알림은 아직 예시값입니다.
- CSV 일괄 등록은 아직 예시 화면입니다 (목록에만 잠깐 추가되고 저장되지 않음).
- `?sandbox=1`(07 Sandbox)에서는 이 API를 부르지 않고 `js/mock-data.js` 예시값으로 보여줍니다.

**시연 순서 (초대 → 임시 비밀번호로 로그인)**

1. 관리자(admin@ganada.co.kr)로 로그인 → 임직원관리 → [임직원 초대하기]
2. 이름·이메일·부서(목록에서 선택) 입력 → [초대하고 카드 발급하기] → 완료 창의 [로그인 정보 복사] → [확인]
3. 대시보드에서 "발급 중"이 1 늘었는지 확인 → 로그아웃
4. 초대한 이메일 + 임시 비밀번호로 로그인 → 임직원 화면(employee.html). 이때 상태 사용 중, 카드 사용 중 (대시보드 활성 +1, 발급 중 −1)
5. 다시 관리자로 → ⋯ 메뉴에서 정지(그 직원은 새로고침하면 로그인 모달, 로그인하면 이용 중지 안내) → 정지 해제 → 회수(이름 입력 확인, 되돌릴 수 없음)
6. 시연이 끝나면 `python -m scripts.seed`로 데이터를 처음으로 되돌립니다.

### 임직원 마이페이지 API

06 임직원 마이페이지(`employee.html`)가 쓰는 API. **임직원 로그인 필요**(관리자 계정은 403, 비로그인 401). 본인은 쿠키 토큰의 user_id로만 찾고, 주소·파라미터로 다른 사람 id를 받지 않습니다.

| API | 설명 |
|---|---|
| `GET /api/me/card` | 본인 카드 `{last4, status, holder, points: {meal·fitness·welfare·expense: {start, balance}}, summary: {remaining, expense}, transactions: [{paid_at, merchant, pocket, amount, status, blocked_reason}]}`. 카드가 없으면 404 |

- `summary.remaining` = 식대·체력단련·복지 3종 잔액 합계. 법인경비P(`expense`)는 별도 예산이라 합계에 넣지 않고 따로 표시합니다.
- 거래는 최신순, `paid_at`은 KST(`+09:00`) ISO 문자열. 차단 거래(`status: "blocked"`)는 잔액에서 빠지지 않습니다. 화면은 처음 5건, [더 보기]마다 10건씩.
- 사용자 정보(이메일·비밀번호 해시 등)와 DB id는 응답에 넣지 않습니다.
- 화면: 불러오는 중 skeleton, 실패(403·404·5xx·네트워크) "정보를 불러오지 못했어요" + [다시 시도], 거래 0건 빈 상태 안내. 401은 app.js가 로그인 모달로 보냅니다.
- 새로 초대한 직원은 시작 잔액 그대로(사용 0원)·거래 0건으로 보입니다.
- `?sandbox=1`과 `?state=` 미리보기(suspended·issuing·no-payments·loading·error)는 이 API를 부르지 않고 `js/mock-data.js`의 김민준 예시값으로 보여줍니다.
- 결제·포인트 충전·이동·거래 생성 API는 없습니다(거래는 seed 데이터만).

### 테스트

`backend` 폴더에서 (DB에 붙지 않음 — 임직원 관리 테스트는 메모리 DB `mongomock` 사용):

```powershell
pip install -r requirements-dev.txt
python -m unittest discover -s tests -t . -v
```

- `test_reservations.py`: 예약 시간 규칙·입력 검사
- `test_members.py`: 상태 전이 전체, 409(이미 바뀐 상태·중복 이메일·회수된 이메일), 404(다른 회사·관리자·없는 id), 임직원 계정 403, 임시 비밀번호 1회 노출·재발급 후 이전 비밀번호 실패, 첫 로그인 시 카드 사용 중, 대시보드 숫자
- `test_me.py`: 본인 카드만 조회(새 직원에게 김민준 데이터 없음), 김민준 잔액·거래 7건(차단 1), 합계에서 법인경비P 제외, 최신순·KST, 거래 0건, 민감 정보 없음, 관리자 403, 비로그인 401, 카드 없음 404
