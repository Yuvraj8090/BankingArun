"""Phase 4 features: OTP MOCK, WebAuthn passkeys, Video KYC, PDF+Excel statements."""
import os
import base64
import io
import struct
import zlib
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")

RETAIL = {"email": "rahul.sharma@example.com", "password": "Banking@123"}
ADMIN = {"email": "manager@ajspay.in", "password": "Admin@123"}


def _login(creds):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return s


def _make_png_data_uri(size_bytes: int = 2000, rgb: bytes = b"\xff\x00\x00") -> str:
    """Generate a valid tiny PNG then pad to ensure >1KB decoded base64."""
    # Minimal 1x1 PNG
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr_data = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    ihdr = b"IHDR" + ihdr_data
    ihdr_chunk = struct.pack(">I", len(ihdr_data)) + ihdr + struct.pack(">I", zlib.crc32(ihdr))
    raw = b"\x00" + rgb
    idat_data = zlib.compress(raw)
    idat = b"IDAT" + idat_data
    idat_chunk = struct.pack(">I", len(idat_data)) + idat + struct.pack(">I", zlib.crc32(idat))
    iend = b"IEND"
    iend_chunk = struct.pack(">I", 0) + iend + struct.pack(">I", zlib.crc32(iend))
    png = sig + ihdr_chunk + idat_chunk + iend_chunk
    # Pad decoded bytes to > 1KB by appending arbitrary bytes (still decodes to something)
    padding = b"X" * max(0, size_bytes - len(png))
    payload = png + padding
    return "data:image/png;base64," + base64.b64encode(payload).decode()


