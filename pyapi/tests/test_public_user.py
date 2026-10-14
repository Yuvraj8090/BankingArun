"""public_user() is the only thing between a user row and the client.

If a field it should strip survives a port, every signed-in member receives it.
These tests exist to fail loudly rather than to document.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.users import SECRET_FIELDS, impersonation_state, public_user  # noqa: E402

ROW = {
    'id': 'retail-001', 'name': 'Rahul Sharma', 'email': 'rahul@example.com',
    'password_hash': '$2y$10$abcdefghijklmnopqrstuv',
    'transaction_password_hash': '$2y$10$zyxwvutsrqponmlkjihgfe',
    'session_version': 3,
    'totp_secret': 'enc:JBSWY3DPEHPK3PXP',
    'totp_backup_codes': '["$2y$10$aaa","$2y$10$bbb"]',
    'totp_enabled': 1,
    'nominee_name': 'Sunita Devi', 'nominee_relation': 'Mother',
    'is_joint': 0, 'total_deposit': '216000.00',
}


def test_no_secret_survives() -> None:
    shaped = public_user(ROW)
    for field in SECRET_FIELDS:
        assert field not in shaped, f'{field} reached the client'


def test_nothing_that_looks_like_a_hash_survives() -> None:
    # A field added later with a secret in it should still be caught.
    blob = repr(public_user(ROW))
    assert '$2y$' not in blob
    assert 'JBSWY3DPEHPK3PXP' not in blob


def test_nominee_is_folded_into_one_object() -> None:
    assert public_user(ROW)['nominee'] == {'name': 'Sunita Devi', 'relation': 'Mother'}


def test_no_nominee_gives_null_not_an_empty_object() -> None:
    assert public_user({**ROW, 'nominee_name': None})['nominee'] is None


def test_totp_enabled_is_a_boolean() -> None:
    assert public_user(ROW)['totp_enabled'] is True
    assert public_user({**ROW, 'totp_enabled': 0})['totp_enabled'] is False


def test_impersonation_state() -> None:
    assert impersonation_state(None) is None
    state = impersonation_state({'name': 'Owner', 'email': 'owner@ajspay.in'})
    assert state['active'] is True and state['read_only'] is True


if __name__ == '__main__':
    for name, fn in sorted(globals().items()):
        if name.startswith('test_'):
            fn()
            print(f'PASS {name}')


