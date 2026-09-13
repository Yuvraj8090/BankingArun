-- AJSPay: MySQL schema and demo data for Hostinger (MySQL 5.7+ / MariaDB 10.3+).
-- Import once via hPanel -> Databases -> phpMyAdmin -> Import. Safe to re-run.
-- Seeded passwords are bcrypt hashes of the demo logins in INSTALL_HOSTINGER.md;
-- change them after your first login.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    phone VARCHAR(30) NOT NULL,
    role VARCHAR(30) NOT NULL DEFAULT 'retail',
    password_hash VARCHAR(255) NOT NULL,
    transaction_password_hash VARCHAR(255) NOT NULL,
    session_version INT NOT NULL DEFAULT 0,  -- bumped on logout to revoke issued tokens
    -- Authenticator-app 2FA (modules/mfa.php). The secret is encrypted at rest
    -- and the recovery codes are stored only as bcrypt hashes.
    totp_secret VARCHAR(255),
    totp_enabled TINYINT(1) NOT NULL DEFAULT 0,
    totp_backup_codes TEXT,
    totp_enrolled_at DATETIME,
    branch VARCHAR(100),
    pan_number VARCHAR(10),
    aadhaar_number VARCHAR(20),              -- masked (XXXX-XXXX-1234); the full number is never stored
    kyc_status VARCHAR(30) NOT NULL DEFAULT 'pending_approval',
    kyc_reason VARCHAR(255),
    mfa_enabled TINYINT(1) NOT NULL DEFAULT 1,
    is_joint TINYINT(1) NOT NULL DEFAULT 0,
    joint_holder_name VARCHAR(150),
    nominee_name VARCHAR(150),
    nominee_relation VARCHAR(50),
    designation VARCHAR(100),
    referral_code VARCHAR(12) UNIQUE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS accounts (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    account_number VARCHAR(30) NOT NULL UNIQUE,
    ifsc_code VARCHAR(11) NOT NULL DEFAULT 'AJSP0000042',
    account_type VARCHAR(20) NOT NULL DEFAULT 'savings',
    account_name VARCHAR(100) NOT NULL,
    balance DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    currency CHAR(3) NOT NULL DEFAULT 'INR',
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    upi_id VARCHAR(100),
    branch VARCHAR(100),
    is_joint TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_balance_not_negative CHECK (balance >= 0),  -- enforced on MySQL 8.0.16+ / MariaDB 10.2+
    FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS transactions (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    account_number VARCHAR(30) NOT NULL,
    type VARCHAR(10) NOT NULL,           -- credit | debit
    mode VARCHAR(30) NOT NULL,           -- IMPS, NEFT, RTGS, UPI, ACCOUNT_OPENING, CORPORATE_BULK, ...
    amount DECIMAL(15,2) NOT NULL,
    balance_after DECIMAL(15,2) NOT NULL,
    counterparty_name VARCHAR(150),
    counterparty_acc VARCHAR(50),
    ref_number VARCHAR(100) NOT NULL,    -- shared by the debit and credit legs of one transfer
    batch_ref VARCHAR(50),
    status VARCHAR(20) NOT NULL DEFAULT 'SUCCESS',
    description VARCHAR(255),
    timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user_time (user_id, timestamp),
    INDEX idx_account_time (account_number, timestamp),
    INDEX idx_ref (ref_number),
    FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cards (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    account_number VARCHAR(30) NOT NULL,
    card_number VARCHAR(19) NOT NULL,
    card_holder VARCHAR(150) NOT NULL,
    card_type VARCHAR(60) NOT NULL,
    network VARCHAR(20),
    expiry_date VARCHAR(5) NOT NULL,
    cvv VARCHAR(4) NOT NULL,             -- released only via /cards/reveal-cvv (demo only; see INSTALL)
    pin_hash VARCHAR(255) NOT NULL,      -- bcrypt; the PIN itself is never stored or returned
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    is_virtual TINYINT(1) NOT NULL DEFAULT 1,
    issued_by VARCHAR(60),
    online_limit DECIMAL(12,2) NOT NULL DEFAULT 50000.00,
    atm_limit DECIMAL(12,2) NOT NULL DEFAULT 40000.00,
    international_enabled TINYINT(1) NOT NULL DEFAULT 0,
    contactless_enabled TINYINT(1) NOT NULL DEFAULT 1,
    ecom_enabled TINYINT(1) NOT NULL DEFAULT 1,
    upi_linked TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user (user_id),
    FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS deposits (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    deposit_number VARCHAR(30) NOT NULL UNIQUE,
    deposit_type VARCHAR(20) NOT NULL DEFAULT 'fixed',
    source_account VARCHAR(30),
    principal_amount DECIMAL(15,2) NOT NULL,
    interest_rate DECIMAL(5,2) NOT NULL,
    tenure_months INT NOT NULL,
    interest_payout VARCHAR(20),
    maturity_amount DECIMAL(15,2) NOT NULL,
    maturity_date DATE NOT NULL,
    nominee_name VARCHAR(150),
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user (user_id),
    FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS scheduled_payments (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    from_account_number VARCHAR(30) NOT NULL,
    to_account_number VARCHAR(50) NOT NULL,
    beneficiary_name VARCHAR(150) NOT NULL,
    beneficiary_ifsc VARCHAR(11),
    transfer_type VARCHAR(10) NOT NULL,
    amount DECIMAL(15,2) NOT NULL,
    schedule_date DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'SCHEDULED',  -- SCHEDULED | EXECUTED | FAILED
    remarks VARCHAR(255),
    -- Written by cron.php when the payment comes due
    processed_at DATETIME,
    ref_number VARCHAR(50),
    failure_reason VARCHAR(255),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user (user_id),
    INDEX idx_due (status, schedule_date),
    FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS standing_instructions (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    from_account_number VARCHAR(30) NOT NULL,
    beneficiary_name VARCHAR(150) NOT NULL,
    beneficiary_account VARCHAR(50) NOT NULL,
    beneficiary_ifsc VARCHAR(11),
    amount DECIMAL(15,2) NOT NULL,
    frequency VARCHAR(20) NOT NULL DEFAULT 'monthly',
    category VARCHAR(20) NOT NULL DEFAULT 'generic',
    start_date DATE NOT NULL,
    end_date DATE,
    remarks VARCHAR(255),
    status VARCHAR(20) NOT NULL DEFAULT 'active',  -- active | paused | completed
    executions INT NOT NULL DEFAULT 0,
    next_run DATE,
    -- Written by cron.php: last_run stops an instruction being attempted twice
    -- in a day, and failures pauses it after SI_MAX_FAILURES tries in a row.
    last_run DATE,
    last_status VARCHAR(20),
    last_error VARCHAR(255),
    failures INT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user (user_id),
    INDEX idx_due (status, next_run),
    FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cheque_requests (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    account_number VARCHAR(30) NOT NULL,
    leaves INT NOT NULL DEFAULT 25,
    delivery_address VARCHAR(255) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'APPROVED_DISPATCH',
    tracking_id VARCHAR(30),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user (user_id),
    FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS stopped_cheques (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    account_number VARCHAR(30) NOT NULL,
    cheque_number VARCHAR(10) NOT NULL,
    reason VARCHAR(255),
    status VARCHAR(20) NOT NULL DEFAULT 'STOPPED',
    timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user (user_id),
    FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS demand_drafts (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    dd_number VARCHAR(30) NOT NULL,
    account_number VARCHAR(30) NOT NULL,
    beneficiary_name VARCHAR(150) NOT NULL,
    payable_at VARCHAR(100) NOT NULL,
    amount DECIMAL(15,2) NOT NULL,
    fee DECIMAL(10,2) NOT NULL DEFAULT 50.00,
    status VARCHAR(20) NOT NULL DEFAULT 'ISSUED',
    timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user (user_id),
    FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Customer loan applications and the loan department's pipeline share one table,
-- so an application a customer submits actually reaches the loan officer.
CREATE TABLE IF NOT EXISTS loan_applications (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36),
    applicant VARCHAR(150) NOT NULL,
    loan_application_no VARCHAR(30),
    loan_type VARCHAR(50) NOT NULL,
    amount DECIMAL(15,2) NOT NULL,
    tenure_months INT NOT NULL,
    roi DECIMAL(5,2) NOT NULL,
    calculated_emi DECIMAL(15,2),
    monthly_income DECIMAL(15,2),
    employment_type VARCHAR(50),
    purpose VARCHAR(255),
    eligibility_status VARCHAR(30),
    credit_score INT,
    status VARCHAR(30) NOT NULL DEFAULT 'under_review',
    decision_note VARCHAR(255),
    -- Written by the AI module's credit grading (modules/ai.php)
    risk_score INT,
    risk_grade VARCHAR(2),
    risk_reasons TEXT,
    scored_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user (user_id),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS collection_cases (
    id VARCHAR(36) PRIMARY KEY,
    borrower VARCHAR(150) NOT NULL,
    loan_ref VARCHAR(30) NOT NULL,
    outstanding DECIMAL(15,2) NOT NULL,
    dpd_days INT NOT NULL DEFAULT 0,
    last_contact DATE,
    status VARCHAR(30) NOT NULL DEFAULT 'reminder_sent',
    phone VARCHAR(30)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS investments (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    folio_no VARCHAR(30) NOT NULL,
    scheme_id VARCHAR(20) NOT NULL,
    scheme_name VARCHAR(150) NOT NULL,
    investment_type VARCHAR(10) NOT NULL DEFAULT 'SIP',
    invested_amount DECIMAL(15,2) NOT NULL,
    current_value DECIMAL(15,2) NOT NULL,
    units DECIMAL(15,3) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user (user_id),
    FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS insurance_policies (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    plan_id VARCHAR(20) NOT NULL,
    plan_name VARCHAR(150) NOT NULL,
    sum_assured DECIMAL(15,2) NOT NULL,
    annual_premium DECIMAL(12,2) NOT NULL,
    nominee_name VARCHAR(150),
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user (user_id),
    FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS support_tickets (
    id VARCHAR(36) PRIMARY KEY,
    ticket_id VARCHAR(40) NOT NULL UNIQUE,
    user_id VARCHAR(36) NOT NULL,
    user_email VARCHAR(150),
    user_name VARCHAR(150),
    category VARCHAR(50),
    account_number VARCHAR(30),
    subject VARCHAR(200) NOT NULL,
    description TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    priority VARCHAR(10) NOT NULL DEFAULT 'MEDIUM',
    assigned_to VARCHAR(100),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user (user_id),
    INDEX idx_status (status),
    FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS referrals (
    id VARCHAR(36) PRIMARY KEY,
    referrer_id VARCHAR(36) NOT NULL,
    referrer_email VARCHAR(150),
    referee_id VARCHAR(36) NOT NULL,
    referee_name VARCHAR(150),
    referee_email VARCHAR(150),
    code VARCHAR(12) NOT NULL,
    credit_amount DECIMAL(12,2) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'paid',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_referrer (referrer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS otps (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    purpose VARCHAR(20) NOT NULL,
    otp_hash VARCHAR(64) NOT NULL,       -- HMAC-SHA256; the code itself is never stored
    channel VARCHAR(10) NOT NULL DEFAULT 'sms',
    attempts INT NOT NULL DEFAULT 0,
    verified TINYINT(1) NOT NULL DEFAULT 0,
    expires_at DATETIME NOT NULL,
    verified_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user_purpose (user_id, purpose, verified),
    FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS passkeys (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    credential_id VARCHAR(255) NOT NULL UNIQUE,
    public_key TEXT NOT NULL,            -- PEM public key; no private material exists server-side
    sign_count INT UNSIGNED NOT NULL DEFAULT 0,
    label VARCHAR(100),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user (user_id),
    FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS passkey_challenges (
    user_id VARCHAR(36) NOT NULL,
    type VARCHAR(10) NOT NULL,           -- register | login
    challenge VARCHAR(100) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS kyc_video_submissions (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    user_email VARCHAR(150),
    user_name VARCHAR(150),
    selfie_b64 MEDIUMTEXT,
    pan_b64 MEDIUMTEXT,
    aadhaar_b64 MEDIUMTEXT,
    liveness_words VARCHAR(255),
    device_info VARCHAR(255),
    status VARCHAR(20) NOT NULL DEFAULT 'pending_review',
    face_match_score DECIMAL(5,2),
    face_match_verdict VARCHAR(30),
    face_match_algo VARCHAR(30),
    reviewer VARCHAR(150),
    review_reason VARCHAR(255),
    reviewed_at DATETIME,
    submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_status (status, submitted_at),
    FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS branches (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    bank VARCHAR(50) NOT NULL DEFAULT 'AJSPay',
    code VARCHAR(11) NOT NULL,
    address VARCHAR(255),
    lat DECIMAL(9,6),
    lng DECIMAL(9,6),
    phone VARCHAR(30),
    has_atm TINYINT(1) NOT NULL DEFAULT 1,
    has_cdm TINYINT(1) NOT NULL DEFAULT 1,
    has_locker TINYINT(1) NOT NULL DEFAULT 0,
    timing VARCHAR(50)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36),
    email VARCHAR(150),
    action VARCHAR(50) NOT NULL,
    details VARCHAR(255),
    ip VARCHAR(45),
    timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user_time (user_id, timestamp),
    INDEX idx_action (action, timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS login_attempts (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    identifier VARCHAR(191) NOT NULL,    -- "ip:email" for logins, "txn:<user id>" / "otp-send:<user id>" for the rest
    email VARCHAR(150) NOT NULL,
    ip VARCHAR(45) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_identifier_time (identifier, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Runtime settings the bank owner edits from the System Config screen.
-- API keys inside `data` are encrypted with the app's token_secret.
CREATE TABLE IF NOT EXISTS system_config (
    id VARCHAR(20) PRIMARY KEY,
    data TEXT NOT NULL,
    updated_by VARCHAR(150),
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Demo data
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO users (id, name, email, phone, role, password_hash, transaction_password_hash, branch,
    pan_number, aadhaar_number, kyc_status, nominee_name, nominee_relation, designation) VALUES
('admin-001', 'Arunabh Mukherjee (Chief Branch Manager)', 'manager@ajspay.in', '+91 98200 11223', 'admin',
    '$2y$12$YXpjz3gFdBrFEPACAsET5uiB6WyHiGC1r9faIb3HqHtuytRf.n4C6', '$2y$12$TGThlkTmnavrduZJwhiaK.OKhXTHviukz4dOxL..5y1yBCMIg6XAW', 'AJSP-MUM-042 (Nariman Point Main)', NULL, NULL, 'verified', NULL, NULL, NULL),
('retail-001', 'Rahul Sharma', 'rahul.sharma@example.com', '+91 98190 44556', 'retail',
    '$2y$12$EMUVzbIf/5UtZ6ZGPnyt3uH7/xo695THAdt083HckwaFPVMBYCcvK', '$2y$12$dGxxIwxAuCgmpd1Jwm7UwO81y45Yorz.y81NLxi4M.6NxooOc8Hhe', 'AJSP-MUM-042 (Nariman Point Main)', 'ABCPS8492K', 'XXXX-XXXX-4892',
    'verified', 'Pooja Sharma', 'Spouse', NULL),
('corp-001', 'Tata Digital Solutions Ltd', 'tata.corp@example.com', '+91 99200 88990', 'corporate',
    '$2y$12$cGasZ2C2GCbs6WvbCZfL4eUOOQyLW8R/DhtqoBF2ViG8/XcKfZEye', '$2y$12$epayulb7RlMfQZc1UqmUsu81ViBgaShCFflQxO141oZxddckOS.ae', 'AJSP-BKC-001 (Bandra Kurla Complex)', 'AAACT8921M', NULL, 'verified',
    NULL, NULL, NULL),
('owner-001', 'Vikram Kothari (Bank Owner)', 'owner@ajspay.in', '+91 98100 00001', 'bank_owner',
    '$2y$12$0y/pWTMc0R/Vu/pXX81Fg.Psqaxj1odUhLokTGpTvmhjqiOS8RDUm', '$2y$12$dGxxIwxAuCgmpd1Jwm7UwO81y45Yorz.y81NLxi4M.6NxooOc8Hhe', 'Head Office - Nariman Point', NULL, NULL, 'verified', NULL, NULL,
    'Managing Director & CEO'),
('staff-001', 'Meera Iyer (Customer Service Officer)', 'meera.staff@ajspay.in', '+91 98200 33445', 'staff',
    '$2y$12$rB5/vuQL/.ol7tGRDGGP9OAI3IxclauDLrkhGXfs6cM2n/CwCSR52', '$2y$12$dGxxIwxAuCgmpd1Jwm7UwO81y45Yorz.y81NLxi4M.6NxooOc8Hhe', 'AJSP-MUM-042 (Nariman Point Main)', NULL, NULL, 'verified', NULL, NULL,
    'Front Desk / Teller'),
('collect-001', 'Rajesh Nair (Collection Agent)', 'collections@ajspay.in', '+91 98200 55667', 'collection_agent',
    '$2y$12$gAFhKO/NkEMb7NYkwmhRKu.0X1hvsGkPlmguD5UlFBvzWjXUKljs2', '$2y$12$dGxxIwxAuCgmpd1Jwm7UwO81y45Yorz.y81NLxi4M.6NxooOc8Hhe', 'Recovery Cell - Mumbai Zone', NULL, NULL, 'verified', NULL, NULL,
    'Recovery Officer'),
('loan-001', 'Aditi Verma (Loan Officer)', 'loans@ajspay.in', '+91 98200 77889', 'loan_officer',
    '$2y$12$NXAyWfu85w5KwFQ3MlVBfe0Cia5yFhEeMf5/vWkMpjJ4vMSpA88Uy', '$2y$12$dGxxIwxAuCgmpd1Jwm7UwO81y45Yorz.y81NLxi4M.6NxooOc8Hhe', 'AJSP-MUM-042 (Nariman Point Main)', NULL, NULL, 'verified', NULL, NULL,
    'Credit Underwriter');

INSERT IGNORE INTO accounts (id, user_id, account_number, ifsc_code, account_type, account_name, balance, upi_id,
    branch, created_at) VALUES
('acc-retail-001', 'retail-001', 'AJSP00984521098', 'AJSP0000042', 'savings', 'Premium Salary Savings', 145850.00,
    'rahulsharma@ajspay', 'Nariman Point, Mumbai', UTC_TIMESTAMP() - INTERVAL 30 DAY),
('acc-corp-001', 'corp-001', 'AJSP00129845612', 'AJSP0000001', 'current', 'Corporate Operating Account', 1285000.00,
    'tatadigital@ajspay', 'Bandra Kurla Complex, Mumbai', UTC_TIMESTAMP() - INTERVAL 30 DAY);

INSERT IGNORE INTO deposits (id, user_id, deposit_number, deposit_type, principal_amount, interest_rate, tenure_months,
    maturity_amount, maturity_date) VALUES
('fd-retail-001', 'retail-001', 'FD88492019', 'fixed', 250000.00, 7.25, 24, 288625.00,
    DATE_ADD(UTC_DATE(), INTERVAL 730 DAY));

INSERT IGNORE INTO cards (id, user_id, account_number, card_number, card_holder, card_type, network, expiry_date, cvv,
    pin_hash, status, is_virtual, issued_by, online_limit, atm_limit, international_enabled, contactless_enabled,
    ecom_enabled, upi_linked, created_at) VALUES
('card-visa-001', 'retail-001', 'AJSP00984521098', '4532 9845 2109 8821', 'RAHUL SHARMA', 'Visa Platinum Debit', 'Visa',
    '08/29', '418', '$2y$12$gzTa0eudv73cta0BIq4rpOGK2r2UVg7joErtmeBm28tyVXlHyw.eu', 'active', 1, 'AJSPay (Issuer Only)', 100000.00, 50000.00, 1, 1, 1, 0,
    UTC_TIMESTAMP() - INTERVAL 30 DAY),
('card-rupay-001', 'retail-001', 'AJSP00984521098', '5241 7373 2160 2721', 'RAHUL SHARMA',
    'RuPay / Mastercard Global Debit', 'RuPay', '06/31', '902', '$2y$12$gzTa0eudv73cta0BIq4rpOGK2r2UVg7joErtmeBm28tyVXlHyw.eu', 'dispatch_queued', 0,
    'AJSPay (Issuer Only)', 75000.00, 40000.00, 0, 1, 1, 0, UTC_TIMESTAMP() - INTERVAL 30 DAY + INTERVAL 1 SECOND),
('card-rupay-002', 'retail-001', 'AJSP00984521098', '5241 9548 3082 4607', 'RAHUL SHARMA',
    'RuPay / Mastercard Global Debit', 'Mastercard', '06/31', '561', '$2y$12$gzTa0eudv73cta0BIq4rpOGK2r2UVg7joErtmeBm28tyVXlHyw.eu', 'dispatch_queued', 0,
    'AJSPay (Issuer Only)', 75000.00, 40000.00, 1, 1, 1, 0, UTC_TIMESTAMP() - INTERVAL 30 DAY + INTERVAL 2 SECOND);

INSERT IGNORE INTO transactions (id, user_id, account_number, type, mode, amount, balance_after, counterparty_name,
    counterparty_acc, ref_number, description, timestamp) VALUES
('txn-seed-001', 'retail-001', 'AJSP00984521098', 'credit', 'NEFT', 95000.00, 145850.00, 'Infosys Ltd Salary Payout',
    'INFSYS99281', 'UTR-NEFT-20260601-8932', 'Monthly Net Salary Credited', UTC_TIMESTAMP() - INTERVAL 2 DAY),
('txn-seed-002', 'retail-001', 'AJSP00984521098', 'debit', 'UPI', 2450.00, 50850.00, 'Amazon India Payments',
    'amazonpay@ajspay', 'UPI-6192837491', 'Electronics Purchase Order #9812', UTC_TIMESTAMP() - INTERVAL 4 DAY),
('txn-seed-003', 'retail-001', 'AJSP00984521098', 'debit', 'IMPS', 15000.00, 53300.00, 'Ananya Sharma',
    'AJSP000492109', 'IMPS-9921849102', 'Family Maintenance', UTC_TIMESTAMP() - INTERVAL 7 DAY);

INSERT IGNORE INTO branches (id, name, bank, code, address, lat, lng, phone, has_atm, has_cdm, has_locker, timing) VALUES
('b1', 'Nariman Point Main Branch', 'AJSPay', 'AJSP0000042', 'Air India Building, Nariman Point, Mumbai 400021',
    18.928100, 72.822800, '022-22024100', 1, 1, 1, '10:00 AM - 4:00 PM'),
('b2', 'Bandra Kurla Complex Branch', 'AJSPay', 'AJSP0000001', 'G Block, BKC, Bandra East, Mumbai 400051',
    19.066200, 72.868800, '022-66521000', 1, 1, 1, '9:30 AM - 4:30 PM'),
('b3', 'Connaught Place Flagship', 'AJSPay', 'AJSP0000007', '9A, Inner Circle, Connaught Place, New Delhi 110001',
    28.631500, 77.216700, '011-41512000', 1, 1, 1, '9:30 AM - 5:00 PM'),
('b4', 'Koramangala 80 Feet Road', 'AJSPay', 'AJSP0004081', '80 Feet Road, 4th Block, Koramangala, Bengaluru 560034',
    12.935200, 77.624500, '080-25539800', 1, 0, 1, '10:00 AM - 4:00 PM'),
('b5', 'Hitech City Madhapur', 'AJSPay', 'AJSP0001928', 'Cyber Towers, Hitech City, Hyderabad 500081',
    17.450400, 78.380800, '040-67891200', 1, 1, 0, '9:30 AM - 4:30 PM');

INSERT IGNORE INTO loan_applications (id, user_id, applicant, loan_type, amount, tenure_months, roi, credit_score, status) VALUES
('app-001', 'retail-001', 'Rahul Sharma', 'Personal', 500000.00, 36, 10.50, 782, 'under_review'),
('app-002', 'corp-001', 'Tata Digital Solutions Ltd', 'Working Capital', 2500000.00, 60, 9.25, 810, 'approved'),
('app-003', NULL, 'Anjali Kapoor', 'Home', 3500000.00, 240, 8.40, 745, 'documentation'),
('app-004', NULL, 'Kabir Malhotra', 'Vehicle', 850000.00, 60, 8.75, 720, 'disbursed');

INSERT IGNORE INTO collection_cases (id, borrower, loan_ref, outstanding, dpd_days, last_contact, status, phone) VALUES
('col-001', 'Prakash Yadav', 'PL-99281', 148500.00, 45, '2026-01-25', 'npa_risk', '+91 98111 22334'),
('col-002', 'Sunita Deshmukh', 'HL-33112', 892000.00, 15, '2026-02-05', 'follow_up', '+91 98222 55667'),
('col-003', 'Kavita Rao', 'VL-77401', 45250.00, 90, '2026-01-10', 'legal_notice', '+91 98333 88991'),
('col-004', 'Amit Sinha', 'PL-88203', 22500.00, 5, '2026-02-12', 'reminder_sent', '+91 98444 12345');

-- ---------------------------------------------------------------------------
-- AI module: fraud/AML alerts and the security event log
-- ---------------------------------------------------------------------------
-- One row per transfer that scored above the alert floor. `reasons` holds the
-- signals that produced the score, so every alert can be explained to a
-- reviewer rather than being an opaque number.
CREATE TABLE IF NOT EXISTS fraud_alerts (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36),
    account_number VARCHAR(30),
    ref_number VARCHAR(50),
    amount DECIMAL(15,2) NOT NULL,
    counterparty_acc VARCHAR(50),
    counterparty_name VARCHAR(150),
    score INT NOT NULL,
    severity VARCHAR(10) NOT NULL,                  -- low | medium | high
    reasons TEXT NOT NULL,                          -- JSON: [{code, label, weight}]
    status VARCHAR(20) NOT NULL DEFAULT 'open',     -- open | cleared | escalated
    reviewed_by VARCHAR(36),
    review_note VARCHAR(255),
    reviewed_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_status_score (status, score),
    INDEX idx_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS security_events (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    event_type VARCHAR(40) NOT NULL,
    severity VARCHAR(10) NOT NULL DEFAULT 'info',   -- info | warning | critical
    user_id VARCHAR(36),
    email VARCHAR(150),
    ip VARCHAR(45),
    route VARCHAR(120),
    details VARCHAR(255),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_severity_time (severity, created_at),
    INDEX idx_type_time (event_type, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Scheme master and field agents (back office only; never shown publicly)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schemes (
    id VARCHAR(36) PRIMARY KEY,
    code VARCHAR(20) NOT NULL UNIQUE,
    name VARCHAR(120) NOT NULL,
    scheme_type VARCHAR(10) NOT NULL DEFAULT 'recurring',  -- daily | recurring | fixed | mis
    tenure_months INT NOT NULL,
    contribution_amount DECIMAL(15,2),                     -- per day or per month, for instalment plans
    principal_amount DECIMAL(15,2),                        -- lump sum, for FD / MIS
    total_deposit DECIMAL(15,2) NOT NULL,
    maturity_amount DECIMAL(15,2) NOT NULL,
    payout_type VARCHAR(10) NOT NULL DEFAULT 'maturity',   -- maturity | monthly
    status VARCHAR(10) NOT NULL DEFAULT 'draft',           -- active | draft | inactive
    notes VARCHAR(255),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_type_status (scheme_type, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agents (
    id VARCHAR(36) PRIMARY KEY,
    code VARCHAR(20) NOT NULL UNIQUE,
    name VARCHAR(150) NOT NULL,
    phone VARCHAR(30) NOT NULL,
    branch VARCHAR(100),
    status VARCHAR(10) NOT NULL DEFAULT 'active',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- What an agent collected in the field. Records only: no commission is calculated
-- or paid, because the Nidhi Rules bar incentives for mobilising deposits.
CREATE TABLE IF NOT EXISTS agent_collections (
    id VARCHAR(36) PRIMARY KEY,
    agent_id VARCHAR(36) NOT NULL,
    member_user_id VARCHAR(36),
    account_number VARCHAR(30) NOT NULL,
    scheme_id VARCHAR(36),
    amount DECIMAL(15,2) NOT NULL,
    collected_on DATE NOT NULL,
    receipt_no VARCHAR(30),
    notes VARCHAR(255),
    recorded_by VARCHAR(36),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_agent_date (agent_id, collected_on),
    FOREIGN KEY (agent_id) REFERENCES agents(id),
    FOREIGN KEY (scheme_id) REFERENCES schemes(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Plans from the printed plan book. Those whose implied return exceeds the
-- 12.5% Nidhi Rules cap are loaded as drafts and cannot be activated.
INSERT IGNORE INTO schemes (id, code, name, scheme_type, tenure_months, contribution_amount, principal_amount,
    total_deposit, maturity_amount, payout_type, status, notes) VALUES
('sch-rd-1y', 'AJS-RD-1Y', 'Masik Yojana 1 Year', 'recurring', 12, 500.00, NULL, 6000.00, 6360.00, 'maturity', 'active', 'Plan book: 1 year, stated 6.5%'),
('sch-rd-2y', 'AJS-RD-2Y', 'Masik Yojana 2 Year', 'recurring', 24, 500.00, NULL, 12000.00, 12960.00, 'maturity', 'active', 'Plan book: 2 year, stated 8.5%'),
('sch-rd-3y', 'AJS-RD-3Y', 'Masik Yojana 3 Year', 'recurring', 36, 500.00, NULL, 18000.00, 21975.00, 'maturity', 'draft', 'Plan book says 10.5% but the maturity figure works out to ~13.4% — above the cap, review before activating'),
('sch-rd-5y', 'AJS-RD-5Y', 'Masik Yojana 5 Year', 'recurring', 60, 500.00, NULL, 30000.00, 39150.00, 'maturity', 'draft', 'Plan book: 5 year, stated 12.5% — check against the cap before activating'),
('sch-rd-6y', 'AJS-RD-6Y', 'Masik Yojana 6 Year', 'recurring', 72, 500.00, NULL, 36000.00, 52500.00, 'maturity', 'draft', 'Plan book: 6 year, stated 14.5% — above the Nidhi cap'),
('sch-dd-3y', 'AJS-DD-3Y', 'Daily Yojana 3 Year', 'daily', 36, 100.00, NULL, 108000.00, 125900.00, 'maturity', 'draft', 'Plan book: daily ₹100 for 3 years'),
('sch-dd-5y', 'AJS-DD-5Y', 'Daily Yojana 5 Year', 'daily', 60, 50.00, NULL, 90000.00, 117900.00, 'maturity', 'draft', 'Plan book: daily ₹50 for 5 years'),
('sch-fd-8y', 'AJS-FD-8Y', 'Savadhi Yojana (3x in 8 years)', 'fixed', 96, NULL, 2500.00, 2500.00, 7500.00, 'maturity', 'draft', 'Plan book: 3x in 8 years — well above the Nidhi cap'),
('sch-mis-5y', 'AJS-MIS-5Y', 'Niyamit Aay 60 Month MIS', 'mis', 60, NULL, 10000.00, 10000.00, 15000.00, 'monthly', 'draft', 'Plan book: ₹10,000 unit, ₹250 monthly payout');
