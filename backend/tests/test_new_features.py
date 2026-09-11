"""New features regression: 3-card seed, UPI module, role panels + RBAC."""
import os
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")

CREDS = {
    "retail": {"email": "rahul.sharma@example.com", "password": "Banking@123"},
    "corporate": {"email": "tata.corp@example.com", "password": "Corporate@123"},
    "admin": {"email": "manager@ajspay.in", "password": "Admin@123"},
    "bank_owner": {"email": "owner@ajspay.in", "password": "Owner@123"},
    "staff": {"email": "meera.staff@ajspay.in", "password": "Staff@123"},
    "collection_agent": {"email": "collections@ajspay.in", "password": "Collect@123"},
    "loan_officer": {"email": "loans@ajspay.in", "password": "Loan@123"},
}


def _login(role):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json=CREDS[role], timeout=20)
    assert r.status_code == 200, f"{role} login failed: {r.status_code} {r.text}"
    assert r.json()["user"]["role"] == role
    return s


# ---------- AUTH: all 7 roles ----------
def test_all_seven_roles_login():
    for role in CREDS:
        _login(role)


# ---------- CARDS: exact 3-card seed for retail ----------
def test_retail_has_exactly_three_seeded_cards():
    s = _login("retail")
    r = s.get(f"{BASE_URL}/api/cards", timeout=20)
    assert r.status_code == 200
    cards = r.json()["cards"]
    # Filter only the seeded cards by known IDs to allow tolerance for cards created in previous test runs
    seeded_ids = {"card-visa-001", "card-rupay-001", "card-rupay-002"}
    seeded = [c for c in cards if c["id"] in seeded_ids]
    assert len(seeded) == 3, f"Expected 3 seeded cards, got {len(seeded)}"
    by_id = {c["id"]: c for c in seeded}

    visa = by_id["card-visa-001"]
    assert visa["card_number"] == "4532 9845 2109 8821"
    assert visa["network"] == "Visa"
    assert visa["status"] == "active"
    assert visa["expiry_date"] == "08/29"
    assert visa["card_holder"] == "RAHUL SHARMA"
    assert "AJSPay" in visa["issued_by"] and "Only" in visa["issued_by"]

    rupay = by_id["card-rupay-001"]
    assert rupay["card_number"] == "5241 7373 2160 2721"
    assert rupay["network"] == "RuPay"
    assert rupay["status"] == "dispatch_queued"
    assert rupay["expiry_date"] == "06/31"

    mc = by_id["card-rupay-002"]
    assert mc["card_number"] == "5241 9548 3082 4607"
    assert mc["network"] == "Mastercard"
    assert mc["status"] == "dispatch_queued"
    assert mc["expiry_date"] == "06/31"


# ---------- UPI ----------
def test_upi_status_headline_and_primary_id():
    s = _login("retail")
    r = s.get(f"{BASE_URL}/api/upi/status", timeout=20)
    assert r.status_code == 200
    data = r.json()
    assert "UPI on Debit Card" in data["status_headline"]
    assert "NPCI" in data["status_headline"]
    assert data["primary_upi_id"] == "rahulsharma@ajspay"
    assert len(data["linkable_cards"]) >= 3


def test_upi_link_card_and_qr():
    s = _login("retail")
    status = s.get(f"{BASE_URL}/api/upi/status", timeout=20).json()
    card_id = status["linkable_cards"][0]["id"]
    r = s.post(f"{BASE_URL}/api/upi/link-card", json={"card_id": card_id}, timeout=20)
    assert r.status_code == 200 and r.json()["status"] == "SUCCESS"
    # verify persisted
    after = s.get(f"{BASE_URL}/api/upi/status", timeout=20).json()
    linked_card = next(c for c in after["linkable_cards"] if c["id"] == card_id)
    assert linked_card["upi_linked"] is True

    qr = s.get(f"{BASE_URL}/api/upi/qr", timeout=20)
    assert qr.status_code == 200
    body = qr.json()
    assert body["upi_id"] == "rahulsharma@ajspay"
    assert "pa=rahulsharma@ajspay" in body["upi_uri"]


# ---------- ROLE PANELS + RBAC ----------
def test_bank_owner_panel_and_rbac():
    owner = _login("bank_owner")
    r = owner.get(f"{BASE_URL}/api/panel/bank-owner", timeout=20)
    assert r.status_code == 200
    data = r.json()
    for k in ["total_users", "total_liquidity", "total_transactions", "active_branches", "loan_pipeline_count"]:
        assert k in data["kpis"], f"Missing KPI: {k}"
    assert isinstance(data["policies"], list) and len(data["policies"]) >= 3

    retail = _login("retail")
    forbidden = retail.get(f"{BASE_URL}/api/panel/bank-owner", timeout=20)
    assert forbidden.status_code == 403


def test_staff_panel_lists_customers():
    s = _login("staff")
    r = s.get(f"{BASE_URL}/api/panel/staff", timeout=20)
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data["recent_customers"], list)
    assert len(data["recent_customers"]) >= 1


def test_collection_panel_and_action():
    s = _login("collection_agent")
    r = s.get(f"{BASE_URL}/api/panel/collection", timeout=20)
    assert r.status_code == 200
    cases = r.json()["cases"]
    assert len(cases) >= 4
    case_id = cases[0]["id"]
    act = s.post(f"{BASE_URL}/api/panel/collection/action",
                 json={"case_id": case_id, "action": "reminder", "note": "auto-test"}, timeout=20)
    assert act.status_code == 200 and act.json()["status"] == "SUCCESS"
    # persistence
    after = s.get(f"{BASE_URL}/api/panel/collection", timeout=20).json()["cases"]
    updated = next(c for c in after if c["id"] == case_id)
    assert updated["status"] == "reminder_sent"


def test_loan_dept_panel_and_decision():
    s = _login("loan_officer")
    r = s.get(f"{BASE_URL}/api/panel/loan-dept", timeout=20)
    assert r.status_code == 200
    apps = r.json()["applications"]
    assert len(apps) >= 4
    # pick an app not already approved
    target = next((a for a in apps if a["status"] != "approved"), apps[0])
    act = s.post(f"{BASE_URL}/api/panel/loan-dept/decision",
                 json={"application_id": target["id"], "decision": "approve"}, timeout=20)
    assert act.status_code == 200 and act.json()["status"] == "SUCCESS"
    after = s.get(f"{BASE_URL}/api/panel/loan-dept", timeout=20).json()["applications"]
    updated = next(a for a in after if a["id"] == target["id"])
    assert updated["status"] == "approved"


# ---------- SECURITY: brute-force lockout at 5 attempts ----------
def test_brute_force_lockout_at_five_attempts():
    import time
    email = f"bf_probe_{int(time.time())}@example.com"
    codes = []
    for _ in range(5):
        r = requests.post(f"{BASE_URL}/api/auth/login",
                          json={"email": email, "password": "wrong"}, timeout=15)
        codes.append(r.status_code)
    assert all(c == 401 for c in codes), f"expected 401s, got {codes}"
    r6 = requests.post(f"{BASE_URL}/api/auth/login",
                       json={"email": email, "password": "wrong"}, timeout=15)
    assert r6.status_code == 429, f"expected 429 at 6th attempt, got {r6.status_code} {r6.text}"
