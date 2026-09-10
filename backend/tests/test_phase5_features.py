"""Phase 5 backend tests: Referrals, Standing Instructions, Video KYC + Face Match, Super-Admin Config."""
import os
import io
import base64
import uuid
import pytest
import requests
from PIL import Image

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"

RETAIL = ("rahul.sharma@example.com", "Banking@123")
OWNER = ("owner@nbbank.in", "Owner@123")
ADMIN = ("manager.sbi@example.com", "Admin@123")


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"login failed {email}: {r.status_code} {r.text}"
    return r.json()["token"]


def _hdr(t):
    return {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}


def _b64_jpeg(color=(200, 100, 50), size=(320, 320)):
    # Make it > 1000 bytes decoded (server validation floor)
    import random as _r
    img = Image.new("RGB", size, color)
    # Add noise so JPEG doesn't compress to a trivially small size
    px = img.load()
    _r.seed(sum(color))
    for i in range(0, size[0], 3):
        for j in range(0, size[1], 3):
            px[i, j] = (
                (color[0] + _r.randint(-40, 40)) % 256,
                (color[1] + _r.randint(-40, 40)) % 256,
                (color[2] + _r.randint(-40, 40)) % 256,
            )
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return base64.b64encode(buf.getvalue()).decode()


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def retail_token():
    return _login(*RETAIL)


@pytest.fixture(scope="module")
def owner_token():
    return _login(*OWNER)


@pytest.fixture(scope="module")
def admin_token():
    return _login(*ADMIN)


# ============================================================================
# REFERRALS
# ============================================================================
class TestReferrals:
    def test_my_code_returns_persistent_code(self, retail_token):
        r1 = requests.get(f"{API}/referrals/my-code", headers=_hdr(retail_token))
        assert r1.status_code == 200
        d1 = r1.json()
        assert "referral_code" in d1 and len(d1["referral_code"]) >= 5
        assert "?ref=" in d1["referral_link"]
        assert d1["reward_amount"] == 500.0 or d1["reward_amount"] == 500
        # Persistence
        r2 = requests.get(f"{API}/referrals/my-code", headers=_hdr(retail_token))
        assert r2.json()["referral_code"] == d1["referral_code"]

    def test_register_with_referral_credits_both(self, retail_token):
        # Get retail's referral code + initial savings balance
        code = requests.get(f"{API}/referrals/my-code", headers=_hdr(retail_token)).json()["referral_code"]
        accs = requests.get(f"{API}/accounts", headers=_hdr(retail_token)).json()
        accs_list = accs.get("accounts", accs) if isinstance(accs, dict) else accs
        savings = next(a for a in accs_list if a["account_number"] == "SBI00984521098")
        pre_bal = savings["balance"]

        # Register new user with the code
        new_email = f"referee_{uuid.uuid4().hex[:8]}@test.com"
        payload = {
            "name": "Referee Test",
            "email": new_email,
            "phone": "+919" + str(uuid.uuid4().int)[:9],
            "password": "Refer@1234",
            "transaction_password": "Refer@Txn1",
            "account_type": "savings",
            "initial_deposit": 1000,
            "referral_code": code,
        }
        rr = requests.post(f"{API}/auth/register", json=payload)
        assert rr.status_code == 200, f"register failed: {rr.status_code} {rr.text}"
        data = rr.json()
        assert data.get("referral_bonus") == 500 or data.get("referral_bonus") == 500.0, f"referral_bonus={data.get('referral_bonus')}"

        # Referee balance = 1000 + 500 = 1500
        new_token = data["token"]
        new_accs = requests.get(f"{API}/accounts", headers=_hdr(new_token)).json()
        new_list = new_accs.get("accounts", new_accs) if isinstance(new_accs, dict) else new_accs
        assert any(abs(a["balance"] - 1500) < 0.01 for a in new_list), f"expected 1500 balance, got {new_list}"

        # Referrer got +500
        accs_after = requests.get(f"{API}/accounts", headers=_hdr(retail_token)).json()
        after_list = accs_after.get("accounts", accs_after) if isinstance(accs_after, dict) else accs_after
        savings_after = next(a for a in after_list if a["account_number"] == "SBI00984521098")
        assert abs(savings_after["balance"] - (pre_bal + 500)) < 0.01, f"pre={pre_bal} post={savings_after['balance']}"

        # History includes referral
        hist = requests.get(f"{API}/referrals/history", headers=_hdr(retail_token)).json()
        assert hist["count"] >= 1
        assert hist["total_earned"] >= 500
        assert any(r["referee_email"] == new_email and r["status"] == "paid" for r in hist["referrals"])


