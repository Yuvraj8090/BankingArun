<?php
// AJSPay: the reporting desk.
//
// One registry describes every report: who may run it, what it selects, which
// filters it accepts and how each column is formatted. The runner does the rest
// — paging on screen, CSV or Excel on download, the same numbers either way.
//
// Two properties are deliberate. Filters are always bound as parameters, never
// interpolated, so a report cannot become an injection surface however it is
// filtered. And every export is written to the audit log with its row count,
// because a report download is the easiest way to walk out with the member book.
declare(strict_types=1);

// Who may open the reports area at all. Each report then names its own roles,
// so a loan officer reaching this list sees only the loan register.
const REPORT_ROLES = ['staff', 'loan_officer', 'admin', 'branch_manager', 'bank_owner'];
const REPORT_EXPORT_MAX = 20000;   // rows in a single download

// Column formats: 'text', 'money', 'date', 'datetime', 'int'.
// One row of NDH return figures as they stand now. reports.php shows it live and
// cron.php stores it each day into ndh_snapshots, so the two cannot drift apart.
const NDH_COLUMNS = ['members', 'share_capital', 'savings_deposits', 'fixed_deposits', 'recurring_deposits',
    'gold_loans', 'property_loans', 'deposit_loans', 'npa_loans', 'net_owned_funds', 'branches'];
const NDH_FIGURES_SQL = "SELECT
    (SELECT COUNT(*) FROM member_register WHERE status = 'active') AS members,
    (SELECT COALESCE(SUM(shares_held * share_face_value), 0) FROM member_register WHERE status = 'active') AS share_capital,
    (SELECT COALESCE(SUM(balance), 0) FROM accounts) AS savings_deposits,
    (SELECT COALESCE(SUM(paid_amount), 0) FROM deposits WHERE status = 'active' AND instalment_amount IS NULL) AS fixed_deposits,
    (SELECT COALESCE(SUM(paid_amount), 0) FROM deposits WHERE status = 'active' AND instalment_amount IS NOT NULL) AS recurring_deposits,
    (SELECT COALESCE(SUM(outstanding), 0) FROM loans WHERE status <> 'closed' AND loan_type = 'gold') AS gold_loans,
    (SELECT COALESCE(SUM(outstanding), 0) FROM loans WHERE status <> 'closed' AND loan_type = 'home') AS property_loans,
    (SELECT COALESCE(SUM(outstanding), 0) FROM loans WHERE status <> 'closed' AND loan_type = 'deposit') AS deposit_loans,
    (SELECT COALESCE(SUM(outstanding), 0) FROM loans WHERE status = 'npa') AS npa_loans,
    (SELECT COALESCE(MAX(value), 0) FROM system_parameters WHERE param_key = 'net_owned_funds') AS net_owned_funds,
    (SELECT COUNT(*) FROM branches WHERE deleted_at IS NULL) AS branches";

// Today's NDH figures into ndh_snapshots. Later runs the same day overwrite it, so
// the row a date keeps is that day's last run (21:30 IST): close of business.
function record_ndh_snapshot(string $today): void
{
    $update = implode(', ', array_map(fn($c) => "$c = VALUES($c)", NDH_COLUMNS));
    global $pdo;
    $pdo->prepare('INSERT INTO ndh_snapshots (as_on, ' . implode(', ', NDH_COLUMNS) . ') SELECT ?, f.* FROM ('
        . NDH_FIGURES_SQL . ") f ON DUPLICATE KEY UPDATE $update, taken_at = NOW()")->execute([$today]);
}

