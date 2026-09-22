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
