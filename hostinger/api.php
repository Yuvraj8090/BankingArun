<?php
// AJSPay: Hostinger PHP/MySQL REST API.
// Serves the same /api/* routes and JSON shapes as the FastAPI backend, so the
// React app runs against it unchanged. Ported so far: auth, accounts and
// transfers, cards, UPI. Routes that are not ported yet answer 404.
declare(strict_types=1);

require __DIR__ . '/db.php';

const MAX_FAILS = 5;  // wrong passwords allowed per 15 minutes before lockout
const TRANSFER_MODES = ['IMPS', 'NEFT', 'RTGS', 'UPI'];
const CARD_LIMIT_MAX = 1000000.0;
const IST = 'Asia/Kolkata';
// Checked when an email is unknown, so response times don't reveal which emails exist.
const DUMMY_HASH = '$2y$12$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const VIRTUAL_DEBIT_CARD = ['bin' => '4532', 'type' => 'Visa Platinum Debit', 'network' => 'Visa',
    'status' => 'active', 'virtual' => true, 'online_limit' => 50000, 'atm_limit' => 40000, 'international' => false];
const PHYSICAL_DEBIT_CARD = ['bin' => '5241', 'type' => 'RuPay / Mastercard Global Debit', 'network' => 'RuPay',
    'status' => 'dispatch_queued', 'virtual' => false, 'online_limit' => 75000, 'atm_limit' => 50000,
    'international' => true];

// --- Sessions --------------------------------------------------------------------
// Stateless HMAC-SHA256 tokens, verified on every request. The `ver` claim must
// match users.session_version, so logging out revokes every token issued before.
function b64url(string $raw): string
{
    return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
}

function sign(string $payload): string
{
    global $config;
    return b64url(hash_hmac('sha256', $payload, $config['token_secret'], true));
}

function session_cookie(string $value, int $expires): void
{
    global $config;
    setcookie('access_token', $value, [
        'expires' => $expires,
        'path' => '/',
        'httponly' => true,
        'secure' => $config['cookie_secure'],
        'samesite' => 'Lax',
    ]);
}

function start_session(array $user): string
{
    global $config;
    $expires = time() + $config['token_ttl'];
    $payload = b64url(json_encode([
        'sub' => $user['id'],
        'role' => $user['role'],
        'ver' => (int)$user['session_version'],
        'exp' => $expires,
    ]));
    $token = $payload . '.' . sign($payload);
    session_cookie($token, $expires);
    return $token;
}

function current_user(): array
{
    $token = is_string($_COOKIE['access_token'] ?? null) ? $_COOKIE['access_token'] : '';
    if ($token === '') {
        $header = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
        $token = str_starts_with($header, 'Bearer ') ? substr($header, 7) : '';
    }
    if ($token === '') {
        fail(401, 'Authentication token required. Please login.');
    }
    [$payload, $signature] = array_pad(explode('.', $token, 2), 2, '');
    if (!hash_equals(sign($payload), $signature)) {
        fail(401, 'Invalid session token.');
    }
    $claims = json_decode((string)base64_decode(strtr($payload, '-_', '+/')), true);
    if (!is_array($claims) || ($claims['exp'] ?? 0) < time()) {
        fail(401, 'Session expired. Please log in again.');
    }
    $user = row('SELECT * FROM users WHERE id = ?', [(string)($claims['sub'] ?? '')]);
    if (!$user || (int)$user['session_version'] !== (int)($claims['ver'] ?? -1)) {
        fail(401, 'Invalid session token.');
    }
    return $user;
}

function public_user(array $user): array
{
    $user['nominee'] = $user['nominee_name'] === null ? null
        : ['name' => $user['nominee_name'], 'relation' => $user['nominee_relation']];
    unset($user['password_hash'], $user['transaction_password_hash'], $user['session_version'],
        $user['nominee_name'], $user['nominee_relation']);
    return out($user);
}

function public_card(array $card): array
{
    unset($card['pin_hash']);
    return out($card);
}

