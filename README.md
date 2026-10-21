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
| `GET /api/me/card` | 본인 카드 `{last4, status, holder, points: {meal·fitness·welfare·expense: {start, balance}}, summary: {remaining, expense}, transactions: [{paid_at, merchant, pocket, amount, status, blocked_reason, ai}]}`. 카드가 없으면 404 |

- `summary.remaining` = 식대·체력단련·복지 3종 잔액 합계. 법인경비P(`expense`)는 별도 예산이라 합계에 넣지 않고 따로 표시합니다.
- 거래는 최신순, `paid_at`은 KST(`+09:00`) ISO 문자열. 차단 거래(`status: "blocked"`)는 잔액에서 빠지지 않습니다. 화면은 처음 5건, [더 보기]마다 10건씩.
- 사용자 정보(이메일·비밀번호 해시 등)와 DB id는 응답에 넣지 않습니다.
- 화면: 불러오는 중 skeleton, 실패(403·404·5xx·네트워크) "정보를 불러오지 못했어요" + [다시 시도], 거래 0건 빈 상태 안내. 401은 app.js가 로그인 모달로 보냅니다.
- 새로 초대한 직원은 시작 잔액 그대로(사용 0원)·거래 0건으로 보입니다.
- `?sandbox=1`과 `?state=` 미리보기(suspended·issuing·no-payments·loading·error)는 이 API를 부르지 않고 `js/mock-data.js`의 김민준 예시값으로 보여줍니다.
- 결제·포인트 충전·이동·거래 생성 API는 없습니다(거래는 seed 데이터만).
- `ai`: 가맹점 판별 모델 결과 `{category, confidence, industry, source, level}` — seed 때 계산해 거래 문서에 저장한 값(화면에서 실시간 호출하지 않음). 결제 행에 "AI 분류 · 카페·음료점"처럼 표시, 모델 파일 없이 seed했으면 `null`이고 그 줄이 빠집니다. Sandbox는 `js/mock-data.js`에 같은 값.

### 챗봇 API (OpenAI + 규칙 답변 하이브리드 + 지식 검색 RAG)

09 챗봇(전역 플로팅 위젯)이 쓰는 API. 로그인 없이 쓰고, Sandbox(`?sandbox=1`) 안의 챗봇도 같은 API를 씁니다 (회사 데이터를 바꾸지 않음).

| API | 설명 |
|---|---|
| `POST /api/chat` | `{message, quick_reply_id?, conversation_id, anon_id?}` → `{text, cta, sources?}` |

**구조**
- **빠른 답변 버튼**(`quick_reply_id`: lead-time · limits · pricing · booking) → `backend/app/chat_rules.py`의 정해진 답변. OpenAI를 부르지 않습니다. 버튼 이름과 똑같이 입력해도 같음.
- **직접 입력한 질문** → OpenAI가 답합니다. 시스템 프롬프트에 질문과 관련된 승인 지식 5개만 넣고(아래 RAG), 지식에 없는 사실·서비스와 관계없는 질문은 지어내지 않고 상담 안내 + 상담 예약 버튼. 역할 변경·시스템 프롬프트 공개·지시 무시 요청은 따르지 않습니다.
- 빠른 답변·대체 답변·시스템 프롬프트 규칙은 `chat_rules.py`, 지식(FAQ)은 `backend/app/knowledge/faq.json` 한 곳에만 있습니다. 프론트(`js/chat-reply.js`)에는 버튼 id·이름만 있고 `KonaChatReply.get()`이 `/api/chat`을 부릅니다.
- **cta**: `booking`([상담 예약하기]) · `simulator`([무료로 체험하기]) · `null`(버튼 없음). 랜딩에서는 그 모달을 바로 열고, 다른 페이지·Sandbox iframe에서는 바깥 창을 `index.html?action=booking|simulator&source=chatbot`으로 옮겨 모달을 엽니다.

