"""The Python and PHP backends must agree on every session token.

Skipped where no PHP binary is available; run it wherever both exist, because a
divergence here signs every member out.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.security import make_token, read_claims, sign  # noqa: E402

SECRET = "b6f1c0d9e8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1"

PHP_MINT = r'''
$secret = $argv[1];
$claims = json_decode($argv[2], true);
function b64url(string $r): string { return rtrim(strtr(base64_encode($r), "+/", "-_"), "="); }
$p = b64url(json_encode($claims));
echo $p . "." . b64url(hash_hmac("sha256", $p, $secret, true));
'''


def php_mint(claims: dict) -> str:
    return subprocess.run(
        ["php", "-r", PHP_MINT, SECRET, json.dumps(claims, separators=(",", ":"))],
        capture_output=True, text=True, check=True,
    ).stdout.strip()


def test_python_accepts_php_tokens() -> None:
    if not shutil.which("php"):
        print("php not available; skipped")
        return
    claims = {"sub": "u-1", "role": "retail", "ver": 3, "exp": int(time.time()) + 3600}
    assert read_claims(php_mint(claims), SECRET) == claims


def test_python_rejects_a_tampered_token() -> None:
    claims = {"sub": "u-1", "role": "retail", "ver": 1, "exp": int(time.time()) + 3600}
    token = make_token(claims, SECRET)
    payload, _, signature = token.partition(".")
    # Escalating the role must invalidate the signature, not ride along with it.
    forged = make_token({**claims, "role": "bank_owner"}, SECRET).partition(".")[0]
    assert read_claims(f"{forged}.{signature}", SECRET) is None


def test_python_rejects_expired() -> None:
    assert read_claims(make_token({"sub": "u", "role": "retail", "ver": 1, "exp": int(time.time()) - 1}, SECRET), SECRET) is None


def test_signature_is_stable() -> None:
    assert sign("abc", SECRET) == sign("abc", SECRET)


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn()
            print(f"PASS {name}")
