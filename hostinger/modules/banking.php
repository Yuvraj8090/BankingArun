<?php
// AJSPay: customer banking services. Cheques, demand drafts, deposits, loans,
// investments, support, branches, chatbot, referrals and standing instructions.
declare(strict_types=1);

// Defaults only, read when a row in system_parameters has been deleted or was
// never seeded. The rates actually charged/paid live in that table (see
// modules/parameters.php and the Business Parameters screen), not here -- a
// rate change is an admin-panel save, not a deploy.
const LOAN_RATE_DEFAULTS = ['personal' => 10.50, 'home' => 8.40, 'vehicle' => 8.75, 'gold' => 7.90];
const DEPOSIT_RATE_DEFAULTS = ['under_1y' => 6.50, '1y_to_2y' => 7.25, '2y_to_3y' => 7.50, 'over_3y' => 7.10];
const REFERRAL_REWARD_DEFAULT = 500.0;
const DEMAND_DRAFT_FEE_DEFAULT = 50.0;
const CARD_LIMIT_MAX_DEFAULT = 1000000.0;
const SI_FREQUENCIES = ['daily', 'weekly', 'monthly', 'quarterly'];
const SI_CATEGORIES = ['rent', 'sip', 'emi', 'insurance', 'generic'];
const SI_MAX_AMOUNT = 1000000.0;

function loan_rate(string $type): float
{
    return param_value("loan_rate_$type", LOAN_RATE_DEFAULTS[$type] ?? 10.0);
}

// Same four tenure tiers route_book_deposit has always used; only the source of
// the number changed. Kept out of the schemes table on purpose -- this is the
// generic self-service fixed/recurring path, not a named brochure plan -- but it
// still has to clear the same Nidhi Rules cap a scheme would, which is enforced
// where these are saved (route_parameter_update/create), not here.
function deposit_tier_rate(int $tenureMonths): float
{
    $tier = $tenureMonths < 12 ? 'under_1y' : ($tenureMonths <= 24 ? '1y_to_2y'
        : ($tenureMonths <= 36 ? '2y_to_3y' : 'over_3y'));
    return param_value("deposit_rate_$tier", DEPOSIT_RATE_DEFAULTS[$tier]);
}

function demand_draft_fee(): float
{
    return param_value('demand_draft_fee', DEMAND_DRAFT_FEE_DEFAULT);
}

function card_limit_max(): float
{
    return param_value('card_limit_max', CARD_LIMIT_MAX_DEFAULT);
}

// --- Cheques & demand drafts -----------------------------------------------------------
function route_cheque_book(array $d): void
{
    global $pdo;
    $user = current_user();
    need($d, 'account_number', 'delivery_address');
    $leaves = (int)($d['leaves_count'] ?? 25);
    if (!in_array($leaves, [25, 50, 100], true)) {
        fail(422, 'Cheque books come with 25, 50 or 100 leaves.');
    }
    $account = owned_account($user, $d['account_number']);
    if (!$account) {
        fail(404, 'Account not found.');
    }
    $tracking = 'IND-POST-' . random_int(100000, 999999);
    $pdo->prepare('INSERT INTO cheque_requests (id, user_id, account_number, leaves, delivery_address, status, tracking_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)')
        ->execute([uuid4(), $user['id'], $account['account_number'], $leaves, clip($d['delivery_address'], 255),
            'APPROVED_DISPATCH', $tracking]);
    audit($user, 'CHEQUE_BOOK_REQUEST', "$leaves leaves for {$account['account_number']}");
    respond(['status' => 'SUCCESS', 'message' => "Cheque book with $leaves leaves requested. Tracking ID: $tracking"]);
}