**OpenAI 호출**
- 모델: `.env`의 `OPENAI_MODEL` (기본 `gpt-4o-mini`), 공식 SDK `openai` (`requirements.txt`에 버전 고정)
- Structured Outputs로 `{text, cta, used_ids}`를 받고 서버에서 다시 검사 (text가 비면 대체 답변, cta가 목록 밖이면 `null`, 600자 넘으면 자름, "~이어요"는 "~이에요"로 고침, used_ids는 검색해서 넣은 항목 안의 id만 `sources`로)
- 같은 대화의 최근 6개 메시지만 맥락으로 보냄 (DB에서 `uid`·`conversation_id`가 둘 다 맞는 대화만 — 남의 대화는 읽지 않음)
- 사용자 이름·이메일은 보내지 않고, 질문 안의 이메일·전화번호·카드번호 형태는 `[이메일]`처럼 가려서 보냄
- 답변 상한 300토큰, temperature 0.2, 타임아웃 15초(재시도 없음 — 화면의 20초 대기보다 짧게)
- API 키는 서버에서만 씁니다. 응답·JS·로그에 넣지 않습니다.

### 챗봇 지식 · RAG

**지식 파일** — `backend/app/knowledge/faq.json`, 55개 (`F1`~`F32`: 7단계 승인 FAQ · 번호는 그대로 유지, `N1`~`N27`: 기획서 1018에서 뽑은 Q&A 22개 + N27 주점 정책(ML 변환표 결정·기획서 9.6), 빈 번호 있음)

```json
{ "id": "F18", "category": "포인트", "question": "법인경비P는 어디에 쓰고 어떻게 차감돼요?",
  "answer": "법인경비P는 별도 예산이에요. 사무용품, 출장(항공·숙박), 거래처 접대에 쓰고, …", "source": "7단계 승인 FAQ" }
```

- `category`는 화면의 "참고한 안내: 가격 · 카드 제작"에 그대로 나옵니다 (서비스 · 가격 · 도입 절차 · 시뮬레이터 · 포인트 · 상담 예약 · 가상 대시보드 · 로그인 · 관리자 · 임직원 · 카드 제작 · 안내)
- `answer`는 승인된 문구 그대로, `source`는 출처(화면 이름 또는 "기획서 5.1"). `question`은 검색용 대표 질문, `alt_questions`(없어도 됨)는 같은 뜻의 다른 표현 — 임베딩·키워드에만 쓰고 프롬프트에는 넣지 않음.
  임베딩 문장 = `[카테고리] 질문 / 다른 표현 / …` + 줄바꿈 + 답변

**흐름 (직접 입력만, 빠른 답변은 규칙 그대로)**
1. 질문(개인정보 가림)을 `text-embedding-3-small`로 임베딩 (타임아웃 5초). 같은 대화에 직전 질문이 있으면 "직전 질문 + 이번 질문"도 같은 호출로 임베딩해 더 높은 점수를 씀 ("그건 얼마예요?" 같은 이어지는 질문)
2. 미리 계산해 둔 지식 벡터와 코사인 유사도 → 상위 5개 (`backend/app/rag.py`, 표준 라이브러리만 — 수십 개라 벡터 DB 없음)
   - **키워드 일치**: 지식에만 있는 낱말(3글자 이상, 3개 항목 이하에만 나옴, "~요"·"~면" 서술어 제외)이 질문에 있으면 그 항목을 먼저 넣고 관련 있음으로 봄. "사원증형이 뭐예요?"처럼 짧은 질문은 임베딩 점수가 낮게 나와서(0.28) 보완
3. 1위 유사도가 **0.40 미만이고 키워드 일치도 없으면** "관련 지식 없음"으로 OpenAI를 부름 → 규칙대로 범위 안내·상담 안내, `sources` 없음
4. 시스템 프롬프트 = 규칙 + `[참고 지식]` 5개(`[F7] (가격) 질문: … 답변: …`). 응답의 `used_ids` 중 그 5개 안의 id만 `sources: [{id, category}]`로 → 화면에 카테고리를 중복 없이 표시, `chats`의 봇 메시지에도 `sources` 저장
5. 임베딩 파일이 없거나 `faq.json`과 해시·모델이 다르면(서버 시작 시 경고 로그), 또는 임베딩 API 실패·타임아웃이면 → 검색 없이 지식 전체를 넣고 답함 (화면 오류 없음). 이때는 `sources`를 표시하지 않음 — 전체 중에서는 비슷한 id(N24·F24)를 잘못 고르는 경우가 있었고, 서버가 검증할 수 없어서

