<?php
// AJSPay: active defence and self-audit.
//
// Three jobs:
//   1. Rate limiting on every request, tighter on the routes worth attacking
//   2. A security event log the bank owner can actually read
//   3. A self-audit that inspects the live deployment and reports what is wrong,
//      plus a file-integrity seal so tampering with the PHP shows up
//
// Everything here runs against our own server and database. Nothing calls out.
declare(strict_types=1);

const SECURITY_ROLES = ['bank_owner'];
const SECURITY_READ_ROLES = ['bank_owner', 'admin'];

// Per-IP request budgets: [max requests, window in seconds]. The global budget
// is generous enough that a normal member never meets it; the specific ones are
// tight enough that guessing is hopeless. Login and OTP already have their own
// per-account lockouts — these stop the same attacker cycling many accounts.
const RATE_GLOBAL = [600, 300];
const RATE_ROUTES = [
    'POST /auth/login' => [30, 300],
    'POST /auth/register' => [10, 3600],
    'POST /auth/login/totp' => [20, 900],
    'POST /totp/enable' => [20, 900],
    'POST /totp/disable' => [10, 900],
    'POST /otp/send' => [15, 3600],
    'POST /otp/verify' => [25, 900],
    'POST /auth/verify-transaction-pin' => [25, 900],
    'POST /accounts/transfer' => [60, 300],
    'POST /accounts/bulk-transfer' => [10, 300],
    'POST /passkey/login/complete' => [30, 900],
    'POST /support/chat' => [60, 300],
];

// Events worth keeping. Anything not listed is still accepted, but these are the
// ones the audit screen groups and counts.
const SECURITY_SEVERITIES = ['info', 'warning', 'critical'];

function security_event(string $type, string $severity, string $details, ?array $user = null): void
{
    global $pdo;
    if (!in_array($severity, SECURITY_SEVERITIES, true)) {
        $severity = 'info';
    }
    try {
        $pdo->prepare('INSERT INTO security_events (event_type, severity, user_id, email, ip, route, details)
            VALUES (?, ?, ?, ?, ?, ?, ?)')->execute([
                mb_substr($type, 0, 40), $severity, $user['id'] ?? null, $user['email'] ?? null, client_ip(),
                mb_substr((string)($_SERVER['REQUEST_METHOD'] ?? '') . ' '
                    . parse_url((string)($_SERVER['REQUEST_URI'] ?? ''), PHP_URL_PATH), 0, 120),
                mb_substr($details, 0, 255),
            ]);
    } catch (Throwable $e) {
        // Logging a security event must never break the request it describes.
        error_log('AJSPay security_event failed: ' . $e);
    }
}

