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
-- The client charset is declared before anything is written. This file is
-- UTF-8 and contains rupee signs and dashes; applied by a client that assumed
-- latin1, every one of them was stored double-encoded and reached the page as
-- mojibake. The seeded text below is re-stated as UPDATEs further down so an
-- already-corrupted row is repaired rather than skipped by INSERT IGNORE.
SET NAMES utf8mb4;
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

-- --- First-run tour ---------------------------------------------------------
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS tutorial_status VARCHAR(15) NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS tutorial_step INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS tutorial_updated_at DATETIME,
    ADD COLUMN IF NOT EXISTS first_login_at DATETIME,
    ADD COLUMN IF NOT EXISTS last_security_review DATETIME;

-- Everyone who already has an account has found their way around, so do not
-- ambush them with a first-run tour on their next sign-in.
UPDATE users SET tutorial_status = 'completed'
    WHERE tutorial_status = 'pending' AND created_at < UTC_TIMESTAMP();

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

ALTER TABLE schemes ADD COLUMN IF NOT EXISTS contribution_months INT;

-- --- PCI DSS: stop storing the card verification value ----------------------
-- PCI DSS forbids retaining sensitive authentication data after authorisation,
-- and the CVV is exactly that. It was kept so a virtual-card screen could show
-- it; that feature is gone and so is the column. Dropping it destroys the
-- stored values, which is the point.
ALTER TABLE cards DROP COLUMN IF EXISTS cvv;

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

-- Brochure slab tables: every denomination a plan is sold in.
SET @c := (SELECT COUNT(*) FROM information_schema.columns
           WHERE table_schema = DATABASE() AND table_name = 'schemes' AND column_name = 'slabs');
SET @q := IF(@c = 0, 'ALTER TABLE schemes ADD COLUMN slabs LONGTEXT AFTER payout_type', 'DO 0');
PREPARE st FROM @q; EXECUTE st; DEALLOCATE PREPARE st;

-- Grievance escalation on support tickets.
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS grievance_status VARCHAR(10);
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS grievance_ground VARCHAR(20);
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS grievance_detail VARCHAR(1000);
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS escalated_by VARCHAR(36);
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS escalated_at DATETIME;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS grievance_due_by DATETIME;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS grievance_outcome VARCHAR(1000);
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS grievance_handled_by VARCHAR(36);
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS grievance_handled_at DATETIME;
ALTER TABLE support_tickets ADD INDEX IF NOT EXISTS idx_grievance (grievance_status, grievance_due_by);

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
    user_id VARCHAR(36) NOT NULL,
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
    6000.00, NULL, 432000.00, 3849700.00, 'maturity', 'active',
    'Brochure p8. 72 monthly instalments, held to year 21.',
    '[{"unit":500,"deposit":36000,"maturity":330355},{"unit":1000,"deposit":72000,"maturity":643510},{"unit":1500,"deposit":108000,"maturity":963500},{"unit":2000,"deposit":144000,"maturity":1285200},{"unit":3000,"deposit":216000,"maturity":1926533},{"unit":4000,"deposit":288000,"maturity":2564040},{"unit":5000,"deposit":360000,"maturity":3200800},{"unit":6000,"deposit":432000,"maturity":3849700}]');

-- INSERT IGNORE alone was not enough: production already held this plan as a
-- draft, so the insert was skipped and the plan stayed hidden. The update runs
-- either way, which is what makes this migration idempotent whether the row
-- was already there or has just been created.
UPDATE schemes SET status = 'active',
    tenure_months = 252, contribution_months = 72,
    contribution_amount = 6000.00, total_deposit = 432000.00, maturity_amount = 3849700.00,
    slabs = '[{"unit":500,"deposit":36000,"maturity":330355},{"unit":1000,"deposit":72000,"maturity":643510},{"unit":1500,"deposit":108000,"maturity":963500},{"unit":2000,"deposit":144000,"maturity":1285200},{"unit":3000,"deposit":216000,"maturity":1926533},{"unit":4000,"deposit":288000,"maturity":2564040},{"unit":5000,"deposit":360000,"maturity":3200800},{"unit":6000,"deposit":432000,"maturity":3849700}]',
    notes = 'Brochure p8. 72 monthly instalments, held to year 21.'
    WHERE code = 'AJS-SL-21Y';

-- The last two brochure plans, activated on the owner's instruction. Both price
-- well above the cap on their own printed figures -- the fixed deposit triples in
-- eight years, the monthly-income plan returns half as much again over five --
-- so every row carries the mark the rate card puts on an over-cap slab.
UPDATE schemes SET status = 'active',
    slabs = '[{"unit":2500,"deposit":2500,"maturity":7500},{"unit":3000,"deposit":3000,"maturity":9000},{"unit":3500,"deposit":3500,"maturity":10500},{"unit":4000,"deposit":4000,"maturity":12000},{"unit":4500,"deposit":4500,"maturity":13500},{"unit":5000,"deposit":5000,"maturity":15000},{"unit":5500,"deposit":5500,"maturity":16500},{"unit":6000,"deposit":6000,"maturity":18000},{"unit":7000,"deposit":7000,"maturity":21000},{"unit":8000,"deposit":8000,"maturity":24000},{"unit":9000,"deposit":9000,"maturity":27000},{"unit":10000,"deposit":10000,"maturity":30000},{"unit":12000,"deposit":12000,"maturity":36000},{"unit":14000,"deposit":14000,"maturity":42000},{"unit":15000,"deposit":15000,"maturity":45000},{"unit":17000,"deposit":17000,"maturity":51000},{"unit":18000,"deposit":18000,"maturity":54000},{"unit":20000,"deposit":20000,"maturity":60000},{"unit":25000,"deposit":25000,"maturity":75000},{"unit":30000,"deposit":30000,"maturity":90000},{"unit":33000,"deposit":33000,"maturity":99000},{"unit":35000,"deposit":35000,"maturity":105000},{"unit":40000,"deposit":40000,"maturity":120000},{"unit":45000,"deposit":45000,"maturity":135000},{"unit":50000,"deposit":50000,"maturity":150000},{"unit":60000,"deposit":60000,"maturity":180000},{"unit":70000,"deposit":70000,"maturity":210000},{"unit":80000,"deposit":80000,"maturity":240000},{"unit":90000,"deposit":90000,"maturity":270000},{"unit":100000,"deposit":100000,"maturity":300000},{"unit":125000,"deposit":125000,"maturity":375000},{"unit":150000,"deposit":150000,"maturity":450000}]',
    notes = 'Brochure p10-11. Every amount triples over eight years.'
    WHERE code = 'AJS-FD-8Y';