**기준값 0.40을 고른 근거** — 질문 39개(관련 25 · 지식에 없는 코나비즈 질문 4 · 무관 10)의 1위 유사도

| | 1차 (54개, alt_questions 없음) | 2차 (55개, alt_questions·N27 추가) |
|---|---|---|
| 무관(날씨·주식·코딩·번역·농담·KTX·지시 무시 등) | 0.202 ~ **0.338** | 0.202 ~ **0.337** |
| 관련이고 검색이 맞은 질문 | **0.451** ~ 0.685 | 0.432 ~ 0.685 |
| 0.40 + 키워드로 통과 | 무관 0/10 · 관련 23/25 | 무관 0/10 · **관련 25/25** |

- 0.40은 무관 최댓값과 맞게 검색된 관련 최솟값 사이의 가운데 (양쪽 0.05 이상 여유)
- 임베딩 점수만으로는 무관보다 낮은 관련 질문이 있어("사원증형이 뭐예요?" 0.277 → 2차 0.356) 키워드 일치로 보완
- 2차에서 "한 달에 얼마 내야 해요" 0.357 → 0.460(F7 1위), "술집에서 긁어도 돼요?" → N27 1위·키워드 일치로 통과

**프롬프트 끝 확인 목록** — 지식에 없는 설명·평가 덧붙이지 않기, "~이어요" 쓰지 않기, 가격·도입 기간·카드 발급·계약 답은 cta booking. 규칙 목록 중간에만 두면 gpt-4o-mini가 자주 놓쳐서 `[참고 지식]` 뒤에 한 번 더 적음 (`chat_rules.FINAL_CHECK`)

**지식을 고친 뒤** (`backend` 폴더에서)

```powershell
python -m scripts.build_knowledge   # faq.json → faq_embeddings.json (OpenAI 임베딩 1회, 전체를 한 요청으로)
```

- 다시 만든 뒤 서버를 재시작해야 새 임베딩을 씁니다 (`--reload`는 .py만 보고, Windows에서는 다시 불러오기가 멈추는 경우가 있어 직접 재시작 권장). 해시는 줄바꿈(CRLF/LF)을 맞춰 계산해서 git 줄바꿈 변환에는 영향받지 않습니다. 다시 만들지 않으면 해시가 달라 경고 로그 + 지식 전체 방식으로 동작합니다.
- 문구는 사이트 화면·기획서와 같이 고칩니다. id는 바꾸지 않습니다(대화 기록·테스트에서 씀).

**대체 답변** — OpenAI 실패·타임아웃·키 없음(`OPENAI_API_KEY`가 비었거나 공백)·응답 형식 오류면 오류 문구 대신 "지금은 자세히 답변드리기 어려워요. 정확한 안내는 상담에서 도와드릴게요." + [상담 예약하기]. 서버 로그에는 `챗봇: OpenAI 실패 (APITimeoutError)`처럼 오류 종류만 남깁니다. 서버에 아예 닿지 못하면(네트워크·5xx) 화면은 기존 실패 표시("답변을 받지 못했어요" + [다시 보내기]).

**입력 검사·사용량 제한**
- 메시지는 앞뒤 공백을 빼고 검사: 비었으면 422 "질문을 입력해주세요.", 500자 초과 422 "질문은 500자까지 입력할 수 있어요."
- 같은 uid 1분 10회, 같은 IP 1분 30회를 넘으면 429 "잠시 후 다시 질문해주세요." (빠른 답변 포함. 서버 메모리 기준이라 재시작하면 초기화, 새 컬렉션 없음)
- 422·429 문구는 화면에서 봇 답변처럼 보여줍니다.

