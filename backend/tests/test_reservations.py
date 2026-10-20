"""예약 규칙·검사 테스트 — DB 없이 돌아감.

실행 (backend 폴더에서): python -m unittest discover -s tests -t . -v
"""
import unittest
from datetime import date, datetime

from app import reservation_rules as R
from app.routers.reservations import validate


def kst(y, m, d, h=0, mi=0):
    return datetime(y, m, d, h, mi, tzinfo=R.KST)


def body(**over):
    b = {
        "company_name": "테스트(주)", "employee_count": "1,200", "card_count": "30",
        "contact_name": "홍길동", "contact_title": "", "phone": "010 1234 5678", "email": "",
        "consultation_type": "phone", "address": "",
        "preferred_at": "2026-11-19T14:00:00+09:00",
        "custom_preset": {"time_range": [9, 20], "limit_amount": 50000, "categories": ["restaurant", "office"]},
        "source": "hero",
    }
    b.update(over)
    return b


NOW = kst(2026, 11, 18, 12, 30)   # 11월 중순 수요일 12:30 가정


class WindowTest(unittest.TestCase):
    def test_mid_november(self):
        days = R.window_days(NOW)
        self.assertEqual(days[0], date(2026, 11, 16))    # 그 주 월요일
        self.assertEqual(days[-1], date(2026, 11, 27))   # 다음 주 금요일
        self.assertEqual(len(days), 10)
        self.assertTrue(all(d.weekday() < 5 for d in days))
        opens = R.open_slots(NOW)
        # 이번 주: 수 14~17시 4칸 + 목·금 12칸 = 16, 다음 주 30칸
        self.assertEqual(len(opens), 46)
        self.assertEqual(opens[0], kst(2026, 11, 18, 14))

    def test_weekend_shows_next_week_only(self):
        sat = kst(2026, 11, 21, 10)
        self.assertEqual(R.window_start(sat), date(2026, 11, 16))
        opens = R.open_slots(sat)
        self.assertEqual(len(opens), 30)                 # 이번 주는 모두 지남
        self.assertEqual(opens[0], kst(2026, 11, 23, 10))

    def test_year_boundary(self):
        thu = kst(2026, 12, 31, 18)
        self.assertEqual(R.window_days(thu)[0], date(2026, 12, 28))
        self.assertEqual(R.window_days(thu)[-1], date(2027, 1, 8))
        self.assertEqual(R.open_slots(thu)[0], kst(2027, 1, 1, 10))

    def test_kst_date_not_utc_date(self):
        # UTC로는 일요일 16:00이지만 KST로는 월요일 01:00 → 새 주
        mon = datetime.fromisoformat("2026-11-22T16:00:00+00:00")
        self.assertEqual(R.window_start(mon), date(2026, 11, 23))

    def test_slot_error(self):
        self.assertIsNone(R.slot_error(kst(2026, 11, 19, 14), NOW))
        self.assertEqual(R.slot_error(kst(2026, 11, 18, 11), NOW), "past")
        self.assertEqual(R.slot_error(kst(2026, 11, 18, 12, 30), NOW), "unavailable")   # 정각 아님
        self.assertEqual(R.slot_error(kst(2026, 11, 19, 12), NOW), "unavailable")       # 점심
        self.assertEqual(R.slot_error(kst(2026, 11, 21, 10), NOW), "unavailable")       # 토요일
        self.assertEqual(R.slot_error(kst(2026, 11, 30, 10), NOW), "unavailable")       # 범위 밖

    def test_next_weekdays(self):
        fri = kst(2026, 11, 20, 9)
        self.assertEqual(R.next_weekdays(fri, 2), [date(2026, 11, 23), date(2026, 11, 24)])
        for d in R.next_weekdays(fri, 2):
            self.assertIn(d, R.window_days(fri))   # seed 예약은 항상 화면 범위 안


class ValidateTest(unittest.TestCase):
    def test_ok_with_empty_optional(self):
        doc, errors = validate(body(), NOW)
        self.assertEqual(errors, {})
        self.assertEqual(doc["employee_count"], 1200)
        self.assertEqual(doc["phone"], "010-1234-5678")
        self.assertEqual(doc["email"], "")
        self.assertEqual(doc["contact_title"], "")
        self.assertIsNone(doc["address"])
        self.assertEqual(doc["preferred_at"].isoformat(), "2026-11-19T05:00:00+00:00")   # UTC로 저장

    def test_errors(self):
        cases = {
            "company_name": body(company_name="  "),
            "employee_count": body(employee_count="0"),
            "card_count": body(card_count="abc"),
            "phone": body(phone="02-123-4567"),
            "email": body(email="nope@"),
            "address": body(consultation_type="inperson", address=""),
            "consultation_type": body(consultation_type="visit"),
            "source": body(source="ads"),
            "custom_preset": body(custom_preset={"time_range": [20, 9], "limit_amount": 50000, "categories": []}),
        }
        for key, b in cases.items():
            with self.subTest(key):
                _, errors = validate(b, NOW)
                self.assertIn(key, errors)

    def test_time_errors(self):
        _, e = validate(body(preferred_at="2026-11-18T10:00:00+09:00"), NOW)
        self.assertIn("지난 시간", e["preferred_at"])
        _, e = validate(body(preferred_at="2026-11-21T10:00:00+09:00"), NOW)
        self.assertIn("예약할 수 없는", e["preferred_at"])
        _, e = validate(body(preferred_at="2026-11-19T14:00:00"), NOW)   # 시간대 없음
        self.assertIn("preferred_at", e)

    def test_inperson_keeps_address(self):
        doc, errors = validate(body(consultation_type="inperson", address="서울 강남구"), NOW)
        self.assertEqual(errors, {})
        self.assertEqual(doc["address"], "서울 강남구")

    def test_simulator_source(self):
        self.assertEqual(validate(body(source="simulator"), NOW)[1], {})


if __name__ == "__main__":
    unittest.main()
