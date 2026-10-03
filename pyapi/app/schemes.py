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


def cap_compliant_maturity(scheme: dict[str, Any]) -> dict[str, Any] | None:
    """The maturity figure a plan would have to print to sit exactly on the cap.

    effective_rate answers "what does this cost"; this answers "what would it
    have to say instead", which is the only form of the question anyone can act
    on. Same discounting, solved the other way round. Ported from
    cap_compliant_maturity() in modules/master.php -- the two must agree, because
    a rate card and an admin screen quoting different remedies for the same plan
    is worse than neither quoting one.
    """
    months = int(scheme['tenure_months'] or 0)
    deposit = float(scheme['total_deposit'] or 0)
    if months < 1 or deposit <= 0:
        return None
    r = (1 + NIDHI_MAX_DEPOSIT_RATE / 100) ** (1 / 12) - 1
    by_instalment = scheme.get('scheme_type') in ('daily', 'recurring')
    pay_in = int(scheme.get('contribution_months') or 0) or months
    pay_in = max(1, min(pay_in, months))

    paid_in = deposit
    if by_instalment:
        each = deposit / pay_in
        paid_in = sum(each / (1 + r) ** (i - 1) for i in range(1, pay_in + 1))

    if (scheme.get('payout_type') or 'maturity') == 'monthly':
        factor = sum(1 / (1 + r) ** i for i in range(1, months + 1))
        if factor <= 0:
            return None
        maturity = paid_in * months / factor
        return {'maturity_amount': php_round(maturity, 2),
                'monthly_payout': php_round(maturity / months, 2)}
    return {'maturity_amount': php_round(paid_in * (1 + r) ** months, 2), 'monthly_payout': None}


def scheme_public(scheme: dict[str, Any]) -> dict[str, Any]:
    shaped = out(scheme)
    # A simple daily-interest plan's rate is the percent itself (modules/master.php
    # scheme_public): there is no slab, and total_deposit/maturity_amount are only
    # an illustrative example, so solving for a rate from them gives nonsense.
    daily = shaped.get('daily_rate_percent')
    rate = php_round(daily * 365, 2) if daily is not None else effective_rate(shaped)
    shaped['effective_rate_pa'] = rate
    shaped['exceeds_cap'] = rate is not None and rate > NIDHI_MAX_DEPOSIT_RATE
    # Only worked out where it is needed: a plan inside the cap has nothing to fix,
    # and there is no slab-priced form of a daily-percent plan to solve for.
    shaped['cap_compliant'] = (
        cap_compliant_maturity(shaped) if shaped['exceeds_cap'] and daily is None else None
    )

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
