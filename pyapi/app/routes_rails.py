"""The owner's payment-rail screen, ported from modules/rails.php.

Reading the rail's configuration, changing it, proving the partner is reachable,
and listing what is in flight. Settlement is not here — see rails.py for why.
"""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Request

from .auth import client_ip, staff_user
from .capabilities import capability_enabled, system_config
from .config import config
from .db import execute, row, rows
from .rails import (
    DRIVERS, SECRET_KEYS, STATES, audit, clip, encrypt_secret, mask_secret,
    rail_config, rail_http, rail_is_live, rail_payout_today, rail_ready,
    security_event,
)
from .responses import fail
from .rows import out

router = APIRouter()


def _body(payload: dict[str, Any] | None) -> dict[str, Any]:
    return payload if isinstance(payload, dict) else {}


@router.get("/rails/config")
def rails_config_get(request: Request) -> dict:
    staff_user(request, ["bank_owner"])
    cfg = rail_config()
    public_app_url = str(config().get("public_app_url") or "").rstrip("/")
    return {
        "driver": cfg["driver"],
        "live": rail_is_live(),
        "ready": rail_ready(cfg),
        "partner_name": cfg["partner_name"],
        "base_url": cfg["base_url"],
        "auth": cfg["auth"],
        "key_id_masked": mask_secret(cfg["key_id"]),
        "key_secret_masked": mask_secret(cfg["key_secret"]),
        "webhook_secret_masked": mask_secret(cfg["webhook_secret"]),
        "webhook_header": cfg["webhook_header"],
        "webhook_url": public_app_url + "/api/rails/webhook",
        "settlement_account": cfg["settlement_account"],
        "payout_path": cfg["payout_path"],
        "collect_path": cfg["collect_path"],
        "status_path": cfg["status_path"],
        "max_payout": float(cfg["max_payout"]),
        "daily_payout_cap": float(cfg["daily_payout_cap"]),
        "paid_out_today": rail_payout_today(),
        "capability_payment_systems": capability_enabled("payment_systems"),
        "capability_upi": capability_enabled("upi"),
        "notice": (
            "Simulator driver: no money moves. Transfers to accounts outside this institution are "
            "recorded but nothing is actually sent."
            if cfg["driver"] == "simulator" else
            "Partner driver: transfers move real money through "
            + (cfg["partner_name"] or "your partner")
            + ". Outward transfers also need the payment_systems capability switched on in the "
              "capability register, with the authorisation recorded."
        ),
    }


# Text fields the owner may set, with the length each is clipped to. Identical to
# the PHP's list: a field accepted by one backend and rejected by the other is a
# setting that appears to save and then does not.
TEXT_FIELDS = {
    "partner_name": 60, "base_url": 200, "auth": 10, "key_id": 120, "key_secret": 200,
    "webhook_secret": 200, "webhook_header": 60, "settlement_account": 40,
    "payout_path": 120, "collect_path": 120, "status_path": 120,
}


@router.put("/rails/config")
def rails_config_set(request: Request, payload: dict | None = None) -> dict:
    owner = staff_user(request, ["bank_owner"])
    d = _body(payload)
    saved = system_config().get("rails")
    rails: dict[str, Any] = dict(saved) if isinstance(saved, dict) else {}
    changed: list[str] = []

    if "driver" in d:
        driver = clip(d["driver"], 20)
        if driver not in DRIVERS:
            raise fail(422, "driver must be one of: " + ", ".join(DRIVERS) + ".")
        # Going live on an incomplete configuration would make every outward
        # transfer fail at the moment a member presses send.
        if driver == "partner" and not rail_ready({**rail_config(), **rails, "driver": "partner"}):
            raise fail(422, "Enter the partner base URL, key id, key secret and webhook secret, save "
                            'those, and then switch the driver to "partner".')
        rails["driver"] = driver
        changed.append("driver")

    for key, max_len in TEXT_FIELDS.items():
        value = clip(d.get(key, ""), max_len)
        if value == "":
            continue  # blank means "leave it as it is"
        if key == "base_url" and not value.startswith("https://"):
            raise fail(422, "base_url must be an https:// address. Payment instructions may not "
                            "travel in the clear.")
        if key == "auth" and value not in ("basic", "bearer"):
            raise fail(422, 'auth must be "basic" or "bearer".')
        rails[key] = encrypt_secret(value) if key in SECRET_KEYS else value
        changed.append(key)

    for key in ("max_payout", "daily_payout_cap"):
        if key in d:
            try:
                amount = round(float(d[key]), 2)
            except (TypeError, ValueError):
                raise fail(422, "Amount must be a number.")
            if amount <= 0:
                raise fail(422, key.replace("_", " ") + " must be greater than zero.")
            rails[key] = amount
            changed.append(key)

    if not changed:
        raise fail(422, "Nothing to update.")

    _save_rails(rails, owner["email"])
    ip = client_ip(request)
    audit(owner, "RAIL_CONFIG_UPDATED", ", ".join(changed), ip)
    security_event("RAIL_CONFIG_UPDATED", "critical",
                   "Payment rail settings changed: " + ", ".join(changed), owner, ip)
    return {"status": "SUCCESS", "message": "Rail settings saved.", "changed": changed}


