<?php
// AJSPay: customer banking services. Cheques, demand drafts, deposits, loans,
// investments, support, branches, chatbot, referrals and standing instructions.
declare(strict_types=1);

const LOAN_RATES = ['personal' => 10.50, 'home' => 8.40, 'vehicle' => 8.75, 'gold' => 7.90];
const REFERRAL_REWARD_DEFAULT = 500.0;
const SI_FREQUENCIES = ['daily', 'weekly', 'monthly', 'quarterly'];
const SI_CATEGORIES = ['rent', 'sip', 'emi', 'insurance', 'generic'];
const SI_MAX_AMOUNT = 1000000.0;

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
    $pdo->beginTransaction();
    [$account, $newBalance] = debit_account($user, $d['account_number'], $amount + 50.0,
        'Insufficient funds for Demand Draft + ₹50 issuing fee.');
    $number = 'DD-' . random_int(100000, 999999);
    $dd = ['id' => uuid4(), 'user_id' => $user['id'], 'dd_number' => $number,
        'account_number' => $account['account_number'], 'beneficiary_name' => clip($d['beneficiary_name'], 150),
        'payable_at' => clip($d['payable_at'], 100), 'amount' => $amount, 'fee' => 50.0, 'status' => 'ISSUED',
        'timestamp' => now_utc()];
    $pdo->prepare('INSERT INTO demand_drafts (id, user_id, dd_number, account_number, beneficiary_name, payable_at,
            amount, fee, status, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')->execute(array_values($dd));
    // Record the debit, so the statement explains where the money went.
    insert_txn(['user_id' => $user['id'], 'account_number' => $account['account_number'], 'type' => 'debit',
        'mode' => 'DEMAND_DRAFT', 'amount' => $amount + 50.0, 'balance_after' => $newBalance,
        'counterparty_name' => $dd['beneficiary_name'], 'counterparty_acc' => $number, 'ref_number' => $number,
        'description' => "Demand draft payable at {$dd['payable_at']} (incl. ₹50 fee)", 'timestamp' => $dd['timestamp']]);
    audit($user, 'DEMAND_DRAFT', "$number for " . rupees($amount));
    $pdo->commit();
    respond(['status' => 'SUCCESS',
        'message' => "Demand Draft $number issued successfully for " . rupees($amount) . " payable at {$dd['payable_at']}.",
        'dd' => out($dd)]);
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
    $type = ($d['deposit_type'] ?? 'fixed') === 'recurring' ? 'recurring' : 'fixed';
    $tenure = (int)($d['tenure_months'] ?? 12);
    if ($tenure < 1 || $tenure > 120) {
        fail(422, 'Tenure must be between 1 and 120 months.');
    }
    $rate = $tenure < 12 ? 6.50 : ($tenure <= 24 ? 7.25 : ($tenure <= 36 ? 7.50 : 7.10));
    $maturity = round($amount * (1 + $rate / 400) ** (4 * $tenure / 12), 2);

    $pdo->beginTransaction();
    [$account, $newBalance] = debit_account($user, $d['account_number'], $amount,
        'Insufficient funds in selected savings account.');
    $number = 'DEP' . random_int(10000000, 99999999);
    $deposit = [
        'id' => uuid4(), 'user_id' => $user['id'], 'deposit_number' => $number, 'deposit_type' => $type,
        'source_account' => $account['account_number'], 'principal_amount' => $amount, 'interest_rate' => $rate,
        'tenure_months' => $tenure, 'interest_payout' => clip($d['interest_payout'] ?? '', 20) ?: 'on_maturity',
        'maturity_amount' => $maturity,
        'maturity_date' => (new DateTimeImmutable('today', new DateTimeZone(IST)))
            ->modify('+' . (int)($tenure * 30.4) . ' days')->format('Y-m-d'),
        'nominee_name' => clip($d['nominee_name'] ?? '', 150) ?: ($user['nominee_name'] ?? 'Registered Nominee'),
        'status' => 'active', 'created_at' => now_utc(),
    ];
    $pdo->prepare('INSERT INTO deposits (id, user_id, deposit_number, deposit_type, source_account, principal_amount,
            interest_rate, tenure_months, interest_payout, maturity_amount, maturity_date, nominee_name, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')->execute(array_values($deposit));
    insert_txn(['user_id' => $user['id'], 'account_number' => $account['account_number'], 'type' => 'debit',
        'mode' => 'DEPOSIT_BOOKING', 'amount' => $amount, 'balance_after' => $newBalance,
        'counterparty_name' => 'AJSPay Term Deposit', 'counterparty_acc' => $number, 'ref_number' => $number,
        'description' => ucfirst($type) . " deposit #$number booked"]);
    audit($user, 'DEPOSIT_BOOKED', "$number " . rupees($amount));
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
    need($d, 'loan_type', 'amount_requested', 'tenure_months', 'monthly_income', 'employment_type', 'purpose');
    $type = strtolower(clip($d['loan_type'], 30));
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
    $rate = LOAN_RATES[$type] ?? 10.0;
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
        'insurance_plans' => [
            ['id' => 'ins1', 'name' => 'AJSPay Life Shield Plus Term Plan', 'type' => 'Life Term Cover', 'cover' => '₹1.00 Crore', 'annual_premium' => 8450, 'claim_ratio' => '98.5%'],
            ['id' => 'ins2', 'name' => 'AJSPay Complete Health Shield', 'type' => 'Family Health Floater', 'cover' => '₹20.00 Lakhs', 'annual_premium' => 14200, 'claim_ratio' => '99.1%'],
            ['id' => 'ins3', 'name' => 'AJSPay Comprehensive Motor Insurance', 'type' => 'Zero-Dep Auto Cover', 'cover' => 'IDV Market Value', 'annual_premium' => 7100, 'claim_ratio' => '97.8%'],
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
    $pdo->prepare('INSERT INTO support_tickets (id, ticket_id, user_id, user_email, user_name, category, account_number,
            subject, description, status, priority, assigned_to)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        ->execute([uuid4(), $ticketId, $user['id'], $user['email'], $user['name'], clip($d['category'], 50),
            $accountNumber, $subject, clip($d['description'], 2000), 'OPEN',
            str_contains(strtolower($subject), 'fraud') ? 'HIGH' : 'MEDIUM', 'Grievance Redressal Desk']);
    audit($user, 'SUPPORT_TICKET', $ticketId);
    respond(['status' => 'SUCCESS', 'ticket_id' => $ticketId, 'message' => "Service request logged under Ticket #$ticketId."]);
}

function route_my_tickets(array $d): void
{
    $user = current_user();
    respond(['tickets' => out_all(rows('SELECT * FROM support_tickets WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
        [$user['id']]))]);
}

function route_branches(array $d): void
{
    respond(['branches' => out_all(rows('SELECT * FROM branches ORDER BY id'))]);
}

// route_chat now lives in modules/ai.php, where it can answer from the
// signed-in member's own data instead of a fixed list of replies.

// --- Refer & earn ------------------------------------------------------------------------
function referral_reward(): float
{
    return (float)(system_config()['referral_reward_amount'] ?? REFERRAL_REWARD_DEFAULT);
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
    $items = out_all(rows('SELECT id, referee_name, code, credit_amount, status, created_at FROM referrals
        WHERE referrer_id = ? ORDER BY created_at DESC LIMIT 100', [$user['id']]));
    $paid = array_filter($items, fn($i) => $i['status'] === 'paid');
    respond(['referrals' => $items, 'total_earned' => (float)array_sum(array_column($paid, 'credit_amount')),
        'count' => count($items)]);
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