**저장** — `chats` 컬렉션에 `{uid, conversation_id}`로 질문·답변을 쌓습니다 (`messages: [{id, from, text, cta?, sources?, quick_reply_id?, created_at}]`, `created_at`, `updated_at`).
- `uid`: 로그인했으면 `users._id` 문자열(쿠키로 서버가 판단, `anon_id`는 무시), 아니면 브라우저 임시 ID `anon_id`
- 로그인 성공 → 새 대화(비로그인 대화를 계정에 합치지 않음), 로그아웃 → 임시 ID까지 삭제 (`js/chatbot.js`)
- DB가 없으면 답변만 하고 저장·맥락은 건너뜁니다. 테스트로 쌓인 대화는 `python -m scripts.seed`로 지워집니다.
- 로그인 사용자의 포인트·거래를 챗봇이 조회해 답하는 기능은 없습니다.

### 가맹점 판별 ML (상호명 → 코나비즈 포인트)

상호명만 보고 어떤 포인트로 결제될지(또는 제한 업종인지) 미리 알려주는 머신러닝 모델. 랜딩 AI 카드 · 임직원 마이페이지 "결제 전에 확인하기" · 관리자 대시보드 "AI 정책 점검"의 판별기와 결제내역 AI 분류에 씁니다. 결제 시뮬레이터와 챗봇은 이 모델을 쓰지 않습니다.

| API | 설명 |
|---|---|
| `POST /api/ml/classify` | `{name}` → `{category, confidence, industry, source, level}` |

- 로그인 없이 씀 (Sandbox도 실제 API — 데이터를 바꾸지 않음). 앞뒤 공백 제거 후 빈 값 422 "가맹점 이름을 입력해주세요.", 50자 초과 422 "가맹점 이름은 50자까지 입력할 수 있어요."
- 같은 IP 1분 30회 → 429 "잠시 후 다시 판별해주세요." (챗봇과 같은 메모리 방식)
- 모델은 서버 시작 시 한 번만 불러옴(약 0.6초). 모델 파일이 없으면 서버는 그대로 켜지고 이 API만 503 → 화면 "지금은 판별할 수 없어요. 잠시 후 다시 시도해주세요."
- `category`: meal · fitness · welfare · expense · restricted, `source`: `rule`(키워드 규칙) | `model`, `industry`: 근거 업종(표시 이름)

**화면 정책 (level — 서버가 `app/ml_rules.py`의 기준값으로 계산, 화면은 level만 보고 그림)**

| level | 조건 | 화면 |
|---|---|---|
| `block` | 키워드 규칙(유흥주점·단란주점·룸살롱·룸싸롱·가라오케·노래빠·나이트클럽, 공백 무시) | "결제할 수 없어요 · 제한 업종" (기존 차단 스타일) |
| `warn` | 모델 restricted, 확신도 ≥ 0.9 (`WARN`) | "제한 업종일 수 있어요" — 차단으로 단정하지 않음 |
| `high` | 확신도 ≥ 0.6 (`HIGH`), 법인경비P만 ≥ 0.7 (`EXPENSE_HIGH`) | "○○P로 결제될 것 같아요" + 확신도 + 근거 업종 |
| `low` | 그 밖 (restricted < 0.9 포함) | 예상은 보여주되 "이름만으로는 확실하지 않아요" |

- 실제 결제는 가맹점에 등록된 업종으로 처리되고 AI는 미리 알려주는 역할이라, 문구는 "결제될 것 같아요"로 씁니다. 화면 확신도는 최대 99%로 표시.
- 모델의 restricted 판정만으로 차단하지 않는 이유: 확신도 0.9 이상에서도 precision 0.351(288건 중 101건) — 노래방·주점을 유흥주점으로 보는 경우가 많음.

