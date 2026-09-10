"""Security regression tests: CORS, brute-force lockout, PHP export bcrypt-only."""
import io
import os
import re
import time
import zipfile

import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")


def test_brute_force_lockout_returns_429():
    """After 5 failed attempts in 15 min, the 6th should return 429."""
    # Use a unique bogus email so we don't lock out real seeded users
    bogus_email = f"bruteforce_probe_{int(time.time())}@example.com"
    codes = []
    for _ in range(5):
        r = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": bogus_email, "password": "wrong-pass"},
            timeout=15,
        )
        codes.append(r.status_code)
    # 5 wrong attempts should be 401
    assert all(c == 401 for c in codes), f"Expected all 401, got {codes}"
    # 6th must be 429
    r6 = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": bogus_email, "password": "wrong-pass"},
        timeout=15,
    )
    assert r6.status_code == 429, f"Expected 429 lockout, got {r6.status_code}: {r6.text}"
    body = r6.json()
    detail = body.get("detail", "").lower()
    assert "lock" in detail or "429" in str(r6.status_code)


def test_cors_allowed_origin():
    """Allowed origin should be echoed back in CORS response."""
    r = requests.options(
        f"{BASE_URL}/api/auth/login",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "Content-Type",
        },
        timeout=15,
    )
    aco = r.headers.get("access-control-allow-origin", "")
    acc = r.headers.get("access-control-allow-credentials", "")
    # Should reflect localhost:3000 (explicit) with credentials true, NOT wildcard
    assert aco == "http://localhost:3000", f"Unexpected ACAO: {aco!r}"
    assert acc.lower() == "true"


def test_cors_disallowed_origin_no_credentialed_wildcard():
    """Unknown origin must NOT get ACAO=* with credentials=true, nor be reflected."""
    r = requests.options(
        f"{BASE_URL}/api/auth/login",
        headers={
            "Origin": "http://evil.example.com",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "Content-Type",
        },
        timeout=15,
    )
    aco = r.headers.get("access-control-allow-origin", "")
    acc = r.headers.get("access-control-allow-credentials", "")
    # It's OK for ACAO to be missing/empty. But it must not be "*" with credentials true,
    # and it must not reflect the evil origin.
    assert aco != "*" or acc.lower() != "true", (
        f"Insecure CORS: ACAO=* with credentials=true (aco={aco!r}, acc={acc!r})"
    )
    assert aco != "http://evil.example.com", (
        f"Insecure CORS: reflected untrusted origin (aco={aco!r})"
    )


def test_hostinger_php_login_uses_password_verify_only():
    r = requests.get(f"{BASE_URL}/api/hostinger/package", timeout=20)
    assert r.status_code == 200
    payload = r.json()
    api_php = payload["api_php"]
    # Must use password_verify
    assert "password_verify(" in api_php, "PHP login must use password_verify()"
    # Must NOT contain any plaintext-password OR-bypass patterns
    forbidden_patterns = [
        r"\$password\s*===?\s*['\"]Banking@123['\"]",
        r"\$password\s*===?\s*['\"]Admin@123['\"]",
        r"\$password\s*===?\s*['\"]Corporate@123['\"]",
        r"password_verify\([^)]*\)\s*\|\|",  # verify(...) || <bypass>
    ]
    for pat in forbidden_patterns:
        assert re.search(pat, api_php) is None, f"Forbidden plaintext bypass pattern found: {pat}"


def test_hostinger_schema_contains_real_bcrypt_hashes():
    r = requests.get(f"{BASE_URL}/api/hostinger/package", timeout=20)
    assert r.status_code == 200
    schema = r.json()["schema_sql"]
    # Placeholders must be replaced
    assert "{{ADMIN_PWD_HASH}}" not in schema
    assert "{{RETAIL_PWD_HASH}}" not in schema
    assert "{{CORP_PWD_HASH}}" not in schema
    # Should contain real bcrypt hashes ($2b$ or $2y$, 60 chars)
    hashes = re.findall(r"\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}", schema)
    assert len(hashes) >= 3, f"Expected >=3 bcrypt hashes in schema, got {len(hashes)}"
    # Ensure the exact placeholder-like fake from prior iteration is not present
    assert "w8T0iK3yAEv7pBqXkP8n" not in schema


def test_hostinger_zip_schema_has_real_bcrypt():
    r = requests.get(f"{BASE_URL}/api/hostinger/download-zip", timeout=20)
    assert r.status_code == 200
    assert r.headers.get("content-type", "").startswith("application/zip")
    zf = zipfile.ZipFile(io.BytesIO(r.content))
    names = zf.namelist()
    for f in ["db.php", "api.php", "schema.sql", ".htaccess", "INSTALL_HOSTINGER.md"]:
        assert f in names, f"Missing {f} in zip"
    schema = zf.read("schema.sql").decode()
    hashes = re.findall(r"\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}", schema)
    assert len(hashes) >= 3
    api_php = zf.read("api.php").decode()
    assert "password_verify(" in api_php
