<?php
// AJSPay: Hostinger PHP/MySQL REST API (front controller).
// Serves the same /api/* routes and JSON shapes the React app expects. Core
// banking (auth, accounts, transfers, cards, UPI) lives here; the other feature
// areas live in modules/.
declare(strict_types=1);

require __DIR__ . '/db.php';
require __DIR__ . '/modules/banking.php';
require __DIR__ . '/modules/statements.php';
require __DIR__ . '/modules/security.php';
require __DIR__ . '/modules/staff.php';
require __DIR__ . '/modules/master.php';
require __DIR__ . '/modules/defence.php';
require __DIR__ . '/modules/compliance.php';
require __DIR__ . '/modules/mfa.php';
require __DIR__ . '/modules/impersonation.php';
require __DIR__ . '/modules/support.php';
require __DIR__ . '/modules/register.php';
require __DIR__ . '/modules/privacy.php';
require __DIR__ . '/modules/tutorial.php';
require __DIR__ . '/modules/crm.php';
require __DIR__ . '/modules/reports.php';
require __DIR__ . '/modules/ai.php';

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

function b64url_decode(string $s): string
{
    return base64_decode(strtr($s, '-_', '+/') . str_repeat('=', (4 - strlen($s) % 4) % 4), true) ?: '';
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

// $impersonator is set only when a bank owner is viewing a member's account
// through support impersonation. It travels inside the signed token, so it
// cannot be added or removed by the client, and every request can see it.
function start_session(array $user, ?array $impersonator = null, ?int $ttl = null): string
{
    global $config;
    $expires = time() + ($ttl ?? $config['token_ttl']);
    $claims = [
        'sub' => $user['id'],
        'role' => $user['role'],
        'ver' => (int)$user['session_version'],
        'exp' => $expires,
    ];
    if ($impersonator !== null) {
        $claims['imp'] = $impersonator['id'];
        $claims['imp_email'] = $impersonator['email'];
        $claims['imp_ver'] = (int)$impersonator['session_version'];
    }
    $payload = b64url(json_encode($claims));
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
    $claims = json_decode(b64url_decode($payload), true);
    if (!is_array($claims) || ($claims['exp'] ?? 0) < time()) {
        fail(401, 'Session expired. Please log in again.');
    }
    $user = row('SELECT * FROM users WHERE id = ?', [(string)($claims['sub'] ?? '')]);
    if (!$user || (int)$user['session_version'] !== (int)($claims['ver'] ?? -1)) {
        fail(401, 'Invalid session token.');
    }
    // An impersonated session stays valid only while the owner's own session
    // does, so the owner logging out ends every impersonation they started.
    global $IMPERSONATOR;
    $IMPERSONATOR = null;
    if (isset($claims['imp'])) {
        $actor = row('SELECT * FROM users WHERE id = ?', [(string)$claims['imp']]);
        if (!$actor || (int)$actor['session_version'] !== (int)($claims['imp_ver'] ?? -1)) {
            fail(401, 'This support session has ended. Please sign in again.');
        }
        $IMPERSONATOR = $actor;
    }
    return $user;
}

// The real person behind the session, when a bank owner is impersonating.
function impersonator(): ?array
{
    global $IMPERSONATOR;
    return $IMPERSONATOR ?? null;
}

// Reads the session token's claims without authenticating and without failing:
// used by guards that run before routing, where a public route must still be
// allowed through. Returns null when there is no token or the signature is bad.
function peek_session_claims(): ?array
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
        return null;  // a forged token is rejected properly by current_user()
    }
    $claims = json_decode(b64url_decode($payload), true);
    return is_array($claims) ? $claims : null;
}

