<?php
// AJSPay: Hostinger PHP/MySQL REST API (front controller).
// Serves the same /api/* routes and JSON shapes the React app expects. Core
// banking (auth, accounts, transfers, cards, UPI) lives here; the other feature
// areas live in modules/.
declare(strict_types=1);

require __DIR__ . '/db.php';
// staff.php must load before banking.php: banking.php's COUNTER_DEPOSIT_ROLES
// const is built from staff.php's ADMIN_ROLES at file-load time, and a
// top-level const referencing an undefined constant is a fatal error, not a
// deferred lookup -- so the file that defines it has to load first.
require __DIR__ . '/modules/staff.php';
require __DIR__ . '/modules/banking.php';
require __DIR__ . '/modules/statements.php';
require __DIR__ . '/modules/security.php';
require __DIR__ . '/modules/master.php';
require __DIR__ . '/modules/parameters.php';
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
require __DIR__ . '/modules/rails.php';

const MAX_FAILS = 5;  // wrong passwords allowed per 15 minutes before lockout
const TRANSFER_MODES = ['IMPS', 'NEFT', 'RTGS', 'UPI'];
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
    // Recorded so the member can see where they are signed in and end a session
    // from another device. The id travels inside the signed payload, so it
    // cannot be swapped for someone else's.
    global $pdo;
    $sid = uuid4();
    $pdo->prepare('INSERT INTO sessions (id, user_id, user_agent, ip, is_impersonation, expires_at)
        VALUES (?, ?, ?, ?, ?, ?)')
        ->execute([$sid, $user['id'], clip($_SERVER['HTTP_USER_AGENT'] ?? '', 255) ?: null,
            client_ip(), $impersonator !== null ? 1 : 0, gmdate('Y-m-d H:i:s', $expires)]);
    $claims['sid'] = $sid;

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
    // Tokens issued before this table existed carry no sid. They are still
    // signed, so the claim cannot be stripped by a client — an absent sid means
    // a legitimately older token, and it keeps working until it expires.
    if (isset($claims['sid'])) {
        global $pdo;
        $session = row('SELECT * FROM sessions WHERE id = ?', [(string)$claims['sid']]);
        if (!$session || $session['revoked_at'] !== null) {
            fail(401, 'This session was ended from another device. Please sign in again.');
        }
        // Written at most once a minute: a timestamp on every request would turn
        // each read into a write.
        if (strtotime($session['last_seen_at']) < time() - 60) {
            $pdo->prepare('UPDATE sessions SET last_seen_at = ?, ip = ? WHERE id = ?')
                ->execute([now_utc(), client_ip(), $session['id']]);
        }
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

// Self-registration (route_self_register) hands out a real, working login
// before anyone has checked this person's documents. That is fine for looking
// around; it is not fine for moving money — a Nidhi may only take deposits
// from and lend to verified members. Every route that can move money calls
// this first. Internal roles (staff, directors, ...) are not retail members
// and are never subject to this.
function require_kyc_verified(array $user): void
{
    if ($user['role'] !== 'retail') {
        return;
    }
    if (($user['kyc_status'] ?? '') !== 'verified') {
        fail(403, 'Please complete KYC verification before moving money. '
            . 'Visit a branch or complete Video KYC from your dashboard.');
    }
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

// A transfer the payment partner has not confirmed yet is written as PENDING and
// settled later, so the statement never claims money left before it did.
function insert_txn(array $t): void
{
    global $pdo;
    $pdo->prepare('INSERT INTO transactions (id, user_id, account_number, type, mode, amount, balance_after,
            counterparty_name, counterparty_acc, ref_number, batch_ref, status, description, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        ->execute([uuid4(), $t['user_id'], $t['account_number'], $t['type'], $t['mode'], $t['amount'],
            $t['balance_after'], $t['counterparty_name'], $t['counterparty_acc'], $t['ref_number'],
            $t['batch_ref'] ?? null, $t['status'] ?? 'SUCCESS', mb_substr($t['description'], 0, 255),
            $t['timestamp'] ?? now_utc()]);
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
// --- Where you are signed in -----------------------------------------------------------
// A member could sign out everywhere, by logging out, but could not see where "everywhere"
// was or end one device without ending the rest.
function describe_device(?string $agent): string
{
    $agent = (string)$agent;
    $browser = match (true) {
        str_contains($agent, 'Edg/') => 'Edge',
        str_contains($agent, 'OPR/') || str_contains($agent, 'Opera') => 'Opera',
        str_contains($agent, 'Chrome') => 'Chrome',
        str_contains($agent, 'Firefox') => 'Firefox',
        str_contains($agent, 'Safari') => 'Safari',
        default => 'Unknown browser',
    };
    $platform = match (true) {
        str_contains($agent, 'iPhone') => 'iPhone',
        str_contains($agent, 'iPad') => 'iPad',
        str_contains($agent, 'Android') => 'Android',
        str_contains($agent, 'Windows') => 'Windows',
        str_contains($agent, 'Mac OS') || str_contains($agent, 'Macintosh') => 'Mac',
        str_contains($agent, 'Linux') => 'Linux',
        default => 'unknown device',
    };
    return "$browser on $platform";
}

function route_sessions_list(array $d): void
{
    global $pdo;
    $user = current_user();
    $pdo->prepare('DELETE FROM sessions WHERE expires_at < ?')->execute([now_utc()]);

    $claims = peek_session_claims();
    $currentSid = (string)($claims['sid'] ?? '');
    $rows = rows('SELECT * FROM sessions WHERE user_id = ? AND revoked_at IS NULL
        ORDER BY last_seen_at DESC', [$user['id']]);

    respond(['sessions' => array_map(fn($r) => [
        'id' => $r['id'],
        'device' => describe_device($r['user_agent']),
        // Only the network the session came from, never a precise location:
        // the member can recognise their own, and nothing more is stored.
        'ip' => $r['ip'],
        'is_impersonation' => (int)$r['is_impersonation'] === 1,
        'is_current' => $r['id'] === $currentSid,
        'signed_in_at' => $r['created_at'],
        'last_seen_at' => $r['last_seen_at'],
    ], $rows)]);
}

function route_session_revoke(array $d, string $id = ''): void
{
    global $pdo;
    $user = current_user();
    // Scoped to the caller's own rows, so an id belonging to someone else
    // matches nothing rather than ending their session.
    $session = row('SELECT * FROM sessions WHERE id = ? AND user_id = ?', [$id, $user['id']]);
    if (!$session) {
        fail(404, 'That session no longer exists.');
    }
    $claims = peek_session_claims();
    if ($session['id'] === (string)($claims['sid'] ?? '')) {
        fail(400, 'That is this device. Use Log out to end this session.');
    }
    $pdo->prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?')->execute([now_utc(), $session['id']]);
    audit($user, 'SESSION_REVOKED', describe_device($session['user_agent']) . ' from ' . $session['ip']);
    security_event('SESSION_REVOKED', 'info', 'Member ended a session on another device', $user);
    respond(['status' => 'SUCCESS', 'message' => 'That device has been signed out.']);
}

// --- Changing your own password --------------------------------------------------------
// A member could not do this at all: the only way to change a password was to pretend to
// have forgotten it. Re-authentication is required, because a screen left open in a branch
// should not be enough to take an account over.
function route_change_password(array $d): void
{
    global $pdo;
    $user = current_user();

    // The same lockout the login uses, keyed separately so a run at this does
    // not lock the member out of signing in, and vice versa.
    $identifier = 'chpwd:' . $user['id'];
    if (recent_fails($identifier) >= MAX_FAILS) {
        fail(429, 'Too many wrong attempts. Please try again in 15 minutes.');
    }
    if (!is_string($d['current_password'] ?? null) || !password_verify($d['current_password'], $user['password_hash'])) {
        record_fail($identifier, $user['email']);
        security_event('PASSWORD_CHANGE_FAILED', 'warning', 'Wrong current password', $user);
        fail(400, 'Your current password is not right.');
    }
    clear_fails($identifier);

    $new = $d['new_password'] ?? null;
    assert_password_acceptable($new, [$user['name'], strstr($user['email'], '@', true)]);
    if (is_string($new) && password_verify($new, $user['password_hash'])) {
        fail(422, 'That is your current password. Please choose a different one.');
    }

    // Bumping the version signs out every device holding a token, which is the
    // point of changing a password. The caller is then handed a fresh one, so
    // the device doing the changing is the only one that stays in.
    $pdo->prepare('UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ?')
        ->execute([password_hash($new, PASSWORD_BCRYPT), $user['id']]);
    $fresh = row('SELECT * FROM users WHERE id = ?', [$user['id']]);

    audit($user, 'PASSWORD_CHANGED', 'Changed from the security screen');
    security_event('PASSWORD_CHANGED', 'warning', 'Password changed; other sessions revoked', $user);
    respond(['status' => 'SUCCESS', 'token' => start_session($fresh),
        'message' => 'Password changed. Every other signed-in device has been logged out.']);
}

// --- Nominee and joint holder ---------------------------------------------------------
// A nomination is a statutory record: it decides who the deposit is paid to. Changing it
// is therefore treated like moving money — the transaction password is required, the old
// and new values both go into the audit trail, and the member is told what changed.
function route_nominee_update(array $d): void
{
    global $pdo;
    $user = current_user();
    check_txn_password($user, $d['transaction_password'] ?? null,
        'Wrong transaction password. The nomination has not been changed.');

    $name = clip($d['nominee_name'] ?? '', 150);
    $relation = clip($d['nominee_relation'] ?? '', 50);
    if ($name === '') {
        fail(422, 'Please give the nominee\'s full name.');
    }
    if ($relation === '') {
        fail(422, 'Please state the nominee\'s relationship to you.');
    }

    $before = $user['nominee_name'] === null ? 'none' : "{$user['nominee_name']} ({$user['nominee_relation']})";
    $pdo->prepare('UPDATE users SET nominee_name = ?, nominee_relation = ? WHERE id = ?')
        ->execute([$name, $relation, $user['id']]);
    audit($user, 'NOMINEE_UPDATED', "$before -> $name ($relation)");
    security_event('NOMINEE_UPDATED', 'info', "Nomination changed from $before to $name ($relation)", $user);

    respond(['status' => 'SUCCESS',
        'message' => "Nomination recorded: $name ($relation).",
        'user' => public_user(row('SELECT * FROM users WHERE id = ?', [$user['id']]))]);
}

function route_joint_holder_update(array $d): void
{
    global $pdo;
    $user = current_user();
    check_txn_password($user, $d['transaction_password'] ?? null,
        'Wrong transaction password. The joint holder has not been changed.');

    // Removing a joint holder is as deliberate an act as adding one, so it is
    // an explicit flag rather than an empty name.
    $wanted = !empty($d['is_joint']);
    $name = clip($d['joint_holder_name'] ?? '', 150);
    if ($wanted && $name === '') {
        fail(422, 'Please give the joint holder\'s full name.');
    }
    $pan = strtoupper(clip($d['joint_holder_pan'] ?? '', 10));
    if ($wanted && $pan !== '' && !preg_match('/\A[A-Z]{5}[0-9]{4}[A-Z]\z/', $pan)) {
        fail(422, 'The joint holder\'s PAN must look like ABCDE1234F.');
    }

    $before = (int)$user['is_joint'] === 1 ? ($user['joint_holder_name'] ?? 'unnamed') : 'none';
    $pdo->prepare('UPDATE users SET is_joint = ?, joint_holder_name = ? WHERE id = ?')
        ->execute([$wanted ? 1 : 0, $wanted ? $name : null, $user['id']]);
    // Every account the member holds carries the same joint flag.
    $pdo->prepare('UPDATE accounts SET is_joint = ? WHERE user_id = ?')->execute([$wanted ? 1 : 0, $user['id']]);

    $after = $wanted ? $name : 'none';
    audit($user, 'JOINT_HOLDER_UPDATED', "$before -> $after" . ($wanted && $pan !== '' ? " PAN $pan" : ''));
    security_event('JOINT_HOLDER_UPDATED', 'warning', "Joint holder changed from $before to $after", $user);

    respond(['status' => 'SUCCESS',
        'message' => $wanted ? "$name recorded as joint holder." : 'Joint holder removed from the account.',
        'user' => public_user(row('SELECT * FROM users WHERE id = ?', [$user['id']]))]);
}

// Opening an account is a counter action, not a self-service one: a Nidhi has to
// see the applicant's identity documents first. The public site raises an enquiry
// instead (route_public_enquiry), and a verified applicant is opened here by staff.
const ACCOUNT_OPEN_ROLES = ['bank_owner', 'admin', 'branch_manager', 'staff'];

function route_register(array $d): void
{
    $opener = staff_user(ACCOUNT_OPEN_ROLES);
    global $pdo;
    // Email is optional. Plenty of members do not have one, and requiring it
    // meant either turning them away or a teller inventing an address — which
    // then becomes the account's identity and cannot be used to reach anybody.
    // They sign in with the account number instead; see route_login.
    need($d, 'name', 'phone', 'password', 'transaction_password');
    $email = strtolower(clip($d['email'] ?? '', 150));
    if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        fail(422, 'That email address does not look right. Leave it blank if the member has none.');
    }
    // bcrypt silently ignores everything past 72 bytes, so cap it rather than pretend.
    assert_password_acceptable($d['password'] ?? null,
        [$d['name'] ?? '', $email === '' ? '' : strstr($email, '@', true)]);
    if (!is_string($d['password']) || strlen($d['password']) < 8 || strlen($d['password']) > 72) {
        fail(422, 'Password must be 8 to 72 characters.');
    }
    if (!is_string($d['transaction_password']) || strlen($d['transaction_password']) < 4
        || strlen($d['transaction_password']) > 72) {
        fail(422, 'Transaction password must be 4 to 72 characters.');
    }
    if ($email !== '' && row('SELECT id FROM users WHERE email = ?', [$email])) {
        fail(400, 'Account with this email already exists.');
    }
    // A phone number is how a member is reached and how staff find them, so it
    // has to be unique even though an email need not be present.
    if (row('SELECT id FROM users WHERE phone = ?', [clip($d['phone'], 30)])) {
        fail(400, 'An account already exists for this phone number.');
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
    $introducerCode = clip($d['introducer_code'] ?? '', 30);
    $introducerName = clip($d['introducer_name'] ?? '', 150);
    $userId = uuid4();
    $accountNumber = 'AJSP0' . digits(9);

    // The plan and the denomination are resolved before the transaction opens, so
    // a slab that does not exist is refused without a half-opened account behind
    // it. The deposit is booked in the same transaction as the account below:
    // an account opened for a plan, with no plan on it, is the gap that had the
    // member ringing the branch to ask what they had actually joined.
    $scheme = null;
    $terms = null;
    $planCode = strtoupper(clip($d['scheme_code'] ?? '', 20));
    if ($planCode !== '') {
        $scheme = row("SELECT * FROM schemes WHERE code = ? AND status = 'active' AND deleted_at IS NULL",
            [$planCode]);
        if (!$scheme) {
            fail(422, 'That plan is not one of our current schemes.');
        }
        if (isset($d['scheme_amount']) && money($d['scheme_amount']) > 0) {
            $terms = scheme_deposit_terms($scheme, money($d['scheme_amount']));
        }
    }

    // Opening against an enquiry means opening against its document file, and
    // the file has to have been checked first. This is the whole point of
    // collecting documents at the enquiry: the verification gates the account
    // instead of trailing along behind one that is already live.
    $lead = null;
    $file = null;
    if (!empty($d['lead_id'])) {
        $lead = row('SELECT * FROM crm_leads WHERE id = ?', [clip($d['lead_id'], 36)]);
        if (!$lead) {
            fail(404, 'That enquiry no longer exists.');
        }
        $file = lead_file_status($lead['id']);
        if (!$file['ready_to_open']) {
            fail(409, 'This account cannot be opened yet. Still needed: '
                . implode(' and ', $file['missing']) . '.');
        }
    }

    $pdo->beginTransaction();
    $pdo->prepare('INSERT INTO users (id, name, email, phone, role, password_hash, transaction_password_hash,
            branch, pan_number, aadhaar_number, kyc_status, is_joint, joint_holder_name, nominee_name, nominee_relation,
            introducer_code, introducer_name)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        ->execute([
            $userId, $name, $email === '' ? null : $email, clip($d['phone'], 30), 'retail',
            password_hash($d['password'], PASSWORD_BCRYPT), password_hash($d['transaction_password'], PASSWORD_BCRYPT),
            $branch, $pan === '' ? null : $pan, strlen($aadhaar) >= 4 ? 'XXXX-XXXX-' . substr($aadhaar, -4) : null,
            // A member whose documents were checked before the account existed
            // is not waiting on KYC. Marking them pending would send them round
            // the same review a second time for the same papers.
            $file === null ? 'pending_approval' : 'verified', (int)$isJoint, $isJoint ? clip($d['joint_holder_name'] ?? '', 150) : null,
            $nominee === '' ? null : $nominee, $nominee === '' ? null : clip($d['nominee_relation'] ?? '', 50),
            $introducerCode === '' ? null : $introducerCode, $introducerName === '' ? null : $introducerName,
        ]);
    $pdo->prepare('INSERT INTO accounts (id, user_id, account_number, account_type, account_name, balance, upi_id,
            branch, is_joint)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        ->execute([uuid4(), $userId, $accountNumber, $accountType, ucfirst($accountType) . ' Account', $initial,
            // The UPI handle is built from the account number when there is no
            // email to build it from, so it stays unique either way.
            ($email === '' ? strtolower($accountNumber) : strstr($email, '@', true)) . '@ajspay',
            $branch, (int)$isJoint]);
    insert_card($userId, $accountNumber, $name, VIRTUAL_DEBIT_CARD);
    // Opening can write three ledger rows at once, and now_utc() only resolves to
    // the second, so they would tie and a statement could show the deposit debit
    // above the credit that funded it. Each step is stamped a second apart, in
    // the order it actually happened.
    $ledgerAt = new DateTimeImmutable(now_utc());
    $step = fn(int $n) => $ledgerAt->modify("+$n seconds")->format('Y-m-d H:i:s');
    insert_txn(['user_id' => $userId, 'account_number' => $accountNumber, 'type' => 'credit',
        'mode' => 'ACCOUNT_OPENING', 'amount' => $initial, 'balance_after' => $initial,
        'counterparty_name' => 'Account Opening Initial Fund', 'counterparty_acc' => 'BRANCH-CASH-DESK',
        'ref_number' => 'AOF-' . random_int(1000000, 9999999), 'description' => 'Initial account deposit',
        'timestamp' => $step(0)]);
    // Opening against a lead carries its referral code through, which is the
    // join the chain was missing: the code arrived with the enquiry, and the
    // bonus is paid here, but nothing connected the two and a shared link paid
    // nobody unless a teller happened to retype the code.
    $code = strtoupper(clip($d['referral_code'] ?? ($lead['referral_code'] ?? ''), 12));
    $bonus = $code === '' ? null : apply_referral_bonus($userId, $name, $email, $accountNumber, $initial, $code);
    // The enquiry is closed out here rather than left for someone to tidy later,
    // so the pipeline shows what actually happened to it.
    // A lump-sum plan is funded at the counter: the money is paid in with the
    // opening cash and moved straight into the term deposit, so the savings
    // statement shows both halves rather than a balance that silently vanished.
    // An instalment plan is not funded here at all -- the first instalment is a
    // collection, and booking it as paid today would be a lie on the statement.
    $deposit = null;
    if ($terms !== null) {
        // Relative, and read back, never computed from $initial. An absolute
        // "SET balance = opening + plan" silently erased the referral bonus
        // credited a few lines above: the member's statement showed the bonus
        // and their balance did not contain it.
        $balanceOf = fn() => (float)scalar('SELECT balance FROM accounts WHERE account_number = ?',
            [$accountNumber]);
        $balance = $balanceOf();
        if (!$terms['by_instalment']) {
            $pdo->prepare('UPDATE accounts SET balance = balance + ? WHERE account_number = ?')
                ->execute([$terms['due_today'], $accountNumber]);
            $balance = $balanceOf();
            insert_txn(['user_id' => $userId, 'account_number' => $accountNumber, 'type' => 'credit',
                'mode' => 'ACCOUNT_OPENING', 'amount' => $terms['due_today'], 'balance_after' => $balance,
                'counterparty_name' => 'Plan funding received at counter',
                'counterparty_acc' => 'BRANCH-CASH-DESK',
                'ref_number' => 'AOF-' . random_int(1000000, 9999999),
                'description' => "Paid in for {$terms['scheme_name']}", 'timestamp' => $step(1)]);
        }
        $depositNumber = 'DEP' . random_int(10000000, 99999999);
        $maturityDate = (new DateTimeImmutable('today', new DateTimeZone(IST)))
            ->modify('+' . (int)($terms['tenure_months'] * 30.4) . ' days')->format('Y-m-d');
        $pdo->prepare('INSERT INTO deposits (id, user_id, deposit_number, deposit_type, scheme_code,
                source_account, principal_amount, interest_rate, tenure_months, interest_payout,
                maturity_amount, maturity_date, nominee_name, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            ->execute([uuid4(), $userId, $depositNumber, $terms['deposit_type'], $terms['scheme_code'],
                $accountNumber, $terms['total_deposit'], $terms['interest_rate'], $terms['tenure_months'],
                $terms['interest_payout'], $terms['maturity_amount'], $maturityDate,
                $nominee === '' ? null : $nominee, 'active']);
        if (!$terms['by_instalment']) {
            $pdo->prepare('UPDATE accounts SET balance = balance - ? WHERE account_number = ?')
                ->execute([$terms['due_today'], $accountNumber]);
            $balance = $balanceOf();
            insert_txn(['user_id' => $userId, 'account_number' => $accountNumber, 'type' => 'debit',
                'mode' => 'DEPOSIT_BOOKING', 'amount' => $terms['due_today'], 'balance_after' => $balance,
                'counterparty_name' => $terms['scheme_name'], 'counterparty_acc' => $depositNumber,
                'ref_number' => $depositNumber,
                'description' => "{$terms['scheme_name']} #$depositNumber booked", 'timestamp' => $step(2)]);
        }
        $deposit = ['deposit_number' => $depositNumber, 'maturity_date' => $maturityDate] + $terms;
        audit($opener, 'DEPOSIT_BOOKED', "$depositNumber {$terms['scheme_code']} "
            . rupees($terms['total_deposit']) . " for $accountNumber"
            . ($terms['exceeds_cap'] ? ' (above the 12.5% cap on its own printed figures)' : ''));
    }

    if ($lead !== null) {
        $pdo->prepare('UPDATE crm_leads SET stage = ?, converted_user_id = ?, referral_status = ? WHERE id = ?')
            ->execute(['enrolled', $userId,
                $lead['referral_code'] === null ? null : ($bonus === null ? 'not_paid' : 'paid'),
                $lead['id']]);
        // The scans follow the person. Left on the enquiry they would be
        // stranded behind a closed pipeline row, and the member would be asked
        // for the same documents again the first time anything needed them.
        $pdo->prepare('UPDATE kyc_documents SET lead_id = NULL, user_id = ? WHERE lead_id = ?')
            ->execute([$userId, $lead['id']]);
        // The enquiry keeps the plan whether or not a deposit was booked today,
        // so a member who is still deciding on an amount is not recorded as
        // having come in for nothing.
        if ($scheme === null && $lead['scheme_code'] !== null) {
            $scheme = row("SELECT * FROM schemes WHERE code = ? AND deleted_at IS NULL", [$lead['scheme_code']]);
        } elseif ($scheme !== null && $lead['scheme_code'] !== $scheme['code']) {
            $pdo->prepare('UPDATE crm_leads SET scheme_code = ? WHERE id = ?')
                ->execute([$scheme['code'], $lead['id']]);
        }
    }
    $plan = $scheme === null ? null : [
        'code' => $scheme['code'], 'name' => $scheme['name'],
        'scheme_type' => $scheme['scheme_type'], 'tenure_months' => (int)$scheme['tenure_months'],
        'payout_type' => $scheme['payout_type'],
    ];

    $user = row('SELECT * FROM users WHERE id = ?', [$userId]);
    audit($opener, 'ACCOUNT_OPENED', "$accountNumber for {$user['email']}"
        . ($lead === null ? '' : " from enquiry {$lead['id']}")
        . ($bonus === null ? '' : " · referral $code paid " . rupees($bonus)));
    $pdo->commit();

    // No session is started. The teller who opened the account must stay
    // themselves; handing them the new member's token would let a counter
    // action turn into acting as that member.
    // The account number is the member's user ID -- it is what route_login
    // accepts and what the counter reads out -- so it is named as such here
    // rather than left for the teller to explain.
    respond(['status' => 'SUCCESS', 'user' => public_user($user),
        'account_number' => $accountNumber, 'user_id' => $accountNumber,
        'referral_bonus' => $bonus, 'plan' => $plan === null ? null : out($plan),
        'deposit' => $deposit,
        'kyc_status' => $user['kyc_status'],
        'message' => "Account $accountNumber opened for {$user['name']}."
            . ($plan === null ? '' : " Plan: {$plan['name']}.")]);
}

// Public self-registration: no staff, no documents seen in person. A Nidhi
// still cannot enrol a *verified* member this way (route_register is the real
// enrolment, gated on KYC by staff), but there is nothing wrong with letting
// somebody create their own login and look around before that happens. What
// matters is that this account cannot move money until staff verify their
// KYC — see require_kyc_verified(), called from every route that can.
function route_self_register(array $d): void
{
    global $pdo;
    // Unauthenticated and public, so it is rate limited by address like the
    // enquiry form — otherwise it is free to flood the users table with junk.
    rate_limit('self-register:' . client_ip(), 5, 3600,
        'Too many sign-ups from this connection. Please try again later, or call us on 9105015464.');
    captcha_verify($d);

    need($d, 'name', 'phone', 'password');
    $name = clip($d['name'], 150);
    if (mb_strlen($name) < 2) {
        fail(422, 'Please enter your full name.');
    }
    $phone = clip($d['phone'], 30);
    $digits = preg_replace('/\D+/', '', $phone);
    if (!preg_match('/^(91)?[6-9]\d{9}$/', $digits)) {
        fail(422, 'Please enter a valid 10-digit Indian mobile number.');
    }
    $email = strtolower(clip($d['email'] ?? '', 150));
    if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        fail(422, 'That email address does not look right. Leave it blank if you have none.');
    }
    // Checked with what the applicant just typed, same rule route_register and
    // every password change use: length, not a breached password, and not just
    // their own name or email address.
    assert_password_acceptable($d['password'], [$name, $email === '' ? '' : strstr($email, '@', true)]);
    if ($email !== '' && row('SELECT id FROM users WHERE email = ?', [$email])) {
        fail(400, 'An account with this email already exists. Please sign in instead.');
    }
    if (row('SELECT id FROM users WHERE phone = ?', [$phone])) {
        fail(400, 'An account already exists for this phone number. Please sign in instead.');
    }

    $userId = uuid4();
    $accountNumber = 'AJSP0' . digits(9);
    $password = $d['password'];
    $transactionPassword = digits(6);

    $pdo->beginTransaction();
    $pdo->prepare('INSERT INTO users (id, name, email, phone, role, password_hash, transaction_password_hash,
            branch, kyc_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        ->execute([$userId, $name, $email === '' ? null : $email, $phone, 'retail',
            password_hash($password, PASSWORD_BCRYPT), password_hash($transactionPassword, PASSWORD_BCRYPT),
            'AJSP-MUM-042 (Nariman Point Main)', 'pending_approval']);
    // Zero balance, on purpose: no money moves onto this account until a
    // teller has seen this person's documents. See require_kyc_verified().
    $pdo->prepare('INSERT INTO accounts (id, user_id, account_number, account_type, account_name, balance, upi_id,
            branch, is_joint)
        VALUES (?, ?, ?, ?, ?, 0, ?, ?, 0)')
        ->execute([uuid4(), $userId, $accountNumber, 'savings', 'Savings Account',
            ($email === '' ? strtolower($accountNumber) : strstr($email, '@', true)) . '@ajspay',
            'AJSP-MUM-042 (Nariman Point Main)']);

    $user = row('SELECT * FROM users WHERE id = ?', [$userId]);
    audit($user, 'SELF_REGISTERED', "$accountNumber self-registered online, awaiting KYC verification");
    $pdo->commit();

    // Signed in immediately -- the account exists and the credentials are
    // real -- but require_kyc_verified() blocks every route that moves money
    // until a teller verifies this person's documents.
    respond(['status' => 'SUCCESS', 'user' => public_user($user),
        'account_number' => $accountNumber, 'user_id' => $accountNumber,
        // The login password was chosen by the applicant, so there is nothing
        // to hand back for it. The transaction password is ours, generated
        // just now, and this is the only time it is ever shown.
        'transaction_password' => $transactionPassword,
        'token' => start_session($user),
        'message' => "Account $accountNumber created. Visit a branch or complete Video KYC to start "
            . "depositing, transferring or applying for a loan."]);
}

function route_login(array $d): void
{
    captcha_verify($d);
    // The field has always said "Email / User ID" but only ever accepted an
    // email, so a member given an account number by their branch could not sign
    // in with it. Any of the three identifiers a member is actually given now
    // works: their email, their account number, or their folio on the member
    // register.
    $login = clip($d['email'] ?? $d['user_id'] ?? '', 150);
    $password = $d['password'] ?? null;
    if ($login === '' || !is_string($password) || $password === '') {
        fail(422, 'Your email or user ID and your password are both required.');
    }
    // Keyed on what was typed, so attempts against one identifier cannot be used
    // to lock a member out under another.
    $identifier = client_ip() . ':' . strtolower($login);
    $fails = recent_fails($identifier);
    if ($fails >= MAX_FAILS) {
        fail(429, 'Account temporarily locked due to 5 consecutive failed login attempts. Please try again in 15 minutes.');
    }
    $email = strtolower($login);
    $user = row('SELECT u.* FROM users u
        LEFT JOIN accounts a ON a.user_id = u.id
        LEFT JOIN member_register m ON m.user_id = u.id
        WHERE u.email = ? OR a.account_number = ? OR m.folio_no = ?
        LIMIT 1', [$email, $login, strtoupper($login)]);
    $valid = password_verify($password, $user['password_hash'] ?? DUMMY_HASH);
    if (!$user || !$valid) {
        record_fail($identifier, $email);
        $left = MAX_FAILS - 1 - $fails;
        fail(401, "Invalid login or password. $left attempt(s) remaining before security lockout.");
    }
    clear_fails($identifier);
    // The public member page and the staff/director page share this same route,
    // but a member typing their password into the staff door (or the reverse)
    // is not what either side is for -- send them to the door that matches the
    // account, rather than letting either page sign in anyone with any role.
    $portal = ($d['portal'] ?? 'member') === 'staff' ? 'staff' : 'member';
    $isInternal = in_array($user['role'], USER_ACCESS_ROLES, true);
    if ($portal === 'staff' && !$isInternal) {
        fail(403, 'This sign-in is for staff and directors. Please use the member login page.');
    }
    if ($portal === 'member' && $isInternal) {
        fail(403, 'This sign-in is for members. Staff and directors should use the corporate login page.');
    }
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
    [$txns, $meta] = paginate("$sql ORDER BY timestamp DESC, seq DESC, id", $params, 25, 200);
    respond(['transactions' => out_all($txns), 'pagination' => $meta]);
}

function route_transfer(array $d): void
{
    global $pdo;
    $user = current_user();
    require_kyc_verified($user);
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
    // A payee inside this institution is a book entry and settles now. A payee
    // outside it travels on a rail we do not own, and the partner — not us —
    // decides whether the money arrives, so that debit is held as PENDING until
    // they confirm. See modules/rails.php.
    $external = $receiver === null;
    $vpa = clip($d['beneficiary_vpa'] ?? '', 100);
    if ($external && ($limit = rail_limit_error($amount)) !== null) {
        $pdo->rollBack();
        fail(422, $limit);
    }
    $pdo->prepare('UPDATE accounts SET balance = balance - ? WHERE id = ?')->execute([$amount, $sender['id']]);
    insert_txn(['user_id' => $user['id'], 'account_number' => $from, 'type' => 'debit', 'mode' => $mode,
        'amount' => $amount, 'balance_after' => $newBalance, 'counterparty_name' => $beneficiary,
        'counterparty_acc' => $to, 'ref_number' => $ref, 'status' => $external ? 'PENDING' : 'SUCCESS',
        'description' => $remarks ?: "$mode to $beneficiary", 'timestamp' => $now]);
    $railId = $external ? rail_record([
        'direction' => 'payout', 'rail' => $mode, 'driver' => rail_config()['driver'], 'user_id' => $user['id'],
        'account_number' => $from, 'amount' => $amount, 'counterparty_name' => $beneficiary,
        'counterparty_acc' => $to, 'counterparty_ifsc' => clip($d['beneficiary_ifsc'] ?? '', 11) ?: null,
        'counterparty_vpa' => $vpa ?: null, 'ref_number' => $ref,
        'idempotency_key' => hash('sha256', "payout:$ref"),
        'request' => ['amount' => $amount, 'mode' => $mode],
    ]) : null;
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

    if (!$external) {
        respond(['status' => 'SUCCESS', 'message' => 'Successfully transferred ' . rupees($amount) . " via $mode",
            'ref_number' => $ref, 'new_balance' => $newBalance, 'timestamp' => iso($now)]);
    }

    // Deliberately after the commit: a call to the payment partner can take
    // seconds, and holding a lock on the member's account for that long would
    // stall every other transfer they attempt.
    $result = rail_payout(['amount' => $amount, 'rail' => $mode, 'ref_number' => $ref,
        'idempotency_key' => hash('sha256', "payout:$ref"), 'remarks' => $remarks,
        'counterparty_name' => $beneficiary, 'counterparty_acc' => $to, 'counterparty_vpa' => $vpa ?: null,
        'counterparty_ifsc' => clip($d['beneficiary_ifsc'] ?? '', 11) ?: null]);
    rail_update($railId, 'PENDING', ['partner_ref' => $result['partner_ref'] ?? null,
        'utr' => $result['utr'] ?? null, 'failure_reason' => $result['status'] === 'FAILED'
            ? $result['message'] : null], $result['raw'] ?? []);
    $railTxn = row('SELECT * FROM rail_transactions WHERE id = ?', [$railId]);
    if ($result['status'] !== 'PENDING') {
        rail_settle($railTxn, $result['status'], ['failure_reason' => $result['message'] ?? null],
            $result['raw'] ?? []);
    }
    if ($result['status'] === 'FAILED') {
        // rail_settle has already put the money back and recorded the reversal.
        audit($user, 'FUND_TRANSFER_FAILED', "$ref — " . $result['message']);
        // The partner's wording is theirs and may or may not end in a full stop;
        // ours has to read as one sentence either way.
        $reason = rtrim($result['message'], ' .') . '.';
        fail(502, "The transfer could not be sent: $reason "
            . rupees($amount) . ' has been returned to your account.');
    }
    respond([
        'status' => $result['status'],
        'message' => $result['status'] === 'SUCCESS'
            ? 'Successfully transferred ' . rupees($amount) . " via $mode"
                . (!empty($result['simulated']) ? ' (simulated — no money left this institution)' : '')
            : rupees($amount) . " sent via $mode. It is with the payment partner and your statement will "
                . 'show it as confirmed once they settle it.',
        'ref_number' => $ref, 'utr' => $result['utr'] ?? null, 'new_balance' => $newBalance,
        'timestamp' => iso($now), 'simulated' => $result['simulated'] ?? false,
    ]);
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
        $limitMax = card_limit_max();
        foreach (['online_limit', 'atm_limit'] as $key) {
            if (isset($d[$key])) {
                $updates[$key] = money($d[$key]);
                if ($updates[$key] < 0 || $updates[$key] > $limitMax) {
                    fail(422, "$key must be between ₹0 and " . rupees($limitMax) . '.');
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
    // Staff-only: crediting cash/cheque a member hands over at the counter
    // (modules/banking.php). Not to be confused with /collections, which only
    // logs what a field agent collected and never touches the ledger.
    'POST /accounts/counter-deposit' => 'route_counter_deposit',
    // Cards & UPI
    'GET /cards' => 'route_cards',
    'POST /cards/manage' => 'route_manage_card',
    'POST /cards/request-physical' => 'route_request_physical_card',
    'GET /upi/status' => 'route_upi_status',
    'POST /upi/link-card' => 'route_upi_link_card',
    'GET /upi/qr' => 'route_upi_qr',
    // Payment rails (modules/rails.php). The webhook is the partner's callback
    // and authenticates by signature, not by session, so it is deliberately not
    // behind the member login.
    'POST /rails/webhook' => 'route_rail_webhook',
    'POST /rails/collect' => 'route_rail_collect',
    'GET /rails/my-payments' => 'route_rail_my_pending',
    'GET /rails/config' => 'route_rail_config_get',
    'PUT /rails/config' => 'route_rail_config_set',
    'POST /rails/test' => 'route_rail_test',
    'GET /rails/transactions' => 'route_rail_transactions',
    'POST /rails/reconcile' => 'route_rail_reconcile_one',
    // Banking services (modules/banking.php)
    'POST /services/cheque-book' => 'route_cheque_book',
    'POST /services/stop-cheque' => 'route_stop_cheque',
    'POST /services/demand-draft' => 'route_demand_draft',
    'POST /deposits/book' => 'route_book_deposit',
    'POST /loans/apply' => 'route_apply_loan',
    'GET /loans/my-applications' => 'route_my_loans',
    'GET /investments/catalog' => 'route_investment_catalog',
    'POST /investments/invest' => 'route_invest',
    'POST /investments/insure' => 'route_insure',
    'GET /investments/my-portfolio' => 'route_portfolio',
    'POST /support/complaint' => 'route_complaint',
    'GET /support/my-tickets' => 'route_my_tickets',
    'POST /support/chat' => 'route_chat',
    'GET /branches/locator' => 'route_branches',
    // A member's own standing, and what the next rung would take.
    'GET /my-standing' => 'route_my_standing',
    'GET /referrals/my-code' => 'route_referral_code',
    'GET /referrals/history' => 'route_referral_history',
    'GET /referrals/structure' => 'route_referral_structure',
    'GET /referrals/tree' => 'route_referral_tree',
    'GET /rank-tiers' => 'route_rank_tiers',
    'POST /rank-tiers' => 'route_rank_tier_create',
    'GET /admin/automation' => 'route_automation_status',
    'GET /admin/recycle-bin' => 'route_recycle_bin',
    'POST /admin/recycle-bin/restore' => 'route_recycle_restore',
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
    'GET /admin/kyc-pending' => 'route_admin_kyc_pending',
    'POST /admin/kyc-action' => 'route_admin_kyc_action',
    // Approve KYC and, if a plan was picked, fund + book it in the same step
    // (modules/staff.php).
    'POST /admin/kyc-verify-and-fund' => 'route_kyc_verify_and_fund',
    'GET /admin/rbi-reports' => 'route_rbi_reports',
    'GET /admin/users' => 'route_admin_users',
    'POST /admin/users' => 'route_admin_user_create',
    'POST /admin/users/update' => 'route_admin_user_update',
    'POST /admin/users/password' => 'route_admin_user_password',
    'GET /admin/config' => 'route_admin_config_get',
    'PUT /admin/config' => 'route_admin_config_set',
    'POST /admin/config/test-sms' => 'route_delivery_test',
    'POST /auth/change-password' => 'route_change_password',
    'GET /auth/sessions' => 'route_sessions_list',
    'PATCH /profile/nominee' => 'route_nominee_update',
    'PATCH /profile/joint-holder' => 'route_joint_holder_update',
    'GET /kyc/documents' => 'route_kyc_documents_mine',
    'POST /kyc/documents' => 'route_kyc_document_upload',
    'GET /kyc/documents/queue' => 'route_kyc_documents_queue',
    'POST /kyc/video/submit' => 'route_kyc_submit',
    'GET /kyc/video/queue' => 'route_kyc_queue',
    'POST /kyc/video/decision' => 'route_kyc_decision',
    // Business parameters (modules/parameters.php) — back office only
    'GET /parameters' => 'route_parameters_list',
    'POST /parameters' => 'route_parameter_create',
    // Scheme master & field agents (modules/master.php) — back office only
    'GET /schemes' => 'route_schemes_list',
    'POST /schemes' => 'route_scheme_create',
    'GET /agents' => 'route_agents_list',
    'POST /agents' => 'route_agent_create',
    'GET /branches' => 'route_branches_list',
    'POST /branches' => 'route_branch_create',
    'GET /member-ranks' => 'route_member_ranks',
    'GET /products' => 'route_products_list',
    'POST /products' => 'route_product_create',
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
    'GET /public/market-rates' => 'route_public_market_rates',
    'GET /public/products' => 'route_public_products',
    'GET /public/captcha' => 'route_public_captcha',
    'POST /auth/forgot-password' => 'route_forgot_password',
    'POST /auth/reset-password' => 'route_reset_password',
    'POST /public/enquiry' => 'route_public_enquiry',
    'POST /register/self' => 'route_self_register',
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
    'POST /register/account' => 'route_register',
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
    ['PATCH', '#^/parameters/([\w-]{1,64})$#', 'route_parameter_update'],
    ['DELETE', '#^/parameters/([\w-]{1,64})$#', 'route_parameter_delete'],
    ['PATCH', '#^/agents/([\w-]{1,64})$#', 'route_agent_update'],
    ['DELETE', '#^/agents/([\w-]{1,64})$#', 'route_agent_delete'],
    ['DELETE', '#^/auth/sessions/([\w-]{1,64})$#', 'route_session_revoke'],
    ['PATCH', '#^/branches/([\w-]{1,64})$#', 'route_branch_update'],
    ['DELETE', '#^/branches/([\w-]{1,64})$#', 'route_branch_delete'],
    ['PATCH', '#^/products/([\w-]{1,64})$#', 'route_product_update'],
    ['DELETE', '#^/products/([\w-]{1,64})$#', 'route_product_delete'],
    ['GET', '#^/agents/([\w-]{1,64})/collections$#', 'route_collections_list'],
    ['GET', '#^/support/ticket/([\w-]{1,64})$#', 'route_ticket_detail'],
    ['POST', '#^/support/ticket/([\w-]{1,64})/reply$#', 'route_ticket_reply'],
    ['POST', '#^/support/ticket/([\w-]{1,64})/assign$#', 'route_ticket_assign'],
    ['POST', '#^/support/ticket/([\w-]{1,64})/status$#', 'route_ticket_status'],
    ['GET', '#^/register/folio/([\w@.-]{1,80})$#', 'route_register_folio'],
    ['POST', '#^/register/cease/([\w-]{1,64})$#', 'route_register_cease'],
    ['GET', '#^/crm/member/([\w@.-]{1,80})$#', 'route_crm_member'],
    ['PATCH', '#^/crm/leads/([\w-]{1,64})$#', 'route_crm_lead_update'],
    ['PATCH', '#^/rank-tiers/([\w-]{1,64})$#', 'route_rank_tier_update'],
    ['DELETE', '#^/rank-tiers/([\w-]{1,64})$#', 'route_rank_tier_delete'],
    ['GET', '#^/crm/leads/([\w-]{1,64})/documents$#', 'route_crm_lead_documents'],
    ['POST', '#^/crm/leads/([\w-]{1,64})/documents$#', 'route_crm_lead_document_upload'],
    ['POST', '#^/kyc/documents/([\w-]{1,64})/review$#', 'route_kyc_document_review'],
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