function report_definitions(): array
{
    // An instalment plan (Masik / Daily Yojana) stores the contracted total as
    // principal_amount and what has actually come in as paid_amount (the booking
    // plus every instalment run_instalments has taken). A lump sum is paid in full,
    // so for it the two are equal.
    $instalment = "(d.instalment_amount IS NOT NULL)";
    $kind = "CASE WHEN $instalment THEN 'instalment' ELSE 'lump sum' END";
    // The enquiry rows below skip a lead who has since booked that plan under the same mobile number.
    $dailyEarning = "CASE WHEN d.interest_payout = 'daily' AND d.status = 'active'
        THEN ROUND(d.principal_amount * d.interest_rate / 100 / 365, 2) ELSE 0 END";
    $collected = "d.paid_amount";
    return [
        // The statutory one: who the members are. The Nidhi Rules turn on this.
        // Periodic KYC refresh (RBI KYC Master Direction, applied to Nidhis for AML):
        // high risk every 2 years, medium every 8, low every 10; next_kyc_review is set
        // when a member is rated (apply_risk, modules/register.php).
        'kyc_reviews' => [
            'name' => 'KYC reviews due',
            'note' => 'Members whose periodic KYC refresh is due or overdue, by risk. Collect fresh documents, verify them, then re-rate the member in Screening.',
            'roles' => ['staff', 'admin', 'branch_manager', 'bank_owner'],
            'sql' => "SELECT m.folio_no, u.name, u.phone, m.risk_category, m.next_kyc_review, u.kyc_status,
                    CASE WHEN m.next_kyc_review < CURDATE() THEN 'overdue' ELSE 'due within 30 days' END AS due_state
                FROM member_register m JOIN users u ON u.id = m.user_id
                WHERE m.status = 'active' AND m.next_kyc_review <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)",
            'filters' => ['q' => ['u.name LIKE ? OR m.folio_no LIKE ? OR u.phone LIKE ?', 'like3'],
                'risk_category' => ['m.risk_category = ?', 'exact']],
            'order' => 'm.next_kyc_review',
            'columns' => ['folio_no' => 'text', 'name' => 'text', 'phone' => 'text', 'risk_category' => 'text',
                'next_kyc_review' => 'date', 'due_state' => 'text', 'kyc_status' => 'text'],
        ],
        'member_register' => [
            'name' => 'Member register',
            'note' => 'Every member, when they joined and what they hold (deposits = money actually collected, not the committed total of an instalment plan). Required under the Nidhi Rules, 2014.',
            'roles' => ['admin', 'branch_manager', 'bank_owner'],
            'sql' => "SELECT u.id, u.name, u.email, u.phone, u.role, u.branch, u.kyc_status, u.created_at,
                    (SELECT COUNT(*) FROM accounts a WHERE a.user_id = u.id) AS accounts,
                    (SELECT COALESCE(SUM(a.balance), 0) FROM accounts a WHERE a.user_id = u.id) AS balances,
                    (SELECT COALESCE(SUM($collected), 0) FROM deposits d
                        WHERE d.user_id = u.id AND d.status = 'active') AS deposits
                FROM users u WHERE u.role IN ('retail', 'corporate')",
            'filters' => ['q' => ['u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?', 'like3'],
                'kyc_status' => ['u.kyc_status = ?', 'exact'],
                'from_date' => ['u.created_at >= ?', 'date_start'],
                'to_date' => ['u.created_at <= ?', 'date_end']],
            'order' => 'u.name',
            'columns' => ['name' => 'text', 'email' => 'text', 'phone' => 'text', 'role' => 'text',
                'branch' => 'text', 'kyc_status' => 'text', 'accounts' => 'int', 'balances' => 'money',
                'deposits' => 'money', 'created_at' => 'date'],
            'totals' => ['balances', 'deposits'],
        ],
        'deposit_register' => [
            'name' => 'Deposit register',
            'note' => 'Every deposit with its plan, rate, maturity, interest paid, interest still held back and TDS withheld. '
                . 'Committed is what the deposit is for; collected is what has actually been received (an instalment '
                . 'plan is collected a little at a time). Filter by plan code to list everyone enrolled in one plan.',
            'roles' => ['admin', 'branch_manager', 'bank_owner'],
            'sql' => "SELECT d.deposit_number, u.name AS member, d.source_account AS account, d.scheme_code AS plan,
                    d.deposit_type, $kind AS kind, d.principal_amount AS committed_amount,
                    $collected AS collected_amount,
                    d.interest_rate, d.tenure_months, d.interest_payout, d.maturity_amount, d.maturity_date,
                    d.interest_paid, d.accrued_interest, d.tds_deducted,
                    $dailyEarning AS daily_earning, d.interest_paid + d.accrued_interest AS earned_total,
                    (SELECT MAX(t.timestamp) FROM transactions t
                        WHERE t.user_id = d.user_id AND t.type = 'credit' AND t.mode = 'DEPOSIT_INTEREST'
                          AND t.ref_number LIKE CONCAT('%-', d.deposit_number, '-%')) AS last_credited,
                    d.last_payout_date AS last_accrued, d.status, d.created_at
                FROM deposits d JOIN users u ON u.id = d.user_id WHERE 1 = 1",
            'filters' => ['status' => ['d.status = ?', 'exact'],
                'deposit_type' => ['d.deposit_type = ?', 'exact'],
                'scheme_code' => ['d.scheme_code = ?', 'exact'],
                'q' => ['d.deposit_number LIKE ? OR u.name LIKE ?', 'like2'],
                'from_date' => ['d.created_at >= ?', 'date_start'],
                'to_date' => ['d.created_at <= ?', 'date_end']],
            'order' => 'd.maturity_date',
            'columns' => ['deposit_number' => 'text', 'member' => 'text', 'account' => 'text', 'plan' => 'text',
                'deposit_type' => 'text', 'kind' => 'text',
                'committed_amount' => 'money', 'collected_amount' => 'money',
                'interest_rate' => 'text', 'tenure_months' => 'int',
                'interest_payout' => 'text', 'maturity_amount' => 'money', 'maturity_date' => 'date',
                'interest_paid' => 'money', 'accrued_interest' => 'money', 'tds_deducted' => 'money',
                'daily_earning' => 'money', 'earned_total' => 'money',
                'last_credited' => 'datetime', 'last_accrued' => 'date', 'status' => 'text'],
            'totals' => ['committed_amount', 'collected_amount', 'maturity_amount', 'interest_paid',
                'accrued_interest', 'tds_deducted', 'earned_total'],
        ],
        // Everyone connected to a plan in one list, so "who took it" and "who is
        // still pending" are one question. Deposits are the people who booked
        // (with interest held back flagged as 'interest pending'); enquiries are
        // CRM leads who named a plan but have not enrolled; and anyone awaiting
        // KYC is listed too -- they have no plan yet, so a plan filter keeps them
        // in view (state = 'waiting KYC') rather than hiding the people it exists to show.
        'plan_enrolment' => [
            'name' => 'Plan enrolment',
            'note' => 'Members who took a plan, plus the people still pending: interest earned but not yet paid out, '
                . 'enquiries that have not booked, and members waiting on KYC. Committed is what a deposit is for; '
                . 'collected is what has actually been received. Filter by plan code.',
            'roles' => ['admin', 'branch_manager', 'bank_owner'],
            'sql' => "SELECT * FROM (
                    SELECT u.name AS name, u.phone AS phone, d.source_account AS account, d.scheme_code AS plan,
                        CASE WHEN d.status = 'active' AND d.accrued_interest > 0 THEN 'interest pending'
                             WHEN d.status = 'active' THEN 'enrolled' ELSE d.status END AS state,
                        $kind AS kind,
                        d.deposit_number AS deposit_number, d.principal_amount AS committed_amount,
                        $collected AS collected_amount,
                        d.interest_paid AS interest_paid, d.accrued_interest AS accrued_interest,
                        d.tds_deducted AS tds_deducted,
                        $dailyEarning AS daily_earning, d.interest_paid + d.accrued_interest AS earned_total,
                        (SELECT MAX(t.timestamp) FROM transactions t
                        WHERE t.user_id = d.user_id AND t.type = 'credit' AND t.mode = 'DEPOSIT_INTEREST'
                          AND t.ref_number LIKE CONCAT('%-', d.deposit_number, '-%')) AS last_credited,
                        d.last_payout_date AS last_accrued, d.created_at AS since
                    FROM deposits d JOIN users u ON u.id = d.user_id
                    UNION ALL
                    SELECT l.name, l.phone, NULL, l.scheme_code, 'enquired, not booked', NULL, NULL, 0, 0, 0, 0, 0, 0, 0, NULL, NULL, l.created_at
                    FROM crm_leads l WHERE l.scheme_code IS NOT NULL AND l.stage NOT IN ('enrolled', 'lost')
                      AND NOT EXISTS (SELECT 1 FROM deposits d2 JOIN users u2 ON u2.id = d2.user_id
                          WHERE d2.scheme_code = l.scheme_code
                            AND RIGHT(REPLACE(REPLACE(REPLACE(u2.phone, ' ', ''), '-', ''), '+', ''), 10)
                              = RIGHT(REPLACE(REPLACE(REPLACE(l.phone, ' ', ''), '-', ''), '+', ''), 10))
                    UNION ALL
                    SELECT u.name, u.phone,
                        (SELECT a.account_number FROM accounts a WHERE a.user_id = u.id ORDER BY a.created_at LIMIT 1),
                        NULL, 'waiting KYC', NULL, NULL, 0, 0, 0, 0, 0, 0, 0, NULL, NULL, u.created_at
                    FROM users u WHERE u.role = 'retail' AND u.kyc_status = 'pending_approval'
                ) p WHERE 1 = 1",
            'filters' => ['plan' => ["p.plan = ? OR p.state = 'waiting KYC'", 'exact'],
                'state' => ['p.state = ?', 'exact'],
                'q' => ['p.name LIKE ? OR p.phone LIKE ?', 'like2'],
                'from_date' => ['p.since >= ?', 'date_start'],
                'to_date' => ['p.since <= ?', 'date_end']],
            'order' => 'p.since DESC',
            'columns' => ['name' => 'text', 'phone' => 'text', 'account' => 'text', 'plan' => 'text',
                'state' => 'text', 'kind' => 'text', 'deposit_number' => 'text',
                'committed_amount' => 'money', 'collected_amount' => 'money',
                'interest_paid' => 'money', 'accrued_interest' => 'money', 'tds_deducted' => 'money',
                'daily_earning' => 'money', 'earned_total' => 'money',
                'last_credited' => 'datetime', 'last_accrued' => 'date', 'since' => 'date'],
            'totals' => ['committed_amount', 'collected_amount', 'interest_paid', 'accrued_interest', 'tds_deducted',
                'earned_total'],
        ],
        'loan_register' => [
            'name' => 'Loan register',
            'note' => 'Applications with their EMI and the risk grade the AI module assigned.',
            'roles' => ['loan_officer', 'admin', 'branch_manager', 'bank_owner'],
            'sql' => 'SELECT l.loan_application_no, l.applicant, l.loan_type, l.amount, l.roi, l.tenure_months,
                    l.calculated_emi, l.monthly_income, l.risk_grade, l.risk_score, l.eligibility_status,
                    l.status, l.created_at
                FROM loan_applications l WHERE 1 = 1',
            'filters' => ['status' => ['l.status = ?', 'exact'], 'loan_type' => ['l.loan_type = ?', 'exact'],
                'risk_grade' => ['l.risk_grade = ?', 'exact'],
                'q' => ['l.loan_application_no LIKE ? OR l.applicant LIKE ?', 'like2'],
                'from_date' => ['l.created_at >= ?', 'date_start'],
                'to_date' => ['l.created_at <= ?', 'date_end']],
            'order' => 'l.created_at DESC',
            'columns' => ['loan_application_no' => 'text', 'applicant' => 'text', 'loan_type' => 'text',
                'amount' => 'money', 'roi' => 'text', 'tenure_months' => 'int', 'calculated_emi' => 'money',
                'monthly_income' => 'money', 'risk_grade' => 'text', 'risk_score' => 'int',
                'eligibility_status' => 'text', 'status' => 'text', 'created_at' => 'date'],
            'totals' => ['amount', 'calculated_emi'],
        ],
        'transaction_ledger' => [
            'name' => 'Transaction ledger',
            'note' => 'Every entry across all members, for reconciliation.',
            'roles' => ['admin', 'branch_manager', 'bank_owner'],
            'sql' => 'SELECT t.timestamp, t.ref_number, u.name AS member, t.account_number, t.type, t.mode,
                    t.amount, t.balance_after, t.counterparty_name, t.description
                FROM transactions t JOIN users u ON u.id = t.user_id WHERE 1 = 1',
            'filters' => ['type' => ['t.type = ?', 'exact'], 'mode' => ['t.mode = ?', 'exact'],
                'account_number' => ['t.account_number = ?', 'exact'],
                'min_amount' => ['t.amount >= ?', 'number'], 'max_amount' => ['t.amount <= ?', 'number'],
                'q' => ['t.ref_number LIKE ? OR t.counterparty_name LIKE ? OR u.name LIKE ?', 'like3'],
                'from_date' => ['t.timestamp >= ?', 'date_start'],
                'to_date' => ['t.timestamp <= ?', 'date_end']],
            'order' => 't.timestamp DESC',
            'columns' => ['timestamp' => 'datetime', 'ref_number' => 'text', 'member' => 'text',
                'account_number' => 'text', 'type' => 'text', 'mode' => 'text', 'amount' => 'money',
                'balance_after' => 'money', 'counterparty_name' => 'text', 'description' => 'text'],
            'totals' => ['amount'],
        ],
        'agent_collections' => [
            'name' => 'Agent collections',
            'note' => 'What each agent collected. Recorded for traceability; no commission is derived from it.',
            'roles' => REPORT_ROLES,
            'sql' => 'SELECT c.collected_on, a.code AS agent_code, a.name AS agent, c.account_number,
                    u.name AS member, s.code AS scheme, c.amount, c.receipt_no
                FROM agent_collections c
                JOIN agents a ON a.id = c.agent_id
                LEFT JOIN users u ON u.id = c.member_user_id
                LEFT JOIN schemes s ON s.id = c.scheme_id WHERE 1 = 1',
            'filters' => ['agent_id' => ['c.agent_id = ?', 'exact'],
                'q' => ['a.name LIKE ? OR c.account_number LIKE ?', 'like2'],
                'from_date' => ['c.collected_on >= ?', 'date_only'],
                'to_date' => ['c.collected_on <= ?', 'date_only']],
            'order' => 'c.collected_on DESC',
            'columns' => ['collected_on' => 'date', 'agent_code' => 'text', 'agent' => 'text',
                'account_number' => 'text', 'member' => 'text', 'scheme' => 'text', 'amount' => 'money',
                'receipt_no' => 'text'],
            'totals' => ['amount'],
        ],
        'support_sla' => [
            'name' => 'Support and grievance performance',
            'note' => 'Tickets with their deadline and whether it was met — the Consumer Protection evidence.',
            'roles' => REPORT_ROLES,
            'sql' => "SELECT t.ticket_id, t.user_name AS member, t.category, t.subject, t.priority, t.status,
                    t.assigned_to, t.created_at, t.due_at, t.first_response_at, t.resolved_at,
                    CASE WHEN t.resolved_at IS NOT NULL AND t.due_at IS NOT NULL AND t.resolved_at <= t.due_at
                        THEN 'Met'
                         WHEN t.resolved_at IS NOT NULL THEN 'Breached'
                         WHEN t.due_at < UTC_TIMESTAMP() THEN 'Overdue' ELSE 'In time' END AS sla
                FROM support_tickets t WHERE 1 = 1",
            'filters' => ['status' => ['t.status = ?', 'exact'], 'priority' => ['t.priority = ?', 'exact'],
                'q' => ['t.ticket_id LIKE ? OR t.subject LIKE ?', 'like2'],
                'from_date' => ['t.created_at >= ?', 'date_start'],
                'to_date' => ['t.created_at <= ?', 'date_end']],
            'order' => 't.created_at DESC',
            'columns' => ['ticket_id' => 'text', 'member' => 'text', 'category' => 'text', 'subject' => 'text',
                'priority' => 'text', 'status' => 'text', 'assigned_to' => 'text', 'created_at' => 'datetime',
                'due_at' => 'datetime', 'resolved_at' => 'datetime', 'sla' => 'text'],
            'totals' => [],
        ],
        'fraud_alerts' => [
            'name' => 'AML alert register',
            'note' => 'Scored transfers and how each was dispositioned. Supporting record for STR reporting.',
            'roles' => ['admin', 'branch_manager', 'bank_owner'],
            'sql' => 'SELECT f.created_at, f.ref_number, u.name AS member, f.account_number, f.amount, f.score,
                    f.severity, f.status, f.review_note, f.reviewed_at
                FROM fraud_alerts f LEFT JOIN users u ON u.id = f.user_id WHERE 1 = 1',
            'filters' => ['status' => ['f.status = ?', 'exact'], 'severity' => ['f.severity = ?', 'exact'],
                'min_amount' => ['f.amount >= ?', 'number'],
                'from_date' => ['f.created_at >= ?', 'date_start'],
                'to_date' => ['f.created_at <= ?', 'date_end']],
            'order' => 'f.score DESC, f.created_at DESC',
            'columns' => ['created_at' => 'datetime', 'ref_number' => 'text', 'member' => 'text',
                'account_number' => 'text', 'amount' => 'money', 'score' => 'int', 'severity' => 'text',
                'status' => 'text', 'review_note' => 'text'],
            'totals' => ['amount'],
        ],
        // PMLA, 2002 / FIU-IND: a cash transaction report covers cash of ₹10 lakh or more
        // in one month for one member (single or connected deposits). This is the data
        // the Principal Officer keys into FIU-IND's FINnet utility; it is not the XML itself.
        'fiu_ctr' => [
            'name' => 'FIU-IND cash transactions (CTR)',
            'note' => 'Members whose cash paid in reached ₹10,00,000 or more in a calendar month: counter cash, and cash paid in when an account was opened. File with FIU-IND by the 15th of the next month.',
            'roles' => ['admin', 'branch_manager', 'bank_owner'],
            'sql' => "SELECT * FROM (SELECT DATE_FORMAT(t.timestamp, '%Y-%m') AS month, u.name, u.pan_number,
                    t.account_number, COUNT(*) AS cash_entries, SUM(t.amount) AS cash_total
                FROM transactions t JOIN users u ON u.id = t.user_id
                WHERE t.type = 'credit' AND ((t.mode = 'COUNTER_DEPOSIT' AND t.description LIKE 'Cash%')
                    OR t.mode = 'ACCOUNT_OPENING')
                GROUP BY month, t.user_id, t.account_number, u.name, u.pan_number
                HAVING SUM(t.amount) >= 1000000) c WHERE 1 = 1",
            'filters' => ['month' => ['c.month = ?', 'exact'], 'q' => ['c.name LIKE ? OR c.account_number LIKE ? OR c.pan_number LIKE ?', 'like3']],
            'order' => 'c.month DESC, c.cash_total DESC',
            'columns' => ['month' => 'text', 'name' => 'text', 'pan_number' => 'text', 'account_number' => 'text',
                'cash_entries' => 'int', 'cash_total' => 'money'],
            'totals' => ['cash_total'],
        ],
        // Suspicious transactions the review desk escalated: what goes to FIU-IND as an STR
        // within 7 days of the decision. Members are never told (tipping off is an offence).
        'fiu_str' => [
            'name' => 'FIU-IND suspicious transactions (STR)',
            'note' => 'Alerts escalated after review, with the reasons. File each with FIU-IND within 7 days of escalation. Never tell the member.',
            'roles' => ['admin', 'branch_manager', 'bank_owner'],
            'sql' => "SELECT f.reviewed_at, u.name, u.pan_number, f.account_number, f.ref_number, f.amount,
                    f.counterparty_name, f.score, f.reasons, f.review_note
                FROM fraud_alerts f LEFT JOIN users u ON u.id = f.user_id WHERE f.status = 'escalated'",
            'filters' => ['from_date' => ['f.reviewed_at >= ?', 'date_start'], 'to_date' => ['f.reviewed_at <= ?', 'date_end']],
            'order' => 'f.reviewed_at DESC',
            'columns' => ['reviewed_at' => 'datetime', 'name' => 'text', 'pan_number' => 'text', 'account_number' => 'text',
                'ref_number' => 'text', 'amount' => 'money', 'counterparty_name' => 'text', 'score' => 'int',
                'reasons' => 'text', 'review_note' => 'text'],
            'totals' => ['amount'],
        ],
        // The figures Form NDH-1 (yearly, within 90 days of the year end) and NDH-3
        // (half-yearly, within 30 days) ask for. Today's row is live; earlier rows are
        // the snapshot cron.php keeps each day, so 31 March and 30 September can be
        // pulled up after the date has passed.
        'ndh_figures' => [
            'name' => 'Nidhi return figures (NDH-1 / NDH-3)',
            'note' => 'Members, share capital, deposits, loans and the net owned funds test: today live, earlier days as recorded that night. Set Period to "half-year ends" for 31 March and 30 September, and copy those figures into the MCA form.',
            'roles' => ['admin', 'branch_manager', 'bank_owner'],
            'sql' => 'SELECT * FROM (SELECT CURDATE() AS as_on, f.* FROM (' . NDH_FIGURES_SQL . ') f
                UNION ALL SELECT as_on, ' . implode(', ', NDH_COLUMNS) . ' FROM ndh_snapshots WHERE as_on < CURDATE()) n WHERE 1 = 1',
            'filters' => ['from_date' => ['n.as_on >= ?', 'date_only'], 'to_date' => ['n.as_on <= ?', 'date_only'],
                'period' => ["DATE_FORMAT(n.as_on, '%m-%d') IN ('03-31', '09-30') AND ? <> ''", 'exact']],
            'order' => 'n.as_on DESC',
            'columns' => ['as_on' => 'date', 'members' => 'int', 'share_capital' => 'money', 'savings_deposits' => 'money',
                'fixed_deposits' => 'money', 'recurring_deposits' => 'money', 'gold_loans' => 'money',
                'property_loans' => 'money', 'deposit_loans' => 'money', 'npa_loans' => 'money', 'net_owned_funds' => 'money', 'branches' => 'int'],
            'totals' => [],
        ],
        'audit_trail' => [
            'name' => 'Audit trail',
            'note' => 'Who did what, and from where.',
            'roles' => ['admin', 'branch_manager', 'bank_owner'],
            'sql' => 'SELECT timestamp, email, action, details, ip FROM audit_logs WHERE 1 = 1',
            'filters' => ['action' => ['action = ?', 'exact'],
                'q' => ['email LIKE ? OR details LIKE ?', 'like2'],
                'from_date' => ['timestamp >= ?', 'date_start'],
                'to_date' => ['timestamp <= ?', 'date_end']],
            'order' => 'timestamp DESC',
            'columns' => ['timestamp' => 'datetime', 'email' => 'text', 'action' => 'text',
                'details' => 'text', 'ip' => 'text'],
            'totals' => [],
        ],
    ];
}

