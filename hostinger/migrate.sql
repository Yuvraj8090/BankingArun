-- ===========================================================================
-- AJSPay: upgrade an existing database in place.
--
-- A FRESH install does not need this file — schema.sql already contains
-- everything below. Run this only when the database was created from an
-- earlier schema.sql and already holds live data.
--
--   phpMyAdmin: select the database -> Import -> choose this file
--   shell:      mysql -u <db_user> -p <db_name> < migrate.sql
--
-- Safe to run more than once: every statement is conditional, so nothing is
-- dropped and no existing row is touched.
--
-- Needs MariaDB 10.2+ (what Hostinger runs), which supports
-- "IF NOT EXISTS" on ADD COLUMN / ADD INDEX. On Oracle MySQL 8, which does
-- not, delete the "IF NOT EXISTS" from each clause below and run the
-- statements one at a time, skipping any that report a duplicate.
-- ===========================================================================

-- --- Scheme master and field agents ---------------------------------------
-- Back-office deposit plans, the agents who collect them, and each collection.
-- Nothing here is exposed on the public site.
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

-- --- AI module: fraud alerts, security log, loan grading ------------------
CREATE TABLE IF NOT EXISTS fraud_alerts (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36),
    account_number VARCHAR(30),
    ref_number VARCHAR(50),
    amount DECIMAL(15,2) NOT NULL,
    counterparty_acc VARCHAR(50),
    counterparty_name VARCHAR(150),
    score INT NOT NULL,
    severity VARCHAR(10) NOT NULL,
    reasons TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'open',
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
    severity VARCHAR(10) NOT NULL DEFAULT 'info',
    user_id VARCHAR(36),
    email VARCHAR(150),
    ip VARCHAR(45),
    route VARCHAR(120),
    details VARCHAR(255),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_severity_time (severity, created_at),
    INDEX idx_type_time (event_type, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE loan_applications
    ADD COLUMN IF NOT EXISTS risk_score INT,
    ADD COLUMN IF NOT EXISTS risk_grade VARCHAR(2),
    ADD COLUMN IF NOT EXISTS risk_reasons TEXT,
    ADD COLUMN IF NOT EXISTS scored_at DATETIME;

-- --- Authenticator-app 2FA -------------------------------------------------
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS totp_secret VARCHAR(255),
    ADD COLUMN IF NOT EXISTS totp_enabled TINYINT(1) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS totp_backup_codes TEXT,
    ADD COLUMN IF NOT EXISTS totp_enrolled_at DATETIME;

-- --- Support desk workflow -------------------------------------------------
ALTER TABLE support_tickets
    ADD COLUMN IF NOT EXISTS assigned_user_id VARCHAR(36),
    ADD COLUMN IF NOT EXISTS due_at DATETIME,
    ADD COLUMN IF NOT EXISTS first_response_at DATETIME,
    ADD COLUMN IF NOT EXISTS resolved_at DATETIME,
    ADD COLUMN IF NOT EXISTS last_message_at DATETIME,
    ADD COLUMN IF NOT EXISTS unread_for_member INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS unread_for_staff INT NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS resolution_note VARCHAR(500),
    ADD INDEX IF NOT EXISTS idx_due (status, due_at);

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

-- --- Deposit interest and maturity (cron.php) ------------------------------
ALTER TABLE deposits
    ADD COLUMN IF NOT EXISTS interest_paid DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    ADD COLUMN IF NOT EXISTS last_payout_date DATE,
    ADD COLUMN IF NOT EXISTS matured_on DATETIME,
    ADD INDEX IF NOT EXISTS idx_maturity (status, maturity_date);

-- --- Columns cron.php writes ----------------------------------------------
-- Without these the cron run fails on its first UPDATE.
ALTER TABLE standing_instructions
    ADD COLUMN IF NOT EXISTS last_run DATE,
    ADD COLUMN IF NOT EXISTS last_status VARCHAR(20),
    ADD COLUMN IF NOT EXISTS last_error VARCHAR(255),
    ADD COLUMN IF NOT EXISTS failures INT NOT NULL DEFAULT 0,
    ADD INDEX IF NOT EXISTS idx_due (status, next_run);

ALTER TABLE scheduled_payments
    ADD COLUMN IF NOT EXISTS processed_at DATETIME,
    ADD COLUMN IF NOT EXISTS ref_number VARCHAR(50),
    ADD COLUMN IF NOT EXISTS failure_reason VARCHAR(255),
    ADD INDEX IF NOT EXISTS idx_due (status, schedule_date);

-- Instructions created before this upgrade have no next_run, or one left in the
-- past, because nothing executed them. Start them from today rather than their
-- original date: a back-dated next_run would make the first cron runs pay off
-- months of "arrears" that were never actually owed.
UPDATE standing_instructions
    SET next_run = CURDATE()
    WHERE status = 'active' AND (next_run IS NULL OR next_run < CURDATE());

-- Same for one-off transfers whose date passed while nothing was running them:
-- leave them SCHEDULED but due today, so each is paid once and only once.
UPDATE scheduled_payments
    SET schedule_date = CURDATE()
    WHERE status = 'SCHEDULED' AND schedule_date < CURDATE();

-- --- Deposit plans from the printed plan book -----------------------------
-- Plans whose implied return exceeds the 12.5% cap in the Nidhi Rules, 2014
-- load as drafts: the API will not let a scheme above the cap be activated.
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
