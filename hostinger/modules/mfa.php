<?php
// AJSPay: time-based one-time passwords (RFC 6238) — the six-digit codes that
// Google Authenticator, Microsoft Authenticator, Authy and 1Password generate.
//
// Available to every role, member and staff alike. It costs nothing to run: the
// codes are derived from a shared secret and the clock, so there is no SMS bill
// and no third-party service in the loop.
//
// The secret is encrypted at rest with the same libsodium box used for the
// Twilio and SendGrid keys, and is shown to the member exactly once, at
// enrolment. We never send it to an external QR service — that would hand the
// second factor to someone else — so enrolment offers the setup key and an
// otpauth:// link, which every authenticator app accepts.
declare(strict_types=1);

const TOTP_DIGITS = 6;
const TOTP_PERIOD = 30;        // seconds per code
const TOTP_WINDOW = 1;         // accept one step either side, for clock drift
const TOTP_ISSUER = 'AJSPay';
const BACKUP_CODE_COUNT = 10;
const MFA_TOKEN_TTL = 300;     // the half-finished login is valid for 5 minutes

// --- base32, as the authenticator apps expect the key ---------------------------------
const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32_encode_bytes(string $bytes): string
{
    $bits = '';
    foreach (str_split($bytes) as $char) {
        $bits .= str_pad(decbin(ord($char)), 8, '0', STR_PAD_LEFT);
    }
    $out = '';
    foreach (str_split($bits, 5) as $chunk) {
        $out .= B32_ALPHABET[bindec(str_pad($chunk, 5, '0', STR_PAD_RIGHT))];
    }
    return $out;
}

function base32_decode_key(string $key): string
{
    $key = strtoupper(preg_replace('/[^A-Z2-7]/i', '', $key) ?? '');
    $bits = '';
    foreach (str_split($key) as $char) {
        $index = strpos(B32_ALPHABET, $char);
        if ($index === false) {
            return '';
        }
        $bits .= str_pad(decbin($index), 5, '0', STR_PAD_LEFT);
    }
    $bytes = '';
    foreach (str_split($bits, 8) as $chunk) {
        if (strlen($chunk) === 8) {
            $bytes .= chr(bindec($chunk));
        }
    }
    return $bytes;
}

// The HOTP truncation from RFC 4226, with the counter being the time step.
function totp_code(string $secret, int $step): string
{
    $hash = hash_hmac('sha1', pack('N*', 0, $step), $secret, true);
    $offset = ord($hash[19]) & 0x0f;
    $value = ((ord($hash[$offset]) & 0x7f) << 24) | ((ord($hash[$offset + 1]) & 0xff) << 16)
        | ((ord($hash[$offset + 2]) & 0xff) << 8) | (ord($hash[$offset + 3]) & 0xff);
    return str_pad((string)($value % (10 ** TOTP_DIGITS)), TOTP_DIGITS, '0', STR_PAD_LEFT);
}

// Constant-time comparison against the accepted window, so a wrong code reveals
// nothing through timing.
function totp_verify(string $secret, string $code): bool
{
    $code = preg_replace('/\D/', '', $code) ?? '';
    if (strlen($code) !== TOTP_DIGITS || $secret === '') {
        return false;
    }
    $step = intdiv(time(), TOTP_PERIOD);
    $ok = false;
    for ($i = -TOTP_WINDOW; $i <= TOTP_WINDOW; $i++) {
        $ok = hash_equals(totp_code($secret, $step + $i), $code) || $ok;
    }
    return $ok;
}

function totp_secret_for(array $user): string
{
    $stored = (string)($user['totp_secret'] ?? '');
    return $stored === '' ? '' : base32_decode_key(decrypt_secret($stored));
}

// --- Enrolment -------------------------------------------------------------------------
function route_totp_status(array $d): void
{
    $user = current_user();
    $codes = json_decode((string)($user['totp_backup_codes'] ?? ''), true);
    respond([
        'enabled' => (bool)($user['totp_enabled'] ?? false),
        'enrolled_at' => $user['totp_enrolled_at'] ? iso($user['totp_enrolled_at']) : null,
        'backup_codes_left' => is_array($codes) ? count($codes) : 0,
    ]);
}