function route_stop_cheque(array $d): void
{
    global $pdo;
    $user = current_user();
    need($d, 'account_number', 'cheque_number', 'reason');
    $account = owned_account($user, $d['account_number']);
    if (!$account) {
        fail(404, 'Account not found.');
    }
    $cheque = clip($d['cheque_number'], 10);
    if (!preg_match('/\A\d{6,10}\z/', $cheque)) {
        fail(422, 'Cheque number must be 6 to 10 digits.');
    }
    $pdo->prepare('INSERT INTO stopped_cheques (id, user_id, account_number, cheque_number, reason, status)
        VALUES (?, ?, ?, ?, ?, ?)')
        ->execute([uuid4(), $user['id'], $account['account_number'], $cheque, clip($d['reason'], 255), 'STOPPED']);
    audit($user, 'CHEQUE_STOPPED', "Cheque $cheque on {$account['account_number']}");
    respond(['status' => 'SUCCESS',
        'message' => "Cheque No. $cheque has been STOPPED instantly. Any clearance attempt will be blocked."]);
}

function route_demand_draft(array $d): void
{
    global $pdo;
    $user = current_user();
    need($d, 'account_number', 'beneficiary_name', 'payable_at', 'amount');
    $amount = money($d['amount']);
    if ($amount <= 0 || $amount > 10000000) {
        fail(400, 'Demand draft amount must be between ₹1 and ₹1,00,00,000.');
    }
    $fee = demand_draft_fee();
    $pdo->beginTransaction();
    [$account, $newBalance] = debit_account($user, $d['account_number'], $amount + $fee,
        'Insufficient funds for Demand Draft + ' . rupees($fee) . ' issuing fee.');
    $number = 'DD-' . random_int(100000, 999999);
    $dd = ['id' => uuid4(), 'user_id' => $user['id'], 'dd_number' => $number,
        'account_number' => $account['account_number'], 'beneficiary_name' => clip($d['beneficiary_name'], 150),
        'payable_at' => clip($d['payable_at'], 100), 'amount' => $amount, 'fee' => $fee, 'status' => 'ISSUED',
        'timestamp' => now_utc()];
    $pdo->prepare('INSERT INTO demand_drafts (id, user_id, dd_number, account_number, beneficiary_name, payable_at,
            amount, fee, status, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')->execute(array_values($dd));
    // Record the debit, so the statement explains where the money went.
    insert_txn(['user_id' => $user['id'], 'account_number' => $account['account_number'], 'type' => 'debit',
        'mode' => 'DEMAND_DRAFT', 'amount' => $amount + $fee, 'balance_after' => $newBalance,
        'counterparty_name' => $dd['beneficiary_name'], 'counterparty_acc' => $number, 'ref_number' => $number,
        'description' => "Demand draft payable at {$dd['payable_at']} (incl. " . rupees($fee) . ' fee)',
        'timestamp' => $dd['timestamp']]);
    audit($user, 'DEMAND_DRAFT', "$number for " . rupees($amount));
    $pdo->commit();
    respond(['status' => 'SUCCESS',
        'message' => "Demand Draft $number issued successfully for " . rupees($amount) . " payable at {$dd['payable_at']}.",
        'dd' => out($dd)]);
}

// --- Counter deposits ----------------------------------------------------------------
// The cash or cheque a member hands over at the counter after their account
// already exists. Account opening funds itself (route_register, api.php); this
// is everything after that. Staff-only -- a member cannot credit their own
// account this way -- and every deposit is tied to the teller who took it.
const COUNTER_DEPOSIT_ROLES = ['staff', ...ADMIN_ROLES];
const COUNTER_DEPOSIT_MODES = ['cash', 'cheque'];
const COUNTER_DEPOSIT_MAX = 1000000.0;

function route_counter_deposit(array $d): void
{
    global $pdo;
    $staff = staff_user(COUNTER_DEPOSIT_ROLES);
    need($d, 'account_number', 'amount');
    $amount = money($d['amount']);
    if ($amount <= 0 || $amount > COUNTER_DEPOSIT_MAX) {
        fail(422, 'Counter deposit must be between ₹1 and ' . rupees(COUNTER_DEPOSIT_MAX) . '.');
    }
    $mode = strtolower(clip($d['mode'] ?? 'cash', 10));
    if (!in_array($mode, COUNTER_DEPOSIT_MODES, true)) {
        fail(422, 'mode must be cash or cheque.');
    }
    $chequeNumber = $mode === 'cheque' ? clip($d['cheque_number'] ?? '', 20) : '';
    if ($mode === 'cheque' && $chequeNumber === '') {
        fail(422, 'Cheque number is required for a cheque deposit.');
    }
    $accountNumber = clip($d['account_number'], 30);

    $pdo->beginTransaction();
    $account = row('SELECT * FROM accounts WHERE account_number = ? FOR UPDATE', [$accountNumber]);
    if (!$account) {
        fail(404, 'No member account with that number.');
    }
    if ($account['status'] !== 'active') {
        fail(403, 'This account is not active for deposits.');
    }
    $owner = row('SELECT * FROM users WHERE id = ?', [$account['user_id']]);
    // A cash-in-hand counter deposit still has to clear the same "is this
    // person who they say they are" bar as any other route that moves money
    // into or out of a retail account -- see require_kyc_verified() in api.php.
    require_kyc_verified($owner);

    $newBalance = round((float)$account['balance'] + $amount, 2);
    $pdo->prepare('UPDATE accounts SET balance = balance + ? WHERE id = ?')->execute([$amount, $account['id']]);
    $ref = 'CD-' . gmdate('YmdHis') . '-' . random_int(100, 999);
    $remarks = clip($d['remarks'] ?? '', 150);
    $description = ($mode === 'cash' ? 'Cash deposited at the counter' : "Cheque #$chequeNumber deposited at the counter")
        . ($remarks !== '' ? " — $remarks" : '');
    insert_txn(['user_id' => $account['user_id'], 'account_number' => $accountNumber, 'type' => 'credit',
        'mode' => 'COUNTER_DEPOSIT', 'amount' => $amount, 'balance_after' => $newBalance,
        'counterparty_name' => $staff['name'], 'counterparty_acc' => 'BRANCH-CASH-DESK',
        'ref_number' => $ref, 'description' => $description]);
    audit($staff, 'COUNTER_DEPOSIT', "$accountNumber " . rupees($amount) . " ($mode) for {$owner['name']}");
    $pdo->commit();
    respond(['status' => 'SUCCESS', 'ref_number' => $ref, 'new_balance' => $newBalance,
        'message' => rupees($amount) . " credited to $accountNumber ({$owner['name']}). New balance: " . rupees($newBalance)]);
}

// --- Deposits ----------------------------------------------------------------------------
function route_book_deposit(array $d): void
{
    global $pdo;
    $user = current_user();
    need($d, 'account_number', 'amount');
    $amount = money($d['amount']);
    if ($amount <= 0) {
        fail(400, 'Deposit amount must be greater than ₹0.');
    }
    // Nidhi Rules, 2014: deposits may be accepted from members only, and a
    // member must hold at least ten equity shares. This is the check that makes
    // the member register more than a list.
    require_membership($user);

    // A plan code (e.g. the Monthly Income Scheme) prices the deposit from the
    // published scheme's own slabs instead of the generic tenure tiers below --
    // same booking, same locking, same nominee field, just priced differently.
    $planCode = strtoupper(clip($d['scheme_code'] ?? '', 20));
    if ($planCode !== '') {
        $scheme = row("SELECT * FROM schemes WHERE code = ? AND status = 'active' AND deleted_at IS NULL",
            [$planCode]);
        if (!$scheme) {
            fail(422, 'That plan is not one of our current schemes.');
        }
        $terms = scheme_deposit_terms($scheme, $amount);
        $type = $terms['deposit_type'];
        $tenure = $terms['tenure_months'];
        $rate = $terms['interest_rate'];
        $maturity = $terms['maturity_amount'];
        $interestPayout = $terms['interest_payout'];
        $dueToday = $terms['due_today'];
        $principal = $terms['total_deposit'];
    } else {
        $type = ($d['deposit_type'] ?? 'fixed') === 'recurring' ? 'recurring' : 'fixed';
        $tenure = (int)($d['tenure_months'] ?? 12);
        if ($tenure < 1 || $tenure > 120) {
            fail(422, 'Tenure must be between 1 and 120 months.');
        }
        $rate = deposit_tier_rate($tenure);
        $maturity = round($amount * (1 + $rate / 400) ** (4 * $tenure / 12), 2);
        $interestPayout = clip($d['interest_payout'] ?? '', 20) ?: 'on_maturity';
        $dueToday = $amount;
        $principal = $amount;
    }

    $pdo->beginTransaction();
    [$account, $newBalance] = debit_account($user, $d['account_number'], $dueToday,
        'Insufficient funds in selected savings account.');
    $number = 'DEP' . random_int(10000000, 99999999);
    $deposit = [
        'id' => uuid4(), 'user_id' => $user['id'], 'deposit_number' => $number, 'deposit_type' => $type,
        'scheme_code' => $planCode !== '' ? $planCode : null,
        'source_account' => $account['account_number'], 'principal_amount' => $principal, 'interest_rate' => $rate,
        'tenure_months' => $tenure, 'interest_payout' => $interestPayout,
        'maturity_amount' => $maturity,
        'maturity_date' => (new DateTimeImmutable('today', new DateTimeZone(IST)))
            ->modify('+' . (int)($tenure * 30.4) . ' days')->format('Y-m-d'),
        'nominee_name' => clip($d['nominee_name'] ?? '', 150) ?: ($user['nominee_name'] ?? 'Registered Nominee'),
        'status' => 'active', 'created_at' => now_utc(),
    ];
    $pdo->prepare('INSERT INTO deposits (id, user_id, deposit_number, deposit_type, scheme_code, source_account,
            principal_amount, interest_rate, tenure_months, interest_payout, maturity_amount, maturity_date,
            nominee_name, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')->execute(array_values($deposit));
    insert_txn(['user_id' => $user['id'], 'account_number' => $account['account_number'], 'type' => 'debit',
        'mode' => 'DEPOSIT_BOOKING', 'amount' => $dueToday, 'balance_after' => $newBalance,
        'counterparty_name' => $planCode !== '' ? $terms['scheme_name'] : 'AJSPay Term Deposit',
        'counterparty_acc' => $number, 'ref_number' => $number,
        'description' => ($planCode !== '' ? $terms['scheme_name'] : ucfirst($type) . ' deposit') . " #$number booked"]);
    audit($user, 'DEPOSIT_BOOKED', "$number " . rupees($dueToday));
    $pdo->commit();
    respond(['status' => 'SUCCESS',
        'message' => strtoupper($type) . " #$number booked successfully! Maturity value: " . rupees($maturity),
        'deposit' => out($deposit)]);
}

// --- Loans -------------------------------------------------------------------------------
// Customer applications go straight into the loan department's pipeline.
function route_apply_loan(array $d): void
{
    global $pdo;
    $user = current_user();
    require_kyc_verified($user);
    need($d, 'loan_type', 'amount_requested', 'tenure_months', 'monthly_income', 'employment_type', 'purpose');
    $type = strtolower(clip($d['loan_type'], 30));
    if (!array_key_exists($type, LOAN_RATE_DEFAULTS)) {
        fail(422, 'loan_type must be personal, home, vehicle or gold.');
    }
    $amount = money($d['amount_requested']);
    $tenure = (int)$d['tenure_months'];
    $income = money($d['monthly_income']);
    if ($amount <= 0 || $amount > 100000000) {
        fail(422, 'Loan amount must be between ₹1 and ₹10 crore.');
    }
    if ($tenure < 1 || $tenure > 360) {
        fail(422, 'Tenure must be between 1 and 360 months.');
    }
    if ($income < 0) {
        fail(422, 'Monthly income cannot be negative.');
    }
    $rate = loan_rate($type);
    $r = $rate / 12 / 100;
    $emi = round($amount * $r * (1 + $r) ** $tenure / ((1 + $r) ** $tenure - 1), 2);
    $eligibility = $income * 0.5 >= $emi ? 'Pre-Approved' : 'Under Review';
    $number = 'LN-' . gmdate('Ym') . '-' . random_int(10000, 99999);
    $id = uuid4();
    $pdo->prepare('INSERT INTO loan_applications (id, user_id, applicant, loan_application_no, loan_type, amount,
            tenure_months, roi, calculated_emi, monthly_income, employment_type, purpose, eligibility_status, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        ->execute([$id, $user['id'], $user['name'], $number, $type, $amount, $tenure, $rate, $emi, $income,
            clip($d['employment_type'], 50), clip($d['purpose'], 255), $eligibility, 'under_review']);
    audit($user, 'LOAN_APPLIED', "$number $type " . rupees($amount));
    // Grade it for the loan desk. The grade is advisory: it never decides the
    // application, and the applicant is not shown it.
    store_loan_score_safely(['id' => $id, 'user_id' => $user['id'], 'amount' => $amount,
        'calculated_emi' => $emi, 'monthly_income' => $income,
        'employment_type' => clip($d['employment_type'], 50)]);
    respond(['status' => 'SUCCESS', 'application_no' => $number, 'calculated_emi' => $emi, 'interest_rate' => $rate,
        'eligibility' => $eligibility, 'message' => 'Application for ' . ucfirst($type) . ' Loan submitted successfully!']);
}

function route_my_loans(array $d): void
{
    $user = current_user();
    respond(['loans' => out_all(rows('SELECT id, loan_application_no, loan_type, amount AS amount_requested,
            roi AS interest_rate, tenure_months, calculated_emi, monthly_income, employment_type, purpose,
            eligibility_status, status, created_at
        FROM loan_applications WHERE user_id = ? ORDER BY created_at DESC', [$user['id']]))]);
}

// --- Investments -------------------------------------------------------------------------
function investment_catalog(): array
{
    return [
        'mutual_funds' => [
            ['id' => 'mf1', 'name' => 'AJSPay Bluechip Large Cap Equity Fund', 'category' => 'Equity Large Cap', 'cagr_3yr' => '18.4%', 'risk' => 'Moderate', 'min_sip' => 500, 'nav' => 94.20],
            ['id' => 'mf2', 'name' => 'AJSPay Tech Opportunity Fund', 'category' => 'Sectoral Tech', 'cagr_3yr' => '24.8%', 'risk' => 'High', 'min_sip' => 1000, 'nav' => 182.50],
            ['id' => 'mf3', 'name' => 'AJSPay Balanced Advantage Hybrid Fund', 'category' => 'Dynamic Asset Hybrid', 'cagr_3yr' => '16.1%', 'risk' => 'Low-Mod', 'min_sip' => 500, 'nav' => 445.10],
            ['id' => 'mf4', 'name' => 'AJSPay Nifty 50 Index Fund Direct', 'category' => 'Passive Index', 'cagr_3yr' => '15.2%', 'risk' => 'Moderate', 'min_sip' => 500, 'nav' => 240.80],
        ],
        // sum_assured is the number insurance_policies.sum_assured actually
        // stores; "cover" stays the printed display string, which for motor
        // is a variable IDV rather than a fixed figure -- sum_assured there
        // is this printed plan's own representative insured value.
        'insurance_plans' => [
            ['id' => 'ins1', 'name' => 'AJSPay Life Shield Plus Term Plan', 'type' => 'Life Term Cover', 'cover' => '₹1.00 Crore', 'sum_assured' => 10000000, 'annual_premium' => 8450, 'claim_ratio' => '98.5%'],
            ['id' => 'ins2', 'name' => 'AJSPay Complete Health Shield', 'type' => 'Family Health Floater', 'cover' => '₹20.00 Lakhs', 'sum_assured' => 2000000, 'annual_premium' => 14200, 'claim_ratio' => '99.1%'],
            ['id' => 'ins3', 'name' => 'AJSPay Comprehensive Motor Insurance', 'type' => 'Zero-Dep Auto Cover', 'cover' => 'IDV Market Value', 'sum_assured' => 800000, 'annual_premium' => 7100, 'claim_ratio' => '97.8%'],
        ],
    ];
}

function route_investment_catalog(array $d): void
{
    respond(investment_catalog());
}

function route_invest(array $d): void
{
    global $pdo;
    $user = current_user();
    need($d, 'account_number', 'scheme_id', 'amount');
    $amount = money($d['amount']);
    if ($amount <= 0) {
        fail(400, 'Investment amount must be greater than ₹0.');
    }
    // Take the scheme name from the catalogue, not from the request.
    $schemes = array_column(investment_catalog()['mutual_funds'], 'name', 'id');
    $schemeId = clip($d['scheme_id'], 20);
    if (!isset($schemes[$schemeId])) {
        fail(404, 'Unknown mutual fund scheme.');
    }
    $pdo->beginTransaction();
    [$account, $newBalance] = debit_account($user, $d['account_number'], $amount, 'Insufficient funds for investment.');
    $folio = 'FOLIO-984' . random_int(10000, 99999);
    $investment = ['id' => uuid4(), 'user_id' => $user['id'], 'folio_no' => $folio, 'scheme_id' => $schemeId,
        'scheme_name' => $schemes[$schemeId],
        'investment_type' => strtoupper(clip($d['investment_type'] ?? 'SIP', 10)) === 'LUMPSUM' ? 'LUMPSUM' : 'SIP',
        'invested_amount' => $amount, 'current_value' => $amount, 'units' => round($amount / 120.0, 3),
        'status' => 'ACTIVE', 'created_at' => now_utc()];
    $pdo->prepare('INSERT INTO investments (id, user_id, folio_no, scheme_id, scheme_name, investment_type,
            invested_amount, current_value, units, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')->execute(array_values($investment));
    insert_txn(['user_id' => $user['id'], 'account_number' => $account['account_number'], 'type' => 'debit',
        'mode' => 'MF_PURCHASE', 'amount' => $amount, 'balance_after' => $newBalance,
        'counterparty_name' => $investment['scheme_name'], 'counterparty_acc' => $folio, 'ref_number' => $folio,
        'description' => "Mutual fund purchase ({$investment['investment_type']})"]);
    audit($user, 'MF_INVESTED', "$folio " . rupees($amount));
    $pdo->commit();
    respond(['status' => 'SUCCESS',
        'message' => 'Invested ' . rupees($amount) . " in {$investment['scheme_name']}. Folio Number: $folio",
        'portfolio' => out($investment)]);
}

// "Apply for Policy Cover" used to just show a toast -- no record was ever
// written, so a member who thought they had bought a policy had nothing to
// show for it and staff had no idea it happened. Mirrors route_invest: the
// premium is debited like any other purchase and the policy is booked in
// the same transaction.
function route_insure(array $d): void
{
    global $pdo;
    $user = current_user();
    need($d, 'account_number', 'plan_id');
    $plans = array_column(investment_catalog()['insurance_plans'], null, 'id');
    $planId = clip($d['plan_id'], 20);
    if (!isset($plans[$planId])) {
        fail(404, 'Unknown insurance plan.');
    }
    $plan = $plans[$planId];
    $pdo->beginTransaction();
    [$account, $newBalance] = debit_account($user, $d['account_number'], (float)$plan['annual_premium'],
        'Insufficient funds for the annual premium.');
    $policy = ['id' => uuid4(), 'user_id' => $user['id'], 'plan_id' => $planId, 'plan_name' => $plan['name'],
        'sum_assured' => $plan['sum_assured'], 'annual_premium' => $plan['annual_premium'],
        'nominee_name' => clip($d['nominee_name'] ?? '', 150) ?: null, 'status' => 'ACTIVE', 'created_at' => now_utc()];
    $pdo->prepare('INSERT INTO insurance_policies (id, user_id, plan_id, plan_name, sum_assured, annual_premium,
            nominee_name, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')->execute(array_values($policy));
    insert_txn(['user_id' => $user['id'], 'account_number' => $account['account_number'], 'type' => 'debit',
        'mode' => 'INSURANCE_PREMIUM', 'amount' => (float)$plan['annual_premium'], 'balance_after' => $newBalance,
        'counterparty_name' => $plan['name'], 'counterparty_acc' => $policy['id'],
        'ref_number' => 'POL-' . strtoupper(substr($policy['id'], 0, 8)),
        'description' => "Annual premium for {$plan['name']}"]);
    audit($user, 'INSURANCE_APPLIED', "{$plan['name']} " . rupees((float)$plan['annual_premium']));
    $pdo->commit();
    respond(['status' => 'SUCCESS',
        'message' => "Applied for {$plan['name']}. Premium " . rupees((float)$plan['annual_premium'])
            . ' debited. Our insurance desk will contact you to complete the policy.',
        'policy' => out($policy)]);
}

function route_portfolio(array $d): void
{
    $user = current_user();
    respond([
        'mutual_funds' => out_all(rows('SELECT * FROM investments WHERE user_id = ? ORDER BY created_at DESC', [$user['id']])),
        'insurance_policies' => out_all(rows('SELECT * FROM insurance_policies WHERE user_id = ? ORDER BY created_at DESC',
            [$user['id']])),
    ]);
}

// --- Support, branches & chatbot --------------------------------------------------------
function route_complaint(array $d): void
{
    global $pdo;
    $user = current_user();
    need($d, 'category', 'subject', 'description');
    $accountNumber = null;
    if (!empty($d['account_number'])) {
        $account = owned_account($user, $d['account_number']);
        if (!$account) {
            fail(404, 'Account not found.');
        }
        $accountNumber = $account['account_number'];
    }
    $subject = clip($d['subject'], 200);
    $ticketId = 'TKT-SR-' . gmdate('Ymd') . '-' . random_int(1000, 9999);
        $priority = str_contains(strtolower($subject), 'fraud') ? 'HIGH' : 'MEDIUM';
    $ticketRow = uuid4();
    $pdo->prepare('INSERT INTO support_tickets (id, ticket_id, user_id, user_email, user_name, category, account_number,
            subject, description, status, priority, assigned_to, due_at, last_message_at, unread_for_staff)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)')
        ->execute([$ticketRow, $ticketId, $user['id'], $user['email'], $user['name'], clip($d['category'], 50),
            $accountNumber, $subject, clip($d['description'], 2000), 'OPEN', $priority,
            'Grievance Redressal Desk', sla_deadline($priority), now_utc()]);
    // The member's own words open the thread, so the conversation reads in order.
    $pdo->prepare('INSERT INTO ticket_messages (id, ticket_id, author_user_id, author_name, author_role, body)
        VALUES (?, ?, ?, ?, ?, ?)')
        ->execute([uuid4(), $ticketRow, $user['id'], $user['name'], 'member', clip($d['description'], 2000)]);
    audit($user, 'SUPPORT_TICKET', $ticketId);
    respond(['status' => 'SUCCESS', 'ticket_id' => $ticketId, 'priority' => $priority,
        'due_at' => iso(sla_deadline($priority)), 'grievance_officer' => grievance_officer(),
        'message' => "Service request logged under Ticket #$ticketId. We aim to respond within "
            . (TICKET_SLA_HOURS[$priority] ?? 72) . ' hours.']);
}

function route_my_tickets(array $d): void
{
    $user = current_user();
    [$tickets, $meta] = paginate('SELECT * FROM support_tickets WHERE user_id = ? ORDER BY created_at DESC',
        [$user['id']], 20, 100);
    respond(['tickets' => out_all($tickets), 'pagination' => $meta]);
}

function route_branches(array $d): void
{
    respond(['branches' => out_all(rows('SELECT * FROM branches WHERE deleted_at IS NULL ORDER BY id'))]);
}

// route_chat now lives in modules/ai.php, where it can answer from the
// signed-in member's own data instead of a fixed list of replies.

// --- Refer & earn ------------------------------------------------------------------------
function referral_reward(): float
{
    return param_value('referral_reward_amount', REFERRAL_REWARD_DEFAULT);
}

function ensure_referral_code(array $user): string
{
    global $pdo;
    if (!empty($user['referral_code'])) {
        return $user['referral_code'];
    }
    $prefix = substr(preg_replace('/[^A-Z]/', '', strtoupper($user['name'])), 0, 3) ?: 'USR';
    $code = '';
    for ($i = 0; $i < 5 && $code === ''; $i++) {
        $try = $prefix . random_int(10000, 99999);
        if (!row('SELECT id FROM users WHERE referral_code = ?', [$try])) {
            $code = $try;
        }
    }
    $code = $code ?: 'AJS' . strtoupper(bin2hex(random_bytes(3)));
    $pdo->prepare('UPDATE users SET referral_code = ? WHERE id = ?')->execute([$code, $user['id']]);
    return $code;
}

// Called inside the registration transaction: credits both new customer and referrer.
function apply_referral_bonus(string $userId, string $name, string $email, string $accountNumber, float $openingBalance,
    string $code): ?float
{
    global $pdo;
    $referrer = row('SELECT * FROM users WHERE referral_code = ?', [$code]);
    $reward = referral_reward();
    if (!$referrer || $referrer['id'] === $userId || $reward <= 0) {
        return null;
    }
    $pdo->prepare('UPDATE accounts SET balance = balance + ? WHERE account_number = ?')->execute([$reward, $accountNumber]);
    insert_txn(['user_id' => $userId, 'account_number' => $accountNumber, 'type' => 'credit', 'mode' => 'REFERRAL_BONUS',
        'amount' => $reward, 'balance_after' => round($openingBalance + $reward, 2),
        'counterparty_name' => 'Refer & Earn Bonus', 'counterparty_acc' => 'AJSPAY-REWARDS',
        'ref_number' => 'RRB-' . random_int(1000000, 9999999), 'description' => "Welcome bonus via referral $code"]);
    $referrerAccount = row('SELECT * FROM accounts WHERE user_id = ? ORDER BY created_at, id LIMIT 1 FOR UPDATE',
        [$referrer['id']]);
    if ($referrerAccount) {
        $pdo->prepare('UPDATE accounts SET balance = balance + ? WHERE id = ?')->execute([$reward, $referrerAccount['id']]);
        insert_txn(['user_id' => $referrer['id'], 'account_number' => $referrerAccount['account_number'],
            'type' => 'credit', 'mode' => 'REFERRAL_BONUS', 'amount' => $reward,
            'balance_after' => round((float)$referrerAccount['balance'] + $reward, 2),
            'counterparty_name' => 'Refer & Earn Payout', 'counterparty_acc' => 'AJSPAY-REWARDS',
            'ref_number' => 'RRP-' . random_int(1000000, 9999999), 'description' => "Reward for referring $name"]);
    }
    $pdo->prepare('INSERT INTO referrals (id, referrer_id, referrer_email, referee_id, referee_name, referee_email, code,
            credit_amount, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        ->execute([uuid4(), $referrer['id'], $referrer['email'], $userId, $name, $email, $code, $reward, 'paid']);
    return $reward;
}

function route_referral_code(array $d): void
{
    global $config;
    $user = current_user();
    $code = ensure_referral_code($user);
    $reward = referral_reward();
    respond(['referral_code' => $code,
        'referral_link' => rtrim($config['public_app_url'], '/') . '/open-account?ref=' . rawurlencode($code),
        'reward_amount' => $reward,
        'reward_note' => 'You and your friend each get ₹' . (int)$reward
            . ' credited as soon as they open an account and complete KYC.']);
}

function route_referral_history(array $d): void
{
    $user = current_user();
    // referee_name is a snapshot taken when the referral was recorded. It goes
    // stale when a member's name is corrected, and it is empty for referrals
    // written by anything other than the bonus path. The live name wins where
    // there is one; the snapshot is the fallback, so an account that has since
    // been removed still shows who it was.
    $items = out_all(rows("SELECT r.id, COALESCE(u.name, r.referee_name) AS referee_name,
            u.phone AS referee_phone, COALESCE(u.email, r.referee_email) AS referee_email,
            r.code, r.credit_amount, r.status, r.created_at
        FROM referrals r LEFT JOIN users u ON u.id = r.referee_id
        WHERE r.referrer_id = ? ORDER BY r.created_at DESC LIMIT 100", [$user['id']]));
    $paid = array_filter($items, fn($i) => $i['status'] === 'paid');
    respond(['referrals' => $items, 'total_earned' => (float)array_sum(array_column($paid, 'credit_amount')),
        'count' => count($items)]);
}

// --- What the brochure's referral table actually says -------------------------------------
// The printed book carries a twelve-level commission structure. The Nidhi Rules,
// 2014 (Rule 6(d)) forbid a Nidhi from paying "any brokerage or incentive for
// mobilising deposits from members", so this portal does not pay it and no code
// here moves money on the strength of it. What it does is show the member the
// figures they were shown on paper, so the desk and the book cannot tell two
// different stories, and so nobody has to work the percentages out by hand.
//
// Kept as data rather than prose because the table is what the member asks
// about, and a number retyped into a paragraph is a number that drifts.

// Instalment plans. The four columns are years: the rate falls the longer the
// plan runs. Levels 5 to 12 all carry the same row.
const REFERRAL_STAGES = ['1st year', '2nd year', '3rd year', '4th year onward'];
const REFERRAL_INSTALMENT = [
    1 => [20.0, 11.0, 7.0, 5.0],
    2 => [5.0, 1.0, 0.25, 0.25],
    3 => [4.0, 1.0, 0.25, 0.25],
    4 => [3.0, 0.5, 0.25, 0.25],
    5 => [2.0, 0.5, 0.25, 0.25],
];

// One-time plans. Here the four columns are NOT years -- they are plan families,
// each printed with its own level-1 rate. Levels 2 and 3 take 1%, and 4 to 12
// take half a percent, and only the first two families have those rows printed
// at all, which is exactly how the page reads.
const REFERRAL_ONE_TIME_FAMILIES = [
    ['label' => 'BN-4, BN-6, BN-7, BN-8, BN-10', 'level_1' => 9.0, 'deeper' => true],
    ['label' => 'JANHIT', 'level_1' => 10.0, 'deeper' => true],
    ['label' => 'BN-10', 'level_1' => 6.0, 'deeper' => false],
    ['label' => 'BN-11', 'level_1' => 2.0, 'deeper' => false],
];
const REFERRAL_MAX_LEVEL = 12;

function referral_instalment_rates(int $level): array
{
    return REFERRAL_INSTALMENT[min($level, 5)];
}

function referral_one_time_rate(int $level, array $family): ?float
{
    if ($level === 1) {
        return $family['level_1'];
    }
    if (!$family['deeper']) {
        return null;
    }
    return $level <= 3 ? 1.0 : 0.5;
}

// How many members sit at each level below this one. Walked a level at a time
// rather than recursively, with everybody seen so far excluded, so a chain that
// loops back on itself cannot spin here.
function referral_chain(string $userId): array
{
    $seen = [$userId => true];
    $frontier = [$userId];
    $levels = [];
    for ($level = 1; $level <= REFERRAL_MAX_LEVEL && $frontier !== []; $level++) {
        $in = implode(',', array_fill(0, count($frontier), '?'));
        $next = [];
        foreach (rows("SELECT referee_id FROM referrals WHERE referrer_id IN ($in)", $frontier) as $r) {
            if (!isset($seen[$r['referee_id']])) {
                $seen[$r['referee_id']] = true;
                $next[] = $r['referee_id'];
            }
        }
        if ($next === []) {
            break;
        }
        $levels[] = ['level' => $level, 'members' => count($next)];
        $frontier = $next;
    }
    return $levels;
}

// Who, not just how many: every member below this one, with the referrer they
// actually joined under, so a member's downline can be drawn as a tree instead
// of the flat per-level counts referral_chain() gives. Same walk, same
// cycle-guard, one level at a time.
function referral_tree(string $userId, int $maxDepth = 8): array
{
    $seen = [$userId => true];
    $frontier = [$userId];
    $nodes = [];
    for ($level = 1; $level <= $maxDepth && $frontier !== []; $level++) {
        $in = implode(',', array_fill(0, count($frontier), '?'));
        $next = [];
        foreach (rows("SELECT r.referrer_id, r.referee_id, COALESCE(u.name, r.referee_name) AS name, r.created_at
                FROM referrals r LEFT JOIN users u ON u.id = r.referee_id
                WHERE r.referrer_id IN ($in) ORDER BY r.created_at", $frontier) as $r) {
            if (isset($seen[$r['referee_id']])) {
                continue;
            }
            $seen[$r['referee_id']] = true;
            $nodes[] = ['id' => $r['referee_id'], 'parent_id' => $r['referrer_id'],
                'name' => $r['name'] ?: 'Member', 'level' => $level, 'joined_at' => $r['created_at']];
            $next[] = $r['referee_id'];
        }
        $frontier = $next;
    }
    return $nodes;
}

function route_referral_tree(array $d): void
{
    $user = current_user();
    $nodes = referral_tree($user['id']);
    // Direct-referral counts for the root and every node, so the page can show
    // "2 members joined" at each name without a query per node.
    $ids = array_merge([$user['id']], array_column($nodes, 'id'));
    $counts = [];
    $in = implode(',', array_fill(0, count($ids), '?'));
    foreach (rows("SELECT referrer_id, COUNT(*) AS n FROM referrals WHERE referrer_id IN ($in)
            GROUP BY referrer_id", $ids) as $r) {
        $counts[$r['referrer_id']] = (int)$r['n'];
    }
    respond([
        'root' => ['id' => $user['id'], 'name' => $user['name'], 'direct_count' => $counts[$user['id']] ?? 0],
        'nodes' => array_map(fn($n) => $n + ['direct_count' => $counts[$n['id']] ?? 0], $nodes),
        'total_members' => count($nodes),
    ]);
}

// What the printed table would pay on one plan at one denomination. Nothing is
// written and nothing is credited -- this answers "if I introduce somebody and
// they take this, what does the book say I get", which is the question the desk
// is asked and could not previously answer without a calculator.
function referral_illustration(array $scheme, float $unit): array
{
    $terms = scheme_deposit_terms($scheme, $unit);
    $rows = [];
    if ($terms['by_instalment']) {
        // Each year's commission is a percentage of what is paid in during that
        // year, so a plan that stops taking instalments early stops earning.
        $payIn = (int)($scheme['contribution_months'] ?? 0) ?: (int)$scheme['tenure_months'];
        $perYear = [];
        for ($year = 1; $year <= 4; $year++) {
            $months = max(0, min(12, $payIn - 12 * ($year - 1)));
            // The fourth column runs from year four to the end of the pay-in.
            $perYear[] = $year === 4 ? max(0, $payIn - 36) * $unit : $months * $unit;
        }
        for ($level = 1; $level <= REFERRAL_MAX_LEVEL; $level++) {
            $rates = referral_instalment_rates($level);
            $amounts = [];
            foreach ($rates as $i => $rate) {
                $amounts[] = round($perYear[$i] * $rate / 100, 2);
            }
            $rows[] = ['level' => $level, 'rates' => $rates, 'amounts' => $amounts,
                'total' => round(array_sum($amounts), 2)];
        }
        return ['basis' => 'instalment', 'columns' => REFERRAL_STAGES,
            'paid_in_per_column' => $perYear, 'levels' => $rows,
            'scheme' => ['code' => $scheme['code'], 'name' => $scheme['name']],
            'unit' => $unit, 'total_paid_in' => $terms['total_deposit']];
    }
    $deposit = $terms['total_deposit'];
    for ($level = 1; $level <= REFERRAL_MAX_LEVEL; $level++) {
        $rates = [];
        $amounts = [];
        foreach (REFERRAL_ONE_TIME_FAMILIES as $family) {
            $rate = referral_one_time_rate($level, $family);
            $rates[] = $rate;
            $amounts[] = $rate === null ? null : round($deposit * $rate / 100, 2);
        }
        $rows[] = ['level' => $level, 'rates' => $rates, 'amounts' => $amounts, 'total' => null];
    }
    return ['basis' => 'one_time',
        'columns' => array_column(REFERRAL_ONE_TIME_FAMILIES, 'label'),
        'paid_in_per_column' => null, 'levels' => $rows,
        'scheme' => ['code' => $scheme['code'], 'name' => $scheme['name']],
        // The commission page keys its one-time rates to BN families, and not one
        // priced page in the book says which family it belongs to -- the only
        // plan carrying a code at all is the twelve-instalment one, and its
        // BN-1018 is not among the BN-1 to BN-11 the table lists. So four
        // different first-level rates could apply and the document does not
        // choose between them. Saying so is the only honest answer; picking the
        // friendliest column would be inventing a promise.
        'family_unknown' => true,
        'unit' => $unit, 'total_paid_in' => $deposit];
}

// Parts 2 and 3 of the plan book: the turnover programmes. Read from the
// database so the director maintains them, and returned beside part 1 so a
// member sees the whole structure in one place rather than three.
//
// Nothing here pays. See the notice on route_referral_structure.
function reward_programmes(): array
{
    $slabs = [];
    foreach (rows('SELECT * FROM reward_slabs WHERE deleted_at IS NULL ORDER BY programme_code, position')
        as $slab) {
        $slabs[$slab['programme_code']][] = [
            'position' => (int)$slab['position'],
            'label' => $slab['label'],
            'qualifying_amount' => $slab['qualifying_amount'] === null
                ? null : (float)$slab['qualifying_amount'],
            'payout_amount' => $slab['payout_amount'] === null ? null : (float)$slab['payout_amount'],
            'payout_percent' => $slab['payout_percent'] === null ? null : (float)$slab['payout_percent'],
            'payout_note' => $slab['payout_note'],
        ];
    }
    $out = [];
    foreach (rows("SELECT * FROM reward_programmes WHERE deleted_at IS NULL AND status = 'active'
        ORDER BY part_no, name") as $p) {
        $out[] = [
            'code' => $p['code'],
            'part_no' => $p['part_no'] === null ? null : (int)$p['part_no'],
            'name' => $p['name'],
            'headline' => $p['headline'],
            'qualifying_note' => $p['qualifying_note'],
            'payout_note' => $p['payout_note'],
            'source_note' => $p['source_note'],
            'slabs' => $slabs[$p['code']] ?? [],
        ];
    }
    return $out;
}

function route_referral_structure(array $d): void
{
    $user = current_user();
    $illustration = null;
    $code = strtoupper(clip($_GET['scheme_code'] ?? '', 20));
    if ($code !== '') {
        $scheme = row("SELECT * FROM schemes WHERE code = ? AND status = 'active' AND deleted_at IS NULL", [$code]);
        if (!$scheme) {
            fail(422, 'That plan is not one of our current schemes.');
        }
        $illustration = referral_illustration($scheme, (float)($_GET['amount'] ?? 0));
    }
    $instalment = [];
    for ($level = 1; $level <= REFERRAL_MAX_LEVEL; $level++) {
        $instalment[] = ['level' => $level, 'rates' => referral_instalment_rates($level)];
    }
    $oneTime = [];
    for ($level = 1; $level <= REFERRAL_MAX_LEVEL; $level++) {
        $oneTime[] = ['level' => $level,
            'rates' => array_map(fn($f) => referral_one_time_rate($level, $f), REFERRAL_ONE_TIME_FAMILIES)];
    }
    respond([
        // Said first and said plainly, because the table below is the thing
        // people remember and it is not what this institution does.
        'is_paid' => false,
        'notice' => 'These are the figures printed in the plan book. Aadhunik Jeewan Sanchay Nidhi '
            . 'Limited does not pay them: the Nidhi Rules, 2014 do not allow a Nidhi to pay brokerage '
            . 'or incentive for bringing in deposits. What you do earn for an introduction is the '
            . 'Refer & Earn bonus shown on this page, and your standing on the member ladder.',
        'stages' => REFERRAL_STAGES,
        'instalment' => ['columns' => REFERRAL_STAGES, 'levels' => $instalment],
        'one_time' => ['columns' => array_column(REFERRAL_ONE_TIME_FAMILIES, 'label'), 'levels' => $oneTime],
        'chain' => referral_chain($user['id']),
        // Parts 2 and 3 alongside part 1, because the book numbers them as one
        // structure and a member reading only the commission table is reading
        // a third of it.
        'programmes' => reward_programmes(),
        // Asked often enough about the monthly-income plan specifically to be
        // worth stating rather than left to be inferred from a missing row.
        'mis_note' => 'The monthly-income plan has no referral row of its own in the book. '
            . 'It is paid for in one sum, so the one-time table would apply -- but that table '
            . 'sets its first-level rate per BN plan family, and no priced page says which '
            . 'family any plan belongs to. Ask head office before quoting a figure.',
        'illustration' => $illustration,
    ]);
}

// --- Standing instructions --------------------------------------------------------------
function owned_instruction(array $user, string $id): array
{
    $si = row('SELECT * FROM standing_instructions WHERE id = ? AND user_id = ?', [$id, $user['id']]);
    if (!$si) {
        fail(404, 'Instruction not found');
    }
    return $si;
}

function si_amount(mixed $value): float
{
    $amount = money($value);
    if ($amount <= 0 || $amount > SI_MAX_AMOUNT) {
        fail(422, 'Amount must be between ₹1 and ₹10,00,000.');
    }
    return $amount;
}

function route_si_list(array $d): void
{
    $user = current_user();
    $items = out_all(rows('SELECT * FROM standing_instructions WHERE user_id = ? ORDER BY created_at DESC', [$user['id']]));
    respond(['items' => $items, 'count' => count($items)]);
}

function route_si_create(array $d): void
{
    global $pdo;
    $user = current_user();
    need($d, 'from_account_number', 'beneficiary_name', 'beneficiary_account', 'amount', 'start_date');
    $account = owned_account($user, $d['from_account_number']);
    if (!$account) {
        fail(404, 'Source account not found');
    }
    $frequency = $d['frequency'] ?? 'monthly';
    if (!in_array($frequency, SI_FREQUENCIES, true)) {
        fail(422, 'frequency must be daily, weekly, monthly or quarterly.');
    }
    $category = in_array($d['category'] ?? '', SI_CATEGORIES, true) ? $d['category'] : 'generic';
    $start = valid_date($d['start_date'], 'start_date');
    $end = empty($d['end_date']) ? null : valid_date($d['end_date'], 'end_date');
    if ($end !== null && $end < $start) {
        fail(422, 'end_date cannot be before start_date.');
    }
    $si = ['id' => uuid4(), 'user_id' => $user['id'], 'from_account_number' => $account['account_number'],
        'beneficiary_name' => clip($d['beneficiary_name'], 150), 'beneficiary_account' => clip($d['beneficiary_account'], 50),
        'beneficiary_ifsc' => clip($d['beneficiary_ifsc'] ?? '', 11) ?: 'AJSP0000042', 'amount' => si_amount($d['amount']),
        'frequency' => $frequency, 'category' => $category, 'start_date' => $start, 'end_date' => $end,
        'remarks' => clip($d['remarks'] ?? '', 255) ?: 'Standing instruction', 'status' => 'active', 'executions' => 0,
        'next_run' => $start, 'created_at' => now_utc()];
    $pdo->prepare('INSERT INTO standing_instructions (id, user_id, from_account_number, beneficiary_name,
            beneficiary_account, beneficiary_ifsc, amount, frequency, category, start_date, end_date, remarks, status,
            executions, next_run, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')->execute(array_values($si));
    audit($user, 'SI_CREATED', rupees($si['amount']) . " $frequency to {$si['beneficiary_name']}");
    respond(['status' => 'SUCCESS',
        'message' => 'Standing Instruction created — ₹' . number_format($si['amount']) . " $frequency to {$si['beneficiary_name']}.",
        'instruction' => out($si)]);
}

function route_si_update(array $d, string $id = ''): void
{
    global $pdo;
    $user = current_user();
    owned_instruction($user, $id);
    $updates = [];
    if (isset($d['amount'])) {
        $updates['amount'] = si_amount($d['amount']);
    }
    if (isset($d['end_date']) && $d['end_date'] !== '') {
        $updates['end_date'] = valid_date($d['end_date'], 'end_date');
    }
    if (isset($d['remarks'])) {
        $updates['remarks'] = clip($d['remarks'], 255);
    }
    if (!$updates) {
        fail(400, 'Nothing to update');
    }
    $set = implode(', ', array_map(fn($column) => "$column = ?", array_keys($updates)));
    $pdo->prepare("UPDATE standing_instructions SET $set WHERE id = ? AND user_id = ?")
        ->execute([...array_values($updates), $id, $user['id']]);
    audit($user, 'SI_UPDATED', $id);
    respond(['status' => 'SUCCESS', 'message' => 'Standing Instruction updated']);
}

function si_set_status(string $id, string $status, string $message): void
{
    global $pdo;
    $user = current_user();
    $si = owned_instruction($user, $id);
    // Resuming clears the failure count cron.php built up, so an instruction
    // paused after repeated failures gets a full set of retries again. It also
    // catches up from today rather than replaying every date it was paused for.
    if ($status === 'active') {
        $today = (new DateTimeImmutable('today', new DateTimeZone(IST)))->format('Y-m-d');
        $nextRun = ($si['next_run'] === null || $si['next_run'] < $today) ? $today : $si['next_run'];
        $pdo->prepare("UPDATE standing_instructions SET status = 'active', failures = 0, last_error = NULL,
            last_status = NULL, last_run = NULL, next_run = ? WHERE id = ? AND user_id = ?")
            ->execute([$nextRun, $id, $user['id']]);
    } else {
        $pdo->prepare('UPDATE standing_instructions SET status = ? WHERE id = ? AND user_id = ?')
            ->execute([$status, $id, $user['id']]);
    }
    audit($user, 'SI_' . strtoupper($status), $id);
    respond(['status' => 'SUCCESS', 'message' => $message]);
}

function route_si_pause(array $d, string $id = ''): void
{
    si_set_status($id, 'paused', 'Paused');
}

function route_si_resume(array $d, string $id = ''): void
{
    si_set_status($id, 'active', 'Resumed');
}

function route_si_delete(array $d, string $id = ''): void
{
    global $pdo;
    $user = current_user();
    owned_instruction($user, $id);
    $pdo->prepare('DELETE FROM standing_instructions WHERE id = ? AND user_id = ?')->execute([$id, $user['id']]);
    audit($user, 'SI_DELETED', $id);
    respond(['status' => 'SUCCESS', 'message' => 'Deleted']);
}