// --- Brute-force protection ------------------------------------------------------
function recent_fails(string $identifier): int
{
    return count(rows('SELECT id FROM login_attempts WHERE identifier = ? AND created_at >= UTC_TIMESTAMP() - INTERVAL 15 MINUTE',
        [$identifier]));
}

function record_fail(string $identifier, string $email): void
{
    global $pdo;
    $pdo->prepare('INSERT INTO login_attempts (identifier, email, ip) VALUES (?, ?, ?)')
        ->execute([$identifier, $email, client_ip()]);
}

function clear_fails(string $identifier): void
{
    global $pdo;
    $pdo->prepare('DELETE FROM login_attempts WHERE identifier = ?')->execute([$identifier]);
}

// Transaction passwords authorise money movement, so they get their own lockout.
// Call before beginTransaction(): a rollback would otherwise erase the recorded failure.
function check_txn_password(array $user, mixed $password, string $wrongMessage): void
{
    $identifier = 'txn:' . $user['id'];
    if (recent_fails($identifier) >= MAX_FAILS) {
        fail(429, 'Transaction password locked after 5 wrong attempts. Please try again in 15 minutes.');
    }
    if (!is_string($password) || !password_verify($password, $user['transaction_password_hash'])) {
        record_fail($identifier, $user['email']);
        fail(400, $wrongMessage);
    }
    clear_fails($identifier);
}

// --- Shared writes -----------------------------------------------------------------
function audit(array $user, string $action, string $details): void
{
    global $pdo;
    $pdo->prepare('INSERT INTO audit_logs (id, user_id, email, action, details, ip) VALUES (?, ?, ?, ?, ?, ?)')
        ->execute([uuid4(), $user['id'], $user['email'], $action, mb_substr($details, 0, 255), client_ip()]);
}

