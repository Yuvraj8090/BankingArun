"""/public/schemes must not advertise a plan above the 12.5% Nidhi cap, nor a deleted one.

Production proxies this route here, so the PHP rule (route_public_schemes) only
holds for the public if it holds here too.
"""
from __future__ import annotations

from app import routes_public

BASE = dict(id='x', name='Plan', status='active', slabs=None, daily_rate_percent=None,
            withdrawal_threshold=None, lock_in_months=None, contribution_amount=None,
            principal_amount=None, notes=None, deleted_at=None, contribution_months=None)
INSIDE = dict(BASE, code='AJS-RD-1Y', scheme_type='recurring', tenure_months=12,
              total_deposit=6000, maturity_amount=6360, payout_type='maturity')
ABOVE = dict(BASE, code='AJS-FD-8Y', scheme_type='fixed', tenure_months=96,
             total_deposit=2500, maturity_amount=7500, payout_type='maturity')


def test_over_cap_and_deleted_plans_are_not_listed(monkeypatch) -> None:
    seen = {}

    def fake_rows(sql, params=None):
        seen['sql'] = sql
        return [INSIDE, ABOVE]

    monkeypatch.setattr(routes_public, 'rows', fake_rows)
    codes = [s['code'] for s in routes_public.public_schemes()['schemes']]
    assert codes == ['AJS-RD-1Y']
    assert 'deleted_at IS NULL' in seen['sql']