// Builds the WHERE tail from whichever filters were supplied, binding every one.
function report_where(array $definition, array $query): array
{
    $sql = '';
    $params = [];
    $applied = [];
    foreach ($definition['filters'] as $key => [$clause, $kind]) {
        $raw = $query[$key] ?? '';
        if ($raw === '' || $raw === null) {
            continue;
        }
        $sql .= " AND ($clause)";
        $applied[$key] = $raw;
        switch ($kind) {
            case 'like2':
                $like = '%' . clip($raw, 60) . '%';
                array_push($params, $like, $like);
                break;
            case 'like3':
                $like = '%' . clip($raw, 60) . '%';
                array_push($params, $like, $like, $like);
                break;
            case 'date_start':
                $params[] = valid_date($raw, $key) . ' 00:00:00';
                break;
            case 'date_end':
                $params[] = valid_date($raw, $key) . ' 23:59:59';
                break;
            case 'date_only':
                $params[] = valid_date($raw, $key);
                break;
            case 'number':
                $params[] = money($raw);
                break;
            default:
                $params[] = clip($raw, 100);
        }
    }
    return [$sql, $params, $applied];
}

function report_or_fail(string $key, array $staff): array
{
    $definitions = report_definitions();
    $definition = $definitions[$key] ?? null;
    if ($definition === null) {
        fail(404, 'No such report.');
    }
    if (!in_array($staff['role'], $definition['roles'], true)) {
        fail(403, 'Your role cannot run the ' . $definition['name'] . '.');
    }
    return $definition;
}

