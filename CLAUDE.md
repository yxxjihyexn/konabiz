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
- 모바일 법인카드는 기획서 6.11대로 비율 400:252 유지 (Figma 모바일 프레임은 335×252)
- 대시보드 하단 2열(카테고리 · 결제 알림)은 1024 미만부터 세로로 쌓음
- Sandbox(sandbox.html): sandbox-bar 아래에 `admin.html?sandbox=1` · `employee.html?sandbox=1`을 iframe 2개로 겹쳐 띄우고 토글로 전환(Dissolve 200ms). 본문 마크업은 복사하지 않음
  - 탭은 주소에 남김: `?view=employee`, 그 밖은 관리자. `history.replaceState`라 방문 기록에 쌓지 않음
  - `?sandbox=1` 동작은 `js/sandbox-mode.js`(app.js보다 먼저 로드): 계정 예시 문구(`KonaMock.sandbox`), 로그아웃 제거, 임직원관리 비활성 + 꼬리표 "체험 불가", 드로어·챗봇 FAB·`#` 링크 외 클릭은 토스트 Info
  - 예약 정보는 `kona.reservation`의 `preferredLabel`(`10/21(수) 14:00`)로 만들고, 저장값이 없으면 숨김
  - 1024 미만은 탭 이름에서 "미리보기"를 뺌(바 한 줄에 맞추려고)

## 작업 방식
- 답변과 진행 상황 설명은 항상 한국어로
- "구조를 먼저 보여줘"라고 하면 확인 질문만 하지 말고 구조 내용을 채팅에 직접 적어서 보여주기