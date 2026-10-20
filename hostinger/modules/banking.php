<?php
// AJSPay: customer banking services. Cheques, demand drafts, deposits, loans,
// investments, support, branches, chatbot, referrals and standing instructions.
declare(strict_types=1);

// Defaults only, read when a row in system_parameters has been deleted or was
// never seeded. The rates actually charged/paid live in that table (see
// modules/parameters.php and the Business Parameters screen), not here -- a
// rate change is an admin-panel save, not a deploy.
const LOAN_RATE_DEFAULTS = ['personal' => 10.50, 'home' => 8.40, 'vehicle' => 8.75, 'gold' => 7.90, 'deposit' => 9.50];
// Nidhi Rules, 2014, rule 15: gold or jewellery, property, or the member's own
// deposit. 'deposit' is a loan secured on one of the member's active deposits.
const NIDHI_LOAN_TYPES = ['gold', 'home', 'deposit'];
const DEPOSIT_LOAN_LTV_DEFAULT = 90.0;   // % of what has been paid into the deposit

// What an active deposit is worth as security: what has actually been paid in.
function deposit_security_value(array $deposit): float
{
    return (float)($deposit['instalment_amount'] !== null ? $deposit['paid_amount'] : $deposit['principal_amount']);
}

// How much can be borrowed against a deposit, and for how long: a share of what has
// been paid in, repaid before the deposit matures.
function deposit_loan_terms(array $deposit): array
{
    $ltv = param_value('loan_against_deposit_ltv', DEPOSIT_LOAN_LTV_DEFAULT);
    $left = (new DateTimeImmutable('today'))->diff(new DateTimeImmutable($deposit['maturity_date']));
    return ['value' => deposit_security_value($deposit), 'ltv' => $ltv,
        'max_amount' => floor(deposit_security_value($deposit) * $ltv) / 100,
        'max_months' => $left->invert ? 0 : $left->y * 12 + $left->m];
}

// The loan (or application still being decided) a deposit secures, if any. A deposit
// secures at most one loan at a time, and cannot be closed early while it does.
function deposit_lien(string $depositNumber): ?array
{
    return row("SELECT 'loan' AS kind, loan_number AS ref, outstanding AS amount FROM loans
            WHERE security_deposit = ? AND status <> 'closed'
        UNION ALL SELECT 'application', loan_application_no, amount FROM loan_applications
            WHERE security_deposit = ? AND status IN ('under_review', 'approved') LIMIT 1", [$depositNumber, $depositNumber]);
}

const DEPOSIT_RATE_DEFAULTS = ['under_1y' => 6.50, '1y_to_2y' => 7.25, '2y_to_3y' => 7.50, 'over_3y' => 7.10];
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

// What has actually been paid into a deposit, and, for an instalment plan, the
// instalment and how often it falls due. run_instalments (cron.php) collects the rest.
function record_funding(string $depositNumber, float $paid, ?array $terms): void
{
    global $pdo;
    $byInstalment = $terms !== null && $terms['by_instalment'];
    $pdo->prepare('UPDATE deposits SET paid_amount = ?, instalment_amount = ?, instalment_every = ?
        WHERE deposit_number = ?')
        ->execute([$paid, $byInstalment ? $terms['unit'] : null, $byInstalment ? $terms['instalment_every'] : null,
            $depositNumber]);
}

// How much of an instalment plan has fallen due and not been paid by $today, and
// when the next instalment falls due. Instalment k (k = 1..N) is due k-1 days or
// months after booking. Shared by run_instalments (cron.php) and the member's notices.
function instalments_owed(array $deposit, string $today): array
{
    $unit = (float)$deposit['instalment_amount'];
    $ist = new DateTimeZone(IST);
    $booked = (new DateTimeImmutable($deposit['created_at'], new DateTimeZone('UTC')))->setTimezone($ist)->setTime(0, 0);
    $gap = $booked->diff(new DateTimeImmutable($today, $ist));
    $daily = $deposit['instalment_every'] === 'day';
    $elapsed = $daily ? (int)$gap->days : $gap->y * 12 + $gap->m;
    $total = (int)round((float)$deposit['principal_amount'] / $unit);
    $paidCount = (int)floor(((float)$deposit['paid_amount'] + 0.005) / $unit);
    $next = $paidCount >= $total ? null
        : $booked->modify('+' . $paidCount . ($daily ? ' days' : ' months'))->format('Y-m-d');
    return ['owed' => max(0.0, round(min($total, $elapsed + 1) * $unit - (float)$deposit['paid_amount'], 2)),
        'total' => $total, 'next_due' => $next];
}

// --- Counter deposits ----------------------------------------------------------------
// The cash or cheque a member hands over at the counter after their account
// already exists. Account opening funds itself (route_register, api.php); this
// is everything after that. Staff-only -- a member cannot credit their own
// account this way -- and every deposit is tied to the teller who took it.
const COUNTER_DEPOSIT_ROLES = ['staff', ...ADMIN_ROLES];
const COUNTER_DEPOSIT_MODES = ['cash', 'cheque'];
const COUNTER_DEPOSIT_MAX = 1000000.0;

// What the teller prints and hands over after taking money at the counter: who paid,
// into which account, how much, when, and the reference to quote if anything is
// disputed. $lines are extra label/value rows (plan, maturity, cheque number).
function deposit_slip(array $staff, array $owner, string $accountNumber, float $amount, string $ref, array $lines): array
{
    return ['slip_no' => $ref, 'at' => (new DateTimeImmutable('now', new DateTimeZone(IST)))->format('Y-m-d H:i'),
        'member' => $owner['name'], 'account_number' => $accountNumber, 'amount' => $amount,
        'received_by' => $staff['name'] ?? $staff['email'], 'lines' => $lines];
}

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
    require_nof_headroom($amount);

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
        // The member's own passbook shows who they paid the money to (the branch
        // counter), not which teller happened to key it in -- that belongs in the
        // audit trail below, not in a line that reads like someone paid *them*.
        'counterparty_name' => $mode === 'cash' ? 'Cash Deposit (Counter)' : 'Cheque Deposit (Counter)',
        'counterparty_acc' => 'BRANCH-CASH-DESK',
        'ref_number' => $ref, 'description' => $description]);
    audit($staff, 'COUNTER_DEPOSIT', "$accountNumber " . rupees($amount) . " ($mode) for {$owner['name']}");
    $pdo->commit();
    respond(['status' => 'SUCCESS', 'ref_number' => $ref, 'new_balance' => $newBalance,
        'message' => rupees($amount) . " credited to $accountNumber ({$owner['name']}). New balance: " . rupees($newBalance),
        'slip' => deposit_slip($staff, $owner, $accountNumber, $amount, $ref, array_values(array_filter([
            ['Paid in', $mode === 'cash' ? 'Cash' : "Cheque #$chequeNumber (subject to clearing)"],
            ['Into', 'Savings account'], ['Balance after', rupees($newBalance)],
            $remarks !== '' ? ['Remarks', $remarks] : null])))]);
}