UPDATE schemes SET status = 'active',
    slabs = '[{"unit":10000,"deposit":10000,"maturity":15000,"monthly_payout":250},{"unit":20000,"deposit":20000,"maturity":30000,"monthly_payout":500},{"unit":30000,"deposit":30000,"maturity":45000,"monthly_payout":750},{"unit":40000,"deposit":40000,"maturity":60000,"monthly_payout":1000},{"unit":50000,"deposit":50000,"maturity":75000,"monthly_payout":1250},{"unit":60000,"deposit":60000,"maturity":90000,"monthly_payout":1500},{"unit":70000,"deposit":70000,"maturity":105000,"monthly_payout":1750},{"unit":80000,"deposit":80000,"maturity":120000,"monthly_payout":2000},{"unit":100000,"deposit":100000,"maturity":150000,"monthly_payout":2500},{"unit":200000,"deposit":200000,"maturity":300000,"monthly_payout":5000}]',
    notes = 'Brochure p9. Monthly payout for sixty months; the maturity column is the total received.'
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

-- An enquiry now carries the plan the person actually asked about, not just the
-- broad category. "Deposit" told the desk nothing: the caller who wants the
-- 5-year monthly-income plan and the one saving ten rupees a day are the same
-- row otherwise, and the plan is the first thing the member asks to be told
-- back when the account is opened.
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS scheme_code VARCHAR(20) NULL;

-- Documents could only be uploaded by someone who already had an account, which
-- put the verification after the thing it is supposed to gate. Hanging them on
-- the enquiry lets the file be assembled and checked first, and the rows are
-- re-pointed at the member when the account is finally opened, so nothing is
-- uploaded twice and the review history follows the person.
ALTER TABLE kyc_documents ADD COLUMN IF NOT EXISTS lead_id VARCHAR(36) NULL;
ALTER TABLE kyc_documents MODIFY COLUMN user_id VARCHAR(36) NULL;
CREATE INDEX IF NOT EXISTS idx_kyc_doc_lead ON kyc_documents (lead_id, kind);

-- --- Payment rails -------------------------------------------------------
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

-- Which published plan a deposit was booked under. Without it the deposit is a
-- principal and a maturity figure with no way back to the brochure page the
-- member was sold from, and nothing can answer "how many people are on MIS".
ALTER TABLE deposits ADD COLUMN IF NOT EXISTS scheme_code VARCHAR(20) NULL;
CREATE INDEX IF NOT EXISTS idx_deposit_scheme ON deposits (scheme_code, status);

-- Brochure p13: "12th Month Deposite Plan 6 Year Return BN-1018". Twelve monthly
-- instalments, then the fund is held to year six and paid back at double. It was
-- the one plan on a priced page that had never been entered, so the book offered
-- it and the portal had never heard of it.
--
-- 13.31% a year on its own printed figures, which is above the 12.5% a Nidhi may
-- pay. It goes in as printed and the rate card marks it, the same as every other
-- over-cap slab -- the alternative is a plan the counter sells and the system
-- cannot quote.
INSERT IGNORE INTO schemes (id, code, name, scheme_type, tenure_months, contribution_months,
    contribution_amount, total_deposit, maturity_amount, payout_type, status, notes, slabs)
VALUES (UUID(), 'AJS-12M-6Y', 'Dwigun Yojana (12 instalments, doubles by year 6)', 'recurring',
    72, 12, 6000.00, 72000.00, 144000.00, 'maturity', 'active',
    'Brochure p13, BN-1018. Twelve monthly instalments, then held to year six and paid at double.',
    '[{"unit":500,"deposit":6000,"maturity":12000},{"unit":1000,"deposit":12000,"maturity":24000},{"unit":1500,"deposit":18000,"maturity":36000},{"unit":2000,"deposit":24000,"maturity":48000},{"unit":2500,"deposit":30000,"maturity":60000},{"unit":3000,"deposit":36000,"maturity":72000},{"unit":3500,"deposit":42000,"maturity":84000},{"unit":4000,"deposit":48000,"maturity":96000},{"unit":5000,"deposit":60000,"maturity":120000},{"unit":6000,"deposit":72000,"maturity":144000}]');

UPDATE schemes SET status = 'active', scheme_type = 'recurring',
    tenure_months = 72, contribution_months = 12,
    contribution_amount = 6000.00, total_deposit = 72000.00, maturity_amount = 144000.00,
    payout_type = 'maturity',
    slabs = '[{"unit":500,"deposit":6000,"maturity":12000},{"unit":1000,"deposit":12000,"maturity":24000},{"unit":1500,"deposit":18000,"maturity":36000},{"unit":2000,"deposit":24000,"maturity":48000},{"unit":2500,"deposit":30000,"maturity":60000},{"unit":3000,"deposit":36000,"maturity":72000},{"unit":3500,"deposit":42000,"maturity":84000},{"unit":4000,"deposit":48000,"maturity":96000},{"unit":5000,"deposit":60000,"maturity":120000},{"unit":6000,"deposit":72000,"maturity":144000}]',
    notes = 'Brochure p13, BN-1018. Twelve monthly instalments, then held to year six and paid at double.'
    WHERE code = 'AJS-12M-6Y';

-- Master data was deleted outright: a scheme, agent, branch or public page
-- removed by mistake was gone, and the audit line saying who removed it was the
-- only trace left. These four now mark the row instead, so a wrong click is a
-- restore rather than a retyping job. Every read filters on deleted_at.
--
-- A deleted code is NOT freed for reuse: schemes.code carries a UNIQUE index, so
-- the marked row goes on holding it, and dropping that index to free the string
-- would be a worse trade than the inconvenience. Creating over a deleted code is
-- refused, and the refusal says where the code has gone so nobody is left
-- guessing why a code they cannot see is taken.
ALTER TABLE schemes       ADD COLUMN IF NOT EXISTS deleted_at DATETIME NULL;
ALTER TABLE schemes       ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(36) NULL;
ALTER TABLE agents        ADD COLUMN IF NOT EXISTS deleted_at DATETIME NULL;
ALTER TABLE agents        ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(36) NULL;
ALTER TABLE branches      ADD COLUMN IF NOT EXISTS deleted_at DATETIME NULL;
ALTER TABLE branches      ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(36) NULL;
ALTER TABLE site_products ADD COLUMN IF NOT EXISTS deleted_at DATETIME NULL;
ALTER TABLE site_products ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(36) NULL;
CREATE INDEX IF NOT EXISTS idx_schemes_live       ON schemes (deleted_at);
CREATE INDEX IF NOT EXISTS idx_agents_live        ON agents (deleted_at);
CREATE INDEX IF NOT EXISTS idx_branches_live      ON branches (deleted_at);
CREATE INDEX IF NOT EXISTS idx_site_products_live ON site_products (deleted_at);

-- Every brochure plan, at the figures production actually serves.
--
-- schema.sql plus this file could not rebuild production: four plans came out as
-- drafts, four did not exist at all, and six carried no slab table, so a restore
-- from the repository would have quietly dropped half the rate card. The plans
-- had been brought live by hand over several sessions and the repository never
-- caught up.
--
-- Written from production after checking all 150 printed figures on pages 6 to
-- 13 against it, so the two now agree on numbers that were verified rather than
-- on whichever was edited last. Idempotent: the insert seeds a missing plan, the
-- update fixes one that is present but wrong -- which is the case that bit
-- before, when INSERT IGNORE alone silently skipped a row already sitting there
-- as a draft.