**데이터** — 공공데이터포털 15083033 소상공인시장진흥공단 상가(상권)정보 **서울 2026-06** (554,092행, UTF-8). `backend/ml/data/`에 두고 커밋하지 않습니다(`.gitignore`, 원본은 읽기만).

**변환 규칙** — `backend/ml/category_map.py` (표: `category_map.csv`, `python backend/ml/category_map.py`로 다시 만듦). 업종 소분류 247개 → 근거 업종 90개 → 코나비즈 5분류

| 분류 | 업종 (업소 수) |
|---|---|
| meal 식대P | 음식점·카페(주점 제외) · 학원(입시·예체능·외국어 등) · 서점 (162,363) |
| fitness 체력단련P | 스포츠 서비스(당구장 제외) · 요가/필라테스·태권도/무술·레크리에이션 학원 · 의원·병원 · 약국 (38,890) |
| expense 법인경비P | 호텔·모텔(펜션 제외) · 여행사 · 렌터카 · 주유소·가스충전소 · 문구 · 사무기기 · 복사 (13,022) |
| restricted 제한 | 일반 유흥 주점 · 무도 유흥 주점 (2,484) |
| welfare 복지P | 그 밖의 모든 업종 — 요리 주점·생맥주(일반 주점), 펜션, 당구장, 안마·사우나, 노래방, 전문·사업 서비스 포함 (337,333) |

**모델** — `backend/ml/train.ipynb` (EDA · 비교 · 평가 · 틀린 사례 · 데모), 공통 코드 `backend/app/ml_rules.py`(정규화·규칙·예측)
- 상호명 정규화(소문자·법인 표기·괄호·공백·특수문자 제거) → 이름 단위로 합침(체인점 한 표, 다수 분류 60% 미만 이름 제외) → 434,387개
- 글자 1~3-gram TF-IDF(특징 5만) + 로지스틱 회귀. **근거 업종 90개를 예측**하고 확률을 분류별로 더해 확신도로 씀 → 근거 업종을 함께 설명
- 샘플 가중치 = `log(1+업소 수)`(체인 가중치) × 분류 균형 (welfare : restricted = 227 : 1)
- 평가는 **그룹 분할**(정규화 이름 앞 3글자 — 같은 브랜드가 학습·평가에 나뉘지 않게) 80/20
- 저장: `backend/ml/models/merchant_classifier.joblib` (16.9MB, 커밋) + `model_meta.json`(scikit-learn 1.9.1 등 버전·성능). 불러올 때 학습 때와 같은 scikit-learn 버전이어야 함 (`requirements.txt` 고정)

**성능** (평가 86,878개, 모델만 — 규칙 제외)

| 모델 | 정확도 | macro F1 |
|---|---|---|
| **업종 합산 + LR (사용)** | **0.834** | **0.647** |
| 5분류 직접 + LR | 0.820 | 0.631 |
| 업종 합산 + ComplementNB | 0.697 | 0.523 |
| welfare 6만 추출 | 0.816 | 0.627 |
| (참고) 무작위 분할 — 브랜드 누수 | 0.841 | 0.652 |

| 분류 | precision | recall | F1 |
|---|---|---|---|
| meal | 0.799 | 0.808 | 0.804 |
| fitness | 0.880 | 0.922 | 0.901 |
| welfare | 0.903 | 0.843 | 0.872 |
| expense | 0.368 | 0.683 | 0.479 |
| restricted | 0.106 | 0.567 | 0.178 |

- 확신도 0.6 이상이 73.4%, 그 안 정확도 0.915 (미만 0.611)
- 키워드 규칙만: precision 0.667 · recall 0.129 (업태가 이름에 드러난 경우만 확실히 막는 용도)