# ============================================================================
# STANDING INSTRUCTIONS
# ============================================================================
class TestStandingInstructions:
    created_id = None

    def test_full_crud_flow(self, retail_token):
        h = _hdr(retail_token)
        # Initial list — may or may not be empty (depends on prior runs); just ensure 200
        r0 = requests.get(f"{API}/standing-instructions", headers=h)
        assert r0.status_code == 200
        initial_count = r0.json()["count"]

        # Create
        payload = {
            "from_account_number": "SBI00984521098",
            "beneficiary_name": "TEST Landlord",
            "beneficiary_account": "HDFC00099887766",
            "beneficiary_ifsc": "HDFC0000100",
            "amount": 25000,
            "frequency": "monthly",
            "category": "rent",
            "start_date": "2026-03-01",
            "remarks": "TEST monthly rent"
        }
        rc = requests.post(f"{API}/standing-instructions", json=payload, headers=h)
        assert rc.status_code == 200, rc.text
        d = rc.json()
        assert d["status"] == "SUCCESS"
        si_id = d["instruction"]["id"]
        assert d["instruction"]["status"] == "active"
        assert d["instruction"]["category"] == "rent"
        TestStandingInstructions.created_id = si_id

        # Verify in list
        rl = requests.get(f"{API}/standing-instructions", headers=h).json()
        assert rl["count"] == initial_count + 1
        assert any(i["id"] == si_id for i in rl["items"])

        # Patch amount
        rp = requests.patch(f"{API}/standing-instructions/{si_id}", json={"amount": 27500}, headers=h)
        assert rp.status_code == 200
        updated = next(i for i in requests.get(f"{API}/standing-instructions", headers=h).json()["items"] if i["id"] == si_id)
        assert updated["amount"] == 27500

        # Pause
        rpz = requests.post(f"{API}/standing-instructions/{si_id}/pause", headers=h)
        assert rpz.status_code == 200
        paused = next(i for i in requests.get(f"{API}/standing-instructions", headers=h).json()["items"] if i["id"] == si_id)
        assert paused["status"] == "paused"

        # Resume
        rrs = requests.post(f"{API}/standing-instructions/{si_id}/resume", headers=h)
        assert rrs.status_code == 200
        resumed = next(i for i in requests.get(f"{API}/standing-instructions", headers=h).json()["items"] if i["id"] == si_id)
        assert resumed["status"] == "active"

        # Delete
        rd = requests.delete(f"{API}/standing-instructions/{si_id}", headers=h)
        assert rd.status_code == 200

        # Subsequent delete = 404
        rd2 = requests.delete(f"{API}/standing-instructions/{si_id}", headers=h)
        assert rd2.status_code == 404

    def test_create_with_bad_account_returns_404(self, retail_token):
        payload = {
            "from_account_number": "NONEXISTENT123",
            "beneficiary_name": "X", "beneficiary_account": "Y",
            "amount": 100, "frequency": "monthly", "category": "generic",
            "start_date": "2026-03-01"
        }
        r = requests.post(f"{API}/standing-instructions", json=payload, headers=_hdr(retail_token))
        assert r.status_code == 404


# ============================================================================
# VIDEO KYC + FACE MATCH
# ============================================================================
class TestVideoKycFaceMatch:
    def test_identical_selfie_pan_auto_approves(self, admin_token):
        # Create a fresh user so we don't clobber the retail user
        email = f"kyc_{uuid.uuid4().hex[:8]}@test.com"
        reg = requests.post(f"{API}/auth/register", json={
            "name": "KYC Test", "email": email,
            "phone": "+919" + str(uuid.uuid4().int)[:9],
            "password": "Kyc@12345", "transaction_password": "Kyc@Txn1",
            "account_type": "savings", "initial_deposit": 1000
        })
        assert reg.status_code == 200, reg.text
        tok = reg.json()["token"]

        b = _b64_jpeg((200, 100, 50))
        payload = {"selfie_b64": b, "pan_b64": b, "aadhaar_b64": b}
        rs = requests.post(f"{API}/kyc/video/submit", json=payload, headers=_hdr(tok))
        assert rs.status_code == 200, rs.text
        d = rs.json()
        assert "face_match_score" in d
        assert d["face_match_score"] >= 99  # identical images should be near-100
        assert d["verdict"] == "auto_approve"
        assert d["auto_approved"] is True

        # user kyc_status should now be verified
        me = requests.get(f"{API}/auth/me", headers=_hdr(tok)).json()
        u = me.get("user", me)
        assert u.get("kyc_status") == "verified"

        # Admin face-match endpoint
        sub_id = d["submission_id"]
        rfm = requests.get(f"{API}/kyc/video/{sub_id}/face-match", headers=_hdr(admin_token))
        assert rfm.status_code == 200
        fm = rfm.json()
        assert fm["score"] >= 99
        assert fm["verdict"] == "auto_approve"

    def test_different_images_lower_score(self, admin_token):
        email = f"kyc2_{uuid.uuid4().hex[:8]}@test.com"
        reg = requests.post(f"{API}/auth/register", json={
            "name": "KYC Test2", "email": email,
            "phone": "+919" + str(uuid.uuid4().int)[:9],
            "password": "Kyc@12345", "transaction_password": "Kyc@Txn1",
            "account_type": "savings", "initial_deposit": 1000
        })
        tok = reg.json()["token"]
        # Sharply different color histograms
        a = _b64_jpeg((250, 250, 250))    # near-white
        b = _b64_jpeg((5, 5, 5))          # near-black
        c = _b64_jpeg((100, 200, 30))
        rs = requests.post(f"{API}/kyc/video/submit", json={"selfie_b64": a, "pan_b64": b, "aadhaar_b64": c},
                           headers=_hdr(tok))
        assert rs.status_code == 200
        d = rs.json()
        assert d["face_match_score"] < 99
        # Different images -> should NOT auto_approve
        assert d["verdict"] != "auto_approve" or d["auto_approved"] is False


