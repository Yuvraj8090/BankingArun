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
    branch VARCHAR(100),
    pan_number VARCHAR(10),
    aadhaar_number VARCHAR(20),              -- masked (XXXX-XXXX-1234); the full number is never stored
    kyc_status VARCHAR(30) NOT NULL DEFAULT 'pending_approval',
    mfa_enabled TINYINT(1) NOT NULL DEFAULT 1,
    is_joint TINYINT(1) NOT NULL DEFAULT 0,
    joint_holder_name VARCHAR(150),
    nominee_name VARCHAR(150),
    nominee_relation VARCHAR(50),
    designation VARCHAR(100),
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
    cvv VARCHAR(4) NOT NULL,             -- shown to the cardholder on the virtual card (demo only; see INSTALL)
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
    principal_amount DECIMAL(15,2) NOT NULL,
    interest_rate DECIMAL(5,2) NOT NULL,
    tenure_months INT NOT NULL,
    maturity_amount DECIMAL(15,2) NOT NULL,
    maturity_date DATE NOT NULL,
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
    status VARCHAR(20) NOT NULL DEFAULT 'SCHEDULED',
    remarks VARCHAR(255),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user (user_id),
    FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36),
    email VARCHAR(150),
    action VARCHAR(50) NOT NULL,
    details VARCHAR(255),
    ip VARCHAR(45),
    timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user_time (user_id, timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS login_attempts (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    identifier VARCHAR(191) NOT NULL,    -- "ip:email" for logins, "txn:<user id>" for transaction passwords
    email VARCHAR(150) NOT NULL,
    ip VARCHAR(45) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_identifier_time (identifier, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Demo data (mirrors the FastAPI seed)
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
