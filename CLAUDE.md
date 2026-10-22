## 작업 방식

- 답변과 진행 상황 설명은 항상 한국어로
- "구조를 먼저 보여줘"라고 하면 확인 질문만 하지 말고 구조 내용을 채팅에 직접 적어서 보여주기

## Figma 기준

- 파일: `tElrjs8WxtQnBpTQllNOAs` (코나비즈)
- PC 페이지: `562:9397` — 랜딩 `38:74` (01_Landing, 1440)
- Mobile 페이지: `562:9398` — 랜딩 `254:2` (01_Landing_Mobile, 375)
- `579:6035`는 Cover 페이지의 미리보기 복사본이라 기준으로 쓰지 않음

## 구현 결정 사항

- 포커스 표시: `outline: 2px solid #0E7490; outline-offset: 2px` (기획서의 Cyan200 글로우 링 대체 — 대비 기준 때문). 토큰은 `style.css`의 `--focus-outline` · `--focus-offset`
- 테두리: `border` 대신 `box-shadow: inset`으로 그림 (Figma Stroke Inside처럼 크기에 영향 없게). 장식·그룹핑 `inset 0 0 0 0.5px`, 인터랙티브 `inset 0 0 0 1px`, 한쪽 선 `inset 0 ±0.5px 0`
- 상담예약 날짜: 오늘(KST)이 속한 주의 월요일부터 2주(월~금, 10·11·14·15·16·17시). 규칙은 `js/landing.js`와 `backend/app/reservation_rules.py`가 같게 유지. 마감 칸 = DB 확정 예약(`/api/reservations/slots`) + 지난 시간(같은 Disabled). seed 예약 3건은 실행일 다음 평일(첫째 11:00·15:00, 둘째 10:00)
  - 상담 방식 값은 `phone` · `inperson` (프론트·서버·DB 모두 같음, 변환 없음)
  - 예약 확정 버튼 요청 중은 로그인과 같은 "비활성 + 예약 중…". 실패 안내는 Step2의 `alert-box` (`[data-booking-alert]` · 시간 불러오기 실패 `[data-slot-error]` + [다시 시도])
  - landing.js는 IIFE 하나에 `var`라 03·04 사이에 함수 이름이 겹치면 덮어씀 (예: 로그인 `setBusy` / 예약 `setBooking`)
- 로그인은 서버 연결 전까지 `js/landing.js`의 `DEMO_ACCOUNTS` 예시 계정 사용
- 점선 테두리(카드 발급 중 자리)만 예외로 `border: 1px dashed` 사용 — 그림자로는 점선을 그릴 수 없음
- 앱 화면(admin.html · employee.html): 사이드바 마크업은 HTML 한 곳에만 두고, 1024 미만 드로어는 `js/app.js`가 복사함. 선택된 메뉴는 `aria-current="page"`, 준비 중 메뉴는 링크가 아닌 `<span aria-disabled="true">`
- 앱 화면 예시 데이터는 `js/mock-data.js` (기획서 9.7) — 숫자 합계가 서로 맞아야 함
- 상태 화면은 `?state=`로 전환 (목록에 없는 값은 Default)
  - admin.html: `empty`
  - employee.html: `suspended` · `issuing` · `no-payments` · `loading` · `error`
  - admin-members.html: 없음 (5단계부터 DB 목록. 임직원 0명이면 빈 상태, 불러오는 중 skeleton · 실패 alert-box + [다시 시도])