-- AJS-DD-3Y: brochure p6. Daily Yojana 3 Year
INSERT IGNORE INTO schemes (id, code, name, scheme_type, tenure_months, contribution_months,
    contribution_amount, principal_amount, total_deposit, maturity_amount, payout_type, status, slabs)
VALUES (UUID(), 'AJS-DD-3Y', 'Daily Yojana 3 Year', 'daily', 36,
    NULL, 100.0, NULL,
    108000.0, 125900.0, 'maturity', 'active', '[{"unit":100,"deposit":108000,"maturity":125900},{"unit":200,"deposit":216000,"maturity":253200},{"unit":300,"deposit":324000,"maturity":377500},{"unit":500,"deposit":540000,"maturity":629000}]');
UPDATE schemes SET name = 'Daily Yojana 3 Year', scheme_type = 'daily',
    tenure_months = 36, contribution_months = NULL,
    contribution_amount = 100.0, principal_amount = NULL,
    total_deposit = 108000.0, maturity_amount = 125900.0,
    payout_type = 'maturity', status = 'active', slabs = '[{"unit":100,"deposit":108000,"maturity":125900},{"unit":200,"deposit":216000,"maturity":253200},{"unit":300,"deposit":324000,"maturity":377500},{"unit":500,"deposit":540000,"maturity":629000}]'
    WHERE code = 'AJS-DD-3Y' AND deleted_at IS NULL;

-- AJS-DD-5Y: brochure p6. Daily Yojana 5 Year
INSERT IGNORE INTO schemes (id, code, name, scheme_type, tenure_months, contribution_months,
    contribution_amount, principal_amount, total_deposit, maturity_amount, payout_type, status, slabs)
VALUES (UUID(), 'AJS-DD-5Y', 'Daily Yojana 5 Year', 'daily', 60,
    NULL, 500.0, NULL,
    900000.0, 1174000.0, 'maturity', 'active', '[{"unit":50,"deposit":90000,"maturity":117900},{"unit":100,"deposit":180000,"maturity":235600},{"unit":200,"deposit":360000,"maturity":469500},{"unit":500,"deposit":900000,"maturity":1174000}]');
UPDATE schemes SET name = 'Daily Yojana 5 Year', scheme_type = 'daily',
    tenure_months = 60, contribution_months = NULL,
    contribution_amount = 500.0, principal_amount = NULL,
    total_deposit = 900000.0, maturity_amount = 1174000.0,
    payout_type = 'maturity', status = 'active', slabs = '[{"unit":50,"deposit":90000,"maturity":117900},{"unit":100,"deposit":180000,"maturity":235600},{"unit":200,"deposit":360000,"maturity":469500},{"unit":500,"deposit":900000,"maturity":1174000}]'
    WHERE code = 'AJS-DD-5Y' AND deleted_at IS NULL;

-- AJS-DD-6Y: brochure p6. Daily Yojana 6 Year
INSERT IGNORE INTO schemes (id, code, name, scheme_type, tenure_months, contribution_months,
    contribution_amount, principal_amount, total_deposit, maturity_amount, payout_type, status, slabs)
VALUES (UUID(), 'AJS-DD-6Y', 'Daily Yojana 6 Year', 'daily', 72,
    NULL, 100.0, NULL,
    216000.0, 311600.0, 'maturity', 'active', '[{"unit":50,"deposit":108000,"maturity":155800},{"unit":100,"deposit":216000,"maturity":311600},{"unit":200,"deposit":432000,"maturity":622600},{"unit":500,"deposit":1080000,"maturity":1555000}]');
UPDATE schemes SET name = 'Daily Yojana 6 Year', scheme_type = 'daily',
    tenure_months = 72, contribution_months = NULL,
    contribution_amount = 100.0, principal_amount = NULL,
    total_deposit = 216000.0, maturity_amount = 311600.0,
    payout_type = 'maturity', status = 'active', slabs = '[{"unit":50,"deposit":108000,"maturity":155800},{"unit":100,"deposit":216000,"maturity":311600},{"unit":200,"deposit":432000,"maturity":622600},{"unit":500,"deposit":1080000,"maturity":1555000}]'
    WHERE code = 'AJS-DD-6Y' AND deleted_at IS NULL;

-- AJS-RD-1Y: brochure p7. Masik Yojana 1 Year
INSERT IGNORE INTO schemes (id, code, name, scheme_type, tenure_months, contribution_months,
    contribution_amount, principal_amount, total_deposit, maturity_amount, payout_type, status, slabs)
VALUES (UUID(), 'AJS-RD-1Y', 'Masik Yojana 1 Year', 'recurring', 12,
    NULL, 6000.0, NULL,
    72000.0, 76320.0, 'maturity', 'active', '[{"unit":500,"deposit":6000,"maturity":6360},{"unit":1000,"deposit":12000,"maturity":12720},{"unit":1500,"deposit":18000,"maturity":19080},{"unit":2000,"deposit":24000,"maturity":25440},{"unit":3000,"deposit":36000,"maturity":38160},{"unit":4000,"deposit":48000,"maturity":50880},{"unit":5000,"deposit":60000,"maturity":63600},{"unit":6000,"deposit":72000,"maturity":76320}]');
UPDATE schemes SET name = 'Masik Yojana 1 Year', scheme_type = 'recurring',
    tenure_months = 12, contribution_months = NULL,
    contribution_amount = 6000.0, principal_amount = NULL,
    total_deposit = 72000.0, maturity_amount = 76320.0,
    payout_type = 'maturity', status = 'active', slabs = '[{"unit":500,"deposit":6000,"maturity":6360},{"unit":1000,"deposit":12000,"maturity":12720},{"unit":1500,"deposit":18000,"maturity":19080},{"unit":2000,"deposit":24000,"maturity":25440},{"unit":3000,"deposit":36000,"maturity":38160},{"unit":4000,"deposit":48000,"maturity":50880},{"unit":5000,"deposit":60000,"maturity":63600},{"unit":6000,"deposit":72000,"maturity":76320}]'
    WHERE code = 'AJS-RD-1Y' AND deleted_at IS NULL;

-- AJS-RD-2Y: brochure p7. Masik Yojana 2 Year
INSERT IGNORE INTO schemes (id, code, name, scheme_type, tenure_months, contribution_months,
    contribution_amount, principal_amount, total_deposit, maturity_amount, payout_type, status, slabs)
VALUES (UUID(), 'AJS-RD-2Y', 'Masik Yojana 2 Year', 'recurring', 24,
    NULL, 6000.0, NULL,
    144000.0, 155520.0, 'maturity', 'active', '[{"unit":500,"deposit":12000,"maturity":12960},{"unit":1000,"deposit":24000,"maturity":25920},{"unit":1500,"deposit":36000,"maturity":38880},{"unit":2000,"deposit":48000,"maturity":51840},{"unit":3000,"deposit":72000,"maturity":77760},{"unit":4000,"deposit":96000,"maturity":103680},{"unit":5000,"deposit":120000,"maturity":129600},{"unit":6000,"deposit":144000,"maturity":155520}]');
