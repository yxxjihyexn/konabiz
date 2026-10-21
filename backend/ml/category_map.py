"""상권업종 → 코나비즈 분류 변환표 (ML-1 승인본).

학습 단위(=근거 업종)는 중분류. 다른 분류로 보내야 하는 소분류만 따로 떼어
그 소분류를 하나의 학습 단위로 씀 (근거 업종에 소분류명이 보임).
표에 없는 업종은 모두 welfare — 복지P는 제한 업종을 뺀 모든 가맹점의 기본 차감.

    python backend/ml/category_map.py   →  backend/ml/category_map.csv (README·발표용 표)
"""
import csv
from pathlib import Path

# 중분류 → 분류 (공공데이터 중분류명 끝 공백은 strip해서 비교)
MID_MAP = {
    # meal — 일반음식점 · 커피전문점 (주점 제외)
    "한식": "meal", "기타 간이": "meal", "비알코올": "meal", "일식": "meal", "서양식": "meal",
    "중식": "meal", "동남아시아": "meal", "구내식당·뷔페": "meal", "기타 외국": "meal",
    # meal — 도서·학원 (시뮬레이터 규칙)
    "일반 교육": "meal", "교육 지원": "meal", "기타 교육": "meal",
    # fitness — 체력단련·골프 · 병원
    "스포츠 서비스": "fitness", "의원": "fitness", "병원": "fitness",
    # expense — 출장(숙박·항공) · 사무
    "일반 숙박": "expense", "여행사·보조": "expense", "사무 지원": "expense",
}

# 소분류 → 분류 (중분류 규칙보다 먼저). 각 행이 별도 학습 단위가 됨
SMALL_MAP = {
    # restricted — 유흥주점 계열만 (요리 주점·생맥주 전문은 주점=welfare)
    "일반 유흥 주점": "restricted", "무도 유흥 주점": "restricted",
    # fitness — 이름은 학원이지만 운동
    "요가/필라테스 학원": "fitness", "태권도/무술학원": "fitness", "레크리에이션 교육기관": "fitness",
    "약국": "fitness",
    # welfare — 스포츠 서비스·일반 숙박에서 뺌
    "당구장": "welfare", "펜션": "welfare",
    # meal — 도서
    "서점": "meal",
    # expense — 사무용품 · 출장 교통
    "문구/회화용품 소매업": "expense", "사무기기 소매업": "expense", "컴퓨터/사무기기 대여업": "expense",
    "자동차 대여업": "expense", "주유소": "expense", "가스 충전소": "expense",
}

# 승인 메모 (README·발표용 이유) — 표에 함께 출력
REASONS = {
    "meal": "일반음식점·커피전문점·도서·학원",
    "fitness": "체력단련·골프·병원·약국",
    "expense": "사무용품·출장(숙박·항공·교통)",
    "restricted": "유흥주점",
    "welfare": "전용 포인트가 없는 가맹점 (복지P 기본 차감)",
}


def to_unit(mid: str, small: str) -> tuple[str, str]:
    """(학습 단위 = 근거 업종명, 코나비즈 분류)."""
    mid, small = mid.strip(), small.strip()
    if small in SMALL_MAP:
        return small, SMALL_MAP[small]
    return mid, MID_MAP.get(mid, "welfare")


def export_csv(source_csv: Path, out_csv: Path) -> None:
    """원본에서 (대·중·소분류 → 학습 단위 → 분류) 표와 업소 수를 뽑아 저장."""
    counts: dict[tuple, int] = {}
    with open(source_csv, encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            key = (row["상권업종대분류명"], row["상권업종중분류명"].strip(), row["상권업종소분류명"].strip())
            counts[key] = counts.get(key, 0) + 1
    rows = []
    for (big, mid, small), n in counts.items():
        unit, cat = to_unit(mid, small)
        rows.append((cat, big, mid, small, unit, n, "소분류" if small in SMALL_MAP else "중분류"))
    order = {c: i for i, c in enumerate(("meal", "fitness", "expense", "restricted", "welfare"))}
    rows.sort(key=lambda r: (order[r[0]], r[1], r[2], -r[5]))
    with open(out_csv, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["코나비즈분류", "대분류", "중분류", "소분류", "근거업종", "업소수", "적용기준", "이유"])
        for r in rows:
            w.writerow([*r, REASONS[r[0]]])


if __name__ == "__main__":
    here = Path(__file__).parent
    export_csv(here / "data" / "소상공인시장진흥공단_상가(상권)정보_서울_202606.csv", here / "category_map.csv")
    print("saved", here / "category_map.csv")
