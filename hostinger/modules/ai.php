<?php
// AJSPay: the AI module. Four things, all of them computed here on the server
// from our own MySQL data:
//
//   1. Fraud and AML scoring on every transfer            score_transfer()
//   2. An assistant that answers from the member's data    route_chat()
//   3. Credit risk grading for loan applications           score_loan()
//   4. Anomaly checks over agent collections               route_collection_anomalies()
//
// Nothing here calls an external service and nothing leaves the server: no API
// keys, no third-party library, no member data sent anywhere. The scoring is
// ordinary statistics (medians, absolute deviations, rates over time windows)
// rather than a model file, which keeps it explainable — every alert and every
// grade carries the reasons that produced it, which is what a reviewer and a
// regulator both need to see.
declare(strict_types=1);

// Cash transaction reports under the PMLA start at ₹10 lakh. We use it as the
// reference point for spotting amounts deliberately kept just underneath.
const CTR_THRESHOLD = 1000000.0;
const FRAUD_ALERT_FLOOR = 30;   // below this a transfer is not worth recording
const FRAUD_SEVERITY = [80 => 'high', 60 => 'medium', 30 => 'low'];
const AML_REVIEW_ROLES = ['bank_owner', 'admin', 'branch_manager', 'staff'];

// --- Small statistics helpers -------------------------------------------------------
function median(array $values): float
{
    $values = array_values(array_filter($values, 'is_numeric'));
    if ($values === []) {
        return 0.0;
    }
    sort($values);
    $count = count($values);
    $mid = intdiv($count, 2);
    return $count % 2 ? (float)$values[$mid] : ((float)$values[$mid - 1] + (float)$values[$mid]) / 2;
}

// Median absolute deviation: a spread measure that a single huge outlier cannot
// inflate, which matters because the outliers are exactly what we are hunting.
function mad(array $values, float $median): float
{
    if ($values === []) {
        return 0.0;
    }
    return median(array_map(fn($v) => abs((float)$v - $median), $values));
}

// How unusual $value is against this member's own history, in robust z units.
function robust_z(float $value, array $history): float
{
    $median = median($history);
    $spread = mad($history, $median);
    if ($spread < 1.0) {
        // Near-identical history: fall back to a ratio so a first big transfer
        // still registers instead of dividing by ~zero.
        return $median > 0 ? ($value / $median) - 1 : 0.0;
    }
    return 0.6745 * ($value - $median) / $spread;
}

function severity_for(int $score): string
{
    foreach (FRAUD_SEVERITY as $floor => $label) {
        if ($score >= $floor) {
            return $label;
        }
    }
    return 'none';
}

