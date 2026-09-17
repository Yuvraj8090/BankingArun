# AJSPay API — Python port

Runs **alongside** the PHP backend, never instead of it. Apache proxies only the
paths listed in `PORTED_PATHS` to this service; every other `/api/*` request
still reaches `api.php`. Both read the same MariaDB and verify the same session
tokens, so a member cannot tell which one answered.

## Why the tokens must match

`app/security.py` reproduces `api.php`'s signing exactly — base64url without
padding, HMAC-SHA256 over the encoded payload, identical claim names and
compact JSON separators. This is verified in `tests/test_token_compat.py`
against the real PHP. If it ever diverges, every signed-in member is logged out
the moment a route is proxied here.

## Moving a route across

1. Port the handler, keeping the URL, the response keys and the error wording.
2. Compare both backends' output for the same request until they match byte for
   byte.
3. Add the path to `PORTED_PATHS` in `scripts/pyapi-proxy.conf` and reload Apache.

Rolling back is removing the path and reloading — the PHP route was never
deleted.

## Order of work

Read-only and public routes first, then authenticated reads, then writes, and
money movement last.