// --- Staff-assisted deposit booking ---------------------------------------------------
// A teller opening an FD/RD/MIS for a member who is standing at the counter needs the
// same lookup a counter deposit does (account -> owner), plus a quick read of what that
// member already holds by deposit type, before booking a new one on their behalf.
function route_staff_member_lookup(array $d): void
{
    staff_user(CRM_ROLES);
    $accountNumber = clip($_GET['account_number'] ?? '', 30);
    if ($accountNumber === '') {
        fail(422, 'account_number is required.');
    }
    $account = row('SELECT * FROM accounts WHERE account_number = ?', [$accountNumber]);
    if (!$account) {
        fail(404, 'No member account with that number.');
    }
    $owner = row('SELECT * FROM users WHERE id = ?', [$account['user_id']]);
    $uid = $owner['id'];

    // deposit_type on the deposits table is only ever 'fixed' or 'recurring' -- a Monthly
    // Income Scheme deposit is a lump sum booked against a scheme, so it is stored as
    // 'fixed' and only distinguishable by joining back to schemes.scheme_type.
    $rows = rows("SELECT CASE WHEN s.scheme_type = 'mis' THEN 'mis' ELSE d.deposit_type END AS bucket,
            COALESCE(SUM(d.principal_amount), 0) AS total
        FROM deposits d LEFT JOIN schemes s ON s.code = d.scheme_code
        WHERE d.user_id = ? AND d.status = 'active' GROUP BY bucket", [$uid]);
    $byType = ['fixed' => 0.0, 'recurring' => 0.0, 'mis' => 0.0];
    foreach ($rows as $r) {
        if (isset($byType[$r['bucket']])) {
            $byType[$r['bucket']] = round((float)$r['total'], 2);
        }
    }

    respond([
        'member' => public_user($owner),
        'account' => out($account),
        'kyc' => ['status' => $owner['kyc_status'], 'reason' => $owner['kyc_reason']],
        'deposit_summary' => [
            'fixed' => $byType['fixed'],
            'recurring' => $byType['recurring'],
            'mis' => $byType['mis'],
            'total' => round($byType['fixed'] + $byType['recurring'] + $byType['mis'], 2),
        ],
    ]);
}

// Same pricing and booking logic as route_book_deposit, but for a member a teller is
// serving at the counter rather than the logged-in customer -- the account is looked up
// directly (as route_counter_deposit does) instead of scoped to current_user().
// A double-click, a retry on a slow connection or a refresh after submitting each used to book the deposit again and
// debit the account twice. An identical booking (same member, account, plan and amount) inside a minute of one that
// already exists is refused. Called inside the booking transaction after the account row is locked, so two
// simultaneous submits queue behind each other and the second sees the first.
function reject_duplicate_booking(string $userId, string $accountNumber, float $principal, ?string $planCode): void
{
    if ((int)scalar('SELECT COUNT(*) FROM deposits WHERE user_id = ? AND source_account = ? AND principal_amount = ?
            AND scheme_code <=> ? AND created_at >= ?',
            [$userId, $accountNumber, $principal, $planCode, gmdate('Y-m-d H:i:s', time() - 60)]) > 0) {
        fail(409, 'An identical deposit was booked a moment ago, so this one was not booked again. '
            . 'Check Your Deposits; if you do want a second one, wait a minute and try again.');
    }
}

function route_staff_book_deposit(array $d): void
{
    global $pdo;
    $staff = staff_user(CRM_ROLES);
    need($d, 'account_number', 'amount');
    $amount = money($d['amount']);
    if ($amount <= 0) {
        fail(400, 'Deposit amount must be greater than ₹0.');
    }
    $accountNumber = clip($d['account_number'], 30);

    // Membership admission (require_membership -> admit_member) runs its own
    // begin/commit and cannot nest inside the transaction below, so it has to
    // happen before that transaction opens -- same ordering route_book_deposit
    // uses for the logged-in member's own booking.
    $account = row('SELECT * FROM accounts WHERE account_number = ?', [$accountNumber]);
    if (!$account) {
        fail(404, 'No member account with that number.');
    }
    if ($account['status'] !== 'active') {
        fail(403, 'This account is not active for deposits.');
    }
    $owner = row('SELECT * FROM users WHERE id = ?', [$account['user_id']]);
    require_kyc_verified($owner);

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
    // After the plan and amount are known to be good, so a booking that is going
    // to be refused anyway never admits (and charges) anybody first.
    require_membership($owner, $dueToday);

    $pdo->beginTransaction();
    $account = row('SELECT * FROM accounts WHERE id = ? FOR UPDATE', [$account['id']]);
    if ((float)$account['balance'] < $dueToday) {
        fail(400, 'Insufficient funds in the member\'s selected savings account.');
    }
    $newBalance = round((float)$account['balance'] - $dueToday, 2);
    reject_duplicate_booking($owner['id'], $account['account_number'], $principal, $planCode !== '' ? $planCode : null);
    $pdo->prepare('UPDATE accounts SET balance = balance - ? WHERE id = ?')->execute([$dueToday, $account['id']]);

    $number = 'DEP' . random_int(10000000, 99999999);
    $deposit = [
        'id' => uuid4(), 'user_id' => $owner['id'], 'deposit_number' => $number, 'deposit_type' => $type,
        'scheme_code' => $planCode !== '' ? $planCode : null,
        'source_account' => $account['account_number'], 'principal_amount' => $principal, 'interest_rate' => $rate,
        'tenure_months' => $tenure, 'interest_payout' => $interestPayout,
        'maturity_amount' => $maturity,
        'maturity_date' => (new DateTimeImmutable('today', new DateTimeZone(IST)))
            ->modify('+' . (int)($tenure * 30.4) . ' days')->format('Y-m-d'),
        'nominee_name' => clip($d['nominee_name'] ?? '', 150) ?: ($owner['nominee_name'] ?? 'Registered Nominee'),
        'status' => 'active', 'created_at' => now_utc(),
    ];
    $pdo->prepare('INSERT INTO deposits (id, user_id, deposit_number, deposit_type, scheme_code, source_account,
            principal_amount, interest_rate, tenure_months, interest_payout, maturity_amount, maturity_date,
            nominee_name, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')->execute(array_values($deposit));
    insert_txn(['user_id' => $owner['id'], 'account_number' => $account['account_number'], 'type' => 'debit',
        'mode' => 'DEPOSIT_BOOKING', 'amount' => $dueToday, 'balance_after' => $newBalance,
        'counterparty_name' => $planCode !== '' ? $terms['scheme_name'] : 'AJSPay Term Deposit',
        'counterparty_acc' => $number, 'ref_number' => $number,
        'description' => ($planCode !== '' ? $terms['scheme_name'] : ucfirst($type) . ' deposit')
            . " #$number booked by branch staff"]);
    record_funding($number, $dueToday, $planCode !== '' ? $terms : null);
    audit($staff, 'STAFF_DEPOSIT_BOOKED', "$number " . rupees($dueToday) . " for {$owner['name']} ({$account['account_number']})");
    $pdo->commit();
    respond(['status' => 'SUCCESS',
        'message' => strtoupper($type) . " #$number booked for {$owner['name']}! "
            . deposit_outcome_note($interestPayout, $maturity, $principal, $planCode !== '' ? $terms : null),
        'deposit' => out($deposit),
        'slip' => deposit_slip($staff, $owner, $account['account_number'], $dueToday, $number, [
            ['Plan', $planCode !== '' ? $terms['scheme_name'] : ucfirst($type) . ' deposit'],
            ['Deposit number', $number], ['Taken from', 'Savings account'],
            ['Rate', $rate . '% a year'], ['Tenure', "$tenure months"],
            ['Maturity date', $deposit['maturity_date']], ['Maturity value', rupees((float)$maturity)],
            ['Nominee', $deposit['nominee_name']]])]);
}

// --- Deposits ----------------------------------------------------------------------------
function route_book_deposit(array $d): void
{
    global $pdo;
    $user = current_user();
    // Same "is this person who they say they are" bar as every other route
    // that moves money -- see require_kyc_verified() in api.php. Membership
    // alone is not enough: require_membership() below will happily admit an
    // unverified self-registration, and admission is not identity proof.
    require_kyc_verified($user);
    need($d, 'account_number', 'amount');
    $amount = money($d['amount']);
    if ($amount <= 0) {
        fail(400, 'Deposit amount must be greater than ₹0.');
    }

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

    // Nidhi Rules, 2014: deposits may be accepted from members only, and a
    // member must hold at least ten equity shares. require_membership() admits
    // the depositor on the spot if they are not on the register yet, so this
    // never turns away someone who is otherwise clear to deposit. Called once the
    // plan and amount have passed, so a refused booking charges nothing.
    require_membership($user, $dueToday);

    $pdo->beginTransaction();
    [$account, $newBalance] = debit_account($user, $d['account_number'], $dueToday,
        'Insufficient funds in selected savings account.');
    reject_duplicate_booking($user['id'], $account['account_number'], $principal, $planCode !== '' ? $planCode : null);
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
    record_funding($number, $dueToday, $planCode !== '' ? $terms : null);
    audit($user, 'DEPOSIT_BOOKED', "$number " . rupees($dueToday));
    $pdo->commit();
    respond(['status' => 'SUCCESS',
        'message' => strtoupper($type) . " #$number booked successfully! " . deposit_outcome_note($interestPayout, $maturity, $principal, $planCode !== '' ? $terms : null),
        'deposit' => out($deposit)]);
}

// What the member is told they will get. A plan that pays out as it goes only
// returns its principal at maturity, so "Maturity value" -- which for a daily
// plan is just the amount deposited -- read as if the deposit earned nothing.
function deposit_outcome_note(?string $interestPayout, float $maturity, float $principal, ?array $terms = null): string
{
    if ($terms !== null && $terms['by_instalment']) {
        return 'First instalment of ' . rupees($terms['unit']) . ' taken today. The rest is taken from your savings '
            . 'account every ' . $terms['instalment_every'] . ' until ' . rupees($principal)
            . ' is paid in; keep enough there. Maturity value when fully paid: ' . rupees($maturity) . '.';
    }
    return match ($interestPayout) {
        'daily' => 'Interest is credited to your account every day (less TDS); your '
            . rupees($principal) . ' is returned at maturity.',
        'monthly' => 'Interest is credited to your account every month; your '
            . rupees($principal) . ' is returned at maturity.',
        default => 'Maturity value: ' . rupees($maturity),
    };
}

// Days of interest a daily-plan deposit has earned but the daily job has not credited yet. Same day-by-day rule as
// run_daily_interest_accrual (cron.php): interest starts the day after booking, runs to the day before maturity,
// and stops at the term's 30-day-month total. Shown on the member's earnings screen, and paid out if the member
// closes early before the job has caught up.
function daily_pending_interest(array $dep): array
{
    if ($dep['interest_payout'] !== 'daily' || $dep['status'] !== 'active') {
        return [];
    }
    $ist = new DateTimeZone(IST);
    $started = (new DateTimeImmutable($dep['created_at'], new DateTimeZone('UTC')))->setTimezone($ist)->format('Y-m-d');
    $perDay = round((float)$dep['principal_amount'] * (float)$dep['interest_rate'] / 100 / 365, 2);
    $cap = round((float)$dep['principal_amount']
        * round((float)$dep['interest_rate'] / 100 / 365 * 30 * (int)$dep['tenure_months'], 2), 2);
    $day = new DateTimeImmutable($dep['last_payout_date'] ?? $started);
    $end = min(new DateTimeImmutable((new DateTimeImmutable('now', $ist))->format('Y-m-d')),
        new DateTimeImmutable($dep['maturity_date'] . ' -1 day'));
    $left = round($cap - (float)$dep['interest_paid'] - (float)$dep['accrued_interest'], 2);
    $pending = [];
    for ($n = 0; $n < 400 && $left > 0; $n++) {
        $day = $day->modify('+1 day');
        if ($day > $end) {
            break;
        }
        $earn = min($perDay, $left);
        $pending[] = ['date' => $day->format('Y-m-d'), 'earned' => $earn];
        $left = round($left - $earn, 2);
    }
    return $pending;
}

// What one deposit has earned, day by day from the day it started: every interest credit that reached the
// member's account, plus the days earned but not credited yet (the daily job has not run for them). POST, with
// the deposit number in the body, like the other deposit actions -- a deposit number does not belong in a URL.
function route_deposit_earnings(array $d): void
{
    $user = current_user();
    need($d, 'deposit_number');
    $dep = row('SELECT * FROM deposits WHERE deposit_number = ? AND user_id = ?',
        [clip($d['deposit_number'], 30), $user['id']]);
    if (!$dep) {
        fail(404, 'No deposit with that number.');
    }
    $ist = new DateTimeZone(IST);
    $started = (new DateTimeImmutable($dep['created_at'], new DateTimeZone('UTC')))->setTimezone($ist)->format('Y-m-d');
    $credits = [];
    foreach (rows("SELECT ref_number, amount, balance_after, timestamp FROM transactions
            WHERE user_id = ? AND type = 'credit' AND mode = 'DEPOSIT_INTEREST'
              AND (ref_number LIKE ? OR ref_number LIKE ?) ORDER BY seq",
            [$user['id'], 'DINT-' . $dep['deposit_number'] . '-%', 'INT-' . $dep['deposit_number'] . '-%']) as $t) {
        $day = preg_match('/-(\d{4})(\d{2})(\d{2})$/', $t['ref_number'], $m) ? "$m[1]-$m[2]-$m[3]" : substr($t['timestamp'], 0, 10);
        $credits[] = ['date' => $day, 'credited' => (float)$t['amount'], 'balance_after' => (float)$t['balance_after']];
    }
    // Same day-by-day rule as run_daily_interest_accrual (cron.php): interest starts the day after booking, runs to
    // the day before maturity, and stops at the term's 30-day-month total.
    $perDay = $dep['interest_payout'] === 'daily'
        ? round((float)$dep['principal_amount'] * (float)$dep['interest_rate'] / 100 / 365, 2) : 0.0;
    $termTotal = $perDay > 0 ? round((float)$dep['principal_amount']
        * round((float)$dep['interest_rate'] / 100 / 365 * 30 * (int)$dep['tenure_months'], 2), 2) : 0.0;
    $pending = daily_pending_interest($dep);
    respond([
        'deposit_number' => $dep['deposit_number'], 'plan' => $dep['scheme_code'], 'status' => $dep['status'],
        'principal' => (float)$dep['principal_amount'], 'interest_rate' => (float)$dep['interest_rate'],
        'interest_payout' => $dep['interest_payout'], 'started' => $started, 'maturity_date' => $dep['maturity_date'],
        'per_day' => $perDay, 'term_interest' => $termTotal,
        'earned_paid' => (float)$dep['interest_paid'], 'tds_deducted' => (float)$dep['tds_deducted'],
        'held_back' => (float)$dep['accrued_interest'],
        'credits' => $credits, 'pending' => $pending,
    ]);
}

const PREMATURE_MIN_HOLD_DAYS = 30;

// Same principle as breaking a bank FD early: the deposit does not keep the
// rate it was booked at, it drops to whatever a deposit of the time actually
// held would have earned (deposit_tier_rate, capped at the deposit's own
// contracted rate so a short-tenure tier can never pay MORE for leaving
// early), minus a penalty on top. Interest already paid out along the way
// (MIS monthly instalments, released daily-plan accruals) is never clawed
// back -- this only ever pays what is still owed for the time held, floored
// at zero, plus any daily-plan interest still sitting unreleased.
//
// ponytail: no automated test covers this route yet -- it needs a live API
// server plus a deposit backdated past PREMATURE_MIN_HOLD_DAYS, which the
// existing suites (api_test.sh's curl harness, cron_test.sh's cron.php
// harness) are not set up to do together. Exercise it by hand against a
// deposit whose created_at has been pushed back 30+ days before relying on
// this in production.
function route_premature_close(array $d): void
{
    global $pdo;
    $user = current_user();
    require_kyc_verified($user);
    need($d, 'deposit_number');
    $pdo->beginTransaction();
    $deposit = row("SELECT * FROM deposits WHERE deposit_number = ? AND user_id = ? AND status = 'active' FOR UPDATE",
        [clip($d['deposit_number'], 30), $user['id']]);
    if (!$deposit) {
        $pdo->rollBack();
        fail(404, 'No active deposit with that number.');
    }
    if (!$deposit['source_account']) {
        $pdo->rollBack();
        fail(400, 'This deposit has no linked account to pay proceeds into. Contact the branch.');
    }
    if ($lien = deposit_lien($deposit['deposit_number'])) {
        $pdo->rollBack();
        fail(409, "This deposit secures {$lien['kind']} {$lien['ref']}, so it cannot be closed early. "
            . 'Repay the loan (or withdraw the application) first.');
    }
    if (strtotime($deposit['maturity_date']) <= strtotime(now_utc())) {
        $pdo->rollBack();
        fail(400, 'This deposit has already reached its maturity date. It settles automatically at full '
            . 'term value; there is nothing to close early.');
    }
    $heldDays = (int)floor((strtotime(now_utc()) - strtotime($deposit['created_at'])) / 86400);
    // The plan's own lock-in (Scheme Master -> "Lock-in months"), else the
    // 30-day default. Read live: it governs when an exit is allowed, not a
    // return the member was promised, so unlike the rate it is not locked
    // into the deposit at booking.
    $lockIn = $deposit['scheme_code']
        ? scalar('SELECT lock_in_months FROM schemes WHERE code = ?', [$deposit['scheme_code']]) : null;
    $minHoldDays = $lockIn === null || $lockIn === false ? PREMATURE_MIN_HOLD_DAYS : (int)round((int)$lockIn * 30.4);
    if ($heldDays < $minHoldDays) {
        $pdo->rollBack();
        fail(400, $lockIn === null || $lockIn === false
            ? "This deposit must be held at least " . PREMATURE_MIN_HOLD_DAYS
                . " days before it can be closed early. It has been held $heldDays."
            : "This plan locks deposits for $lockIn month" . ((int)$lockIn === 1 ? '' : 's')
                . " before they can be closed early. It has been held $heldDays days, "
                . "so it unlocks in " . ($minHoldDays - $heldDays) . " more.");
    }
    $heldMonths = max(1, (int)round($heldDays / 30.4));
    // What was actually paid in comes back, not the contracted total of an
    // instalment plan. Instalments arrive spread across the time held, so on
    // average they were held half as long.
    // ponytail: assumes even instalments; per-instalment dates are the upgrade.
    $instalments = $deposit['instalment_amount'] !== null;
    $principal = (float)($instalments ? $deposit['paid_amount'] : $deposit['principal_amount']);
    $penaltyPct = param_value('premature_withdrawal_penalty_pct', 1.0);
    $effectiveRate = max(0.0, min(deposit_tier_rate($heldMonths), (float)$deposit['interest_rate']) - $penaltyPct);
    $earnedForPeriod = round($principal * $effectiveRate / 100 * ($instalments ? $heldDays / 2 : $heldDays) / 365, 2);
    $alreadyPaid = (float)$deposit['interest_paid'];
    $tierInterest = max(0.0, $earnedForPeriod - $alreadyPaid);
    // A daily plan's unreleased accrual is still owed regardless of the
    // formula above -- it is real interest already earned day by day, just
    // held back for the threshold -- so it goes out net of the same TDS a
    // scheduled release would have deducted, on top of $tierInterest.
    // Plus the days earned that the daily job has not credited yet, so closing before it catches up loses nothing.
    $accrued = round((float)$deposit['accrued_interest']
        + array_sum(array_column(daily_pending_interest($deposit), 'earned')), 2);
    $tds = $accrued > 0 ? round($accrued * param_value('tds_rate_daily_interest', 10.0) / 100, 2) : 0.0;
    // interest_paid tracks the gross amount earned, same convention
    // cron.php uses -- tds_deducted is where the TDS itself is recorded, so
    // this must not be reduced by it before going into interest_paid.
    $grossInterest = round($tierInterest + $accrued, 2);
    $netInterest = round($tierInterest + max(0.0, $accrued - $tds), 2);
    $payout = round($principal + $netInterest, 2);

    $account = row('SELECT * FROM accounts WHERE account_number = ?', [$deposit['source_account']]);
    if (!$account) {
        $pdo->rollBack();
        fail(404, 'The account this deposit pays into no longer exists. Contact the branch.');
    }
    $newBalance = round((float)$account['balance'] + $payout, 2);
    $pdo->prepare('UPDATE accounts SET balance = balance + ? WHERE id = ?')->execute([$payout, $account['id']]);
    $ref = 'PMC-' . $deposit['deposit_number'];
    insert_txn(['user_id' => $user['id'], 'account_number' => $account['account_number'], 'type' => 'credit',
        'mode' => 'DEPOSIT_PREMATURE_CLOSURE', 'amount' => $payout, 'balance_after' => $newBalance,
        'counterparty_name' => 'AJSPay Term Deposit', 'counterparty_acc' => $deposit['deposit_number'],
        'ref_number' => $ref,
        'description' => "{$deposit['deposit_number']} closed early after $heldDays days: " . rupees($principal)
            . " principal + " . rupees($netInterest) . " interest ({$effectiveRate}% p.a., {$penaltyPct}% early-exit "
            . "penalty applied)" . ($tds > 0 ? ", " . rupees($tds) . " TDS deducted from accrued interest" : '')]);
    $pdo->prepare("UPDATE deposits SET status = 'closed', closed_on = ?, interest_paid = interest_paid + ?,
            tds_deducted = tds_deducted + ?, accrued_interest = 0 WHERE id = ?")
        ->execute([now_utc(), $grossInterest, $tds, $deposit['id']]);
    audit($user, 'DEPOSIT_CLOSED_EARLY', "{$deposit['deposit_number']} " . rupees($payout) . " after $heldDays days");
    $pdo->commit();
    respond(['status' => 'SUCCESS',
        'message' => "{$deposit['deposit_number']} closed. " . rupees($payout)
            . " credited to {$account['account_number']} (" . rupees($principal) . " principal + "
            . rupees($netInterest) . " interest, at $effectiveRate% p.a. after the early-exit penalty).",
        'payout' => $payout, 'principal' => $principal, 'interest' => $netInterest, 'effective_rate' => $effectiveRate]);
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
    // Nidhi Rules, 2014 (Rule 15): a Nidhi lends only against gold, silver or diamond
    // jewellery, immovable property, or deposits and securities the member holds, so
    // unsecured personal loans and vehicle loans are not taken. Old applications of
    // those types stay on record.
    if (!in_array($type, NIDHI_LOAN_TYPES, true)) {
        fail(422, 'We lend against gold, property or your own deposit only: loan_type must be gold, home or deposit.');
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
    $security = null;
    if ($type === 'deposit') {
        need($d, 'deposit_number');
        $security = row("SELECT * FROM deposits WHERE deposit_number = ? AND user_id = ? AND status = 'active'",
            [clip($d['deposit_number'], 30), $user['id']]);
        if (!$security) {
            fail(404, 'No active deposit of yours with that number.');
        }
        if ($lien = deposit_lien($security['deposit_number'])) {
            fail(409, "This deposit already secures {$lien['kind']} {$lien['ref']}.");
        }
        $terms = deposit_loan_terms($security);
        if ($amount > $terms['max_amount']) {
            fail(422, 'Against this deposit you can borrow up to ' . rupees($terms['max_amount'])
                . " ({$terms['ltv']}% of the " . rupees($terms['value']) . ' paid in).');
        }
        if ($tenure > $terms['max_months']) {
            fail(422, "The loan must be repaid before the deposit matures: at most {$terms['max_months']} month"
                . ($terms['max_months'] === 1 ? '' : 's') . '.');
        }
    }
    $rate = loan_rate($type);
    $r = $rate / 12 / 100;
    $emi = round($amount * $r * (1 + $r) ** $tenure / ((1 + $r) ** $tenure - 1), 2);
    // Fully secured by the member's own money, so income does not decide it.
    $eligibility = $security || $income * 0.5 >= $emi ? 'Pre-Approved' : 'Under Review';
    $number = 'LN-' . gmdate('Ym') . '-' . random_int(10000, 99999);
    $id = uuid4();
    $pdo->prepare('INSERT INTO loan_applications (id, user_id, applicant, loan_application_no, loan_type, amount,
            tenure_months, roi, calculated_emi, monthly_income, employment_type, purpose, eligibility_status, status,
            security_deposit)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        ->execute([$id, $user['id'], $user['name'], $number, $type, $amount, $tenure, $rate, $emi, $income,
            clip($d['employment_type'], 50), clip($d['purpose'], 255), $eligibility, 'under_review',
            $security['deposit_number'] ?? null]);
    audit($user, 'LOAN_APPLIED', "$number $type " . rupees($amount));
    // Grade it for the loan desk. The grade is advisory: it never decides the
    // application, and the applicant is not shown it.
    store_loan_score_safely(['id' => $id, 'user_id' => $user['id'], 'amount' => $amount,
        'calculated_emi' => $emi, 'monthly_income' => $income,
        'employment_type' => clip($d['employment_type'], 50)]);
    respond(['status' => 'SUCCESS', 'application_no' => $number, 'calculated_emi' => $emi, 'interest_rate' => $rate,
        'eligibility' => $eligibility, 'message' => 'Application for ' . ucfirst($type) . ' Loan submitted successfully!']);
}

// --- Saved payees -------------------------------------------------------------------
const NEW_PAYEE_LIMIT = 25000.0;
const NEW_PAYEE_HOURS = 24;

// The name shown when a payee is saved, so the member can check they typed the right
// account, without handing out a full name to anyone who guesses account numbers.
function masked_name(string $name): string
{
    $parts = preg_split('/\s+/', trim($name));
    return implode(' ', array_map(fn($p, $i) => $i === 0 ? $p : mb_substr($p, 0, 1) . '.', $parts, array_keys($parts)));
}

// Refuses a large transfer to a payee that is not saved, or saved too recently.
function require_payee_cooled(array $user, string $to, float $amount): void
{
    if ($amount <= NEW_PAYEE_LIMIT) {
        return;
    }
    $ok = scalar('SELECT COUNT(*) FROM beneficiaries WHERE user_id = ? AND account_number = ? AND deleted_at IS NULL
        AND created_at <= ?', [$user['id'], $to, gmdate('Y-m-d H:i:s', time() - NEW_PAYEE_HOURS * 3600)]);
    if (!(int)$ok) {
        fail(403, 'Payments above ' . rupees(NEW_PAYEE_LIMIT) . ' go only to a saved payee, '
            . NEW_PAYEE_HOURS . ' hours after it was saved. Save this payee now, or send up to '
            . rupees(NEW_PAYEE_LIMIT) . ' today.');
    }
}

function route_beneficiaries_list(array $d): void
{
    $user = current_user();
    $cutoff = gmdate('Y-m-d H:i:s', time() - NEW_PAYEE_HOURS * 3600);
    respond(['payees' => array_map(fn($b) => out($b) + ['full_limit' => $b['created_at'] <= $cutoff],
        rows('SELECT id, account_number, name, nickname, created_at FROM beneficiaries WHERE user_id = ?
            AND deleted_at IS NULL ORDER BY nickname, name', [$user['id']])),
        'new_payee_limit' => NEW_PAYEE_LIMIT, 'cooling_hours' => NEW_PAYEE_HOURS]);
}

function route_beneficiary_add(array $d): void
{
    global $pdo;
    $user = current_user();
    need($d, 'account_number');
    $number = strtoupper(clip($d['account_number'], 30));
    $account = row("SELECT a.account_number, a.user_id, u.name FROM accounts a JOIN users u ON u.id = a.user_id
        WHERE a.account_number = ? AND a.status = 'active'", [$number]);
    if (!$account) {
        fail(404, 'No active member account with that number.');
    }
    if ($account['user_id'] === $user['id']) {
        fail(400, 'That is your own account; you do not need to save it.');
    }
    $name = masked_name($account['name']);
    $existing = row('SELECT id, deleted_at FROM beneficiaries WHERE user_id = ? AND account_number = ?', [$user['id'], $number]);
    if ($existing && $existing['deleted_at'] === null) {
        fail(400, 'This payee is already saved.');
    }
    // Re-adding a removed payee starts the cooling-off again.
    $pdo->prepare('DELETE FROM beneficiaries WHERE user_id = ? AND account_number = ?')->execute([$user['id'], $number]);
    $pdo->prepare('INSERT INTO beneficiaries (id, user_id, account_number, name, nickname, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        ->execute([uuid4(), $user['id'], $number, $name, clip($d['nickname'] ?? '', 60) ?: null, now_utc()]);
    audit($user, 'PAYEE_ADDED', "$number ($name)");
    security_event('PAYEE_ADDED', 'info', "$number added as a payee", $user);
    respond(['status' => 'SUCCESS', 'name' => $name, 'message' => "Saved $name ($number). You can send up to "
        . rupees(NEW_PAYEE_LIMIT) . ' now, and any amount after ' . NEW_PAYEE_HOURS . ' hours.']);
}

function route_beneficiary_remove(array $d, string $id = ''): void
{
    global $pdo;
    $user = current_user();
    $stmt = $pdo->prepare('UPDATE beneficiaries SET deleted_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL');
    $stmt->execute([now_utc(), $id, $user['id']]);
    if ($stmt->rowCount() === 0) {
        fail(404, 'Payee not found.');
    }
    audit($user, 'PAYEE_REMOVED', $id);
    respond(['status' => 'SUCCESS', 'message' => 'Payee removed.']);
}

// --- Loan accounts --------------------------------------------------------------------
// Reducing-balance EMI: the same formula route_apply_loan quotes.
function emi_amount(float $principal, float $rate, int $months): float
{
    $r = $rate / 12 / 100;
    return $r == 0.0 ? round($principal / $months, 2)
        : round($principal * $r * (1 + $r) ** $months / ((1 + $r) ** $months - 1), 2);
}

// The schedule, month by month from the disbursal date. Each EMI pays the month's
// interest on what is still owed and the rest off the principal; the last one
// absorbs the rounding so the loan ends at exactly zero.
function loan_schedule(float $principal, float $rate, int $months, string $start): array
{
    $emi = emi_amount($principal, $rate, $months);
    $r = $rate / 12 / 100;
    $balance = $principal;
    $rows = [];
    $from = new DateTimeImmutable($start);
    for ($n = 1; $n <= $months; $n++) {
        $interest = round($balance * $r, 2);
        $pay = $n === $months ? round($balance + $interest, 2) : $emi;
        $principalPart = round($pay - $interest, 2);
        $balance = round($balance - $principalPart, 2);
        $rows[] = ['n' => $n, 'due_date' => $from->modify("+$n months")->format('Y-m-d'), 'emi' => $pay,
            'principal_part' => $principalPart, 'interest_part' => $interest, 'balance_after' => max(0.0, $balance)];
    }
    return $rows;
}

// Opens the loan account: credits the principal to the borrower's savings account
// and writes the whole EMI schedule. Called inside the caller's transaction.
function disburse_loan(array $app, array $staff): array
{
    global $pdo;
    // Applications taken before lending was limited to secured loans can still be
    // sitting at "approved"; none of them may be paid out.
    if (!in_array(strtolower($app['loan_type']), NIDHI_LOAN_TYPES, true)) {
        fail(400, 'A ' . $app['loan_type'] . ' loan cannot be disbursed: a Nidhi lends only against gold, property or deposits. '
            . 'Reject this application.');
    }
    $borrower = row('SELECT * FROM users WHERE id = ?', [$app['user_id']]);
    if (!$borrower || $borrower['kyc_status'] !== 'verified') {
        fail(400, 'The borrower\'s KYC is not verified, so the loan cannot be disbursed.');
    }
    // Nidhi Rules, 2014: a Nidhi lends to its members only.
    if (!membership_of($borrower['id'])) {
        fail(400, 'The borrower is not on the member register. Admit them before disbursing.');
    }
    $account = row("SELECT * FROM accounts WHERE user_id = ? AND status = 'active' ORDER BY created_at, id LIMIT 1 FOR UPDATE",
        [$borrower['id']]);
    if (!$account) {
        fail(400, 'The borrower has no active account to receive the loan.');
    }
    if ($app['security_deposit']) {
        $security = row("SELECT * FROM deposits WHERE deposit_number = ? AND user_id = ? AND status = 'active' FOR UPDATE",
            [$app['security_deposit'], $borrower['id']]);
        if (!$security) {
            fail(400, "Deposit {$app['security_deposit']} securing this loan is no longer active. Reject this application.");
        }
        if (row("SELECT 1 FROM loans WHERE security_deposit = ? AND status <> 'closed'", [$app['security_deposit']])) {
            fail(400, "Deposit {$app['security_deposit']} already secures another loan.");
        }
    }
    // Applications approved before the pledge register existed reach here unvalued.
    if (strtolower($app['loan_type']) === 'gold') {
        $pledge = row("SELECT * FROM gold_pledges WHERE application_id = ? AND status = 'held'", [$app['id']]);
        if (!$pledge || (float)$app['amount'] > (float)$pledge['max_loan']) {
            fail(400, $pledge ? 'The loan is more than ' . rupees((float)$pledge['max_loan']) . ' that can be lent against the gold.'
                : 'Value the gold first (Record gold), then disburse.');
        }
    }
    $principal = (float)$app['amount'];
    $rate = (float)$app['roi'];
    $months = (int)$app['tenure_months'];
    $today = (new DateTimeImmutable('now', new DateTimeZone(IST)))->format('Y-m-d');
    $schedule = loan_schedule($principal, $rate, $months, $today);
    $loanId = uuid4();
    $number = 'LA' . random_int(10000000, 99999999);
    $pdo->prepare('INSERT INTO loans (id, application_id, user_id, loan_number, loan_type, account_number, principal,
            roi, tenure_months, emi, disbursed_on, outstanding, security_deposit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        ->execute([$loanId, $app['id'], $borrower['id'], $number, $app['loan_type'], $account['account_number'],
            $principal, $rate, $months, $schedule[0]['emi'], $today, $principal, $app['security_deposit'] ?: null]);
    $insert = $pdo->prepare('INSERT INTO loan_emis (id, loan_id, n, due_date, emi, principal_part, interest_part,
        balance_after) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    foreach ($schedule as $row) {
        $insert->execute([uuid4(), $loanId, $row['n'], $row['due_date'], $row['emi'], $row['principal_part'],
            $row['interest_part'], $row['balance_after']]);
    }
    $pdo->prepare('UPDATE accounts SET balance = balance + ? WHERE id = ?')->execute([$principal, $account['id']]);
    insert_txn(['user_id' => $borrower['id'], 'account_number' => $account['account_number'], 'type' => 'credit',
        'mode' => 'LOAN_DISBURSAL', 'amount' => $principal, 'balance_after' => round((float)$account['balance'] + $principal, 2),
        'counterparty_name' => ucfirst($app['loan_type']) . ' loan', 'counterparty_acc' => $number, 'ref_number' => $number,
        'description' => ucfirst($app['loan_type']) . " loan $number disbursed: $months EMIs of " . rupees($schedule[0]['emi'])]);
    audit($staff, 'LOAN_DISBURSED', "$number " . rupees($principal) . " to {$account['account_number']}");
    return ['loan_number' => $number, 'emi' => $schedule[0]['emi'], 'first_due' => $schedule[0]['due_date']];
}

// Takes one EMI from the borrower's account if it holds enough. Called inside a
// transaction with the loan row locked. Returns false, changing nothing, when short.
// --- Gold pledges ----------------------------------------------------------------------
// The jewellery behind a gold loan: what was handed over, what it is worth, and when
// it went back. Valued by the loan desk at today's 24-carat rate, which they enter;
// the loan may not exceed GOLD_LTV of that value.
const GOLD_KARATS = [14, 18, 20, 22, 24];
const GOLD_LTV_DEFAULT = 75.0;
const GOLD_DESK_ROLES = ['loan_officer', 'admin', 'branch_manager', 'bank_owner'];

function gold_pledge_public(array $p): array
{
    $p = out($p);
    $p['items'] = json_decode((string)$p['items'], true) ?: [];
    return $p;
}

// The receipt the member keeps. Same shape as a deposit slip (deposit_slip), so the
// same printable component draws it.
function gold_pledge_receipt(array $pledge, array $app, array $staff): array
{
    $lines = array_map(fn($i) => [$i['description'] . " ({$i['pieces']} pc)",
        "{$i['net_g']} g net, {$i['karat']}K"], $pledge['items']);
    $lines[] = ['Total net weight', $pledge['net_weight_g'] . ' g'];
    $lines[] = ['Valued at', rupees((float)$pledge['value']) . ' (24K ₹' . $pledge['rate_per_g_24k'] . '/g)'];
    $lines[] = ['Most that can be lent', rupees((float)$pledge['max_loan'])];
    $lines[] = ['Loan applied for', rupees((float)$app['amount']) . " ({$app['loan_application_no']})"];
    $owner = row('SELECT * FROM users WHERE id = ?', [$app['user_id']]) ?: ['name' => $app['applicant']];
    $account = scalar("SELECT account_number FROM accounts WHERE user_id = ? ORDER BY created_at LIMIT 1", [$app['user_id']]) ?: '';
    return ['title' => 'Gold pledge receipt'] + deposit_slip($staff, $owner, (string)$account, (float)$pledge['value'], $pledge['receipt_no'], $lines);
}

function route_gold_pledge_save(array $d): void
{
    global $pdo;
    $staff = staff_user(GOLD_DESK_ROLES);
    need($d, 'application_id', 'rate_per_g_24k', 'items');
    $app = row('SELECT * FROM loan_applications WHERE id = ?', [clip($d['application_id'], 36)]);
    if (!$app || strtolower($app['loan_type']) !== 'gold') {
        fail(404, 'No gold loan application with that id.');
    }
    if (!in_array($app['status'], ['submitted', 'under_review', 'documentation', 'approved'], true)) {
        fail(400, "The application is {$app['status']}; the gold can only be valued before the loan is paid out.");
    }
    $rate = money($d['rate_per_g_24k']);
    if ($rate < 1000 || $rate > 50000) {
        fail(422, 'Enter today\'s 24-carat rate per gram (between ₹1,000 and ₹50,000).');
    }
    if (!is_array($d['items']) || !$d['items'] || count($d['items']) > 30) {
        fail(422, 'List each item handed over (1 to 30 items).');
    }
    $items = [];
    $net = $value = 0.0;
    foreach ($d['items'] as $i => $item) {
        $n = $i + 1;
        $desc = clip($item['description'] ?? '', 80);
        $pieces = (int)($item['pieces'] ?? 1);
        $gross = round((float)($item['gross_g'] ?? 0), 3);
        $netG = round((float)($item['net_g'] ?? 0), 3);
        $karat = (int)($item['karat'] ?? 0);
        if ($desc === '' || $pieces < 1 || $pieces > 100) {
            fail(422, "Item $n: describe it and give the number of pieces.");
        }
        if ($gross <= 0 || $gross > 5000 || $netG <= 0 || $netG > $gross) {
            fail(422, "Item $n: net weight must be above 0 and no more than the gross weight.");
        }
        if (!in_array($karat, GOLD_KARATS, true)) {
            fail(422, "Item $n: purity must be 14, 18, 20, 22 or 24 carat.");
        }
        $items[] = ['description' => $desc, 'pieces' => $pieces, 'gross_g' => $gross, 'net_g' => $netG, 'karat' => $karat];
        $net += $netG;
        $value += $netG * $karat / 24 * $rate;
    }
    $value = floor($value);
    $ltv = param_value('gold_loan_ltv', GOLD_LTV_DEFAULT);
    $maxLoan = floor($value * $ltv / 100);
    $existing = row('SELECT * FROM gold_pledges WHERE application_id = ?', [$app['id']]);
    $receipt = $existing['receipt_no'] ?? 'GP-' . gmdate('Ymd') . '-' . random_int(10000, 99999);
    $pdo->prepare('INSERT INTO gold_pledges (id, application_id, user_id, receipt_no, items, net_weight_g, rate_per_g_24k,
            value, ltv, max_loan, valued_by, valued_at, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), ?)
        ON DUPLICATE KEY UPDATE items = VALUES(items), net_weight_g = VALUES(net_weight_g), rate_per_g_24k = VALUES(rate_per_g_24k),
            value = VALUES(value), ltv = VALUES(ltv), max_loan = VALUES(max_loan), valued_by = VALUES(valued_by),
            valued_at = VALUES(valued_at)')
        ->execute([$existing['id'] ?? uuid4(), $app['id'], $app['user_id'], $receipt, json_encode($items),
            round($net, 3), $rate, $value, $ltv, $maxLoan, $staff['name'] ?? $staff['email'], 'held']);
    audit($staff, 'GOLD_PLEDGE_VALUED', "$receipt for {$app['loan_application_no']}: " . round($net, 3) . ' g, ' . rupees($value));
    $pledge = gold_pledge_public(row('SELECT * FROM gold_pledges WHERE application_id = ?', [$app['id']]));
    respond(['status' => 'SUCCESS', 'pledge' => $pledge, 'receipt' => gold_pledge_receipt($pledge, $app, $staff),
        'message' => 'Gold valued at ' . rupees($value) . '. Up to ' . rupees($maxLoan) . ' can be lent against it'
            . ((float)$app['amount'] > $maxLoan ? '; the ' . rupees((float)$app['amount']) . ' applied for is more, so reduce the loan or reject it.' : '.')]);
}

function route_gold_pledge_get(array $d): void
{
    $staff = staff_user(GOLD_DESK_ROLES);
    $app = row('SELECT * FROM loan_applications WHERE id = ?', [clip($_GET['application_id'] ?? '', 36)]);
    $pledge = $app ? row('SELECT * FROM gold_pledges WHERE application_id = ?', [$app['id']]) : null;
    if (!$pledge) {
        respond(['pledge' => null, 'ltv' => param_value('gold_loan_ltv', GOLD_LTV_DEFAULT)]);
    }
    $pledge = gold_pledge_public($pledge);
    respond(['pledge' => $pledge, 'receipt' => gold_pledge_receipt($pledge, $app, $staff),
        'ltv' => param_value('gold_loan_ltv', GOLD_LTV_DEFAULT)]);
}

// The jewellery goes back once nothing is owed: the loan is closed, or it never started.
function route_gold_pledge_release(array $d): void
{
    global $pdo;
    $staff = staff_user(GOLD_DESK_ROLES);
    need($d, 'application_id');
    $pledge = row("SELECT * FROM gold_pledges WHERE application_id = ? AND status = 'held'", [clip($d['application_id'], 36)]);
    if (!$pledge) {
        fail(404, 'No gold is held against that application.');
    }
    $app = row('SELECT * FROM loan_applications WHERE id = ?', [$pledge['application_id']]);
    $loan = row('SELECT * FROM loans WHERE application_id = ?', [$pledge['application_id']]);
    if ($loan ? $loan['status'] !== 'closed' : $app['status'] !== 'rejected') {
        fail(400, $loan ? "Loan {$loan['loan_number']} still owes " . rupees((float)$loan['outstanding']) . '. Return the gold once it is repaid.'
            : 'The application is still open. Reject it first, or return the gold after the loan is repaid.');
    }
    $pdo->prepare("UPDATE gold_pledges SET status = 'returned', returned_at = UTC_TIMESTAMP(), returned_by = ? WHERE id = ?")
        ->execute([$staff['name'] ?? $staff['email'], $pledge['id']]);
    audit($staff, 'GOLD_PLEDGE_RETURNED', "{$pledge['receipt_no']} returned to the member");
    respond(['status' => 'SUCCESS', 'message' => "Gold under {$pledge['receipt_no']} marked as returned to the member."]);
}

// At maturity, a loan the deposit secures is repaid from the proceeds just credited
// to the member's account, before they can spend them. The interest for the part
// month since the last EMI is not charged.
// ponytail: waives the broken-period interest (at most one month's); charge it
// pro rata here if the loan desk wants it.
function settle_loan_from_deposit(array $deposit, string $today): ?string
{
    global $pdo;
    $loan = row("SELECT * FROM loans WHERE security_deposit = ? AND status <> 'closed' FOR UPDATE", [$deposit['deposit_number']]);
    if (!$loan || (float)$loan['outstanding'] <= 0) {
        return null;
    }
    $account = row('SELECT * FROM accounts WHERE account_number = ? FOR UPDATE', [$loan['account_number']]);
    $due = (float)$loan['outstanding'];
    if (!$account || (float)$account['balance'] < $due) {
        return null;   // the nightly EMI run keeps collecting
    }
    $pdo->prepare('UPDATE accounts SET balance = balance - ? WHERE id = ?')->execute([$due, $account['id']]);
    $pdo->prepare('UPDATE loan_emis SET paid_on = ? WHERE loan_id = ? AND paid_on IS NULL')->execute([$today, $loan['id']]);
    $pdo->prepare("UPDATE loans SET outstanding = 0, status = 'closed', dpd = 0 WHERE id = ?")->execute([$loan['id']]);
    insert_txn(['user_id' => $account['user_id'], 'account_number' => $account['account_number'], 'type' => 'debit',
        'mode' => 'LOAN_EMI', 'amount' => $due, 'balance_after' => round((float)$account['balance'] - $due, 2),
        'counterparty_name' => 'Deposit loan', 'counterparty_acc' => $loan['loan_number'],
        'ref_number' => 'SETTLE-' . $loan['loan_number'],
        'description' => "Loan {$loan['loan_number']} repaid from the maturity of deposit {$deposit['deposit_number']}"]);
    return $loan['loan_number'] . ' repaid ' . rupees($due);
}

function pay_loan_emi(array $loan, array $emi, string $today): bool
{
    global $pdo;
    $account = row('SELECT * FROM accounts WHERE account_number = ? FOR UPDATE', [$loan['account_number']]);
    if (!$account || $account['status'] !== 'active' || (float)$account['balance'] < (float)$emi['emi']) {
        return false;
    }
    $amount = (float)$emi['emi'];
    $pdo->prepare('UPDATE accounts SET balance = balance - ? WHERE id = ?')->execute([$amount, $account['id']]);
    $pdo->prepare('UPDATE loan_emis SET paid_on = ? WHERE id = ?')->execute([$today, $emi['id']]);
    $pdo->prepare("UPDATE loans SET outstanding = GREATEST(0, outstanding - ?), interest_paid = interest_paid + ?,
            emis_paid = emis_paid + 1, status = IF(emis_paid >= tenure_months, 'closed', status) WHERE id = ?")
        // MySQL applies SET left to right, so status already sees the new emis_paid.
        ->execute([(float)$emi['principal_part'], (float)$emi['interest_part'], $loan['id']]);
    insert_txn(['user_id' => $account['user_id'], 'account_number' => $account['account_number'], 'type' => 'debit',
        'mode' => 'LOAN_EMI', 'amount' => $amount, 'balance_after' => round((float)$account['balance'] - $amount, 2),
        'counterparty_name' => ucfirst($loan['loan_type']) . ' loan', 'counterparty_acc' => $loan['loan_number'],
        'ref_number' => 'EMI-' . $loan['loan_number'] . '-' . $emi['n'],
        'description' => "EMI {$emi['n']} of {$loan['tenure_months']} on {$loan['loan_number']}: "
            . rupees((float)$emi['principal_part']) . ' principal + ' . rupees((float)$emi['interest_part']) . ' interest']);
    return true;
}

// Days past due on the oldest unpaid EMI, and the status that follows (NPA at 90).
function refresh_loan_ageing(string $loanId, string $today): void
{
    global $pdo;
    $oldest = scalar('SELECT MIN(due_date) FROM loan_emis WHERE loan_id = ? AND paid_on IS NULL AND due_date <= ?',
        [$loanId, $today]);
    $dpd = $oldest ? (int)(new DateTimeImmutable($oldest))->diff(new DateTimeImmutable($today))->days : 0;
    $pdo->prepare("UPDATE loans SET dpd = ?, status = CASE WHEN status = 'closed' THEN 'closed'
            WHEN ? >= 90 THEN 'npa' ELSE 'active' END WHERE id = ?")->execute([$dpd, $dpd, $loanId]);
}

// The member pays their next EMI now, from their savings, instead of waiting for the
// nightly debit. Pays the oldest unpaid EMI, due or not.
function route_loan_pay_emi(array $d): void
{
    global $pdo;
    $user = current_user();
    require_kyc_verified($user);
    need($d, 'loan_number');
    $today = (new DateTimeImmutable('now', new DateTimeZone(IST)))->format('Y-m-d');
    $pdo->beginTransaction();
    $loan = row("SELECT * FROM loans WHERE loan_number = ? AND user_id = ? AND status <> 'closed' FOR UPDATE",
        [clip($d['loan_number'], 30), $user['id']]);
    if (!$loan) {
        $pdo->rollBack();
        fail(404, 'No open loan with that number.');
    }
    $emi = row('SELECT * FROM loan_emis WHERE loan_id = ? AND paid_on IS NULL ORDER BY n LIMIT 1', [$loan['id']]);
    if (!$emi || !pay_loan_emi($loan, $emi, $today)) {
        $pdo->rollBack();
        fail(400, 'Your savings account does not hold the ' . rupees((float)($emi['emi'] ?? 0)) . ' this EMI needs.');
    }
    refresh_loan_ageing($loan['id'], $today);
    audit($user, 'LOAN_EMI_PAID', "{$loan['loan_number']} EMI {$emi['n']}");
    $pdo->commit();
    respond(['status' => 'SUCCESS', 'message' => "EMI {$emi['n']} of " . rupees((float)$emi['emi'])
        . " paid on {$loan['loan_number']}."]);
}

function route_my_loans(array $d): void
{
    $user = current_user();
    respond(['loans' => out_all(rows('SELECT id, loan_application_no, loan_type, amount AS amount_requested,
            roi AS interest_rate, tenure_months, calculated_emi, monthly_income, employment_type, purpose,
            eligibility_status, status, security_deposit, created_at
        FROM loan_applications WHERE user_id = ? ORDER BY created_at DESC', [$user['id']])),
        // The loan accounts behind disbursed applications, each with its schedule.
        'accounts' => array_map(fn($l) => out($l) + ['schedule' => out_all(rows('SELECT n, due_date, emi,
                principal_part, interest_part, balance_after, paid_on FROM loan_emis WHERE loan_id = ? ORDER BY n',
                [$l['id']]))],
            rows('SELECT * FROM loans WHERE user_id = ? ORDER BY created_at DESC', [$user['id']])),
        // Active deposits not already securing a loan, with what each can raise.
        'pledgeable' => array_values(array_filter(array_map(
            fn($dep) => deposit_lien($dep['deposit_number']) ? null : ['deposit_number' => $dep['deposit_number'],
                'scheme_code' => $dep['scheme_code'], 'maturity_date' => $dep['maturity_date']] + deposit_loan_terms($dep),
            rows("SELECT * FROM deposits WHERE user_id = ? AND status = 'active' ORDER BY maturity_date", [$user['id']])),
            fn($x) => $x && $x['max_amount'] >= 1000 && $x['max_months'] >= 1)),
        'deposit_loan_rate' => loan_rate('deposit')]);
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

// Records who introduced a new member. Nothing is credited to either of them: the
// Nidhi Rules, 2014 (Rule 6) forbid any brokerage or incentive for mobilising
// members or deposits, so this used to be a ₹500 bonus each and is now only the
// row the network tree and the standing ladder read. status 'paid' is kept as the
// stored value for "introduction completed" because the ladder counts on it.
function record_referral(string $userId, string $name, string $email, string $code): bool
{
    global $pdo;
    $referrer = row('SELECT * FROM users WHERE referral_code = ?', [$code]);
    if (!$referrer || $referrer['id'] === $userId) {
        return false;
    }
    $pdo->prepare('INSERT INTO referrals (id, referrer_id, referrer_email, referee_id, referee_name, referee_email, code,
            credit_amount, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        ->execute([uuid4(), $referrer['id'], $referrer['email'], $userId, $name, $email, $code, 0, 'paid']);
    return true;
}

// A self-registered member's referral is on hold in users.referred_by_code
// until this moment: KYC verification is the point route_self_register's own
// message promised the introduction would count from ("as soon as they open an
// account and complete KYC"), and the first point this account is allowed to hold a
// recorded introduction at all. Called from inside the caller's own KYC-approval
// transaction, so it never runs outside one. Safe to call on every KYC
// approval, verified-to-verified included: the referrals row it checks for
// is the guard against paying the same referee twice.
function pay_pending_referral(array $user): void
{
    $code = $user['referred_by_code'] ?? '';
    if ($code === '' || $code === null) {
        return;
    }
    if (row('SELECT id FROM referrals WHERE referee_id = ?', [$user['id']])) {
        return;
    }
    record_referral($user['id'], $user['name'], $user['email'] ?? '', $code);
}

function route_referral_code(array $d): void
{
    global $config;
    $user = current_user();
    $code = ensure_referral_code($user);
    respond(['referral_code' => $code,
        // Allotted on admission to the member register (after KYC); null before that.
        'folio_no' => scalar('SELECT folio_no FROM member_register WHERE user_id = ?', [$user['id']]),
        'referral_link' => rtrim($config['public_app_url'], '/') . '/open-account?ref=' . rawurlencode($code),
        'note' => 'Anyone who opens a member account with your link and completes KYC is recorded as '
            . 'introduced by you. No bonus or commission is paid for introductions (Nidhi Rules, 2014).']);
}

function route_referral_history(array $d): void
{
    $user = current_user();
    // referee_name is a snapshot taken when the referral was recorded. It goes
    // stale when a member's name is corrected, and it is empty for referrals
    // written by anything other than record_referral(). The live name wins where
    // there is one; the snapshot is the fallback, so an account that has since
    // been removed still shows who it was.
    $paidRows = rows("SELECT r.id, COALESCE(u.name, r.referee_name) AS referee_name,
            u.phone AS referee_phone, COALESCE(u.email, r.referee_email) AS referee_email,
            r.code, r.credit_amount, r.status, r.created_at
        FROM referrals r LEFT JOIN users u ON u.id = r.referee_id
        WHERE r.referrer_id = ? ORDER BY r.created_at DESC LIMIT 100", [$user['id']]);
    $code = $user['referral_code'] ?? '';
    $pendingRows = $code === '' ? [] : rows("SELECT CONCAT('pending-', u.id) AS id,
            u.name AS referee_name, u.phone AS referee_phone, u.email AS referee_email,
            u.referred_by_code AS code, 0 AS credit_amount, 'pending_kyc' AS status, u.created_at
        FROM users u
        WHERE u.referred_by_code = ? AND u.id <> ?
            AND NOT EXISTS (SELECT 1 FROM referrals r WHERE r.referee_id = u.id)
        ORDER BY u.created_at DESC LIMIT 100", [$code, $user['id']]);
    $items = out_all(array_merge($paidRows, $pendingRows));
    usort($items, fn($a, $b) => strcmp((string)$b['created_at'], (string)$a['created_at']));
    $items = array_slice($items, 0, 100);
    $paid = array_filter($items, fn($i) => $i['status'] === 'paid');
    respond(['referrals' => $items, 'total_earned' => (float)array_sum(array_column($paid, 'credit_amount')),
        'count' => count($items), 'pending_count' => count($pendingRows)]);
}

// --- My Network ---------------------------------------------------------------------------
// Who a member introduced, drawn as a tree. Recognition only: the Nidhi Rules, 2014
// (Rule 6) forbid any brokerage or incentive for mobilising members or deposits, so
// the plan book's 12-level commission table and turnover programmes are not shown
// anywhere in the app and nothing here moves money.

// Every member below this one, with the referrer they actually joined under. Walked
// a level at a time with everybody seen so far excluded, so a chain that loops back
// on itself cannot spin here.
function referral_tree(string $userId, int $maxDepth = 20): array
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
    // Paying outside the Nidhi needs a payment partner (compliance.php). Without one
    // the nightly run could only fail and pause it, so refuse it here instead.
    if (!capability_enabled('payment_systems')
        && !row("SELECT 1 FROM accounts WHERE account_number = ? AND status = 'active'", [clip($d['beneficiary_account'], 50)])) {
        fail(422, 'Standing instructions can only pay another member\'s account. Check the account number.');
    }
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
