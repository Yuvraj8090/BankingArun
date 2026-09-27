<?php
// AJSPay: Hostinger MySQL connector, configuration, and shared API helpers.
// api.php includes this file; direct HTTP access to it is denied by .htaccess.
declare(strict_types=1);

ini_set('display_errors', '0');  // never show errors or stack traces to visitors
ini_set('log_errors', '1');      // log them to the server error log instead
header_remove('X-Powered-By');

// ---------------------------------------------------------------------------
// CONFIGURATION DEFAULTS. Don't put real values here: create config.local.php
// next to this file (see INSTALL_HOSTINGER.md) and override them there. Keeping
// secrets out of this file means it can be shared or displayed without leaking.
// ---------------------------------------------------------------------------
$config = [
    'db_host'             => 'localhost',
    'db_name'             => '',
    'db_user'             => '',
    'db_pass'             => '',
    // Exact frontend origin(s). Never "*": that would let any website make
    // logged-in requests on a visitor's behalf.
    'allowed_origins'     => [],
    // Signs session tokens and encrypts stored API keys. Generate with:
    //   php -r "echo bin2hex(random_bytes(32));"
    'token_secret'        => '',
    'token_ttl'           => 1800,  // session lifetime in seconds (30 minutes)
    'cookie_secure'       => true,  // false only for local http:// development
    // Enable only behind a proxy/CDN you control (e.g. Cloudflare). Otherwise
    // X-Forwarded-For is attacker-controlled and would defeat login lockouts.
    'trust_proxy'         => false,
    'public_app_url'      => '',        // e.g. https://yourdomain.com (referral links)
    'webauthn_rp_id'      => '',        // your domain, e.g. yourdomain.com (passkeys)
    'webauthn_rp_name'    => 'Aadhunik Jeewan Sanchay Nidhi Limited',
    'webauthn_origin'     => '',        // e.g. https://yourdomain.com
    // OTP delivery. With live_otp false the API runs in demo mode and shows the OTP.
    // The bank owner can also set these from the System Config screen.
    'live_otp'            => false,
    'twilio_account_sid'  => '',
    'twilio_auth_token'   => '',
    'twilio_from_number'  => '',
    'sendgrid_api_key'    => '',
    'sendgrid_from_email' => 'alerts@ajspay.in',
    // Email delivery. The domain's own Hostinger mailbox over authenticated SMTP is
    // the primary route; leave the SMTP fields blank to fall back to SendGrid's API.
    'smtp_host'           => 'smtp.hostinger.com',
    'smtp_port'           => '465',     // 465 implicit TLS, or 587 STARTTLS
    'smtp_user'           => '',        // the full mailbox address, e.g. alerts@ajspay.in
    'smtp_password'       => '',
    // Reply-To on everything we send. A member who hits reply on an OTP mail must
    // reach a mailbox someone actually reads, not a send-only address.
    'support_email'       => 'support@ajspay.in',
];
if (is_file(__DIR__ . '/config.local.php')) {
    $config = array_merge($config, require __DIR__ . '/config.local.php');
}
// Payment rail settings live in their own file, because they are the one set of
// credentials that can move real money and are worth keeping separable — see
// config.rails.php.example.
if (is_file(__DIR__ . '/config.rails.php')) {
    $config = array_merge($config, require __DIR__ . '/config.rails.php');
}

// --- CORS and response headers ------------------------------------------------
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin !== '' && in_array($origin, $config['allowed_origins'], true)) {
    header("Access-Control-Allow-Origin: $origin");
    header('Access-Control-Allow-Credentials: true');
}
header('Vary: Origin');
header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: strict-origin-when-cross-origin');
header('Cache-Control: no-store');  // banking data must never sit in browser or proxy caches

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// --- Responses ----------------------------------------------------------------
function respond(array $data, int $code = 200): never
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    // PRESERVE_ZERO_FRACTION keeps 50000.0 as a float, exactly like FastAPI's output.
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE
        | JSON_PRESERVE_ZERO_FRACTION);
    exit;
}

// Same error shape as FastAPI ({"detail": "..."}), which the React app displays.
// Rolls back any open DB transaction, so handlers can bail out mid-transfer safely.
function fail(int $code, string $detail): never
{
    global $pdo;
    if (isset($pdo) && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    respond(['detail' => $detail], $code);
}

function send_download(string $bytes, string $mime, string $filename): never
{
    header('Content-Type: ' . $mime);
    header('Content-Disposition: attachment; filename="' . preg_replace('/[^A-Za-z0-9._-]/', '_', $filename) . '"');
    header('Content-Length: ' . strlen($bytes));
    echo $bytes;
    exit;
}

// Fail closed with a missing or short secret: anyone could forge sessions with it.
if (strlen($config['token_secret']) < 32) {
    error_log('AJSPay: token_secret is not configured (see config.local.php)');
    fail(500, 'Server is not configured yet.');
}

try {
    $pdo = new PDO(
        "mysql:host={$config['db_host']};dbname={$config['db_name']};charset=utf8mb4",
        $config['db_user'],
        $config['db_pass'],
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,  // real server-side prepared statements
        ]
    );
    $pdo->exec("SET time_zone = '+00:00'");
} catch (PDOException $e) {
    error_log('AJSPay DB connection failed: ' . $e->getMessage());
    fail(500, 'Database connection failed. Please try again later.');
}

function rows(string $sql, array $params = []): array
{
    global $pdo;
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    return $stmt->fetchAll();
}

function row(string $sql, array $params = []): ?array
{
    return rows($sql, $params)[0] ?? null;
}

function scalar(string $sql, array $params = []): mixed
{
    $r = row($sql, $params);
    return $r ? reset($r) : null;
}

