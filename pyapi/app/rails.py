"""Payment rail settings, ported from modules/rails.php.

What moved here is the owner's view of the rail: reading the configuration,
changing it, checking the partner is reachable, and listing what is in flight.

What deliberately did **not** move is settlement — the webhook, the payout
dispatch and the reversal logic. Those credit and debit member balances, and a
second implementation of them running against the same database as the PHP cron
is two things that can disagree about whether money moved. They stay in PHP,
where they are exercised by the cron every few minutes, until they can be moved
as one piece. See RAILS_SETUP.md and the port's README.

Everything here therefore reads the same rows the PHP reads and writes only the
`rails` key of system_config.
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from nacl.exceptions import CryptoError
from nacl.secret import SecretBox

from .capabilities import system_config
from .config import config
from .db import rows, row, execute
from .responses import fail

log = logging.getLogger("ajspay.rails")

DRIVERS = ("simulator", "partner")
SECRET_KEYS = ("key_secret", "webhook_secret")
STATES = ("PENDING", "SUCCESS", "FAILED")
IST = timezone(timedelta(hours=5, minutes=30))

# Mirrors RAIL_DEFAULTS in modules/rails.php. If the two ever disagree the owner
# screen shows one thing and the transfer uses another, so these are the PHP's
# values and are changed in both places or neither.
DEFAULTS: dict[str, Any] = {
    "driver": "simulator",
    "partner_name": "",
    "base_url": "",
    "auth": "basic",
    "key_id": "",
    "key_secret": "",
    "webhook_secret": "",
    "webhook_header": "X-Webhook-Signature",
    "settlement_account": "",
    "payout_path": "/payouts",
    "collect_path": "/payment_links",
    "status_path": "/payouts/{ref}",
    "ref_field": "id",
    "status_field": "status",
    "utr_field": "utr",
    "failure_field": "failure_reason",
    "event_object_path": "",
    "status_map": {
        "processed": "SUCCESS", "success": "SUCCESS", "completed": "SUCCESS", "paid": "SUCCESS",
        "queued": "PENDING", "pending": "PENDING", "processing": "PENDING", "initiated": "PENDING",
        "failed": "FAILED", "reversed": "FAILED", "cancelled": "FAILED", "rejected": "FAILED",
    },
    "max_payout": 200000.0,
    "daily_payout_cap": 1000000.0,
    "timeout": 20,
}


# --- Secrets ------------------------------------------------------------------
# The PHP stores these with libsodium's secretbox under a key derived from the
# token secret. Both backends must derive the same key and use the same framing
# or a secret written by one is unreadable by the other.
def _secret_key() -> bytes:
    return hashlib.sha256(("ajspay-config:" + config()["token_secret"]).encode()).digest()


def encrypt_secret(plain: str) -> str:
    box = SecretBox(_secret_key())
    nonce = os.urandom(SecretBox.NONCE_SIZE)
    sealed = box.encrypt(plain.encode(), nonce)
    # PHP stores nonce || ciphertext, which is exactly what EncryptedMessage is.
    return "enc:" + base64.b64encode(bytes(sealed)).decode()


def decrypt_secret(stored: str) -> str:
    if not stored.startswith("enc:"):
        return ""
    try:
        raw = base64.b64decode(stored[4:], validate=True)
    except (ValueError, TypeError):
        return ""
    if len(raw) <= SecretBox.NONCE_SIZE:
        return ""
    try:
        return SecretBox(_secret_key()).decrypt(
            raw[SecretBox.NONCE_SIZE:], raw[: SecretBox.NONCE_SIZE]
        ).decode()
    except (CryptoError, UnicodeDecodeError):
        # A secret we cannot read is not a secret we may guess at. The PHP
        # returns an empty string here too, which reads as "not configured".
        return ""


def mask_secret(s: str) -> str:
    """staff.php's mask_secret(), character for character."""
    n = len(s)
    return "•" * n if n < 6 else s[:3] + "•" * (n - 6) + s[-3:]


# --- Configuration ------------------------------------------------------------
def rail_config() -> dict[str, Any]:
    """File settings, then what the owner saved, exactly as the PHP resolves it."""
    from_file = config().get("rails")
    from_file = from_file if isinstance(from_file, dict) else {}
    saved = system_config().get("rails")
    saved = saved if isinstance(saved, dict) else {}
    cfg: dict[str, Any] = {**DEFAULTS, **from_file, **saved}
    for key in SECRET_KEYS:
        value = str(cfg.get(key) or "")
        if value.startswith("enc:"):
            cfg[key] = decrypt_secret(value)
    if cfg["driver"] not in DRIVERS:
        cfg["driver"] = "simulator"
    return cfg