function public_user(array $user): array
{
    $user['nominee'] = $user['nominee_name'] === null ? null
        : ['name' => $user['nominee_name'], 'relation' => $user['nominee_relation']];
    // Everything secret about the account is removed here, so no handler can
    // leak it by returning a user row. The TOTP secret is encrypted at rest and
    // the recovery codes are bcrypt hashes, but neither belongs on the client.
    unset($user['password_hash'], $user['transaction_password_hash'], $user['session_version'],
        $user['nominee_name'], $user['nominee_relation'],
        $user['totp_secret'], $user['totp_backup_codes']);
    // Whether 2FA is on is useful to the app; the material behind it is not.
    $user['totp_enabled'] = (bool)($user['totp_enabled'] ?? false);
    return out($user);
}

// The PIN is never stored in the clear. There is no CVV to hide: PCI DSS
// forbids keeping it after authorisation, so it is never written down.
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
            $t['batch_ref'] ?? null, mb_substr($t['description'], 0, 255), $t['timestamp'] ?? now_utc()]);
}

// New cards get a random PIN nobody knows: the cardholder sets their own via "Set PIN".
function insert_card(string $userId, string $accountNumber, string $holder, array $spec): string
{
    global $pdo;
    $id = uuid4();
    $pdo->prepare('INSERT INTO cards (id, user_id, account_number, card_number, card_holder, card_type, network,
            expiry_date, pin_hash, status, is_virtual, issued_by, online_limit, atm_limit, international_enabled)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        ->execute([
            $id, $userId, $accountNumber, $spec['bin'] . ' ' . digits(4) . ' ' . digits(4) . ' ' . digits(4),
            mb_strtoupper($holder), $spec['type'], $spec['network'], gmdate('m/y', strtotime('+5 years')),
            password_hash(digits(4), PASSWORD_BCRYPT), $spec['status'],
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

// Locks the customer's account and debits it; the caller must be inside a DB transaction.
function debit_account(array $user, mixed $accountNumber, float $total, string $insufficientMessage): array
{
    global $pdo;
    $account = owned_account($user, $accountNumber, true);
    if (!$account) {
        fail(404, 'Account not found.');
    }
    if ($account['status'] !== 'active') {
        fail(403, 'This account is not active for outgoing payments.');
    }
    if ((float)$account['balance'] < $total) {
        fail(400, $insufficientMessage);
    }
    $pdo->prepare('UPDATE accounts SET balance = balance - ? WHERE id = ?')->execute([$total, $account['id']]);
    return [$account, round((float)$account['balance'] - $total, 2)];
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
    $code = strtoupper(clip($d['referral_code'] ?? '', 12));
    $bonus = $code === '' ? null : apply_referral_bonus($userId, $name, $email, $accountNumber, $initial, $code);
    $user = row('SELECT * FROM users WHERE id = ?', [$userId]);
    audit($user, 'USER_REGISTER', "Opened account $accountNumber");
    $pdo->commit();

    respond(['token' => start_session($user), 'user' => public_user($user),
        'account_number' => $accountNumber, 'referral_bonus' => $bonus]);
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
    // With an authenticator enrolled, the password alone does not produce a
    // session: hand back a short-lived challenge and wait for the code.
    if (!empty($user['totp_enabled'])) {
        audit($user, 'USER_LOGIN_MFA_PENDING', 'Password accepted, awaiting authenticator code');
        respond(['mfa_required' => true, 'mfa_token' => mfa_challenge_token($user),
            'message' => 'Enter the six-digit code from your authenticator app.']);
    }
    audit($user, 'USER_LOGIN', 'Logged in via ' . (clip($d['device_name'] ?? '', 100) ?: 'web'));
    respond(['token' => start_session($user), 'user' => public_user($user), 'features' => enabled_capabilities(),
        'message' => 'Login successful', 'mfa_verified' => false]);
}

function route_me(array $d): void
{
    // `features` tells the app which regulated services it may show; see
    // modules/compliance.php.
    $user = current_user();
    respond(['user' => public_user($user), 'features' => enabled_capabilities(),
        'impersonation' => impersonation_state()]);
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
    $sql = 'SELECT * FROM transactions WHERE user_id = ?';
    $params = [$user['id']];
    if (!empty($_GET['account_number'])) {
        $sql .= ' AND account_number = ?';
        $params[] = clip($_GET['account_number'], 30);
    }
    // Optional filters, all bound as parameters.
    if (!empty($_GET['type']) && in_array($_GET['type'], ['credit', 'debit'], true)) {
        $sql .= ' AND type = ?';
        $params[] = $_GET['type'];
    }
    if (!empty($_GET['from_date'])) {
        $sql .= ' AND timestamp >= ?';
        $params[] = valid_date($_GET['from_date'], 'from_date') . ' 00:00:00';
    }
    if (!empty($_GET['to_date'])) {
        $sql .= ' AND timestamp <= ?';
        $params[] = valid_date($_GET['to_date'], 'to_date') . ' 23:59:59';
    }
    if (!empty($_GET['q'])) {
        $sql .= ' AND (counterparty_name LIKE ? OR description LIKE ? OR ref_number LIKE ?)';
        $like = '%' . clip($_GET['q'], 60) . '%';
        array_push($params, $like, $like, $like);
    }
    [$txns, $meta] = paginate("$sql ORDER BY timestamp DESC, id", $params, 25, 200);
    respond(['transactions' => out_all($txns), 'pagination' => $meta]);
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
        $scheduleDate = valid_date($d['schedule_date'], 'schedule_date');
        if ($scheduleDate < (new DateTimeImmutable('today', new DateTimeZone(IST)))->format('Y-m-d')) {
            fail(422, 'schedule_date must be today or later.');
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

    // A payee outside AJSPay is an interbank transfer: it only debits here.
    $receiver = $locked[$to] ?? null;
    // Sending money out of this institution needs payment-system authorisation.
    // Moving it between two member accounts is a book entry on our own ledger
    // and does not. Decided before anything is debited, and before a transfer
    // can be parked as a scheduled one.
    if ($mode === 'UPI') {
        require_capability('upi');
    }
    if ($receiver === null) {
        require_capability('payment_systems');
    } else {
        require_capability('internal_transfers');
        if (!capability_enabled('payment_systems')) {
            $mode = 'INTERNAL';  // call it what it actually is
        }
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
    // Score the transfer once the money has moved. The member is never told they
    // were flagged: warning a suspect off is "tipping off", which the PMLA
    // prohibits. The alert goes to the staff review queue only.
    score_transfer_safely($user, ['account_number' => $from, 'amount' => $amount, 'ref_number' => $ref,
        'counterparty_acc' => $to, 'counterparty_name' => $beneficiary, 'balance_after' => $newBalance]);
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
    [$sender, $newBalance] = debit_account($user, $d['from_account_number'], $total,
        'Insufficient corporate balance. Total batch requires ' . rupees($total));
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

// route_reveal_cvv is deliberately gone. A CVV may not be stored after
// authorisation (PCI DSS), so there is nothing to reveal; a real card programme
// shows it once at issuance and never again.

function route_manage_card(array $d): void
{
    global $pdo;
    $user = current_user();
    need($d, 'card_id', 'action');
    $card = row('SELECT * FROM cards WHERE id = ? AND user_id = ?', [clip($d['card_id'], 36), $user['id']]);
    if (!$card) {
        fail(404, 'Debit card not found.');
    }
    // Hotlisting is permanent.
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

// The account number travels in the JSON body, never the URL, so it stays out of logs.
function route_request_physical_card(array $d): void
{
    $user = current_user();
    $account = owned_account($user, $d['account_number'] ?? '');
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
    // Auth & accounts
    'POST /auth/register' => 'route_register',
    'POST /auth/login' => 'route_login',
    'GET /auth/me' => 'route_me',
    'POST /auth/logout' => 'route_logout',
    'POST /auth/verify-transaction-pin' => 'route_verify_txn_pin',
    // Authenticator-app 2FA (modules/mfa.php), open to every role
    'POST /auth/login/totp' => 'route_login_totp',
    'GET /totp/status' => 'route_totp_status',
    'POST /totp/setup' => 'route_totp_setup',
    'POST /totp/enable' => 'route_totp_enable',
    'POST /totp/disable' => 'route_totp_disable',
    'GET /accounts' => 'route_accounts',
    'GET /accounts/transactions' => 'route_transactions',
    'POST /accounts/transfer' => 'route_transfer',
    'POST /accounts/bulk-transfer' => 'route_bulk_transfer',
    // Cards & UPI
    'GET /cards' => 'route_cards',
    'POST /cards/manage' => 'route_manage_card',
    'POST /cards/request-physical' => 'route_request_physical_card',
    'GET /upi/status' => 'route_upi_status',
    'POST /upi/link-card' => 'route_upi_link_card',
    'GET /upi/qr' => 'route_upi_qr',
    // Banking services (modules/banking.php)
    'POST /services/cheque-book' => 'route_cheque_book',
    'POST /services/stop-cheque' => 'route_stop_cheque',
    'POST /services/demand-draft' => 'route_demand_draft',
    'POST /deposits/book' => 'route_book_deposit',
    'POST /loans/apply' => 'route_apply_loan',
    'GET /loans/my-applications' => 'route_my_loans',
    'GET /investments/catalog' => 'route_investment_catalog',
    'POST /investments/invest' => 'route_invest',
    'GET /investments/my-portfolio' => 'route_portfolio',
    'POST /support/complaint' => 'route_complaint',
    'GET /support/my-tickets' => 'route_my_tickets',
    'POST /support/chat' => 'route_chat',
    'GET /branches/locator' => 'route_branches',
    'GET /referrals/my-code' => 'route_referral_code',
    'GET /referrals/history' => 'route_referral_history',
    'GET /standing-instructions' => 'route_si_list',
    'POST /standing-instructions' => 'route_si_create',
    // Statements (modules/statements.php)
    'POST /statements/pdf' => 'route_statement_pdf',
    'POST /statements/excel' => 'route_statement_excel',
    // OTP & passkeys (modules/security.php)
    'POST /otp/send' => 'route_otp_send',
    'POST /otp/verify' => 'route_otp_verify',
    'POST /passkey/register/challenge' => 'route_passkey_register_challenge',
    'POST /passkey/register/complete' => 'route_passkey_register_complete',
    'POST /passkey/login/challenge' => 'route_passkey_login_challenge',
    'POST /passkey/login/complete' => 'route_passkey_login_complete',
    'GET /passkey/list' => 'route_passkey_list',
    // Staff, admin & KYC (modules/staff.php)
    'GET /panel/bank-owner' => 'route_panel_bank_owner',
    'GET /panel/staff' => 'route_panel_staff',
    'GET /panel/collection' => 'route_panel_collection',
    'POST /panel/collection/action' => 'route_collection_action',
    'GET /panel/loan-dept' => 'route_panel_loan_dept',
    'POST /panel/loan-dept/decision' => 'route_loan_decision',
    'GET /admin/overview' => 'route_admin_overview',
    'POST /admin/kyc-action' => 'route_admin_kyc_action',
    'GET /admin/rbi-reports' => 'route_rbi_reports',
    'GET /admin/config' => 'route_admin_config_get',
    'PUT /admin/config' => 'route_admin_config_set',
    'POST /kyc/video/submit' => 'route_kyc_submit',
    'GET /kyc/video/queue' => 'route_kyc_queue',
    'POST /kyc/video/decision' => 'route_kyc_decision',
    // Scheme master & field agents (modules/master.php) — back office only
    'GET /schemes' => 'route_schemes_list',
    'POST /schemes' => 'route_scheme_create',
    'GET /agents' => 'route_agents_list',
    'POST /agents' => 'route_agent_create',
    'POST /collections' => 'route_collection_create',
    // AI module (modules/ai.php)
    'GET /ai/fraud-queue' => 'route_fraud_queue',
    'POST /ai/fraud-action' => 'route_fraud_action',
    'POST /ai/loan-rescore' => 'route_loan_rescore',
    'GET /ai/collection-anomalies' => 'route_collection_anomalies',
    // Security centre (modules/defence.php)
    'GET /security/events' => 'route_security_events',
    'GET /security/audit' => 'route_security_audit',
    'POST /security/seal' => 'route_integrity_seal',
    // Regulated-capability register (modules/compliance.php)
    'GET /public/features' => 'route_public_features',
    'GET /public/schemes' => 'route_public_schemes',
    'GET /compliance/capabilities' => 'route_capabilities',
    'PUT /compliance/capability' => 'route_capability_set',
    // Support impersonation (modules/impersonation.php) — read only
    // Data protection, DPDP Act 2023 (modules/privacy.php)
    'GET /privacy/notice' => 'route_privacy_notice',
    'GET /privacy/consent' => 'route_privacy_consent_get',
    'POST /privacy/consent' => 'route_privacy_consent_set',
    'GET /privacy/my-data' => 'route_privacy_my_data',
    'POST /privacy/request' => 'route_privacy_request',
    'GET /privacy/my-requests' => 'route_privacy_my_requests',
    'GET /privacy/queue' => 'route_privacy_queue',
    'POST /privacy/respond' => 'route_privacy_respond',
    // Member register and AML screening (modules/register.php)
    'GET /register/members' => 'route_register_list',
    'POST /register/admit' => 'route_register_admit',
    'POST /register/shares' => 'route_register_shares',
    'GET /screening/watchlist' => 'route_watchlist_list',
    'POST /screening/watchlist' => 'route_watchlist_add',
    'POST /screening/run' => 'route_screening_run',
    'GET /screening/hits' => 'route_screening_hits',
    'POST /screening/action' => 'route_screening_action',
    'POST /screening/rerate' => 'route_risk_rerate',
    // Grievance escalation (modules/support.php); the two that carry a ticket
    // reference are matched in $paramRoutes below.
    'GET /grievance/queue' => 'route_grievance_queue',
    // First-run tour (modules/tutorial.php)
    'GET /tutorial/state' => 'route_tutorial_state',
    'POST /tutorial/progress' => 'route_tutorial_progress',
    'POST /tutorial/finish' => 'route_tutorial_finish',
    'POST /tutorial/restart' => 'route_tutorial_restart',
    // CRM (modules/crm.php) and reporting (modules/reports.php) — staff only
    'GET /crm/members' => 'route_crm_members',
    'POST /crm/interaction' => 'route_crm_log_interaction',
    'GET /crm/leads' => 'route_crm_leads',
    'POST /crm/leads' => 'route_crm_lead_create',
    'GET /crm/tasks' => 'route_crm_tasks',
    'POST /crm/tasks' => 'route_crm_task_create',
    'GET /reports' => 'route_reports_list',
    // Support desk (modules/support.php)
    'GET /support/queue' => 'route_support_queue',
    'GET /support/notifications' => 'route_support_notifications',
    'GET /impersonate/candidates' => 'route_impersonate_candidates',
    'POST /impersonate/start' => 'route_impersonate_start',
    'POST /impersonate/stop' => 'route_impersonate_stop',
];
// Routes with an id in the path. Exact routes above are matched first.
$paramRoutes = [
    ['PATCH', '#^/standing-instructions/([\w-]{1,64})$#', 'route_si_update'],
    ['DELETE', '#^/standing-instructions/([\w-]{1,64})$#', 'route_si_delete'],
    ['POST', '#^/standing-instructions/([\w-]{1,64})/pause$#', 'route_si_pause'],
    ['POST', '#^/standing-instructions/([\w-]{1,64})/resume$#', 'route_si_resume'],
    ['DELETE', '#^/passkey/([\w-]{1,64})$#', 'route_passkey_delete'],
    ['GET', '#^/kyc/video/([\w-]{1,64})/face-match$#', 'route_kyc_face_match'],
    ['GET', '#^/kyc/video/([\w-]{1,64})$#', 'route_kyc_detail'],
    ['PATCH', '#^/schemes/([\w-]{1,64})$#', 'route_scheme_update'],
    ['DELETE', '#^/schemes/([\w-]{1,64})$#', 'route_scheme_delete'],
    ['PATCH', '#^/agents/([\w-]{1,64})$#', 'route_agent_update'],
    ['DELETE', '#^/agents/([\w-]{1,64})$#', 'route_agent_delete'],
    ['GET', '#^/agents/([\w-]{1,64})/collections$#', 'route_collections_list'],
    ['GET', '#^/support/ticket/([\w-]{1,64})$#', 'route_ticket_detail'],
    ['POST', '#^/support/ticket/([\w-]{1,64})/reply$#', 'route_ticket_reply'],
    ['POST', '#^/support/ticket/([\w-]{1,64})/assign$#', 'route_ticket_assign'],
    ['POST', '#^/support/ticket/([\w-]{1,64})/status$#', 'route_ticket_status'],
    ['GET', '#^/register/folio/([\w@.-]{1,80})$#', 'route_register_folio'],
    ['POST', '#^/register/cease/([\w-]{1,64})$#', 'route_register_cease'],
    ['GET', '#^/crm/member/([\w@.-]{1,80})$#', 'route_crm_member'],
    ['PATCH', '#^/crm/leads/([\w-]{1,64})$#', 'route_crm_lead_update'],
    ['POST', '#^/tickets/([\w-]{1,64})/escalate$#', 'route_grievance_escalate'],
    ['POST', '#^/grievance/([\w-]{1,64})/resolve$#', 'route_grievance_resolve'],
    ['PATCH', '#^/crm/tasks/([\w-]{1,64})$#', 'route_crm_task_update'],
    ['GET', '#^/reports/([\w-]{1,40})/export$#', 'route_report_export'],
    ['GET', '#^/reports/([\w-]{1,40})$#', 'route_report_run'],
];

// cron.php includes this file to reuse insert_txn(), audit() and the constants.
// There is no request to dispatch under the CLI, so stop here with the routes defined.
if (PHP_SAPI === 'cli') {
    return;
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$apiAt = strpos($path, '/api/');
$route = $apiAt === false ? '' : rtrim(substr($path, $apiAt + 4), '/');
$handler = $routes["$method $route"] ?? null;
$param = '';
if ($handler === null) {
    foreach ($paramRoutes as [$routeMethod, $pattern, $fn]) {
        if ($routeMethod === $method && preg_match($pattern, $route, $match)) {
            [$handler, $param] = [$fn, $match[1]];
            break;
        }
    }
}
// Rate limiting runs before the handler, and before an unknown path is rejected,
// so probing for routes costs an attacker the same budget as using them.
guard_request($method, $route);

// A support session may read but never write. Checked here so no handler can
// forget it, and before routing so a blocked write cannot have a side effect.
guard_impersonation($method, $route);

// Features that need an authorisation this entity does not hold are refused
// here, before the handler runs, so the gate cannot be missed by a code path.
if (isset(ROUTE_CAPABILITIES["$method $route"])) {
    require_capability(ROUTE_CAPABILITIES["$method $route"]);
}

if ($handler === null) {
    fail(404, 'Not Found');
}
try {
    $handler(in_array($method, ['POST', 'PUT', 'PATCH'], true) ? body() : [], $param);
} catch (Throwable $e) {
    error_log('AJSPay API error: ' . $e);
    security_event('SERVER_ERROR', 'warning', get_class($e) . ' on ' . $route);
    fail(500, 'Something went wrong. Please try again.');
}
