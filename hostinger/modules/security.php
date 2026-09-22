<?php
// AJSPay: OTP (demo mode, or live via Twilio SMS / SMTP email), passkeys (WebAuthn) and
// encryption of API keys kept in system_config. No third-party libraries: passkey
// signatures are verified with PHP's openssl extension directly.
declare(strict_types=1);

const OTP_MAX_ATTEMPTS = 5;   // wrong guesses per OTP before it is burned
const OTP_MAX_SENDS = 10;     // OTPs a user can request per 15 minutes
const OTP_PURPOSES = ['login', 'txn', 'pin_reset', 'high_value'];
// Issued to someone who is not signed in, so it is deliberately not in
// OTP_PURPOSES: route_otp_send must never mint one of these.
const OTP_PURPOSE_RESET = 'password_reset';
const SECRET_CONFIG_KEYS = ['twilio_account_sid', 'twilio_auth_token', 'sendgrid_api_key', 'smtp_password'];

// --- Runtime config (bank owner's System Config screen) ------------------------------
function system_config(): array
{
    $row = row("SELECT data FROM system_config WHERE id = 'global'");
    return $row ? (json_decode($row['data'], true) ?: []) : [];
}

// Merges keys into the stored runtime config, leaving the rest alone.
function save_system_config(array $changes, array $by): void
{
    global $pdo;
    $data = array_merge(system_config(), $changes);
    $pdo->prepare("INSERT INTO system_config (id, data, updated_by) VALUES ('global', ?, ?)
        ON DUPLICATE KEY UPDATE data = VALUES(data), updated_by = VALUES(updated_by)")
        ->execute([json_encode($data, JSON_UNESCAPED_UNICODE), $by['email']]);
}

function secret_key(): string
{
    global $config;
    return hash('sha256', 'ajspay-config:' . $config['token_secret'], true);
}

function encrypt_secret(string $plain): string
{
    $nonce = random_bytes(SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
    return 'enc:' . base64_encode($nonce . sodium_crypto_secretbox($plain, $nonce, secret_key()));
}

function decrypt_secret(string $stored): string
{
    $raw = base64_decode(substr($stored, 4), true) ?: '';
    if (!str_starts_with($stored, 'enc:') || strlen($raw) <= SODIUM_CRYPTO_SECRETBOX_NONCEBYTES) {
        return '';
    }
    $plain = sodium_crypto_secretbox_open(substr($raw, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES),
        substr($raw, 0, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES), secret_key());
    return $plain === false ? '' : $plain;
}

// Values saved by the bank owner win over config.local.php.
function delivery_config(): array
{
    global $config;
    $saved = system_config();
    $cfg = ['live_otp' => (bool)($saved['live_otp'] ?? $config['live_otp'])];
    foreach (['twilio_account_sid', 'twilio_auth_token', 'twilio_from_number', 'sendgrid_api_key',
        'sendgrid_from_email', 'smtp_host', 'smtp_port', 'smtp_user', 'smtp_password', 'support_email'] as $key) {
        $value = (string)($saved[$key] ?? '');
        if ($value !== '' && in_array($key, SECRET_CONFIG_KEYS, true)) {
            $value = decrypt_secret($value);
        }
        $cfg[$key] = $value !== '' ? $value : (string)$config[$key];
    }
    return $cfg;
}

// Whether a channel can actually deliver, rather than whether someone remembered
// to flip a switch. A live_otp left on with no credentials behind it fails
// silently at send time, which looks to a member like an OTP that never arrived.
function sms_configured(array $cfg): bool
{
    return $cfg['twilio_account_sid'] !== '' && $cfg['twilio_auth_token'] !== ''
        && $cfg['twilio_from_number'] !== '';
}

function email_configured(array $cfg): bool
{
    return $cfg['sendgrid_api_key'] !== '' || $cfg['smtp_host'] !== '';
}

// --- OTP ------------------------------------------------------------------------------
function otp_hash(string $otp): string
{
    global $config;
    return hash_hmac('sha256', $otp, $config['token_secret']);
}

function http_post(string $url, array $headers, string $body, ?string $basicAuth = null): string
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => $body, CURLOPT_HTTPHEADER => $headers,
        CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 10]);
    if ($basicAuth !== null) {
        curl_setopt($ch, CURLOPT_USERPWD, $basicAuth);
    }
    curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    if ($status >= 200 && $status < 300) {
        return 'sent';
    }
    error_log("AJSPay OTP delivery failed for $url: HTTP $status " . curl_error($ch));
    return 'failed';
}

