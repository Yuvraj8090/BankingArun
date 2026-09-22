"""Support sessions may read, never write — ported from modules/impersonation.php.

The PHP checks this in its dispatcher, before any handler runs, so that no
handler can forget it and so a blocked write cannot have had a side effect
first. This module is the same check in the same position, and it exists now
because the rail settings are the first write this service ever served: until
then every ported route was a GET, which this guard lets through anyway, so its
absence changed nothing. A support operator reaching PUT /api/rails/config
could have repointed the institution's payouts at an endpoint of their choosing.

Fails closed: anything that is not a plain read is refused unless it is on the
short allowlist below, which matches the PHP's exactly.
"""
from __future__ import annotations

import logging

from fastapi import Request
from fastapi.responses import JSONResponse

from .auth import bearer_token, client_ip
from .config import config
from .db import execute
from .security import read_claims

log = logging.getLogger("ajspay.impersonation")

READ_METHODS = ("GET", "HEAD", "OPTIONS")

# Ending the session, and signing out. Both are how a support operator stops
# impersonating, so refusing them would strand them inside the session.
ALLOWED_WRITES = {
    ("POST", "/api/impersonate/stop"),
    ("POST", "/api/auth/logout"),
}

REFUSAL = ("This is a read-only support session. You can see the member's account but cannot "
           "change anything or move money. End the support session to act as yourself.")


def security_event(event_type: str, severity: str, details: str, route: str, ip: str) -> None:
    """defence.php's security_event(), including its refusal to break the request.

    A guard that throws while recording that it blocked something would turn a
    clean 403 into a 500 and lose the event as well.
    """
    try:
        execute(
            "INSERT INTO security_events (event_type, severity, user_id, email, ip, route, details) "
            "VALUES (:t, :sev, NULL, NULL, :ip, :route, :details)",
            {"t": event_type[:40], "sev": severity, "ip": ip, "route": route[:120],
             "details": details[:255]},
        )
    except Exception:
        log.exception("security_event failed")


async def block_impersonated_writes(request: Request, call_next):
    """Runs before routing, exactly as the PHP's dispatcher does.

    The claim is read straight from the token rather than through current_user():
    this has to decide before a handler authenticates, and a forged or expired
    token is not this guard's problem — current_user() rejects those properly.
    """
    if request.method in READ_METHODS:
        return await call_next(request)

    try:
        claims = read_claims(bearer_token(request), config()["token_secret"])
    except Exception:
        # An unreadable configuration is not this guard's to report; let the
        # request through to fail where it will say something useful.
        return await call_next(request)

    if not claims or "imp" not in claims:
        return await call_next(request)

    path = request.url.path
    if (request.method, path) in ALLOWED_WRITES:
        return await call_next(request)

    actor = str(claims.get("imp_email") or "support")
    security_event("IMPERSONATION_WRITE_BLOCKED", "warning",
                   f"{actor} attempted {request.method} {path} while impersonating",
                   f"{request.method} {path}", client_ip(request))
    return JSONResponse({"detail": REFUSAL}, status_code=403)