- 부서는 영업1팀·마케팅팀·개발팀 3개 (`backend/app/member_rules.py` DEPTS = `KonaMock.DEPTS`). 대시보드 "활성 카드 수"는 사용 중(active)만, 발급 중(issuing)은 단위 뒤 "18장 · 발급 중 3"(두 번째 `metric-card__unit`, 좁으면 다음 줄). 부서 줄 카드 수도 active만(5·5·8). 로그인 화면은 `/api/dashboard/summary`, Sandbox는 `KonaMock.activeCards()` · `issuingCards()`. 9.7의 "활성 카드 24장"보다 이 규칙이 우선
- 임직원관리(admin-members.html · `js/admin-members.js`): 단건 초대·임시 비밀번호 재발급·정지·정지 해제·회수는 `/api/members`로 DB 저장. 목록은 회사 전체를 받고 필터·검색·페이지는 화면에서. CSV 일괄 등록만 예시 동작(저장 안 함, ⋯ 없음)
  - ⋯ 메뉴는 상태 전이표대로: 초대됨 [임시 비밀번호 다시 발급], 사용 중 [카드 정지], 정지 [정지 해제] + 회수됨 외 모두 [카드 회수]. 정지·해제·회수 모두 확인 창(`modal-suspend` · `modal-resume` · `modal-revoke`) 후 실행, 요청 중 확인 버튼 "…중" + 그 행 ⋯ 비활성, 409는 토스트 후 목록 새로고침
  - 초대 완료·재발급 화면은 `modal-invite` 안의 `[data-invite-view="done"]`. 임시 비밀번호는 여기서만, `data-locked`라 바깥 클릭·ESC로 안 닫히고 [확인]으로만 (common.js가 `data-locked` 모달은 ESC·오버레이·`data-modal-close`를 무시). 이메일·임시 비밀번호를 `info-list--wrap`(긴 이메일 아무 위치 줄바꿈, 이 화면만)으로 전체 표시, [로그인 정보 복사]는 "[코나비즈] 로그인 정보 / 이메일: … / 임시 비밀번호: …" 3줄을 한 번에. 실패면 안내 + 로그인 정보 자동 선택
  - 부서는 필수(자유 입력 + datalist, 목록 밖이면 "목록에서 부서를 골라주세요."). 이메일 중복은 회수된 직원이면 다른 문구(회수된 이메일은 재초대 불가)
  - `?dept=개발팀` → 부서 필터(칩 줄 끝 "부서: 개발팀 ×" — Figma에 없어서 추가), `?action=invite|csv` → 모달 바로 열기(열고 나면 주소에서 뺌). 대시보드 빈 상태 버튼은 `?action=…`
  - CSV 업로드 화면은 디자인이 없어 예시 결과(`KonaMock.csvSample`, 24행 중 3행 오류)를 바로 보여줌. 행 검사는 열 때마다 다시 해서, 이미 등록된 이메일은 중복 오류가 됨(21명 추가 뒤 다시 열면 24행 모두 오류)
  - 모달 버튼 등급(6.9): [취소]는 Ghost, 초대·CSV 초대·카드 정지는 Primary, 카드 회수만 Destructive(이름이 정확히 같을 때만 활성). 순서는 보조 왼쪽 · 주 버튼 오른쪽(간격 12), 모바일 하단 시트는 세로로 쌓고 주 버튼 위(간격 8) — `.modal-actions`
  - Tablet(768–1023)은 표를 유지하되 초대일 칸을 숨김(본문 688부터 7칸이면 이메일 칸이 사라져서)
  - 표 행 구분선은 칸마다 inset 그림자로 그리면 칸 경계에 세로 이음새가 보여서 배경 그라디언트(`--row-line`)로 그림
  - Sandbox에서는 sandbox-mode.js가 임직원관리 메뉴를 "체험 불가"로 바꾸고 대시보드 부서 줄 클릭도 토스트로 막음. admin-members.html에는 sandbox-mode.js를 넣지 않음
- 모바일 법인카드는 기획서 6.11대로 비율 400:252 유지 (Figma 모바일 프레임은 335×252)
- 대시보드 하단 2열(카테고리 · 결제 알림)은 1024 미만부터 세로로 쌓음
- Sandbox(sandbox.html): sandbox-bar 아래에 `admin.html?sandbox=1` · `employee.html?sandbox=1`을 iframe 2개로 겹쳐 띄우고 토글로 전환(Dissolve 200ms). 본문 마크업은 복사하지 않음
  - 탭은 주소에 남김: `?view=employee`, 그 밖은 관리자. `history.replaceState`라 방문 기록에 쌓지 않음
  - `?sandbox=1` 동작은 `js/sandbox-mode.js`(app.js보다 먼저 로드): 계정 예시 문구(`KonaMock.sandbox`), 로그아웃 제거, 임직원관리 비활성 + 꼬리표 "체험 불가", 드로어·챗봇 FAB·`#` 링크 외 클릭은 토스트 Info
  - 예약 정보는 `kona.reservation`의 `preferredLabel`(`10/21(수) 14:00`)로 만들고, 저장값이 없으면 숨김
  - 1024 미만은 탭 이름에서 "미리보기"를 뺌(바 한 줄에 맞추려고)
