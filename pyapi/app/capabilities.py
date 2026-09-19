"""The capability register, ported from modules/compliance.php.

This decides which services the institution may offer at all. Getting it wrong
in the permissive direction would advertise something the entity is not
authorised to do, so the two rules that matter are reproduced exactly: a
capability is off unless its default or its stored override says otherwise, and
one marked `never` is off whatever the stored config says.
"""
from __future__ import annotations

import json
from typing import Any

from .db import row

# Only the fields this service needs. The descriptive text lives in the PHP
# register and is served by routes that have not moved.
CAPABILITIES: dict[str, dict[str, Any]] = {
    'internal_transfers': {'default': True},
    'deposits': {'default': True},
    'loans': {'default': True},
    'debit_cards': {'default': False},
    'upi': {'default': False},
    'payment_systems': {'default': False},
    'cheque_book': {'default': False},
    'demand_draft': {'default': False},
    'mutual_funds': {'default': False},
    'insurance': {'default': False},
    # Prohibited outright to a Nidhi. No switch turns this on.
    'current_accounts': {'default': False, 'never': True},
    'summary': {'default': False},
}


def system_config() -> dict[str, Any]:
    found = row("SELECT data FROM system_config WHERE id = 'global'")
    if not found or not found.get('data'):
        return {}
    try:
        loaded = json.loads(found['data'])
    except (TypeError, ValueError):
        return {}
    return loaded if isinstance(loaded, dict) else {}


def capability_enabled(key: str, config: dict[str, Any] | None = None) -> bool:
    spec = CAPABILITIES.get(key)
    if spec is None:
        return False
    cfg = system_config() if config is None else config
    stored = (cfg.get('capabilities') or {}).get(key)
    enabled = bool(stored.get('enabled', False)) if isinstance(stored, dict) else bool(spec['default'])
    if spec.get('never'):
        return False
    return enabled


def enabled_capabilities() -> list[str]:
    # Read the config once rather than per key: the PHP re-reads it each time,
    # which is the same answer at more cost.
    cfg = system_config()
    return [k for k in CAPABILITIES if capability_enabled(k, cfg)]
