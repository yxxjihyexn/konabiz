@AGENTS.md

## 구현 결정 사항

- 포커스 표시: `outline: 2px solid #0E7490; outline-offset: 2px` (기획서의 Cyan200 글로우 링 대체 — 대비 기준 때문). 토큰은 `style.css`의 `--focus-outline` · `--focus-offset`
- 테두리: `border` 대신 `box-shadow: inset`으로 그림 (Figma Stroke Inside처럼 크기에 영향 없게). 장식·그룹핑 `inset 0 0 0 0.5px`, 인터랙티브 `inset 0 0 0 1px`, 한쪽 선 `inset 0 ±0.5px 0`
- 상담예약 예시 주: 10/19~10/23 (마감 수 11:00·15:00, 목 10:00), 10/26~10/30 (마감 없음) — `js/landing.js`
- 로그인은 서버 연결 전까지 `js/landing.js`의 `DEMO_ACCOUNTS` 예시 계정 사용