- 챗봇(09, 전역): 패널 마크업은 `js/chatbot.js`가 FAB 앞에 만듦(HTML에 복사하지 않음). 답변은 `js/chat-reply.js`의 `KonaChatReply.get()` 하나 → `POST /api/chat`
  - 하이브리드(7단계): 퀵 리플라이 4개는 서버 규칙 답변(OpenAI 호출 없음), 직접 입력은 OpenAI가 승인된 FAQ만 보고 답함. 답변 문구·FAQ·대체 답변·시스템 프롬프트는 `backend/app/chat_rules.py` 한 곳(프론트에는 버튼 id·이름만). FAQ는 사이트 문구가 바뀌면 같이 고침
  - cta: `booking` [상담 예약하기] · `simulator` [무료로 체험하기] · 없음. 버튼 스타일은 기존 `btn btn--secondary btn--block`
  - OpenAI 실패·타임아웃·키 없음 → 대체 답변 + booking. 서버에 닿지 못하면 기존 실패 표시([다시 보내기]). 422·429는 서버 문구를 답변처럼
  - 사용량 제한: uid 1분 10회 · IP 1분 30회 (메모리). 저장은 `chats` `{uid, conversation_id}` — 로그인이면 users._id, 아니면 anon_id
  - 상태 확인: `?chat=error`(첫 요청만 실패, [다시 보내기]는 성공) · `?chat=offline`. `?chat=` 값이 있으면 패널을 연 채로 시작. sandbox.html은 이 값을 두 iframe에 넘김
  - 대화 기록: localStorage `kona.chat`(최근 20개, 새 메시지 점 포함). 열림 상태·입력 중 문구는 저장하지 않음. 답변을 기다리다 페이지를 옮기면 그 질문은 실패로 표시. 로그인 성공 → 새 대화, 로그아웃(`data-logout`) → 임시 ID까지 삭제. Sandbox iframe끼리는 `storage` 이벤트로 맞춤
  - 모달이 열리면 `common.js`가 패널을 닫음(입력 중 문구 유지). [상담 예약하기]·[무료로 체험하기]: 랜딩은 opener=FAB로 그 모달(유입 경로 `chatbot`), 다른 페이지는 `index.html?action=booking|simulator&source=chatbot`(iframe은 바깥 창 이동)
  - Figma와 다른 점: 입력칸은 textarea 왼쪽 정렬·최대 4줄(7.8), [새 대화 시작]은 아이콘 + aria-label·툴팁. 답변 실패는 Danger 아이콘 16 + Caption(load-error의 "빨강 안 씀"은 패널 전체 실패용)
  - 767 이하 전체 화면: FAB 숨김, 헤더 닫기 버튼, 열 때 입력칸 포커스 안 함, visualViewport 높이에 맞춤
- 결제 테스트(시연용, employee.html 결제내역 위): `POST /api/payments/test` (`backend/app/routers/payments.py`, 임직원 본인만 · 사용자 1분 20회)
  - 판정: 카드 active 아님 → 키워드 규칙(block) "제한 업종" → low·warn은 `review`(확인 필요, 차감 없음 — AI만으로 차단 안 함) → 카드 `points`에 없는 분류 → 잔액 부족 → 승인
  - 저장은 별도 컬렉션 없이 `cards.transactions`에 `$push` + `$position: 0`(Atlas에서 맨 앞). 승인은 "잔액 ≥ 금액" 조건부 `update_one`($inc + $push 한 번)이라 마이너스 불가. 차단·확인 필요도 기록. 추가 필드 `source: "test"` · `category` · `confidence` · `user_id` · `card_id` · `company`
  - 화면 결제내역은 `/api/me/card`가 시각으로 정렬하므로 배열 순서와 무관. `review`는 아이콘 icon-alert-ink + "확인 필요"
  - 화면은 모달 `#modal-paytest`(modal--sm 480, 모바일 하단 시트). 결제내역 제목 줄 오른쪽 [결제 테스트](Secondary, `data-open="paytest"`)로 열고, 입력 화면 → 결과 화면(`data-paytest-view`). 결과 문장은 `[data-paytest-live]`가 읽음
  - 열 때마다 초기화, 결제 중에는 `data-locked` + X·[취소] 비활성. 결과가 나오면 뒤의 포인트·결제내역 바로 갱신, 닫으면 맨 위 행 2초 강조(`.pay-row.is-new`) + 포커스는 [결제 테스트] (결제내역을 다시 그려서 처음 연 버튼이 바뀌므로 modal:close에서 직접 찾음)
  - 버튼은 로드 성공 시에만 — Sandbox · `?state=` 미리보기에는 없음(DB에 안 씀). 이때만 빈 상태 문구가 "[결제 테스트]로 결제해 보세요."
  - 마이페이지 "결제 전에 확인하기"(AI 판별기)는 조회 전용으로 따로 유지
  - `python -m scripts.seed` 재실행 = 테스트 결제 포함 users·cards·reservations·chats 전부 초기화
- 로컬 서버는 5500 하나만 사용(launch.json 포트 고정). 이미 떠 있으면 새로 띄우지 말고 그 서버로 확인

## 작업 방식
- 답변과 진행 상황 설명은 항상 한국어로
- "구조를 먼저 보여줘"라고 하면 확인 질문만 하지 말고 구조 내용을 채팅에 직접 적어서 보여주기