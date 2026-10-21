"""원본 CSV → 학습용 이름 표 (원본은 읽기만, 파일로 다시 쓰지 않음).

1. 이름 자리에 업종명·"업소명없음"이 들어간 행, 정규화 후 2글자 미만 제외
2. 정규화 이름 단위로 합침 (체인점 한 표) — 분류는 다수결, 다수 비율 60% 미만이면 제외
3. 그룹 키 = 정규화 이름 앞 3글자 → 같은 브랜드(지점명 붙은 변형 포함)가 학습·평가에 나뉘지 않게
"""
import sys
from pathlib import Path

import pandas as pd

ML_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(ML_DIR.parent))  # backend/ → app.ml_rules

from app.ml_rules import normalize  # noqa: E402
from category_map import to_unit  # noqa: E402

DATA_CSV = ML_DIR / "data" / "소상공인시장진흥공단_상가(상권)정보_서울_202606.csv"
COLS = ["상호명", "상권업종대분류명", "상권업종중분류명", "상권업종소분류명", "표준산업분류명"]
MIN_AGREE = 0.6
GROUP_PREFIX = 3


def load_raw(path: Path = DATA_CSV) -> pd.DataFrame:
    df = pd.read_csv(path, usecols=COLS, dtype=str, encoding="utf-8").fillna("")
    units = {k: to_unit(*k) for k in set(zip(df["상권업종중분류명"], df["상권업종소분류명"]))}
    pairs = [units[k] for k in zip(df["상권업종중분류명"], df["상권업종소분류명"])]
    df["unit"] = [p[0] for p in pairs]
    df["category"] = [p[1] for p in pairs]
    df["key"] = df["상호명"].map(normalize)
    return df


def placeholder_mask(df: pd.DataFrame) -> pd.Series:
    small = df["상권업종소분류명"].map(normalize)
    ksic = df["표준산업분류명"].map(normalize)
    return (df["상호명"].str.strip() == "업소명없음") | (df["key"] == small) | (df["key"] == ksic) | df["key"].str.startswith("그외기타")


def build_names(df: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """정규화 이름 1행 = 학습 샘플 1개. (names, 정리 통계)"""
    stats = {"rows": len(df)}
    ph = placeholder_mask(df)
    short = df["key"].str.len() < 2
    stats["placeholder"] = int(ph.sum())
    stats["short"] = int((short & ~ph).sum())
    d = df[~ph & ~short]

    cat_counts = d.groupby(["key", "category"]).size().rename("n").reset_index()
    total = cat_counts.groupby("key")["n"].transform("sum")
    cat_counts["share"] = cat_counts["n"] / total
    top = cat_counts.sort_values(["key", "n"], ascending=[True, False]).drop_duplicates("key")
    stats["conflict_names"] = int((cat_counts.groupby("key").size() > 1).sum())
    stats["dropped_low_agree"] = int((top["share"] < MIN_AGREE).sum())
    top = top[top["share"] >= MIN_AGREE]

    # 이긴 분류 안에서 가장 많은 업종 = 학습 단위
    unit_counts = d.merge(top[["key", "category"]], on=["key", "category"]).groupby(["key", "unit"]).size().rename("n").reset_index()
    unit_top = unit_counts.sort_values(["key", "n"], ascending=[True, False]).drop_duplicates("key")
    names = top[["key", "category", "n"]].rename(columns={"n": "rows"}).merge(unit_top[["key", "unit"]], on="key")
    # 사람이 읽을 대표 원래 이름
    display = d.drop_duplicates("key").set_index("key")["상호명"]
    names["name"] = names["key"].map(display)
    names["group"] = names["key"].str[:GROUP_PREFIX]
    stats["names"] = len(names)
    return names.reset_index(drop=True), stats
