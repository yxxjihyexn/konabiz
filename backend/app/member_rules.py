"""임직원·카드 상태 규칙 — members 라우터 · 로그인 · seed가 같이 씀.

상태 전이 (사용자 상태를 바꾸면 카드 상태도 같이 바꿈):
    invited   → 임시 비밀번호 재발급(상태 유지) · revoke
    active    → suspend · revoke
    suspended → resume · revoke
    revoked   → 없음 (되돌릴 수 없음)
첫 로그인으로 invited → active가 될 때 카드도 issuing → active (routers/auth.py).
"""
import secrets

# 08 임직원관리 · 05 대시보드 부서 목록 (js/mock-data.js DEPTS와 같음)
DEPTS = ("영업1팀", "마케팅팀", "개발팀")

STATUSES = ("invited", "active", "suspended", "revoked")

# 회원 상태 → 카드 상태 (초대됨은 카드 발급 중)
CARD_STATUS = {"invited": "issuing", "active": "active", "suspended": "suspended", "revoked": "revoked"}

# 포인트 4종 시작 잔액 (mock employee.start — 모든 카드 같은 값)
START_POINTS = {"meal": 150000, "fitness": 100000, "welfare": 100000, "expense": 500000}

# 동작 → (지금 상태가 이 중 하나일 때만, 바뀔 상태)
ACTIONS = {
    "suspend": (("active",), "suspended"),
    "resume": (("suspended",), "active"),
    "revoke": (("invited", "active", "suspended"), "revoked"),
}

# 임시 비밀번호 — 헷갈리는 문자(0 O o · 1 l I) 제외
TEMP_PASSWORD_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"
TEMP_PASSWORD_LENGTH = 12


def new_temp_password() -> str:
    """읽기 쉬운 문자만, 영문·숫자가 하나 이상 섞이게."""
    while True:
        pw = "".join(secrets.choice(TEMP_PASSWORD_CHARS) for _ in range(TEMP_PASSWORD_LENGTH))
        if any(c.isdigit() for c in pw) and any(c.isalpha() for c in pw):
            return pw


def start_points() -> dict:
    return {k: {"start": v, "balance": v} for k, v in START_POINTS.items()}
