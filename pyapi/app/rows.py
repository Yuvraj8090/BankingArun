"""Row shaping, matching db.php's out().

The two backends must serialise a row the same way or the responses differ on
types alone — a balance as "1000.00" instead of 1000.0 is a different payload to
anything consuming it, even though both mean the same number.
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

FLOAT_COLUMNS = {
    'balance', 'amount', 'balance_after', 'online_limit', 'atm_limit', 'principal_amount',
    'interest_rate', 'maturity_amount', 'fee', 'invested_amount', 'current_value', 'units',
    'outstanding', 'roi', 'face_match_score', 'lat', 'lng', 'credit_amount', 'sum_assured',
    'annual_premium', 'amount_requested', 'calculated_emi', 'monthly_income', 'total_deposit',
    'contribution_amount', 'collected_total',
}
BOOL_COLUMNS = {
    'is_virtual', 'international_enabled', 'contactless_enabled', 'ecom_enabled', 'upi_linked',
    'is_joint', 'mfa_enabled', 'has_atm', 'has_cdm', 'has_locker', 'verified',
}
TIME_COLUMNS = {'created_at', 'timestamp', 'submitted_at', 'reviewed_at', 'verified_at'}


def out(row: dict[str, Any]) -> dict[str, Any]:
    shaped: dict[str, Any] = {}
    for key, value in row.items():
        if value is None:
            shaped[key] = None
        elif key in FLOAT_COLUMNS:
            shaped[key] = float(value)
        elif key in BOOL_COLUMNS:
            shaped[key] = bool(int(value))
        elif key in TIME_COLUMNS:
            shaped[key] = str(value).replace(' ', 'T') + '+00:00'
        elif isinstance(value, (datetime, date)):
            # PDO hands PHP the raw column text and out() leaves anything not in
            # TIME_COLUMNS alone, so those reach the client as "2026-09-16
            # 14:18:14". The driver here returns a datetime instead, which the
            # JSON encoder would render with a T and silently change the shape
            # of every timestamp the two backends do not both convert.
            shaped[key] = str(value)
        else:
            shaped[key] = value
    return shaped


def php_round(value: float, places: int = 0) -> float:
    """PHP rounds halves away from zero; Python rounds them to even.

    Left alone, 12.345 becomes 12.35 in one backend and 12.34 in the other, and
    a rate lands one paisa apart between the two.
    """
    quant = Decimal(1).scaleb(-places)
    return float(Decimal(repr(value)).quantize(quant, rounding=ROUND_HALF_UP))
