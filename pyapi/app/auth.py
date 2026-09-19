"""Session resolution, mirroring api.php's current_user().

The checks are the PHP's, in the PHP's order: signature, expiry, then the
session_version claim against the row, so that logging out revokes every token
issued before it. An impersonated session stays valid only while the owner's
own session does.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import Request

from .config import config
from .db import execute, row
from .responses import fail
from .security import verify_token


def bearer_token(request: Request) -> str:
    token = request.cookies.get("access_token") or ""
    if token:
        return token
    header = request.headers.get("authorization", "")
    return header[7:] if header.startswith("Bearer ") else ""


def current_user(request: Request) -> dict:
    """The authenticated member, or an HTTPException with the PHP's wording."""
    token = bearer_token(request)
    if not token:
        raise fail(401, "Authentication token required. Please login.")
    claims, reason = verify_token(token, config()["token_secret"])
    if claims is None:
        # The wording is what the member reads, and the two cases mean different
        # things: one is a token that has aged out, the other is one that does
        # not verify.
        raise fail(401, "Session expired. Please log in again." if reason == "expired"
                   else "Invalid session token.")

    user = row("SELECT * FROM users WHERE id = :id", {"id": str(claims.get("sub", ""))})
    if not user or int(user["session_version"]) != int(claims.get("ver", -1)):
        raise fail(401, "Invalid session token.")

    # Added to the PHP after this module was first written: a session revoked
    # from another device must stop working here too, or a member who signs a
    # device out finds the ported routes still answering it.
    if "sid" in claims:
        session = row("SELECT * FROM sessions WHERE id = :id", {"id": str(claims["sid"])})
        if not session or session.get("revoked_at") is not None:
            raise fail(401, "This session was ended from another device. Please sign in again.")
        # Written at most once a minute, as the PHP does: a timestamp on every
        # request turns each authenticated read into a write.
        last_seen = session.get("last_seen_at")
        if last_seen is not None and (
            datetime.now(timezone.utc).replace(tzinfo=None) - last_seen
        ) > timedelta(seconds=60):
            execute(
                "UPDATE sessions SET last_seen_at = :now, ip = :ip WHERE id = :id",
                {"now": datetime.now(timezone.utc).replace(tzinfo=None),
                 "ip": client_ip(request), "id": session["id"]},
            )

    if "imp" in claims:
        actor = row("SELECT * FROM users WHERE id = :id", {"id": str(claims["imp"])})
        if not actor or int(actor["session_version"]) != int(claims.get("imp_ver", -1)):
            raise fail(401, "This support session has ended. Please sign in again.")
        request.state.impersonator = actor
    else:
        request.state.impersonator = None
    return user


def staff_user(request: Request, roles: list[str]) -> dict:
    user = current_user(request)
    if user["role"] not in roles:
        raise fail(403, "Access restricted. Required role: " + ", ".join(roles))
    return user


def client_ip(request: Request) -> str:
    """The address the PHP records, taken the same way."""
    return (request.client.host if request.client else "") or ""