function insert_txn(array $t): void
{
    global $pdo;
    $pdo->prepare('INSERT INTO transactions (id, user_id, account_number, type, mode, amount, balance_after,
            counterparty_name, counterparty_acc, ref_number, batch_ref, description, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        ->execute([uuid4(), $t['user_id'], $t['account_number'], $t['type'], $t['mode'], $t['amount'],
            $t['balance_after'], $t['counterparty_name'], $t['counterparty_acc'], $t['ref_number'],
            $t['batch_ref'] ?? null, $t['description'], $t['timestamp'] ?? now_utc()]);
}

// New cards get a random PIN nobody knows: the cardholder sets their own via "Set PIN".
function insert_card(string $userId, string $accountNumber, string $holder, array $spec): string
{
    global $pdo;
    $id = uuid4();
    $pdo->prepare('INSERT INTO cards (id, user_id, account_number, card_number, card_holder, card_type, network,
            expiry_date, cvv, pin_hash, status, is_virtual, issued_by, online_limit, atm_limit, international_enabled)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        ->execute([
            $id, $userId, $accountNumber, $spec['bin'] . ' ' . digits(4) . ' ' . digits(4) . ' ' . digits(4),
            mb_strtoupper($holder), $spec['type'], $spec['network'], gmdate('m/y', strtotime('+5 years')),
            (string)random_int(100, 999), password_hash(digits(4), PASSWORD_BCRYPT), $spec['status'],
            (int)$spec['virtual'], 'AJSPay (Issuer Only)', $spec['online_limit'], $spec['atm_limit'],
            (int)$spec['international'],
        ]);
    return $id;
}

function owned_account(array $user, mixed $accountNumber, bool $forUpdate = false): ?array
{
    return row('SELECT * FROM accounts WHERE account_number = ? AND user_id = ?' . ($forUpdate ? ' FOR UPDATE' : ''),
        [clip($accountNumber, 30), $user['id']]);
}

// --- Auth ----------------------------------------------------------------------------
function route_register(array $d): void
{
    global $pdo;
    need($d, 'name', 'email', 'phone', 'password', 'transaction_password');
    $email = strtolower(clip($d['email'], 150));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        fail(422, 'A valid email address is required.');
    }
    // bcrypt silently ignores everything past 72 bytes, so cap it rather than pretend.
    if (!is_string($d['password']) || strlen($d['password']) < 8 || strlen($d['password']) > 72) {
        fail(422, 'Password must be 8 to 72 characters.');
    }
    if (!is_string($d['transaction_password']) || strlen($d['transaction_password']) < 4
        || strlen($d['transaction_password']) > 72) {
        fail(422, 'Transaction password must be 4 to 72 characters.');
    }
    if (row('SELECT id FROM users WHERE email = ?', [$email])) {
        fail(400, 'Account with this email already exists.');
    }
    $pan = strtoupper(clip($d['pan_number'] ?? '', 10));
    if ($pan !== '' && !preg_match('/\A[A-Z]{5}[0-9]{4}[A-Z]\z/', $pan)) {
        fail(422, 'PAN must look like ABCDE1234F.');
    }
    // UIDAI allows full Aadhaar numbers only inside an encrypted Aadhaar Data Vault,
    // so keep just the last four digits.
    $aadhaar = preg_replace('/\D/', '', clip($d['aadhaar_number'] ?? '', 20));
    $accountType = clip($d['account_type'] ?? '', 20);
    if (!preg_match('/\A[a-z_]{3,20}\z/', $accountType)) {
        $accountType = 'savings';
    }
    // The opening deposit is self-declared in this demo, so keep it within sane bounds.
    $initial = min(max(money($d['initial_deposit'] ?? 10000), 1000.0), 1000000.0);
    $name = clip($d['name'], 150);
    $branch = clip($d['branch'] ?? 'AJSP-MUM-042 (Nariman Point Main)', 100);
    $isJoint = !empty($d['is_joint']);
    $nominee = clip($d['nominee_name'] ?? '', 150);
    $userId = uuid4();
    $accountNumber = 'AJSP0' . digits(9);

    $pdo->beginTransaction();
    $pdo->prepare('INSERT INTO users (id, name, email, phone, role, password_hash, transaction_password_hash,
            branch, pan_number, aadhaar_number, kyc_status, is_joint, joint_holder_name, nominee_name, nominee_relation)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        ->execute([
            $userId, $name, $email, clip($d['phone'], 30), 'retail',
            password_hash($d['password'], PASSWORD_BCRYPT), password_hash($d['transaction_password'], PASSWORD_BCRYPT),
            $branch, $pan === '' ? null : $pan, strlen($aadhaar) >= 4 ? 'XXXX-XXXX-' . substr($aadhaar, -4) : null,
            'pending_approval', (int)$isJoint, $isJoint ? clip($d['joint_holder_name'] ?? '', 150) : null,
            $nominee === '' ? null : $nominee, $nominee === '' ? null : clip($d['nominee_relation'] ?? '', 50),
        ]);
    $pdo->prepare('INSERT INTO accounts (id, user_id, account_number, account_type, account_name, balance, upi_id,
            branch, is_joint)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        ->execute([uuid4(), $userId, $accountNumber, $accountType, ucfirst($accountType) . ' Account', $initial,
            strstr($email, '@', true) . '@ajspay', $branch, (int)$isJoint]);
    insert_card($userId, $accountNumber, $name, VIRTUAL_DEBIT_CARD);
    insert_txn(['user_id' => $userId, 'account_number' => $accountNumber, 'type' => 'credit',
        'mode' => 'ACCOUNT_OPENING', 'amount' => $initial, 'balance_after' => $initial,
        'counterparty_name' => 'Account Opening Initial Fund', 'counterparty_acc' => 'BRANCH-CASH-DESK',
        'ref_number' => 'AOF-' . random_int(1000000, 9999999), 'description' => 'Initial account deposit']);
    $user = row('SELECT * FROM users WHERE id = ?', [$userId]);
    audit($user, 'USER_REGISTER', "Opened account $accountNumber");
    $pdo->commit();

    // Referral codes aren't ported yet, so no signup bonus is applied here.
    respond(['token' => start_session($user), 'user' => public_user($user),
        'account_number' => $accountNumber, 'referral_bonus' => null]);
}

