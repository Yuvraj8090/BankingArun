"""The rail settings the two backends share.

The secret framing is the one that matters most: the PHP seals the partner
credentials with libsodium and this service has to open them, and the other way
round. A divergence there does not fail loudly — it reads as "the partner is not
configured", and every outward transfer stops.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import rails  # noqa: E402

SECRET = "b6f1c0d9e8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1"


def _with_secret(monkeypatch) -> None:
    """Both sides derive the key from the token secret, so pin one."""
    monkeypatch.setattr(rails, "config", lambda: {"token_secret": SECRET})


# --- Secret framing -----------------------------------------------------------
def test_secret_round_trips(monkeypatch) -> None:
    _with_secret(monkeypatch)
    assert rails.decrypt_secret(rails.encrypt_secret("whsec_abc123")) == "whsec_abc123"


def test_unreadable_secret_reads_as_absent(monkeypatch) -> None:
    """Never guess at a secret we cannot open: the PHP returns "" here too."""
    _with_secret(monkeypatch)
    assert rails.decrypt_secret("enc:not-base64!!") == ""
    assert rails.decrypt_secret("plaintext") == ""
    assert rails.decrypt_secret("enc:" + "AAAA") == ""


PHP_SEAL = r'''
$secret = $argv[1];
$plain = $argv[2];
$key = hash('sha256', 'ajspay-config:' . $secret, true);
$nonce = random_bytes(SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
echo 'enc:' . base64_encode($nonce . sodium_crypto_secretbox($plain, $nonce, $key));
'''

PHP_OPEN = r'''
$secret = $argv[1];
$stored = $argv[2];
$key = hash('sha256', 'ajspay-config:' . $secret, true);
$raw = base64_decode(substr($stored, 4), true);
$n = SODIUM_CRYPTO_SECRETBOX_NONCEBYTES;
$plain = sodium_crypto_secretbox_open(substr($raw, $n), substr($raw, 0, $n), $key);
echo $plain === false ? '<<FAILED>>' : $plain;
'''


def test_python_opens_what_php_sealed(monkeypatch) -> None:
    if not shutil.which("php"):
        print("php not available; skipped")
        return
    _with_secret(monkeypatch)
    sealed = subprocess.run(["php", "-r", PHP_SEAL, SECRET, "sealed_by_php"],
                            capture_output=True, text=True, check=True).stdout.strip()
    assert rails.decrypt_secret(sealed) == "sealed_by_php"


def test_php_opens_what_python_sealed(monkeypatch) -> None:
    if not shutil.which("php"):
        print("php not available; skipped")
        return
    _with_secret(monkeypatch)
    sealed = rails.encrypt_secret("sealed_by_python")
    opened = subprocess.run(["php", "-r", PHP_OPEN, SECRET, sealed],
                            capture_output=True, text=True, check=True).stdout
    assert opened == "sealed_by_python"


# --- Masking ------------------------------------------------------------------
def test_mask_matches_the_php() -> None:
    """staff.php's mask_secret(): under six characters reveals nothing at all."""
    assert rails.mask_secret("") == ""
    assert rails.mask_secret("abc") == "•••"
    assert rails.mask_secret("abcde") == "•••••"
    assert rails.mask_secret("abcdef") == "abcdef"
    assert rails.mask_secret("whsec_test_123") == "whs••••••••123"


# --- Configuration resolution -------------------------------------------------
def test_saved_config_beats_the_file(monkeypatch) -> None:
    monkeypatch.setattr(rails, "config", lambda: {
        "token_secret": SECRET, "rails": {"driver": "partner", "partner_name": "FromFile"}})
    monkeypatch.setattr(rails, "system_config", lambda: {"rails": {"partner_name": "FromOwner"}})
    cfg = rails.rail_config()
    assert cfg["partner_name"] == "FromOwner"
    assert cfg["driver"] == "partner"      # untouched keys survive the merge
    assert cfg["payout_path"] == "/payouts"  # and the defaults fill the rest


def test_unknown_driver_falls_back_to_the_simulator(monkeypatch) -> None:
    """An unrecognised driver must never be read as permission to move money."""
    monkeypatch.setattr(rails, "config", lambda: {"token_secret": SECRET, "rails": {"driver": "npci"}})
    monkeypatch.setattr(rails, "system_config", lambda: {})
    assert rails.rail_config()["driver"] == "simulator"


def test_partner_is_not_ready_without_every_credential() -> None:
    complete = {"driver": "partner", "base_url": "https://x", "key_id": "k",
                "key_secret": "s", "webhook_secret": "w"}
    assert rails.rail_ready(complete) is True
    for missing in ("base_url", "key_id", "key_secret", "webhook_secret"):
        assert rails.rail_ready({**complete, missing: ""}) is False, missing
    # The simulator needs none of them.
    assert rails.rail_ready({"driver": "simulator"}) is True


# --- Money formatting ---------------------------------------------------------
def test_rupees_groups_the_way_the_php_does() -> None:
    """number_format() grouping: thousands, not lakhs.

    ₹200,000.00 rather than ₹2,00,000.00. Pinned because it looks wrong to an
    Indian reader and is exactly what every other money string in the
    application already does.
    """
    assert rails.rupees(0) == "₹0.00"
    assert rails.rupees(999) == "₹999.00"
    assert rails.rupees(1500.55) == "₹1,500.55"
    assert rails.rupees(100000) == "₹100,000.00"
    assert rails.rupees(12500000) == "₹12,500,000.00"


PHP_RUPEES = r'''
function rupees(float $a): string { return "₹" . number_format($a, 2); }
echo rupees((float)$argv[1]);
'''


def test_rupees_matches_the_php() -> None:
    if not shutil.which("php"):
        print("php not available; skipped")
        return
    for amount in ("0", "999", "1500.55", "100000", "12500000", "1234.5"):
        php = subprocess.run(["php", "-r", PHP_RUPEES, amount],
                             capture_output=True, text=True, check=True).stdout
        assert rails.rupees(float(amount)) == php, amount
