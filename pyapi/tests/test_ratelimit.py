"""Rate limiting must count into the same buckets the PHP counts into.

Routes that moved to this service silently lost guard_request(), so the public
product pages, the rate card, the feature list and the branch locator answered
the open internet with no limit at all. Reproducing the PHP's keys exactly is
the point: a caller who can choose which backend to hit must not get a second
budget by choosing the other one.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.ratelimit import RATE_GLOBAL, RATE_ROUTES, GLOBAL_MESSAGE, ROUTE_MESSAGE  # noqa: E402


def test_global_budget_matches_the_php() -> None:
    """defence.php's RATE_GLOBAL. A wider window here is a wider window for an attacker."""
    assert RATE_GLOBAL == (600, 300)


def test_per_route_budgets_match_the_php() -> None:
    """Spot-checks on the ones that guard money and credentials."""
    assert RATE_ROUTES['GET /public/captcha'] == (120, 3600)
    assert RATE_ROUTES['POST /auth/login'] == (30, 300)
    assert RATE_ROUTES['POST /register/self'] == (60, 3600)
    assert RATE_ROUTES['POST /accounts/transfer'] == (60, 300)
    assert RATE_ROUTES['POST /accounts/bulk-transfer'] == (10, 300)
    assert RATE_ROUTES['POST /otp/send'] == (15, 3600)
    assert RATE_ROUTES['POST /rails/collect'] == (30, 300)


def test_the_webhook_is_generous_on_purpose() -> None:
    """Throttling a genuine partner callback strands a member's money."""
    assert RATE_ROUTES['POST /rails/webhook'] == (600, 300)


def test_messages_are_the_php_wording() -> None:
    """The member reads these; two backends must not phrase the same refusal differently."""
    assert GLOBAL_MESSAGE == 'Too many requests. Please slow down and try again shortly.'
    assert ROUTE_MESSAGE == 'Too many attempts on this action. Please wait a few minutes and try again.'


def test_route_keys_carry_no_api_prefix() -> None:
    """The PHP keys on the path after /api; a prefix here would be a different bucket."""
    for key in RATE_ROUTES:
        method, _, route = key.partition(' ')
        assert method in {'GET', 'POST', 'PUT', 'PATCH', 'DELETE'}, key
        assert route.startswith('/'), key
        assert not route.startswith('/api'), key
