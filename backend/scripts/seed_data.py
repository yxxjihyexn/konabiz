"""데모 데이터 — js/mock-data.js(기획서 9.7)를 Python으로 옮겨 적은 것.

mock-data.js를 고치면 여기도 같이 고친다. 숫자가 어긋나면 seed.py의 검사(assert)에서 멈춤.
mock-data.js에 없는 것: 데모 로그인 이메일·비밀번호(README의 데모 계정),
예약 3건(03 예약 화면의 "마감" 칸과 맞춤), 챗봇 대화 1건(구조 확인용 예시).
"""

COMPANY = "가나다테크(주)"

# 관리자 — 이메일은 데모 로그인 계정
ADMIN = {"name": "김철수", "email": "admin@ganada.co.kr", "created": (2026, 6, 1)}

# 임직원 24명 — 이름, 이메일, 부서, 카드 끝 4자리, 상태, 초대일 (mock-data.js members 순서 그대로)
# 김민준만 데모 로그인 이메일로 바꿈 (mock은 minjun.kim@company.co.kr)
DEMO_EMPLOYEE_NAME = "김민준"
DEMO_EMPLOYEE_EMAIL = "employee@ganada.co.kr"

# 데모 로그인 비밀번호 (발표 시연용, 두 계정 같음) — DB에는 해시만 들어감
# 나머지 23명은 비밀번호 없음 = 로그인 불가 (5단계 초대에서 임시 비밀번호 발급)
DEMO_PASSWORD = "kona-demo-1234"

MEMBERS = [
    ("윤채원", "chaewon.yoon@company.co.kr", "마케팅팀", "9143", "invited", (2026, 10, 11)),
    ("박지호", "jiho.park@company.co.kr", "영업1팀", "7720", "invited", (2026, 10, 10)),
    ("오시우", "siwoo.oh@company.co.kr", "개발팀", "0419", "active", (2026, 9, 15)),
    ("한소율", "soyul.han@company.co.kr", "마케팅팀", "8370", "active", (2026, 9, 12)),
    ("강도윤", "doyun.kang@company.co.kr", "영업1팀", "2287", "active", (2026, 9, 8)),
    ("정하늘", "haneul.jung@company.co.kr", "개발팀", "6612", "suspended", (2026, 9, 5)),
    ("최유진", "yujin.choi.people-operations@company.co.kr", "마케팅팀", "3054", "active", (2026, 9, 3)),
    ("김민준", "minjun.kim@company.co.kr", "개발팀", "4821", "active", (2026, 9, 1)),
    ("이서연", "seoyeon.lee@company.co.kr", "마케팅팀", "1937", "active", (2026, 9, 1)),
    ("임건우", "geonwoo.lim@company.co.kr", "영업1팀", "5506", "revoked", (2026, 8, 20)),
    ("송예준", "yejun.song@company.co.kr", "개발팀", "3362", "active", (2026, 8, 18)),
    ("문지아", "jia.moon@company.co.kr", "영업1팀", "7045", "active", (2026, 8, 14)),
    ("배서준", "seojun.bae@company.co.kr", "개발팀", "1586", "active", (2026, 8, 11)),
    ("조하린", "harin.jo@company.co.kr", "마케팅팀", "9271", "active", (2026, 8, 5)),
    ("신우진", "woojin.shin@company.co.kr", "영업1팀", "4408", "suspended", (2026, 7, 29)),
    ("권나은", "naeun.kwon@company.co.kr", "개발팀", "6630", "active", (2026, 7, 22)),
    ("황준서", "junseo.hwang@company.co.kr", "영업1팀", "2754", "active", (2026, 7, 15)),
    ("안수아", "sua.ahn@company.co.kr", "마케팅팀", "8119", "invited", (2026, 7, 8)),
    ("류도현", "dohyun.ryu@company.co.kr", "개발팀", "5093", "active", (2026, 7, 1)),
    ("홍지우", "jiwoo.hong@company.co.kr", "영업1팀", "3817", "active", (2026, 6, 24)),
    ("전시윤", "siyun.jeon@company.co.kr", "개발팀", "7462", "active", (2026, 6, 17)),
    ("고은서", "eunseo.go@company.co.kr", "마케팅팀", "1208", "active", (2026, 6, 10)),
    ("남현우", "hyunwoo.nam@company.co.kr", "영업1팀", "6954", "active", (2026, 6, 3)),
    ("서유나", "yuna.seo@company.co.kr", "개발팀", "0873", "active", (2026, 6, 1)),
]