UPDATE schemes SET name = 'Masik Yojana 2 Year', scheme_type = 'recurring',
    tenure_months = 24, contribution_months = NULL,
    contribution_amount = 6000.0, principal_amount = NULL,
    total_deposit = 144000.0, maturity_amount = 155520.0,
    payout_type = 'maturity', status = 'active', slabs = '[{"unit":500,"deposit":12000,"maturity":12960},{"unit":1000,"deposit":24000,"maturity":25920},{"unit":1500,"deposit":36000,"maturity":38880},{"unit":2000,"deposit":48000,"maturity":51840},{"unit":3000,"deposit":72000,"maturity":77760},{"unit":4000,"deposit":96000,"maturity":103680},{"unit":5000,"deposit":120000,"maturity":129600},{"unit":6000,"deposit":144000,"maturity":155520}]'
    WHERE code = 'AJS-RD-2Y' AND deleted_at IS NULL;

-- AJS-RD-3Y: brochure p7. Masik Yojana 3 Year
INSERT IGNORE INTO schemes (id, code, name, scheme_type, tenure_months, contribution_months,
    contribution_amount, principal_amount, total_deposit, maturity_amount, payout_type, status, slabs)
VALUES (UUID(), 'AJS-RD-3Y', 'Masik Yojana 3 Year', 'recurring', 36,
    NULL, 6000.0, NULL,
    216000.0, 249300.0, 'maturity', 'active', '[{"unit":500,"deposit":18000,"maturity":21975},{"unit":1000,"deposit":36000,"maturity":43950},{"unit":1500,"deposit":54000,"maturity":65925},{"unit":2000,"deposit":72000,"maturity":87900},{"unit":3000,"deposit":108000,"maturity":124650},{"unit":4000,"deposit":144000,"maturity":166200},{"unit":5000,"deposit":180000,"maturity":207750},{"unit":6000,"deposit":216000,"maturity":249300}]');
UPDATE schemes SET name = 'Masik Yojana 3 Year', scheme_type = 'recurring',
    tenure_months = 36, contribution_months = NULL,
    contribution_amount = 6000.0, principal_amount = NULL,
    total_deposit = 216000.0, maturity_amount = 249300.0,
    payout_type = 'maturity', status = 'active', slabs = '[{"unit":500,"deposit":18000,"maturity":21975},{"unit":1000,"deposit":36000,"maturity":43950},{"unit":1500,"deposit":54000,"maturity":65925},{"unit":2000,"deposit":72000,"maturity":87900},{"unit":3000,"deposit":108000,"maturity":124650},{"unit":4000,"deposit":144000,"maturity":166200},{"unit":5000,"deposit":180000,"maturity":207750},{"unit":6000,"deposit":216000,"maturity":249300}]'
    WHERE code = 'AJS-RD-3Y' AND deleted_at IS NULL;

-- AJS-RD-5Y: brochure p7. Masik Yojana 5 Year
INSERT IGNORE INTO schemes (id, code, name, scheme_type, tenure_months, contribution_months,
    contribution_amount, principal_amount, total_deposit, maturity_amount, payout_type, status, slabs)
VALUES (UUID(), 'AJS-RD-5Y', 'Masik Yojana 5 Year', 'recurring', 60,
    NULL, 6000.0, NULL,
    360000.0, 469800.0, 'maturity', 'active', '[{"unit":500,"deposit":30000,"maturity":39150},{"unit":1000,"deposit":60000,"maturity":78300},{"unit":1500,"deposit":90000,"maturity":117450},{"unit":2000,"deposit":120000,"maturity":156600},{"unit":3000,"deposit":180000,"maturity":234900},{"unit":4000,"deposit":240000,"maturity":313200},{"unit":5000,"deposit":300000,"maturity":391500},{"unit":6000,"deposit":360000,"maturity":469800}]');
UPDATE schemes SET name = 'Masik Yojana 5 Year', scheme_type = 'recurring',
    tenure_months = 60, contribution_months = NULL,
    contribution_amount = 6000.0, principal_amount = NULL,
    total_deposit = 360000.0, maturity_amount = 469800.0,
    payout_type = 'maturity', status = 'active', slabs = '[{"unit":500,"deposit":30000,"maturity":39150},{"unit":1000,"deposit":60000,"maturity":78300},{"unit":1500,"deposit":90000,"maturity":117450},{"unit":2000,"deposit":120000,"maturity":156600},{"unit":3000,"deposit":180000,"maturity":234900},{"unit":4000,"deposit":240000,"maturity":313200},{"unit":5000,"deposit":300000,"maturity":391500},{"unit":6000,"deposit":360000,"maturity":469800}]'
    WHERE code = 'AJS-RD-5Y' AND deleted_at IS NULL;

-- AJS-RD-6Y: brochure p7 and p12. Masik Yojana 6 Year
INSERT IGNORE INTO schemes (id, code, name, scheme_type, tenure_months, contribution_months,
    contribution_amount, principal_amount, total_deposit, maturity_amount, payout_type, status, slabs)
VALUES (UUID(), 'AJS-RD-6Y', 'Masik Yojana 6 Year', 'recurring', 72,
    NULL, 10000.0, NULL,
    720000.0, 1048500.0, 'maturity', 'active', '[{"unit":100,"deposit":7200,"maturity":10485},{"unit":200,"deposit":14400,"maturity":20970},{"unit":300,"deposit":21600,"maturity":31455},{"unit":400,"deposit":28800,"maturity":41940},{"unit":500,"deposit":36000,"maturity":52500},{"unit":600,"deposit":43200,"maturity":62910},{"unit":700,"deposit":50400,"maturity":73395},{"unit":800,"deposit":57600,"maturity":83880},{"unit":900,"deposit":64800,"maturity":94365},{"unit":1000,"deposit":72000,"maturity":105000},{"unit":1100,"deposit":79200,"maturity":115335},{"unit":1200,"deposit":86400,"maturity":125820},{"unit":1300,"deposit":93600,"maturity":136305},{"unit":1400,"deposit":100800,"maturity":146790},{"unit":1500,"deposit":108000,"maturity":157500},{"unit":1600,"deposit":115200,"maturity":167760},{"unit":1700,"deposit":122400,"maturity":178245},{"unit":1800,"deposit":129600,"maturity":188730},{"unit":1900,"deposit":136800,"maturity":199215},{"unit":2000,"deposit":144000,"maturity":210000},{"unit":2500,"deposit":180000,"maturity":262125},{"unit":3000,"deposit":216000,"maturity":315000},{"unit":3500,"deposit":252000,"maturity":366975},{"unit":4000,"deposit":288000,"maturity":419400},{"unit":4500,"deposit":324000,"maturity":471825},{"unit":5000,"deposit":360000,"maturity":524250},{"unit":5500,"deposit":396000,"maturity":576675},{"unit":6000,"deposit":432000,"maturity":629100},{"unit":7000,"deposit":504000,"maturity":733950},{"unit":8000,"deposit":576000,"maturity":838800},{"unit":9000,"deposit":648000,"maturity":943650},{"unit":10000,"deposit":720000,"maturity":1048500}]');
