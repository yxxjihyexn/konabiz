"""가맹점 판별 API 테스트 — 모델 로드 · 입력 검증 · 응답 형식 · level 기준 · 503 · 429.

실행 (backend 폴더에서): python -m unittest discover -s tests -t . -v
모델 파일(backend/ml/models/merchant_classifier.joblib)이 없으면 실제 모델 테스트만 건너뜀.
"""
import unittest
from pathlib import Path
from unittest import mock

from fastapi import HTTPException
from starlette.requests import Request

from app import ml_rules as M
from app.routers import ml as ML

HAS_MODEL = M.MODEL_PATH.is_file()


def request_with(ip="10.0.0.1"):
    return Request({"type": "http", "method": "POST", "path": "/api/ml/classify", "headers": [], "client": (ip, 5000)})


class LevelTest(unittest.TestCase):
    """화면 정책 — level은 서버가 계산"""

    def level(self, category, confidence, source="model"):
        return M.level_of({"category": category, "confidence": confidence, "source": source})

    def test_rule_is_block(self):
        self.assertEqual(self.level("restricted", 1.0, "rule"), "block")

    def test_model_restricted_is_never_block(self):
        self.assertEqual(self.level("restricted", 0.95), "warn")
        self.assertEqual(self.level("restricted", M.WARN), "warn")
        self.assertEqual(self.level("restricted", 0.89), "low")

    def test_high_threshold(self):
        self.assertEqual(self.level("meal", M.HIGH), "high")
        self.assertEqual(self.level("meal", 0.59), "low")
        self.assertEqual(self.level("welfare", 0.6), "high")

    def test_expense_needs_higher(self):
        self.assertEqual(self.level("expense", 0.65), "low")
        self.assertEqual(self.level("expense", M.EXPENSE_HIGH), "high")

    def test_rule_keywords_after_normalize(self):
        for name in ("블루문 유흥주점", "OO 유흥 주점", "(주)스타 단란주점", "별노래빠"):
            self.assertEqual(M.rule_category(name), "restricted", name)
        for name in ("스타벅스", "노래연습장", "투다리"):
            self.assertIsNone(M.rule_category(name), name)

    def test_load_model_missing_file(self):
        self.assertIsNone(M.load_model(Path("없는-모델.joblib")))


class ClassifyApiTest(unittest.TestCase):
    def setUp(self):
        ML.limiter.reset()
        self.addCleanup(ML.limiter.reset)

    def call(self, name, ip="10.0.0.1"):
        return ML.classify(request_with(ip), {"name": name})

    def assert_status(self, status, name, detail=None):
        with self.assertRaises(HTTPException) as cm:
            self.call(name)
        self.assertEqual(cm.exception.status_code, status)
        if detail:
            self.assertEqual(cm.exception.detail, detail)

    def test_empty_and_blank_422(self):
        for name in ("", "   ", None, 123):
            self.assert_status(422, name, ML.MSG_EMPTY)

    def test_too_long_422(self):
        self.assert_status(422, "가" * 51, "가맹점 이름은 50자까지 입력할 수 있어요.")

    def test_50_chars_after_strip_ok(self):
        with mock.patch.object(ML, "model", {}), mock.patch.object(M, "classify", return_value={
                "category": "meal", "confidence": 0.9, "industry": "한식", "source": "model"}):
            self.assertEqual(self.call("  " + "가" * 50 + "  ")["level"], "high")

    def test_model_missing_503(self):
        with mock.patch.object(ML, "model", None):
            self.assert_status(503, "스타벅스", ML.MSG_UNAVAILABLE)

    def test_predict_error_503(self):
        with mock.patch.object(ML, "model", {}), mock.patch.object(M, "classify", side_effect=ValueError("x")):
            self.assert_status(503, "스타벅스", ML.MSG_UNAVAILABLE)

    def test_rule_without_model_call(self):
        """규칙 판정은 모델을 쓰지 않음 (빈 bundle이어도 됨)"""
        with mock.patch.object(ML, "model", {}):
            r = self.call("블루문 유흥주점")
        self.assertEqual(r, {"category": "restricted", "confidence": 1.0, "industry": M.RULE_INDUSTRY,
                             "source": "rule", "level": "block"})

    def test_industry_display_label(self):
        with mock.patch.object(ML, "model", {}), mock.patch.object(M, "classify", return_value={
                "category": "meal", "confidence": 0.54, "industry": "비알코올", "source": "model"}):
            r = self.call("스타벅스")
        self.assertEqual((r["industry"], r["level"]), ("카페·음료점", "low"))

    def test_rate_limit_per_ip(self):
        with mock.patch.object(ML, "model", {}):
            for _ in range(ML.RATE_IP):
                self.call("블루문 유흥주점")
            self.assert_status(429, "블루문 유흥주점", ML.MSG_RATE)
            self.assertEqual(self.call("블루문 유흥주점", ip="10.0.0.2")["level"], "block")   # 다른 IP는 따로


@unittest.skipUnless(HAS_MODEL, "모델 파일 없음")
class RealModelTest(unittest.TestCase):
    """저장된 최종 모델 — 응답 형식과 데모 상호명"""

    @classmethod
    def setUpClass(cls):
        cls.bundle = M.load_model()

    def test_loaded_bundle(self):
        self.assertIsNotNone(self.bundle)
        self.assertEqual(set(self.bundle["unit_category"].values()), set(M.CATEGORIES))

    def test_response_shape(self):
        r = M.judge(self.bundle, "달빛우동 성수점")
        self.assertEqual(set(r), {"category", "confidence", "industry", "source", "level"})
        self.assertIn(r["category"], M.CATEGORIES)
        self.assertIn(r["level"], M.LEVELS)
        self.assertTrue(0 <= r["confidence"] <= 1)

    def test_demo_chips(self):
        expect = {"달빛우동 성수점": ("meal", "high"), "애니타임피트니스": ("fitness", "high"),
                  "새벽별문구": ("expense", "high"), "블루문 유흥주점": ("restricted", "block")}
        for name, (cat, level) in expect.items():
            r = M.judge(self.bundle, name)
            self.assertEqual((r["category"], r["level"]), (cat, level), name)


if __name__ == "__main__":
    unittest.main()
