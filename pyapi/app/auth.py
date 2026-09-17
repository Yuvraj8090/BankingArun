"""Session resolution, mirroring api.php's current_user().

The checks are the PHP's, in the PHP's order: signature, expiry, then the
session_version claim against the row, so that logging out revokes every token
issued before it. An impersonated session stays valid only while the owner's
own session does.
"""
from __future__ import annotations

from fastapi import Request

from .config import config
from .db import row
from .responses import fail
from .security import read_claims


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
    claims = read_claims(token, config()["token_secret"])
    if claims is None:
        # read_claims folds a bad signature and an expired token together; the
        # PHP distinguishes them, and the wording is what the app displays.
        payload, _, _ = token.partition(".")
        raise fail(401, "Session expired. Please log in again." if payload else "Invalid session token.")

    user = row("SELECT * FROM users WHERE id = :id", {"id": str(claims.get("sub", ""))})
    if not user or int(user["session_version"]) != int(claims.get("ver", -1)):
        raise fail(401, "Invalid session token.")

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