def rail_ready(cfg: dict[str, Any]) -> bool:
    return cfg["driver"] == "simulator" or all(
        str(cfg.get(k) or "") != "" for k in ("base_url", "key_id", "key_secret", "webhook_secret")
    )


def rail_is_live() -> bool:
    cfg = rail_config()
    return cfg["driver"] != "simulator" and rail_ready(cfg)


def rail_payout_today() -> float:
    """What the institution has pushed out since midnight IST.

    The PHP computes the boundary in IST and compares against UTC timestamps;
    doing it any other way moves the cap's reset by five and a half hours.
    """
    midnight_ist = datetime.now(IST).replace(hour=0, minute=0, second=0, microsecond=0)
    since = midnight_ist.astimezone(timezone.utc).replace(tzinfo=None)
    found = row(
        "SELECT COALESCE(SUM(amount), 0) AS total FROM rail_transactions "
        "WHERE direction = 'payout' AND status <> 'FAILED' AND created_at >= :since",
        {"since": since},
    )
    return float(found["total"]) if found else 0.0


def rail_limit_error(amount: float) -> str | None:
    cfg = rail_config()
    if amount > float(cfg["max_payout"]):
        return f"Amount exceeds the per-transaction rail limit of {rupees(float(cfg['max_payout']))}."
    if rail_payout_today() + amount > float(cfg["daily_payout_cap"]):
        return ("This would exceed the institution's daily payout cap. It can be sent after the cap "
                "resets, or the cap raised from the Rails screen.")
    return None


def rupees(amount: float) -> str:
    """db.php's rupees(), which is number_format() — thousands, not lakhs.

    So ₹200,000.00, not the ₹2,00,000.00 an Indian reader would expect. That is
    the PHP's grouping across every money string in the application, and these
    messages sit beside those, so this matches it rather than being locally
    correct and inconsistent with everything around it.
    """
    return f"₹{amount:,.2f}"


# --- Partner HTTP -------------------------------------------------------------
def rail_http(cfg: dict[str, Any], method: str, path: str) -> tuple[int, dict, str]:
    """A read against the partner. Returns (status, body, network_error).

    Only GET is used from this service: the owner's connectivity check and
    nothing else. Instructing a payout stays in the PHP with the settlement it
    belongs to.
    """
    url = cfg["base_url"].rstrip("/") + "/" + path.lstrip("/")
    headers = {"Accept": "application/json"}
    auth = None
    if cfg["auth"] == "bearer":
        headers["Authorization"] = "Bearer " + cfg["key_secret"]
    else:
        auth = (cfg["key_id"], cfg["key_secret"])
    try:
        # verify=True is the default and is left explicit: a payment instruction
        # sent to whoever answers the DNS is not a payment instruction.
        response = httpx.request(method, url, headers=headers, auth=auth,
                                 timeout=float(cfg["timeout"]), follow_redirects=False, verify=True)
    except httpx.HTTPError as exc:
        log.warning("rail %s %s: %s", method, path, exc)
        return 0, {}, str(exc) or "No response from the payment partner."
    try:
        body = response.json()
    except ValueError:
        body = {}
    return response.status_code, body if isinstance(body, dict) else {}, ""


# --- Audit --------------------------------------------------------------------
# The PHP writes both of these whenever the rail settings change. A change to
# the credentials that move money has to be attributable, so the port writes
# them too rather than leaving a gap in the trail on ported routes.
def audit(user: dict, action: str, details: str, ip: str) -> None:
    execute(
        "INSERT INTO audit_logs (id, user_id, email, action, details, ip) "
        "VALUES (:id, :uid, :email, :action, :details, :ip)",
        {"id": uuid4(), "uid": user["id"], "email": user["email"], "action": action,
         "details": details[:255], "ip": ip},
    )


def security_event(event_type: str, severity: str, details: str, user: dict, ip: str) -> None:
    execute(
        "INSERT INTO security_events (event_type, severity, user_id, email, ip, details) "
        "VALUES (:t, :sev, :uid, :email, :ip, :details)",
        {"t": event_type, "sev": severity, "uid": user["id"], "email": user["email"],
         "ip": ip, "details": details[:255]},
    )


def uuid4() -> str:
    return str(uuid.uuid4())


def clip(value: Any, max_len: int) -> str:
    return str(value if value is not None else "").strip()[:max_len]
