"""Date parsing / month-end normalization tests."""

from __future__ import annotations

import datetime as dt

import pytest

from src.validate import month_end, normalize_rate_key, parse_date_to_month_end


@pytest.mark.parametrize(
    ("token", "expected"),
    [
        ("2026-06-30", dt.date(2026, 6, 30)),
        ("2026-06-15", dt.date(2026, 6, 30)),  # any day normalizes to month-end
        ("2026-6-1", dt.date(2026, 6, 30)),
        ("2026-02", dt.date(2026, 2, 28)),
        ("2028-02-01", dt.date(2028, 2, 29)),  # leap year
        ("2026-06-30 00:00:00", dt.date(2026, 6, 30)),
        ("7/31/2026", dt.date(2026, 7, 31)),
        ("7/1/2026", dt.date(2026, 7, 31)),
        ("10/31/25", dt.date(2025, 10, 31)),
        ("Oct-25", dt.date(2025, 10, 31)),
        ("OCT-25", dt.date(2025, 10, 31)),
        ("oct 2025", dt.date(2025, 10, 31)),
        ("October-25", dt.date(2025, 10, 31)),
        ("Feb-28", dt.date(2028, 2, 29)),
        (" Jun-26 ", dt.date(2026, 6, 30)),
    ],
)
def test_parses_and_normalizes(token: str, expected: dt.date) -> None:
    assert parse_date_to_month_end(token) == expected


@pytest.mark.parametrize("token", ["", "  ", "banana", "13/1/2026", "2026-13-01", "Okt-25", "2026/06/30"])
def test_rejects_garbage(token: str) -> None:
    assert parse_date_to_month_end(token) is None


def test_month_end_boundaries() -> None:
    assert month_end(2028, 2) == dt.date(2028, 2, 29)
    assert month_end(2026, 2) == dt.date(2026, 2, 28)
    assert month_end(2026, 12) == dt.date(2026, 12, 31)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("fed_funds", "fed_funds"),
        ("Fed Funds", "fed_funds"),
        ("FED  FUNDS", "fed_funds"),
        ("  SOFR ", "sofr"),
        ("UST_10YR", "ust_10yr"),
        ("ust 10yr", "ust_10yr"),
    ],
)
def test_rate_key_normalization(raw: str, expected: str) -> None:
    assert normalize_rate_key(raw) == expected