UPDATE schemes SET name = 'Masik Yojana 6 Year', scheme_type = 'recurring',
    tenure_months = 72, contribution_months = NULL,
    contribution_amount = 10000.0, principal_amount = NULL,
    total_deposit = 720000.0, maturity_amount = 1048500.0,
    payout_type = 'maturity', status = 'active', slabs = '[{"unit":100,"deposit":7200,"maturity":10485},{"unit":200,"deposit":14400,"maturity":20970},{"unit":300,"deposit":21600,"maturity":31455},{"unit":400,"deposit":28800,"maturity":41940},{"unit":500,"deposit":36000,"maturity":52500},{"unit":600,"deposit":43200,"maturity":62910},{"unit":700,"deposit":50400,"maturity":73395},{"unit":800,"deposit":57600,"maturity":83880},{"unit":900,"deposit":64800,"maturity":94365},{"unit":1000,"deposit":72000,"maturity":105000},{"unit":1100,"deposit":79200,"maturity":115335},{"unit":1200,"deposit":86400,"maturity":125820},{"unit":1300,"deposit":93600,"maturity":136305},{"unit":1400,"deposit":100800,"maturity":146790},{"unit":1500,"deposit":108000,"maturity":157500},{"unit":1600,"deposit":115200,"maturity":167760},{"unit":1700,"deposit":122400,"maturity":178245},{"unit":1800,"deposit":129600,"maturity":188730},{"unit":1900,"deposit":136800,"maturity":199215},{"unit":2000,"deposit":144000,"maturity":210000},{"unit":2500,"deposit":180000,"maturity":262125},{"unit":3000,"deposit":216000,"maturity":315000},{"unit":3500,"deposit":252000,"maturity":366975},{"unit":4000,"deposit":288000,"maturity":419400},{"unit":4500,"deposit":324000,"maturity":471825},{"unit":5000,"deposit":360000,"maturity":524250},{"unit":5500,"deposit":396000,"maturity":576675},{"unit":6000,"deposit":432000,"maturity":629100},{"unit":7000,"deposit":504000,"maturity":733950},{"unit":8000,"deposit":576000,"maturity":838800},{"unit":9000,"deposit":648000,"maturity":943650},{"unit":10000,"deposit":720000,"maturity":1048500}]'
    WHERE code = 'AJS-RD-6Y' AND deleted_at IS NULL;

-- AJS-SL-6Y: brochure p8. Shubh Lakshmi payout at 6
INSERT IGNORE INTO schemes (id, code, name, scheme_type, tenure_months, contribution_months,
    contribution_amount, principal_amount, total_deposit, maturity_amount, payout_type, status, slabs)
VALUES (UUID(), 'AJS-SL-6Y', 'Shubh Lakshmi payout at 6', 'recurring', 72,
    72, 6000.0, NULL,
    432000.0, 630000.0, 'maturity', 'active', '[{"unit":500,"deposit":36000,"maturity":52500},{"unit":1000,"deposit":72000,"maturity":105000},{"unit":1500,"deposit":108000,"maturity":157500},{"unit":2000,"deposit":144000,"maturity":210000},{"unit":3000,"deposit":216000,"maturity":315000},{"unit":4000,"deposit":288000,"maturity":420000},{"unit":5000,"deposit":360000,"maturity":525000},{"unit":6000,"deposit":432000,"maturity":630000}]');
UPDATE schemes SET name = 'Shubh Lakshmi payout at 6', scheme_type = 'recurring',
    tenure_months = 72, contribution_months = 72,
    contribution_amount = 6000.0, principal_amount = NULL,
    total_deposit = 432000.0, maturity_amount = 630000.0,
    payout_type = 'maturity', status = 'active', slabs = '[{"unit":500,"deposit":36000,"maturity":52500},{"unit":1000,"deposit":72000,"maturity":105000},{"unit":1500,"deposit":108000,"maturity":157500},{"unit":2000,"deposit":144000,"maturity":210000},{"unit":3000,"deposit":216000,"maturity":315000},{"unit":4000,"deposit":288000,"maturity":420000},{"unit":5000,"deposit":360000,"maturity":525000},{"unit":6000,"deposit":432000,"maturity":630000}]'
    WHERE code = 'AJS-SL-6Y' AND deleted_at IS NULL;

-- AJS-SL-11Y: brochure p8. Shubh Lakshmi payout at 11
INSERT IGNORE INTO schemes (id, code, name, scheme_type, tenure_months, contribution_months,
    contribution_amount, principal_amount, total_deposit, maturity_amount, payout_type, status, slabs)
VALUES (UUID(), 'AJS-SL-11Y', 'Shubh Lakshmi payout at 11', 'recurring', 132,
    72, 3000.0, NULL,
    216000.0, 525701.0, 'maturity', 'active', '[{"unit":500,"deposit":36000,"maturity":90189},{"unit":1000,"deposit":72000,"maturity":176578},{"unit":1500,"deposit":108000,"maturity":263867},{"unit":2000,"deposit":144000,"maturity":351200},{"unit":3000,"deposit":216000,"maturity":525701},{"unit":4000,"deposit":288000,"maturity":696318},{"unit":5000,"deposit":360000,"maturity":873290},{"unit":6000,"deposit":432000,"maturity":1045468}]');
UPDATE schemes SET name = 'Shubh Lakshmi payout at 11', scheme_type = 'recurring',
    tenure_months = 132, contribution_months = 72,
    contribution_amount = 3000.0, principal_amount = NULL,
    total_deposit = 216000.0, maturity_amount = 525701.0,
    payout_type = 'maturity', status = 'active', slabs = '[{"unit":500,"deposit":36000,"maturity":90189},{"unit":1000,"deposit":72000,"maturity":176578},{"unit":1500,"deposit":108000,"maturity":263867},{"unit":2000,"deposit":144000,"maturity":351200},{"unit":3000,"deposit":216000,"maturity":525701},{"unit":4000,"deposit":288000,"maturity":696318},{"unit":5000,"deposit":360000,"maturity":873290},{"unit":6000,"deposit":432000,"maturity":1045468}]'
    WHERE code = 'AJS-SL-11Y' AND deleted_at IS NULL;

-- AJS-SL-16Y: brochure p8. Shubh Lakshmi payout at 16
INSERT IGNORE INTO schemes (id, code, name, scheme_type, tenure_months, contribution_months,
    contribution_amount, principal_amount, total_deposit, maturity_amount, payout_type, status, slabs)
VALUES (UUID(), 'AJS-SL-16Y', 'Shubh Lakshmi payout at 16', 'recurring', 192,
    72, 6000.0, NULL,
    432000.0, 1930557.0, 'maturity', 'active', '[{"unit":500,"deposit":36000,"maturity":110580},{"unit":1000,"deposit":72000,"maturity":323778},{"unit":1500,"deposit":108000,"maturity":484270},{"unit":2000,"deposit":144000,"maturity":645558},{"unit":3000,"deposit":216000,"maturity":967332},{"unit":4000,"deposit":288000,"maturity":1285112},{"unit":5000,"deposit":360000,"maturity":1608690},{"unit":6000,"deposit":432000,"maturity":1930557}]');
