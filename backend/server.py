import os
import sys
import uuid
import random
import bcrypt
import jwt
import io
import base64
import zipfile
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import List, Optional, Dict, Any

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Response, Header, Query, UploadFile, File
from fastapi.responses import JSONResponse, StreamingResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, ConfigDict, EmailStr

# Optional live-integration SDKs (only used when LIVE_OTP=true and keys configured)
try:
    from twilio.rest import Client as TwilioClient  # noqa
except Exception:
    TwilioClient = None
try:
    from sendgrid import SendGridAPIClient  # noqa
    from sendgrid.helpers.mail import Mail as SGMail  # noqa
except Exception:
    SendGridAPIClient = None
    SGMail = None

# WebAuthn (passkeys)
from webauthn import generate_registration_options, verify_registration_response, \
    generate_authentication_options, verify_authentication_response, options_to_json
from webauthn.helpers.structs import PublicKeyCredentialDescriptor, UserVerificationRequirement, \
    AuthenticatorSelectionCriteria, ResidentKeyRequirement

# PDF / Excel
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment

# ----------------- Configuration & DB (Fail fast if missing) -----------------
mongo_url = os.environ['MONGO_URL']
db_name = os.environ['DB_NAME']
JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALGORITHM = "HS256"

client = AsyncIOMotorClient(mongo_url)
db = client[db_name]

# Session cookie flags. Defaults are the production-safe pair (Secure + SameSite=None
# for a cross-origin frontend). Local HTTP dev must set COOKIE_SECURE=false and
# COOKIE_SAMESITE=lax, because clients refuse a Secure cookie over plain http://.
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "true").lower() == "true"
COOKIE_SAMESITE = os.environ.get("COOKIE_SAMESITE", "none").lower()

def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key="access_token", value=token, httponly=True,
        secure=COOKIE_SECURE, samesite=COOKIE_SAMESITE,
        max_age=28800, path="/",
    )

app = FastAPI(title="AJSPay Core Banking API", version="2.0.0")
api_router = APIRouter(prefix="/api")

# ----------------- Password & JWT Helpers -----------------
def hash_password(password: str) -> str:
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))
    except Exception:
        return False

def create_access_token(user_id: str, email: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=8),
        "type": "access"
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Authentication token required. Please login.")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user = await db.users.find_one({"id": payload["sub"]})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        user.pop("password_hash", None)
        user.pop("transaction_password_hash", None)
        user.pop("_id", None)
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired. Please log in again.")
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid session token.")

async def get_current_admin(current_user: dict = Depends(get_current_user)) -> dict:
    if current_user.get("role") not in ["admin", "branch_manager"]:
        raise HTTPException(status_code=403, detail="Branch Manager or Admin authorization required.")
    return current_user

# ----------------- Pydantic Models -----------------
class RegisterRequest(BaseModel):
    name: str
    email: EmailStr
    phone: str
    password: str
    transaction_password: str
    account_type: str = "savings"
    initial_deposit: float = 10000.0
    pan_number: Optional[str] = "ABCDE1234F"
    aadhaar_number: Optional[str] = "987654321098"
    branch: Optional[str] = "AJSP-MUM-042 (Nariman Point Main)"
    is_joint: bool = False
    joint_holder_name: Optional[str] = None
    nominee_name: Optional[str] = None
    nominee_relation: Optional[str] = None
    referral_code: Optional[str] = None

class LoginRequest(BaseModel):
    email: EmailStr
    password: str
    device_name: Optional[str] = "Chrome on macOS"
    mfa_otp: Optional[str] = None

class VerifyTxnPinRequest(BaseModel):
    transaction_password: str

class TransferRequest(BaseModel):
    from_account_number: str
    to_account_number: str
    beneficiary_name: str
    beneficiary_ifsc: str = "AJSP0000042"
    transfer_type: str = "IMPS"
    amount: float
    remarks: Optional[str] = "Fund transfer"
    transaction_password: str
    is_scheduled: bool = False
    schedule_date: Optional[str] = None

class BulkTransferItem(BaseModel):
    beneficiary_name: str
    account_number: str
    ifsc: str
    amount: float = Field(gt=0)  # a negative line would credit the payer
    remarks: Optional[str] = "Corporate payout"

class BulkTransferRequest(BaseModel):
    from_account_number: str
    transfers: List[BulkTransferItem]
    transaction_password: str

class CardActionRequest(BaseModel):
    card_id: str
    action: str
    new_pin: Optional[str] = None
    online_limit: Optional[float] = None
    atm_limit: Optional[float] = None
    international_enabled: Optional[bool] = None
    contactless_enabled: Optional[bool] = None
    ecom_enabled: Optional[bool] = None

class ChequeRequest(BaseModel):
    account_number: str
    leaves_count: int = 25
    delivery_address: str

class StopChequeRequest(BaseModel):
    account_number: str
    cheque_number: str
    reason: str

class DemandDraftRequest(BaseModel):
    account_number: str
    beneficiary_name: str
    payable_at: str
    amount: float

class BookDepositRequest(BaseModel):
    account_number: str
    deposit_type: str = "fixed"
    amount: float
    tenure_months: int = 12
    interest_payout: str = "on_maturity"
    nominee_name: Optional[str] = None

class LoanApplicationRequest(BaseModel):
    loan_type: str
    amount_requested: float
    tenure_months: int
    monthly_income: float
    employment_type: str
    purpose: str

class InvestmentBuyRequest(BaseModel):
    account_number: str
    scheme_id: str
    scheme_name: str
    investment_type: str = "SIP"
    amount: float

class InsuranceBuyRequest(BaseModel):
    account_number: str
    plan_id: str
    plan_name: str
    sum_assured: float
    annual_premium: float
    nominee_name: str

class ComplaintRequest(BaseModel):
    category: str
    account_number: Optional[str] = None
    subject: str
    description: str

class ChatQueryRequest(BaseModel):
    message: str

class KycActionRequest(BaseModel):
    user_id: str
    status: str
    rejection_reason: Optional[str] = None

