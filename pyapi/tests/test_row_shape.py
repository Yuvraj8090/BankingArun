"""Row shaping has to match PDO's, or every timestamp differs between backends.

This exists because a byte comparison caught updated_at coming back as
"2026-09-16T14:18:14" from Python and "2026-09-16 14:18:14" from PHP: the
driver returns a datetime where PDO returns the column text, and the JSON
encoder then rendered it differently.
"""
from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.rows import out, php_round  # noqa: E402


def test_untracked_datetime_keeps_pdo_spacing() -> None:
    assert out({'updated_at': datetime(2026, 9, 16, 14, 18, 14)})['updated_at'] == '2026-09-16 14:18:14'


def test_tracked_datetime_gets_iso_and_offset() -> None:
    assert out({'created_at': datetime(2026, 9, 16, 14, 18, 14)})['created_at'] == '2026-09-16T14:18:14+00:00'


def test_float_and_bool_columns() -> None:
    shaped = out({'total_deposit': '216000.00', 'is_joint': 1, 'code': 'AJS-RD-3Y'})
    assert shaped['total_deposit'] == 216000.0
    assert shaped['is_joint'] is True
    assert shaped['code'] == 'AJS-RD-3Y'


def test_null_survives() -> None:
    assert out({'contribution_months': None})['contribution_months'] is None


def test_php_rounds_halves_away_from_zero() -> None:
    # Python's own round() gives 12.34 here, which would put the two backends a
    # paisa apart on any rate landing exactly on a half.
    assert php_round(12.345, 2) == 12.35
    assert php_round(2.5) == 3.0


if __name__ == '__main__':
    for name, fn in sorted(globals().items()):
        if name.startswith('test_'):
            fn()
            print(f'PASS {name}')