function route_login(array $d): void
{
    $email = strtolower(clip($d['email'] ?? '', 150));
    $password = $d['password'] ?? null;
    if (!filter_var($email, FILTER_VALIDATE_EMAIL) || !is_string($password) || $password === '') {
        fail(422, 'A valid email and password are required.');
    }
    $identifier = client_ip() . ':' . $email;
    $fails = recent_fails($identifier);
    if ($fails >= MAX_FAILS) {
        fail(429, 'Account temporarily locked due to 5 consecutive failed login attempts. Please try again in 15 minutes.');
    }
    $user = row('SELECT * FROM users WHERE email = ?', [$email]);
    $valid = password_verify($password, $user['password_hash'] ?? DUMMY_HASH);
    if (!$user || !$valid) {
        record_fail($identifier, $email);
        $left = MAX_FAILS - 1 - $fails;
        fail(401, "Invalid email or password. $left attempt(s) remaining before security lockout.");
    }
    clear_fails($identifier);
    audit($user, 'USER_LOGIN', 'Logged in via ' . (clip($d['device_name'] ?? '', 100) ?: 'web'));
    respond(['token' => start_session($user), 'user' => public_user($user),
        'message' => 'Login successful', 'mfa_verified' => true]);
}

function route_me(array $d): void
{
    respond(['user' => public_user(current_user())]);
}

function route_logout(array $d): void
{
    global $pdo;
    $user = current_user();
    $pdo->prepare('UPDATE users SET session_version = session_version + 1 WHERE id = ?')->execute([$user['id']]);
    session_cookie('', 1);
    audit($user, 'USER_LOGOUT', 'Signed out; all sessions revoked');
    respond(['message' => 'Logged out successfully']);
}

function route_verify_txn_pin(array $d): void
{
    $user = current_user();
    check_txn_password($user, $d['transaction_password'] ?? null, 'Invalid Transaction Password/PIN.');
    respond(['status' => 'valid', 'message' => 'Transaction Password Verified']);
}

// --- Accounts & transfers ---------------------------------------------------------
function route_accounts(array $d): void
{
    $user = current_user();
    $accounts = out_all(rows('SELECT * FROM accounts WHERE user_id = ? ORDER BY created_at, id', [$user['id']]));
    $deposits = out_all(rows('SELECT * FROM deposits WHERE user_id = ? ORDER BY created_at, id', [$user['id']]));
    $cards = array_map('public_card', rows('SELECT * FROM cards WHERE user_id = ? ORDER BY created_at, id', [$user['id']]));
    $savings = array_sum(array_column($accounts, 'balance'));
    $deposited = array_sum(array_column($deposits, 'principal_amount'));
    respond(['accounts' => $accounts, 'deposits' => $deposits, 'cards' => $cards, 'net_worth' => $savings + $deposited,
        'total_savings_balance' => $savings, 'total_deposits_balance' => $deposited]);
}

function route_transactions(array $d): void
{
    $user = current_user();
    $limit = max(1, min((int)($_GET['limit'] ?? 50), 200));
    $sql = 'SELECT * FROM transactions WHERE user_id = ?';
    $params = [$user['id']];
    if (!empty($_GET['account_number'])) {
        $sql .= ' AND account_number = ?';
        $params[] = clip($_GET['account_number'], 30);
    }
    respond(['transactions' => out_all(rows("$sql ORDER BY timestamp DESC, id LIMIT $limit", $params))]);
}