# 회원 상태 → 카드 상태 (초대됨은 카드 발급 중)
CARD_STATUS = {"invited": "issuing", "active": "active", "suspended": "suspended", "revoked": "revoked"}

# 포인트 4종 시작 잔액 (mock employee.start — 모든 카드 같은 값)
START_POINTS = {"meal": 150000, "fitness": 100000, "welfare": 100000, "expense": 500000}

# 김민준 최근 거래 — (월, 일), 가맹점, 포인트(차단은 None), 금액, 차단 사유
DEMO_PAYMENTS = [
    ((10, 16), "스타벅스 강남점", "meal", 4500, None),
    ((10, 15), "라운지바 강남", None, 30000, "유흥주점은 제한 업종이에요"),
    ((10, 14), "애니타임피트니스", "fitness", 30000, None),
    ((10, 13), "교보문고", "welfare", 18000, None),
    ((10, 12), "오피스디포", "expense", 12000, None),
    ((10, 10), "김밥천국", "meal", 7500, None),
    ((10, 8), "한솥도시락", "meal", 18000, None),
]
# mock-data.js 주석의 남은 잔액 — seed에서 계산값과 비교
DEMO_BALANCES = {"meal": 120000, "fitness": 70000, "welfare": 82000, "expense": 488000}

# 상담예약 — 03 예약 화면의 예시 마감 칸 (수 10/21 11:00·15:00, 목 10/22 10:00)
# (월, 일, 시)는 KST. contact_title·email은 폼에서 선택 항목이라 빈 값 허용
RESERVATIONS = [
    {
        "slot": (10, 21, 11),
        "company_name": "하늘물산(주)", "employee_count": 120, "card_count": 40,
        "contact_name": "이지은", "contact_title": "인사팀장",
        "phone": "010-2345-6789", "email": "jieun.lee@haneul.co.kr",
        "consultation_type": "phone", "address": None,
        "custom_preset": {"time_range": [9, 20], "limit_amount": 50000, "categories": ["restaurant", "fitness", "office"]},
        "source": "hero", "created": (10, 17, 10, 24),
    },
    {
        "slot": (10, 21, 15),
        "company_name": "바다소프트", "employee_count": 45, "card_count": 15,
        "contact_name": "박준영", "contact_title": "",
        "phone": "010-3456-7890", "email": "",
        "consultation_type": "visit", "address": "서울특별시 강남구 테헤란로 123, 4층",
        "custom_preset": {"time_range": [8, 22], "limit_amount": 30000, "categories": ["restaurant", "cafe"]},
        "source": "closing-cta", "created": (10, 18, 14, 5),
    },
    {
        "slot": (10, 22, 10),
        "company_name": "산들푸드(주)", "employee_count": 300, "card_count": 100,
        "contact_name": "최수빈", "contact_title": "총무팀 과장",
        "phone": "010-4567-8901", "email": "subin.choi@sandeul.co.kr",
        "consultation_type": "phone", "address": None,
        "custom_preset": {"time_range": [9, 20], "limit_amount": 50000, "categories": ["restaurant", "fitness", "office", "travel"]},
        "source": "chatbot", "created": (10, 19, 9, 41),
    },
]

# 챗봇 대화 — 김민준(로그인 사용자) 1건. 답변 문구는 js/chat-reply.js 퀵 리플라이 그대로
# 메시지: from, 문구, cta, (월, 일, 시, 분, 초) KST
DEMO_CHAT = {
    "conversation_id": "demo-conv-0001",
    "messages": [
        ("user", "결제 제한은 어떻게 설정하나요?", None, (10, 16, 9, 30, 0)),
        ("bot", "관리자 대시보드에서 부서·임직원별로 사용 시간, 한도, 업종을 정할 수 있어요. 정한 규칙은 결제하는 순간 바로 적용돼요.", None, (10, 16, 9, 30, 1)),
    ],
}