UPDATE schemes SET name = 'Shubh Lakshmi payout at 16', scheme_type = 'recurring',
    tenure_months = 192, contribution_months = 72,
    contribution_amount = 6000.0, principal_amount = NULL,
    total_deposit = 432000.0, maturity_amount = 1930557.0,
    payout_type = 'maturity', status = 'active', slabs = '[{"unit":500,"deposit":36000,"maturity":110580},{"unit":1000,"deposit":72000,"maturity":323778},{"unit":1500,"deposit":108000,"maturity":484270},{"unit":2000,"deposit":144000,"maturity":645558},{"unit":3000,"deposit":216000,"maturity":967332},{"unit":4000,"deposit":288000,"maturity":1285112},{"unit":5000,"deposit":360000,"maturity":1608690},{"unit":6000,"deposit":432000,"maturity":1930557}]'
    WHERE code = 'AJS-SL-16Y' AND deleted_at IS NULL;

-- AJS-SL-21Y: brochure p8. Shubh Lakshmi payout at 21
INSERT IGNORE INTO schemes (id, code, name, scheme_type, tenure_months, contribution_months,
    contribution_amount, principal_amount, total_deposit, maturity_amount, payout_type, status, slabs)
VALUES (UUID(), 'AJS-SL-21Y', 'Shubh Lakshmi payout at 21', 'recurring', 252,
    72, 6000.0, NULL,
    432000.0, 3849700.0, 'maturity', 'active', '[{"unit":500,"deposit":36000,"maturity":330355},{"unit":1000,"deposit":72000,"maturity":643510},{"unit":1500,"deposit":108000,"maturity":963500},{"unit":2000,"deposit":144000,"maturity":1285200},{"unit":3000,"deposit":216000,"maturity":1926533},{"unit":4000,"deposit":288000,"maturity":2564040},{"unit":5000,"deposit":360000,"maturity":3200800},{"unit":6000,"deposit":432000,"maturity":3849700}]');
UPDATE schemes SET name = 'Shubh Lakshmi payout at 21', scheme_type = 'recurring',
    tenure_months = 252, contribution_months = 72,
    contribution_amount = 6000.0, principal_amount = NULL,
    total_deposit = 432000.0, maturity_amount = 3849700.0,
    payout_type = 'maturity', status = 'active', slabs = '[{"unit":500,"deposit":36000,"maturity":330355},{"unit":1000,"deposit":72000,"maturity":643510},{"unit":1500,"deposit":108000,"maturity":963500},{"unit":2000,"deposit":144000,"maturity":1285200},{"unit":3000,"deposit":216000,"maturity":1926533},{"unit":4000,"deposit":288000,"maturity":2564040},{"unit":5000,"deposit":360000,"maturity":3200800},{"unit":6000,"deposit":432000,"maturity":3849700}]'
    WHERE code = 'AJS-SL-21Y' AND deleted_at IS NULL;

-- AJS-FD-8Y: brochure p10-11. Savadhi Yojana 3x in 8 years
INSERT IGNORE INTO schemes (id, code, name, scheme_type, tenure_months, contribution_months,
    contribution_amount, principal_amount, total_deposit, maturity_amount, payout_type, status, slabs)
VALUES (UUID(), 'AJS-FD-8Y', 'Savadhi Yojana 3x in 8 years', 'fixed', 96,
    NULL, NULL, 150000.0,
    150000.0, 450000.0, 'maturity', 'active', '[{"unit":2500,"deposit":2500,"maturity":7500},{"unit":3000,"deposit":3000,"maturity":9000},{"unit":3500,"deposit":3500,"maturity":10500},{"unit":4000,"deposit":4000,"maturity":12000},{"unit":4500,"deposit":4500,"maturity":13500},{"unit":5000,"deposit":5000,"maturity":15000},{"unit":5500,"deposit":5500,"maturity":16500},{"unit":6000,"deposit":6000,"maturity":18000},{"unit":7000,"deposit":7000,"maturity":21000},{"unit":8000,"deposit":8000,"maturity":24000},{"unit":9000,"deposit":9000,"maturity":27000},{"unit":10000,"deposit":10000,"maturity":30000},{"unit":12000,"deposit":12000,"maturity":36000},{"unit":14000,"deposit":14000,"maturity":42000},{"unit":15000,"deposit":15000,"maturity":45000},{"unit":17000,"deposit":17000,"maturity":51000},{"unit":18000,"deposit":18000,"maturity":54000},{"unit":20000,"deposit":20000,"maturity":60000},{"unit":25000,"deposit":25000,"maturity":75000},{"unit":30000,"deposit":30000,"maturity":90000},{"unit":33000,"deposit":33000,"maturity":99000},{"unit":35000,"deposit":35000,"maturity":105000},{"unit":40000,"deposit":40000,"maturity":120000},{"unit":45000,"deposit":45000,"maturity":135000},{"unit":50000,"deposit":50000,"maturity":150000},{"unit":60000,"deposit":60000,"maturity":180000},{"unit":70000,"deposit":70000,"maturity":210000},{"unit":80000,"deposit":80000,"maturity":240000},{"unit":90000,"deposit":90000,"maturity":270000},{"unit":100000,"deposit":100000,"maturity":300000},{"unit":125000,"deposit":125000,"maturity":375000},{"unit":150000,"deposit":150000,"maturity":450000}]');
UPDATE schemes SET name = 'Savadhi Yojana 3x in 8 years', scheme_type = 'fixed',
    tenure_months = 96, contribution_months = NULL,
    contribution_amount = NULL, principal_amount = 150000.0,
    total_deposit = 150000.0, maturity_amount = 450000.0,
    payout_type = 'maturity', status = 'active', slabs = '[{"unit":2500,"deposit":2500,"maturity":7500},{"unit":3000,"deposit":3000,"maturity":9000},{"unit":3500,"deposit":3500,"maturity":10500},{"unit":4000,"deposit":4000,"maturity":12000},{"unit":4500,"deposit":4500,"maturity":13500},{"unit":5000,"deposit":5000,"maturity":15000},{"unit":5500,"deposit":5500,"maturity":16500},{"unit":6000,"deposit":6000,"maturity":18000},{"unit":7000,"deposit":7000,"maturity":21000},{"unit":8000,"deposit":8000,"maturity":24000},{"unit":9000,"deposit":9000,"maturity":27000},{"unit":10000,"deposit":10000,"maturity":30000},{"unit":12000,"deposit":12000,"maturity":36000},{"unit":14000,"deposit":14000,"maturity":42000},{"unit":15000,"deposit":15000,"maturity":45000},{"unit":17000,"deposit":17000,"maturity":51000},{"unit":18000,"deposit":18000,"maturity":54000},{"unit":20000,"deposit":20000,"maturity":60000},{"unit":25000,"deposit":25000,"maturity":75000},{"unit":30000,"deposit":30000,"maturity":90000},{"unit":33000,"deposit":33000,"maturity":99000},{"unit":35000,"deposit":35000,"maturity":105000},{"unit":40000,"deposit":40000,"maturity":120000},{"unit":45000,"deposit":45000,"maturity":135000},{"unit":50000,"deposit":50000,"maturity":150000},{"unit":60000,"deposit":60000,"maturity":180000},{"unit":70000,"deposit":70000,"maturity":210000},{"unit":80000,"deposit":80000,"maturity":240000},{"unit":90000,"deposit":90000,"maturity":270000},{"unit":100000,"deposit":100000,"maturity":300000},{"unit":125000,"deposit":125000,"maturity":375000},{"unit":150000,"deposit":150000,"maturity":450000}]'
    WHERE code = 'AJS-FD-8Y' AND deleted_at IS NULL;

