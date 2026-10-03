"""A daily-% plan's yearly rate is its daily percent x 365, in PHP and here alike.

The rate card is served from this service, not PHP (scripts/pyapi-proxy.conf),
so a plan type added to modules/master.php shows the wrong figure to members
until it is added here too. Solving a rate from the illustrative
total_deposit/maturity_amount of a doubling plan gives 23.11%, not 30.42%.
"""
from app.schemes import scheme_public


def _plan(**over):
    plan = dict(
        id='x', code='AJS-MIS-40M', name='Dainik Aay 40 Month Plan', scheme_type='mis',
        tenure_months=40, contribution_months=None, contribution_amount=None,
        principal_amount='10000.00', total_deposit='10000.00', maturity_amount='20000.00',
        payout_type='daily', daily_rate_percent='0.08333', withdrawal_threshold=None,
        slabs=None, status='active', notes=None,
    )
    plan.update(over)
    return plan


def test_daily_plan_rate_is_percent_times_365():
    shaped = scheme_public(_plan())
    assert shaped['effective_rate_pa'] == 30.42
    assert shaped['daily_rate_percent'] == 0.08333
    assert shaped['exceeds_cap'] is True
    assert shaped['cap_compliant'] is None
    assert shaped['slabs'] == []


def test_slab_plan_is_unaffected():
    shaped = scheme_public(_plan(
        payout_type='maturity', daily_rate_percent=None, scheme_type='fixed',
        tenure_months=96, total_deposit='2500.00', maturity_amount='7500.00'))
    assert shaped['daily_rate_percent'] is None
    assert shaped['effective_rate_pa'] == 14.72
    assert shaped['cap_compliant'] is not None