// Hands back a fresh secret. Nothing is switched on until the member proves they
// can generate a code from it, so a failed enrolment cannot lock anyone out.
function route_totp_setup(array $d): void
{
    global $pdo;
    $user = current_user();
    need($d, 'password');
    if (!password_verify((string)$d['password'], $user['password_hash'])) {
        record_fail('totp-setup:' . $user['id'], $user['email']);
        security_event('MFA_SETUP_BAD_PASSWORD', 'warning', 'Wrong password during 2FA setup', $user);
        fail(401, 'Your password is not correct.');
    }
    if ($user['totp_enabled']) {
        fail(400, 'Two-factor authentication is already on. Turn it off first if you want a new key.');
    }
    $secretBytes = random_bytes(20);
    $key = base32_encode_bytes($secretBytes);
    $label = rawurlencode(TOTP_ISSUER . ':' . $user['email']);
    $uri = "otpauth://totp/$label?secret=$key&issuer=" . rawurlencode(TOTP_ISSUER)
        . '&algorithm=SHA1&digits=' . TOTP_DIGITS . '&period=' . TOTP_PERIOD;

    $pdo->prepare('UPDATE users SET totp_secret = ?, totp_enabled = 0 WHERE id = ?')
        ->execute([encrypt_secret($key), $user['id']]);
    audit($user, 'MFA_SETUP_STARTED', 'Authenticator key issued');
    // The key is returned exactly once, here.
    respond(['setup_key' => trim(chunk_split($key, 4, ' ')), 'otpauth_uri' => $uri,
        'issuer' => TOTP_ISSUER, 'account' => $user['email'],
        'message' => 'Add this key to your authenticator app, then enter the six-digit code it shows.']);
}

function route_totp_enable(array $d): void
{
    global $pdo;
    $user = current_user();
    need($d, 'code');
    $secret = totp_secret_for($user);
    if ($secret === '') {
        fail(400, 'Start the setup first.');
    }
    if ($user['totp_enabled']) {
        fail(400, 'Two-factor authentication is already on.');
    }
    if (recent_fails('totp:' . $user['id']) >= MAX_FAILS) {
        fail(429, 'Too many incorrect codes. Please wait 15 minutes.');
    }
    if (!totp_verify($secret, (string)$d['code'])) {
        record_fail('totp:' . $user['id'], $user['email']);
        fail(401, 'That code is not right. Check your phone clock is set automatically and try the current code.');
    }
    clear_fails('totp:' . $user['id']);

    // Single-use recovery codes, stored only as hashes.
    $plain = [];
    $hashed = [];
    for ($i = 0; $i < BACKUP_CODE_COUNT; $i++) {
        $code = strtoupper(bin2hex(random_bytes(4)));
        $plain[] = substr($code, 0, 4) . '-' . substr($code, 4);
        $hashed[] = password_hash(end($plain), PASSWORD_BCRYPT);
    }
    $pdo->prepare('UPDATE users SET totp_enabled = 1, totp_enrolled_at = ?, totp_backup_codes = ? WHERE id = ?')
        ->execute([now_utc(), json_encode($hashed), $user['id']]);
    audit($user, 'MFA_ENABLED', 'Authenticator app enabled');
    security_event('MFA_ENABLED', 'info', 'Two-factor authentication switched on', $user);
    respond(['status' => 'SUCCESS', 'message' => 'Two-factor authentication is on.',
        'backup_codes' => $plain,
        'note' => 'Save these recovery codes somewhere safe. Each one works once, if you lose your phone. '
            . 'They are not shown again.']);
}

