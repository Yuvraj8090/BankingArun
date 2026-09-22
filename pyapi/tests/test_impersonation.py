"""A support session may read but never write.

The PHP has enforced this in its dispatcher since impersonation existed. This
service did not, which went unnoticed while every ported route was a GET -- the
guard lets reads through anyway. The first ported write was the rail settings,
where the gap meant a support operator could repoint the institution's payouts
at an endpoint of their own.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.impersonation import ALLOWED_WRITES, READ_METHODS  # noqa: E402


def test_only_stopping_the_session_is_writable() -> None:
    """Fail closed: the allowlist is the two ways out, and nothing else."""
    assert ALLOWED_WRITES == {("POST", "/api/impersonate/stop"), ("POST", "/api/auth/logout")}


def test_the_rail_settings_are_not_on_the_allowlist() -> None:
    """The write that made this guard necessary."""
    for method in ("PUT", "POST", "PATCH", "DELETE"):
        assert (method, "/api/rails/config") not in ALLOWED_WRITES


def test_reads_are_the_ones_that_pass() -> None:
    assert set(READ_METHODS) == {"GET", "HEAD", "OPTIONS"}
    for method in ("POST", "PUT", "PATCH", "DELETE"):
        assert method not in READ_METHODS