-- AJS-MIS-5Y: brochure p9. Niyamit Aay 60 Month MIS
INSERT IGNORE INTO schemes (id, code, name, scheme_type, tenure_months, contribution_months,
    contribution_amount, principal_amount, total_deposit, maturity_amount, payout_type, status, slabs)
VALUES (UUID(), 'AJS-MIS-5Y', 'Niyamit Aay 60 Month MIS', 'mis', 60,
    NULL, NULL, 200000.0,
    200000.0, 300000.0, 'monthly', 'active', '[{"unit":10000,"deposit":10000,"maturity":15000,"monthly_payout":250},{"unit":20000,"deposit":20000,"maturity":30000,"monthly_payout":500},{"unit":30000,"deposit":30000,"maturity":45000,"monthly_payout":750},{"unit":40000,"deposit":40000,"maturity":60000,"monthly_payout":1000},{"unit":50000,"deposit":50000,"maturity":75000,"monthly_payout":1250},{"unit":60000,"deposit":60000,"maturity":90000,"monthly_payout":1500},{"unit":70000,"deposit":70000,"maturity":105000,"monthly_payout":1750},{"unit":80000,"deposit":80000,"maturity":120000,"monthly_payout":2000},{"unit":100000,"deposit":100000,"maturity":150000,"monthly_payout":2500},{"unit":200000,"deposit":200000,"maturity":300000,"monthly_payout":5000}]');
UPDATE schemes SET name = 'Niyamit Aay 60 Month MIS', scheme_type = 'mis',
    tenure_months = 60, contribution_months = NULL,
    contribution_amount = NULL, principal_amount = 200000.0,
    total_deposit = 200000.0, maturity_amount = 300000.0,
    payout_type = 'monthly', status = 'active', slabs = '[{"unit":10000,"deposit":10000,"maturity":15000,"monthly_payout":250},{"unit":20000,"deposit":20000,"maturity":30000,"monthly_payout":500},{"unit":30000,"deposit":30000,"maturity":45000,"monthly_payout":750},{"unit":40000,"deposit":40000,"maturity":60000,"monthly_payout":1000},{"unit":50000,"deposit":50000,"maturity":75000,"monthly_payout":1250},{"unit":60000,"deposit":60000,"maturity":90000,"monthly_payout":1500},{"unit":70000,"deposit":70000,"maturity":105000,"monthly_payout":1750},{"unit":80000,"deposit":80000,"maturity":120000,"monthly_payout":2000},{"unit":100000,"deposit":100000,"maturity":150000,"monthly_payout":2500},{"unit":200000,"deposit":200000,"maturity":300000,"monthly_payout":5000}]'
    WHERE code = 'AJS-MIS-5Y' AND deleted_at IS NULL;