function route_transfer(array $d): void
{
    global $pdo;
    $user = current_user();
    need($d, 'from_account_number', 'to_account_number', 'beneficiary_name', 'transaction_password');
    $amount = money($d['amount'] ?? null);
    if ($amount <= 0) {
        fail(400, 'Transfer amount must be greater than ₹0');
    }
    $mode = strtoupper(clip($d['transfer_type'] ?? 'IMPS', 10));
    if (!in_array($mode, TRANSFER_MODES, true)) {
        fail(422, 'transfer_type must be IMPS, NEFT, RTGS or UPI.');
    }
    $from = clip($d['from_account_number'], 30);
    $to = clip($d['to_account_number'], 50);
    if ($from === $to) {
        fail(400, 'Source and destination accounts cannot be the same.');
    }
    $scheduleDate = null;
    if (!empty($d['is_scheduled']) && !empty($d['schedule_date'])) {
        $scheduleDate = clip($d['schedule_date'], 10);
        $date = DateTimeImmutable::createFromFormat('!Y-m-d', $scheduleDate, new DateTimeZone(IST));
        if (!$date || $date->format('Y-m-d') !== $scheduleDate
            || $date < new DateTimeImmutable('today', new DateTimeZone(IST))) {
            fail(422, 'schedule_date must be a valid date (YYYY-MM-DD), today or later.');
        }
    }
    check_txn_password($user, $d['transaction_password'], 'Invalid Transaction Password. Transfer declined.');
    $beneficiary = clip($d['beneficiary_name'], 150);
    $remarks = clip($d['remarks'] ?? 'Fund transfer', 255);

    // Lock both rows in index order, so two opposite transfers can't deadlock.
    $pdo->beginTransaction();
    $locked = array_column(
        rows('SELECT * FROM accounts WHERE account_number IN (?, ?) ORDER BY account_number FOR UPDATE', [$from, $to]),
        null,
        'account_number'
    );
    $sender = $locked[$from] ?? null;
    if (!$sender || $sender['user_id'] !== $user['id']) {
        fail(404, 'Source bank account not found.');
    }
    if ($sender['status'] !== 'active') {
        fail(403, 'This account is not active for outgoing payments.');
    }
    if ((float)$sender['balance'] < $amount) {
        fail(400, 'Insufficient balance. Available: ' . rupees((float)$sender['balance']));
    }

    if ($scheduleDate !== null) {
        $id = uuid4();
        $pdo->prepare('INSERT INTO scheduled_payments (id, user_id, from_account_number, to_account_number,
                beneficiary_name, beneficiary_ifsc, transfer_type, amount, schedule_date, remarks)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            ->execute([$id, $user['id'], $from, $to, $beneficiary, clip($d['beneficiary_ifsc'] ?? 'AJSP0000042', 11),
                $mode, $amount, $scheduleDate, $remarks]);
        audit($user, 'TRANSFER_SCHEDULED', "$mode " . rupees($amount) . " from $from to $to on $scheduleDate");
        $pdo->commit();
        respond(['status' => 'SCHEDULED', 'message' => 'Transfer of ' . rupees($amount) . " scheduled for $scheduleDate",
            'schedule_id' => $id]);
    }

    // A payee outside AJSPay is an interbank transfer: it only debits here, as in FastAPI.
    $receiver = $locked[$to] ?? null;
    if ($receiver && $receiver['status'] !== 'active') {
        fail(400, 'The beneficiary account cannot receive funds right now.');
    }
    $now = now_utc();
    $ref = "UTR-$mode-" . gmdate('YmdHis') . '-' . random_int(100, 999);
    $newBalance = round((float)$sender['balance'] - $amount, 2);
    $pdo->prepare('UPDATE accounts SET balance = balance - ? WHERE id = ?')->execute([$amount, $sender['id']]);
    insert_txn(['user_id' => $user['id'], 'account_number' => $from, 'type' => 'debit', 'mode' => $mode,
        'amount' => $amount, 'balance_after' => $newBalance, 'counterparty_name' => $beneficiary,
        'counterparty_acc' => $to, 'ref_number' => $ref, 'description' => $remarks ?: "$mode to $beneficiary",
        'timestamp' => $now]);
    if ($receiver) {
        $pdo->prepare('UPDATE accounts SET balance = balance + ? WHERE id = ?')->execute([$amount, $receiver['id']]);
        insert_txn(['user_id' => $receiver['user_id'], 'account_number' => $to, 'type' => 'credit', 'mode' => $mode,
            'amount' => $amount, 'balance_after' => round((float)$receiver['balance'] + $amount, 2),
            'counterparty_name' => $user['name'], 'counterparty_acc' => $from, 'ref_number' => $ref,
            'description' => "Received from {$user['name']} (" . ($remarks ?: 'Fund transfer') . ')',
            'timestamp' => $now]);
    }
    audit($user, 'FUND_TRANSFER', "$mode " . rupees($amount) . " from $from to $to ($ref)");
    $pdo->commit();
    respond(['status' => 'SUCCESS', 'message' => 'Successfully transferred ' . rupees($amount) . " via $mode",
        'ref_number' => $ref, 'new_balance' => $newBalance, 'timestamp' => iso($now)]);
}

