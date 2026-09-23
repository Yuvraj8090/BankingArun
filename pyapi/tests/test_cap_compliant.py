"""The compliant-maturity figure must be identical in PHP and Python.

Both implementations are quoted to a director as the number to reprint a plan
at. Two answers to that question is worse than none, and the strangler-fig
migration makes drift the default outcome rather than an accident: a field added
to modules/master.php simply does not appear on a route already proxied to here.
This test is what stops that being discovered by a member.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from app.schemes import cap_compliant_maturity, effective_rate

# Every active plan that prices above the cap, plus one inside it as a control.
PLANS = [
    dict(code='AJS-MIS-5Y', tenure_months=60, contribution_months=None,
         total_deposit=10000, maturity_amount=15000, scheme_type='mis', payout_type='monthly'),
    dict(code='AJS-FD-8Y', tenure_months=96, contribution_months=None,
         total_deposit=2500, maturity_amount=7500, scheme_type='fixed', payout_type='maturity'),
    dict(code='AJS-SL-21Y', tenure_months=252, contribution_months=72,
         total_deposit=432000, maturity_amount=3849700, scheme_type='recurring', payout_type='maturity'),
    dict(code='AJS-12M-6Y', tenure_months=72, contribution_months=12,
         total_deposit=72000, maturity_amount=144000, scheme_type='recurring', payout_type='maturity'),
    dict(code='AJS-RD-1Y', tenure_months=12, contribution_months=None,
         total_deposit=6000, maturity_amount=6360, scheme_type='recurring', payout_type='maturity'),
]

ROOT = Path(__file__).resolve().parents[2]


def php_answers() -> list[dict]:
    php = shutil.which('php')
    if not php:
        pytest.skip('php is not installed here')
    script = r'''
require getenv("AJSPAY_API");
$out = [];
foreach (json_decode(getenv("AJSPAY_PLANS"), true) as $p) {
    $out[] = ["rate" => effective_rate($p), "compliant" => cap_compliant_maturity($p)];
}
echo json_encode($out);
'''
    r = subprocess.run([php, '-r', script], capture_output=True, text=True, env={
        'PATH': '/usr/bin:/bin:/usr/local/bin',
        'AJSPAY_API': str(ROOT / 'hostinger' / 'api.php'),
        'AJSPAY_PLANS': json.dumps(PLANS),
    })
    if r.returncode != 0 or not r.stdout.strip().startswith('['):
        pytest.skip(f'php could not load the module: {r.stderr[-200:]}')
    return json.loads(r.stdout)


def test_php_and_python_agree_on_the_compliant_figure():
    for plan, php in zip(PLANS, php_answers()):
        assert effective_rate(plan) == php['rate'], plan['code']
        mine = cap_compliant_maturity(plan)
        if php['compliant'] is None:
            # PHP only computes it for over-cap plans; Python must not invent one.
            assert effective_rate(plan) <= 12.5, plan['code']
            continue
        assert mine is not None, plan['code']
        assert mine['maturity_amount'] == pytest.approx(float(php['compliant']['maturity_amount'])), plan['code']
        theirs = php['compliant']['monthly_payout']
        if theirs is None:
            assert mine['monthly_payout'] is None, plan['code']
        else:
            assert mine['monthly_payout'] == pytest.approx(float(theirs)), plan['code']


def test_the_compliant_figure_really_lands_on_the_cap():
    # The point of the number: reprint the plan at it and the rate is legal.
    for plan in PLANS:
        fixed = cap_compliant_maturity(plan)
        if fixed is None or effective_rate(plan) <= 12.5:
            continue
        assert effective_rate({**plan, 'maturity_amount': fixed['maturity_amount']}) == pytest.approx(12.5, abs=0.01), plan['code']