function report_value(mixed $value, string $format): mixed
{
    if ($value === null) {
        return null;
    }
    return match ($format) {
        'money' => round((float)$value, 2),
        'int' => (int)$value,
        'datetime' => iso((string)$value),
        default => $value,
    };
}

function route_reports_list(array $d): void
{
    $staff = staff_user(REPORT_ROLES);
    $available = [];
    foreach (report_definitions() as $key => $definition) {
        if (in_array($staff['role'], $definition['roles'], true)) {
            $available[] = ['key' => $key, 'name' => $definition['name'], 'note' => $definition['note'],
                'filters' => array_keys($definition['filters']),
                'columns' => array_keys($definition['columns'])];
        }
    }
    respond(['reports' => $available]);
}

function route_report_run(array $d, string $key = ''): void
{
    $staff = staff_user(REPORT_ROLES);
    $definition = report_or_fail($key, $staff);
    [$where, $params, $applied] = report_where($definition, $_GET);

    // Sorting is restricted to the report's own columns, so the order clause can
    // never carry anything the caller wrote.
    $order = $definition['order'];
    $sortKey = $_GET['sort'] ?? '';
    if ($sortKey !== '' && array_key_exists($sortKey, $definition['columns'])) {
        $direction = strtolower($_GET['dir'] ?? 'asc') === 'desc' ? 'DESC' : 'ASC';
        $order = "$sortKey $direction";
    }
    [$rows, $meta] = paginate($definition['sql'] . $where . " ORDER BY $order", $params, 50, 200);

    $out = [];
    foreach ($rows as $row) {
        $line = [];
        foreach ($definition['columns'] as $column => $format) {
            $line[$column] = report_value($row[$column] ?? null, $format);
        }
        $out[] = $line;
    }
    // Totals cover the whole filtered set, not just the page on screen.
    $totals = [];
    foreach ($definition['totals'] as $column) {
        $totals[$column] = (float)scalar(
            "SELECT COALESCE(SUM($column), 0) FROM ({$definition['sql']}$where) AS t", $params);
    }
    respond(['report' => ['key' => $key, 'name' => $definition['name'], 'note' => $definition['note']],
        'columns' => $definition['columns'], 'rows' => $out, 'pagination' => $meta,
        'totals' => (object)$totals, 'filters_applied' => (object)$applied]);
}

