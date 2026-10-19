@AGENTS.md

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
- 상담예약 예시 주: 10/19~10/23 (마감 수 11:00·15:00, 목 10:00), 10/26~10/30 (마감 없음) — `js/landing.js`
- 로그인은 서버 연결 전까지 `js/landing.js`의 `DEMO_ACCOUNTS` 예시 계정 사용
- 점선 테두리(카드 발급 중 자리)만 예외로 `border: 1px dashed` 사용 — 그림자로는 점선을 그릴 수 없음
- 앱 화면(admin.html · employee.html): 사이드바 마크업은 HTML 한 곳에만 두고, 1024 미만 드로어는 `js/app.js`가 복사함. 선택된 메뉴는 `aria-current="page"`, 준비 중 메뉴는 링크가 아닌 `<span aria-disabled="true">`
- 앱 화면 예시 데이터는 `js/mock-data.js` (기획서 9.7) — 숫자 합계가 서로 맞아야 함
- 상태 화면은 `?state=`로 전환 (목록에 없는 값은 Default)
  - admin.html: `empty`
  - employee.html: `suspended` · `issuing` · `no-payments` · `loading` · `error`
  - admin-members.html: `empty` (0명에서 시작, 초대하면 실제로 목록으로 바뀜)
- 부서는 영업1팀·마케팅팀·개발팀 3개, 대시보드 카드 수는 members에서 계산 (`KonaMock.activeCards()` = 초대됨 + 사용 중, 지금 21 = 6 + 7 + 8). 9.7의 "활성 카드 24장"보다 이 규칙이 우선
- 임직원관리(admin-members.html · `js/admin-members.js`): 필터·검색·페이지·초대·CSV·⋯ 메뉴·정지·정지 해제·회수는 상태 페이지 없이 실제 동작으로. 바뀐 값은 새로고침하면 처음으로 돌아감
  - `?dept=개발팀` → 부서 필터(칩 줄 끝 "부서: 개발팀 ×" — Figma에 없어서 추가), `?action=invite|csv` → 모달 바로 열기(열고 나면 주소에서 뺌). 대시보드 빈 상태 버튼은 `?state=empty&action=…`
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
- 챗봇(09, 전역): 패널 마크업은 `js/chatbot.js`가 FAB 앞에 만듦(HTML에 복사하지 않음). 답변은 `js/chat-reply.js`의 `KonaChatReply.get()` 하나 — FastAPI 연결 시 이 함수 본문만 fetch로 교체
  - 예시 답변: 퀵 리플라이 4개는 정해진 문구(도입·비용·상담예약은 [상담 예약하기] 포함), 직접 입력은 "정확한 안내는 상담에서 도와드려요" + [상담 예약하기]. 입력 중 표시 1초
  - 상태 확인: `?chat=error`(첫 요청만 실패, [다시 보내기]는 성공) · `?chat=offline`. `?chat=` 값이 있으면 패널을 연 채로 시작. sandbox.html은 이 값을 두 iframe에 넘김
  - 대화 기록: localStorage `kona.chat`(최근 20개, 새 메시지 점 포함). 열림 상태·입력 중 문구는 저장하지 않음. 답변을 기다리다 페이지를 옮기면 그 질문은 실패로 표시. 로그인 성공 → 새 대화, 로그아웃(`data-logout`) → 임시 ID까지 삭제. Sandbox iframe끼리는 `storage` 이벤트로 맞춤
  - 모달이 열리면 `common.js`가 패널을 닫음(입력 중 문구 유지). [상담 예약하기]: 랜딩은 opener=FAB로 상담예약 모달(유입 경로 `chatbot`), 다른 페이지는 `index.html?action=booking&source=chatbot`(iframe은 바깥 창 이동)
  - Figma와 다른 점: 입력칸은 textarea 왼쪽 정렬·최대 4줄(7.8), [새 대화 시작]은 아이콘 + aria-label·툴팁. 답변 실패는 Danger 아이콘 16 + Caption(load-error의 "빨강 안 씀"은 패널 전체 실패용)
  - 767 이하 전체 화면: FAB 숨김, 헤더 닫기 버튼, 열 때 입력칸 포커스 안 함, visualViewport 높이에 맞춤
- 로컬 서버는 5500 하나만 사용(launch.json 포트 고정). 이미 떠 있으면 새로 띄우지 말고 그 서버로 확인

## 작업 방식
- 답변과 진행 상황 설명은 항상 한국어로
- "구조를 먼저 보여줘"라고 하면 확인 질문만 하지 말고 구조 내용을 채팅에 직접 적어서 보여주기