"""Scheme rating, ported from modules/master.php.

The rate is solved rather than stated: what a plan really pays is whatever
discount rate makes what the member pays in equal what they get back. The
brochure's own headline is not used, because on several plans it does not match
the plan's own figures.
"""
from __future__ import annotations

import json
from typing import Any

from .rows import out, php_round

NIDHI_MAX_DEPOSIT_RATE = 12.5


def effective_rate(scheme: dict[str, Any]) -> float | None:
    months = int(scheme['tenure_months'] or 0)
    deposit = float(scheme['total_deposit'] or 0)
    maturity = float(scheme['maturity_amount'] or 0)
    if months < 1 or deposit <= 0 or maturity <= 0:
        return None
    if maturity <= deposit:
        return 0.0
    payout_type = scheme.get('payout_type') or 'maturity'
    if payout_type == 'monthly' and months < 2:
        return None

    by_instalment = scheme.get('scheme_type') in ('daily', 'recurring')
    # Plans that take instalments for only part of the term and then hold the
    # fund. Spreading those across the whole tenure would put the money in later
    # than it goes in, and overstate the rate needed to reach the maturity figure.
    pay_in = int(scheme.get('contribution_months') or 0) or months
    pay_in = max(1, min(pay_in, months))
    contribution = deposit / pay_in if by_instalment else 0.0

    def paid_in(rate: float) -> float:
        if not by_instalment:
            return deposit
        # Instalments are paid at the start of each month, so the first one is
        # not discounted.
        return sum(contribution / (1 + rate) ** (i - 1) for i in range(1, pay_in + 1))

    monthly_payout = payout_type == 'monthly'

    def paid_out(rate: float) -> float:
        if not monthly_payout:
            return maturity / (1 + rate) ** months
        # A monthly-payout plan hands the money over across the term rather than
        # in one sum at the end, so the member has it years earlier and the plan
        # is paying far more than the same two totals imply on maturity.
        each = maturity / months
        return sum(each / (1 + rate) ** i for i in range(1, months + 1))

    low, high = 0.0, 0.05  # up to 5% a month
    for _ in range(80):
        mid = (low + high) / 2
        if paid_out(mid) > paid_in(mid):
            low = mid
        else:
            high = mid
    return php_round(((1 + (low + high) / 2) ** 12 - 1) * 100, 2)


def scheme_public(scheme: dict[str, Any]) -> dict[str, Any]:
    shaped = out(scheme)
    rate = effective_rate(shaped)
    shaped['effective_rate_pa'] = rate
    shaped['exceeds_cap'] = rate is not None and rate > NIDHI_MAX_DEPOSIT_RATE

    # Every denomination is rated, not only the representative one. A slab whose
    # own figures imply a different return is either priced differently on
    # purpose or is a misprint, and either way somebody should be able to see it.
    try:
        slabs = json.loads(shaped.get('slabs') or '')
    except (TypeError, ValueError):
        slabs = None
    shaped['slabs'] = []
    if isinstance(slabs, list):
        for slab in slabs:
            slab_rate = effective_rate({
                'tenure_months': shaped['tenure_months'],
                'contribution_months': shaped.get('contribution_months'),
                'total_deposit': slab['deposit'],
                'maturity_amount': slab['maturity'],
                'scheme_type': shaped['scheme_type'],
                'payout_type': shaped['payout_type'],
            })
            slab = dict(slab)
            slab['effective_rate_pa'] = slab_rate
            slab['exceeds_cap'] = slab_rate is not None and slab_rate > NIDHI_MAX_DEPOSIT_RATE
            # More than half a point from the plan's own headline is how a
            # mistyped figure shows up.
            slab['off_headline'] = (
                rate is not None and slab_rate is not None and abs(slab_rate - rate) > 0.5
            )
            shaped['slabs'].append(slab)
    return shaped