function send_sms(array $cfg, string $to, string $text): string
{
    if ($cfg['twilio_account_sid'] === '' || $cfg['twilio_auth_token'] === '' || $cfg['twilio_from_number'] === '') {
        return 'not_configured';
    }
    return http_post('https://api.twilio.com/2010-04-01/Accounts/' . rawurlencode($cfg['twilio_account_sid']) . '/Messages.json',
        [], http_build_query(['To' => $to, 'From' => $cfg['twilio_from_number'], 'Body' => $text]),
        $cfg['twilio_account_sid'] . ':' . $cfg['twilio_auth_token']);
}

// Speaks enough SMTP to hand a message to Hostinger's mail server: implicit TLS on
// 465, STARTTLS on 587, AUTH LOGIN either way. PHP's mail() would be shorter but it
// reports nothing back, and an OTP that silently failed to send is the one failure
// mode a login screen cannot recover from.
function smtp_send(array $cfg, string $to, string $subject, string $html, string $replyTo): string
{
    $port = (int)$cfg['smtp_port'] ?: 465;
    $target = ($port === 465 ? 'ssl://' : 'tcp://') . $cfg['smtp_host'] . ':' . $port;
    $sock = @stream_socket_client($target, $errno, $errstr, 15);
    if (!$sock) {
        error_log("AJSPay SMTP: cannot reach $target ($errno $errstr)");
        return 'failed';
    }
    stream_set_timeout($sock, 15);

    // A reply can run to several lines; only the one with a space in the 4th column ends it.
    $read = static function () use ($sock): string {
        $reply = '';
        while (($line = fgets($sock, 1024)) !== false) {
            $reply .= $line;
            if (strlen($line) < 4 || $line[3] !== '-') {
                break;
            }
        }
        return $reply;
    };
    $failed = null;
    $say = static function (string $cmd, string $expect, string $label) use ($sock, $read, &$failed): bool {
        if ($failed !== null) {
            return false;
        }
        if ($cmd !== '') {
            fwrite($sock, $cmd . "\r\n");
        }
        $reply = $read();
        if (str_starts_with($reply, $expect)) {
            return true;
        }
        $failed = $label . ' -> ' . trim($reply);  // $label, never $cmd: AUTH lines carry the password
        return false;
    };

    $helo = 'EHLO ' . ($cfg['smtp_host'] !== '' ? $cfg['smtp_host'] : 'localhost');
    $say('', '220', 'greeting');
    $say($helo, '250', 'EHLO');
    if ($port !== 465) {
        $say('STARTTLS', '220', 'STARTTLS');
        if ($failed === null && !@stream_socket_enable_crypto($sock, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
            $failed = 'TLS handshake -> refused';
        }
        $say($helo, '250', 'EHLO (post-TLS)');
    }
    $say('AUTH LOGIN', '334', 'AUTH LOGIN');
    $say(base64_encode($cfg['smtp_user']), '334', 'AUTH username');
    $say(base64_encode($cfg['smtp_password']), '235', 'AUTH password');
    $say('MAIL FROM:<' . $cfg['smtp_user'] . '>', '250', 'MAIL FROM');
    $say('RCPT TO:<' . $to . '>', '250', 'RCPT TO');
    $say('DATA', '354', 'DATA');
    $say(smtp_message($cfg, $to, $subject, $html, $replyTo) . "\r\n.", '250', 'message body');
    if ($failed === null) {
        $say('QUIT', '221', 'QUIT');
    }
    fclose($sock);

    if ($failed !== null) {
        error_log('AJSPay SMTP: ' . $failed);
        return 'failed';
    }
    return 'sent';
}

function smtp_message(array $cfg, string $to, string $subject, string $html, string $replyTo): string
{
    $from = $cfg['smtp_user'];
    $headers = [
        'From: AJSPay <' . $from . '>',
        'To: <' . $to . '>',
        'Reply-To: <' . $replyTo . '>',
        'Subject: =?UTF-8?B?' . base64_encode($subject) . '?=',   // subjects carry non-ASCII
        'Date: ' . gmdate('D, d M Y H:i:s') . ' +0000',
        'Message-ID: <' . uuid4() . '@' . substr(strrchr($from, '@') ?: '@ajspay.in', 1) . '>',
        'MIME-Version: 1.0',
        'Content-Type: text/html; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
    ];
    // base64 sidesteps line-length limits and dot-stuffing in one go
    return implode("\r\n", $headers) . "\r\n\r\n" . chunk_split(base64_encode($html), 76, "\r\n");
}

// The domain's own mailbox is the primary route; SendGrid stays for anyone who would
// rather relay through an API. Replies go to the support mailbox either way, so a
// member who answers an OTP mail reaches a person instead of a send-only address.
function send_email(array $cfg, string $to, string $subject, string $html): string
{
    $replyTo = $cfg['support_email'] !== '' ? $cfg['support_email'] : $cfg['sendgrid_from_email'];
    if ($cfg['smtp_host'] !== '' && $cfg['smtp_user'] !== '' && $cfg['smtp_password'] !== '') {
        return smtp_send($cfg, $to, $subject, $html, $replyTo);
    }
    if ($cfg['sendgrid_api_key'] === '') {
        return 'not_configured';
    }
    return http_post('https://api.sendgrid.com/v3/mail/send',
        ['Authorization: Bearer ' . $cfg['sendgrid_api_key'], 'Content-Type: application/json'],
        json_encode(['personalizations' => [['to' => [['email' => $to]]]], 'from' => ['email' => $cfg['sendgrid_from_email']],
            'reply_to' => ['email' => $replyTo],
            'subject' => $subject, 'content' => [['type' => 'text/html', 'value' => $html]]]));
}

function route_otp_send(array $d): void
{
    global $pdo;
    $user = current_user();
    $channel = $d['channel'] ?? 'sms';
    if (!in_array($channel, ['sms', 'email', 'both'], true)) {
        $channel = 'sms';
    }
    $purpose = $d['purpose'] ?? 'login';
    if (!in_array($purpose, OTP_PURPOSES, true)) {
        fail(422, 'Unknown OTP purpose.');
    }
    $sendKey = 'otp-send:' . $user['id'];
    if (recent_fails($sendKey) >= OTP_MAX_SENDS) {
        fail(429, 'Too many OTP requests. Please wait 15 minutes.');
    }
    record_fail($sendKey, $user['email']);  // counts sends, to stop SMS/email flooding
    $otp = sprintf('%06d', random_int(0, 999999));
    $pdo->prepare('DELETE FROM otps WHERE user_id = ? AND purpose = ? AND verified = 0')->execute([$user['id'], $purpose]);
    $pdo->prepare('INSERT INTO otps (id, user_id, purpose, otp_hash, channel, expires_at)
        VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP() + INTERVAL 5 MINUTE)')
        ->execute([uuid4(), $user['id'], $purpose, otp_hash($otp), $channel]);

    $cfg = delivery_config();
    $delivery = ['sms' => 'MOCKED', 'email' => 'MOCKED'];
    if ($cfg['live_otp']) {
        $delivery = ['sms' => null, 'email' => null];
        // Each channel goes out only if it is both asked for and actually set
        // up. Reported as SKIPPED rather than left null, so a member support
        // call can tell "nothing was configured" from "we tried and it failed".
        if ($channel !== 'email') {
            $delivery['sms'] = sms_configured($cfg)
                ? send_sms($cfg, $user['phone'], "AJSPay OTP: $otp. Valid 5 min. Never share.")
                : 'SKIPPED_NOT_CONFIGURED';
        }
        if ($channel !== 'sms') {
            // A member may have no email at all: that is allowed at the counter,
            // and it must not turn into a failed send against an empty address.
            $delivery['email'] = empty($user['email'])
                ? 'SKIPPED_NO_ADDRESS'
                : (email_configured($cfg)
                    ? send_email($cfg, $user['email'], "AJSPay OTP — $purpose",
                        "<p>Your OTP is <b style='font-size:22px'>$otp</b>. Valid 5 min.</p><p>Never share this with anyone.</p>")
                    : 'SKIPPED_NOT_CONFIGURED');
        }
    }
    audit($user, 'OTP_SENT', "purpose=$purpose channel=$channel");
    $payload = ['status' => 'SUCCESS', 'message' => 'OTP sent to your registered ' . ($channel === 'sms' ? 'phone' : $channel) . '.',
        'channel' => $channel, 'expires_in_seconds' => 300, 'live_mode' => $cfg['live_otp'], 'delivery' => $delivery];
    if (!$cfg['live_otp']) {
        $payload['demo_otp'] = $otp;  // demo mode only; never returned once live OTP is switched on
    }
    respond($payload);
}

function route_otp_verify(array $d): void
{
    global $pdo;
    $user = current_user();
    need($d, 'purpose', 'otp');
    $purpose = clip($d['purpose'], 20);
    $otp = row('SELECT *, expires_at < UTC_TIMESTAMP() AS expired FROM otps
        WHERE user_id = ? AND purpose = ? AND verified = 0 ORDER BY created_at DESC LIMIT 1', [$user['id'], $purpose]);
    if (!$otp) {
        fail(400, 'No active OTP. Please request a new one.');
    }
    if ($otp['expired']) {
        fail(400, 'OTP expired. Please request a new one.');
    }
    if ((int)$otp['attempts'] >= OTP_MAX_ATTEMPTS) {
        fail(400, 'Too many wrong attempts. Please request a new OTP.');
    }
    if (!hash_equals($otp['otp_hash'], otp_hash(clip($d['otp'], 10)))) {
        $pdo->prepare('UPDATE otps SET attempts = attempts + 1 WHERE id = ?')->execute([$otp['id']]);
        fail(400, 'Invalid OTP.');
    }
    $pdo->prepare('UPDATE otps SET verified = 1, verified_at = UTC_TIMESTAMP() WHERE id = ?')->execute([$otp['id']]);
    respond(['status' => 'SUCCESS', 'message' => 'OTP verified.', 'purpose' => $purpose]);
}

// --- WebAuthn building blocks ----------------------------------------------------------
// Minimal CBOR decoder: definite-length items only, which is all authenticators send.
function cbor_decode(string $data, int &$pos): mixed
{
    if ($pos >= strlen($data)) {
        throw new RuntimeException('CBOR data ended early');
    }
    $initial = ord($data[$pos++]);
    [$major, $info] = [$initial >> 5, $initial & 0x1f];
    if ($info < 24) {
        $len = $info;
    } elseif ($info <= 27) {
        $size = 1 << ($info - 24);
        $chunk = substr($data, $pos, $size);
        if (strlen($chunk) !== $size) {
            throw new RuntimeException('CBOR length truncated');
        }
        $pos += $size;
        $len = 0;
        foreach (str_split($chunk) as $byte) {
            $len = ($len << 8) | ord($byte);
        }
    } else {
        throw new RuntimeException('Indefinite-length CBOR is not supported');
    }
    switch ($major) {
        case 0:
            return $len;
        case 1:
            return -1 - $len;
        case 2:
        case 3:
            $value = substr($data, $pos, $len);
            if (strlen($value) !== $len) {
                throw new RuntimeException('CBOR string truncated');
            }
            $pos += $len;
            return $value;
        case 4:
            $items = [];
            for ($i = 0; $i < $len; $i++) {
                $items[] = cbor_decode($data, $pos);
            }
            return $items;
        case 5:
            $map = [];
            for ($i = 0; $i < $len; $i++) {
                $key = cbor_decode($data, $pos);
                $map[$key] = cbor_decode($data, $pos);
            }
            return $map;
        case 7:
            return match ($info) {
                20 => false,
                21 => true,
                22 => null,
                default => throw new RuntimeException('Unsupported CBOR value'),
            };
        default:
            throw new RuntimeException('Unsupported CBOR type');
    }
}

function der(int $tag, string $body): string
{
    $n = strlen($body);
    $len = $n < 128 ? chr($n) : chr(0x80 | strlen(ltrim(pack('N', $n), "\0"))) . ltrim(pack('N', $n), "\0");
    return chr($tag) . $len . $body;
}

// COSE public key -> PEM. Only ES256 (P-256) and RS256 are offered at registration.
function cose_to_pem(mixed $cose): string
{
    if (!is_array($cose)) {
        throw new RuntimeException('Missing credential public key');
    }
    [$kty, $alg] = [$cose[1] ?? null, $cose[3] ?? null];
    if ($kty === 2 && $alg === -7 && ($cose[-1] ?? null) === 1 && strlen($cose[-2] ?? '') === 32
        && strlen($cose[-3] ?? '') === 32) {
        $spki = der(0x30, der(0x30, der(0x06, "\x2a\x86\x48\xce\x3d\x02\x01") . der(0x06, "\x2a\x86\x48\xce\x3d\x03\x01\x07"))
            . der(0x03, "\x00\x04" . $cose[-2] . $cose[-3]));
    } elseif ($kty === 3 && $alg === -257 && is_string($cose[-1] ?? null) && is_string($cose[-2] ?? null)) {
        $int = fn(string $b) => der(0x02, (ord($b[0]) & 0x80) ? "\x00" . $b : $b);
        $spki = der(0x30, der(0x30, der(0x06, "\x2a\x86\x48\x86\xf7\x0d\x01\x01\x01") . "\x05\x00")
            . der(0x03, "\x00" . der(0x30, $int($cose[-1]) . $int($cose[-2]))));
    } else {
        throw new RuntimeException('Unsupported passkey algorithm');
    }
    return "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode($spki), 64, "\n") . "-----END PUBLIC KEY-----\n";
}

function parse_auth_data(string $auth): array
{
    global $config;
    if (strlen($auth) < 37) {
        throw new RuntimeException('authenticatorData too short');
    }
    if (!hash_equals(hash('sha256', $config['webauthn_rp_id'], true), substr($auth, 0, 32))) {
        throw new RuntimeException('RP ID mismatch');
    }
    $flags = ord($auth[32]);
    if (!($flags & 0x01)) {
        throw new RuntimeException('User presence missing');
    }
    $parsed = ['flags' => $flags, 'sign_count' => unpack('N', substr($auth, 33, 4))[1]];
    if ($flags & 0x40) {  // attested credential data follows
        $idLen = strlen($auth) >= 55 ? unpack('n', substr($auth, 53, 2))[1] : -1;
        $parsed['credential_id'] = substr($auth, 55, max($idLen, 0));
        if ($idLen < 1 || strlen($parsed['credential_id']) !== $idLen) {
            throw new RuntimeException('Credential id truncated');
        }
        $pos = 55 + $idLen;
        $parsed['cose_key'] = cbor_decode($auth, $pos);
    }
    return $parsed;
}

function verify_client_data(mixed $clientDataB64, string $type, string $challenge): string
{
    global $config;
    $raw = b64url_decode(is_string($clientDataB64) ? $clientDataB64 : '');
    $data = json_decode($raw, true);
    if (!is_array($data) || ($data['type'] ?? '') !== $type) {
        throw new RuntimeException('Wrong ceremony type');
    }
    if (!hash_equals($challenge, (string)($data['challenge'] ?? ''))) {
        throw new RuntimeException('Challenge mismatch');
    }
    if (($data['origin'] ?? '') !== $config['webauthn_origin']) {
        throw new RuntimeException('Origin mismatch');
    }
    return $raw;
}

function store_challenge(string $userId, string $type): string
{
    global $pdo;
    $challenge = b64url(random_bytes(32));
    $pdo->prepare('REPLACE INTO passkey_challenges (user_id, type, challenge, created_at) VALUES (?, ?, ?, UTC_TIMESTAMP())')
        ->execute([$userId, $type, $challenge]);
    return $challenge;
}

// Challenges are single-use and expire after 5 minutes, so responses can't be replayed.
function take_challenge(string $userId, string $type): string
{
    global $pdo;
    $saved = row('SELECT challenge, created_at >= UTC_TIMESTAMP() - INTERVAL 5 MINUTE AS fresh FROM passkey_challenges
        WHERE user_id = ? AND type = ?', [$userId, $type]);
    $pdo->prepare('DELETE FROM passkey_challenges WHERE user_id = ? AND type = ?')->execute([$userId, $type]);
    if (!$saved || !$saved['fresh']) {
        fail(400, 'No active passkey request. Please try again.');
    }
    return $saved['challenge'];
}

// --- Passkey routes ------------------------------------------------------------------
function route_passkey_register_challenge(array $d): void
{
    global $config;
    $user = current_user();
    respond([
        'rp' => ['name' => $config['webauthn_rp_name'], 'id' => $config['webauthn_rp_id']],
        'user' => ['id' => b64url($user['id']), 'name' => $user['email'], 'displayName' => $user['name']],
        'challenge' => store_challenge($user['id'], 'register'),
        'pubKeyCredParams' => [['type' => 'public-key', 'alg' => -7], ['type' => 'public-key', 'alg' => -257]],
        'timeout' => 60000,
        'excludeCredentials' => array_map(fn($p) => ['id' => $p['credential_id'], 'type' => 'public-key'],
            rows('SELECT credential_id FROM passkeys WHERE user_id = ?', [$user['id']])),
        'authenticatorSelection' => ['residentKey' => 'preferred', 'requireResidentKey' => false, 'userVerification' => 'preferred'],
        'attestation' => 'none',
    ]);
}

function route_passkey_register_complete(array $d): void
{
    global $pdo;
    $user = current_user();
    $response = $d['credential']['response'] ?? null;
    if (!is_array($response)) {
        fail(422, 'Missing passkey credential.');
    }
    $challenge = take_challenge($user['id'], 'register');
    try {
        verify_client_data($response['clientDataJSON'] ?? '', 'webauthn.create', $challenge);
        $pos = 0;
        $attestation = cbor_decode(b64url_decode(is_string($response['attestationObject'] ?? null) ? $response['attestationObject'] : ''), $pos);
        $auth = parse_auth_data(is_array($attestation) && is_string($attestation['authData'] ?? null) ? $attestation['authData'] : '');
        if (!isset($auth['credential_id'])) {
            throw new RuntimeException('No credential in response');
        }
        $pem = cose_to_pem($auth['cose_key']);
        if (!openssl_pkey_get_public($pem)) {
            throw new RuntimeException('Invalid public key');
        }
    } catch (Throwable $e) {
        fail(400, 'Passkey verification failed: ' . $e->getMessage());
    }
    $credentialId = b64url($auth['credential_id']);
    if (row('SELECT id FROM passkeys WHERE credential_id = ?', [$credentialId])) {
        fail(400, 'This passkey is already registered.');
    }
    $label = clip($d['label'] ?? '', 100) ?: 'My Device';
    $pdo->prepare('INSERT INTO passkeys (id, user_id, credential_id, public_key, sign_count, label) VALUES (?, ?, ?, ?, ?, ?)')
        ->execute([uuid4(), $user['id'], $credentialId, $pem, $auth['sign_count'], $label]);
    audit($user, 'PASSKEY_REGISTERED', $label);
    respond(['status' => 'SUCCESS', 'message' => "Passkey '$label' registered."]);
}

function route_passkey_login_challenge(array $d): void
{
    global $config;
    $email = strtolower(clip($d['email'] ?? '', 150));
    $user = filter_var($email, FILTER_VALIDATE_EMAIL) ? row('SELECT id FROM users WHERE email = ?', [$email]) : null;
    $creds = $user ? rows('SELECT credential_id FROM passkeys WHERE user_id = ?', [$user['id']]) : [];
    // One answer for "unknown email" and "no passkey", so this can't be used to probe for customers.
    if (!$creds) {
        fail(400, 'No passkey registered for this account.');
    }
    respond(['challenge' => store_challenge($user['id'], 'login'), 'timeout' => 60000, 'rpId' => $config['webauthn_rp_id'],
        'allowCredentials' => array_map(fn($c) => ['id' => $c['credential_id'], 'type' => 'public-key'], $creds),
        'userVerification' => 'preferred']);
}

function route_passkey_login_complete(array $d): void
{
    global $pdo;
    $email = strtolower(clip($d['email'] ?? '', 150));
    $user = filter_var($email, FILTER_VALIDATE_EMAIL) ? row('SELECT * FROM users WHERE email = ?', [$email]) : null;
    $credential = $d['credential'] ?? null;
    if (!$user || !is_array($credential) || !is_array($credential['response'] ?? null)) {
        fail(400, 'Passkey sign-in failed.');
    }
    $challenge = take_challenge($user['id'], 'login');
    $rawId = $credential['rawId'] ?? $credential['id'] ?? '';
    $stored = row('SELECT * FROM passkeys WHERE user_id = ? AND credential_id = ?',
        [$user['id'], b64url(b64url_decode(is_string($rawId) ? $rawId : ''))]);
    if (!$stored) {
        fail(400, 'Unknown passkey');
    }
    $r = $credential['response'];
    try {
        $clientData = verify_client_data($r['clientDataJSON'] ?? '', 'webauthn.get', $challenge);
        $authRaw = b64url_decode(is_string($r['authenticatorData'] ?? null) ? $r['authenticatorData'] : '');
        $auth = parse_auth_data($authRaw);
        $signature = b64url_decode(is_string($r['signature'] ?? null) ? $r['signature'] : '');
        if (openssl_verify($authRaw . hash('sha256', $clientData, true), $signature, $stored['public_key'],
            OPENSSL_ALGO_SHA256) !== 1) {
            throw new RuntimeException('Signature check failed');
        }
        // A counter that doesn't advance means the authenticator may have been cloned.
        if (($auth['sign_count'] || $stored['sign_count']) && $auth['sign_count'] <= (int)$stored['sign_count']) {
            throw new RuntimeException('Sign counter did not increase');
        }
    } catch (Throwable $e) {
        fail(400, 'Passkey auth failed: ' . $e->getMessage());
    }
    $pdo->prepare('UPDATE passkeys SET sign_count = ? WHERE id = ?')->execute([$auth['sign_count'], $stored['id']]);
    audit($user, 'PASSKEY_LOGIN', 'Passkey (WebAuthn) login');
    respond(['token' => start_session($user), 'user' => public_user($user), 'message' => 'Passkey login successful',
        'mfa_verified' => true]);
}

function route_passkey_list(array $d): void
{
    global $config;
    $user = current_user();
    respond(['passkeys' => out_all(rows('SELECT id, credential_id, sign_count, label, created_at FROM passkeys
            WHERE user_id = ? ORDER BY created_at', [$user['id']])),
        'rp_id' => $config['webauthn_rp_id'], 'rp_name' => $config['webauthn_rp_name']]);
}

function route_passkey_delete(array $d, string $id = ''): void
{
    global $pdo;
    $user = current_user();
    $passkey = row('SELECT label FROM passkeys WHERE id = ? AND user_id = ?', [$id, $user['id']]);
    if (!$passkey) {
        fail(404, 'Passkey not found');
    }
    $pdo->prepare('DELETE FROM passkeys WHERE id = ? AND user_id = ?')->execute([$id, $user['id']]);
    audit($user, 'PASSKEY_REMOVED', $passkey['label']);
    respond(['status' => 'SUCCESS', 'message' => 'Passkey removed']);
}

// --- Password recovery -----------------------------------------------------------------
// The only flow here that runs for someone who is not signed in, which shapes all of it:
// the reply cannot reveal whether an account exists, the code goes only to the contact
// already on file, and a successful reset ends every session that was already open.
function route_forgot_password(array $d): void
{
    global $pdo;
    $email = strtolower(clip($d['email'] ?? '', 150));
    // Bounded by address and by the address being asked about, so neither the
    // mail provider nor one member's inbox can be used as a weapon.
    rate_limit('forgot:' . client_ip(), 8, 3600, 'Too many requests. Please try again later.');
    if ($email !== '') {
        rate_limit('forgot-acct:' . $email, 4, 3600, 'Too many requests. Please try again later.');
    }

    // Always the same answer, whatever was typed. A different reply for a known
    // address would turn this form into a way of testing who banks here.
    $reply = ['status' => 'SUCCESS', 'message' =>
        'If that email is registered, a 6-digit code is on its way. It expires in 5 minutes.'];

    $user = $email === '' ? null : row('SELECT * FROM users WHERE email = ?', [$email]);
    if (!$user) {
        respond($reply);
    }

    $otp = sprintf('%06d', random_int(0, 999999));
    $pdo->prepare('DELETE FROM otps WHERE user_id = ? AND purpose = ? AND verified = 0')
        ->execute([$user['id'], OTP_PURPOSE_RESET]);
    $pdo->prepare('INSERT INTO otps (id, user_id, purpose, otp_hash, channel, expires_at)
        VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP() + INTERVAL 5 MINUTE)')
        ->execute([uuid4(), $user['id'], OTP_PURPOSE_RESET, otp_hash($otp), 'email']);

    $cfg = delivery_config();
    if ($cfg['live_otp']) {
        send_email($cfg, $user['email'], 'Your AJSPay password reset code',
            '<p>Your password reset code is <b>' . $otp . '</b>. It expires in 5 minutes.</p>'
            . '<p>If you did not ask for this, ignore this email and your password stays as it is.</p>');
    }
    security_event('PASSWORD_RESET_REQUESTED', 'warning', "Reset code issued for {$user['email']}", $user);
    respond($reply);
}

function route_reset_password(array $d): void
{
    global $pdo;
    rate_limit('reset:' . client_ip(), 10, 3600, 'Too many attempts. Please try again later.');
    $email = strtolower(clip($d['email'] ?? '', 150));
    $code = clip($d['otp'] ?? '', 6);
    $new = $d['new_password'] ?? null;


    // Checked before the account is looked up, and using only what the caller
    // typed. Doing it after would mean a weak password answered differently for
    // a registered address than an unregistered one, which is exactly the
    // enumeration this flow is built to avoid.
    assert_password_acceptable($new, [strstr($email, '@', true)]);

    $user = $email === '' ? null : row('SELECT * FROM users WHERE email = ?', [$email]);
    // One wording for every failure, so a wrong address and a wrong code are
    // indistinguishable from outside.
    $wrong = 'That code is not valid or has expired. Please request a new one.';
    if (!$user) {
        fail(400, $wrong);
    }

    $otp = row('SELECT *, expires_at < UTC_TIMESTAMP() AS expired FROM otps
        WHERE user_id = ? AND purpose = ? AND verified = 0 ORDER BY created_at DESC LIMIT 1',
        [$user['id'], OTP_PURPOSE_RESET]);
    if (!$otp || (int)$otp['expired'] === 1 || (int)$otp['attempts'] >= OTP_MAX_ATTEMPTS) {
        fail(400, $wrong);
    }
    if (!hash_equals($otp['otp_hash'], otp_hash($code))) {
        $pdo->prepare('UPDATE otps SET attempts = attempts + 1 WHERE id = ?')->execute([$otp['id']]);
        fail(400, $wrong);
    }

    $pdo->beginTransaction();
    $pdo->prepare('UPDATE otps SET verified = 1, verified_at = UTC_TIMESTAMP() WHERE id = ?')->execute([$otp['id']]);
    // Bumping session_version is the point: whoever forced the member to reset,
    // or was already riding a stolen session, is signed out by this.
    $pdo->prepare('UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ?')
        ->execute([password_hash($new, PASSWORD_BCRYPT), $user['id']]);
    $pdo->commit();

    audit($user, 'PASSWORD_RESET', 'Password reset by emailed code');
    security_event('PASSWORD_RESET', 'warning', "Password reset for {$user['email']}; all sessions ended", $user);
    respond(['status' => 'SUCCESS',
        'message' => 'Your password has been changed and every signed-in device has been logged out.']);
}

// --- Password strength -----------------------------------------------------------------
// Length alone lets through the passwords that are actually used to break into
// accounts: the ones already published in breach corpora. This checks against Have I
// Been Pwned's range API, which is built so the password never leaves this server.
//
// Only the first five characters of the SHA-1 are sent. The API answers with every
// suffix it holds under that prefix — tens of thousands of them — and the comparison
// happens here. The service cannot tell which of those, if any, was being asked about,
// and never sees the password or its full hash.
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 72;   // bcrypt truncates beyond this

function password_is_breached(string $password): ?bool
{
    $sha1 = strtoupper(sha1($password));
    $prefix = substr($sha1, 0, 5);
    $suffix = substr($sha1, 5);

    $ch = curl_init("https://api.pwnedpasswords.com/range/$prefix");
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 4,
        CURLOPT_CONNECTTIMEOUT => 3,
        CURLOPT_HTTPHEADER => ['Add-Padding: true'],   // uniform response size
        CURLOPT_USERAGENT => 'AJSPay-PasswordCheck',
    ]);
    $body = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);

    // null means "could not tell". The caller decides what to do with that, and
    // the decision is to let the password through: a member locked out of
    // resetting because a third party is down is a worse outcome than a weak
    // password that still has to clear every other control.
    if ($status !== 200 || !is_string($body)) {
        return null;
    }
    foreach (explode("\n", $body) as $line) {
        [$candidate] = explode(':', trim($line), 2);
        if (hash_equals($suffix, strtoupper($candidate))) {
            return true;
        }
    }
    return false;
}

// Applied wherever a login password is set. $context is whatever the member has
// already given away — their name and email — so a password that simply repeats
// it is refused before it is ever hashed.
function assert_password_acceptable(mixed $password, array $context = []): void
{
    if (!is_string($password) || strlen($password) < PASSWORD_MIN || strlen($password) > PASSWORD_MAX) {
        fail(422, 'Your password must be between ' . PASSWORD_MIN . ' and ' . PASSWORD_MAX . ' characters.');
    }
    $lower = strtolower($password);
    foreach ($context as $hint) {
        $hint = strtolower(trim((string)$hint));
        if ($hint !== '' && strlen($hint) >= 4 && str_contains($lower, $hint)) {
            fail(422, 'Please choose a password that does not contain your name or email address.');
        }
    }
    if (password_is_breached($password) === true) {
        fail(422, 'That password appears in a known data breach. Please choose a different one — '
            . 'it is not about this account, but attackers try published passwords first.');
    }
}

// --- Delivery self-test ----------------------------------------------------------------
// "Failed" tells an operator nothing they can act on. This reports what the provider
// actually said, so a trial account refusing an unverified number reads as exactly that
// rather than as a broken configuration.
function twilio_probe(array $cfg, string $to): array
{
    if (!sms_configured($cfg)) {
        return ['ok' => false, 'reason' => 'Twilio is not set up yet. Enter the Account SID, Auth Token and From number above, and save.'];
    }
    $ch = curl_init('https://api.twilio.com/2010-04-01/Accounts/' . rawurlencode($cfg['twilio_account_sid']) . '/Messages.json');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => http_build_query([
            'To' => $to,
            'From' => $cfg['twilio_from_number'],
            'Body' => 'AJSPay test message. If you received this, SMS delivery is working.',
        ]),
        CURLOPT_USERPWD => $cfg['twilio_account_sid'] . ':' . $cfg['twilio_auth_token'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 12,
    ]);
    $body = (string)curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $network = curl_error($ch);

    if ($status === 0) {
        return ['ok' => false, 'reason' => 'Could not reach Twilio: ' . ($network ?: 'no response')];
    }
    $decoded = json_decode($body, true);
    if ($status >= 200 && $status < 300) {
        return ['ok' => true, 'reason' => 'Twilio accepted the message. It should arrive shortly.',
            'provider_status' => $decoded['status'] ?? null];
    }
    // Twilio's own wording, which names the actual problem — an unverified number
    // on a trial account, a wrong token, a From number that is not yours.
    $detail = is_array($decoded) ? ($decoded['message'] ?? '') : '';
    $code = is_array($decoded) ? ($decoded['code'] ?? null) : null;
    return ['ok' => false,
        'reason' => $detail !== '' ? $detail : "Twilio refused the request (HTTP $status).",
        'provider_code' => $code];
}

function route_delivery_test(array $d): void
{
    $staff = staff_user(['bank_owner']);
    // A send costs money and reaches a real handset, so it is bounded.
    rate_limit('delivery-test:' . $staff['id'], 10, 3600,
        'Too many test messages. Please wait before trying again.');

    $to = clip($d['to'] ?? '', 20);
    $digits = preg_replace('/\D+/', '', $to);
    if (!preg_match('/^(91)?[6-9]\d{9}$/', $digits)) {
        fail(422, 'Enter a 10-digit Indian mobile number to send the test to.');
    }
    $e164 = '+91' . substr($digits, -10);

    $cfg = delivery_config();
    $result = twilio_probe($cfg, $e164);
    // Recorded because it is a real message to a real number, chargeable, sent
    // by a named person.
    audit($staff, 'DELIVERY_TEST', "SMS to $e164 — " . ($result['ok'] ? 'accepted' : 'refused'));

    respond([
        'ok' => $result['ok'],
        'sent_to' => $e164,
        'reason' => $result['reason'],
        'provider_code' => $result['provider_code'] ?? null,
        'live_otp' => (bool)$cfg['live_otp'],
        // What is configured, never the values themselves.
        'sms_configured' => sms_configured($cfg),
        'email_configured' => email_configured($cfg),
    ]);
}
