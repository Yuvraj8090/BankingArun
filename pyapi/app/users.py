"""Member shaping, ported from api.php's public_user().

This is the one function standing between a user row and the client. Everything
secret about an account is removed here rather than at each call site, so that
no handler can leak it by returning a row. Porting it wrongly — forgetting a
field — would publish password hashes or the TOTP secret to anyone signed in,
which is why the fields it strips are pinned by a test.
"""
from __future__ import annotations

from typing import Any

from .rows import out

# Removed before a user row reaches the client. The TOTP secret is encrypted at
# rest and the recovery codes are bcrypt hashes, but neither belongs on a client.
SECRET_FIELDS = (
    'password_hash',
    'transaction_password_hash',
    'session_version',
    'nominee_name',
    'nominee_relation',
    'totp_secret',
    'totp_backup_codes',
)


def public_user(user: dict[str, Any]) -> dict[str, Any]:
    shaped = dict(user)
    shaped['nominee'] = None if shaped.get('nominee_name') is None else {
        'name': shaped['nominee_name'],
        'relation': shaped.get('nominee_relation'),
    }
    for field in SECRET_FIELDS:
        shaped.pop(field, None)
    # Whether 2FA is on is useful to the app; the material behind it is not.
    shaped['totp_enabled'] = bool(shaped.get('totp_enabled') or False)
    return out(shaped)


def impersonation_state(actor: dict[str, Any] | None) -> dict[str, Any] | None:
    if actor is None:
        return None
    return {
        'active': True,
        'by_name': actor['name'],
        'by_email': actor['email'],
        'read_only': True,
        'notice': "Support session — read only. Nothing you do here can change this member's account.",
    }


def public_card(card: dict[str, Any]) -> dict[str, Any]:
    """A card, without the PIN.

    The PIN is stored as a bcrypt hash and never leaves the server. There is no
    CVV to remove: it is not written down at all, because PCI DSS forbids
    keeping it after authorisation.
    """
    shaped = dict(card)
    shaped.pop('pin_hash', None)
    return out(shaped)