function route_bulk_transfer(array $d): void
{
    global $pdo;
    $user = current_user();
    if ($user['role'] !== 'corporate') {
        fail(403, 'Bulk payouts are available to corporate customers only.');
    }
    need($d, 'from_account_number', 'transaction_password');
    $items = $d['transfers'] ?? null;
    if (!is_array($items) || !array_is_list($items) || count($items) < 1 || count($items) > 500) {
        fail(422, 'transfers must be a list of 1 to 500 payouts.');
    }
    $payouts = [];
    foreach ($items as $item) {
        if (!is_array($item)) {
            fail(422, 'Each payout must be an object.');
        }
        need($item, 'beneficiary_name', 'account_number', 'ifsc', 'amount');
        $amount = money($item['amount']);
        // A negative line would otherwise credit the payer.
        if ($amount <= 0) {
            fail(400, 'Every payout amount must be greater than ₹0.');
        }
        $payouts[] = ['name' => clip($item['beneficiary_name'], 150), 'account' => clip($item['account_number'], 50),
            'amount' => $amount, 'remarks' => clip($item['remarks'] ?? 'Corporate payout', 150)];
    }
    $total = round(array_sum(array_column($payouts, 'amount')), 2);
    check_txn_password($user, $d['transaction_password'], 'Invalid Transaction Password.');

    $pdo->beginTransaction();
    $sender = owned_account($user, $d['from_account_number'], true);
    if (!$sender) {
        fail(404, 'Source corporate account not found.');
    }
    if ($sender['status'] !== 'active') {
        fail(403, 'This account is not active for outgoing payments.');
    }
    if ((float)$sender['balance'] < $total) {
        fail(400, 'Insufficient corporate balance. Total batch requires ' . rupees($total));
    }
    $newBalance = round((float)$sender['balance'] - $total, 2);
    $pdo->prepare('UPDATE accounts SET balance = balance - ? WHERE id = ?')->execute([$total, $sender['id']]);
    $batch = 'BATCH-CORP-' . gmdate('Ymd') . '-' . random_int(1000, 9999);
    $processed = [];
    foreach ($payouts as $p) {
        $ref = 'UTR-BULK-' . random_int(10000000, 99999999);
        insert_txn(['user_id' => $user['id'], 'account_number' => $sender['account_number'], 'type' => 'debit',
            'mode' => 'CORPORATE_BULK', 'amount' => $p['amount'], 'balance_after' => $newBalance,
            'counterparty_name' => $p['name'], 'counterparty_acc' => $p['account'], 'ref_number' => $ref,
            'batch_ref' => $batch, 'description' => "Bulk Payout: {$p['remarks']} ({$p['name']})"]);
        $processed[] = ['name' => $p['name'], 'amount' => $p['amount'], 'ref' => $ref];
    }
    audit($user, 'BULK_TRANSFER', count($payouts) . ' payouts totalling ' . rupees($total) . " ($batch)");
    $pdo->commit();
    respond(['status' => 'SUCCESS', 'batch_ref' => $batch, 'transfers_count' => count($processed),
        'total_amount' => $total, 'remaining_balance' => $newBalance, 'processed_list' => $processed]);
}