**한계**
- 이름만 봄 — 이름에 업종 단어가 있어도 실제 업종이 다르면 틀림(달커피숖 → 실제 주점), 업종 단서가 없는 브랜드형 이름(몽트레·롬25)은 확신도가 낮게 나옴
- 유흥주점 이름 대부분은 업태 단서가 없어("헤븐"·"동경") 모델이 잘 못 찾고, 노래방·주점을 유흥주점으로 보기도 함 → 모델 판정으로 차단하지 않음
- expense를 많이 예측(precision 0.37) — "투어·렌트·호텔·문구" 단어에 끌림
- 공공데이터 업종이 실제와 다른 이름이 있어(내과의원이 식료품 소매로 등록 등) 평가 점수가 실제보다 낮게 나옴
- 서울 2026-06 데이터만. 유명 체인도 이름 하나만 넣으면 확신도가 낮을 수 있음(스타벅스 0.54 → low)

**재학습** (`backend` 폴더, 원본 CSV를 `backend/ml/data/`에 둔 뒤)

```powershell
pip install -r requirements-dev.txt
python ml/category_map.py                      # 변환표 CSV (변환 규칙을 고쳤으면)
jupyter nbconvert --to notebook --execute --inplace ml/train.ipynb   # 약 45분 — 모델 5개 비교 + 최종 모델 저장
python -m scripts.seed                         # 결제내역 ai 다시 계산
```

- 다시 학습하면 `js/mock-data.js`의 김민준 거래 `ai` 값(Sandbox)과 랜딩 카드의 "평가 정확도"를 새 결과로 고치고, 서버를 재시작합니다.
- 기준값(0.6 · 0.7 · 0.9)과 근거 업종 표시 이름은 `app/ml_rules.py` 한 곳.

### 테스트

`backend` 폴더에서 (DB·OpenAI에 붙지 않음 — 메모리 DB `mongomock`, OpenAI는 가짜 응답):

```powershell
pip install -r requirements-dev.txt
python -m unittest discover -s tests -t . -v
```

- `test_reservations.py`: 예약 시간 규칙·입력 검사 (법인경비P 업종 거래처 접대 `entertain` 포함)
- `test_members.py`: 상태 전이 전체, 409(이미 바뀐 상태·중복 이메일·회수된 이메일), 404(다른 회사·관리자·없는 id), 임직원 계정 403, 임시 비밀번호 1회 노출·재발급 후 이전 비밀번호 실패, 첫 로그인 시 카드 사용 중, 대시보드 숫자
- `test_me.py`: 본인 카드만 조회(새 직원에게 김민준 데이터 없음), 김민준 잔액·거래 7건(차단 1), 합계에서 법인경비P 제외, 최신순·KST, 거래 AI 분류(ai) 그대로 · 없으면 null, 거래 0건, 민감 정보 없음, 관리자 403, 비로그인 401, 카드 없음 404
- `test_ml.py`: level 기준(규칙 block · 모델 restricted는 warn/low만 · 0.6 · 법인경비 0.7), 키워드 규칙(공백·법인 표기 무시), 빈 값·공백·숫자 422, 51자 422 · 공백 빼고 50자 통과, 모델 없음·예측 오류 503, 근거 업종 표시 이름, IP 1분 30회 429, 실제 모델(응답 형식 · 랜딩 예시 칩 4개 결과 — 모델 파일 없으면 건너뜀)
- `test_chat.py`: 빠른 답변(OpenAI·임베딩 0회), AI 답변·맥락 6개, RAG(상위 5개만 프롬프트에, 기준값 미만 → 관련 지식 없음, 키워드 일치, used_ids 검증 · 목록 밖 id 제거, sources 응답·저장, 이어지는 질문, 임베딩 실패·검색 불가 → 지식 전체 · sources 없음), 지식 파일(55개 · alt_questions 형식 · F18 거래처 접대 · N27, 임베딩 문장에 다른 표현 포함, CRLF여도 같은 해시, 파일 없음·해시·모델 불일치 경고), "~이어요" 고침, 프롬프트 끝 확인 목록, 개인정보 가림, cta 검사, 타임아웃·연결 실패 대체 답변, 키 없음, 빈 값·500자, 429(uid·IP·시간 지나면 풀림), 비로그인 anon_id·로그인 user id 저장, 남의 대화 읽기·쓰기 안 됨, DB 없이 답변
