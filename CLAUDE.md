@AGENTS.md

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