// --- Cards -----------------------------------------------------------------------------
function route_cards(array $d): void
{
    $user = current_user();
    respond(['cards' => array_map('public_card',
        rows('SELECT * FROM cards WHERE user_id = ? ORDER BY created_at, id', [$user['id']]))]);
}

function route_manage_card(array $d): void
{
    global $pdo;
    $user = current_user();
    need($d, 'card_id', 'action');
    $card = row('SELECT * FROM cards WHERE id = ? AND user_id = ?', [clip($d['card_id'], 36), $user['id']]);
    if (!$card) {
        fail(404, 'Debit card not found.');
    }
    // Hotlisting is permanent (FastAPI let a hotlisted card be unfrozen again).
    if ($card['status'] === 'hotlisted') {
        fail(400, 'This card is permanently hotlisted and can no longer be changed.');
    }
    $action = $d['action'];
    $updates = [];
    if ($action === 'freeze') {
        $updates['status'] = 'frozen';
        $message = 'Card temporarily frozen. ATM & Online transactions disabled.';
    } elseif ($action === 'unfreeze') {
        $updates['status'] = 'active';
        $message = 'Card unblocked and activated successfully.';
    } elseif ($action === 'hotlist') {
        $updates['status'] = 'hotlisted';
        $message = 'Card permanently hotlisted & blocked. A replacement card has been queued.';
    } elseif ($action === 'update_limits') {
        foreach (['online_limit', 'atm_limit'] as $key) {
            if (isset($d[$key])) {
                $updates[$key] = money($d[$key]);
                if ($updates[$key] < 0 || $updates[$key] > CARD_LIMIT_MAX) {
                    fail(422, "$key must be between ₹0 and ₹10,00,000.");
                }
            }
        }
        foreach (['international_enabled', 'contactless_enabled', 'ecom_enabled'] as $key) {
            if (isset($d[$key])) {
                $updates[$key] = (int)(bool)$d[$key];
            }
        }
        $message = 'Card limits and usage settings updated.';
    } elseif ($action === 'set_pin') {
        $pin = $d['new_pin'] ?? null;
        if (!is_string($pin) || !preg_match('/\A\d{4}\z/', $pin)) {
            fail(400, 'PIN must be a 4-digit number.');
        }
        $updates['pin_hash'] = password_hash($pin, PASSWORD_BCRYPT);
        $message = 'Card ATM/POS PIN regenerated successfully.';
    } else {
        fail(422, 'Unknown card action.');
    }
    if ($updates) {
        // Column names come from the fixed keys above; only the values are user input.
        $set = implode(', ', array_map(fn($column) => "$column = ?", array_keys($updates)));
        $pdo->prepare("UPDATE cards SET $set WHERE id = ?")->execute([...array_values($updates), $card['id']]);
    }
    audit($user, 'CARD_' . strtoupper($action), 'Card ending ' . substr($card['card_number'], -4));
    respond(['status' => 'SUCCESS', 'message' => $message,
        'card' => public_card(row('SELECT * FROM cards WHERE id = ?', [$card['id']]))]);
}

function route_request_physical_card(array $d): void
{
    $user = current_user();
    $account = owned_account($user, $_GET['account_number'] ?? '');
    if (!$account) {
        fail(404, 'Account not found.');
    }
    $id = insert_card($user['id'], $account['account_number'], $user['name'], PHYSICAL_DEBIT_CARD);
    audit($user, 'CARD_REQUEST_PHYSICAL', 'For account ' . $account['account_number']);
    respond(['status' => 'SUCCESS',
        'message' => 'Physical Card order placed! Will be delivered to registered address in 3-5 working days.',
        'card' => public_card(row('SELECT * FROM cards WHERE id = ?', [$id]))]);
}

