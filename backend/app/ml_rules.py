"""가맹점 분류(ML) 규칙 — 학습 노트북(backend/ml)과 API가 같이 씀.

상호명 → 코나비즈 분류. 판정 방식은 두 가지:
    rule  : 상호명에 유흥주점 계열 키워드가 있으면 바로 restricted (모델보다 먼저)
    model : 나머지는 상호명 글자 n-gram 모델이 업종을 예측해 분류로 합산
정규화는 학습·예측이 반드시 같아야 하므로 이 파일 한 곳에만 둠.
화면 level 기준값(HIGH · EXPENSE_HIGH · WARN)과 근거 업종 표시 이름도 여기 — 화면은 level만 보고 그림.
"""
import re
from pathlib import Path

MODEL_PATH = Path(__file__).resolve().parent.parent / "ml" / "models" / "merchant_classifier.joblib"


def load_model(path: Path = MODEL_PATH) -> dict | None:
    """모델 파일을 불러옴. 없거나 읽을 수 없으면 None (API는 503, seed는 ai 없이 저장)."""
    if not path.is_file():
        return None
    import joblib   # 모델이 있을 때만 scikit-learn을 불러옴
    try:
        return joblib.load(path)
    except Exception:
        return None

# 코나비즈 분류 (js/landing.js 포인트 id + 제한 업종)
CATEGORIES = ("meal", "fitness", "welfare", "expense", "restricted")

NAME_MAX_LEN = 50

# 정규화 뒤(공백 제거·소문자) 기준으로 찾음 — "OO 유흥 주점"도 걸림
RESTRICTED_KEYWORDS = ("유흥주점", "단란주점", "룸살롱", "룸싸롱", "가라오케", "노래빠", "나이트클럽")
RULE_INDUSTRY = "유흥주점 키워드"

_BRACKETS = re.compile(r"\(.*?\)|\[.*?\]")
_CORP = re.compile(r"㈜|\(주\)|주식회사|유한회사")
_NOT_WORD = re.compile(r"[^0-9a-z가-힣]")


def normalize(name: str) -> str:
    """소문자 · 법인 표기·괄호 내용·공백·특수문자 제거."""
    s = (name or "").lower()
    s = _CORP.sub("", s)
    s = _BRACKETS.sub("", s)
    return _NOT_WORD.sub("", s)


def rule_category(name: str) -> str | None:
    """키워드 규칙에 걸리면 'restricted', 아니면 None."""
    key = normalize(name)
    return "restricted" if any(k in key for k in RESTRICTED_KEYWORDS) else None


def model_predict(bundle: dict, name: str) -> dict:
    """모델만으로 예측. 업종 확률을 분류별로 더해 가장 큰 분류를 고르고,
    그 분류 안에서 확률이 가장 높은 업종을 근거로 씀.
    bundle = backend/ml/models/merchant_classifier.joblib (vectorizer · clf · unit_category)"""
    clf = bundle["clf"]
    units = [str(u) for u in clf.classes_]
    proba = clf.predict_proba(bundle["vectorizer"].transform([normalize(name)]))[0]
    unit_cat = bundle["unit_category"]
    by_cat: dict[str, float] = {}
    for unit, p in zip(units, proba):
        by_cat[unit_cat[unit]] = by_cat.get(unit_cat[unit], 0.0) + float(p)
    category = max(by_cat, key=by_cat.get)
    best = max((i for i, u in enumerate(units) if unit_cat[u] == category), key=lambda i: proba[i])
    return {"category": category, "confidence": round(by_cat[category], 4), "industry": units[best]}


def classify(bundle: dict, name: str) -> dict:
    """규칙 → 모델 순서. {category, confidence, industry(학습 업종명), source} — 노트북 평가용"""
    if rule_category(name):
        return {"category": "restricted", "confidence": 1.0, "industry": RULE_INDUSTRY, "source": "rule"}
    return {**model_predict(bundle, name), "source": "model"}


# ---------- 화면 정책 (API · seed가 씀) ----------

# 확신도 기준값 — ML-2 평가(그룹 분할)로 정함
HIGH = 0.6           # 이상이면 '예상(높음)'. 이상 73.4% · 정확도 0.915 / 미만 0.611
EXPENSE_HIGH = 0.7   # 법인경비P만 더 높게. ≥0.7 precision 0.671 (0.6이면 0.563)
WARN = 0.9           # 모델 restricted가 이상이면 '주의'. 그래도 precision 0.351이라 차단으로 단정하지 않음

LEVELS = ("block", "warn", "high", "low")

# 근거 업종 표시 이름 — 공공데이터 업종명이 어색한 것만. 나머지는 업종명 그대로
INDUSTRY_LABEL = {
    "비알코올": "카페·음료점",
    "기타 간이": "분식·간편식",
    "기타 외국": "외국 음식",
    "종합 소매": "편의점·마트",
    "기타 상품 소매": "생활용품 매장",
    "일반 교육": "입시·교과 학원",
    "기타 교육": "예체능·기타 학원",
    "문구/회화용품 소매업": "문구점",
    "스포츠 서비스": "체육시설",
}


def level_of(result: dict) -> str:
    """판정 → 화면 level. block(규칙) · warn(모델 restricted ≥ WARN) · high · low"""
    if result["source"] == "rule":
        return "block"
    cat, conf = result["category"], result["confidence"]
    if cat == "restricted":
        return "warn" if conf >= WARN else "low"
    return "high" if conf >= (EXPENSE_HIGH if cat == "expense" else HIGH) else "low"


def judge(bundle: dict, name: str) -> dict:
    """화면용 판정 {category, confidence, industry(표시 이름), source, level}"""
    r = classify(bundle, name)
    return {**r, "industry": INDUSTRY_LABEL.get(r["industry"], r["industry"]), "level": level_of(r)}
