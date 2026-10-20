"""상담 예약 가능 시간 규칙 — js/landing.js(03 상담예약)와 같은 규칙. 한쪽을 고치면 같이 고친다.

- 범위: 오늘(KST)이 속한 주의 월요일부터 2주 (매번 계산)
- 요일: 월~금
- 시간: HOURS (KST 정각, 1시간)
- 지난 시간(시작 시각이 지금 이전)은 예약 불가
"""
from datetime import date, datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))
HOURS = (10, 11, 14, 15, 16, 17)   # 점심 12~13시 + 이동 버퍼 → 14시부터 재개
WEEKS = 2
WEEKDAYS = 5   # 월~금


def window_start(now: datetime) -> date:
    """오늘(KST)이 속한 주의 월요일."""
    today = now.astimezone(KST).date()
    return today - timedelta(days=today.weekday())


def window_days(now: datetime) -> list[date]:
    """예약 화면에 나오는 날짜 10개 (2주 × 월~금)."""
    mon = window_start(now)
    return [mon + timedelta(weeks=w, days=d) for w in range(WEEKS) for d in range(WEEKDAYS)]


def slot_at(day: date, hour: int) -> datetime:
    """날짜 + 시(KST) → 시각(KST)."""
    return datetime(day.year, day.month, day.day, hour, tzinfo=KST)


def slot_error(at: datetime, now: datetime) -> str | None:
    """예약할 수 있는 시각이면 None, 아니면 이유 — 'past' | 'unavailable'."""
    k = at.astimezone(KST)
    if (k.minute, k.second, k.microsecond) != (0, 0, 0) or k.hour not in HOURS or k.date() not in window_days(now):
        return "unavailable"
    if at <= now:
        return "past"
    return None


def open_slots(now: datetime) -> list[datetime]:
    """범위 안에서 아직 지나지 않은 칸 (확정 예약은 고려하지 않음)."""
    return [slot_at(d, h) for d in window_days(now) for h in HOURS if slot_at(d, h) > now]


def next_weekdays(now: datetime, n: int) -> list[date]:
    """오늘(KST) 다음 평일 n개 — seed 예약 날짜용."""
    days, d = [], now.astimezone(KST).date()
    while len(days) < n:
        d += timedelta(days=1)
        if d.weekday() < WEEKDAYS:
            days.append(d)
    return days