// --- UPI on debit card -----------------------------------------------------------------
function route_upi_status(array $d): void
{
    $user = current_user();
    $account = row('SELECT upi_id FROM accounts WHERE user_id = ? ORDER BY created_at, id', [$user['id']]);
    $cards = [];
    foreach (rows('SELECT id, card_number, network, status, upi_linked FROM cards WHERE user_id = ? ORDER BY created_at, id',
        [$user['id']]) as $card) {
        $card['network'] ??= 'Visa';
        $cards[] = out($card);
    }
    respond([
        'launch_date' => '2026-02-15',
        'status_headline' => 'UPI on Debit Card — Pending Final NPCI Approval',
        'status_detail' => 'Feature is live in shadow mode. Final NPCI go-live approval expected within 24 hours. '
            . 'Link now to receive priority activation.',
        'primary_upi_id' => $account['upi_id'] ?? null,
        'linkable_cards' => $cards,
    ]);
}

function route_upi_link_card(array $d): void
{
    global $pdo;
    $user = current_user();
    need($d, 'card_id');
    $card = row('SELECT * FROM cards WHERE id = ? AND user_id = ?', [clip($d['card_id'], 36), $user['id']]);
    if (!$card) {
        fail(404, 'Card not found');
    }
    if (!in_array($card['status'], ['active', 'dispatch_queued'], true)) {
        fail(400, "Card in '{$card['status']}' state cannot be linked to UPI.");
    }
    $pdo->prepare('UPDATE cards SET upi_linked = 1 WHERE id = ?')->execute([$card['id']]);
    $last4 = substr($card['card_number'], -4);
    audit($user, 'UPI_LINK_CARD', "Card ending $last4");
    respond(['status' => 'SUCCESS', 'message' => "UPI linked to card ending $last4. You will be notified when NPCI activates."]);
}

function route_upi_qr(array $d): void
{
    $user = current_user();
    $account = row('SELECT upi_id FROM accounts WHERE user_id = ? ORDER BY created_at, id', [$user['id']]);
    if (!$account || !$account['upi_id']) {
        fail(404, 'No linked account');
    }
    // Encode both values, so a name containing "&" or "=" can't inject extra UPI parameters.
    $uri = 'upi://pay?pa=' . str_replace('%40', '@', rawurlencode($account['upi_id']))
        . '&pn=' . rawurlencode($user['name']) . '&aid=uPfKMDXhs2SDy&mc=0000';
    respond(['upi_id' => $account['upi_id'], 'account_holder' => $user['name'], 'upi_uri' => $uri, 'qr_data' => $uri,
        'limits' => ['per_txn' => 100000, 'daily' => 500000]]);
}

// --- Router ------------------------------------------------------------------------------
$routes = [
    'GET /upi/status' => 'route_upi_status',
    'POST /upi/link-card' => 'route_upi_link_card',
    'GET /upi/qr' => 'route_upi_qr',
    'POST /auth/register' => 'route_register',
    'POST /auth/login' => 'route_login',
    'GET /auth/me' => 'route_me',
    'POST /auth/logout' => 'route_logout',
    'POST /auth/verify-transaction-pin' => 'route_verify_txn_pin',
    'GET /accounts' => 'route_accounts',
    'GET /accounts/transactions' => 'route_transactions',
    'POST /accounts/transfer' => 'route_transfer',
    'POST /accounts/bulk-transfer' => 'route_bulk_transfer',
    'GET /cards' => 'route_cards',
    'POST /cards/manage' => 'route_manage_card',
    'POST /cards/request-physical' => 'route_request_physical_card',
];

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$apiAt = strpos($path, '/api/');
$handler = $apiAt === false ? null : ($routes[$method . ' ' . rtrim(substr($path, $apiAt + 4), '/')] ?? null);
if ($handler === null) {
    fail(404, 'Not Found');
}
try {
    $handler(in_array($method, ['POST', 'PUT', 'PATCH'], true) ? body() : []);
} catch (Throwable $e) {
    error_log('AJSPay API error: ' . $e);
    fail(500, 'Something went wrong. Please try again.');
}
