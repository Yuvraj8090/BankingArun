"""Session tokens, byte-compatible with the PHP implementation.

A member signed in through the PHP backend must stay signed in on a route that
has been ported, and the other way round, so these functions reproduce
api.php's sign/verify exactly: base64url without padding, HMAC-SHA256 over the
encoded payload, and the same claim names.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from typing import Any


def b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def b64url_decode(value: str) -> bytes:
    # PHP pads to a multiple of four before decoding; Python requires the same.
    padding = "=" * ((4 - len(value) % 4) % 4)
    try:
        return base64.urlsafe_b64decode(value + padding)
    except Exception:
        return b""


def sign(payload: str, secret: str) -> str:
    return b64url(hmac.new(secret.encode(), payload.encode(), hashlib.sha256).digest())


def encode_claims(claims: dict[str, Any]) -> str:
    # PHP's json_encode leaves no spaces between items; the payload is signed, so
    # a different separator would produce a different signature for equal claims.
    return b64url(json.dumps(claims, separators=(",", ":")).encode())


def make_token(claims: dict[str, Any], secret: str) -> str:
    payload = encode_claims(claims)
    return f"{payload}.{sign(payload, secret)}"


def read_claims(token: str, secret: str) -> dict[str, Any] | None:
    """Verified claims, or None when the token is absent, forged or expired.

    Mirrors peek_session_claims(): it never raises, so a guard can run before
    routing and still let a public route through.
    """
    if not token or "." not in token:
        return None
    payload, _, signature = token.partition(".")
    # compare_digest for the same reason PHP uses hash_equals: a plain ==
    # leaks how much of the signature matched through its timing.
    if not hmac.compare_digest(sign(payload, secret), signature):
        return None
    try:
        claims = json.loads(b64url_decode(payload))
    except Exception:
        return None
    if not isinstance(claims, dict) or int(claims.get("exp", 0)) < int(time.time()):
        return None
    return claims