// --- 1. Fraud and AML scoring --------------------------------------------------------
// Called right after a transfer is committed. Returns the alert row it wrote, or
// null when the transfer looked ordinary.
//
// Every signal is measured against the member's own behaviour, not a global
// rule, so a corporate account moving lakhs daily is not flagged for doing what
// it always does, while the same amount from a small savings account is.
function score_transfer(array $user, array $txn): array
{
    $amount = (float)$txn['amount'];
    $account = (string)$txn['account_number'];
    $payee = (string)($txn['counterparty_acc'] ?? '');
    $reasons = [];
    $score = 0;

    $add = function (string $code, string $label, int $weight) use (&$reasons, &$score): void {
        $reasons[] = ['code' => $code, 'label' => $label, 'weight' => $weight];
        $score += $weight;
    };

    // History: this member's own outgoing amounts over the last 6 months,
    // excluding the transfer we are scoring.
    $history = array_map('floatval', array_column(rows(
        "SELECT amount FROM transactions WHERE user_id = ? AND type = 'debit'
           AND ref_number <> ? AND timestamp >= DATE_SUB(?, INTERVAL 180 DAY)
         ORDER BY timestamp DESC, seq DESC LIMIT 500",
        [$user['id'], (string)($txn['ref_number'] ?? ''), now_utc()]
    ), 'amount'));

    if (count($history) >= 5) {
        $z = robust_z($amount, $history);
        if ($z >= 8) {
            $add('amount_extreme', sprintf('Amount is far outside this member\'s usual range (typical %s, this %s)',
                rupees(median($history)), rupees($amount)), 35);
        } elseif ($z >= 4) {
            $add('amount_unusual', sprintf('Amount well above this member\'s usual range (typical %s, this %s)',
                rupees(median($history)), rupees($amount)), 20);
        }
    } elseif ($amount >= 100000) {
        $add('amount_no_history', 'Large transfer with little prior transfer history to compare against', 15);
    }

    // Velocity: bursts are a stronger signal than any single amount.
    $lastHour = (int)scalar("SELECT COUNT(*) FROM transactions WHERE user_id = ? AND type = 'debit'
        AND timestamp >= DATE_SUB(?, INTERVAL 1 HOUR)", [$user['id'], now_utc()]);
    if ($lastHour >= 8) {
        $add('velocity_hour', "$lastHour outgoing payments in the last hour", 30);
    } elseif ($lastHour >= 5) {
        $add('velocity_hour', "$lastHour outgoing payments in the last hour", 15);
    }
    $dayTotal = (float)scalar("SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE user_id = ?
        AND type = 'debit' AND timestamp >= DATE_SUB(?, INTERVAL 1 DAY)", [$user['id'], now_utc()]);
    $typicalDay = median($history) * 3;
    if ($typicalDay > 0 && $dayTotal > $typicalDay * 5 && $dayTotal >= 50000) {
        $add('velocity_day', 'Total moved today (' . rupees($dayTotal) . ") is well above this member's normal day", 20);
    }

    // A payee never paid before, weighted by how much is going to them.
    if ($payee !== '') {
        $seen = (int)scalar("SELECT COUNT(*) FROM transactions WHERE user_id = ? AND counterparty_acc = ?
            AND ref_number <> ?", [$user['id'], $payee, (string)($txn['ref_number'] ?? '')]);
        if ($seen === 0) {
            $weight = $amount >= 200000 ? 25 : ($amount >= 50000 ? 15 : 5);
            $add('new_payee', 'First ever payment to this beneficiary' .
                ($amount >= 50000 ? ', for a large amount' : ''), $weight);
        }
    }

    // Structuring: amounts parked just under the reporting threshold, and
    // several such amounts in a day that together cross it.
    if ($amount >= CTR_THRESHOLD * 0.9 && $amount < CTR_THRESHOLD) {
        $add('threshold_shaving', 'Amount sits just below the ' . rupees(CTR_THRESHOLD)
            . ' reporting threshold', 30);
    }
    $nearThreshold = (int)scalar("SELECT COUNT(*) FROM transactions WHERE user_id = ? AND type = 'debit'
        AND amount >= ? AND amount < ? AND timestamp >= DATE_SUB(?, INTERVAL 1 DAY)",
        [$user['id'], CTR_THRESHOLD * 0.7, CTR_THRESHOLD, now_utc()]);
    if ($nearThreshold >= 3 && $dayTotal >= CTR_THRESHOLD) {
        $add('structuring', "$nearThreshold payments today just under the threshold, together above it", 35);
    }
    if ($amount >= CTR_THRESHOLD) {
        $add('ctr_threshold', 'At or above the ' . rupees(CTR_THRESHOLD)
            . ' threshold — check whether a report is due', 10);
    }

    // Odd hours, in Indian time.
    $hour = (int)(new DateTimeImmutable('now', new DateTimeZone(IST)))->format('G');
    if ($hour >= 0 && $hour < 5 && $amount >= 25000) {
        $add('odd_hour', sprintf('Sent at %02d:00 IST, outside this member\'s normal hours', $hour), 15);
    }

    // A long-quiet account suddenly moving money.
    $lastActive = scalar("SELECT MAX(timestamp) FROM transactions WHERE user_id = ? AND ref_number <> ?",
        [$user['id'], (string)($txn['ref_number'] ?? '')]);
    if ($lastActive !== null && $amount >= 50000
        && (new DateTimeImmutable($lastActive))->diff(new DateTimeImmutable(now_utc()))->days >= 90) {
        $add('dormant_reactivated', 'Account had been dormant for over 90 days before this payment', 25);
    }

    // Nearly emptying the account in one go.
    $balanceAfter = (float)($txn['balance_after'] ?? 0);
    if ($amount > 0 && $balanceAfter >= 0 && $amount >= 25000
        && $balanceAfter < ($amount + $balanceAfter) * 0.05) {
        $add('account_swept', 'Payment left the account almost empty', 20);
    }

    // Unverified KYC moving significant money.
    if (($user['kyc_status'] ?? '') !== 'verified' && $amount >= 50000) {
        $add('kyc_unverified', 'KYC is not verified for this member', 20);
    }

    $score = min(100, $score);
    if ($score < FRAUD_ALERT_FLOOR || $reasons === []) {
        return ['score' => $score, 'severity' => 'none', 'reasons' => $reasons, 'alert_id' => null];
    }

    global $pdo;
    $id = uuid4();
    $severity = severity_for($score);
    $pdo->prepare('INSERT INTO fraud_alerts (id, user_id, account_number, ref_number, amount, counterparty_acc,
            counterparty_name, score, severity, reasons) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        ->execute([$id, $user['id'], $account, (string)($txn['ref_number'] ?? ''), $amount, $payee,
            clip($txn['counterparty_name'] ?? '', 150), $score, $severity,
            json_encode($reasons, JSON_UNESCAPED_UNICODE)]);
    security_event('FRAUD_ALERT', $severity === 'high' ? 'warning' : 'info',
        "Score $score on " . rupees($amount) . " from $account", $user);
    return ['score' => $score, 'severity' => $severity, 'reasons' => $reasons, 'alert_id' => $id];
}

// Scoring must never be the reason a legitimate payment fails, so every caller
// goes through this: any error is logged and swallowed.
function score_transfer_safely(array $user, array $txn): ?array
{
    try {
        $result = score_transfer($user, $txn);
        return $result['alert_id'] === null ? null : $result;
    } catch (Throwable $e) {
        error_log('AJSPay fraud scoring failed: ' . $e);
        return null;
    }
}

function alert_public(array $alert): array
{
    $alert = out($alert);
    $alert['reasons'] = json_decode((string)$alert['reasons'], true) ?: [];
    $alert['score'] = (int)$alert['score'];
    return $alert;
}

function route_fraud_queue(array $d): void
{
    staff_user(AML_REVIEW_ROLES);
    $status = in_array($d['status'] ?? '', ['open', 'cleared', 'escalated'], true) ? $d['status'] : 'open';
    [$alerts, $meta] = paginate('SELECT f.*, u.name AS member_name, u.email AS member_email
        FROM fraud_alerts f LEFT JOIN users u ON u.id = f.user_id
        WHERE f.status = ? ORDER BY f.score DESC, f.created_at DESC', [$status], 25, 100);
    respond([
        'alerts' => array_map('alert_public', $alerts),
        'pagination' => $meta,
        'counts' => [
            'open' => (int)scalar("SELECT COUNT(*) FROM fraud_alerts WHERE status = 'open'"),
            'escalated' => (int)scalar("SELECT COUNT(*) FROM fraud_alerts WHERE status = 'escalated'"),
            'cleared' => (int)scalar("SELECT COUNT(*) FROM fraud_alerts WHERE status = 'cleared'"),
            'high_open' => (int)scalar("SELECT COUNT(*) FROM fraud_alerts WHERE status = 'open' AND severity = 'high'"),
        ],
        'ctr_threshold' => CTR_THRESHOLD,
    ]);
}

function route_fraud_action(array $d): void
{
    global $pdo;
    $staff = staff_user(AML_REVIEW_ROLES);
    need($d, 'alert_id', 'action');
    $status = ['clear' => 'cleared', 'escalate' => 'escalated', 'reopen' => 'open'][$d['action']] ?? null;
    if ($status === null) {
        fail(400, 'action must be clear, escalate or reopen.');
    }
    $alert = row('SELECT * FROM fraud_alerts WHERE id = ?', [clip($d['alert_id'], 36)]);
    if (!$alert) {
        fail(404, 'Alert not found.');
    }
    $pdo->prepare('UPDATE fraud_alerts SET status = ?, reviewed_by = ?, review_note = ?, reviewed_at = ?
        WHERE id = ?')->execute([$status, $staff['id'], clip($d['note'] ?? '', 255) ?: null, now_utc(), $alert['id']]);
    audit($staff, 'FRAUD_ALERT_' . strtoupper($status), "{$alert['id']} " . rupees((float)$alert['amount']));
    // An escalation is the internal step before deciding on an STR filing.
    respond(['status' => 'SUCCESS', 'message' => $status === 'escalated'
        ? 'Alert escalated for suspicious-transaction review.'
        : ($status === 'cleared' ? 'Alert cleared.' : 'Alert reopened.')]);
}

// --- 2. Assistant --------------------------------------------------------------------
// Answers from the signed-in member's own records. Unauthenticated visitors get
// general information only — every data lookup below is scoped to $user['id'],
// so there is no path by which one member's details can reach another.
function maybe_user(): ?array
{
    $token = is_string($_COOKIE['access_token'] ?? null) ? $_COOKIE['access_token'] : '';
    if ($token === '') {
        $header = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
        $token = str_starts_with($header, 'Bearer ') ? substr($header, 7) : '';
    }
    if ($token === '') {
        return null;
    }
    [$payload, $signature] = array_pad(explode('.', $token, 2), 2, '');
    if (!hash_equals(sign($payload), $signature)) {
        return null;
    }
    $claims = json_decode(b64url_decode($payload), true);
    if (!is_array($claims) || ($claims['exp'] ?? 0) < time()) {
        return null;
    }
    $user = row('SELECT * FROM users WHERE id = ?', [(string)($claims['sub'] ?? '')]);
    if (!$user || (int)$user['session_version'] !== (int)($claims['ver'] ?? -1)) {
        return null;
    }
    return $user;
}

// Intent is chosen by which keyword group scores highest, so word order and
// extra words in the question don't matter.
const ASSISTANT_INTENTS = [
    'balance' => ['balance', 'how much', 'available', 'funds', 'paisa', 'kitna'],
    'transactions' => ['transaction', 'statement', 'history', 'last payment', 'recent', 'spent', 'debited', 'credited'],
    'spend' => ['spend', 'spending', 'expense', 'outgoing', 'this month'],
    // Not Nidhi business: a Nidhi issues no cards and runs no UPI, cheques or investments.
    'not_offered' => ['card', 'atm', 'hotlist', 'upi', 'vpa', 'qr', 'scan', 'cheque', 'check book', 'chequebook',
        'demand draft', 'mutual fund', 'sip', 'insurance'],
    'deposits' => ['deposit', 'fd', 'fixed deposit', 'rd', 'recurring', 'maturity', 'matures'],
    'loans' => ['loan', 'emi', 'borrow', 'instalment', 'installment'],
    'standing' => ['standing instruction', 'auto pay', 'autopay', 'recurring payment', 'si '],
    'transfer_help' => ['transfer', 'send money', 'neft', 'imps', 'rtgs', 'limit'],
    'kyc' => ['kyc', 'aadhaar', 'pan', 'verify', 'document'],
    'ifsc' => ['ifsc', 'branch code', 'branch', 'address'],
    'rates' => ['rate', 'interest', 'scheme', 'yojana'],
    'security' => ['passkey', 'password', 'otp', 'secure', 'fraud', 'phishing'],
];

function detect_intent(string $message): string
{
    $best = ['help', 0];
    foreach (ASSISTANT_INTENTS as $intent => $words) {
        $hits = 0;
        foreach ($words as $word) {
            if (str_contains($message, $word)) {
                // Longer phrases are more specific, so they count for more.
                $hits += 1 + (int)(substr_count($word, ' ') > 0);
            }
        }
        if ($hits > $best[1]) {
            $best = [$intent, $hits];
        }
    }
    return $best[0];
}

function assistant_answer(string $message, ?array $user): array
{
    $intent = detect_intent($message);
    $signedIn = $user !== null;
    $suggestions = [];

    // Answers that need the member's own data. Each query is filtered by the
    // authenticated user id; nothing accepts an account number from the message.
    if ($signedIn) {
        switch ($intent) {
            case 'balance':
                $accounts = rows('SELECT account_number, account_type, balance, status FROM accounts
                    WHERE user_id = ? ORDER BY account_type', [$user['id']]);
                if ($accounts === []) {
                    break;
                }
                $lines = array_map(fn($a) => sprintf('- %s (%s): **%s**%s', $a['account_type'],
                    'xxxx' . substr($a['account_number'], -4), rupees((float)$a['balance']),
                    $a['status'] !== 'active' ? " — {$a['status']}" : ''), $accounts);
                $total = array_sum(array_map(fn($a) => (float)$a['balance'], $accounts));
                return ['reply' => "Your balances right now:\n" . implode("\n", $lines)
                    . (count($accounts) > 1 ? "\n\nTotal: **" . rupees($total) . '**' : ''),
                    'intent' => $intent, 'suggestions' => ['Show my last 5 transactions', 'How much did I spend this month?']];

            case 'transactions':
                $txns = rows("SELECT type, amount, counterparty_name, description, timestamp, mode
                    FROM transactions WHERE user_id = ? ORDER BY timestamp DESC, seq DESC LIMIT 5", [$user['id']]);
                if ($txns === []) {
                    return ['reply' => 'I cannot see any transactions on your accounts yet.',
                        'intent' => $intent, 'suggestions' => ['What is my balance?']];
                }
                $lines = array_map(fn($t) => sprintf('- %s %s %s — %s (%s)',
                    (new DateTimeImmutable($t['timestamp']))->setTimezone(new DateTimeZone(IST))->format('d M, H:i'),
                    $t['type'] === 'debit' ? 'paid' : 'received', rupees((float)$t['amount']),
                    $t['counterparty_name'] ?: $t['description'], $t['mode']), $txns);
                return ['reply' => "Your 5 most recent transactions:\n" . implode("\n", $lines)
                    . "\n\nFor a full statement with PDF or Excel, open **Statements**.",
                    'intent' => $intent, 'suggestions' => ['How much did I spend this month?', 'Download my statement']];

            case 'spend':
                $spent = (float)scalar("SELECT COALESCE(SUM(amount), 0) FROM transactions
                    WHERE user_id = ? AND type = 'debit'
                      AND timestamp >= DATE_FORMAT(?, '%Y-%m-01')", [$user['id'], now_utc()]);
                $count = (int)scalar("SELECT COUNT(*) FROM transactions WHERE user_id = ? AND type = 'debit'
                    AND timestamp >= DATE_FORMAT(?, '%Y-%m-01')", [$user['id'], now_utc()]);
                $top = rows("SELECT counterparty_name, SUM(amount) AS total FROM transactions
                    WHERE user_id = ? AND type = 'debit' AND timestamp >= DATE_FORMAT(?, '%Y-%m-01')
                    GROUP BY counterparty_name ORDER BY total DESC LIMIT 3", [$user['id'], now_utc()]);
                $reply = "So far this month you have paid out **" . rupees($spent) . "** across $count payments.";
                if ($top !== []) {
                    $reply .= "\n\nLargest payees:\n" . implode("\n", array_map(
                        fn($t) => '- ' . ($t['counterparty_name'] ?: 'Unnamed') . ' — ' . rupees((float)$t['total']), $top));
                }
                return ['reply' => $reply, 'intent' => $intent,
                    'suggestions' => ['Show my last 5 transactions', 'What is my balance?']];

            case 'deposits':
                $deposits = rows('SELECT principal_amount, interest_rate, maturity_amount, maturity_date, status
                    FROM deposits WHERE user_id = ? ORDER BY maturity_date', [$user['id']]);
                if ($deposits === []) {
                    break;
                }
                $lines = array_map(fn($dep) => sprintf('- %s at %.2f%% — matures %s for **%s**',
                    rupees((float)$dep['principal_amount']), (float)$dep['interest_rate'],
                    $dep['maturity_date'], rupees((float)$dep['maturity_amount'])), $deposits);
                return ['reply' => "Your deposits:\n" . implode("\n", $lines),
                    'intent' => $intent, 'suggestions' => ['What are the current deposit rates?']];

            case 'loans':
                $loans = rows('SELECT loan_type, amount, tenure_months, roi, calculated_emi, status
                    FROM loan_applications WHERE user_id = ? ORDER BY created_at DESC LIMIT 5', [$user['id']]);
                if ($loans === []) {
                    break;
                }
                $lines = array_map(fn($l) => sprintf('- %s for %s over %d months at %.2f%% — EMI %s, status **%s**',
                    $l['loan_type'], rupees((float)$l['amount']), (int)$l['tenure_months'], (float)$l['roi'],
                    rupees((float)$l['calculated_emi']), $l['status']), $loans);
                return ['reply' => "Your loan applications:\n" . implode("\n", $lines),
                    'intent' => $intent, 'suggestions' => ['What loans do you offer?']];

            case 'standing':
                $sis = rows('SELECT beneficiary_name, amount, frequency, next_run, status, last_status, last_error
                    FROM standing_instructions WHERE user_id = ? ORDER BY next_run LIMIT 10', [$user['id']]);
                if ($sis === []) {
                    break;
                }
                $lines = array_map(function ($si) {
                    $line = sprintf('- %s %s %s — next %s (**%s**)', rupees((float)$si['amount']), $si['frequency'],
                        'to ' . $si['beneficiary_name'], $si['next_run'] ?: 'not scheduled', $si['status']);
                    if ($si['last_status'] === 'failed' && $si['last_error']) {
                        $line .= "\n  Last attempt failed: {$si['last_error']}";
                    }
                    return $line;
                }, $sis);
                return ['reply' => "Your standing instructions:\n" . implode("\n", $lines),
                    'intent' => $intent, 'suggestions' => ['What is my balance?']];

            case 'kyc':
                $status = $user['kyc_status'] ?? 'pending';
                $reply = "Your KYC status is **$status**.";
                if ($status !== 'verified') {
                    $reply .= ' ' . ($user['kyc_reason'] ? "Reason on file: {$user['kyc_reason']}. " : '')
                        . 'You can complete it under **Video KYC** — you will need your PAN and an official '
                        . 'valid document such as Aadhaar, passport or voter ID.';
                }
                return ['reply' => $reply, 'intent' => $intent, 'suggestions' => ['Start video KYC']];
        }
    }

    // General answers, safe for anyone to see.
    $general = [
        'balance' => 'Sign in and I can read out your live balances. From the dashboard you can also see every '
            . 'account at a glance.',
        'transactions' => 'Sign in and I can list your recent transactions. Full statements are available as PDF '
            . 'or Excel under **Statements**.',
        'spend' => 'Sign in and I can total up what you have paid out this month.',
        'not_offered' => 'Aadhunik Jeewan Sanchay Nidhi Limited is a Nidhi company, not a bank, so it does not offer '
            . 'cards, UPI, cheque books, demand drafts, mutual funds or insurance. You can pay another member under '
            . '**Pay a Member**, and keep savings, fixed and recurring deposits with us.',
        'deposits' => "Current deposit rates:\n- 7 to 365 days: **6.50% p.a.**\n- 1 to 2 years: **7.25% p.a.**\n"
            . "- 2 to 3 years: **7.50% p.a.**\n- Above 3 years: **7.10% p.a.**\n\nDeposits are accepted from "
            . 'members only, and the Nidhi Rules cap deposit interest at 12.5% a year.',
        'loans' => 'We lend to members against gold jewellery (from **' . number_format(loan_rate('gold'), 2)
            . '%**) or property (home loans from **' . number_format(loan_rate('home'), 2) . '%**). Apply under '
            . '**Loans** and the loan desk reviews it. Unsecured personal and vehicle loans are not offered.',
        'standing' => 'Standing instructions automate rent, loan EMIs and regular payments to other members. Set one '
            . 'up under **Standing Instructions** and it runs on your chosen day until you pause it.',
        'transfer_help' => 'Transfers go between member accounts and settle at once on our own books. You can send '
            . 'up to your available balance, and every transfer needs your transaction password. Payments to other '
            . 'banks (IMPS, NEFT, RTGS) are not offered.',
        'kyc' => 'KYC needs a valid PAN plus one official valid document — Aadhaar, passport or voter ID. You can '
            . 'complete it by video under **Video KYC**, without visiting a branch.',
        'ifsc' => 'A Nidhi is not part of the bank clearing system, so there are no IFSC codes. Use **Branches** to '
            . 'find a branch\'s address, phone and timings.',
        'rates' => "Deposit rates run from **6.50%** to **7.50% p.a.** depending on term; loans start at "
            . '**8.40%**. The Nidhi Rules, 2014 cap deposit interest at 12.5% a year, so treat any promise above '
            . 'that as a warning sign.',
        'security' => 'Keep your account safe: set a passkey or biometric sign-in under **Security & Passkeys**, '
            . 'never share an OTP or your transaction password, and remember we will never ask for them by phone '
            . 'or message. Report anything suspicious on **9105015464**, or call the cyber-fraud line **1930**.',
    ];

    if (isset($general[$intent])) {
        $suggestions = $signedIn
            ? ['What is my balance?', 'Show my last 5 transactions']
            : ['What are your deposit rates?', 'What are the transfer limits?'];
        return ['reply' => $general[$intent], 'intent' => $intent, 'suggestions' => $suggestions];
    }

    $name = $signedIn ? ' ' . explode(' ', (string)$user['name'])[0] : '';
    return [
        'reply' => "Hello$name — I am the AJSPay assistant." . ($signedIn
            ? ' I can look up your balances, recent transactions, spending, deposits, loans and standing '
            . 'instructions, and answer questions about rates, limits, KYC and branches.'
            : ' I can answer questions about deposit rates, transfer limits, loans, KYC and branches. '
            . 'Sign in and I can also read your own balances and transactions.'),
        'intent' => 'help',
        'suggestions' => $signedIn
            ? ['What is my balance?', 'How much did I spend this month?', 'Show my deposits']
            : ['What are your deposit rates?', 'What are the transfer limits?', 'What do I need for KYC?'],
    ];
}

function route_chat(array $d): void
{
    need($d, 'message');
    // Only ever matched against keywords — never interpolated into SQL, and
    // never echoed back into the reply.
    $message = strtolower(clip($d['message'], 500));
    $answer = assistant_answer($message, maybe_user());
    respond(['response' => $answer['reply'], 'intent' => $answer['intent'],
        'suggestions' => $answer['suggestions'], 'timestamp' => iso(now_utc())]);
}

// The staff help bot: answers "where do I edit a plan?" and the like for new staff,
// from the guides of the pages their role can open (frontend/src/data/help.js,
// sent by the browser as `guides`). Read-only: it has no tools and sees no member
// data, so the worst a bad answer can do is point at the wrong page.
const STAFF_ASSISTANT_PROMPT = <<<'TXT'
You are the in-app help assistant for staff of Aadhunik Jeewan Sanchay Nidhi Limited (AJSPay), a Nidhi company under the Companies Act 2013 and the Nidhi Rules 2014. It is not a bank.
Answer questions about how to use this staff panel: which menu page does what, where to edit or create something, which button to press and what to type.
Rules:
- Use only the PAGE GUIDES below. Name the menu item exactly as written there and give numbered steps.
- If the guides do not cover it, say so plainly and suggest asking the Director. Never invent pages, buttons or features.
- If the page needed is not in the guides, this role cannot open it: say a Director or Branch Manager must do it.
- The Nidhi Rules apply: deposits at most 12.5% a year, members only, loans only against gold or property, and no commission or brokerage for bringing members or deposits. Explain this when a question touches it.
- You cannot see accounts, members or balances, and you take no actions.
- Be short. Reply in the language the question was asked in (Hindi or English).
TXT;

function route_staff_assistant(array $d): void
{
    global $config;
    $staff = staff_user(CRM_ROLES);
    need($d, 'message');
    $message = clip($d['message'], 1000);
    $guides = clip($d['guides'] ?? '', 60000);
    $key = $config['anthropic_api_key'] ?? '';
    if ($key === '') {
        fail(503, 'The assistant is not set up yet.');
    }
    rate_limit("rl:assistant:{$staff['id']}", 30, 3600, 'You have asked a lot in the last hour. Try again later, or open the Guide on the page.');
    // Earlier turns, so "and where is that?" makes sense. Text only, last few.
    $history = [];
    foreach (array_slice(is_array($d['history'] ?? null) ? $d['history'] : [], -8) as $turn) {
        $role = ($turn['role'] ?? '') === 'assistant' ? 'assistant' : 'user';
        $text = clip($turn['text'] ?? '', 2000);
        if ($text !== '' && (end($history)['role'] ?? 'assistant') !== $role) {
            $history[] = ['role' => $role, 'content' => $text];
        }
    }
    if (($history[0]['role'] ?? 'user') !== 'user') {
        array_shift($history);
    }
    if ((end($history)['role'] ?? '') === 'user') {
        array_pop($history);
    }
    $history[] = ['role' => 'user', 'content' => $message];

    $ch = curl_init('https://api.anthropic.com/v1/messages');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30, CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => ['content-type: application/json', 'anthropic-version: 2023-06-01', "x-api-key: $key"],
        CURLOPT_POSTFIELDS => json_encode([
            'model' => $config['anthropic_model'] ?? 'claude-sonnet-5-5',
            'max_tokens' => 800,
            // The guides repeat on every question, so cache them.
            'system' => [['type' => 'text', 'text' => STAFF_ASSISTANT_PROMPT
                . "\n\nThe person asking is signed in as: {$staff['role']}.\n\nPAGE GUIDES:\n$guides",
                'cache_control' => ['type' => 'ephemeral']]],
            'messages' => $history,
        ]),
    ]);
    $body = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $reply = $status === 200 ? (json_decode((string)$body, true)['content'][0]['text'] ?? '') : '';
    if ($reply === '') {
        error_log("AJSPay assistant: HTTP $status " . mb_substr((string)$body, 0, 300));
        fail(502, 'The assistant could not answer just now.');
    }
    respond(['response' => $reply]);
}

// --- 3. Loan credit scoring ----------------------------------------------------------
// Grades affordability and account behaviour into a 0-100 score with reasons.
// It is a decision aid for the loan desk, not an automatic approval: nothing
// here approves or rejects on its own.
function score_loan(array $app): array
{
    $score = 50;  // neutral starting point
    $reasons = [];
    $add = function (string $label, int $delta) use (&$reasons, &$score): void {
        $reasons[] = ['label' => $label, 'delta' => $delta];
        $score += $delta;
    };

    $income = (float)($app['monthly_income'] ?? 0);
    $emi = (float)($app['calculated_emi'] ?? 0);
    $amount = (float)$app['amount'];
    $userId = $app['user_id'] ?? null;

    // Fixed obligation to income ratio: the single strongest signal of whether
    // a borrower can actually carry the instalment.
    $existingEmi = $userId ? (float)scalar("SELECT COALESCE(SUM(calculated_emi), 0) FROM loan_applications
        WHERE user_id = ? AND status IN ('approved', 'disbursed') AND id <> ?", [$userId, $app['id']]) : 0.0;
    if ($income > 0) {
        $foir = ($emi + $existingEmi) / $income;
        if ($foir <= 0.35) {
            $add(sprintf('Instalments would take %.0f%% of monthly income — comfortable', $foir * 100), 25);
        } elseif ($foir <= 0.5) {
            $add(sprintf('Instalments would take %.0f%% of monthly income — manageable', $foir * 100), 10);
        } elseif ($foir <= 0.65) {
            $add(sprintf('Instalments would take %.0f%% of monthly income — stretched', $foir * 100), -15);
        } else {
            $add(sprintf('Instalments would take %.0f%% of monthly income — unaffordable', $foir * 100), -35);
        }
        if ($existingEmi > 0) {
            $add('Already carrying ' . rupees($existingEmi) . ' of existing instalments', -5);
        }
        $multiple = $amount / max($income, 1);
        if ($multiple > 40) {
            $add(sprintf('Loan is %.0fx monthly income', $multiple), -15);
        }
    } else {
        $add('No income declared, so affordability cannot be assessed', -25);
    }

    if ($userId) {
        // Account behaviour: balances held, how long they have banked with us,
        // and whether their own recurring payments tend to bounce.
        $avgBalance = (float)scalar('SELECT COALESCE(AVG(balance), 0) FROM accounts WHERE user_id = ?', [$userId]);
        if ($avgBalance >= $emi * 3 && $emi > 0) {
            $add('Balances held comfortably exceed the instalment', 10);
        } elseif ($avgBalance < $emi && $emi > 0) {
            $add('Balances held are below one instalment', -10);
        }
        $vintageDays = (int)scalar('SELECT DATEDIFF(?, MIN(created_at)) FROM accounts WHERE user_id = ?',
            [now_utc(), $userId]);
        if ($vintageDays >= 365) {
            $add('Member for over a year', 10);
        } elseif ($vintageDays < 90) {
            $add('Member for under three months', -10);
        }
        $failedSi = (int)scalar("SELECT COUNT(*) FROM standing_instructions WHERE user_id = ?
            AND last_status = 'failed'", [$userId]);
        if ($failedSi > 0) {
            $add("$failedSi standing instruction(s) failed for want of funds", -15);
        }
        $openAlerts = (int)scalar("SELECT COUNT(*) FROM fraud_alerts WHERE user_id = ?
            AND status IN ('open', 'escalated')", [$userId]);
        if ($openAlerts > 0) {
            $add("$openAlerts unresolved fraud alert(s) on this member", -20);
        }
        $inflow = (float)scalar("SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE user_id = ?
            AND type = 'credit' AND timestamp >= DATE_SUB(?, INTERVAL 90 DAY)", [$userId, now_utc()]);
        if ($income > 0 && $inflow >= $income * 2) {
            $add('Credits into the account support the declared income', 10);
        } elseif ($income > 0 && $inflow < $income * 0.5) {
            $add('Credits into the account do not support the declared income', -15);
        }
        $kyc = scalar('SELECT kyc_status FROM users WHERE id = ?', [$userId]);
        if ($kyc !== 'verified') {
            $add('KYC is not verified', -20);
        }
    }

    $employment = strtolower((string)($app['employment_type'] ?? ''));
    if (str_contains($employment, 'salaried') || str_contains($employment, 'government')) {
        $add('Salaried employment', 8);
    } elseif (str_contains($employment, 'self') || str_contains($employment, 'business')) {
        $add('Self-employed income, which varies more', -5);
    }

    $score = max(0, min(100, $score));
    [$grade, $recommendation] = match (true) {
        $score >= 80 => ['A', 'Approve'],
        $score >= 65 => ['B', 'Approve with standard conditions'],
        $score >= 50 => ['C', 'Refer — ask for more documents'],
        $score >= 35 => ['D', 'Refer — high risk, senior sign-off'],
        default => ['E', 'Decline on affordability'],
    };
    return ['score' => $score, 'grade' => $grade, 'recommendation' => $recommendation, 'reasons' => $reasons];
}

function store_loan_score(array $app): array
{
    global $pdo;
    $result = score_loan($app);
    $pdo->prepare('UPDATE loan_applications SET risk_score = ?, risk_grade = ?, risk_reasons = ?, scored_at = ?
        WHERE id = ?')->execute([$result['score'], $result['grade'],
            json_encode($result, JSON_UNESCAPED_UNICODE), now_utc(), $app['id']]);
    return $result;
}

function store_loan_score_safely(array $app): void
{
    try {
        store_loan_score($app);
    } catch (Throwable $e) {
        error_log('AJSPay loan scoring failed: ' . $e);
    }
}

// Re-grades every application on the desk, for when scoring rules change or an
// older application was never scored.
function route_loan_rescore(array $d): void
{
    $staff = staff_user(['loan_officer', ...ADMIN_ROLES]);
    $apps = rows("SELECT * FROM loan_applications WHERE status NOT IN ('rejected', 'disbursed') LIMIT 500");
    $done = 0;
    foreach ($apps as $app) {
        store_loan_score_safely($app);
        $done++;
    }
    audit($staff, 'LOAN_RESCORE', "$done applications re-graded");
    respond(['status' => 'SUCCESS', 'message' => "Re-graded $done applications.", 'count' => $done]);
}

// --- 4. Collection and deposit anomaly checks ----------------------------------------
// Looks over recorded agent collections for the patterns that usually mean an
// error or a leak: the same receipt twice, money collected against an account
// that cannot take it, or an agent whose day is wildly out of line with their own.
function route_collection_anomalies(array $d): void
{
    staff_user(AML_REVIEW_ROLES);
    $findings = [];
    $note = function (string $severity, string $type, string $detail) use (&$findings): void {
        $findings[] = ['severity' => $severity, 'type' => $type, 'detail' => $detail];
    };

    foreach (rows('SELECT receipt_no, COUNT(*) AS n FROM agent_collections
        WHERE receipt_no IS NOT NULL GROUP BY receipt_no HAVING n > 1 LIMIT 50') as $dup) {
        $note('high', 'Duplicate receipt', "Receipt {$dup['receipt_no']} used on {$dup['n']} collections");
    }

    foreach (rows("SELECT c.receipt_no, c.amount, c.account_number, a.status
        FROM agent_collections c JOIN accounts a ON a.account_number = c.account_number
        WHERE a.status <> 'active' LIMIT 50") as $bad) {
        $note('high', 'Inactive account', rupees((float)$bad['amount']) . " collected against "
            . "{$bad['account_number']}, which is {$bad['status']}");
    }

    foreach (rows('SELECT c.receipt_no, c.amount, ag.code, ag.name FROM agent_collections c
        JOIN agents ag ON ag.id = c.agent_id WHERE ag.status <> \'active\' LIMIT 50') as $bad) {
        $note('medium', 'Inactive agent', "Collection of " . rupees((float)$bad['amount'])
            . " recorded for {$bad['code']} ({$bad['name']}), who is inactive");
    }

    foreach (rows('SELECT receipt_no, amount, account_number, collected_on FROM agent_collections
        WHERE collected_on > CURDATE() OR collected_on < DATE_SUB(CURDATE(), INTERVAL 365 DAY) LIMIT 50') as $bad) {
        $note('medium', 'Implausible date', "Collection dated {$bad['collected_on']} for {$bad['account_number']}");
    }

    foreach (rows('SELECT account_number, collected_on, COUNT(*) AS n, SUM(amount) AS total
        FROM agent_collections GROUP BY account_number, collected_on HAVING n > 3 LIMIT 50') as $many) {
        $note('low', 'Repeated same-day collection', "{$many['n']} collections totalling "
            . rupees((float)$many['total']) . " against {$many['account_number']} on {$many['collected_on']}");
    }

    // An agent's daily totals compared against their own usual day.
    foreach (rows('SELECT a.id, a.code, a.name FROM agents a WHERE a.deleted_at IS NULL') as $agent) {
        $daily = array_map('floatval', array_column(rows('SELECT SUM(amount) AS total FROM agent_collections
            WHERE agent_id = ? GROUP BY collected_on ORDER BY collected_on DESC LIMIT 90', [$agent['id']]), 'total'));
        if (count($daily) < 5) {
            continue;
        }
        $typical = median($daily);
        foreach ($daily as $total) {
            if ($typical > 0 && $total > $typical * 6) {
                $note('medium', 'Unusual collection day', "{$agent['code']} ({$agent['name']}) collected "
                    . rupees($total) . ' on one day against a usual ' . rupees($typical));
                break;
            }
        }
    }

    $order = ['high' => 0, 'medium' => 1, 'low' => 2];
    usort($findings, fn($a, $b) => $order[$a['severity']] <=> $order[$b['severity']]);
    respond([
        'findings' => $findings,
        'counts' => array_merge(['high' => 0, 'medium' => 0, 'low' => 0],
            array_count_values(array_column($findings, 'severity'))),
        'checked' => [
            'collections' => (int)scalar('SELECT COUNT(*) FROM agent_collections'),
            'agents' => (int)scalar('SELECT COUNT(*) FROM agents WHERE deleted_at IS NULL'),
        ],
    ]);
}