def _save_rails(rails: dict[str, Any], by: str) -> None:
    """Merge the rails key into system_config, leaving every other key alone.

    Read, merge, write — which is what save_system_config() in the PHP does, and
    matching it matters more than improving it: a last-writer-wins merge here and
    a different one there would make the same concurrent edit resolve two ways
    depending on which backend served it. MariaDB has no real JSON type, so
    JSON_SET on this TEXT column would store the object as an escaped string
    rather than merging it, and is not the shortcut it appears to be.
    """
    document = system_config()
    document["rails"] = rails
    execute(
        "INSERT INTO system_config (id, data, updated_by) VALUES ('global', :data, :by) "
        "ON DUPLICATE KEY UPDATE data = VALUES(data), updated_by = VALUES(updated_by)",
        {"data": json.dumps(document, ensure_ascii=False), "by": by},
    )


@router.post("/rails/test")
def rails_test(request: Request) -> dict:
    """Proves the credentials and the network path work.

    Before a member's money is the thing that discovers they do not.
    """
    staff_user(request, ["bank_owner"])
    cfg = rail_config()
    if cfg["driver"] == "simulator":
        return {"status": "SIMULATOR", "reachable": True,
                "message": "The simulator driver is selected. Nothing is called and no money moves. "
                           "Configure a partner and switch the driver to test a real connection."}
    if not rail_ready(cfg):
        raise fail(422, "The partner is not fully configured. Base URL, key id, key secret and "
                        "webhook secret are all required.")

    # A status lookup for a reference that cannot exist: 401/403 means the keys
    # are wrong, 404 means the keys work and the endpoint is right.
    http_status, body, network = rail_http(
        cfg, "GET", cfg["status_path"].replace("{ref}", "ajspay-connectivity-test"))
    if network or http_status == 0:
        verdict = "Could not reach the partner: " + network
    elif http_status in (401, 403):
        verdict = (f"Reached the partner, but the credentials were refused (HTTP {http_status}). "
                   "Check the key id and key secret.")
    elif http_status == 404:
        verdict = "Credentials accepted and the endpoint exists. The rail is ready."
    elif 200 <= http_status < 300:
        verdict = "Credentials accepted and the endpoint answered. The rail is ready."
    else:
        verdict = f"Reached the partner but it answered HTTP {http_status}. Check the configured paths."

    ok = http_status == 404 or 200 <= http_status < 300
    return {"status": "OK" if ok else "PROBLEM", "http_status": http_status,
            "reachable": network == "" and http_status != 0, "message": verdict,
            "partner_said": dict(list(body.items())[:5]) if body else {}}


@router.get("/rails/transactions")
def rails_transactions(request: Request) -> dict:
    """The operations view: everything in flight, and everything that failed."""
    staff_user(request, ["bank_owner", "admin"])
    sql = ("SELECT id, direction, rail, driver, account_number, amount, counterparty_name, "
           "counterparty_acc, counterparty_vpa, ref_number, partner_ref, utr, status, "
           "failure_reason, created_at FROM rail_transactions WHERE 1 = 1")
    params: dict[str, Any] = {}
    status = request.query_params.get("status")
    if status in STATES:
        sql += " AND status = :status"
        params["status"] = status
    direction = request.query_params.get("direction")
    if direction in ("payout", "collect"):
        sql += " AND direction = :direction"
        params["direction"] = direction

    found, meta = paginate(request, sql + " ORDER BY created_at DESC, id", params, 25, 200)
    pending = row("SELECT COALESCE(SUM(amount), 0) AS total FROM rail_transactions "
                  "WHERE status = 'PENDING'")
    return {"transactions": [out(r) for r in found], "pagination": meta,
            "pending_value": float(pending["total"]) if pending else 0.0,
            "paid_out_today": rail_payout_today()}


def paginate(request: Request, sql: str, params: dict[str, Any],
             default_per_page: int, max_per_page: int) -> tuple[list[dict], dict]:
    """db.php's paginate(), including the stale-link behaviour.

    The SQL is ours with no user text in it, and per_page and offset are ints
    before they are interpolated; the caller's values stay bound.
    """
    def as_int(name: str, fallback: int) -> int:
        try:
            return int(request.query_params.get(name, fallback))
        except (TypeError, ValueError):
            return fallback

    page = max(1, as_int("page", 1))
    per_page = max(1, min(as_int("per_page", default_per_page), max_per_page))
    counted = row(f"SELECT COUNT(*) AS n FROM ({sql}) AS paged_count", params)
    total = int(counted["n"]) if counted else 0
    pages = max(1, -(-total // per_page))
    if page > pages:
        page = pages  # a stale link to page 9 of 3 lands on the last page
    offset = (page - 1) * per_page
    found = rows(f"{sql} LIMIT {int(per_page)} OFFSET {int(offset)}", params)
    return found, {
        "page": page, "per_page": per_page, "total": total, "pages": pages,
        "has_prev": page > 1, "has_next": page < pages,
        "from": 0 if total == 0 else offset + 1, "to": min(offset + per_page, total),
    }
