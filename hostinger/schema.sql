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
    -- First-run tour (modules/tutorial.php). Progress lives on the server so a
    -- member who gives up halfway resumes on their next device, not from the top.
    tutorial_status VARCHAR(15) NOT NULL DEFAULT 'pending',  -- pending | in_progress | completed | skipped
    tutorial_step INT NOT NULL DEFAULT 0,
    tutorial_updated_at DATETIME,
    first_login_at DATETIME,
    last_security_review DATETIME,
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
    -- timestamp only resolves to the second and several payments legitimately
    -- land in the same one, so statements sort by timestamp first and this to
    -- break the tie. Without it a member could see a maturity credited above the
    -- interest that preceded it, and a running balance that jumped backwards.
    seq BIGINT NOT NULL AUTO_INCREMENT UNIQUE,
    INDEX idx_user_time (user_id, timestamp),
    INDEX idx_account_time (account_number, timestamp),
    INDEX idx_ref (ref_number),
    FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Every instruction this institution gave its payment partner, and what came
-- back. A Nidhi is not an NPCI member, so money only moves through a regulated
-- partner; this table is the bridge between our ledger and theirs. A payout is
-- PENDING here until the partner confirms it, which is what stops the ledger
-- claiming money left when it did not.
CREATE TABLE IF NOT EXISTS rail_transactions (
    id VARCHAR(36) PRIMARY KEY,
    direction VARCHAR(10) NOT NULL,          -- payout | collect
    rail VARCHAR(10) NOT NULL,               -- IMPS | NEFT | RTGS | UPI
    driver VARCHAR(20) NOT NULL,             -- simulator | partner
    user_id VARCHAR(36),
    account_number VARCHAR(30),
    amount DECIMAL(15,2) NOT NULL,
    counterparty_name VARCHAR(150),
    counterparty_acc VARCHAR(50),
    counterparty_ifsc VARCHAR(11),
    counterparty_vpa VARCHAR(100),
    ref_number VARCHAR(100) NOT NULL,        -- ours; matches transactions.ref_number
    idempotency_key VARCHAR(64) NOT NULL,    -- retrying the same key must never pay twice
    partner_ref VARCHAR(100),                -- theirs
    utr VARCHAR(50),                         -- the real UTR, once there is one
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    failure_reason VARCHAR(255),
    request_payload TEXT,
    last_event TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_rail_idempotency (idempotency_key),
    INDEX idx_rail_status (status, created_at),
    INDEX idx_rail_partner (partner_ref),
    INDEX idx_rail_ref (ref_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Webhook de-duplication. Partners retry a callback until they get a 2xx, so the
-- same event arrives many times; the event id being the primary key is what makes
-- processing it twice impossible.
CREATE TABLE IF NOT EXISTS rail_events (
    id VARCHAR(100) PRIMARY KEY,
    payload TEXT NOT NULL,
    received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
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
    scheme_code VARCHAR(20),                      -- the published plan it was booked under
    source_account VARCHAR(30),
    principal_amount DECIMAL(15,2) NOT NULL,
    interest_rate DECIMAL(5,2) NOT NULL,
    tenure_months INT NOT NULL,
    interest_payout VARCHAR(20),
    maturity_amount DECIMAL(15,2) NOT NULL,
    maturity_date DATE NOT NULL,
    nominee_name VARCHAR(150),
    status VARCHAR(20) NOT NULL DEFAULT 'active',  -- active | matured | closed
    -- Written by cron.php when interest is paid or the deposit matures.
    interest_paid DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    last_payout_date DATE,
    matured_on DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user (user_id),
    INDEX idx_maturity (status, maturity_date),
    INDEX idx_deposit_scheme (scheme_code, status),
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
    -- Support desk workflow (modules/support.php)
    assigned_user_id VARCHAR(36),
    due_at DATETIME,                       -- SLA deadline, set from priority
    first_response_at DATETIME,
    resolved_at DATETIME,
    last_message_at DATETIME,
    unread_for_member INT NOT NULL DEFAULT 0,
    unread_for_staff INT NOT NULL DEFAULT 1,
    resolution_note VARCHAR(500),
    -- Grievance escalation (modules/support.php). A ticket the member is not
    -- satisfied with goes to the named officer with its own 30-day clock.
    grievance_status VARCHAR(10),          -- open | resolved | rejected
    grievance_ground VARCHAR(20),
    grievance_detail VARCHAR(1000),
    escalated_by VARCHAR(36),
    escalated_at DATETIME,
    grievance_due_by DATETIME,
    grievance_outcome VARCHAR(1000),
    grievance_handled_by VARCHAR(36),
    grievance_handled_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user (user_id),
    INDEX idx_status (status),
    INDEX idx_grievance (grievance_status, grievance_due_by),
    FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One turn in a support conversation. `author_role` is 'member' or 'staff';
-- an internal note is visible to staff only and never returned to the member.
CREATE TABLE IF NOT EXISTS ticket_messages (
    id VARCHAR(36) PRIMARY KEY,
    ticket_id VARCHAR(36) NOT NULL,
    author_user_id VARCHAR(36),
    author_name VARCHAR(150),
    author_role VARCHAR(10) NOT NULL,      -- member | staff
    body TEXT NOT NULL,
    internal TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_ticket_time (ticket_id, created_at),
    FOREIGN KEY (ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE
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

-- Business rates and fees the bank owner manages from the Business Parameters
-- screen (modules/parameters.php) -- a real, listable, searchable table rather
-- than another key inside system_config's JSON blob. Every business-facing
-- number that was previously a PHP constant (loan rates, self-service deposit
-- rates, the DD fee, the card limit ceiling) now has a row here; the old
-- constants remain in code only as the fallback a deleted row reverts to.
CREATE TABLE IF NOT EXISTS system_parameters (
    id VARCHAR(36) PRIMARY KEY,
    param_key VARCHAR(60) NOT NULL UNIQUE,
    label VARCHAR(150) NOT NULL,
    category VARCHAR(40) NOT NULL,
    value DECIMAL(15,4) NOT NULL,
    unit VARCHAR(20) NOT NULL DEFAULT '',
    min_value DECIMAL(15,4) DEFAULT NULL,
    max_value DECIMAL(15,4) DEFAULT NULL,
    description VARCHAR(255) DEFAULT NULL,
    updated_by VARCHAR(150) DEFAULT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_param_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO system_parameters
    (id, param_key, label, category, value, unit, min_value, max_value, description) VALUES
('param-loan-personal', 'loan_rate_personal', 'Personal loan rate', 'loan_rates', 10.50, '% p.a.', 0, 36,
    'Rate quoted on a personal loan application.'),
('param-loan-home', 'loan_rate_home', 'Home loan rate', 'loan_rates', 8.40, '% p.a.', 0, 36,
    'Rate quoted on a home loan application.'),
('param-loan-vehicle', 'loan_rate_vehicle', 'Vehicle loan rate', 'loan_rates', 8.75, '% p.a.', 0, 36,
    'Rate quoted on a vehicle loan application.'),
('param-loan-gold', 'loan_rate_gold', 'Gold loan rate', 'loan_rates', 7.90, '% p.a.', 0, 36,
    'Rate quoted on a gold loan application.'),
('param-dep-under-1y', 'deposit_rate_under_1y', 'Deposit rate, under 1 year', 'deposit_rates', 6.50, '% p.a.', 0, 12.5,
    'Self-service fixed/recurring deposit, tenure under 12 months. Capped at the 12.5% Nidhi Rules ceiling regardless of the value entered here.'),
('param-dep-1-2y', 'deposit_rate_1y_to_2y', 'Deposit rate, 1-2 years', 'deposit_rates', 7.25, '% p.a.', 0, 12.5,
    'Self-service fixed/recurring deposit, tenure 12-24 months. Capped at the 12.5% Nidhi Rules ceiling regardless of the value entered here.'),
('param-dep-2-3y', 'deposit_rate_2y_to_3y', 'Deposit rate, 2-3 years', 'deposit_rates', 7.50, '% p.a.', 0, 12.5,
    'Self-service fixed/recurring deposit, tenure 25-36 months. Capped at the 12.5% Nidhi Rules ceiling regardless of the value entered here.'),
('param-dep-over-3y', 'deposit_rate_over_3y', 'Deposit rate, over 3 years', 'deposit_rates', 7.10, '% p.a.', 0, 12.5,
    'Self-service fixed/recurring deposit, tenure over 36 months. Capped at the 12.5% Nidhi Rules ceiling regardless of the value entered here.'),
('param-referral-reward', 'referral_reward_amount', 'Refer & Earn reward', 'program', 500.00, '₹', 0, 10000,
    'Paid to both the referrer and the new member when an account opens via a referral code.'),
('param-face-threshold', 'face_match_auto_threshold', 'Face-match auto-approval threshold', 'program', 92.00, '%', 50, 100,
    'Video KYC face-match score at or above which a review is auto-approved.'),
('param-dd-fee', 'demand_draft_fee', 'Demand draft issuing fee', 'fees', 50.00, '₹', 0, 1000,
    'Flat fee charged in addition to the draft amount when a demand draft is issued.'),
('param-card-limit-max', 'card_limit_max', 'Card limit ceiling', 'limits', 1000000.00, '₹', 0, 10000000,
    'The highest online/ATM limit a member can set on a debit card.');

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

INSERT IGNORE INTO cards (id, user_id, account_number, card_number, card_holder, card_type, network, expiry_date,
    pin_hash, status, is_virtual, issued_by, online_limit, atm_limit, international_enabled, contactless_enabled,
    ecom_enabled, upi_linked, created_at) VALUES
('card-visa-001', 'retail-001', 'AJSP00984521098', '4532 9845 2109 8821', 'RAHUL SHARMA', 'Visa Platinum Debit', 'Visa',
    '08/29', '$2y$12$gzTa0eudv73cta0BIq4rpOGK2r2UVg7joErtmeBm28tyVXlHyw.eu', 'active', 1, 'AJSPay (Issuer Only)', 100000.00, 50000.00, 1, 1, 1, 0,
    UTC_TIMESTAMP() - INTERVAL 30 DAY),
('card-rupay-001', 'retail-001', 'AJSP00984521098', '5241 7373 2160 2721', 'RAHUL SHARMA',
    'RuPay / Mastercard Global Debit', 'RuPay', '06/31', '$2y$12$gzTa0eudv73cta0BIq4rpOGK2r2UVg7joErtmeBm28tyVXlHyw.eu', 'dispatch_queued', 0,
    'AJSPay (Issuer Only)', 75000.00, 40000.00, 0, 1, 1, 0, UTC_TIMESTAMP() - INTERVAL 30 DAY + INTERVAL 1 SECOND),
('card-rupay-002', 'retail-001', 'AJSP00984521098', '5241 9548 3082 4607', 'RAHUL SHARMA',
    'RuPay / Mastercard Global Debit', 'Mastercard', '06/31', '$2y$12$gzTa0eudv73cta0BIq4rpOGK2r2UVg7joErtmeBm28tyVXlHyw.eu', 'dispatch_queued', 0,
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
-- CRM: what we know about a member beyond their balances
-- ---------------------------------------------------------------------------
-- Every call, visit or message logged against a member, so the next person to
-- pick up the phone can see what was already said.
CREATE TABLE IF NOT EXISTS crm_interactions (
    id VARCHAR(36) PRIMARY KEY,
    member_user_id VARCHAR(36),
    lead_id VARCHAR(36),                    -- set instead when this is a prospect
    channel VARCHAR(20) NOT NULL,           -- call | visit | email | sms | whatsapp | note
    direction VARCHAR(10) NOT NULL DEFAULT 'outbound',
    subject VARCHAR(200) NOT NULL,
    notes TEXT,
    outcome VARCHAR(30),                    -- reached | no_answer | callback | resolved | escalated
    follow_up_on DATE,
    recorded_by VARCHAR(36) NOT NULL,
    recorded_by_name VARCHAR(150),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_member_time (member_user_id, created_at),
    INDEX idx_lead_time (lead_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Someone who is not a member yet. A Nidhi may only deal with members, so this
-- is the pipeline that ends at enrolment, not at a sale.
CREATE TABLE IF NOT EXISTS crm_leads (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    phone VARCHAR(30) NOT NULL,
    email VARCHAR(150),
    source VARCHAR(30),                     -- walk_in | referral | agent | campaign | phone
    interest VARCHAR(30),                   -- savings | deposit | loan | other
    scheme_code VARCHAR(20),                -- the published plan they asked about, where they named one
    stage VARCHAR(20) NOT NULL DEFAULT 'new',  -- new | contacted | documents | enrolled | lost
    assigned_to VARCHAR(36),
    agent_id VARCHAR(36),                   -- introducing agent, where there is one
    converted_user_id VARCHAR(36),          -- set when they become a member
    lost_reason VARCHAR(255),
    notes VARCHAR(500),
    created_by VARCHAR(36),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_stage (stage, created_at),
    INDEX idx_assigned (assigned_to)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A thing somebody has to do, about a member or a lead, by a date.
CREATE TABLE IF NOT EXISTS crm_tasks (
    id VARCHAR(36) PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    details VARCHAR(500),
    member_user_id VARCHAR(36),
    lead_id VARCHAR(36),
    assigned_to VARCHAR(36) NOT NULL,
    due_on DATE NOT NULL,
    priority VARCHAR(10) NOT NULL DEFAULT 'MEDIUM',
    status VARCHAR(15) NOT NULL DEFAULT 'open',   -- open | done | cancelled
    completed_at DATETIME,
    completion_note VARCHAR(500),
    created_by VARCHAR(36),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_assigned_due (assigned_to, status, due_on),
    INDEX idx_member (member_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Digital Personal Data Protection Act, 2023
-- ---------------------------------------------------------------------------
-- Section 5 requires an itemised notice and consent for each purpose, and
-- section 6(6) requires withdrawal to be as easy as giving it. One row per
-- purpose per person, superseded rather than overwritten, so the history of
-- what somebody agreed to and when is intact.
CREATE TABLE IF NOT EXISTS consents (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    purpose VARCHAR(40) NOT NULL,
    notice_version VARCHAR(10) NOT NULL,
    granted TINYINT(1) NOT NULL,
    ip VARCHAR(45),
    recorded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user_purpose (user_id, purpose, recorded_at),
    FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Sections 11-13: the rights to access, correct and erase, and to be told what
-- happened to the request.
CREATE TABLE IF NOT EXISTS data_requests (
    id VARCHAR(36) PRIMARY KEY,
    reference VARCHAR(20) NOT NULL UNIQUE,
    user_id VARCHAR(36) NOT NULL,
    kind VARCHAR(12) NOT NULL,                 -- access | correction | erasure
    detail VARCHAR(1000),
    status VARCHAR(12) NOT NULL DEFAULT 'open',  -- open | actioned | refused
    response VARCHAR(1000),
    due_by DATE NOT NULL,
    handled_by VARCHAR(36),
    handled_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_status_due (status, due_by),
    FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Statutory member register and AML screening
-- ---------------------------------------------------------------------------
-- Rule 11 of the Nidhi Rules, 2014: a Nidhi may only deal with its members, and
-- every depositor must be allotted at least ten equity shares of ten rupees.
-- This register is the evidence of that, and the reason deposits can be refused
-- to a non-member.
CREATE TABLE IF NOT EXISTS member_register (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL UNIQUE,
    folio_no VARCHAR(20) NOT NULL UNIQUE,
    admitted_on DATE NOT NULL,
    shares_held INT NOT NULL DEFAULT 0,
    share_face_value DECIMAL(10,2) NOT NULL DEFAULT 10.00,
    certificate_no VARCHAR(30),
    address VARCHAR(500),
    occupation VARCHAR(100),
    introduced_by VARCHAR(36),                 -- agent id, where there was one
    status VARCHAR(12) NOT NULL DEFAULT 'active',   -- active | ceased
    ceased_on DATE,
    cessation_reason VARCHAR(255),
    -- Customer due diligence, per the RBI Master Direction on KYC
    risk_category VARCHAR(10) NOT NULL DEFAULT 'unrated',  -- low | medium | high | unrated
    risk_reasons TEXT,
    risk_reviewed_at DATETIME,
    next_kyc_review DATE,
    is_pep TINYINT(1) NOT NULL DEFAULT 0,
    screening_status VARCHAR(20) NOT NULL DEFAULT 'not_screened',
    screening_checked_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_status (status),
    INDEX idx_risk (risk_category),
    INDEX idx_screening (screening_status),
    FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Every movement of shares, so the holding in member_register can always be
-- reconstructed from its history rather than trusted on its own.
CREATE TABLE IF NOT EXISTS share_allotments (
    id VARCHAR(36) PRIMARY KEY,
    member_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    kind VARCHAR(15) NOT NULL,                 -- allotment | transfer_in | transfer_out | surrender
    shares INT NOT NULL,
    face_value DECIMAL(10,2) NOT NULL DEFAULT 10.00,
    amount DECIMAL(15,2) NOT NULL,
    certificate_no VARCHAR(30),
    allotted_on DATE NOT NULL,
    reference VARCHAR(100),
    recorded_by VARCHAR(36),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_member (member_id, allotted_on),
    FOREIGN KEY (member_id) REFERENCES member_register(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Names to screen against. Held locally and loaded by the compliance officer,
-- so no member name is ever sent to an outside service.
CREATE TABLE IF NOT EXISTS watchlist_entries (
    id VARCHAR(36) PRIMARY KEY,
    list_name VARCHAR(20) NOT NULL,            -- UNSC | MHA | PEP | INTERNAL
    full_name VARCHAR(200) NOT NULL,
    normalised_name VARCHAR(200) NOT NULL,
    aliases VARCHAR(500),
    country VARCHAR(80),
    category VARCHAR(80),
    reference VARCHAR(100),
    added_by VARCHAR(36),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_normalised (normalised_name),
    INDEX idx_list (list_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A possible match between somebody we deal with and a watchlist name. Always
-- reviewed by a person: a name match is a reason to look, not a conclusion.
CREATE TABLE IF NOT EXISTS screening_hits (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36),
    lead_id VARCHAR(36),
    screened_name VARCHAR(200) NOT NULL,
    watchlist_id VARCHAR(36),
    matched_name VARCHAR(200),
    list_name VARCHAR(20),
    score INT NOT NULL,
    status VARCHAR(12) NOT NULL DEFAULT 'open',   -- open | cleared | confirmed
    note VARCHAR(500),
    reviewed_by VARCHAR(36),
    reviewed_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_status_score (status, score),
    INDEX idx_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
    -- Months during which instalments are actually paid. Shorter than the
    -- tenure for a plan that is paid into for a few years and then held.
    contribution_months INT,
    contribution_amount DECIMAL(15,2),                     -- per day or per month, for instalment plans
    principal_amount DECIMAL(15,2),                        -- lump sum, for FD / MIS
    total_deposit DECIMAL(15,2) NOT NULL,
    maturity_amount DECIMAL(15,2) NOT NULL,
    payout_type VARCHAR(10) NOT NULL DEFAULT 'maturity',   -- maturity | monthly
    -- Every denomination the plan is sold in, as published in the brochure:
    -- [{"unit":100,"deposit":108000,"maturity":125900}, ...]. The columns above
    -- hold the representative slab the effective rate is worked out from.
    slabs LONGTEXT,
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

-- Content behind the public product pages (/personal/savings-account and friends).
-- Seeded from what the frontend used to carry hardcoded, so the pages are
-- unchanged on day one but editable by the director from then on.
CREATE TABLE IF NOT EXISTS site_products (
    id VARCHAR(36) PRIMARY KEY,
    group_key VARCHAR(30) NOT NULL,
    slug VARCHAR(80) NOT NULL,
    title VARCHAR(150) NOT NULL,
    tagline VARCHAR(255),
    summary TEXT,
    -- JSON arrays: highlights and documents are lists of strings, facts is a
    -- list of [label, value] pairs. Stored as TEXT so MariaDB 10.3 and MySQL 5.7
    -- behave identically.
    highlights TEXT,
    facts TEXT,
    documents TEXT,
    note TEXT,
    requires VARCHAR(50),
    sort_order INT NOT NULL DEFAULT 0,
    status VARCHAR(10) NOT NULL DEFAULT 'active',
    UNIQUE KEY uniq_product_path (group_key, slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT IGNORE INTO site_products (id, group_key, slug, title, tagline, summary, highlights, facts, documents, note, requires, sort_order, status) VALUES
('prod-personal-savings-account', 'personal', 'savings-account', 'Savings Account', 'Everyday banking with interest paid quarterly.', 'A zero-balance members’ savings account with the member portal, statements and transfers between member accounts. Open it online with PAN and Aadhaar, and finish verification by video KYC without visiting a branch.', '["Interest credited every quarter","Transfers between member accounts at no charge","Statements as PDF or Excel, any date range","Video KYC, no branch visit"]', '[["Interest rate","4.00% p.a."],["Minimum balance","Nil"],["Digital transfers","Free"],["Statement","PDF or Excel, any date range"]]', '["PAN card","Aadhaar or another officially valid document","Recent photograph"]', NULL, NULL, 0, 'active'),
('prod-personal-salary-account', 'personal', 'salary-account', 'Salary Account', 'For monthly salary credits, with no balance requirement.', 'A savings account configured for salary credits. It keeps every digital-banking feature of the regular savings account and drops the minimum balance while your salary arrives each month.', '["No minimum balance with an active salary credit","Free cheque book on request","Standing instructions for rent, SIPs and EMIs","Same interest as a savings account"]', '[["Interest rate","4.00% p.a."],["Minimum balance","Nil with salary credit"],["Eligibility","Employer salary credit"],["Cheque book","Free, 25 to 100 leaves"]]', '["PAN card","Aadhaar or another officially valid document","Latest salary slip or offer letter"]', NULL, NULL, 10, 'active'),
('prod-personal-fixed-deposits', 'personal', 'fixed-deposits', 'Fixed Deposits', 'Lock in a rate from 7 days to 10 years.', 'Book a fixed deposit from your account in a few seconds. The maturity value is shown before you confirm, and senior citizens receive an extra 0.50% p.a. across every tenure.', '["Book online from your savings account","Maturity value shown up front","Senior citizens get +0.50% p.a.","Interest on maturity or periodically"]', '[["1 year to 2 years","7.25% p.a."],["2 years to 3 years","7.50% p.a."],["Senior citizen bonus","+0.50% p.a."],["Tenure","7 days to 10 years"]]', '["An active AJSPay account","Nominee details"]', NULL, NULL, 20, 'active'),
('prod-personal-recurring-deposit', 'personal', 'recurring-deposit', 'Recurring Deposit', 'Save a fixed amount every month.', 'A recurring deposit puts aside a set amount each month and pays fixed-deposit rates on the balance. Useful for a goal with a date attached, such as fees or a down payment.', '["Instalments from ₹500 a month","Fixed-deposit interest rates","Auto-debit by standing instruction","Tenure of 6 to 60 months"]', '[["Minimum instalment","₹500 per month"],["Interest rate","Same as the FD rate card"],["Tenure","6 to 60 months"],["Auto-debit","Standing instruction"]]', '["An active AJSPay account","Nominee details"]', NULL, NULL, 30, 'active'),
('prod-personal-debit-cards', 'personal', 'debit-cards', 'Debit & Credit Cards', 'Freeze, set limits and control usage yourself.', 'Every account comes with a virtual card immediately and a physical card on request. You control limits and switches from the app, and can freeze or permanently hotlist a card at once if it goes missing.', '["Virtual card the moment your account opens","Freeze instantly, hotlist permanently","Separate online and ATM limits","International and contactless switches"]', '[["Networks","Visa, RuPay and Mastercard"],["Online limit","Up to ₹10,00,000, set by you"],["PIN","Set your own; never stored in readable form"],["CVV reveal","Needs your transaction password"]]', '["An active AJSPay account"]', NULL, 'debit_cards', 40, 'active'),
('prod-corporate-current-account', 'corporate', 'current-account', 'Current Account', 'For businesses that move money every day.', 'A current account for companies and firms, with bulk payouts, per-batch references for reconciliation, and statements you can export as PDF or Excel for your accountant.', '["Unlimited digital transfers","Bulk payouts up to 500 lines per batch","Batch references for reconciliation","PDF and Excel statements"]', '[["Interest","Not applicable on current accounts"],["Bulk payout batch","Up to 500 beneficiaries"],["Authorisation","Transaction password per batch"],["Statements","PDF or Excel"]]', '["Certificate of incorporation or registration","Company PAN","Board resolution and authorised signatory list","KYC of signatories"]', NULL, 'current_accounts', 50, 'active'),
('prod-corporate-bulk-neft-rtgs', 'corporate', 'bulk-neft-rtgs', 'Bulk NEFT / RTGS', 'Pay hundreds of beneficiaries in one authorised batch.', 'Upload a payout batch, authorise it once with your transaction password, and every line gets its own reference number under a single batch reference. Any zero or negative line is rejected before the batch runs.', '["Up to 500 payouts per batch","One authorisation for the whole batch","Reference number for every line","Batch total checked against your balance first"]', '[["Batch size","Up to 500 lines"],["Modes","NEFT, RTGS and IMPS"],["Authorisation","Transaction password"],["Tracking","Batch and per-payout references"]]', '["An active AJSPay current account"]', NULL, 'payment_systems', 60, 'active'),
('prod-corporate-trade-finance', 'corporate', 'trade-finance', 'Trade Finance', 'Support for import and export payments.', 'Trade facilities such as letters of credit and bank guarantees are arranged case by case with your relationship manager. Raise a request from your corporate member portal account and the team will respond with the documents needed.', '["Letters of credit and guarantees","Import and export payment support","Handled by a relationship manager","Requests raised from NetBanking"]', '[["Availability","On request, case by case"],["Turnaround","Confirmed with your manager"],["Charges","Quoted per facility"]]', '["Corporate account and KYC on file","Trade documents for the specific transaction"]', NULL, NULL, 70, 'active'),
('prod-corporate-payroll-services', 'corporate', 'payroll-services', 'Payroll Services', 'Run salary batches from your current account.', 'Pay salaries as a single authorised batch each month and give staff AJSPay salary accounts with no minimum balance. Every payout keeps its own reference for your payroll records.', '["Monthly salary batches","Zero-balance salary accounts for staff","Reference number per employee","Exportable payout records"]', '[["Batch size","Up to 500 employees"],["Staff accounts","Zero balance with salary credit"],["Records","PDF or Excel export"]]', '["Corporate account","Employee list with account details"]', NULL, NULL, 80, 'active'),
('prod-corporate-cash-management', 'corporate', 'cash-management', 'Cash Management', 'Collections, payouts and reconciliation in one place.', 'See collections and payouts against one account, filter transactions by date, and export statements for reconciliation. Standing instructions cover payments that repeat on a fixed schedule.', '["Collections and payouts together","Filter by account and date range","Scheduled and repeating payments","PDF and Excel exports"]', '[["Statements","Any date range"],["Repeating payments","Daily to quarterly"],["Exports","PDF and Excel"]]', '["An active AJSPay current account"]', NULL, NULL, 90, 'active'),
('prod-loans-home-loan', 'loans', 'home-loan', 'Home Loan', 'Buy, build or transfer your home loan.', 'Check your EMI with the calculator, then apply online. The application reaches our loan department directly, and you can follow its status from your account.', '["Tenure up to 30 years","EMI calculator before you apply","Balance transfer accepted","Track the application in NetBanking"]', '[["Interest rate","8.40% – 9.15% p.a."],["Processing fee","0.25%, maximum ₹10,000"],["Tenure","Up to 30 years"]]', '["PAN and Aadhaar","Income proof: salary slips or ITR","Six months of bank statements","Property documents"]', NULL, NULL, 100, 'active'),
('prod-loans-personal-loan', 'loans', 'personal-loan', 'Personal Loan', 'For planned expenses, with no security.', 'An unsecured loan with a fixed EMI for the full tenure. The eligibility check compares your EMI against your declared monthly income before the application goes forward.', '["No collateral required","Fixed EMI throughout","Instant eligibility check","Tenure of 1 to 5 years"]', '[["Interest rate","10.50% – 13.50% p.a."],["Processing fee","1.00% of the loan amount"],["Tenure","1 to 5 years"]]', '["PAN and Aadhaar","Latest salary slips","Six months of bank statements"]', NULL, NULL, 110, 'active'),
('prod-loans-vehicle-loan', 'loans', 'vehicle-loan', 'Vehicle Loan', 'For a new or used car or two-wheeler.', 'Finance a vehicle with a fixed rate and a flat processing fee. Apply online, and the loan department reviews the application with your income details.', '["New and used vehicles","Flat processing fee","Tenure up to 7 years","Apply online in minutes"]', '[["Interest rate","8.75% – 9.50% p.a."],["Processing fee","₹1,500 flat"],["Tenure","Up to 7 years"]]', '["PAN and Aadhaar","Income proof","Vehicle quotation or invoice"]', NULL, NULL, 120, 'active'),
('prod-loans-gold-loan', 'loans', 'gold-loan', 'Gold Loan', 'Borrow against gold jewellery, with no processing fee.', 'Bring your jewellery to a branch for valuation and receive the loan against it. Rates are the lowest of our secured products and there is no processing fee.', '["Lowest rate of our loan products","No processing fee","Valuation at the branch","Jewellery stored in the branch vault"]', '[["Interest rate","7.90% – 8.50% p.a."],["Processing fee","Nil"],["Valuation","At the branch"]]', '["PAN and Aadhaar","Gold jewellery for valuation"]', NULL, NULL, 130, 'active'),
('prod-loans-education-loan', 'loans', 'education-loan', 'Education Loan', 'For studies in India or abroad.', 'Covers tuition and related costs, with repayment starting after the course period. Apply online with your admission letter and the fee schedule.', '["Courses in India and abroad","Repayment begins after the course","Tuition and living costs covered","Co-applicant income considered"]', '[["Interest rate","9.15% – 10.25% p.a."],["Processing fee","0.50% of the loan amount"],["Moratorium","Course period plus grace"]]', '["Admission letter and fee schedule","PAN and Aadhaar of student and co-applicant","Co-applicant income proof","Academic records"]', NULL, NULL, 140, 'active'),
('prod-investments-mutual-funds', 'investments', 'mutual-funds', 'Mutual Funds', 'Start a SIP from ₹500 a month.', 'Invest in the schemes listed in your account, as a monthly SIP or a lump sum. Each purchase debits your savings account and creates a folio you can follow under Deposits and Investments.', '["SIP from ₹500 a month","Equity, hybrid and index schemes","Folio visible in your portfolio","Debited from your savings account"]', '[["Minimum SIP","₹500 per month"],["Schemes","Large cap, sectoral, hybrid and index"],["Holdings","Shown in your portfolio"]]', '["An active AJSPay account with completed KYC"]', 'Mutual fund investments carry market risk. Past performance does not indicate future returns. Read the scheme documents before investing.', 'mutual_funds', 150, 'active'),
('prod-investments-sovereign-gold-bonds', 'investments', 'sovereign-gold-bonds', 'Sovereign Gold Bonds', 'Gold holdings without storing metal.', 'Sovereign Gold Bonds are issued by the Reserve Bank of India in tranches. When a tranche opens, you can place a subscription request from your account and the holding is recorded in your name.', '["Issued by the RBI in tranches","No storage or making charges","Interest in addition to the gold price","Held in your own name"]', '[["Issuer","Reserve Bank of India"],["Availability","Only while a tranche is open"],["Tenure","Eight years, exit allowed from the fifth"]]', '["An active AJSPay account with completed KYC"]', NULL, 'mutual_funds', 160, 'active'),
('prod-investments-insurance', 'investments', 'insurance', 'Insurance', 'Term, health and motor cover.', 'Compare the term, health and motor plans listed in your account and start an application. Cover is underwritten by our insurance partners, who assess and issue the policy.', '["Term life, family health and motor cover","Plan details and premiums in-app","Issued by insurance partners","Nominee recorded with the policy"]', '[["Term cover","From ₹8,450 a year"],["Family health floater","From ₹14,200 a year"],["Motor cover","From ₹7,100 a year"]]', '["PAN and Aadhaar","Health declaration where the plan requires it"]', 'Insurance is underwritten by our partners. Premiums shown are indicative and depend on age, cover and underwriting.', 'insurance', 170, 'active'),
('prod-support-grievance-redressal', 'support', 'grievance-redressal', 'Grievance Redressal', 'How to raise a complaint and what happens next.', 'Raise a complaint from Support inside the member portal and you get a ticket number immediately. Complaints mentioning fraud are marked high priority and routed to the grievance desk first.', '["Ticket number as soon as you file","Fraud reports prioritised","Track status in your account","Escalation if the first response does not resolve it"]', '[["Level 1","Grievance Redressal Desk, from the member portal"],["Level 2","Nodal officer at the head office"],["Toll-free","9105015464, 24×7"],["Cyber fraud helpline","1930"]]', '["Your account details","Transaction reference for the disputed entry"]', NULL, NULL, 180, 'active');

-- One row per CAPTCHA served. The answer is never stored, only a salted hash of
-- it, and a row is spent the moment it is used so an answer cannot be replayed.
-- Every scheduled run, so "is the automation running" is a question the
-- application can answer rather than one only the server's journal knows.
CREATE TABLE IF NOT EXISTS cron_runs (
    id VARCHAR(36) PRIMARY KEY,
    started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at DATETIME NULL,
    dry_run TINYINT(1) NOT NULL DEFAULT 0,
    status VARCHAR(12) NOT NULL DEFAULT 'running',  -- running | ok | attention | failed
    jobs TEXT,                                      -- per-job counts, as JSON
    error VARCHAR(500),
    INDEX idx_cron_started (started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS captcha_challenges (
    id VARCHAR(36) PRIMARY KEY,
    code_hash CHAR(64) NOT NULL,
    ip VARCHAR(45),
    expires_at DATETIME NOT NULL,
    used_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_captcha_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Identity documents a member uploads for verification. Stored inline rather
-- than on disk: nothing under the document root can then be fetched directly,
-- and the bytes are only ever handed to an authorised reviewer.
CREATE TABLE IF NOT EXISTS kyc_documents (
    id VARCHAR(36) PRIMARY KEY,
    -- Exactly one of these is set. A document belongs to an enquiry while the
    -- account is still being opened, and is re-pointed at the member once it is.
    user_id VARCHAR(36),
    lead_id VARCHAR(36),
    kind VARCHAR(20) NOT NULL,              -- pan | aadhaar | address
    file_name VARCHAR(200),
    mime VARCHAR(40) NOT NULL,
    byte_size INT NOT NULL,
    content_b64 MEDIUMTEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending_review',
    reviewed_by VARCHAR(36),
    review_reason VARCHAR(255),
    uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_at DATETIME NULL,
    INDEX idx_kyc_doc_user (user_id, kind),
    INDEX idx_kyc_doc_lead (lead_id, kind),
    INDEX idx_kyc_doc_status (status, uploaded_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row per signed-in device. The token stays stateless and signed; this table
-- is what lets a member see where they are signed in and end a session from
-- somewhere else, which a bare session_version counter cannot do.
CREATE TABLE IF NOT EXISTS sessions (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    user_agent VARCHAR(255),
    ip VARCHAR(45),
    is_impersonation TINYINT(1) NOT NULL DEFAULT 0,
    revoked_at DATETIME NULL,
    expires_at DATETIME NOT NULL,
    last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_session_user (user_id, revoked_at),
    INDEX idx_session_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The 3-year monthly plan was already seeded, deliberately held as a draft with
-- a note that its printed maturity works out above the cap. Activating it is the
-- owner's decision, taken knowingly; the slab table from the brochure goes in
-- with it so every denomination is rated rather than just the headline. The
-- rates page flags each slab that prices above the cap -- see scheme_public().
UPDATE schemes SET status = 'active',
    contribution_amount = 6000.00, total_deposit = 216000.00, maturity_amount = 249300.00,
    slabs = '[{"unit":500,"deposit":18000,"maturity":21975},{"unit":1000,"deposit":36000,"maturity":43950},{"unit":1500,"deposit":54000,"maturity":65925},{"unit":2000,"deposit":72000,"maturity":87900},{"unit":3000,"deposit":108000,"maturity":124650},{"unit":4000,"deposit":144000,"maturity":166200},{"unit":5000,"deposit":180000,"maturity":207750},{"unit":6000,"deposit":216000,"maturity":249300}]',
    notes = 'Brochure p7. Printed as 10.5%; the figures work out higher. The 500-2000 rows and the 3000-6000 rows do not agree with each other in the brochure.'
    WHERE code = 'AJS-RD-3Y';

-- The 21-year Shubh Lakshmi payout is genuinely new; the 6, 11 and 16 year
-- payouts were seeded but this one was not.
INSERT IGNORE INTO schemes (id, code, name, scheme_type, tenure_months, contribution_months,
    contribution_amount, principal_amount, total_deposit, maturity_amount, payout_type, status, notes, slabs) VALUES
('sch-sl-21y', 'AJS-SL-21Y', 'Shubh Lakshmi payout at 21', 'recurring', 252, 72,
    6000.00, NULL, 432000.00, 3692825.00, 'maturity', 'active',
    'Brochure p8, repriced to sit at/under the 12.5% Nidhi cap (was 12.75% effective on the printed figures). 72 monthly instalments, held to year 21.',
    '[{"unit":500,"deposit":36000,"maturity":307735},{"unit":1000,"deposit":72000,"maturity":615470},{"unit":1500,"deposit":108000,"maturity":923206},{"unit":2000,"deposit":144000,"maturity":1230941},{"unit":3000,"deposit":216000,"maturity":1846412},{"unit":4000,"deposit":288000,"maturity":2461883},{"unit":5000,"deposit":360000,"maturity":3077354},{"unit":6000,"deposit":432000,"maturity":3692825}]');

-- INSERT IGNORE alone was not enough: production already held this plan as a
-- draft, so the insert was skipped and the plan stayed hidden. The update runs
-- either way, which is what makes this migration idempotent whether the row
-- was already there or has just been created. Repriced to sit at/under the
-- 12.5% Nidhi cap -- the brochure's printed figures worked out to 12.75%.
UPDATE schemes SET status = 'active',
    tenure_months = 252, contribution_months = 72,
    contribution_amount = 6000.00, total_deposit = 432000.00, maturity_amount = 3692825.00,
    slabs = '[{"unit":500,"deposit":36000,"maturity":307735},{"unit":1000,"deposit":72000,"maturity":615470},{"unit":1500,"deposit":108000,"maturity":923206},{"unit":2000,"deposit":144000,"maturity":1230941},{"unit":3000,"deposit":216000,"maturity":1846412},{"unit":4000,"deposit":288000,"maturity":2461883},{"unit":5000,"deposit":360000,"maturity":3077354},{"unit":6000,"deposit":432000,"maturity":3692825}]',
    notes = 'Brochure p8, repriced to sit at/under the 12.5% Nidhi cap (was 12.75% effective on the printed figures). 72 monthly instalments, held to year 21.'
    WHERE code = 'AJS-SL-21Y';

-- The fixed-deposit brochure plan, activated on the owner's instruction. Its
-- printed figures worked out to 14.72% effective -- above the 12.5% Nidhi Rules
-- cap -- so every slab is repriced down to sit at the cap before activating,
-- rather than activated on the brochure's own over-cap numbers.
UPDATE schemes SET status = 'active',
    total_deposit = 150000.00, maturity_amount = 384867.00,
    slabs = '[{"unit":2500,"deposit":2500,"maturity":6414},{"unit":3000,"deposit":3000,"maturity":7697},{"unit":3500,"deposit":3500,"maturity":8980},{"unit":4000,"deposit":4000,"maturity":10263},{"unit":4500,"deposit":4500,"maturity":11546},{"unit":5000,"deposit":5000,"maturity":12828},{"unit":5500,"deposit":5500,"maturity":14111},{"unit":6000,"deposit":6000,"maturity":15394},{"unit":7000,"deposit":7000,"maturity":17960},{"unit":8000,"deposit":8000,"maturity":20526},{"unit":9000,"deposit":9000,"maturity":23092},{"unit":10000,"deposit":10000,"maturity":25657},{"unit":12000,"deposit":12000,"maturity":30789},{"unit":14000,"deposit":14000,"maturity":35920},{"unit":15000,"deposit":15000,"maturity":38486},{"unit":17000,"deposit":17000,"maturity":43618},{"unit":18000,"deposit":18000,"maturity":46184},{"unit":20000,"deposit":20000,"maturity":51315},{"unit":25000,"deposit":25000,"maturity":64144},{"unit":30000,"deposit":30000,"maturity":76973},{"unit":33000,"deposit":33000,"maturity":84670},{"unit":35000,"deposit":35000,"maturity":89802},{"unit":40000,"deposit":40000,"maturity":102631},{"unit":45000,"deposit":45000,"maturity":115460},{"unit":50000,"deposit":50000,"maturity":128289},{"unit":60000,"deposit":60000,"maturity":153947},{"unit":70000,"deposit":70000,"maturity":179604},{"unit":80000,"deposit":80000,"maturity":205262},{"unit":90000,"deposit":90000,"maturity":230920},{"unit":100000,"deposit":100000,"maturity":256578},{"unit":125000,"deposit":125000,"maturity":320723},{"unit":150000,"deposit":150000,"maturity":384867}]',
    notes = 'Brochure p10-11, repriced to sit at/under the 12.5% Nidhi cap (was 14.72% effective on the printed figures, which tripled every amount over eight years).'
    WHERE code = 'AJS-FD-8Y';

-- The MIS plan's printed figures (₹250/month per ₹10,000 unit) worked out to an
-- 18.71% effective annual return -- above the 12.5% Nidhi Rules cap -- so it is
-- repriced down to sit at the cap before being activated, rather than being
-- activated on the brochure's own over-cap numbers.
UPDATE schemes SET status = 'active',
    total_deposit = 200000.00, maturity_amount = 265920.00,
    slabs = '[{"unit":10000,"deposit":10000,"maturity":13260,"monthly_payout":221},{"unit":20000,"deposit":20000,"maturity":26580,"monthly_payout":443},{"unit":30000,"deposit":30000,"maturity":39840,"monthly_payout":664},{"unit":40000,"deposit":40000,"maturity":53160,"monthly_payout":886},{"unit":50000,"deposit":50000,"maturity":66480,"monthly_payout":1108},{"unit":60000,"deposit":60000,"maturity":79740,"monthly_payout":1329},{"unit":70000,"deposit":70000,"maturity":93060,"monthly_payout":1551},{"unit":80000,"deposit":80000,"maturity":106320,"monthly_payout":1772},{"unit":100000,"deposit":100000,"maturity":132960,"monthly_payout":2216},{"unit":200000,"deposit":200000,"maturity":265920,"monthly_payout":4432}]',
    notes = 'Brochure p9, repriced to sit at/under the 12.5% Nidhi cap (was 18.71% effective on the printed ₹250/month figure). Monthly payout for sixty months; the maturity column is the total received.'
    WHERE code = 'AJS-MIS-5Y';

-- The referral code an enquiry arrived with, kept as its own column rather than
-- buried in the notes. It was free text before, which meant nothing could read
-- it back and the chain from a shared link to a paid bonus was broken.
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS referral_code VARCHAR(40) NULL;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS referral_status VARCHAR(20) NULL;
CREATE INDEX IF NOT EXISTS idx_lead_referral ON crm_leads (referral_code);

-- A member without an email is a member, not an error. The column stays unique
-- so two accounts cannot share an address, and a unique index accepts any
-- number of NULLs, so those members simply have none. They sign in with their
-- account number instead.
ALTER TABLE users MODIFY COLUMN email VARCHAR(150) NULL;