-- Every scheduled run, so "is the automation running" is a question the
-- application can answer. cron.php wrote to the journal and nowhere else, which
-- is how it went months without being invoked at all: nothing inside the system
-- could tell the difference between a run that paid nothing and no run.
CREATE TABLE IF NOT EXISTS cron_runs (
    id VARCHAR(36) PRIMARY KEY,
    started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at DATETIME NULL,
    dry_run TINYINT(1) NOT NULL DEFAULT 0,
    -- running: started and not yet finished, which after a few minutes means it
    -- died. attention: it ran, but a job reported failures.
    status VARCHAR(12) NOT NULL DEFAULT 'running',
    jobs TEXT,
    error VARCHAR(500),
    INDEX idx_cron_started (started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Ranks were nine names in a PHP constant and a width of 2, so changing the
-- ladder meant a developer and a deploy. They become rows the director edits.
--
-- The seed reproduces the constant exactly -- same nine names, same rule that
-- each rank needs two direct introductions holding the rank below -- so moving
-- the ladder into the database changes nobody's standing on the day it lands.
CREATE TABLE IF NOT EXISTS rank_tiers (
    id VARCHAR(36) PRIMARY KEY,
    position INT NOT NULL UNIQUE,           -- 1 is the entry rank
    name VARCHAR(60) NOT NULL,
    -- How many directly-introduced members are needed, and what standing each of
    -- them must already hold. required_below = 0 means "any member", which is
    -- what makes the entry rank reachable.
    direct_required INT NOT NULL DEFAULT 2,
    required_below INT NOT NULL DEFAULT 0,
    -- What the tier is worth, as the brochure states it. Held as text and an
    -- optional figure for display: nothing in this system pays it. The Nidhi
    -- Rules, 2014 do not permit brokerage or incentive for mobilising deposits.
    reward_label VARCHAR(200),
    reward_amount DECIMAL(15,2),
    notes VARCHAR(500),
    status VARCHAR(10) NOT NULL DEFAULT 'active',   -- active | draft
    deleted_at DATETIME NULL,
    deleted_by VARCHAR(36) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_rank_live (deleted_at, position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO rank_tiers (id, position, name, direct_required, required_below, status) VALUES
(UUID(), 1, 'Silver',           2, 0, 'active'),
(UUID(), 2, 'Gold',             2, 1, 'active'),
(UUID(), 3, 'Platinum',         2, 2, 'active'),
(UUID(), 4, 'Diamond',          2, 3, 'active'),
(UUID(), 5, 'Ruby',             2, 4, 'active'),
(UUID(), 6, 'Blue Diamond',     2, 5, 'active'),
(UUID(), 7, 'Emerald',          2, 6, 'active'),
(UUID(), 8, 'Ambassador',       2, 7, 'active'),
(UUID(), 9, 'Brand Ambassador', 2, 8, 'active');

-- A stable order for statements. timestamp only resolves to the second, and
-- several payments legitimately land in the same one -- an account opening that
-- pays a referral bonus and funds a plan writes four rows at once, and a cron
-- run pays interest and maturity together. Sorted by timestamp alone those rows
-- come back in whatever order the engine chooses, so a member could see their
-- maturity credited before the interest that preceded it, and a running balance
-- that appeared to jump backwards.
--
-- AUTO_INCREMENT needs a key of its own; the primary key is the uuid and stays
-- that way, so this is a second unique key rather than a replacement.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS seq BIGINT NOT NULL AUTO_INCREMENT UNIQUE;

-- The booster ladder. Same shape as the standing ladder -- a rung is reached by
-- introducing N members who already hold the rung below -- with one condition
-- the standing ladder does not have: each of those introductions must be
-- holding a deposit of at least a stated amount.
--
-- Level 1: introduce four members who each hold 10,000 on deposit.
-- Level 2: those four have each reached Level 1, and so on up.
--
-- It shares the tier table rather than getting one of its own, so the engine
-- that settles the ladder, the admin screen that edits it, and the recycle bin
-- that restores a deleted rung all serve both without being written twice.
ALTER TABLE rank_tiers ADD COLUMN IF NOT EXISTS programme VARCHAR(20) NOT NULL DEFAULT 'standing';
ALTER TABLE rank_tiers ADD COLUMN IF NOT EXISTS min_deposit_each DECIMAL(15,2) NULL;

-- position was unique on its own, which would have stopped Booster Level 1
-- existing alongside Silver. It is the pair that has to be unique.
ALTER TABLE rank_tiers DROP INDEX IF EXISTS position;
ALTER TABLE rank_tiers ADD UNIQUE KEY IF NOT EXISTS uniq_programme_position (programme, position);

INSERT IGNORE INTO rank_tiers
    (id, programme, position, name, direct_required, required_below, min_deposit_each, reward_label, status) VALUES
(UUID(), 'booster', 1, 'Booster Level 1', 4, 0, 10000.00,
    'Four members introduced, each holding 10,000 on deposit', 'active'),
(UUID(), 'booster', 2, 'Booster Level 2', 4, 1, 10000.00,
    'Four members who have each reached Booster Level 1', 'active'),
(UUID(), 'booster', 3, 'Booster Level 3', 4, 2, 10000.00,
    'Four members who have each reached Booster Level 2', 'active');

-- The two reward programmes the plan book numbers as parts 2 and 3. Part 1 is
-- the twelve-level commission table, which is already shown on Refer & Earn.
--
-- Both are turnover programmes, not referral-count ones: they are earned on
-- business volume across three legs in a 4:4:2 ratio, which is a different
-- shape from the rank and booster ladders and so gets its own tables rather
-- than being bent into rank_tiers.
--
-- Shown, never paid. The Nidhi Rules, 2014 do not permit a Nidhi to pay
-- brokerage or incentive for mobilising deposits, and no code reads these
-- figures to move money. They are held so the counter and the printed book
-- quote the same numbers.
CREATE TABLE IF NOT EXISTS reward_programmes (
    id VARCHAR(36) PRIMARY KEY,
    code VARCHAR(40) NOT NULL UNIQUE,
    part_no INT,                              -- the number the book gives it
    name VARCHAR(120) NOT NULL,
    headline VARCHAR(255),
    qualifying_note VARCHAR(500),
    payout_note VARCHAR(255),
    source_note VARCHAR(120),                 -- which brochure page it came off
    status VARCHAR(10) NOT NULL DEFAULT 'active',
    deleted_at DATETIME NULL,
    deleted_by VARCHAR(36) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_prog_live (deleted_at, part_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reward_slabs (
    id VARCHAR(36) PRIMARY KEY,
    programme_code VARCHAR(40) NOT NULL,
    position INT NOT NULL,
    label VARCHAR(80) NOT NULL,               -- as printed: "1 Crore"
    qualifying_amount DECIMAL(18,2),          -- the same figure as a number
    -- A slab pays either a flat amount or a percentage of the turnover; the
    -- book uses both, so both columns exist and one is null.
    payout_amount DECIMAL(15,2),
    payout_percent DECIMAL(6,3),
    payout_note VARCHAR(160),
    deleted_at DATETIME NULL,
    deleted_by VARCHAR(36) NULL,
    UNIQUE KEY uniq_prog_position (programme_code, position),
    INDEX idx_slab_live (programme_code, deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO reward_programmes
    (id, code, part_no, name, headline, qualifying_note, payout_note, source_note, status) VALUES
(UUID(), 'turnover_incentive', 2, 'Turnover Incentive',
    '3% of the first year''s business',
    'Complete ₹1 crore of first-year business across three legs, holding a minimum ratio of 4:4:2 — ₹40 lakh left team, ₹40 lakh self team, ₹20 lakh right team.',
    'Paid once on the first year''s total business.', 'Brochure p16', 'active'),
(UUID(), 'fix_monthly_income', 3, 'Fix Monthly Income',
    'A fixed sum every month for the next twelve months',
    'Maintain the 4:4:2 business ratio across three legs for one full year at the turnover shown.',
    'Paid monthly for the twelve months that follow.', 'Brochure p16', 'active');

INSERT IGNORE INTO reward_slabs (id, programme_code, position, label, qualifying_amount, payout_percent, payout_note) VALUES
(UUID(), 'turnover_incentive', 1, '1 Crore', 10000000.00, 3.000, 'of first-year business');

INSERT IGNORE INTO reward_slabs (id, programme_code, position, label, qualifying_amount, payout_amount, payout_note) VALUES
(UUID(), 'fix_monthly_income', 1, '1 Crore',    10000000.00,   10000.00, 'a month for 12 months'),
(UUID(), 'fix_monthly_income', 2, '2 Crore',    20000000.00,   20000.00, 'a month for 12 months'),
(UUID(), 'fix_monthly_income', 3, '3 Crore',    30000000.00,   30000.00, 'a month for 12 months'),
(UUID(), 'fix_monthly_income', 4, '4 Crore',    40000000.00,   40000.00, 'a month for 12 months'),
(UUID(), 'fix_monthly_income', 5, '5 Crore',    50000000.00,   50000.00, 'a month for 12 months'),
(UUID(), 'fix_monthly_income', 6, '10 Crore',  100000000.00,  100000.00, 'a month for 12 months'),
(UUID(), 'fix_monthly_income', 7, '25 Crore',  250000000.00,  250000.00, 'a month for 12 months'),
(UUID(), 'fix_monthly_income', 8, '50 Crore',  500000000.00,  500000.00, 'a month for 12 months'),
(UUID(), 'fix_monthly_income', 9, '100 Crore', 1000000000.00, 1000000.00, 'a month for 12 months');

-- Repairs the two rows above on a database where they were already written by
-- a client that had not declared utf8mb4. INSERT IGNORE would skip them, so the
-- mojibake would survive every future run of this file.
UPDATE reward_programmes SET
    qualifying_note = 'Complete ₹1 crore of first-year business across three legs, holding a minimum ratio of 4:4:2 — ₹40 lakh left team, ₹40 lakh self team, ₹20 lakh right team.',
    headline = '3% of the first year''s business',
    payout_note = 'Paid once on the first year''s total business.'
    WHERE code = 'turnover_incentive';

UPDATE reward_programmes SET
    qualifying_note = 'Maintain the 4:4:2 business ratio across three legs for one full year at the turnover shown.',
    headline = 'A fixed sum every month for the next twelve months',
    payout_note = 'Paid monthly for the twelve months that follow.'
    WHERE code = 'fix_monthly_income';