function route_report_export(array $d, string $key = ''): void
{
    $staff = staff_user(REPORT_ROLES);
    $definition = report_or_fail($key, $staff);
    [$where, $params, $applied] = report_where($definition, $_GET);
    $rows = rows($definition['sql'] . $where . " ORDER BY {$definition['order']} LIMIT " . REPORT_EXPORT_MAX, $params);
    $format = strtolower(clip($_GET['format'] ?? 'csv', 5)) === 'xlsx' ? 'xlsx' : 'csv';

    // A bulk download of the member book is exactly what an audit wants to see.
    audit($staff, 'REPORT_EXPORTED', "$key ($format, " . count($rows) . ' rows) ' . json_encode($applied));
    security_event('REPORT_EXPORTED', 'warning',
        "{$staff['email']} exported $key — " . count($rows) . ' rows', $staff);

    $headings = array_map(fn($c) => ucwords(str_replace('_', ' ', $c)), array_keys($definition['columns']));
    $stamp = gmdate('Ymd-Hi');
    if ($format === 'csv') {
        $handle = fopen('php://temp', 'r+');
        fputcsv($handle, $headings);
        foreach ($rows as $row) {
            fputcsv($handle, array_map(
                fn($c) => report_value($row[$c] ?? null, $definition['columns'][$c]),
                array_keys($definition['columns'])));
        }
        rewind($handle);
        $csv = stream_get_contents($handle);
        fclose($handle);
        // The BOM makes Excel open UTF-8 rupee signs and names correctly.
        send_download("\xEF\xBB\xBF" . $csv, 'text/csv; charset=utf-8', "$key-$stamp.csv");
    }

    $sheet = [
        [['Aadhunik Jeewan Sanchay Nidhi Limited', 1]],
        [[$definition['name'], 2]],
        [['Generated ' . gmdate('d-M-Y H:i') . ' UTC by ' . $staff['email']
            . ($applied ? ' · filters: ' . json_encode($applied) : ''), 0]],
        [],
        array_map(fn($h) => [$h, 3], $headings),
    ];
    foreach ($rows as $row) {
        $line = [];
        foreach ($definition['columns'] as $column => $fmt) {
            $value = report_value($row[$column] ?? null, $fmt);
            $line[] = [$value, $fmt === 'money' ? 4 : 0];
        }
        $sheet[] = $line;
    }
    send_download(xlsx_workbook($definition['name'], $sheet, array_fill(0, count($headings), 20)),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', "$key-$stamp.xlsx");
}