# ============================================================================
# SUPER-ADMIN CONFIG
# ============================================================================
class TestAdminConfig:
    def test_retail_forbidden(self, retail_token):
        r = requests.get(f"{API}/admin/config", headers=_hdr(retail_token))
        assert r.status_code == 403

    def test_admin_role_forbidden(self, admin_token):
        # 'admin' role is NOT 'bank_owner' — should be 403
        r = requests.get(f"{API}/admin/config", headers=_hdr(admin_token))
        assert r.status_code == 403

    def test_owner_get_and_update(self, owner_token):
        # GET
        r = requests.get(f"{API}/admin/config", headers=_hdr(owner_token))
        assert r.status_code == 200, r.text
        cfg = r.json()
        for k in ["live_otp", "twilio_account_sid_masked", "referral_reward_amount",
                  "face_match_auto_threshold", "twilio_configured", "sendgrid_configured"]:
            assert k in cfg, f"missing key {k}"

        # PUT
        up = {
            "twilio_account_sid": "AC_TEST_123456789",
            "sendgrid_api_key": "SG_TEST_ABCDEFGHIJ",
            "referral_reward_amount": 750,
            "face_match_auto_threshold": 85,
            "live_otp": False
        }
        ru = requests.put(f"{API}/admin/config", json=up, headers=_hdr(owner_token))
        assert ru.status_code == 200, ru.text

        # Verify persisted
        r2 = requests.get(f"{API}/admin/config", headers=_hdr(owner_token)).json()
        assert r2["referral_reward_amount"] == 750
        assert r2["face_match_auto_threshold"] == 85
        assert r2["twilio_configured"] is True
        assert r2["sendgrid_configured"] is True
        # Masked contains prefix/suffix, not full secret
        assert "AC_" in r2["twilio_account_sid_masked"] or "•" in r2["twilio_account_sid_masked"]
        assert r2["twilio_account_sid_masked"] != "AC_TEST_123456789"

        # Restore defaults so other tests aren't affected
        requests.put(f"{API}/admin/config", json={"referral_reward_amount": 500,
                                                  "face_match_auto_threshold": 92,
                                                  "live_otp": False},
                     headers=_hdr(owner_token))

    def test_otp_still_mock_after_config_update(self, retail_token):
        r = requests.post(f"{API}/otp/send", json={"channel": "email", "purpose": "login"},
                          headers=_hdr(retail_token))
        assert r.status_code == 200, r.text
        d = r.json()
        # live_otp remains False, so demo_otp should appear
        assert "demo_otp" in d or d.get("mode") == "mock" or "otp" in d, f"unexpected response: {d}"


# ============================================================================
# REGRESSION SMOKE
# ============================================================================
class TestRegression:
    @pytest.mark.parametrize("email,pw", [
        ("rahul.sharma@example.com", "Banking@123"),
        ("tata.corp@example.com", "Corporate@123"),
        ("manager.sbi@example.com", "Admin@123"),
        ("owner@nbbank.in", "Owner@123"),
        ("meera.staff@nbbank.in", "Staff@123"),
        ("collections@nbbank.in", "Collect@123"),
        ("loans@nbbank.in", "Loan@123"),
    ])
    def test_all_roles_login(self, email, pw):
        r = requests.post(f"{API}/auth/login", json={"email": email, "password": pw})
        assert r.status_code == 200, f"{email}: {r.text}"

    def test_retail_cards_count_3(self, retail_token):
        r = requests.get(f"{API}/cards", headers=_hdr(retail_token))
        assert r.status_code == 200
        cards = r.json().get("cards", r.json())
        assert len(cards) == 3

    def test_upi_status(self, retail_token):
        r = requests.get(f"{API}/upi/status", headers=_hdr(retail_token))
        assert r.status_code == 200