// Counts hits in a rolling window and refuses once the budget is spent. Reuses
// the login_attempts table, which already carries an (identifier, created_at)
// index built for exactly this shape of query.
function rate_limit(string $key, int $max, int $window, string $message): void
{
    global $pdo;
    $identifier = mb_substr($key, 0, 191);
    $hits = (int)scalar('SELECT COUNT(*) FROM login_attempts WHERE identifier = ?
        AND created_at >= DATE_SUB(?, INTERVAL ? SECOND)', [$identifier, now_utc(), $window]);
    if ($hits >= $max) {
        security_event('RATE_LIMITED', 'warning', "$identifier exceeded $max in {$window}s");
        header('Retry-After: ' . $window);
        fail(429, $message);
    }
    $pdo->prepare('INSERT INTO login_attempts (identifier, email, ip) VALUES (?, ?, ?)')
        ->execute([$identifier, '', client_ip()]);
}

// Called by the dispatcher before any handler runs.
function guard_request(string $method, string $route): void
{
    $ip = client_ip();
    [$max, $window] = RATE_GLOBAL;
    rate_limit("rl:all:$ip", $max, $window, 'Too many requests. Please slow down and try again shortly.');

    $key = "$method $route";
    if (isset(RATE_ROUTES[$key])) {
        [$max, $window] = RATE_ROUTES[$key];
        rate_limit("rl:$key:$ip", $max, $window,
            'Too many attempts on this action. Please wait a few minutes and try again.');
    }
}

// --- Security event log ---------------------------------------------------------------
function route_security_events(array $d): void
{
    staff_user(SECURITY_READ_ROLES);
    $severity = in_array($d['severity'] ?? '', SECURITY_SEVERITIES, true) ? $d['severity'] : null;
    [$events, $meta] = $severity === null
        ? paginate('SELECT * FROM security_events ORDER BY created_at DESC', [], 50, 200)
        : paginate('SELECT * FROM security_events WHERE severity = ? ORDER BY created_at DESC', [$severity], 50, 200);
    respond([
        'pagination' => $meta,
        'events' => array_map(fn($e) => ['id' => (int)$e['id'], 'event_type' => $e['event_type'],
            'severity' => $e['severity'], 'email' => $e['email'], 'ip' => $e['ip'], 'route' => $e['route'],
            'details' => $e['details'], 'created_at' => iso($e['created_at'])], $events),
        'counts' => [
            'critical_24h' => (int)scalar("SELECT COUNT(*) FROM security_events WHERE severity = 'critical'
                AND created_at >= DATE_SUB(?, INTERVAL 1 DAY)", [now_utc()]),
            'warning_24h' => (int)scalar("SELECT COUNT(*) FROM security_events WHERE severity = 'warning'
                AND created_at >= DATE_SUB(?, INTERVAL 1 DAY)", [now_utc()]),
            'total' => (int)scalar('SELECT COUNT(*) FROM security_events'),
        ],
        'top_ips' => rows("SELECT ip, COUNT(*) AS hits FROM security_events
            WHERE severity <> 'info' AND created_at >= DATE_SUB(?, INTERVAL 7 DAY)
            GROUP BY ip ORDER BY hits DESC LIMIT 10", [now_utc()]),
    ]);
}

// --- File integrity --------------------------------------------------------------------
// Hashes the PHP that actually runs the site. Seal it after a deploy; if a file
// changes afterwards without another deploy, the check says which one.
function integrity_files(): array
{
    $root = dirname(__DIR__);
    $files = array_merge(
        [$root . '/api.php', $root . '/db.php', $root . '/cron.php', $root . '/.htaccess'],
        glob($root . '/modules/*.php') ?: []
    );
    $manifest = [];
    foreach ($files as $path) {
        if (is_file($path)) {
            $manifest[str_replace($root . '/', '', $path)] = hash_file('sha256', $path);
        }
    }
    ksort($manifest);
    return $manifest;
}

function route_integrity_seal(array $d): void
{
    $owner = staff_user(SECURITY_ROLES);
    $manifest = integrity_files();
    save_system_config(['integrity_manifest' => $manifest, 'integrity_sealed_at' => now_utc()], $owner);
    audit($owner, 'INTEGRITY_SEALED', count($manifest) . ' files');
    security_event('INTEGRITY_SEALED', 'info', count($manifest) . ' files sealed', $owner);
    respond(['status' => 'SUCCESS', 'message' => 'Sealed ' . count($manifest) . ' files.',
        'sealed_at' => iso(now_utc()), 'file_count' => count($manifest)]);
}

function integrity_report(): array
{
    $config = system_config();
    $sealed = $config['integrity_manifest'] ?? null;
    $current = integrity_files();
    if (!is_array($sealed) || $sealed === []) {
        return ['sealed' => false, 'message' => 'No seal recorded yet. Seal the files after a deploy so later '
            . 'changes are visible.', 'changed' => [], 'added' => [], 'removed' => [],
            'file_count' => count($current)];
    }
    $changed = [];
    foreach ($sealed as $file => $hash) {
        if (isset($current[$file]) && !hash_equals((string)$hash, $current[$file])) {
            $changed[] = $file;
        }
    }
    return [
        'sealed' => true,
        'sealed_at' => isset($config['integrity_sealed_at']) ? iso((string)$config['integrity_sealed_at']) : null,
        'changed' => $changed,
        'added' => array_values(array_diff(array_keys($current), array_keys($sealed))),
        'removed' => array_values(array_diff(array_keys($sealed), array_keys($current))),
        'file_count' => count($current),
    ];
}

// --- Self-audit --------------------------------------------------------------------------
// Inspects the running deployment rather than the source, so it catches the
// things that actually go wrong on a live host: a forgotten demo password, a
// cookie still not marked Secure, a database user that can drop tables.
function route_security_audit(array $d): void
{
    global $config, $pdo;
    $owner = staff_user(SECURITY_READ_ROLES);
    $checks = [];
    $check = function (string $area, string $name, bool $ok, string $detail, string $severity = 'high')
        use (&$checks): void {
        $checks[] = ['area' => $area, 'name' => $name, 'status' => $ok ? 'pass' : 'fail',
            'severity' => $ok ? 'none' : $severity, 'detail' => $detail];
    };

    // Secrets and sessions
    $secret = (string)($config['token_secret'] ?? '');
    $check('Secrets', 'Session signing key', strlen($secret) >= 64,
        strlen($secret) >= 64 ? 'Key is ' . strlen($secret) . ' characters.'
            : 'Key is only ' . strlen($secret) . ' characters. Generate 64 hex characters with '
            . 'php -r "echo bin2hex(random_bytes(32));" and put it in config.local.php.');
    $check('Secrets', 'Key is not a placeholder',
        !in_array(strtolower($secret), ['changeme', 'secret', 'test', 'password'], true) && $secret !== '',
        'The signing key must be random, not a word.');
    $check('Sessions', 'Cookies marked Secure', (bool)($config['cookie_secure'] ?? false),
        ($config['cookie_secure'] ?? false) ? 'Session cookie is Secure and HttpOnly.'
            : 'cookie_secure is false. Set it to true on a live HTTPS site, or the session cookie can travel '
            . 'over plain HTTP.');
    $check('Sessions', 'Session lifetime', (int)($config['token_ttl'] ?? 1800) <= 3600,
        'Sessions expire after ' . (int)($config['token_ttl'] ?? 1800) . ' seconds.', 'medium');

    // Transport and origins
    $https = ($_SERVER['HTTPS'] ?? '') !== '' || ($_SERVER['SERVER_PORT'] ?? '') === '443'
        || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
    $check('Transport', 'Served over HTTPS', $https,
        $https ? 'This request arrived over HTTPS.' : 'This request was not HTTPS. Turn on the free SSL '
            . 'certificate in hPanel; .htaccess already redirects once it exists.');
    $origins = (array)($config['allowed_origins'] ?? []);
    $check('Transport', 'CORS origins are explicit',
        $origins !== [] && !in_array('*', $origins, true),
        $origins === [] ? 'No allowed_origins set.' : 'Allowed: ' . implode(', ', $origins));
    $check('Transport', 'Proxy headers not trusted blindly',
        !($config['trust_proxy'] ?? false) || $https,
        'trust_proxy should stay false unless the site sits behind a proxy you control.', 'medium');

    // Error handling
    $check('Errors', 'Errors hidden from visitors', ini_get('display_errors') === '0'
        || strtolower((string)ini_get('display_errors')) === 'off',
        'display_errors is ' . var_export(ini_get('display_errors'), true)
        . '. Stack traces must never reach a visitor.');

    // Demo credentials — the single most common way a deployment like this is
    // taken over, so it is checked against the live password hashes.
    $demoPasswords = ['owner@ajspay.in' => 'Owner@123', 'manager@ajspay.in' => 'Admin@123',
        'meera.staff@ajspay.in' => 'Staff@123', 'rahul.sharma@example.com' => 'Banking@123',
        'collections@ajspay.in' => 'Collect@123', 'loans@ajspay.in' => 'Loan@123'];
    $stillDefault = [];
    foreach ($demoPasswords as $email => $password) {
        $hash = scalar('SELECT password_hash FROM users WHERE email = ?', [$email]);
        if (is_string($hash) && password_verify($password, $hash)) {
            $stillDefault[] = $email;
        }
    }
    $check('Accounts', 'Demo passwords changed', $stillDefault === [],
        $stillDefault === [] ? 'No account is using a published demo password.'
            : 'Still using the published demo password: ' . implode(', ', $stillDefault)
            . '. Change these before the site is public — anyone who has read the install guide can sign in.',
        'critical');

    // Database privileges: the app user should not be able to reshape the schema.
    $grants = [];
    try {
        foreach ($pdo->query('SHOW GRANTS FOR CURRENT_USER()')->fetchAll(PDO::FETCH_NUM) as $grantRow) {
            $grants[] = (string)$grantRow[0];
        }
    } catch (Throwable $e) {
        $grants = [];
    }
    $grantText = strtoupper(implode(' ; ', $grants));
    $dangerous = $grants !== [] && (str_contains($grantText, 'ALL PRIVILEGES') || str_contains($grantText, 'DROP'));
    $check('Database', 'Application user cannot drop tables', $grants !== [] && !$dangerous,
        $grants === [] ? 'Could not read grants for the database user.'
            : ($dangerous ? 'The database user can DROP or has ALL PRIVILEGES. Grant it only '
                . 'SELECT, INSERT, UPDATE, DELETE, and keep schema changes for the owner account.'
                : 'The database user holds only data rights.'), 'medium');

    // Deployment files
    $root = dirname(__DIR__);
    $check('Files', '.htaccess deployed', is_file($root . '/.htaccess'),
        'Without .htaccess there is no HTTPS redirect, no security headers and no protection on db.php.');
    $localConfig = $root . '/config.local.php';
    $check('Files', 'Local config present', is_file($localConfig),
        is_file($localConfig) ? 'config.local.php found.' : 'config.local.php is missing.');
    if (is_file($localConfig)) {
        $perms = substr(sprintf('%o', fileperms($localConfig)), -3);
        $check('Files', 'Local config not world-readable', (int)$perms % 10 === 0,
            "config.local.php is mode $perms. Set it to 600 so other accounts on the host cannot read your "
            . 'database password and signing key.', 'critical');
    }

    // OTP delivery
    $check('Delivery', 'Live OTP configured', (bool)(system_config()['live_otp'] ?? $config['live_otp'] ?? false),
        'Demo mode shows the OTP on screen, which is fine for testing and unacceptable in production.', 'medium');

    // Runtime
    $check('Runtime', 'Supported PHP version', PHP_VERSION_ID >= 80200,
        'Running PHP ' . PHP_VERSION . '.', 'medium');
    $check('Runtime', 'Encryption available', function_exists('sodium_crypto_secretbox'),
        'libsodium is needed to encrypt the stored Twilio and SendGrid keys.');

    // Fraud queue hygiene
    $staleAlerts = (int)scalar("SELECT COUNT(*) FROM fraud_alerts WHERE status = 'open'
        AND created_at < DATE_SUB(?, INTERVAL 7 DAY)", [now_utc()]);
    $check('Monitoring', 'Fraud alerts reviewed', $staleAlerts === 0,
        $staleAlerts === 0 ? 'No alert has been sitting unreviewed for a week.'
            : "$staleAlerts alerts have been open for more than seven days.", 'medium');

    $integrity = integrity_report();
    $check('Files', 'Code matches the sealed copy',
        $integrity['sealed'] && $integrity['changed'] === [] && $integrity['removed'] === [],
        !$integrity['sealed'] ? 'No integrity seal recorded yet.'
            : ($integrity['changed'] === [] && $integrity['removed'] === []
                ? 'All ' . $integrity['file_count'] . ' files match the seal.'
                : 'Changed since sealing: ' . implode(', ',
                    array_merge($integrity['changed'], $integrity['removed']))), 'critical');

    $failed = array_values(array_filter($checks, fn($c) => $c['status'] === 'fail'));
    $critical = array_values(array_filter($failed, fn($c) => $c['severity'] === 'critical'));
    // A single critical finding should not be hidden behind a comfortable average.
    $score = (int)round(count(array_filter($checks, fn($c) => $c['status'] === 'pass')) / max(count($checks), 1) * 100);
    if ($critical !== []) {
        $score = min($score, 49);
    }
    security_event('SECURITY_AUDIT', $critical === [] ? 'info' : 'warning',
        count($failed) . ' checks failed, ' . count($critical) . ' critical', $owner);
    respond([
        'score' => $score,
        'verdict' => $critical !== [] ? 'Action required' : ($failed === [] ? 'Hardened' : 'Needs attention'),
        'checks' => $checks,
        'summary' => ['total' => count($checks), 'passed' => count($checks) - count($failed),
            'failed' => count($failed), 'critical' => count($critical)],
        'integrity' => $integrity,
    ]);
}

// --- CAPTCHA ---------------------------------------------------------------------------
// A public form that reaches the sales desk is worth a bot's time, so the enquiry form
// carries one. The answer never leaves the server: only a salted hash is kept, the row is
// spent on first use, and it expires in five minutes.
const CAPTCHA_TTL = 300;
const CAPTCHA_DIGITS = 5;

function captcha_hash(string $code): string
{
    global $config;
    return hash_hmac('sha256', strtolower(trim($code)), $config['token_secret']);
}

function captcha_image(string $code): string
{
    $w = 160;
    $h = 56;
    $img = imagecreatetruecolor($w, $h);
    imagefill($img, 0, 0, imagecolorallocate($img, 247, 249, 252));

    // Noise first, so it sits behind the digits rather than obscuring them.
    for ($i = 0; $i < 420; $i++) {
        imagesetpixel($img, random_int(0, $w - 1), random_int(0, $h - 1),
            imagecolorallocate($img, random_int(150, 215), random_int(150, 215), random_int(160, 220)));
    }
    for ($i = 0; $i < 4; $i++) {
        imageline($img, random_int(0, $w), random_int(0, $h), random_int(0, $w), random_int(0, $h),
            imagecolorallocate($img, random_int(150, 200), random_int(160, 205), random_int(180, 220)));
    }

    // Each digit gets its own position, angle and shade, so the glyphs do not
    // line up into something a template matcher can read in one pass.
    $font = 5;
    $x = 16;
    foreach (str_split($code) as $digit) {
        $ink = imagecolorallocate($img, random_int(10, 60), random_int(30, 80), random_int(90, 150));
        $glyph = imagecreatetruecolor(12, 20);
        imagefill($glyph, 0, 0, imagecolorallocate($glyph, 247, 249, 252));
        imagestring($glyph, $font, 1, 2, $digit, $ink);
        $rotated = imagerotate($glyph, random_int(-26, 26), imagecolorallocate($glyph, 247, 249, 252));
        imagecopy($img, $rotated, $x, random_int(8, 20), 0, 0, imagesx($rotated), imagesy($rotated));
        imagedestroy($glyph);
        imagedestroy($rotated);
        $x += random_int(24, 30);
    }

    ob_start();
    imagepng($img);
    $png = (string)ob_get_clean();
    imagedestroy($img);
    return $png;
}

function route_public_captcha(array $d): void
{
    global $pdo;
    // Cheap to serve but not free: a bot should not be able to mint these endlessly.
    rate_limit('captcha:' . client_ip(), 40, 3600, 'Too many attempts. Please try again later.');

    // Opportunistic cleanup, so the table cannot grow without bound.
    $pdo->prepare('DELETE FROM captcha_challenges WHERE expires_at < ?')->execute([now_utc()]);

    $code = '';
    for ($i = 0; $i < CAPTCHA_DIGITS; $i++) {
        $code .= random_int(0, 9);
    }
    $id = uuid4();
    $pdo->prepare('INSERT INTO captcha_challenges (id, code_hash, ip, expires_at) VALUES (?, ?, ?, ?)')
        ->execute([$id, captcha_hash($code), client_ip(),
            gmdate('Y-m-d H:i:s', time() + CAPTCHA_TTL)]);

    respond(['captcha_id' => $id, 'expires_in' => CAPTCHA_TTL,
        'image' => 'data:image/png;base64,' . base64_encode(captcha_image($code))]);
}

// Spends the challenge whether or not the answer was right: one image, one attempt,
// so a wrong guess cannot be retried against the same picture.
function captcha_verify(array $d): void
{
    global $pdo;
    $id = clip($d['captcha_id'] ?? '', 36);
    $answer = clip($d['captcha_answer'] ?? '', 16);
    if ($id === '' || $answer === '') {
        fail(422, 'Please enter the number shown in the image.');
    }
    $row = row('SELECT * FROM captcha_challenges WHERE id = ?', [$id]);
    $pdo->prepare('UPDATE captcha_challenges SET used_at = ? WHERE id = ? AND used_at IS NULL')
        ->execute([now_utc(), $id]);
    if (!$row || $row['used_at'] !== null || $row['expires_at'] < gmdate('Y-m-d H:i:s')) {
        fail(400, 'That verification image has expired. Please try the new one.');
    }
    if (!hash_equals($row['code_hash'], captcha_hash($answer))) {
        fail(400, 'The number did not match. Please try the new image.');
    }
}