function route_totp_disable(array $d): void
{
    global $pdo;
    $user = current_user();
    need($d, 'password', 'code');
    if (!password_verify((string)$d['password'], $user['password_hash'])) {
        security_event('MFA_DISABLE_BAD_PASSWORD', 'warning', 'Wrong password when turning 2FA off', $user);
        fail(401, 'Your password is not correct.');
    }
    // Turning protection off needs a live code too, so a stolen password alone
    // cannot strip the second factor.
    if (!mfa_code_valid($user, (string)$d['code'])) {
        security_event('MFA_DISABLE_BAD_CODE', 'warning', 'Wrong code when turning 2FA off', $user);
        fail(401, 'That code is not right.');
    }
    $pdo->prepare('UPDATE users SET totp_enabled = 0, totp_secret = NULL, totp_backup_codes = NULL,
        totp_enrolled_at = NULL WHERE id = ?')->execute([$user['id']]);
    audit($user, 'MFA_DISABLED', 'Authenticator app removed');
    security_event('MFA_DISABLED', 'warning', 'Two-factor authentication switched off', $user);
    respond(['status' => 'SUCCESS', 'message' => 'Two-factor authentication is off.']);
}

// Accepts either a live authenticator code or one unused recovery code, which is
// burnt on use.
function mfa_code_valid(array $user, string $code): bool
{
    global $pdo;
    if (totp_verify(totp_secret_for($user), $code)) {
        return true;
    }
    $hashes = json_decode((string)($user['totp_backup_codes'] ?? ''), true);
    if (!is_array($hashes)) {
        return false;
    }
    $candidate = strtoupper(trim($code));
    foreach ($hashes as $index => $hash) {
        if (password_verify($candidate, (string)$hash)) {
            unset($hashes[$index]);
            $pdo->prepare('UPDATE users SET totp_backup_codes = ? WHERE id = ?')
                ->execute([json_encode(array_values($hashes)), $user['id']]);
            audit($user, 'MFA_BACKUP_CODE_USED', count($hashes) . ' recovery codes left');
            security_event('MFA_BACKUP_CODE_USED', 'warning',
                count($hashes) . ' recovery codes remaining', $user);
            return true;
        }
    }
    return false;
}

// --- The second step of signing in -----------------------------------------------------
// A short-lived signed token stands in for the half-finished login. It is not a
// session: it carries no privileges and only this route accepts it.
function mfa_challenge_token(array $user): string
{
    $payload = b64url(json_encode(['sub' => $user['id'], 'stage' => 'mfa',
        'ver' => (int)$user['session_version'], 'exp' => time() + MFA_TOKEN_TTL]));
    return $payload . '.' . sign($payload);
}

function route_login_totp(array $d): void
{
    need($d, 'mfa_token', 'code');
    [$payload, $signature] = array_pad(explode('.', (string)$d['mfa_token'], 2), 2, '');
    if (!hash_equals(sign($payload), $signature)) {
        fail(401, 'This sign-in has expired. Please start again.');
    }
    $claims = json_decode(b64url_decode($payload), true);
    if (!is_array($claims) || ($claims['stage'] ?? '') !== 'mfa' || ($claims['exp'] ?? 0) < time()) {
        fail(401, 'This sign-in has expired. Please start again.');
    }
    $user = row('SELECT * FROM users WHERE id = ?', [(string)($claims['sub'] ?? '')]);
    if (!$user || (int)$user['session_version'] !== (int)($claims['ver'] ?? -1)) {
        fail(401, 'This sign-in is no longer valid. Please start again.');
    }
    $identifier = 'mfa-login:' . $user['id'];
    if (recent_fails($identifier) >= MAX_FAILS) {
        security_event('MFA_LOCKOUT', 'warning', 'Too many wrong codes at sign-in', $user);
        fail(429, 'Too many incorrect codes. Please wait 15 minutes.');
    }
    if (!mfa_code_valid($user, (string)$d['code'])) {
        record_fail($identifier, $user['email']);
        security_event('MFA_FAILED', 'warning', 'Wrong code at sign-in', $user);
        fail(401, 'That code is not right.');
    }
    clear_fails($identifier);
    audit($user, 'USER_LOGIN', 'Signed in with an authenticator code');
    respond(['token' => start_session($user), 'user' => public_user($user), 'features' => enabled_capabilities(),
        'message' => 'Login successful', 'mfa_verified' => true]);
}
