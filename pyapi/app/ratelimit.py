"""Request rate limiting, ported from modules/defence.php.

The PHP calls guard_request() in its dispatcher before every handler, and
before an unknown path is rejected, so probing for routes costs an attacker the
same budget as using them. Routes that moved to this service left that behind:
the public product pages, the rate card, the feature list and the branch
locator have been answering the open internet with no limit at all since they
were proxied.

Both backends count into the same login_attempts rows under the same keys, so a
caller cannot get a second budget by choosing which backend to hit -- which is
the whole reason the keys are reproduced exactly rather than improved on.
"""
from __future__ import annotations

import logging

from fastapi import Request
from fastapi.responses import JSONResponse

from .auth import client_ip
from .db import execute, row

log = logging.getLogger("ajspay.ratelimit")

# defence.php's RATE_GLOBAL and RATE_ROUTES, as [max, window_seconds].
RATE_GLOBAL = (600, 300)
RATE_ROUTES: dict[str, tuple[int, int]] = {
    'GET /public/captcha': (120, 3600),
    'POST /auth/login': (30, 300),
    'POST /register/self': (60, 3600),
    'POST /auth/login/totp': (20, 900),
    'POST /totp/enable': (20, 900),
    'POST /totp/disable': (10, 900),
    'POST /otp/send': (15, 3600),
    'POST /otp/verify': (25, 900),
    'POST /auth/verify-transaction-pin': (25, 900),
    'POST /accounts/transfer': (60, 300),
    'POST /accounts/bulk-transfer': (10, 300),
    'POST /passkey/login/complete': (30, 900),
    'POST /support/chat': (60, 300),
    'POST /rails/webhook': (600, 300),
    'POST /rails/collect': (30, 300),
}

GLOBAL_MESSAGE = 'Too many requests. Please slow down and try again shortly.'
ROUTE_MESSAGE = 'Too many attempts on this action. Please wait a few minutes and try again.'


def _security_event(details: str, route: str, ip: str) -> None:
    try:
        execute(
            "INSERT INTO security_events (event_type, severity, user_id, email, ip, route, details) "
            "VALUES ('RATE_LIMITED', 'warning', NULL, NULL, :ip, :route, :details)",
            {"ip": ip, "route": route[:120], "details": details[:255]},
        )
    except Exception:
        log.exception("rate limit security_event failed")


def _over_limit(key: str, max_hits: int, window: int, ip: str) -> bool:
    """Count, then record. The PHP's order, and its off-by-one too.

    Times are computed by the database in UTC rather than by this process: the
    PHP pins its connection to UTC and this one does not, and a window whose
    ends are measured by two different clocks is not one window.
    """
    identifier = key[:191]
    found = row(
        "SELECT COUNT(*) AS n FROM login_attempts WHERE identifier = :id "
        "AND created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL :w SECOND)",
        {"id": identifier, "w": window},
    )
    if found and int(found["n"]) >= max_hits:
        _security_event(f"{identifier} exceeded {max_hits} in {window}s", identifier, ip)
        return True
    execute(
        "INSERT INTO login_attempts (identifier, email, ip, created_at) "
        "VALUES (:id, '', :ip, UTC_TIMESTAMP())",
        {"id": identifier, "ip": ip},
    )
    return False


def _refuse(message: str, window: int) -> JSONResponse:
    return JSONResponse({"detail": message}, status_code=429,
                        headers={"Retry-After": str(window)})


async def guard_request(request: Request, call_next):
    """Runs before routing, as the PHP's dispatcher does.

    A limiter that cannot reach the database must not take the site down with
    it, so a failure here lets the request through and says so in the log. The
    PHP would raise; here the alternative is every page failing closed on a
    transient database blip, which is the worse of the two.
    """
    path = request.url.path
    route = path[4:].rstrip("/") if path.startswith("/api") else path
    ip = client_ip(request)

    try:
        max_hits, window = RATE_GLOBAL
        if _over_limit(f"rl:all:{ip}", max_hits, window, ip):
            return _refuse(GLOBAL_MESSAGE, window)

        key = f"{request.method} {route}"
        if key in RATE_ROUTES:
            max_hits, window = RATE_ROUTES[key]
            if _over_limit(f"rl:{key}:{ip}", max_hits, window, ip):
                return _refuse(ROUTE_MESSAGE, window)
    except Exception:
        log.exception("rate limit check failed for %s", path)

    return await call_next(request)