# ---------- OTP MOCK ----------
class TestOtp:
    def test_send_email_login_returns_demo_otp(self):
        s = _login(RETAIL)
        r = s.post(f"{BASE_URL}/api/otp/send", json={"channel": "email", "purpose": "login"}, timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "SUCCESS"
        assert d["live_mode"] is False
        assert d["delivery"] == {"sms": "MOCKED", "email": "MOCKED"}
        assert "demo_otp" in d
        assert len(d["demo_otp"]) == 6 and d["demo_otp"].isdigit()

    def test_verify_success_then_no_active(self):
        s = _login(RETAIL)
        # Uses "pin_reset" rather than "login": tests on the other xdist worker also
        # send login OTPs for this same user, which would clobber the record mid-test.
        send = s.post(f"{BASE_URL}/api/otp/send", json={"channel": "email", "purpose": "pin_reset"}, timeout=20).json()
        otp = send["demo_otp"]
        ok = s.post(f"{BASE_URL}/api/otp/verify", json={"purpose": "pin_reset", "otp": otp}, timeout=20)
        assert ok.status_code == 200 and ok.json()["status"] == "SUCCESS"
        # second verify -> No active OTP
        again = s.post(f"{BASE_URL}/api/otp/verify", json={"purpose": "pin_reset", "otp": otp}, timeout=20)
        assert again.status_code == 400
        assert "No active OTP" in again.json()["detail"]

    def test_verify_wrong_otp(self):
        s = _login(RETAIL)
        s.post(f"{BASE_URL}/api/otp/send", json={"channel": "email", "purpose": "txn"}, timeout=20)
        bad = s.post(f"{BASE_URL}/api/otp/verify", json={"purpose": "txn", "otp": "000000"}, timeout=20)
        # If demo_otp happened to be 000000, retry once
        if bad.status_code == 200:
            s.post(f"{BASE_URL}/api/otp/send", json={"channel": "email", "purpose": "txn"}, timeout=20)
            bad = s.post(f"{BASE_URL}/api/otp/verify", json={"purpose": "txn", "otp": "111111"}, timeout=20)
        assert bad.status_code == 400
        assert "Invalid OTP" in bad.json()["detail"]


# ---------- PASSKEYS ----------
class TestPasskeys:
    def test_list_empty_and_rp(self):
        s = _login(RETAIL)
        r = s.get(f"{BASE_URL}/api/passkey/list", timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert "passkeys" in d
        assert d["rp_id"] == "localhost"
        assert d["rp_name"]

    def test_register_challenge_returns_options(self):
        s = _login(RETAIL)
        r = s.post(f"{BASE_URL}/api/passkey/register/challenge", timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "challenge" in d and isinstance(d["challenge"], str) and len(d["challenge"]) > 8
        assert "user" in d and "id" in d["user"]
        assert d.get("rp", {}).get("id") == "localhost"

    def test_delete_nonexistent_returns_404(self):
        s = _login(RETAIL)
        r = s.delete(f"{BASE_URL}/api/passkey/does-not-exist-xyz", timeout=20)
        assert r.status_code == 404

    def test_login_challenge_no_passkey(self):
        # rahul has no registered passkey (fresh)
        r = requests.post(f"{BASE_URL}/api/passkey/login/challenge",
                          json={"email": RETAIL["email"]}, timeout=20)
        assert r.status_code == 400
        assert "No passkey registered" in r.json()["detail"]


# ---------- VIDEO KYC ----------
class TestVideoKyc:
    _submission_id = None

    def test_submit_invalid_short_frames(self):
        s = _login(RETAIL)
        tiny = "data:image/png;base64," + base64.b64encode(b"x" * 50).decode()
        r = s.post(f"{BASE_URL}/api/kyc/video/submit",
                   json={"selfie_b64": tiny, "pan_b64": tiny, "aadhaar_b64": tiny,
                         "liveness_words": "ok"}, timeout=20)
        assert r.status_code == 400
        assert "invalid" in r.json()["detail"].lower()

    def test_submit_valid_frames(self):
        s = _login(RETAIL)
        # Selfie and PAN must differ: identical frames score ~100 on face-match and
        # get auto-approved, which is the separate phase-5 path tested elsewhere.
        selfie = _make_png_data_uri(2000, rgb=b"\xff\x00\x00")
        pan = _make_png_data_uri(2000, rgb=b"\x00\x00\xff")
        r = s.post(f"{BASE_URL}/api/kyc/video/submit",
                   json={"selfie_b64": selfie, "pan_b64": pan, "aadhaar_b64": pan,
                         "liveness_words": "banking now", "device_info": "test-suite"}, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "SUCCESS"
        assert d.get("submission_id")
        TestVideoKyc._submission_id = d["submission_id"]

        # user marked pending_approval
        me = s.get(f"{BASE_URL}/api/auth/me", timeout=20).json()
        user_doc = me.get("user", me)
        assert user_doc.get("kyc_status") == "pending_approval"

    def test_admin_queue_and_decision(self):
        assert TestVideoKyc._submission_id, "submit test must run first"
        admin = _login(ADMIN)
        q = admin.get(f"{BASE_URL}/api/kyc/video/queue", timeout=20)
        assert q.status_code == 200
        subs = q.json()["submissions"]
        found = next((x for x in subs if x["id"] == TestVideoKyc._submission_id), None)
        assert found is not None, "submitted KYC not in admin queue"
        assert "selfie_thumb" in found
        assert "pan_b64" not in found and "aadhaar_b64" not in found

        detail = admin.get(f"{BASE_URL}/api/kyc/video/{TestVideoKyc._submission_id}", timeout=20)
        assert detail.status_code == 200
        full = detail.json()
        assert full["selfie_b64"] and full["pan_b64"] and full["aadhaar_b64"]

        dec = admin.post(f"{BASE_URL}/api/kyc/video/decision",
                         json={"submission_id": TestVideoKyc._submission_id,
                               "decision": "approve", "reason": "auto-test"}, timeout=20)
        assert dec.status_code == 200 and dec.json()["status"] == "SUCCESS"


# ---------- STATEMENTS ----------
class TestStatements:
    def test_pdf_ok_for_own_account(self):
        s = _login(RETAIL)
        r = s.get(f"{BASE_URL}/api/statements/pdf",
                  params={"account_number": "AJSP00984521098"}, timeout=30)
        assert r.status_code == 200, r.text
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert "attachment" in r.headers.get("content-disposition", "").lower()
        assert r.content[:5] == b"%PDF-"

    def test_excel_ok_for_own_account(self):
        s = _login(RETAIL)
        r = s.get(f"{BASE_URL}/api/statements/excel",
                  params={"account_number": "AJSP00984521098"}, timeout=30)
        assert r.status_code == 200
        ct = r.headers.get("content-type", "")
        assert "spreadsheetml" in ct or "officedocument" in ct
        assert r.content[:2] == b"PK"

    def test_wrong_account_404(self):
        s = _login(RETAIL)
        r = s.get(f"{BASE_URL}/api/statements/pdf",
                  params={"account_number": "AJSP00129845612"}, timeout=20)
        assert r.status_code == 404
        r2 = s.get(f"{BASE_URL}/api/statements/excel",
                   params={"account_number": "AJSP00129845612"}, timeout=20)
        assert r2.status_code == 404