// --- Type normalisation ---------------------------------------------------------
// MySQL returns DECIMAL as strings, TINYINT as 0/1 and DATETIME as "Y-m-d H:i:s".
// Convert rows to the JSON types FastAPI returned, so the React app behaves the same.
const FLOAT_COLUMNS = ['balance', 'amount', 'balance_after', 'online_limit', 'atm_limit', 'principal_amount',
    'interest_rate', 'maturity_amount', 'fee', 'invested_amount', 'current_value', 'units', 'outstanding', 'roi',
    'face_match_score', 'lat', 'lng', 'credit_amount', 'sum_assured', 'annual_premium', 'amount_requested',
    'calculated_emi', 'monthly_income', 'total_deposit', 'contribution_amount', 'collected_total'];
const BOOL_COLUMNS = ['is_virtual', 'international_enabled', 'contactless_enabled', 'ecom_enabled', 'upi_linked',
    'is_joint', 'mfa_enabled', 'has_atm', 'has_cdm', 'has_locker', 'verified'];
const TIME_COLUMNS = ['created_at', 'timestamp', 'submitted_at', 'reviewed_at', 'verified_at'];

function iso(string $datetime): string
{
    return str_replace(' ', 'T', $datetime) . '+00:00';
}

function out(array $row): array
{
    foreach ($row as $key => $value) {
        if ($value === null) {
            continue;
        }
        if (in_array($key, FLOAT_COLUMNS, true)) {
            $row[$key] = (float)$value;
        } elseif (in_array($key, BOOL_COLUMNS, true)) {
            $row[$key] = (bool)$value;
        } elseif (in_array($key, TIME_COLUMNS, true)) {
            $row[$key] = iso($value);
        }
    }
    return $row;
}

function out_all(array $rows): array
{
    return array_map('out', $rows);
}

// --- Requests -------------------------------------------------------------------
// Only JSON bodies are accepted. Browsers can't send JSON cross-site without a
// CORS preflight, so this also shuts out classic form-based CSRF.
function body(): array
{
    if (!str_starts_with(strtolower($_SERVER['CONTENT_TYPE'] ?? ''), 'application/json')) {
        fail(415, 'Content-Type must be application/json.');
    }
    $data = json_decode(file_get_contents('php://input') ?: '{}', true);
    if (!is_array($data)) {
        fail(400, 'Request body must be a JSON object.');
    }
    return $data;
}

// --- Pagination -------------------------------------------------------------------
// Every list endpoint goes through this, so no screen can silently truncate.
// $sql is our own SQL with no user-supplied text in it; $perPage and $offset are
// cast to int before interpolation, and the caller's values stay bound.
function paginate(string $sql, array $params = [], int $defaultPerPage = 25, int $maxPerPage = 100): array
{
    $page = max(1, (int)($_GET['page'] ?? 1));
    $perPage = max(1, min((int)($_GET['per_page'] ?? $defaultPerPage), $maxPerPage));
    $total = (int)scalar("SELECT COUNT(*) FROM ($sql) AS paged_count", $params);
    $pages = max(1, (int)ceil($total / $perPage));
    if ($page > $pages) {
        $page = $pages;  // a stale link to page 9 of 3 lands on the last page
    }
    $offset = ($page - 1) * $perPage;
    $rows = rows("$sql LIMIT $perPage OFFSET $offset", $params);
    return [$rows, [
        'page' => $page, 'per_page' => $perPage, 'total' => $total, 'pages' => $pages,
        'has_prev' => $page > 1, 'has_next' => $page < $pages,
        'from' => $total === 0 ? 0 : $offset + 1, 'to' => min($offset + $perPage, $total),
    ]];
}

function need(array $data, string ...$keys): void
{
    foreach ($keys as $key) {
        if (!isset($data[$key]) || $data[$key] === '') {
            fail(422, "Field '$key' is required.");
        }
    }
}

function clip(mixed $value, int $max): string
{
    return mb_substr(trim(is_scalar($value) ? (string)$value : ''), 0, $max);
}

function money(mixed $value): float
{
    if (!is_numeric($value) || !is_finite((float)$value)) {
        fail(422, 'Amount must be a number.');
    }
    return round((float)$value, 2);
}

function rupees(float $amount): string
{
    return '₹' . number_format($amount, 2);
}

function client_ip(): string
{
    global $config;
    $forwarded = trim(explode(',', $_SERVER['HTTP_X_FORWARDED_FOR'] ?? '')[0]);
    return ($config['trust_proxy'] && $forwarded !== '') ? $forwarded : ($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
}

function uuid4(): string
{
    $b = random_bytes(16);
    $b[6] = chr((ord($b[6]) & 0x0f) | 0x40);
    $b[8] = chr((ord($b[8]) & 0x3f) | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($b), 4));
}

function digits(int $count): string
{
    $s = '';
    for ($i = 0; $i < $count; $i++) {
        $s .= random_int(0, 9);
    }
    return $s;
}

// Avoids 0/O/1/l/I so a password read aloud or handed over on paper is not
// ambiguous about which character it was. Mirrors generatePassword() in
// frontend/src/components/Modal.js, used when an operator generates one by hand.
function generate_password(int $length = 14): string
{
    $chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
    $s = '';
    for ($i = 0; $i < $length; $i++) {
        $s .= $chars[random_int(0, strlen($chars) - 1)];
    }
    return $s;
}

function now_utc(): string
{
    return gmdate('Y-m-d H:i:s');
}

function valid_date(mixed $value, string $field): string
{
    $s = clip($value, 10);
    $date = DateTimeImmutable::createFromFormat('!Y-m-d', $s);
    if (!$date || $date->format('Y-m-d') !== $s) {
        fail(422, "$field must be a date in YYYY-MM-DD format.");
    }
    return $s;
}
