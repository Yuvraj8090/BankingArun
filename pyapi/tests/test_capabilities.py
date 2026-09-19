"""The capability register decides what may be offered at all.

An error in the permissive direction advertises a service the institution has
no authorisation for, so the two rules that carry that weight are pinned here.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.capabilities import CAPABILITIES, capability_enabled  # noqa: E402


def test_defaults_apply_with_no_stored_config() -> None:
    assert capability_enabled('deposits', {}) is True
    assert capability_enabled('upi', {}) is False


def test_stored_config_can_turn_one_on() -> None:
    cfg = {'capabilities': {'upi': {'enabled': True}}}
    assert capability_enabled('upi', cfg) is True


def test_stored_config_can_turn_one_off() -> None:
    cfg = {'capabilities': {'deposits': {'enabled': False}}}
    assert capability_enabled('deposits', cfg) is False


def test_never_beats_a_stored_switch() -> None:
    # Current accounts are prohibited to a Nidhi. Someone editing the config,
    # by hand or through the admin screen, must not be able to turn this on.
    cfg = {'capabilities': {'current_accounts': {'enabled': True}}}
    assert CAPABILITIES['current_accounts'].get('never') is True
    assert capability_enabled('current_accounts', cfg) is False


def test_unknown_capability_is_off() -> None:
    assert capability_enabled('crypto_trading', {'capabilities': {'crypto_trading': {'enabled': True}}}) is False


if __name__ == '__main__':
    for name, fn in sorted(globals().items()):
        if name.startswith('test_'):
            fn()
            print(f'PASS {name}')
