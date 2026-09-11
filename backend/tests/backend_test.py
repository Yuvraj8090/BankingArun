"""Regression coverage for the public banking API critical workflows."""
import io
import os
import zipfile

import pytest
import requests


BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
RETAIL = {"email": "rahul.sharma@example.com", "password": "Banking@123"}
CORPORATE = {"email": "tata.corp@example.com", "password": "Corporate@123"}
ADMIN = {"email": "manager@ajspay.in", "password": "Admin@123"}


def login(credentials):
    session = requests.Session()
    response = session.post(f"{BASE_URL}/api/auth/login", json=credentials, timeout=20)
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["user"]["email"] == credentials["email"]
    assert data["token"]
    return session, data


def test_login_all_seeded_roles_and_cookie():
    for credentials, role in [(RETAIL, "retail"), (CORPORATE, "corporate"), (ADMIN, "admin")]:
        session, data = login(credentials)
        assert data["user"]["role"] == role
        cookie = session.cookies.get("access_token")
        assert cookie
        assert "HttpOnly" in session.cookies.get_dict() or "access_token" in session.cookies


def test_retail_accounts_cards_and_transactions():
    session, _ = login(RETAIL)
    accounts = session.get(f"{BASE_URL}/api/accounts", timeout=20)
    assert accounts.status_code == 200
    payload = accounts.json()
    assert payload["accounts"][0]["account_number"] == "AJSP00984521098"
    assert payload["total_savings_balance"] >= 0
    assert payload["cards"] and payload["deposits"]
    txns = session.get(f"{BASE_URL}/api/accounts/transactions", timeout=20)
    assert txns.status_code == 200 and isinstance(txns.json()["transactions"], list)


def test_transaction_password_and_invalid_transfer_validation():
    session, _ = login(RETAIL)
    good = session.post(f"{BASE_URL}/api/auth/verify-transaction-pin", json={"transaction_password": "Txn@1234"}, timeout=20)
    bad = session.post(f"{BASE_URL}/api/auth/verify-transaction-pin", json={"transaction_password": "wrong"}, timeout=20)
    assert good.status_code == 200 and good.json()["status"] == "valid"
    assert bad.status_code == 400
    invalid = session.post(f"{BASE_URL}/api/accounts/transfer", json={"from_account_number": "AJSP00984521098", "to_account_number": "external-1", "beneficiary_name": "Test", "transfer_type": "IMPS", "amount": 0, "transaction_password": "Txn@1234"}, timeout=20)
    assert invalid.status_code == 400


def test_transfer_and_balance_persistence():
    session, _ = login(RETAIL)
    before = session.get(f"{BASE_URL}/api/accounts", timeout=20).json()["total_savings_balance"]
    response = session.post(f"{BASE_URL}/api/accounts/transfer", json={"from_account_number": "AJSP00984521098", "to_account_number": "external-test-1", "beneficiary_name": "Regression Beneficiary", "beneficiary_ifsc": "AJSP0000042", "transfer_type": "UPI", "amount": 1, "transaction_password": "Txn@1234", "remarks": "Regression"}, timeout=20)
    assert response.status_code == 200 and response.json()["status"] == "SUCCESS"
    after = session.get(f"{BASE_URL}/api/accounts", timeout=20).json()["total_savings_balance"]
    assert after == before - 1


def test_card_freeze_unfreeze_and_limits():
    session, _ = login(RETAIL)
    cards = session.get(f"{BASE_URL}/api/cards", timeout=20).json()["cards"]
    card_id = cards[0]["id"]
    for action, expected in [("freeze", "frozen"), ("unfreeze", "active")]:
        response = session.post(f"{BASE_URL}/api/cards/manage", json={"card_id": card_id, "action": action}, timeout=20)
        assert response.status_code == 200 and response.json()["card"]["status"] == expected
    response = session.post(f"{BASE_URL}/api/cards/manage", json={"card_id": card_id, "action": "update_limits", "online_limit": 90000, "atm_limit": 40000, "international_enabled": False}, timeout=20)
    assert response.status_code == 200 and response.json()["card"]["online_limit"] == 90000


def test_catalog_deposit_loan_and_chat():
    session, _ = login(RETAIL)
    catalog = session.get(f"{BASE_URL}/api/investments/catalog", timeout=20)
    assert catalog.status_code == 200 and len(catalog.json()["mutual_funds"]) >= 3
    deposit = session.post(f"{BASE_URL}/api/deposits/book", json={"account_number": "AJSP00984521098", "deposit_type": "fixed", "amount": 1, "tenure_months": 12}, timeout=20)
    assert deposit.status_code == 200 and deposit.json()["deposit"]["principal_amount"] == 1
    loan = session.post(f"{BASE_URL}/api/loans/apply", json={"loan_type": "personal", "amount_requested": 1000, "tenure_months": 12, "monthly_income": 100000, "employment_type": "salaried", "purpose": "Regression"}, timeout=20)
    assert loan.status_code == 200 and loan.json()["calculated_emi"] > 0
    chat = session.post(f"{BASE_URL}/api/support/chat", json={"message": "What is the IFSC code?"}, timeout=20)
    assert chat.status_code == 200 and "AJSP0000042" in chat.json()["response"]


def test_branch_locator_and_admin_reports_permissions():
    branches = requests.get(f"{BASE_URL}/api/branches/locator", timeout=20)
    assert branches.status_code == 200 and len(branches.json()["branches"]) >= 5
    retail, _ = login(RETAIL)
    assert retail.get(f"{BASE_URL}/api/admin/overview", timeout=20).status_code == 403
    admin, _ = login(ADMIN)
    overview = admin.get(f"{BASE_URL}/api/admin/overview", timeout=20)
    reports = admin.get(f"{BASE_URL}/api/admin/rbi-reports", timeout=20)
    assert overview.status_code == 200 and overview.json()["stats"]["total_customers"] >= 3
    assert reports.status_code == 200 and reports.json()["regulatory_authority"] == "Reserve Bank of India (RBI)"


def test_hostinger_package_and_download_zip():
    package = requests.get(f"{BASE_URL}/api/hostinger/package", timeout=20)
    assert package.status_code == 200
    assert {"db_php", "api_php", "schema_sql", "htaccess", "deploy_guide"}.issubset(package.json())
    archive = requests.get(f"{BASE_URL}/api/hostinger/download-zip", timeout=20)
    assert archive.status_code == 200 and archive.headers.get("content-type", "").startswith("application/zip")
    names = zipfile.ZipFile(io.BytesIO(archive.content)).namelist()
    assert "schema.sql" in names and "api.php" in names and "db.php" in names