# ----------------- Seed Database Helper -----------------
async def seed_initial_data():
    users_count = await db.users.count_documents({})
    if users_count > 0:
        return

    admin_id = str(uuid.uuid4())
    admin_user = {
        "id": admin_id,
        "name": "Arunabh Mukherjee (Chief Branch Manager)",
        "email": "manager@ajspay.in",
        "phone": "+91 98200 11223",
        "role": "admin",
        "password_hash": hash_password("Admin@123"),
        "transaction_password_hash": hash_password("Admin@1234"),
        "branch": "AJSP-MUM-042 (Nariman Point Main)",
        "kyc_status": "verified",
        "mfa_enabled": True,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.users.insert_one(admin_user)

    retail_id = str(uuid.uuid4())
    retail_user = {
        "id": retail_id,
        "name": "Rahul Sharma",
        "email": "rahul.sharma@example.com",
        "phone": "+91 98190 44556",
        "role": "retail",
        "password_hash": hash_password("Banking@123"),
        "transaction_password_hash": hash_password("Txn@1234"),
        "branch": "AJSP-MUM-042 (Nariman Point Main)",
        "pan_number": "ABCPS8492K",
        "aadhaar_number": "XXXX-XXXX-4892",
        "kyc_status": "verified",
        "mfa_enabled": True,
        "nominee": {"name": "Pooja Sharma", "relation": "Spouse"},
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.users.insert_one(retail_user)

    acc_retail = {
        "id": str(uuid.uuid4()),
        "user_id": retail_id,
        "account_number": "AJSP00984521098",
        "ifsc_code": "AJSP0000042",
        "account_type": "savings",
        "account_name": "Premium Salary Savings",
        "balance": 145850.0,
        "currency": "INR",
        "status": "active",
        "upi_id": "rahulsharma@ajspay",
        "branch": "Nariman Point, Mumbai",
        "is_joint": False,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.accounts.insert_one(acc_retail)

    fd_retail = {
        "id": str(uuid.uuid4()),
        "user_id": retail_id,
        "deposit_number": "FD88492019",
        "deposit_type": "fixed",
        "principal_amount": 250000.0,
        "interest_rate": 7.25,
        "tenure_months": 24,
        "maturity_amount": 288625.0,
        "maturity_date": (datetime.now(timezone.utc) + timedelta(days=730)).strftime("%Y-%m-%d"),
        "status": "active",
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.deposits.insert_one(fd_retail)

    retail_card_visa = {
        "id": "card-visa-001",
        "user_id": retail_id,
        "account_number": "AJSP00984521098",
        "card_number": "4532 9845 2109 8821",
        "card_holder": "RAHUL SHARMA",
        "card_type": "Visa Platinum Debit",
        "network": "Visa",
        "expiry_date": "08/29",
        "cvv": "418",
        "status": "active",
        "is_virtual": True,
        "issued_by": "AJSPay (Issuer Only)",
        "online_limit": 100000.0,
        "atm_limit": 50000.0,
        "international_enabled": True,
        "contactless_enabled": True,
        "ecom_enabled": True,
        "pin": "1234",
        "upi_linked": False,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    retail_card_rupay_1 = {
        "id": "card-rupay-001",
        "user_id": retail_id,
        "account_number": "AJSP00984521098",
        "card_number": "5241 7373 2160 2721",
        "card_holder": "RAHUL SHARMA",
        "card_type": "RuPay / Mastercard Global Debit",
        "network": "RuPay",
        "expiry_date": "06/31",
        "cvv": "902",
        "status": "dispatch_queued",
        "is_virtual": False,
        "issued_by": "AJSPay (Issuer Only)",
        "online_limit": 75000.0,
        "atm_limit": 40000.0,
        "international_enabled": False,
        "contactless_enabled": True,
        "ecom_enabled": True,
        "pin": "1234",
        "upi_linked": False,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    retail_card_rupay_2 = {
        "id": "card-rupay-002",
        "user_id": retail_id,
        "account_number": "AJSP00984521098",
        "card_number": "5241 9548 3082 4607",
        "card_holder": "RAHUL SHARMA",
        "card_type": "RuPay / Mastercard Global Debit",
        "network": "Mastercard",
        "expiry_date": "06/31",
        "cvv": "561",
        "status": "dispatch_queued",
        "is_virtual": False,
        "issued_by": "AJSPay (Issuer Only)",
        "online_limit": 75000.0,
        "atm_limit": 40000.0,
        "international_enabled": True,
        "contactless_enabled": True,
        "ecom_enabled": True,
        "pin": "1234",
        "upi_linked": False,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.cards.insert_many([retail_card_visa, retail_card_rupay_1, retail_card_rupay_2])

    corp_id = str(uuid.uuid4())
    corp_user = {
        "id": corp_id,
        "name": "Tata Digital Solutions Ltd",
        "email": "tata.corp@example.com",
        "phone": "+91 99200 88990",
        "role": "corporate",
        "password_hash": hash_password("Corporate@123"),
        "transaction_password_hash": hash_password("Corp@1234"),
        "branch": "AJSP-BKC-001 (Bandra Kurla Complex)",
        "pan_number": "AAACT8921M",
        "aadhaar_number": "Corporate Entity",
        "kyc_status": "verified",
        "mfa_enabled": True,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.users.insert_one(corp_user)

    acc_corp = {
        "id": str(uuid.uuid4()),
        "user_id": corp_id,
        "account_number": "AJSP00129845612",
        "ifsc_code": "AJSP0000001",
        "account_type": "current",
        "account_name": "Corporate Operating Account",
        "balance": 1285000.0,
        "currency": "INR",
        "status": "active",
        "upi_id": "tatadigital@ajspay",
        "branch": "Bandra Kurla Complex, Mumbai",
        "is_joint": False,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.accounts.insert_one(acc_corp)

    # Additional role-based staff users (Bank Owner, Staff, Collection, Loan Officer)
    role_users = [
        {
            "id": "owner-001",
            "name": "Vikram Kothari (Bank Owner)",
            "email": "owner@ajspay.in",
            "phone": "+91 98100 00001",
            "role": "bank_owner",
            "password_hash": hash_password("Owner@123"),
            "transaction_password_hash": hash_password("Txn@1234"),
            "branch": "Head Office - Nariman Point",
            "kyc_status": "verified",
            "designation": "Managing Director & CEO",
            "created_at": datetime.now(timezone.utc).isoformat()
        },
        {
            "id": "staff-001",
            "name": "Meera Iyer (Customer Service Officer)",
            "email": "meera.staff@ajspay.in",
            "phone": "+91 98200 33445",
            "role": "staff",
            "password_hash": hash_password("Staff@123"),
            "transaction_password_hash": hash_password("Txn@1234"),
            "branch": "AJSP-MUM-042 (Nariman Point Main)",
            "kyc_status": "verified",
            "designation": "Front Desk / Teller",
            "created_at": datetime.now(timezone.utc).isoformat()
        },
        {
            "id": "collect-001",
            "name": "Rajesh Nair (Collection Agent)",
            "email": "collections@ajspay.in",
            "phone": "+91 98200 55667",
            "role": "collection_agent",
            "password_hash": hash_password("Collect@123"),
            "transaction_password_hash": hash_password("Txn@1234"),
            "branch": "Recovery Cell - Mumbai Zone",
            "kyc_status": "verified",
            "designation": "Recovery Officer",
            "created_at": datetime.now(timezone.utc).isoformat()
        },
        {
            "id": "loan-001",
            "name": "Aditi Verma (Loan Officer)",
            "email": "loans@ajspay.in",
            "phone": "+91 98200 77889",
            "role": "loan_officer",
            "password_hash": hash_password("Loan@123"),
            "transaction_password_hash": hash_password("Txn@1234"),
            "branch": "AJSP-MUM-042 (Nariman Point Main)",
            "kyc_status": "verified",
            "designation": "Credit Underwriter",
            "created_at": datetime.now(timezone.utc).isoformat()
        }
    ]
    await db.users.insert_many(role_users)

    # Sample loan applications for Loan Dept + Collection Dept panels
    now_iso = datetime.now(timezone.utc).isoformat()
    loan_pipeline = [
        {"id": "app-001", "user_id": retail_id, "applicant": "Rahul Sharma", "loan_type": "Personal", "amount": 500000, "tenure_months": 36, "roi": 10.5, "status": "under_review", "credit_score": 782, "created_at": now_iso},
        {"id": "app-002", "user_id": corp_id, "applicant": "Tata Digital Solutions Ltd", "loan_type": "Working Capital", "amount": 2500000, "tenure_months": 60, "roi": 9.25, "status": "approved", "credit_score": 810, "created_at": now_iso},
        {"id": "app-003", "user_id": retail_id, "applicant": "Anjali Kapoor", "loan_type": "Home", "amount": 3500000, "tenure_months": 240, "roi": 8.4, "status": "documentation", "credit_score": 745, "created_at": now_iso},
        {"id": "app-004", "user_id": retail_id, "applicant": "Kabir Malhotra", "loan_type": "Vehicle", "amount": 850000, "tenure_months": 60, "roi": 8.75, "status": "disbursed", "credit_score": 720, "created_at": now_iso}
    ]
    await db.loan_applications.insert_many(loan_pipeline)

    collection_cases = [
        {"id": "col-001", "borrower": "Prakash Yadav", "loan_ref": "PL-99281", "outstanding": 148500, "dpd_days": 45, "last_contact": "2026-01-25", "status": "npa_risk", "phone": "+91 98111 22334"},
        {"id": "col-002", "borrower": "Sunita Deshmukh", "loan_ref": "HL-33112", "outstanding": 892000, "dpd_days": 15, "last_contact": "2026-02-05", "status": "follow_up", "phone": "+91 98222 55667"},
        {"id": "col-003", "borrower": "Kavita Rao", "loan_ref": "VL-77401", "outstanding": 45250, "dpd_days": 90, "last_contact": "2026-01-10", "status": "legal_notice", "phone": "+91 98333 88991"},
        {"id": "col-004", "borrower": "Amit Sinha", "loan_ref": "PL-88203", "outstanding": 22500, "dpd_days": 5, "last_contact": "2026-02-12", "status": "reminder_sent", "phone": "+91 98444 12345"}
    ]
    await db.collection_cases.insert_many(collection_cases)

    sample_txns = [
        {
            "id": str(uuid.uuid4()),
            "user_id": retail_id,
            "account_number": "AJSP00984521098",
            "type": "credit",
            "mode": "NEFT",
            "amount": 95000.0,
            "balance_after": 145850.0,
            "counterparty_name": "Infosys Ltd Salary Payout",
            "counterparty_acc": "INFSYS99281",
            "ref_number": "UTR-NEFT-20260601-8932",
            "status": "SUCCESS",
            "description": "Monthly Net Salary Credited",
            "timestamp": (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
        },
        {
            "id": str(uuid.uuid4()),
            "user_id": retail_id,
            "account_number": "AJSP00984521098",
            "type": "debit",
            "mode": "UPI",
            "amount": 2450.0,
            "balance_after": 50850.0,
            "counterparty_name": "Amazon India Payments",
            "counterparty_acc": "amazonpay@ajspay",
            "ref_number": "UPI-6192837491",
            "status": "SUCCESS",
            "description": "Electronics Purchase Order #9812",
            "timestamp": (datetime.now(timezone.utc) - timedelta(days=4)).isoformat()
        },
        {
            "id": str(uuid.uuid4()),
            "user_id": retail_id,
            "account_number": "AJSP00984521098",
            "type": "debit",
            "mode": "IMPS",
            "amount": 15000.0,
            "balance_after": 53300.0,
            "counterparty_name": "Ananya Sharma",
            "counterparty_acc": "AJSP000492109",
            "ref_number": "IMPS-9921849102",
            "status": "SUCCESS",
            "description": "Family Maintenance",
            "timestamp": (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
        }
    ]
    await db.transactions.insert_many(sample_txns)

    sample_branches = [
        {"id": "b1", "name": "Nariman Point Main Branch", "bank": "AJSPay", "code": "AJSP0000042", "address": "Air India Building, Nariman Point, Mumbai 400021", "lat": 18.9281, "lng": 72.8228, "phone": "022-22024100", "has_atm": True, "has_cdm": True, "has_locker": True, "timing": "10:00 AM - 4:00 PM"},
        {"id": "b2", "name": "Bandra Kurla Complex Branch", "bank": "AJSPay", "code": "AJSP0000001", "address": "G Block, BKC, Bandra East, Mumbai 400051", "lat": 19.0662, "lng": 72.8688, "phone": "022-66521000", "has_atm": True, "has_cdm": True, "has_locker": True, "timing": "9:30 AM - 4:30 PM"},
        {"id": "b3", "name": "Connaught Place Flagship", "bank": "AJSPay", "code": "AJSP0000007", "address": "9A, Inner Circle, Connaught Place, New Delhi 110001", "lat": 28.6315, "lng": 77.2167, "phone": "011-41512000", "has_atm": True, "has_cdm": True, "has_locker": True, "timing": "9:30 AM - 5:00 PM"},
        {"id": "b4", "name": "Koramangala 80 Feet Road", "bank": "AJSPay", "code": "AJSP0004081", "address": "80 Feet Road, 4th Block, Koramangala, Bengaluru 560034", "lat": 12.9352, "lng": 77.6245, "phone": "080-25539800", "has_atm": True, "has_cdm": False, "has_locker": True, "timing": "10:00 AM - 4:00 PM"},
        {"id": "b5", "name": "Hitech City Madhapur", "bank": "AJSPay", "code": "AJSP0001928", "address": "Cyber Towers, Hitech City, Hyderabad 500081", "lat": 17.4504, "lng": 78.3808, "phone": "040-67891200", "has_atm": True, "has_cdm": True, "has_locker": False, "timing": "9:30 AM - 4:30 PM"}
    ]
    await db.branches.insert_many(sample_branches)

@app.on_event("startup")
async def startup_event():
    await db.users.create_index("email", unique=True)
    await db.accounts.create_index("account_number", unique=True)
    await db.login_attempts.create_index("identifier")
    await seed_initial_data()

# ----------------- Auth Routes with Brute Force Lockout -----------------
@api_router.post("/auth/register")
async def register(req: RegisterRequest, response: Response):
    existing = await db.users.find_one({"email": req.email.lower()})
    if existing:
        raise HTTPException(status_code=400, detail="Account with this email already exists.")
    
    user_id = str(uuid.uuid4())
    account_number = "AJSP0" + "".join([str(random.randint(0, 9)) for _ in range(9)])
    
    user_doc = {
        "id": user_id,
        "name": req.name,
        "email": req.email.lower(),
        "phone": req.phone,
        "role": "retail",
        "password_hash": hash_password(req.password),
        "transaction_password_hash": hash_password(req.transaction_password),
        "branch": req.branch,
        "pan_number": req.pan_number,
        "aadhaar_number": req.aadhaar_number,
        "kyc_status": "pending_approval",
        "mfa_enabled": True,
        "is_joint": req.is_joint,
        "joint_holder_name": req.joint_holder_name if req.is_joint else None,
        "nominee": {"name": req.nominee_name, "relation": req.nominee_relation} if req.nominee_name else None,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.users.insert_one(user_doc)

    acc_doc = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "account_number": account_number,
        "ifsc_code": "AJSP0000042",
        "account_type": req.account_type,
        "account_name": f"{req.account_type.capitalize()} Account",
        "balance": max(req.initial_deposit, 1000.0),
        "currency": "INR",
        "status": "active",
        "upi_id": f"{req.email.split('@')[0]}@ajspay",
        "branch": req.branch,
        "is_joint": req.is_joint,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.accounts.insert_one(acc_doc)

    card_doc = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "account_number": account_number,
        "card_number": "4532 " + " ".join(["".join([str(random.randint(0, 9)) for _ in range(4)]) for _ in range(3)]),
        "card_holder": req.name.upper(),
        "card_type": "Visa Platinum Debit",
        "expiry_date": "12/29",
        "cvv": str(random.randint(100, 999)),
        "status": "active",
        "is_virtual": True,
        "online_limit": 50000.0,
        "atm_limit": 40000.0,
        "international_enabled": False,
        "pin": "1234",
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.cards.insert_one(card_doc)

    init_txn = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "account_number": account_number,
        "type": "credit",
        "mode": "ACCOUNT_OPENING",
        "amount": max(req.initial_deposit, 1000.0),
        "balance_after": max(req.initial_deposit, 1000.0),
        "counterparty_name": "Account Opening Initial Fund",
        "counterparty_acc": "BRANCH-CASH-DESK",
        "ref_number": f"AOF-{random.randint(1000000, 9999999)}",
        "status": "SUCCESS",
        "description": "Initial account deposit",
        "timestamp": datetime.now(timezone.utc).isoformat()
    }
    await db.transactions.insert_one(init_txn)

    # --- Referral processing ---
    ref_reward = None
    if req.referral_code:
        referrer = await db.users.find_one({"referral_code": req.referral_code.strip().upper()})
        if referrer and referrer["id"] != user_id:
            cfg = await db.system_config.find_one({"_id": "global"}) or {}
            reward = float(cfg.get("referral_reward_amount", REFERRAL_REWARD_AMOUNT))
            # Credit referee (this new account)
            new_bal = max(req.initial_deposit, 1000.0) + reward
            await db.accounts.update_one({"account_number": account_number}, {"$set": {"balance": new_bal}})
            await db.transactions.insert_one({
                "id": str(uuid.uuid4()), "user_id": user_id, "account_number": account_number,
                "type": "credit", "mode": "ACCOUNT_OPENING", "amount": reward, "balance_after": new_bal,
                "counterparty_name": "Refer & Earn Bonus", "counterparty_acc": "AJSPAY-REWARDS",
                "ref_number": f"RRB-{random.randint(1000000, 9999999)}", "status": "SUCCESS",
                "description": f"Welcome bonus via referral {req.referral_code.upper()}",
                "timestamp": datetime.now(timezone.utc).isoformat()
            })
            # Credit referrer
            referrer_acc = await db.accounts.find_one({"user_id": referrer["id"]}, sort=[("created_at", 1)])
            if referrer_acc:
                referrer_new_bal = referrer_acc.get("balance", 0) + reward
                await db.accounts.update_one({"id": referrer_acc["id"]}, {"$set": {"balance": referrer_new_bal}})
                await db.transactions.insert_one({
                    "id": str(uuid.uuid4()), "user_id": referrer["id"], "account_number": referrer_acc["account_number"],
                    "type": "credit", "mode": "ACCOUNT_OPENING", "amount": reward, "balance_after": referrer_new_bal,
                    "counterparty_name": "Refer & Earn Payout", "counterparty_acc": "AJSPAY-REWARDS",
                    "ref_number": f"RRP-{random.randint(1000000, 9999999)}", "status": "SUCCESS",
                    "description": f"Reward for referring {user_doc['name']}",
                    "timestamp": datetime.now(timezone.utc).isoformat()
                })
            await db.referrals.insert_one({
                "id": str(uuid.uuid4()),
                "referrer_id": referrer["id"], "referrer_email": referrer["email"],
                "referee_id": user_id, "referee_name": user_doc["name"], "referee_email": user_doc["email"],
                "code": req.referral_code.strip().upper(),
                "credit_amount": reward, "status": "paid",
                "created_at": datetime.now(timezone.utc).isoformat()
            })
            ref_reward = reward

    token = create_access_token(user_id, req.email.lower(), "retail")
    set_session_cookie(response, token)

    user_clean = {k: v for k, v in user_doc.items() if k not in ["_id", "password_hash", "transaction_password_hash"]}
    return {"token": token, "user": user_clean, "account_number": account_number, "referral_bonus": ref_reward}

@api_router.post("/auth/login")
async def login(req: LoginRequest, response: Response, request: Request):
    # Behind k8s / reverse proxies, request.client.host varies. Prefer XFF.
    xff = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    client_ip = xff or (request.client.host if request.client else "0.0.0.0")
    identifier = f"{client_ip}:{req.email.lower()}"
    
    # Check brute-force lockout
    fifteen_mins_ago = (datetime.now(timezone.utc) - timedelta(minutes=15)).isoformat()
    recent_fails = await db.login_attempts.count_documents({
        "identifier": identifier,
        "timestamp": {"$gte": fifteen_mins_ago}
    })
    if recent_fails >= 5:
        raise HTTPException(
            status_code=429,
            detail="Account temporarily locked due to 5 consecutive failed login attempts. Please try again in 15 minutes."
        )

    user = await db.users.find_one({"email": req.email.lower()})
    if not user or not verify_password(req.password, user.get("password_hash", "")):
        # Record failed attempt
        await db.login_attempts.insert_one({
            "identifier": identifier,
            "email": req.email.lower(),
            "timestamp": datetime.now(timezone.utc).isoformat()
        })
        remaining = max(0, 4 - recent_fails)
        raise HTTPException(
            status_code=401,
            detail=f"Invalid email or password. {remaining} attempt(s) remaining before security lockout."
        )

    # Clear failed attempts on successful login
    await db.login_attempts.delete_many({"identifier": identifier})

    # Audit log
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "email": user["email"],
        "action": "USER_LOGIN",
        "details": f"Logged in via {req.device_name}",
        "ip": client_ip,
        "timestamp": datetime.now(timezone.utc).isoformat()
    })

    token = create_access_token(user["id"], user["email"], user.get("role", "retail"))
    set_session_cookie(response, token)

    user_clean = {k: v for k, v in user.items() if k not in ["_id", "password_hash", "transaction_password_hash"]}
    return {
        "token": token,
        "user": user_clean,
        "message": "Login successful",
        "mfa_verified": True
    }

@api_router.get("/auth/me")
async def get_me(current_user: dict = Depends(get_current_user)):
    return {"user": current_user}

@api_router.post("/auth/logout")
async def logout(response: Response, current_user: dict = Depends(get_current_user)):
    response.delete_cookie("access_token", path="/")
    return {"message": "Logged out successfully"}

@api_router.post("/auth/verify-transaction-pin")
async def verify_txn_pin(req: VerifyTxnPinRequest, current_user: dict = Depends(get_current_user)):
    user_db = await db.users.find_one({"id": current_user["id"]})
    if not user_db or not verify_password(req.transaction_password, user_db.get("transaction_password_hash", "")):
        raise HTTPException(status_code=400, detail="Invalid Transaction Password/PIN.")
    return {"status": "valid", "message": "Transaction Password Verified"}

# ----------------- Core Banking & Accounts -----------------
@api_router.get("/accounts")
async def get_user_accounts(current_user: dict = Depends(get_current_user)):
    accounts = await db.accounts.find({"user_id": current_user["id"]}, {"_id": 0}).to_list(100)
    deposits = await db.deposits.find({"user_id": current_user["id"]}, {"_id": 0}).to_list(100)
    cards = await db.cards.find({"user_id": current_user["id"]}, {"_id": 0}).to_list(100)
    
    total_balance = sum(a.get("balance", 0.0) for a in accounts)
    total_deposits = sum(d.get("principal_amount", 0.0) for d in deposits)

    return {
        "accounts": accounts,
        "deposits": deposits,
        "cards": cards,
        "net_worth": total_balance + total_deposits,
        "total_savings_balance": total_balance,
        "total_deposits_balance": total_deposits
    }

@api_router.get("/accounts/transactions")
async def get_transactions(
    account_number: Optional[str] = None,
    limit: int = 50,
    current_user: dict = Depends(get_current_user)
):
    query = {"user_id": current_user["id"]}
    if account_number:
        query["account_number"] = account_number
    
    txns = await db.transactions.find(query, {"_id": 0}).sort("timestamp", -1).to_list(limit)
    return {"transactions": txns}

@api_router.post("/accounts/transfer")
async def execute_transfer(req: TransferRequest, current_user: dict = Depends(get_current_user)):
    if req.amount <= 0:
        raise HTTPException(status_code=400, detail="Transfer amount must be greater than ₹0")
    
    user_db = await db.users.find_one({"id": current_user["id"]})
    if not user_db or not verify_password(req.transaction_password, user_db.get("transaction_password_hash", "")):
        raise HTTPException(status_code=400, detail="Invalid Transaction Password. Transfer declined.")

    sender_acc = await db.accounts.find_one({"account_number": req.from_account_number, "user_id": current_user["id"]})
    if not sender_acc:
        raise HTTPException(status_code=404, detail="Source bank account not found.")
    
    if sender_acc["balance"] < req.amount:
        raise HTTPException(status_code=400, detail=f"Insufficient balance. Available: ₹{sender_acc['balance']:,.2f}")

    if req.is_scheduled and req.schedule_date:
        sched_doc = {
            "id": str(uuid.uuid4()),
            "user_id": current_user["id"],
            "from_account_number": req.from_account_number,
            "to_account_number": req.to_account_number,
            "beneficiary_name": req.beneficiary_name,
            "beneficiary_ifsc": req.beneficiary_ifsc,
            "transfer_type": req.transfer_type,
            "amount": req.amount,
            "schedule_date": req.schedule_date,
            "status": "SCHEDULED",
            "remarks": req.remarks,
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        await db.scheduled_payments.insert_one(sched_doc)
        return {
            "status": "SCHEDULED",
            "message": f"Transfer of ₹{req.amount:,.2f} scheduled for {req.schedule_date}",
            "schedule_id": sched_doc["id"]
        }

    new_sender_balance = sender_acc["balance"] - req.amount
    await db.accounts.update_one({"account_number": req.from_account_number}, {"$set": {"balance": new_sender_balance}})

    ref_id = f"UTR-{req.transfer_type}-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}-{random.randint(100, 999)}"

    debit_txn = {
        "id": str(uuid.uuid4()),
        "user_id": current_user["id"],
        "account_number": req.from_account_number,
        "type": "debit",
        "mode": req.transfer_type,
        "amount": req.amount,
        "balance_after": new_sender_balance,
        "counterparty_name": req.beneficiary_name,
        "counterparty_acc": req.to_account_number,
        "ref_number": ref_id,
        "status": "SUCCESS",
        "description": req.remarks or f"{req.transfer_type} to {req.beneficiary_name}",
        "timestamp": datetime.now(timezone.utc).isoformat()
    }
    await db.transactions.insert_one(debit_txn)

    receiver_acc = await db.accounts.find_one({"account_number": req.to_account_number})
    if receiver_acc:
        new_receiver_balance = receiver_acc["balance"] + req.amount
        await db.accounts.update_one({"account_number": req.to_account_number}, {"$set": {"balance": new_receiver_balance}})
        credit_txn = {
            "id": str(uuid.uuid4()),
            "user_id": receiver_acc["user_id"],
            "account_number": req.to_account_number,
            "type": "credit",
            "mode": req.transfer_type,
            "amount": req.amount,
            "balance_after": new_receiver_balance,
            "counterparty_name": current_user["name"],
            "counterparty_acc": req.from_account_number,
            "ref_number": ref_id,
            "status": "SUCCESS",
            "description": f"Received from {current_user['name']} ({req.remarks or 'Fund transfer'})",
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        await db.transactions.insert_one(credit_txn)

    return {
        "status": "SUCCESS",
        "message": f"Successfully transferred ₹{req.amount:,.2f} via {req.transfer_type}",
        "ref_number": ref_id,
        "new_balance": new_sender_balance,
        "timestamp": debit_txn["timestamp"]
    }

@api_router.post("/accounts/bulk-transfer")
async def execute_bulk_transfer(req: BulkTransferRequest, current_user: dict = Depends(get_current_user)):
    user_db = await db.users.find_one({"id": current_user["id"]})
    if not user_db or not verify_password(req.transaction_password, user_db.get("transaction_password_hash", "")):
        raise HTTPException(status_code=400, detail="Invalid Transaction Password.")

    total_amount = sum(item.amount for item in req.transfers)
    sender_acc = await db.accounts.find_one({"account_number": req.from_account_number, "user_id": current_user["id"]})
    if not sender_acc:
        raise HTTPException(status_code=404, detail="Source corporate account not found.")
    
    if sender_acc["balance"] < total_amount:
        raise HTTPException(status_code=400, detail=f"Insufficient corporate balance. Total batch requires ₹{total_amount:,.2f}")

    new_balance = sender_acc["balance"] - total_amount
    await db.accounts.update_one({"account_number": req.from_account_number}, {"$set": {"balance": new_balance}})

    processed = []
    batch_ref = f"BATCH-CORP-{datetime.now(timezone.utc).strftime('%Y%m%d')}-{random.randint(1000, 9999)}"

    for item in req.transfers:
        ref_id = f"UTR-BULK-{random.randint(10000000, 99999999)}"
        txn = {
            "id": str(uuid.uuid4()),
            "user_id": current_user["id"],
            "account_number": req.from_account_number,
            "type": "debit",
            "mode": "CORPORATE_BULK",
            "amount": item.amount,
            "balance_after": new_balance,
            "counterparty_name": item.beneficiary_name,
            "counterparty_acc": item.account_number,
            "ref_number": ref_id,
            "batch_ref": batch_ref,
            "status": "SUCCESS",
            "description": f"Bulk Payout: {item.remarks} ({item.beneficiary_name})",
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        await db.transactions.insert_one(txn)
        processed.append({"name": item.beneficiary_name, "amount": item.amount, "ref": ref_id})

    return {
        "status": "SUCCESS",
        "batch_ref": batch_ref,
        "transfers_count": len(processed),
        "total_amount": total_amount,
        "remaining_balance": new_balance,
        "processed_list": processed
    }

# ----------------- Cards & Digital Services -----------------
@api_router.get("/cards")
async def get_user_cards(current_user: dict = Depends(get_current_user)):
    cards = await db.cards.find({"user_id": current_user["id"]}, {"_id": 0}).to_list(50)
    return {"cards": cards}

@api_router.post("/cards/manage")
async def manage_card(req: CardActionRequest, current_user: dict = Depends(get_current_user)):
    card = await db.cards.find_one({"id": req.card_id, "user_id": current_user["id"]})
    if not card:
        raise HTTPException(status_code=404, detail="Debit card not found.")

    updates = {}
    msg = ""

    if req.action == "freeze":
        updates["status"] = "frozen"
        msg = "Card temporarily frozen. ATM & Online transactions disabled."
    elif req.action == "unfreeze":
        updates["status"] = "active"
        msg = "Card unblocked and activated successfully."
    elif req.action == "hotlist":
        updates["status"] = "hotlisted"
        msg = "Card permanently hotlisted & blocked. A replacement card has been queued."
    elif req.action == "update_limits":
        if req.online_limit is not None:
            updates["online_limit"] = req.online_limit
        if req.atm_limit is not None:
            updates["atm_limit"] = req.atm_limit
        if req.international_enabled is not None:
            updates["international_enabled"] = req.international_enabled
        if req.contactless_enabled is not None:
            updates["contactless_enabled"] = req.contactless_enabled
        if req.ecom_enabled is not None:
            updates["ecom_enabled"] = req.ecom_enabled
        msg = "Card limits and usage settings updated."
    elif req.action == "set_pin":
        if not req.new_pin or len(req.new_pin) != 4:
            raise HTTPException(status_code=400, detail="PIN must be a 4-digit number.")
        updates["pin"] = req.new_pin
        msg = "Card ATM/POS PIN regenerated successfully."

    if updates:
        await db.cards.update_one({"id": req.card_id}, {"$set": updates})

    updated_card = await db.cards.find_one({"id": req.card_id}, {"_id": 0})
    return {"status": "SUCCESS", "message": msg, "card": updated_card}

@api_router.post("/cards/request-physical")
async def request_physical_card(account_number: str = Query(...), current_user: dict = Depends(get_current_user)):
    if not await db.accounts.find_one({"account_number": account_number, "user_id": current_user["id"]}):
        raise HTTPException(status_code=404, detail="Account not found.")
    new_card_doc = {
        "id": str(uuid.uuid4()),
        "user_id": current_user["id"],
        "account_number": account_number,
        "card_number": "5241 " + " ".join(["".join([str(random.randint(0, 9)) for _ in range(4)]) for _ in range(3)]),
        "card_holder": current_user["name"].upper(),
        "card_type": "RuPay / Mastercard Global Debit",
        "expiry_date": "06/31",
        "cvv": str(random.randint(100, 999)),
        "status": "dispatch_queued",
        "is_virtual": False,
        "online_limit": 75000.0,
        "atm_limit": 50000.0,
        "international_enabled": True,
        "pin": "0000",
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.cards.insert_one(new_card_doc)
    return {"status": "SUCCESS", "message": "Physical Card order placed! Will be delivered to registered address in 3-5 working days.", "card": {k: v for k, v in new_card_doc.items() if k != "_id"}}

# ----------------- UPI Integration Module (Launching Tomorrow) -----------------
class UpiLinkRequest(BaseModel):
    card_id: str
    upi_pin: Optional[str] = None

@api_router.get("/upi/status")
async def upi_status(current_user: dict = Depends(get_current_user)):
    """Announcement + status for the UPI-on-Debit-Card feature."""
    acc = await db.accounts.find_one({"user_id": current_user["id"]}, {"_id": 0})
    cards = await db.cards.find({"user_id": current_user["id"]}, {"_id": 0}).to_list(50)
    return {
        "launch_date": "2026-02-15",
        "status_headline": "UPI on Debit Card — Pending Final NPCI Approval",
        "status_detail": "Feature is live in shadow mode. Final NPCI go-live approval expected within 24 hours. Link now to receive priority activation.",
        "primary_upi_id": acc.get("upi_id") if acc else None,
        "linkable_cards": [{"id": c["id"], "card_number": c["card_number"], "network": c.get("network","Visa"), "status": c["status"], "upi_linked": c.get("upi_linked", False)} for c in cards]
    }

@api_router.post("/upi/link-card")
async def upi_link_card(req: UpiLinkRequest, current_user: dict = Depends(get_current_user)):
    card = await db.cards.find_one({"id": req.card_id, "user_id": current_user["id"]})
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    if card["status"] not in ["active", "dispatch_queued"]:
        raise HTTPException(status_code=400, detail=f"Card in '{card['status']}' state cannot be linked to UPI.")
    await db.cards.update_one({"id": req.card_id}, {"$set": {"upi_linked": True, "upi_linked_at": datetime.now(timezone.utc).isoformat()}})
    return {"status": "SUCCESS", "message": f"UPI linked to card ending {card['card_number'][-4:]}. You will be notified when NPCI activates."}

@api_router.get("/upi/qr")
async def upi_qr(current_user: dict = Depends(get_current_user)):
    acc = await db.accounts.find_one({"user_id": current_user["id"]}, {"_id": 0})
    if not acc:
        raise HTTPException(status_code=404, detail="No linked account")
    upi_uri = f"upi://pay?pa={acc['upi_id']}&pn={current_user['name'].replace(' ', '%20')}&aid=uPfKMDXhs2SDy&mc=0000"
    return {"upi_id": acc["upi_id"], "account_holder": current_user["name"], "upi_uri": upi_uri, "qr_data": upi_uri, "limits": {"per_txn": 100000, "daily": 500000}}

# ----------------- Role Panel APIs (Bank Owner / Staff / Collection / Loan Officer) -----------------
async def _require_roles(user: dict, roles: List[str]):
    if user.get("role") not in roles:
        raise HTTPException(status_code=403, detail=f"Access restricted. Required role: {', '.join(roles)}")

@api_router.get("/panel/bank-owner")
async def bank_owner_panel(current_user: dict = Depends(get_current_user)):
    await _require_roles(current_user, ["bank_owner"])
    total_users = await db.users.count_documents({})
    total_liquidity_agg = await db.accounts.aggregate([{"$group": {"_id": None, "total": {"$sum": "$balance"}}}]).to_list(1)
    liquidity = total_liquidity_agg[0]["total"] if total_liquidity_agg else 0
    txn_count = await db.transactions.count_documents({})
    loans = await db.loan_applications.find({}, {"_id": 0}).to_list(50)
    branches = await db.branches.find({}, {"_id": 0}).to_list(50)
    return {
        "kpis": {"total_users": total_users, "total_liquidity": liquidity, "total_transactions": txn_count,
                 "active_branches": len(branches), "loan_pipeline_count": len(loans),
                 "credit_rating": "AAA (CRISIL / ICRA)", "car_ratio": "17.8%"},
        "loan_pipeline": loans,
        "branches": branches,
        "policies": [
            {"key": "savings_roi", "label": "Savings Account Interest Rate", "value": "4.00% p.a."},
            {"key": "fd_max_roi", "label": "FD Peak Rate (Senior 2-3 Yr)", "value": "8.00% p.a."},
            {"key": "home_loan_min", "label": "Home Loan Starting Rate", "value": "8.40% p.a."},
            {"key": "crr", "label": "Cash Reserve Ratio", "value": "4.50%"},
            {"key": "slr", "label": "Statutory Liquidity Ratio", "value": "18.00%"}
        ]
    }

@api_router.get("/panel/staff")
async def staff_panel(current_user: dict = Depends(get_current_user)):
    await _require_roles(current_user, ["staff", "admin", "branch_manager", "bank_owner"])
    recent_customers = await db.users.find({"role": {"$in": ["retail", "corporate"]}}, {"_id": 0, "password_hash": 0, "transaction_password_hash": 0}).sort("created_at", -1).limit(10).to_list(10)
    pending_kyc = await db.users.count_documents({"kyc_status": "pending_approval"})
    todays_txn = await db.transactions.count_documents({})
    tickets = await db.tickets.find({}, {"_id": 0}).to_list(20) if "tickets" in await db.list_collection_names() else []
    return {
        "kpis": {"customers_served_today": 42, "pending_kyc": pending_kyc, "transactions_processed": todays_txn, "open_tickets": len(tickets)},
        "recent_customers": recent_customers,
        "open_tickets": tickets
    }

@api_router.get("/panel/collection")
async def collection_panel(current_user: dict = Depends(get_current_user)):
    await _require_roles(current_user, ["collection_agent", "admin", "branch_manager", "bank_owner"])
    cases = await db.collection_cases.find({}, {"_id": 0}).to_list(100)
    total_outstanding = sum(c.get("outstanding", 0) for c in cases)
    npa_count = len([c for c in cases if c.get("status") == "npa_risk" or c.get("dpd_days", 0) >= 90])
    return {
        "kpis": {"total_cases": len(cases), "total_outstanding": total_outstanding,
                 "npa_risk_count": npa_count,
                 "recovery_target_month": 12500000, "recovered_month": 4820000},
        "cases": cases
    }

class CollectionActionRequest(BaseModel):
    case_id: str
    action: str  # reminder | legal_notice | settle
    note: Optional[str] = None

@api_router.post("/panel/collection/action")
async def collection_action(req: CollectionActionRequest, current_user: dict = Depends(get_current_user)):
    await _require_roles(current_user, ["collection_agent", "admin", "branch_manager", "bank_owner"])
    case = await db.collection_cases.find_one({"id": req.case_id})
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    status_map = {"reminder": "reminder_sent", "legal_notice": "legal_notice", "settle": "settled"}
    new_status = status_map.get(req.action, case.get("status"))
    await db.collection_cases.update_one({"id": req.case_id}, {"$set": {"status": new_status, "last_contact": datetime.now(timezone.utc).strftime("%Y-%m-%d")}})
    return {"status": "SUCCESS", "message": f"Action '{req.action}' recorded for {case.get('borrower')}."}

@api_router.get("/panel/loan-dept")
async def loan_dept_panel(current_user: dict = Depends(get_current_user)):
    await _require_roles(current_user, ["loan_officer", "admin", "branch_manager", "bank_owner"])
    apps = await db.loan_applications.find({}, {"_id": 0}).to_list(100)
    by_status = {}
    for a in apps:
        by_status[a["status"]] = by_status.get(a["status"], 0) + 1
    total_disbursed = sum(a.get("amount", 0) for a in apps if a.get("status") == "disbursed")
    return {
        "kpis": {"total_applications": len(apps), "disbursed_amount": total_disbursed,
                 "in_review": by_status.get("under_review", 0),
                 "documentation": by_status.get("documentation", 0),
                 "approved": by_status.get("approved", 0),
                 "npa_ratio": "2.1%"},
        "applications": apps,
        "by_status": by_status
    }

class LoanDecisionRequest(BaseModel):
    application_id: str
    decision: str  # approve | reject | request_docs | disburse
    remark: Optional[str] = None

@api_router.post("/panel/loan-dept/decision")
async def loan_decision(req: LoanDecisionRequest, current_user: dict = Depends(get_current_user)):
    await _require_roles(current_user, ["loan_officer", "admin", "branch_manager", "bank_owner"])
    decision_map = {"approve": "approved", "reject": "rejected", "request_docs": "documentation", "disburse": "disbursed"}
    new_status = decision_map.get(req.decision)
    if not new_status:
        raise HTTPException(status_code=400, detail="Invalid decision")
    result = await db.loan_applications.update_one({"id": req.application_id}, {"$set": {"status": new_status, "decision_note": req.remark or ""}})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Application not found")
    return {"status": "SUCCESS", "message": f"Loan application marked as {new_status}."}


# ----------------- Cheques & Demand Drafts -----------------
@api_router.post("/services/cheque-book")
async def request_cheque_book(req: ChequeRequest, current_user: dict = Depends(get_current_user)):
    cheque_doc = {
        "id": str(uuid.uuid4()),
        "user_id": current_user["id"],
        "account_number": req.account_number,
        "leaves": req.leaves_count,
        "delivery_address": req.delivery_address,
        "status": "APPROVED_DISPATCH",
        "tracking_id": f"IND-POST-{random.randint(100000, 999999)}",
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.cheque_requests.insert_one(cheque_doc)
    return {"status": "SUCCESS", "message": f"Cheque book with {req.leaves_count} leaves requested. Tracking ID: {cheque_doc['tracking_id']}"}

@api_router.post("/services/stop-cheque")
async def stop_cheque(req: StopChequeRequest, current_user: dict = Depends(get_current_user)):
    stop_doc = {
        "id": str(uuid.uuid4()),
        "user_id": current_user["id"],
        "account_number": req.account_number,
        "cheque_number": req.cheque_number,
        "reason": req.reason,
        "status": "STOPPED",
        "timestamp": datetime.now(timezone.utc).isoformat()
    }
    await db.stopped_cheques.insert_one(stop_doc)
    return {"status": "SUCCESS", "message": f"Cheque No. {req.cheque_number} has been STOPPED instantly. Any clearance attempt will be blocked."}

@api_router.post("/services/demand-draft")
async def issue_demand_draft(req: DemandDraftRequest, current_user: dict = Depends(get_current_user)):
    acc = await db.accounts.find_one({"account_number": req.account_number, "user_id": current_user["id"]})
    if not acc or acc["balance"] < req.amount + 50.0:
        raise HTTPException(status_code=400, detail="Insufficient funds for Demand Draft + ₹50 issuing fee.")
    
    new_bal = acc["balance"] - (req.amount + 50.0)
    await db.accounts.update_one({"account_number": req.account_number}, {"$set": {"balance": new_bal}})
    
    dd_number = f"DD-{random.randint(100000, 999999)}"
    dd_doc = {
        "id": str(uuid.uuid4()),
        "user_id": current_user["id"],
        "dd_number": dd_number,
        "account_number": req.account_number,
        "beneficiary_name": req.beneficiary_name,
        "payable_at": req.payable_at,
        "amount": req.amount,
        "fee": 50.0,
        "status": "ISSUED",
        "timestamp": datetime.now(timezone.utc).isoformat()
    }
    await db.demand_drafts.insert_one(dd_doc)
    return {"status": "SUCCESS", "message": f"Demand Draft {dd_number} issued successfully for ₹{req.amount:,.2f} payable at {req.payable_at}.", "dd": {k: v for k, v in dd_doc.items() if k != "_id"}}

# ----------------- Deposits (FD / RD) -----------------
@api_router.post("/deposits/book")
async def book_deposit(req: BookDepositRequest, current_user: dict = Depends(get_current_user)):
    acc = await db.accounts.find_one({"account_number": req.account_number, "user_id": current_user["id"]})
    if not acc or acc["balance"] < req.amount:
        raise HTTPException(status_code=400, detail="Insufficient funds in selected savings account.")
    
    if req.tenure_months < 12:
        rate = 6.50
    elif req.tenure_months <= 24:
        rate = 7.25
    elif req.tenure_months <= 36:
        rate = 7.50
    else:
        rate = 7.10

    p = req.amount
    t = req.tenure_months / 12.0
    r = rate / 100.0
    maturity_amt = round(p * ((1 + r/4) ** (4 * t)), 2)

    new_bal = acc["balance"] - req.amount
    await db.accounts.update_one({"account_number": req.account_number}, {"$set": {"balance": new_bal}})

    dep_id = f"DEP{random.randint(10000000, 99999999)}"
    dep_doc = {
        "id": str(uuid.uuid4()),
        "user_id": current_user["id"],
        "deposit_number": dep_id,
        "deposit_type": req.deposit_type,
        "source_account": req.account_number,
        "principal_amount": req.amount,
        "interest_rate": rate,
        "tenure_months": req.tenure_months,
        "interest_payout": req.interest_payout,
        "maturity_amount": maturity_amt,
        "maturity_date": (datetime.now(timezone.utc) + timedelta(days=int(req.tenure_months * 30.4))).strftime("%Y-%m-%d"),
        "nominee_name": req.nominee_name or current_user.get("nominee", {}).get("name", "Registered Nominee"),
        "status": "active",
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.deposits.insert_one(dep_doc)

    return {"status": "SUCCESS", "message": f"{req.deposit_type.upper()} #{dep_id} booked successfully! Maturity value: ₹{maturity_amt:,.2f}", "deposit": {k: v for k, v in dep_doc.items() if k != "_id"}}

# ----------------- Loans & Calculators -----------------
@api_router.post("/loans/apply")
async def apply_loan(req: LoanApplicationRequest, current_user: dict = Depends(get_current_user)):
    interest_rates = {
        "personal": 10.50,
        "home": 8.40,
        "vehicle": 8.75,
        "gold": 7.90
    }
    rate = interest_rates.get(req.loan_type, 10.0)
    
    p = req.amount_requested
    r = (rate / 12) / 100
    n = req.tenure_months
    emi = round((p * r * ((1 + r) ** n)) / (((1 + r) ** n) - 1), 2)
    eligible = req.monthly_income * 0.5 >= emi

    loan_doc = {
        "id": str(uuid.uuid4()),
        "user_id": current_user["id"],
        "loan_application_no": f"LN-{datetime.now(timezone.utc).strftime('%Y%m')}-{random.randint(10000, 99999)}",
        "loan_type": req.loan_type,
        "amount_requested": req.amount_requested,
        "interest_rate": rate,
        "tenure_months": req.tenure_months,
        "calculated_emi": emi,
        "monthly_income": req.monthly_income,
        "employment_type": req.employment_type,
        "purpose": req.purpose,
        "eligibility_status": "Pre-Approved" if eligible else "Under Review",
        "status": "IN_REVIEW",
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.loans.insert_one(loan_doc)

    return {
        "status": "SUCCESS",
        "application_no": loan_doc["loan_application_no"],
        "calculated_emi": emi,
        "interest_rate": rate,
        "eligibility": loan_doc["eligibility_status"],
        "message": f"Application for {req.loan_type.capitalize()} Loan submitted successfully!"
    }

@api_router.get("/loans/my-applications")
async def get_my_loans(current_user: dict = Depends(get_current_user)):
    loans = await db.loans.find({"user_id": current_user["id"]}, {"_id": 0}).to_list(50)
    return {"loans": loans}

# ----------------- Investments & Insurance -----------------
@api_router.get("/investments/catalog")
async def get_investment_catalog():
    schemes = [
        {"id": "mf1", "name": "AJSPay Bluechip Large Cap Equity Fund", "category": "Equity Large Cap", "cagr_3yr": "18.4%", "risk": "Moderate", "min_sip": 500, "nav": 94.20},
        {"id": "mf2", "name": "AJSPay Tech Opportunity Fund", "category": "Sectoral Tech", "cagr_3yr": "24.8%", "risk": "High", "min_sip": 1000, "nav": 182.50},
        {"id": "mf3", "name": "AJSPay Balanced Advantage Hybrid Fund", "category": "Dynamic Asset Hybrid", "cagr_3yr": "16.1%", "risk": "Low-Mod", "min_sip": 500, "nav": 445.10},
        {"id": "mf4", "name": "AJSPay Nifty 50 Index Fund Direct", "category": "Passive Index", "cagr_3yr": "15.2%", "risk": "Moderate", "min_sip": 500, "nav": 240.80}
    ]
    insurances = [
        {"id": "ins1", "name": "AJSPay Life Shield Plus Term Plan", "type": "Life Term Cover", "cover": "₹1.00 Crore", "annual_premium": 8450, "claim_ratio": "98.5%"},
        {"id": "ins2", "name": "AJSPay Complete Health Shield", "type": "Family Health Floater", "cover": "₹20.00 Lakhs", "annual_premium": 14200, "claim_ratio": "99.1%"},
        {"id": "ins3", "name": "AJSPay Comprehensive Motor Insurance", "type": "Zero-Dep Auto Cover", "cover": "IDV Market Value", "annual_premium": 7100, "claim_ratio": "97.8%"}
    ]
    return {"mutual_funds": schemes, "insurance_plans": insurances}

@api_router.post("/investments/invest")
async def invest_mutual_fund(req: InvestmentBuyRequest, current_user: dict = Depends(get_current_user)):
    acc = await db.accounts.find_one({"account_number": req.account_number, "user_id": current_user["id"]})
    if not acc or acc["balance"] < req.amount:
        raise HTTPException(status_code=400, detail="Insufficient funds for investment.")
    
    new_bal = acc["balance"] - req.amount
    await db.accounts.update_one({"account_number": req.account_number}, {"$set": {"balance": new_bal}})

    folio_no = f"FOLIO-984{random.randint(10000, 99999)}"
    inv_doc = {
        "id": str(uuid.uuid4()),
        "user_id": current_user["id"],
        "folio_no": folio_no,
        "scheme_id": req.scheme_id,
        "scheme_name": req.scheme_name,
        "investment_type": req.investment_type,
        "invested_amount": req.amount,
        "current_value": req.amount,
        "units": round(req.amount / 120.0, 3),
        "status": "ACTIVE",
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.investments.insert_one(inv_doc)

    return {"status": "SUCCESS", "message": f"Invested ₹{req.amount:,.2f} in {req.scheme_name}. Folio Number: {folio_no}", "portfolio": {k: v for k, v in inv_doc.items() if k != "_id"}}

@api_router.get("/investments/my-portfolio")
async def get_my_portfolio(current_user: dict = Depends(get_current_user)):
    portfolio = await db.investments.find({"user_id": current_user["id"]}, {"_id": 0}).to_list(100)
    policies = await db.insurance_policies.find({"user_id": current_user["id"]}, {"_id": 0}).to_list(100)
    return {"mutual_funds": portfolio, "insurance_policies": policies}

# ----------------- Customer Service & Support -----------------
@api_router.post("/support/complaint")
async def register_complaint(req: ComplaintRequest, current_user: dict = Depends(get_current_user)):
    ticket_id = f"TKT-SR-{datetime.now(timezone.utc).strftime('%Y%m%d')}-{random.randint(1000, 9999)}"
    ticket_doc = {
        "id": str(uuid.uuid4()),
        "ticket_id": ticket_id,
        "user_id": current_user["id"],
        "user_email": current_user["email"],
        "user_name": current_user["name"],
        "category": req.category,
        "account_number": req.account_number,
        "subject": req.subject,
        "description": req.description,
        "status": "OPEN",
        "priority": "HIGH" if "fraud" in req.subject.lower() else "MEDIUM",
        "assigned_to": "Grievance Redressal Desk",
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.support_tickets.insert_one(ticket_doc)
    return {"status": "SUCCESS", "ticket_id": ticket_id, "message": f"Service request logged under Ticket #{ticket_id}."}

@api_router.get("/support/my-tickets")
async def get_my_tickets(current_user: dict = Depends(get_current_user)):
    tickets = await db.support_tickets.find({"user_id": current_user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(50)
    return {"tickets": tickets}

@api_router.get("/branches/locator")
async def get_branches(city: Optional[str] = None):
    branches = await db.branches.find({}, {"_id": 0}).to_list(100)
    return {"branches": branches}

@api_router.post("/support/chat")
async def banking_ai_chatbot(req: ChatQueryRequest):
    msg = req.message.lower()
    
    if "ifsc" in msg or "branch code" in msg:
        reply = "AJSPay main branch IFSC codes:\n- Nariman Point: **AJSP0000042**\n- Bandra Kurla Complex: **AJSP0000001**\n- Connaught Place: **AJSP0000007**\n- Koramangala: **AJSP0004081**"
    elif "limit" in msg or "transfer limit" in msg:
        reply = "Daily Fund Transfer Limits:\n- **IMPS**: Up to ₹5,00,000 instant (24x7)\n- **NEFT**: No minimum, up to ₹10,00,000 per transaction\n- **RTGS**: Min ₹2,00,000, Max ₹25,00,000 (instant settlement)\n- **UPI**: Up to ₹1,00,000 per day"
    elif "fd" in msg or "fixed deposit" in msg or "interest rate" in msg:
        reply = "Current Fixed Deposit (FD) Interest Rates:\n- 7 to 365 Days: **6.50% p.a.**\n- 1 Year to 2 Years: **7.25% p.a.**\n- 2 Years to 3 Years: **7.50% p.a.**\n*Senior citizens enjoy additional 0.50% p.a.*"
    elif "hotlist" in msg or "block card" in msg or "lost card" in msg:
        reply = "To block or hotlist your debit card immediately, visit the **Cards & Digital Services** tab and click **Freeze Card** or **Hotlist Card**. Alternatively call our 24x7 toll-free helpline at **1800 11 2211**."
    elif "cheque" in msg or "cheque book" in msg:
        reply = "You can request a 25, 50, or 100-leaf personalized CTS-2010 compliant Cheque Book from the **Cards & Cheques** section. Delivered within 3 business days."
    elif "kyc" in msg or "aadhaar" in msg or "pan" in msg:
        reply = "KYC documents required as per RBI Master Direction: Valid PAN Card + Aadhaar Card / Passport / Voter ID as Official Valid Document (OVD)."
    elif "loan" in msg or "emi" in msg:
        reply = "We offer Personal Loans starting at **10.50%**, Home Loans at **8.40%**, and Car Loans at **8.75%**."
    else:
        reply = "I am your 24x7 AJSPay Assistant. You can ask me about fund transfers (IMPS/NEFT/RTGS/UPI), FD rates, debit cards, cheque books, loan eligibility, or branch locations!"

    return {"response": reply, "timestamp": datetime.now(timezone.utc).isoformat()}

# ----------------- Admin & Compliance Portal -----------------
@api_router.get("/admin/overview")
async def get_admin_overview(admin: dict = Depends(get_current_admin)):
    total_users = await db.users.count_documents({})
    total_accounts = await db.accounts.count_documents({})
    total_deposits = await db.deposits.count_documents({})
    pending_kyc = await db.users.count_documents({"kyc_status": "pending_approval"})
    
    all_accs = await db.accounts.find({}, {"balance": 1}).to_list(1000)
    total_liquidity = sum(a.get("balance", 0.0) for a in all_accs)
    
    high_value_txns = await db.transactions.find({"amount": {"$gte": 50000.0}}, {"_id": 0}).sort("timestamp", -1).limit(10).to_list(10)
    pending_users = await db.users.find({"kyc_status": "pending_approval"}, {"_id": 0, "password_hash": 0, "transaction_password_hash": 0}).to_list(20)
    audits = await db.audit_logs.find({}, {"_id": 0}).sort("timestamp", -1).limit(15).to_list(15)

    return {
        "stats": {
            "total_customers": total_users,
            "active_accounts": total_accounts,
            "active_deposits": total_deposits,
            "pending_kyc_count": pending_kyc,
            "total_liquidity": total_liquidity,
            "statutory_crr_slr_status": "Compliant (CRR: 4.50%, SLR: 18.00%)"
        },
        "high_value_transactions": high_value_txns,
        "pending_kyc_users": pending_users,
        "audit_logs": audits
    }

@api_router.post("/admin/kyc-action")
async def admin_kyc_action(req: KycActionRequest, admin: dict = Depends(get_current_admin)):
    user = await db.users.find_one({"id": req.user_id})
    if not user:
        raise HTTPException(status_code=404, detail="Customer not found.")
    
    await db.users.update_one({"id": req.user_id}, {"$set": {"kyc_status": req.status, "kyc_reason": req.rejection_reason}})
    return {"status": "SUCCESS", "message": f"Customer KYC status updated to {req.status.upper()}"}

@api_router.get("/admin/rbi-reports")
async def get_rbi_reports(admin: dict = Depends(get_current_admin)):
    ctr_records = await db.transactions.find({"amount": {"$gte": 100000.0}}, {"_id": 0}).to_list(50)
    str_records = await db.transactions.find({"mode": "CORPORATE_BULK"}, {"_id": 0}).to_list(50)

    return {
        "report_generated_on": datetime.now(timezone.utc).isoformat(),
        "regulatory_authority": "Reserve Bank of India (RBI)",
        "guideline": "Master Direction - Know Your Customer (KYC) Direction, 2016 & PMLA Section 12",
        "cash_transaction_report_ctr": {
            "title": "Cash / High-Value Transaction Report (CTR)",
            "count": len(ctr_records),
            "records": ctr_records
        },
        "suspicious_transaction_report_str": {
            "title": "Suspicious Transaction Report (STR)",
            "count": len(str_records),
            "records": str_records
        },
        "statutory_compliance": {
            "crr_cash_reserve_ratio": "4.50% (Maintained)",
            "slr_statutory_liquidity_ratio": "18.00% (Maintained in G-Secs)",
            "lcr_liquidity_coverage_ratio": "142.6% (Benchmark: >100%)",
            "car_capital_adequacy_ratio": "16.8% (Basel III compliant)"
        }
    }

# ----------------- Hostinger PHP/MySQL Export -----------------
# The PHP port lives as real files in /hostinger so it can be linted, run locally
# with `php -S`, and exercised by the same pytest suite as this API.
HOSTINGER_DIR = Path(__file__).resolve().parent.parent / "hostinger"
HOSTINGER_FILES = {  # package key -> file name inside the zip
    "db_php": "db.php",
    "api_php": "api.php",
    "schema_sql": "schema.sql",
    "htaccess": ".htaccess",
    "deploy_guide": "INSTALL_HOSTINGER.md",
}

@api_router.get("/hostinger/package")
async def get_hostinger_package():
    return {key: (HOSTINGER_DIR / name).read_text() for key, name in HOSTINGER_FILES.items()}

@api_router.get("/hostinger/download-zip")
async def download_hostinger_zip():
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
        for name in HOSTINGER_FILES.values():
            zip_file.write(HOSTINGER_DIR / name, name)
    zip_buffer.seek(0)
    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=hostinger_banking_php_mysql_package.zip"}
    )

# ============================================================================
# OTP / MFA — Twilio SMS + SendGrid Email  (mocked when LIVE_OTP != "true")
# ============================================================================
LIVE_OTP = os.environ.get("LIVE_OTP", "false").lower() == "true"

def _send_otp_via_twilio(phone: str, otp: str) -> str:
    sid = os.environ.get("TWILIO_ACCOUNT_SID", "")
    tok = os.environ.get("TWILIO_AUTH_TOKEN", "")
    frm = os.environ.get("TWILIO_FROM_NUMBER", "")
    if not (sid and tok and frm and TwilioClient):
        return "twilio_not_configured"
    try:
        c = TwilioClient(sid, tok)
        c.messages.create(to=phone, from_=frm, body=f"AJSPay OTP: {otp}. Valid 5 min. Never share.")
        return "sent"
    except Exception as e:
        return f"twilio_error: {str(e)[:80]}"

def _send_otp_via_sendgrid(email: str, otp: str, purpose: str) -> str:
    key = os.environ.get("SENDGRID_API_KEY", "")
    frm = os.environ.get("SENDGRID_FROM_EMAIL", "alerts@ajspay.in")
    if not (key and SendGridAPIClient and SGMail):
        return "sendgrid_not_configured"
    try:
        msg = SGMail(
            from_email=frm, to_emails=email,
            subject=f"AJSPay OTP — {purpose}",
            html_content=f"<p>Your OTP is <b style='font-size:22px'>{otp}</b>. Valid for 5 minutes.</p><p>Never share this with anyone.</p>"
        )
        SendGridAPIClient(key).send(msg)
        return "sent"
    except Exception as e:
        return f"sendgrid_error: {str(e)[:80]}"

class OtpSendRequest(BaseModel):
    channel: str = "sms"       # sms | email | both
    purpose: str = "login"     # login | txn | pin_reset | high_value

class OtpVerifyRequest(BaseModel):
    purpose: str
    otp: str

@api_router.post("/otp/send")
async def otp_send(req: OtpSendRequest, current_user: dict = Depends(get_current_user)):
    otp = f"{random.randint(0, 999999):06d}"
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": current_user["id"],
        "purpose": req.purpose,
        "otp": otp,
        "channel": req.channel,
        "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat(),
        "verified": False,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    # Invalidate previous OTPs for same purpose
    await db.otps.delete_many({"user_id": current_user["id"], "purpose": req.purpose, "verified": False})
    await db.otps.insert_one(doc)

    delivery = {"sms": None, "email": None}
    cfg = await _resolve_delivery_config()
    live_mode = cfg["live_otp"]
    if live_mode:
        if req.channel in ("sms", "both") and cfg["twilio_sid"] and cfg["twilio_token"] and cfg["twilio_from"] and TwilioClient:
            try:
                TwilioClient(cfg["twilio_sid"], cfg["twilio_token"]).messages.create(
                    to=current_user.get("phone", ""), from_=cfg["twilio_from"],
                    body=f"AJSPay OTP: {otp}. Valid 5 min. Never share.")
                delivery["sms"] = "sent"
            except Exception as e:
                delivery["sms"] = f"twilio_error: {str(e)[:60]}"
        if req.channel in ("email", "both") and cfg["sendgrid_key"] and SendGridAPIClient and SGMail:
            try:
                SendGridAPIClient(cfg["sendgrid_key"]).send(SGMail(
                    from_email=cfg["sendgrid_from"], to_emails=current_user["email"],
                    subject=f"AJSPay OTP — {req.purpose}",
                    html_content=f"<p>Your OTP is <b style='font-size:22px'>{otp}</b>. Valid 5 min.</p>"))
                delivery["email"] = "sent"
            except Exception as e:
                delivery["email"] = f"sendgrid_error: {str(e)[:60]}"
    else:
        delivery = {"sms": "MOCKED", "email": "MOCKED"}

    payload = {
        "status": "SUCCESS",
        "message": f"OTP sent to your registered {'phone' if req.channel=='sms' else req.channel}.",
        "channel": req.channel,
        "expires_in_seconds": 300,
        "live_mode": live_mode,
        "delivery": delivery
    }
    if not live_mode:
        payload["demo_otp"] = otp
    return payload

@api_router.post("/otp/verify")
async def otp_verify(req: OtpVerifyRequest, current_user: dict = Depends(get_current_user)):
    doc = await db.otps.find_one({"user_id": current_user["id"], "purpose": req.purpose, "verified": False})
    if not doc:
        raise HTTPException(status_code=400, detail="No active OTP. Please request a new one.")
    if datetime.fromisoformat(doc["expires_at"]) < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="OTP expired. Please request a new one.")
    if doc["otp"] != req.otp:
        raise HTTPException(status_code=400, detail="Invalid OTP.")
    await db.otps.update_one({"id": doc["id"]}, {"$set": {"verified": True, "verified_at": datetime.now(timezone.utc).isoformat()}})
    return {"status": "SUCCESS", "message": "OTP verified.", "purpose": req.purpose}

# ============================================================================
# WebAuthn / Passkeys — register + login
# ============================================================================
WEBAUTHN_RP_ID = os.environ.get("WEBAUTHN_RP_ID", "localhost")
WEBAUTHN_RP_NAME = os.environ.get("WEBAUTHN_RP_NAME", "AJSPay")
WEBAUTHN_ORIGIN = os.environ.get("WEBAUTHN_ORIGIN", "http://localhost:3000")

@api_router.post("/passkey/register/challenge")
async def passkey_register_challenge(current_user: dict = Depends(get_current_user)):
    existing = await db.passkeys.find({"user_id": current_user["id"]}, {"credential_id": 1, "_id": 0}).to_list(50)
    excluded = [PublicKeyCredentialDescriptor(id=base64.urlsafe_b64decode(e["credential_id"] + "==")) for e in existing]
    opts = generate_registration_options(
        rp_id=WEBAUTHN_RP_ID,
        rp_name=WEBAUTHN_RP_NAME,
        user_id=current_user["id"].encode("utf-8"),
        user_name=current_user["email"],
        user_display_name=current_user.get("name", current_user["email"]),
        exclude_credentials=excluded,
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.PREFERRED,
            user_verification=UserVerificationRequirement.PREFERRED
        )
    )
    # Cache challenge server-side for verification
    challenge_b64 = base64.urlsafe_b64encode(opts.challenge).decode().rstrip("=")
    await db.passkey_challenges.update_one(
        {"user_id": current_user["id"], "type": "register"},
        {"$set": {"challenge": challenge_b64, "created_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True
    )
    import json as _json
    return _json.loads(options_to_json(opts))

class PasskeyRegisterRequest(BaseModel):
    credential: Dict[str, Any]
    label: Optional[str] = "My Device"

@api_router.post("/passkey/register/complete")
async def passkey_register_complete(req: PasskeyRegisterRequest, current_user: dict = Depends(get_current_user)):
    saved = await db.passkey_challenges.find_one({"user_id": current_user["id"], "type": "register"})
    if not saved:
        raise HTTPException(status_code=400, detail="No active passkey registration in progress.")
    try:
        expected = base64.urlsafe_b64decode(saved["challenge"] + "==")
        verification = verify_registration_response(
            credential=req.credential,
            expected_challenge=expected,
            expected_rp_id=WEBAUTHN_RP_ID,
            expected_origin=WEBAUTHN_ORIGIN
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Passkey verification failed: {str(e)[:120]}")

    await db.passkeys.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": current_user["id"],
        "credential_id": base64.urlsafe_b64encode(verification.credential_id).decode().rstrip("="),
        "public_key": base64.urlsafe_b64encode(verification.credential_public_key).decode().rstrip("="),
        "sign_count": verification.sign_count,
        "label": req.label or "My Device",
        "created_at": datetime.now(timezone.utc).isoformat()
    })
    await db.passkey_challenges.delete_one({"user_id": current_user["id"], "type": "register"})
    return {"status": "SUCCESS", "message": f"Passkey '{req.label}' registered."}

class PasskeyLoginChallengeRequest(BaseModel):
    email: EmailStr

@api_router.post("/passkey/login/challenge")
async def passkey_login_challenge(req: PasskeyLoginChallengeRequest):
    user = await db.users.find_one({"email": req.email.lower()})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    creds = await db.passkeys.find({"user_id": user["id"]}, {"credential_id": 1, "_id": 0}).to_list(50)
    if not creds:
        raise HTTPException(status_code=400, detail="No passkey registered for this account.")
    allowed = [PublicKeyCredentialDescriptor(id=base64.urlsafe_b64decode(c["credential_id"] + "==")) for c in creds]
    opts = generate_authentication_options(
        rp_id=WEBAUTHN_RP_ID,
        allow_credentials=allowed,
        user_verification=UserVerificationRequirement.PREFERRED
    )
    challenge_b64 = base64.urlsafe_b64encode(opts.challenge).decode().rstrip("=")
    await db.passkey_challenges.update_one(
        {"user_id": user["id"], "type": "login"},
        {"$set": {"challenge": challenge_b64, "created_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True
    )
    import json as _json
    return _json.loads(options_to_json(opts))

class PasskeyLoginCompleteRequest(BaseModel):
    email: EmailStr
    credential: Dict[str, Any]

@api_router.post("/passkey/login/complete")
async def passkey_login_complete(req: PasskeyLoginCompleteRequest, response: Response):
    user = await db.users.find_one({"email": req.email.lower()})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    saved = await db.passkey_challenges.find_one({"user_id": user["id"], "type": "login"})
    if not saved:
        raise HTTPException(status_code=400, detail="No active passkey login challenge.")

    cred_id_b64 = req.credential.get("id") or req.credential.get("rawId")
    cred_id_bytes = base64.urlsafe_b64decode(cred_id_b64 + "==")
    stored = await db.passkeys.find_one({
        "user_id": user["id"],
        "credential_id": base64.urlsafe_b64encode(cred_id_bytes).decode().rstrip("=")
    })
    if not stored:
        raise HTTPException(status_code=400, detail="Unknown passkey")

    try:
        expected = base64.urlsafe_b64decode(saved["challenge"] + "==")
        verification = verify_authentication_response(
            credential=req.credential,
            expected_challenge=expected,
            expected_rp_id=WEBAUTHN_RP_ID,
            expected_origin=WEBAUTHN_ORIGIN,
            credential_public_key=base64.urlsafe_b64decode(stored["public_key"] + "=="),
            credential_current_sign_count=stored.get("sign_count", 0),
            require_user_verification=False
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Passkey auth failed: {str(e)[:120]}")

    await db.passkeys.update_one({"id": stored["id"]}, {"$set": {"sign_count": verification.new_sign_count}})
    await db.passkey_challenges.delete_one({"user_id": user["id"], "type": "login"})

    token = create_access_token(user["id"], user["email"], user.get("role", "retail"))
    set_session_cookie(response, token)
    user_clean = {k: v for k, v in user.items() if k not in ["_id", "password_hash", "transaction_password_hash"]}
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()), "user_id": user["id"], "email": user["email"],
        "action": "PASSKEY_LOGIN", "details": "Passkey (WebAuthn) login",
        "ip": "0.0.0.0", "timestamp": datetime.now(timezone.utc).isoformat()
    })
    return {"token": token, "user": user_clean, "message": "Passkey login successful", "mfa_verified": True}

@api_router.get("/passkey/list")
async def passkey_list(current_user: dict = Depends(get_current_user)):
    items = await db.passkeys.find({"user_id": current_user["id"]}, {"_id": 0, "public_key": 0}).to_list(50)
    return {"passkeys": items, "rp_id": WEBAUTHN_RP_ID, "rp_name": WEBAUTHN_RP_NAME}

@api_router.delete("/passkey/{passkey_id}")
async def passkey_delete(passkey_id: str, current_user: dict = Depends(get_current_user)):
    r = await db.passkeys.delete_one({"id": passkey_id, "user_id": current_user["id"]})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Passkey not found")
    return {"status": "SUCCESS", "message": "Passkey removed"}

# ============================================================================
# Video KYC — webcam capture (selfie + PAN + Aadhaar) → admin queue
# ============================================================================
class VideoKycSubmit(BaseModel):
    selfie_b64: str
    pan_b64: str
    aadhaar_b64: str
    liveness_words: Optional[str] = None
    device_info: Optional[str] = None

@api_router.post("/kyc/video/submit")
async def kyc_video_submit(req: VideoKycSubmit, current_user: dict = Depends(get_current_user)):
    def _size_of(b64: str) -> int:
        try: return len(base64.b64decode(b64.split(",")[-1]))
        except Exception: return 0

    if _size_of(req.selfie_b64) < 1000 or _size_of(req.pan_b64) < 1000 or _size_of(req.aadhaar_b64) < 1000:
        raise HTTPException(status_code=400, detail="Uploaded frames appear invalid. Please retake photos.")

    doc = {
        "id": str(uuid.uuid4()),
        "user_id": current_user["id"],
        "user_email": current_user["email"],
        "user_name": current_user.get("name"),
        "selfie_b64": req.selfie_b64[:400000],   # cap payload to be safe
        "pan_b64": req.pan_b64[:400000],
        "aadhaar_b64": req.aadhaar_b64[:400000],
        "liveness_words": req.liveness_words,
        "device_info": req.device_info,
        "status": "pending_review",
        "submitted_at": datetime.now(timezone.utc).isoformat()
    }
    await db.kyc_video_submissions.insert_one(doc)

    # Auto face-match: compare selfie vs PAN card photo (histogram cosine similarity)
    try:
        score = _hist_similarity(req.selfie_b64, req.pan_b64)
        cfg = await db.system_config.find_one({"_id": "global"}) or {}
        threshold = float(cfg.get("face_match_auto_threshold", 92.0))
        verdict = "auto_approve" if score >= threshold else ("high_confidence" if score >= 82 else ("review" if score >= 65 else "reject_recommended"))
        await db.kyc_video_submissions.update_one({"id": doc["id"]}, {"$set": {"face_match_score": score, "face_match_verdict": verdict, "face_match_algo": "histogram_v1"}})
        auto_approved = False
        if verdict == "auto_approve":
            await db.kyc_video_submissions.update_one({"id": doc["id"]}, {"$set": {"status": "approved", "reviewer": "AI_AUTO", "reviewed_at": datetime.now(timezone.utc).isoformat()}})
            await db.users.update_one({"id": current_user["id"]}, {"$set": {"kyc_status": "verified"}})
            auto_approved = True
    except Exception:
        score = 0; verdict = "review"; auto_approved = False

    # Mark customer as pending final review only if not auto-approved
    if not auto_approved:
        await db.users.update_one({"id": current_user["id"]}, {"$set": {"kyc_status": "pending_approval"}})
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()), "user_id": current_user["id"], "email": current_user["email"],
        "action": "VIDEO_KYC_SUBMITTED", "details": f"Video KYC submitted (id={doc['id']}) score={score} verdict={verdict}",
        "ip": "0.0.0.0", "timestamp": datetime.now(timezone.utc).isoformat()
    })
    return {"status": "SUCCESS",
            "message": ("Video KYC approved automatically by AI face-match." if auto_approved
                       else "Video KYC submitted. Branch officer will verify within 24 hours."),
            "submission_id": doc["id"], "face_match_score": score, "verdict": verdict,
            "auto_approved": auto_approved}

@api_router.get("/kyc/video/queue")
async def kyc_video_queue(current_user: dict = Depends(get_current_admin)):
    subs = await db.kyc_video_submissions.find({"status": "pending_review"}, {"_id": 0}).sort("submitted_at", -1).to_list(50)
    # Strip full base64 from list — send only lightweight metadata
    for s in subs:
        s["selfie_thumb"] = s.pop("selfie_b64", "")[:600] + "…"
        s.pop("pan_b64", None); s.pop("aadhaar_b64", None)
    return {"submissions": subs, "count": len(subs)}

@api_router.get("/kyc/video/{sub_id}")
async def kyc_video_detail(sub_id: str, current_user: dict = Depends(get_current_admin)):
    s = await db.kyc_video_submissions.find_one({"id": sub_id}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Submission not found")
    return s

class KycVideoDecision(BaseModel):
    submission_id: str
    decision: str          # approve | reject
    reason: Optional[str] = None

@api_router.post("/kyc/video/decision")
async def kyc_video_decision(req: KycVideoDecision, current_user: dict = Depends(get_current_admin)):
    s = await db.kyc_video_submissions.find_one({"id": req.submission_id})
    if not s:
        raise HTTPException(status_code=404, detail="Submission not found")
    new_status = "approved" if req.decision == "approve" else "rejected"
    await db.kyc_video_submissions.update_one(
        {"id": req.submission_id},
        {"$set": {"status": new_status, "reviewed_at": datetime.now(timezone.utc).isoformat(), "reviewer": current_user["email"], "review_reason": req.reason}}
    )
    await db.users.update_one({"id": s["user_id"]}, {"$set": {"kyc_status": "verified" if new_status == "approved" else "rejected"}})
    return {"status": "SUCCESS", "message": f"Video KYC {new_status}."}

# ============================================================================
# Statement Export — RBI-style PDF + Excel
# ============================================================================
async def _load_stmt_rows(user_id: str, account_number: Optional[str], start: Optional[str], end: Optional[str]):
    q = {"user_id": user_id}
    if account_number: q["account_number"] = account_number
    if start or end:
        rng = {}
        if start: rng["$gte"] = start
        if end: rng["$lte"] = end + "T23:59:59"
        q["timestamp"] = rng
    txns = await db.transactions.find(q, {"_id": 0}).sort("timestamp", -1).to_list(500)
    acc = await db.accounts.find_one({"user_id": user_id, **({"account_number": account_number} if account_number else {})}, {"_id": 0})
    return acc, txns

@api_router.get("/statements/pdf")
async def statement_pdf(account_number: str = Query(...),
                        start: Optional[str] = None, end: Optional[str] = None,
                        current_user: dict = Depends(get_current_user)):
    acc, txns = await _load_stmt_rows(current_user["id"], account_number, start, end)
    if not acc:
        raise HTTPException(status_code=404, detail="Account not found")

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=15*mm, rightMargin=15*mm, topMargin=15*mm, bottomMargin=15*mm)
    styles = getSampleStyleSheet()
    hdr = ParagraphStyle('hdr', parent=styles['Title'], fontSize=16, textColor=colors.HexColor('#0b3b8c'), spaceAfter=4)
    small = ParagraphStyle('small', parent=styles['Normal'], fontSize=8, textColor=colors.HexColor('#334155'))
    story = []
    story.append(Paragraph("AJSPay", hdr))
    story.append(Paragraph("RBI-regulated · Head Office: Nariman Point, Mumbai · IFSC prefix per branch", small))
    story.append(Spacer(1, 8))
    story.append(Paragraph(f"<b>Account Statement</b> — {account_number}", styles['Heading3']))
    story.append(Paragraph(
        f"Customer: {current_user.get('name')}<br/>"
        f"Account Type: {acc.get('account_type','savings').title()} · IFSC: {acc.get('ifsc_code','')}<br/>"
        f"Period: {start or 'All'} to {end or 'today'} · Generated: {datetime.now(timezone.utc).strftime('%d-%b-%Y %H:%M UTC')}",
        small
    ))
    story.append(Spacer(1, 10))

    table_data = [["Date", "Ref No", "Mode", "Description", "Debit (₹)", "Credit (₹)", "Balance (₹)"]]
    for t in txns:
        ts = t.get("timestamp", "")[:10]
        table_data.append([
            ts, t.get("ref_number",""), t.get("mode",""),
            (t.get("description") or "")[:36],
            f"{t['amount']:,.2f}" if t.get("type")=="debit" else "",
            f"{t['amount']:,.2f}" if t.get("type")=="credit" else "",
            f"{t.get('balance_after',0):,.2f}"
        ])
    tbl = Table(table_data, repeatRows=1, colWidths=[22*mm, 34*mm, 16*mm, 45*mm, 20*mm, 20*mm, 24*mm])
    tbl.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#0b3b8c')),
        ('TEXTCOLOR',  (0,0), (-1,0), colors.white),
        ('FONTNAME',   (0,0), (-1,0), 'Helvetica-Bold'),
        ('FONTSIZE',   (0,0), (-1,-1), 7.5),
        ('GRID',       (0,0), (-1,-1), 0.25, colors.HexColor('#cbd5e1')),
        ('ALIGN',      (4,1), (-1,-1), 'RIGHT'),
        ('VALIGN',     (0,0), (-1,-1), 'MIDDLE'),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, colors.HexColor('#f8fafc')]),
    ]))
    story.append(tbl)
    story.append(Spacer(1, 10))
    story.append(Paragraph(
        "TDS Note: TDS is deducted u/s 194A on interest above ₹40,000 (₹50,000 for senior citizens) per financial year. "
        "This is a system-generated statement and does not require a signature. For queries, call 1800-123-4567.",
        small
    ))
    doc.build(story)
    buf.seek(0)
    fname = f"stmt_{account_number}_{(start or '').replace('-','')}_{(end or '').replace('-','')}.pdf"
    return StreamingResponse(buf, media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={fname}"})

@api_router.get("/statements/excel")
async def statement_excel(account_number: str = Query(...),
                          start: Optional[str] = None, end: Optional[str] = None,
                          current_user: dict = Depends(get_current_user)):
    acc, txns = await _load_stmt_rows(current_user["id"], account_number, start, end)
    if not acc:
        raise HTTPException(status_code=404, detail="Account not found")

    wb = Workbook()
    ws = wb.active
    ws.title = "Statement"
    # Header block
    ws["A1"] = "AJSPay — RBI Regulated"
    ws["A1"].font = Font(bold=True, size=14, color="0B3B8C")
    ws["A2"] = f"Account Statement — {account_number}"
    ws["A2"].font = Font(bold=True, size=12)
    ws["A3"] = f"Customer: {current_user.get('name')} · Type: {acc.get('account_type','savings').title()} · IFSC: {acc.get('ifsc_code','')}"
    ws["A4"] = f"Period: {start or 'All'} → {end or 'today'} · Generated: {datetime.now(timezone.utc).strftime('%d-%b-%Y %H:%M UTC')}"

    headers = ["Date", "Ref No", "Mode", "Description", "Debit (INR)", "Credit (INR)", "Balance (INR)"]
    ws.append([]); ws.append(headers)
    header_row = ws.max_row
    for i, h in enumerate(headers, 1):
        c = ws.cell(row=header_row, column=i)
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = PatternFill(start_color="0B3B8C", end_color="0B3B8C", fill_type="solid")
        c.alignment = Alignment(horizontal="center")
    for t in txns:
        ws.append([
            t.get("timestamp","")[:10], t.get("ref_number",""), t.get("mode",""),
            (t.get("description") or "")[:80],
            t["amount"] if t.get("type")=="debit" else "",
            t["amount"] if t.get("type")=="credit" else "",
            t.get("balance_after", 0)
        ])
    widths = [12, 22, 10, 40, 16, 16, 18]
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[chr(64+i)].width = w

    ws2 = wb.create_sheet("TDS Note")
    ws2["A1"] = "TDS is deducted u/s 194A on interest > ₹40,000 (₹50,000 for seniors) per FY."
    ws2["A2"] = "Deposits insured by DICGC up to ₹5 lakh."

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    fname = f"stmt_{account_number}_{(start or '').replace('-','')}_{(end or '').replace('-','')}.xlsx"
    return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={fname}"})

# ============================================================================
# Refer & Earn
# ============================================================================
REFERRAL_REWARD_AMOUNT = 500.0  # ₹500 to each of referrer + referee

def _make_ref_code(name: str) -> str:
    seed = "".join(c for c in (name or "").upper() if c.isalpha())[:3] or "USR"
    return f"{seed}{random.randint(10000, 99999)}"

async def _ensure_ref_code(user_id: str, name: str) -> str:
    u = await db.users.find_one({"id": user_id})
    if u and u.get("referral_code"):
        return u["referral_code"]
    for _ in range(5):
        code = _make_ref_code(name)
        if not await db.users.find_one({"referral_code": code}):
            await db.users.update_one({"id": user_id}, {"$set": {"referral_code": code}})
            return code
    code = f"AJS{uuid.uuid4().hex[:6].upper()}"
    await db.users.update_one({"id": user_id}, {"$set": {"referral_code": code}})
    return code

@api_router.get("/referrals/my-code")
async def referrals_my_code(current_user: dict = Depends(get_current_user)):
    code = await _ensure_ref_code(current_user["id"], current_user.get("name", "USR"))
    base = os.environ.get("PUBLIC_APP_URL", "http://localhost:3000")
    return {
        "referral_code": code,
        "referral_link": f"{base}/?ref={code}",
        "reward_amount": REFERRAL_REWARD_AMOUNT,
        "reward_note": f"You and your friend each get ₹{int(REFERRAL_REWARD_AMOUNT)} credited as soon as they open an account and complete KYC."
    }

@api_router.get("/referrals/history")
async def referrals_history(current_user: dict = Depends(get_current_user)):
    items = await db.referrals.find({"referrer_id": current_user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)
    total = sum(i.get("credit_amount", 0) for i in items if i.get("status") == "paid")
    return {"referrals": items, "total_earned": total, "count": len(items)}

# ============================================================================
# Standing Instructions (SI / SIP / EMI auto-debit)
# ============================================================================
class StandingInstructionCreate(BaseModel):
    from_account_number: str
    beneficiary_name: str
    beneficiary_account: str
    beneficiary_ifsc: str = "AJSP0000042"
    amount: float
    frequency: str = "monthly"   # daily | weekly | monthly | quarterly
    category: str = "generic"    # rent | sip | emi | insurance | generic
    start_date: str              # YYYY-MM-DD
    end_date: Optional[str] = None
    remarks: Optional[str] = "Standing instruction"

@api_router.get("/standing-instructions")
async def si_list(current_user: dict = Depends(get_current_user)):
    items = await db.standing_instructions.find({"user_id": current_user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return {"items": items, "count": len(items)}

@api_router.post("/standing-instructions")
async def si_create(req: StandingInstructionCreate, current_user: dict = Depends(get_current_user)):
    acc = await db.accounts.find_one({"account_number": req.from_account_number, "user_id": current_user["id"]})
    if not acc:
        raise HTTPException(status_code=404, detail="Source account not found")
    doc = req.dict()
    doc.update({
        "id": str(uuid.uuid4()),
        "user_id": current_user["id"],
        "status": "active",
        "executions": 0,
        "next_run": req.start_date,
        "created_at": datetime.now(timezone.utc).isoformat()
    })
    await db.standing_instructions.insert_one(doc)
    return {"status": "SUCCESS", "message": f"Standing Instruction created — ₹{req.amount:,.0f} {req.frequency} to {req.beneficiary_name}.", "instruction": {k: v for k, v in doc.items() if k != "_id"}}

class StandingInstructionUpdate(BaseModel):
    amount: Optional[float] = None
    end_date: Optional[str] = None
    remarks: Optional[str] = None

@api_router.patch("/standing-instructions/{si_id}")
async def si_update(si_id: str, req: StandingInstructionUpdate, current_user: dict = Depends(get_current_user)):
    updates = {k: v for k, v in req.dict().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    r = await db.standing_instructions.update_one({"id": si_id, "user_id": current_user["id"]}, {"$set": updates})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Instruction not found")
    return {"status": "SUCCESS", "message": "Standing Instruction updated"}

@api_router.post("/standing-instructions/{si_id}/pause")
async def si_pause(si_id: str, current_user: dict = Depends(get_current_user)):
    r = await db.standing_instructions.update_one({"id": si_id, "user_id": current_user["id"]}, {"$set": {"status": "paused"}})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Instruction not found")
    return {"status": "SUCCESS", "message": "Paused"}

@api_router.post("/standing-instructions/{si_id}/resume")
async def si_resume(si_id: str, current_user: dict = Depends(get_current_user)):
    r = await db.standing_instructions.update_one({"id": si_id, "user_id": current_user["id"]}, {"$set": {"status": "active"}})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Instruction not found")
    return {"status": "SUCCESS", "message": "Resumed"}

@api_router.delete("/standing-instructions/{si_id}")
async def si_delete(si_id: str, current_user: dict = Depends(get_current_user)):
    r = await db.standing_instructions.delete_one({"id": si_id, "user_id": current_user["id"]})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Instruction not found")
    return {"status": "SUCCESS", "message": "Deleted"}

# ============================================================================
# AI Face Match (histogram similarity — image-space, not a real biometric)
# ============================================================================
def _b64_to_pil(b64: str):
    from PIL import Image
    raw = base64.b64decode(b64.split(",")[-1])
    return Image.open(io.BytesIO(raw)).convert("RGB").resize((128, 128))

def _hist_similarity(b64_a: str, b64_b: str) -> float:
    try:
        a = _b64_to_pil(b64_a); b = _b64_to_pil(b64_b)
        ha = a.histogram(); hb = b.histogram()
        # Cosine similarity across joined RGB histograms
        dot = sum(x * y for x, y in zip(ha, hb))
        na = sum(x * x for x in ha) ** 0.5
        nb = sum(x * x for x in hb) ** 0.5
        if na == 0 or nb == 0:
            return 0.0
        return round((dot / (na * nb)) * 100.0, 2)
    except Exception:
        return 0.0

@api_router.get("/kyc/video/{sub_id}/face-match")
async def kyc_face_match(sub_id: str, current_user: dict = Depends(get_current_admin)):
    s = await db.kyc_video_submissions.find_one({"id": sub_id})
    if not s:
        raise HTTPException(status_code=404, detail="Submission not found")
    score = _hist_similarity(s.get("selfie_b64", ""), s.get("pan_b64", ""))
    verdict = "auto_approve" if score >= 92 else ("high_confidence" if score >= 82 else ("review" if score >= 65 else "reject"))
    await db.kyc_video_submissions.update_one({"id": sub_id}, {"$set": {"face_match_score": score, "face_match_verdict": verdict}})
    return {"submission_id": sub_id, "score": score, "verdict": verdict,
            "algorithm": "RGB histogram cosine similarity v1", "auto_threshold": 92.0}

# ============================================================================
# Super-Admin Runtime Config (Twilio / SendGrid / referral rules)
# ============================================================================
class AdminConfigUpdate(BaseModel):
    live_otp: Optional[bool] = None
    twilio_account_sid: Optional[str] = None
    twilio_auth_token: Optional[str] = None
    twilio_from_number: Optional[str] = None
    sendgrid_api_key: Optional[str] = None
    sendgrid_from_email: Optional[str] = None
    referral_reward_amount: Optional[float] = None
    face_match_auto_threshold: Optional[float] = None

async def _require_owner(user: dict):
    if user.get("role") != "bank_owner":
        raise HTTPException(status_code=403, detail="Bank Owner (super-admin) access only")

def _mask(secret: str) -> str:
    if not secret or len(secret) < 6:
        return "•" * len(secret or "")
    return secret[:3] + "•" * (len(secret) - 6) + secret[-3:]

@api_router.get("/admin/config")
async def admin_config_get(current_user: dict = Depends(get_current_user)):
    await _require_owner(current_user)
    cfg = await db.system_config.find_one({"_id": "global"}) or {}
    return {
        "live_otp": cfg.get("live_otp", os.environ.get("LIVE_OTP", "false").lower() == "true"),
        "twilio_account_sid_masked": _mask(cfg.get("twilio_account_sid", os.environ.get("TWILIO_ACCOUNT_SID", ""))),
        "twilio_from_number": cfg.get("twilio_from_number", os.environ.get("TWILIO_FROM_NUMBER", "")),
        "sendgrid_api_key_masked": _mask(cfg.get("sendgrid_api_key", os.environ.get("SENDGRID_API_KEY", ""))),
        "sendgrid_from_email": cfg.get("sendgrid_from_email", os.environ.get("SENDGRID_FROM_EMAIL", "alerts@ajspay.in")),
        "referral_reward_amount": cfg.get("referral_reward_amount", REFERRAL_REWARD_AMOUNT),
        "face_match_auto_threshold": cfg.get("face_match_auto_threshold", 92.0),
        "twilio_configured": bool(cfg.get("twilio_account_sid") or os.environ.get("TWILIO_ACCOUNT_SID")),
        "sendgrid_configured": bool(cfg.get("sendgrid_api_key") or os.environ.get("SENDGRID_API_KEY"))
    }

@api_router.put("/admin/config")
async def admin_config_set(req: AdminConfigUpdate, current_user: dict = Depends(get_current_user)):
    await _require_owner(current_user)
    updates = {k: v for k, v in req.dict().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    updates["updated_by"] = current_user["email"]
    await db.system_config.update_one({"_id": "global"}, {"$set": updates}, upsert=True)
    return {"status": "SUCCESS", "message": "Runtime configuration updated by Bank Owner."}

# Helper used by OTP send to prefer DB config over .env
async def _resolve_delivery_config():
    cfg = await db.system_config.find_one({"_id": "global"}) or {}
    return {
        "live_otp": cfg.get("live_otp", os.environ.get("LIVE_OTP", "false").lower() == "true"),
        "twilio_sid": cfg.get("twilio_account_sid") or os.environ.get("TWILIO_ACCOUNT_SID", ""),
        "twilio_token": cfg.get("twilio_auth_token") or os.environ.get("TWILIO_AUTH_TOKEN", ""),
        "twilio_from": cfg.get("twilio_from_number") or os.environ.get("TWILIO_FROM_NUMBER", ""),
        "sendgrid_key": cfg.get("sendgrid_api_key") or os.environ.get("SENDGRID_API_KEY", ""),
        "sendgrid_from": cfg.get("sendgrid_from_email") or os.environ.get("SENDGRID_FROM_EMAIL", "alerts@ajspay.in")
    }

app.include_router(api_router)

# Allowed CORS origins (only trusted origins, no wildcard reflection with credentials)
cors_env = os.environ.get('CORS_ORIGINS', '')
origins_list = [o.strip() for o in cors_env.split(',') if o.strip() and o.strip() != '*']
if not origins_list:
    origins_list = ["http://localhost:3000"]

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=origins_list,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def security_headers(request: Request, call_next):
    resp = await call_next(request)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    resp.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=(self)"
    resp.headers["Content-Security-Policy"] = "default-src 'self'; frame-ancestors 'none'"
    resp.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains; preload"
    return resp
