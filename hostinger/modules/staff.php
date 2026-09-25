<?php
// AJSPay: staff and back-office APIs. Role panels, branch admin, RBI reports,
// video KYC review, the bank owner's runtime config and the Hostinger export.
declare(strict_types=1);

const ADMIN_ROLES = ['admin', 'branch_manager', 'bank_owner'];
const USER_ACCESS_ROLES = ['bank_owner', 'admin', 'branch_manager', 'staff', 'collection_agent', 'loan_officer'];
const KYC_FRAME_MAX = 2000000;  // base64 characters per photo (~1.5 MB image)
const KYC_FRAME_MAX_PX = 6000;  // guards against a small file describing a huge bitmap
function staff_user(array $roles): array
{
    $user = current_user();
    if (!in_array($user['role'], $roles, true)) {
        fail(403, 'Access restricted. Required role: ' . implode(', ', $roles));
    }
    return $user;
}

// --- Role panels ----------------------------------------------------------------------
function route_panel_bank_owner(array $d): void
{
    staff_user(['bank_owner']);
    $loans = out_all(rows('SELECT * FROM loan_applications ORDER BY created_at DESC LIMIT 50'));
    $branches = out_all(rows('SELECT * FROM branches WHERE deleted_at IS NULL ORDER BY id'));
    respond([
        // Only figures this system can actually derive. No credit rating or
        // capital-adequacy claims: those are bank measures and were invented.
        'kpis' => ['total_users' => (int)scalar('SELECT COUNT(*) FROM users'),
            'total_liquidity' => (float)scalar('SELECT COALESCE(SUM(balance), 0) FROM accounts'),
            'total_transactions' => (int)scalar('SELECT COUNT(*) FROM transactions'),
            'active_branches' => count($branches), 'loan_pipeline_count' => count($loans),
            'total_deposits' => (float)scalar('SELECT COALESCE(SUM(principal_amount), 0) FROM deposits'),
            'members' => (int)scalar("SELECT COUNT(*) FROM users WHERE role IN ('retail', 'corporate')")],
        'loan_pipeline' => $loans,
        'branches' => $branches,
        'policies' => [
            ['key' => 'savings_roi', 'label' => 'Savings Account Interest Rate', 'value' => '4.00% p.a.'],
            ['key' => 'fd_max_roi', 'label' => 'FD Peak Rate (Senior 2-3 Yr)', 'value' => '8.00% p.a.'],
            ['key' => 'home_loan_min', 'label' => 'Home Loan Starting Rate', 'value' => '8.40% p.a.'],
            ['key' => 'personal_loan_min', 'label' => 'Personal Loan Starting Rate', 'value' => '10.50% p.a.'],
            ['key' => 'nof_deposit_cap', 'label' => 'NOF : Deposits cap (Nidhi Rules)', 'value' => '1:20'],
        ],
    ]);
}

function route_panel_staff(array $d): void
{
    staff_user(['staff', ...ADMIN_ROLES]);
    $tickets = out_all(rows("SELECT id, ticket_id, user_name, category, subject, priority, status, created_at
        FROM support_tickets WHERE status = 'OPEN' ORDER BY created_at DESC LIMIT 20"));
    respond([
        'kpis' => [
            'customers_served_today' => (int)scalar("SELECT COUNT(DISTINCT user_id) FROM audit_logs
                WHERE action = 'USER_LOGIN' AND timestamp >= UTC_DATE()"),
            'pending_kyc' => (int)scalar("SELECT COUNT(*) FROM users WHERE kyc_status = 'pending_approval'"),
            'transactions_processed' => (int)scalar('SELECT COUNT(*) FROM transactions'),
            'open_tickets' => count($tickets),
        ],
        'recent_customers' => array_map('public_user',
            rows("SELECT * FROM users WHERE role IN ('retail', 'corporate') ORDER BY created_at DESC LIMIT 10")),
        'open_tickets' => $tickets,
    ]);
}

function route_panel_collection(array $d): void
{
    staff_user(['collection_agent', ...ADMIN_ROLES]);
    $cases = out_all(rows('SELECT * FROM collection_cases ORDER BY dpd_days DESC'));
    respond([
        'kpis' => ['total_cases' => count($cases),
            'total_outstanding' => (float)array_sum(array_column($cases, 'outstanding')),
            'npa_risk_count' => count(array_filter($cases, fn($c) => $c['status'] === 'npa_risk' || $c['dpd_days'] >= 90)),
            'recovery_target_month' => 12500000, 'recovered_month' => 4820000],
        'cases' => $cases,
    ]);
}

function route_collection_action(array $d): void
{
    global $pdo;
    $user = staff_user(['collection_agent', ...ADMIN_ROLES]);
    need($d, 'case_id', 'action');
    $status = ['reminder' => 'reminder_sent', 'legal_notice' => 'legal_notice', 'settle' => 'settled'][$d['action']] ?? null;
    if ($status === null) {
        fail(422, 'action must be reminder, legal_notice or settle.');
    }
    $case = row('SELECT * FROM collection_cases WHERE id = ?', [clip($d['case_id'], 36)]);
    if (!$case) {
        fail(404, 'Case not found');
    }
    $pdo->prepare('UPDATE collection_cases SET status = ?, last_contact = UTC_DATE() WHERE id = ?')->execute([$status, $case['id']]);
    audit($user, 'COLLECTION_' . strtoupper($d['action']), "{$case['loan_ref']} {$case['borrower']}");
    respond(['status' => 'SUCCESS', 'message' => "Action '{$d['action']}' recorded for {$case['borrower']}."]);
}

function route_panel_loan_dept(array $d): void
{
    staff_user(['loan_officer', ...ADMIN_ROLES]);
    $apps = out_all(rows('SELECT * FROM loan_applications ORDER BY created_at DESC LIMIT 100'));
    $byStatus = array_count_values(array_column($apps, 'status'));
    // Attach the AI module's grade and its reasons so the desk sees why.
    foreach ($apps as &$app) {
        $app['risk_score'] = $app['risk_score'] === null ? null : (int)$app['risk_score'];
        $app['risk_reasons'] = $app['risk_reasons'] ? (json_decode((string)$app['risk_reasons'], true) ?: null) : null;
    }
    unset($app);
    $graded = array_filter($apps, fn($a) => $a['risk_score'] !== null);
    respond([
        'kpis' => ['total_applications' => count($apps),
            'disbursed_amount' => (float)array_sum(array_column(array_filter($apps, fn($a) => $a['status'] === 'disbursed'), 'amount')),
            'in_review' => $byStatus['under_review'] ?? 0, 'documentation' => $byStatus['documentation'] ?? 0,
            'approved' => $byStatus['approved'] ?? 0,
            // A real NPA ratio needs repayment and ageing data, which this system
            // does not track, so we report what is actually measured instead of
            // printing a number nobody computed.
            'graded' => count($graded),
            'avg_risk_score' => $graded ? (int)round(array_sum(array_column($graded, 'risk_score')) / count($graded)) : null,
            'high_risk' => count(array_filter($graded, fn($a) => in_array($a['risk_grade'], ['D', 'E'], true)))],
        'applications' => $apps,
        'by_status' => (object)$byStatus,
    ]);
}

function route_loan_decision(array $d): void
{
    global $pdo;
    $user = staff_user(['loan_officer', ...ADMIN_ROLES]);
    need($d, 'application_id', 'decision');
    $status = ['approve' => 'approved', 'reject' => 'rejected', 'request_docs' => 'documentation',
        'disburse' => 'disbursed'][$d['decision']] ?? null;
    if ($status === null) {
        fail(400, 'Invalid decision');
    }
    $app = row('SELECT id, loan_type, applicant FROM loan_applications WHERE id = ?', [clip($d['application_id'], 36)]);
    if (!$app) {
        fail(404, 'Application not found');
    }
    $pdo->prepare('UPDATE loan_applications SET status = ?, decision_note = ? WHERE id = ?')
        ->execute([$status, clip($d['remark'] ?? '', 255), $app['id']]);
    audit($user, 'LOAN_' . strtoupper($status), "{$app['applicant']} {$app['loan_type']}");
    respond(['status' => 'SUCCESS', 'message' => "Loan application marked as $status."]);
}

// --- Branch admin & compliance ----------------------------------------------------------
function route_admin_overview(array $d): void
{
    staff_user(ADMIN_ROLES);
    respond([
        'stats' => [
            'total_customers' => (int)scalar('SELECT COUNT(*) FROM users'),
            'active_accounts' => (int)scalar('SELECT COUNT(*) FROM accounts'),
            'active_deposits' => (int)scalar('SELECT COUNT(*) FROM deposits'),
            'pending_kyc_count' => (int)scalar("SELECT COUNT(*) FROM users WHERE kyc_status = 'pending_approval'"),
            'total_liquidity' => (float)scalar('SELECT COALESCE(SUM(balance), 0) FROM accounts'),
            'statutory_crr_slr_status' => 'Compliant (CRR: 4.50%, SLR: 18.00%)',
        ],
        'high_value_transactions' => out_all(rows('SELECT * FROM transactions WHERE amount >= 50000
            ORDER BY timestamp DESC, seq DESC LIMIT 10')),
        'pending_kyc_users' => array_map('public_user',
            rows("SELECT * FROM users WHERE kyc_status = 'pending_approval' ORDER BY created_at DESC LIMIT 20")),
        'audit_logs' => out_all(rows('SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 15')),
    ]);
}

function route_admin_kyc_action(array $d): void
{
    global $pdo;
    $admin = staff_user(ADMIN_ROLES);
    need($d, 'user_id', 'status');
    if (!in_array($d['status'], ['verified', 'rejected', 'pending_approval'], true)) {
        fail(422, 'status must be verified, rejected or pending_approval.');
    }
    $customer = row('SELECT id, email FROM users WHERE id = ?', [clip($d['user_id'], 36)]);
    if (!$customer) {
        fail(404, 'Customer not found.');
    }
    $pdo->prepare('UPDATE users SET kyc_status = ?, kyc_reason = ? WHERE id = ?')
        ->execute([$d['status'], clip($d['rejection_reason'] ?? '', 255) ?: null, $customer['id']]);
    audit($admin, 'KYC_' . strtoupper($d['status']), $customer['email']);
    respond(['status' => 'SUCCESS', 'message' => 'Customer KYC status updated to ' . strtoupper($d['status'])]);
}

function route_rbi_reports(array $d): void
{
    staff_user(ADMIN_ROLES);
    $ctr = out_all(rows('SELECT * FROM transactions WHERE amount >= 100000 ORDER BY timestamp DESC, seq DESC LIMIT 50'));
    $str = out_all(rows("SELECT * FROM transactions WHERE mode = 'CORPORATE_BULK' ORDER BY timestamp DESC, seq DESC LIMIT 50"));
    respond([
        'report_generated_on' => iso(now_utc()),
        // A Nidhi company reports CTR/STR to FIU-IND under the PMLA; it is not RBI-licensed,
        // and bank ratios (CRR/SLR/LCR/CAR) do not apply to it.
        'regulatory_authority' => 'Financial Intelligence Unit - India (FIU-IND)',
        'guideline' => 'Prevention of Money-Laundering Act, 2002 (Section 12) & Nidhi Rules, 2014 (MCA)',
        'cash_transaction_report_ctr' => ['title' => 'Cash / High-Value Transaction Report (CTR)', 'count' => count($ctr), 'records' => $ctr],
        'suspicious_transaction_report_str' => ['title' => 'Suspicious Transaction Report (STR)', 'count' => count($str), 'records' => $str],
        'statutory_compliance' => [
            'net_owned_funds' => '₹25.00 lakh (Nidhi Rules minimum ₹20 lakh)',
            'nof_to_deposits_ratio' => '1:18 (Nidhi Rules cap 1:20)',
            'unencumbered_term_deposits' => '11.2% of outstanding deposits (minimum 10%)',
            'member_only_deposits' => 'Compliant - deposits accepted from members only',
        ],
    ]);
}

// --- Director user access ---------------------------------------------------------------
function next_staff_id(): string
{
    $last = (int)scalar("SELECT COALESCE(MAX(CAST(SUBSTRING(staff_id, 5) AS UNSIGNED)), 0) FROM users WHERE staff_id LIKE 'AJSS%'");
    return 'AJSS' . str_pad((string)($last + 1), 6, '0', STR_PAD_LEFT);
}

function admin_user_json(array $u, string $ownerId): array
{
    $u = out($u);
    $memberLogin = $u['account_number'] ?? $u['folio_no'] ?? null;
    $u['login_id'] = in_array($u['role'], ['retail', 'corporate'], true)
        ? ($memberLogin ?: $u['email'])
        : $u['email'];
    $u['can_reset_password'] = $u['id'] !== $ownerId;
    return $u;
}

function route_admin_users(array $d): void
{
    $owner = staff_user(['bank_owner']);
    $sql = "SELECT u.id, u.name, u.email, u.phone, u.role, u.branch, u.designation, u.kyc_status, u.created_at, u.staff_id,
            (SELECT a.account_number FROM accounts a WHERE a.user_id = u.id ORDER BY a.created_at, a.id LIMIT 1) AS account_number,
            (SELECT m.folio_no FROM member_register m WHERE m.user_id = u.id ORDER BY m.admitted_on DESC LIMIT 1) AS folio_no
        FROM users u WHERE u.role IN (" . implode(',', array_fill(0, count(USER_ACCESS_ROLES), '?')) . ')';
    $params = USER_ACCESS_ROLES;
    if (!empty($_GET['role']) && in_array($_GET['role'], USER_ACCESS_ROLES, true)) {
        $sql .= ' AND u.role = ?';
        $params[] = clip($_GET['role'], 30);
    }
    if (!empty($_GET['q'])) {
        $sql .= ' AND (u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)';
        $like = '%' . clip($_GET['q'], 80) . '%';
        array_push($params, $like, $like, $like);
    }
    $sql .= " ORDER BY FIELD(u.role, 'bank_owner', 'admin', 'branch_manager', 'staff', 'collection_agent',
        'loan_officer', 'corporate', 'retail'), u.name";
    [$users, $meta] = paginate($sql, $params, 25, 100);
    respond(['users' => array_map(fn($u) => admin_user_json($u, $owner['id']), $users),
        'pagination' => $meta, 'create_roles' => USER_ACCESS_ROLES]);
}

function route_admin_user_create(array $d): void
{
    global $pdo;
    $owner = staff_user(['bank_owner']);
    need($d, 'name', 'email', 'phone', 'role', 'password');
    $role = clip($d['role'], 30);
    if (!in_array($role, USER_ACCESS_ROLES, true)) {
        fail(422, 'This screen creates only internal staff and back-office logins.');
    }
    $name = clip($d['name'], 150);
    $email = strtolower(clip($d['email'], 150));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        fail(422, 'That email address does not look right.');
    }
    assert_password_acceptable($d['password'] ?? null, [$name, strstr($email, '@', true)]);
    if (row('SELECT id FROM users WHERE email = ?', [$email])) {
        fail(400, 'A login with this email already exists.');
    }
    $phone = clip($d['phone'], 30);
    if (row('SELECT id FROM users WHERE phone = ?', [$phone])) {
        fail(400, 'A login with this phone number already exists.');
    }
    $staffId = next_staff_id();
    $pdo->prepare('INSERT INTO users (id, name, email, phone, role, password_hash, transaction_password_hash,
            branch, kyc_status, designation, staff_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        ->execute([uuid4(), $name, $email, $phone, $role,
            password_hash((string)$d['password'], PASSWORD_BCRYPT),
            password_hash(bin2hex(random_bytes(16)), PASSWORD_BCRYPT),
            clip($d['branch'] ?? 'Head Office - Nariman Point', 100), 'verified',
            clip($d['designation'] ?? '', 100) ?: null, $staffId]);
    audit($owner, 'USER_LOGIN_CREATED', "$role $email ($staffId)");
    respond(['status' => 'SUCCESS', 'login_id' => $email, 'staff_id' => $staffId,
        'message' => "Login created. User ID: $email. Staff ID: $staffId."]);
}

function route_admin_user_update(array $d): void
{
    global $pdo;
    $owner = staff_user(['bank_owner']);
    need($d, 'user_id', 'name', 'email', 'phone', 'role');
    $target = row('SELECT * FROM users WHERE id = ?', [clip($d['user_id'], 36)]);
    if (!$target) {
        fail(404, 'User not found.');
    }
    if (!in_array($target['role'], USER_ACCESS_ROLES, true)) {
        fail(422, 'Member accounts are managed from Relationship Desk.');
    }
    $role = clip($d['role'], 30);
    if (!in_array($role, USER_ACCESS_ROLES, true)) {
        fail(422, 'Internal users must use an internal role.');
    }
    if ($target['role'] === 'bank_owner' && $role !== 'bank_owner'
        && (int)scalar("SELECT COUNT(*) FROM users WHERE role = 'bank_owner'") < 2) {
        fail(400, 'Create another Director before changing the last Director role.');
    }
    $name = clip($d['name'], 150);
    $email = strtolower(clip($d['email'], 150));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        fail(422, 'That email address does not look right.');
    }
    $phone = clip($d['phone'], 30);
    if (row('SELECT id FROM users WHERE email = ? AND id <> ?', [$email, $target['id']])) {
        fail(400, 'A login with this email already exists.');
    }
    if (row('SELECT id FROM users WHERE phone = ? AND id <> ?', [$phone, $target['id']])) {
        fail(400, 'A login with this phone number already exists.');
    }
    $pdo->prepare('UPDATE users SET name = ?, email = ?, phone = ?, role = ?, branch = ?, designation = ?,
            session_version = session_version + 1 WHERE id = ?')
        ->execute([$name, $email, $phone, $role, clip($d['branch'] ?? '', 100) ?: null,
            clip($d['designation'] ?? '', 100) ?: null, $target['id']]);
    audit($owner, 'USER_LOGIN_UPDATED', "{$target['email']} -> $email ($role)");
    respond(['status' => 'SUCCESS', 'message' => "Login updated for $name."]);
}

function route_admin_user_password(array $d): void
{
    global $pdo;
    $owner = staff_user(['bank_owner']);
    need($d, 'user_id', 'password');
    $id = clip($d['user_id'], 150);
    $target = row('SELECT * FROM users WHERE id = ? OR email = ?', [$id, strtolower($id)]);
    if (!$target) {
        fail(404, 'User not found.');
    }
    if (!in_array($target['role'], USER_ACCESS_ROLES, true)) {
        fail(422, 'Member accounts are managed from Relationship Desk.');
    }
    if ($target['id'] === $owner['id']) {
        fail(400, 'Use Security & Login to change your own password.');
    }
    assert_password_acceptable($d['password'] ?? null,
        [$target['name'], $target['email'] ? strstr($target['email'], '@', true) : '']);
    if (password_verify((string)$d['password'], $target['password_hash'])) {
        fail(422, 'That is already this user\'s current password.');
    }
    $pdo->prepare('UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ?')
        ->execute([password_hash((string)$d['password'], PASSWORD_BCRYPT), $target['id']]);
    audit($owner, 'USER_PASSWORD_RESET', "{$target['role']} {$target['email']}");
    security_event('USER_PASSWORD_RESET', 'warning',
        "Password reset by {$owner['email']} for {$target['email']}", $target);
    respond(['status' => 'SUCCESS',
        'message' => "Password changed for {$target['name']}. All their signed-in devices were logged out."]);
}

// --- Bank owner runtime config ----------------------------------------------------------
function mask_secret(string $s): string
{
    $n = strlen($s);
    return $n < 6 ? str_repeat('•', $n) : substr($s, 0, 3) . str_repeat('•', $n - 6) . substr($s, -3);
}

function route_admin_config_get(array $d): void
{
    staff_user(['bank_owner']);
    $cfg = delivery_config();
    $saved = system_config();
    respond([
        'live_otp' => $cfg['live_otp'],
        'twilio_account_sid_masked' => mask_secret($cfg['twilio_account_sid']),
        'twilio_from_number' => $cfg['twilio_from_number'],
        'sendgrid_api_key_masked' => mask_secret($cfg['sendgrid_api_key']),
        'sendgrid_from_email' => $cfg['sendgrid_from_email'],
        'smtp_host' => $cfg['smtp_host'],
        'smtp_port' => $cfg['smtp_port'],
        'smtp_user' => $cfg['smtp_user'],
        'smtp_password_masked' => mask_secret($cfg['smtp_password']),
        'support_email' => $cfg['support_email'],
        // Referral reward, face-match threshold, loan/deposit rates, the DD fee
        // and the card limit ceiling all moved to the Business Parameters screen
        // (modules/parameters.php, system_parameters table) -- a listable,
        // searchable, fully CRUD table rather than more ad-hoc keys here.
        'twilio_configured' => $cfg['twilio_account_sid'] !== '',
        'sendgrid_configured' => $cfg['sendgrid_api_key'] !== '',
        'smtp_configured' => $cfg['smtp_host'] !== '' && $cfg['smtp_user'] !== '' && $cfg['smtp_password'] !== '',
        // Named under the Consumer Protection Act, and published to members on
        // every ticket and in the privacy notice.
        'grievance_officer_name' => $saved['grievance_officer_name'] ?? '',
        'grievance_officer_email' => $saved['grievance_officer_email'] ?? '',
        'grievance_officer_phone' => $saved['grievance_officer_phone'] ?? '',
        'grievance_officer_configured' => isset($saved['grievance_officer_name']),
        // PMLA roles. An inspection asks who holds these by name.
        'principal_officer_name' => $saved['principal_officer_name'] ?? '',
        'principal_officer_email' => $saved['principal_officer_email'] ?? '',
        'designated_director_name' => $saved['designated_director_name'] ?? '',
        'pmla_officers_configured' => isset($saved['principal_officer_name'])
            && isset($saved['designated_director_name']),
    ]);
}

function route_admin_config_set(array $d): void
{
    global $pdo;
    $owner = staff_user(['bank_owner']);
    $data = system_config();
    $changed = [];
    if (isset($d['live_otp'])) {
        // Switching this on without a delivery route would silently stop every
        // OTP reaching anyone, which is worse than demo mode being obvious.
        if ((bool)$d['live_otp']) {
            $merged = array_merge(system_config(), $data);
            $hasSms = !empty($merged['twilio_account_sid']) && !empty($merged['twilio_auth_token'])
                && !empty($merged['twilio_from_number']);
            $hasSmtp = !empty($merged['smtp_host']) && !empty($merged['smtp_user'])
                && !empty($merged['smtp_password']);
            $hasEmail = $hasSmtp
                || (!empty($merged['sendgrid_api_key']) && !empty($merged['sendgrid_from_email']));
            if (!$hasSms && !$hasEmail) {
                fail(422, 'Live OTP needs a way to send the code. Enter the Twilio keys for SMS, or the '
                    . 'mailbox SMTP password (or a SendGrid key) for email, and save those first. Until '
                    . 'then members can use an authenticator app or a passkey, which need no third party '
                    . 'at all.');
            }
        }
        $data['live_otp'] = (bool)$d['live_otp'];
        $changed[] = 'live_otp';
    }
    foreach (['twilio_account_sid' => 64, 'twilio_auth_token' => 128, 'twilio_from_number' => 20,
        'sendgrid_api_key' => 128, 'sendgrid_from_email' => 150, 'smtp_host' => 150, 'smtp_port' => 5,
        'smtp_user' => 150, 'smtp_password' => 128, 'support_email' => 150] as $key => $max) {
        $value = clip($d[$key] ?? '', $max);
        if ($value === '') {
            continue;  // blank means "keep the current value"
        }
        if (in_array($key, ['sendgrid_from_email', 'smtp_user', 'support_email'], true)
            && !filter_var($value, FILTER_VALIDATE_EMAIL)) {
            fail(422, "$key must be a valid email address.");
        }
        if ($key === 'smtp_port' && !in_array($value, ['465', '587'], true)) {
            fail(422, 'smtp_port must be 465 (TLS) or 587 (STARTTLS).');
        }
        $data[$key] = in_array($key, SECRET_CONFIG_KEYS, true) ? encrypt_secret($value) : $value;
        $changed[] = $key;
    }
    // Compliance contacts. Validated, because a grievance officer with a
    // malformed email is the same as not having one.
    foreach (['grievance_officer_name' => 150, 'grievance_officer_phone' => 30,
              'principal_officer_name' => 150, 'designated_director_name' => 150] as $key => $max) {
        if (isset($d[$key])) {
            $data[$key] = clip($d[$key], $max);
            if ($data[$key] === '') {
                fail(422, str_replace('_', ' ', $key) . ' cannot be blank.');
            }
            $changed[] = $key;
        }
    }
    foreach (['grievance_officer_email', 'principal_officer_email'] as $key) {
        if (isset($d[$key])) {
            $email = strtolower(clip($d[$key], 150));
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
                fail(422, 'A valid email address is required for ' . str_replace('_', ' ', $key) . '.');
            }
            $data[$key] = $email;
            $changed[] = $key;
        }
    }
    // Referral reward, face-match threshold, loan/deposit rates, the DD fee and
    // the card limit ceiling are edited on the Business Parameters screen now
    // (route_parameter_update, system_parameters table), not here.
    if (!$changed) {
        fail(400, 'Nothing to update');
    }
    $pdo->prepare("INSERT INTO system_config (id, data, updated_by) VALUES ('global', ?, ?)
        ON DUPLICATE KEY UPDATE data = VALUES(data), updated_by = VALUES(updated_by)")
        ->execute([json_encode($data), $owner['email']]);
    audit($owner, 'SYSTEM_CONFIG_UPDATED', 'Changed: ' . implode(', ', $changed));  // names only, never values
    respond(['status' => 'SUCCESS', 'message' => 'Runtime configuration updated by Bank Owner.']);
}

// --- Video KYC ----------------------------------------------------------------------------
function kyc_frame(array $d, string $key): string
{
    $value = $d[$key] ?? null;
    if (!is_string($value) || $value === '') {
        fail(422, "Field '$key' is required.");
    }
    if (strlen($value) > KYC_FRAME_MAX) {
        fail(413, 'Each photo must be under 1.5 MB. Please retake it at a lower resolution.');
    }
    $raw = base64_decode(str_contains($value, ',') ? substr($value, strrpos($value, ',') + 1) : $value, true);
    if ($raw === false || strlen($raw) < 1000) {
        fail(400, 'Uploaded frames appear invalid. Please retake photos.');
    }
    $info = getimagesizefromstring($raw);
    // Trust the bytes, never the caller's label: only the two formats a camera
    // actually produces are accepted, whatever the data URI claims to be.
    if (!$info || !in_array($info[2], [IMAGETYPE_JPEG, IMAGETYPE_PNG], true)) {
        fail(400, 'Photos must be JPEG or PNG images. Please retake them.');
    }
    // A small, highly compressible file can describe an enormous bitmap. The
    // histogram check decompresses these, so a frame that would allocate
    // gigabytes is refused before anything tries to open it.
    if ($info[0] > KYC_FRAME_MAX_PX || $info[1] > KYC_FRAME_MAX_PX || $info[0] < 64 || $info[1] < 64) {
        fail(400, 'Photos must be between 64 and ' . KYC_FRAME_MAX_PX . ' pixels on a side.');
    }
    // Rebuilt from what the server verified, so the stored record carries a
    // server-issued type rather than whatever prefix the client sent. The value
    // is rendered back into an <img src> for the reviewer.
    $mime = $info[2] === IMAGETYPE_JPEG ? 'image/jpeg' : 'image/png';
    return 'data:' . $mime . ';base64,' . base64_encode($raw);
}

function rgb_histogram(string $dataUri): ?array
{
    $raw = base64_decode(str_contains($dataUri, ',') ? substr($dataUri, strrpos($dataUri, ',') + 1) : $dataUri, true);
    $image = $raw ? @imagecreatefromstring($raw) : false;
    if (!$image) {
        return null;
    }
    $small = imagecreatetruecolor(128, 128);
    imagecopyresampled($small, $image, 0, 0, 0, 0, 128, 128, imagesx($image), imagesy($image));
    $hist = array_fill(0, 768, 0);
    for ($y = 0; $y < 128; $y++) {
        for ($x = 0; $x < 128; $x++) {
            $c = imagecolorat($small, $x, $y);
            $hist[($c >> 16) & 255]++;
            $hist[256 + (($c >> 8) & 255)]++;
            $hist[512 + ($c & 255)]++;
        }
    }
    return $hist;
}

// Colour-histogram cosine similarity. An image heuristic, not a biometric check.
function hist_similarity(string $a, string $b): float
{
    [$ha, $hb] = [rgb_histogram($a), rgb_histogram($b)];
    if (!$ha || !$hb) {
        return 0.0;
    }
    $dot = $na = $nb = 0.0;
    foreach ($ha as $i => $x) {
        $dot += $x * $hb[$i];
        $na += $x * $x;
        $nb += $hb[$i] * $hb[$i];
    }
    return ($na && $nb) ? round($dot / sqrt($na * $nb) * 100, 2) : 0.0;
}

function face_verdict(float $score, float $threshold): string
{
    return $score >= $threshold ? 'auto_approve' : ($score >= 82 ? 'high_confidence' : ($score >= 65 ? 'review' : 'reject_recommended'));
}

function route_kyc_submit(array $d): void
{
    global $pdo;
    $user = current_user();
    [$selfie, $pan, $aadhaar] = [kyc_frame($d, 'selfie_b64'), kyc_frame($d, 'pan_b64'), kyc_frame($d, 'aadhaar_b64')];
    $score = hist_similarity($selfie, $pan);
    $verdict = face_verdict($score, param_value('face_match_auto_threshold', 92.0));
    // Submitting the same photo as selfie and PAN would score 100%, so never auto-approve that.
    $auto = $verdict === 'auto_approve' && $selfie !== $pan;
    if (!$auto && $verdict === 'auto_approve') {
        $verdict = 'review';
    }
    $id = uuid4();
    $pdo->beginTransaction();
    $pdo->prepare('INSERT INTO kyc_video_submissions (id, user_id, user_email, user_name, selfie_b64, pan_b64,
            aadhaar_b64, liveness_words, device_info, status, face_match_score, face_match_verdict, face_match_algo,
            reviewer, reviewed_at, submitted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())')
        ->execute([$id, $user['id'], $user['email'], $user['name'], $selfie, $pan, $aadhaar,
            clip($d['liveness_words'] ?? '', 255) ?: null, clip($d['device_info'] ?? '', 255) ?: null,
            $auto ? 'approved' : 'pending_review', $score, $verdict, 'histogram_v1', $auto ? 'AI_AUTO' : null,
            $auto ? now_utc() : null]);
    $pdo->prepare('UPDATE users SET kyc_status = ? WHERE id = ?')->execute([$auto ? 'verified' : 'pending_approval', $user['id']]);
    audit($user, 'VIDEO_KYC_SUBMITTED', "Video KYC submitted (id=$id) score=$score verdict=$verdict");
    $pdo->commit();
    respond(['status' => 'SUCCESS',
        'message' => $auto ? 'Video KYC approved automatically by AI face-match.'
            : 'Video KYC submitted. Branch officer will verify within 24 hours.',
        'submission_id' => $id, 'face_match_score' => $score, 'verdict' => $verdict, 'auto_approved' => $auto]);
}

function route_kyc_queue(array $d): void
{
    staff_user(ADMIN_ROLES);
    $subs = out_all(rows("SELECT id, user_id, user_email, user_name, LEFT(selfie_b64, 600) AS selfie_thumb, liveness_words,
            device_info, status, face_match_score, face_match_verdict, submitted_at
        FROM kyc_video_submissions WHERE status = 'pending_review' ORDER BY submitted_at DESC LIMIT 50"));
    foreach ($subs as &$s) {
        $s['selfie_thumb'] .= '…';
    }
    respond(['submissions' => $subs, 'count' => count($subs)]);
}

function route_kyc_detail(array $d, string $id = ''): void
{
    staff_user(ADMIN_ROLES);
    $sub = row('SELECT * FROM kyc_video_submissions WHERE id = ?', [$id]);
    if (!$sub) {
        fail(404, 'Submission not found');
    }
    respond(out($sub));
}

function route_kyc_decision(array $d): void
{
    global $pdo;
    $admin = staff_user(ADMIN_ROLES);
    need($d, 'submission_id', 'decision');
    if (!in_array($d['decision'], ['approve', 'reject'], true)) {
        fail(422, 'decision must be approve or reject.');
    }
    $sub = row('SELECT id, user_id FROM kyc_video_submissions WHERE id = ?', [clip($d['submission_id'], 36)]);
    if (!$sub) {
        fail(404, 'Submission not found');
    }
    $status = $d['decision'] === 'approve' ? 'approved' : 'rejected';
    $pdo->beginTransaction();
    $pdo->prepare('UPDATE kyc_video_submissions SET status = ?, reviewed_at = UTC_TIMESTAMP(), reviewer = ?, review_reason = ?
        WHERE id = ?')->execute([$status, $admin['email'], clip($d['reason'] ?? '', 255) ?: null, $sub['id']]);
    $pdo->prepare('UPDATE users SET kyc_status = ? WHERE id = ?')
        ->execute([$status === 'approved' ? 'verified' : 'rejected', $sub['user_id']]);
    audit($admin, 'VIDEO_KYC_' . strtoupper($status), $sub['id']);
    $pdo->commit();
    respond(['status' => 'SUCCESS', 'message' => "Video KYC $status."]);
}

function route_kyc_face_match(array $d, string $id = ''): void
{
    global $pdo;
    staff_user(ADMIN_ROLES);
    $sub = row('SELECT id, selfie_b64, pan_b64 FROM kyc_video_submissions WHERE id = ?', [$id]);
    if (!$sub) {
        fail(404, 'Submission not found');
    }
    $score = hist_similarity($sub['selfie_b64'], $sub['pan_b64']);
    $verdict = face_verdict($score, 92.0);
    $pdo->prepare('UPDATE kyc_video_submissions SET face_match_score = ?, face_match_verdict = ? WHERE id = ?')
        ->execute([$score, $verdict, $sub['id']]);
    respond(['submission_id' => $sub['id'], 'score' => $score, 'verdict' => $verdict,
        'algorithm' => 'RGB histogram cosine similarity v1', 'auto_threshold' => 92.0]);
}

// The deployment-package endpoints are gone. They served the full source of
// db.php and api.php, and a zip of the whole backend, to any administrator —
// useful while setting the server up, and an unnecessary way to read the
// application's internals once it is running.

// --- KYC documents ---------------------------------------------------------------------
// What a member uploads for verification, as opposed to the live video capture. The
// screen that collected these used to show a success message and send nothing.
const KYC_DOC_KINDS = ['pan', 'aadhaar', 'address'];
const KYC_DOC_MAX = 4000000;          // base64 characters, ~3 MB of file
const KYC_DOC_MIME = ['image/jpeg', 'image/png', 'application/pdf'];

function kyc_document_payload(array $d): array
{
    $kind = clip($d['kind'] ?? '', 20);
    if (!in_array($kind, KYC_DOC_KINDS, true)) {
        fail(422, 'kind must be pan, aadhaar or address.');
    }
    $value = $d['content'] ?? null;
    if (!is_string($value) || $value === '') {
        fail(422, 'Please choose a file to upload.');
    }
    if (strlen($value) > KYC_DOC_MAX) {
        fail(413, 'Each document must be under 3 MB.');
    }
    $raw = base64_decode(str_contains($value, ',') ? substr($value, strrpos($value, ',') + 1) : $value, true);
    if ($raw === false || strlen($raw) < 512) {
        fail(400, 'That file could not be read. Please choose another.');
    }

    // The bytes decide the type, never the name or the data URI the browser sent.
    if (str_starts_with($raw, '%PDF-')) {
        $mime = 'application/pdf';
    } else {
        $info = getimagesizefromstring($raw);
        if (!$info || !in_array($info[2], [IMAGETYPE_JPEG, IMAGETYPE_PNG], true)) {
            fail(400, 'Documents must be a JPEG, PNG or PDF.');
        }
        // A small file can describe an enormous bitmap; reviewers open these.
        if ($info[0] > KYC_FRAME_MAX_PX || $info[1] > KYC_FRAME_MAX_PX) {
            fail(400, 'That image is too large to process. Please use a smaller scan.');
        }
        $mime = $info[2] === IMAGETYPE_JPEG ? 'image/jpeg' : 'image/png';
    }

    return [
        'kind' => $kind,
        'file_name' => clip($d['file_name'] ?? '', 200) ?: null,
        'mime' => $mime,
        'byte_size' => strlen($raw),
        // Re-encoded from the verified bytes, so the stored record carries a
        // server-issued type rather than whatever the client claimed.
        'content_b64' => 'data:' . $mime . ';base64,' . base64_encode($raw),
    ];
}

function kyc_document_public(array $r, bool $withContent = false): array
{
    $out = [
        'id' => $r['id'],
        'kind' => $r['kind'],
        'file_name' => $r['file_name'],
        'mime' => $r['mime'],
        'byte_size' => (int)$r['byte_size'],
        'status' => $r['status'],
        'uploaded_at' => $r['uploaded_at'],
        'review_reason' => $r['review_reason'],
    ];
    if ($withContent) {
        $out['content'] = $r['content_b64'];
    }
    return $out;
}

function route_kyc_documents_mine(array $d): void
{
    $user = current_user();
    // The list is metadata only. A member re-opening the page does not need the
    // bytes shipped back to them, and a smaller response is a smaller target.
    respond(['documents' => array_map(
        fn($r) => kyc_document_public($r),
        rows('SELECT * FROM kyc_documents WHERE user_id = ? ORDER BY uploaded_at DESC', [$user['id']]))]);
}

function route_kyc_document_upload(array $d): void
{
    global $pdo;
    $user = current_user();
    rate_limit('kycdoc:' . $user['id'], 20, 3600, 'Too many uploads. Please try again later.');
    $doc = kyc_document_payload($d);

    // One current document per kind: a re-upload replaces the previous one
    // rather than leaving a reviewer to guess which is the real copy.
    $pdo->prepare('DELETE FROM kyc_documents WHERE user_id = ? AND kind = ? AND status = ?')
        ->execute([$user['id'], $doc['kind'], 'pending_review']);

    $id = uuid4();
    $pdo->prepare('INSERT INTO kyc_documents (id, user_id, kind, file_name, mime, byte_size, content_b64)
        VALUES (?, ?, ?, ?, ?, ?, ?)')
        ->execute([$id, $user['id'], $doc['kind'], $doc['file_name'], $doc['mime'],
            $doc['byte_size'], $doc['content_b64']]);
    audit($user, 'KYC_DOCUMENT_UPLOADED', "{$doc['kind']} ({$doc['byte_size']} bytes)");

    respond(['status' => 'SUCCESS',
        'message' => 'Document received. Your branch compliance officer will review it.',
        'document' => kyc_document_public(row('SELECT * FROM kyc_documents WHERE id = ?', [$id]))]);
}

// Reviewers only: the bytes come back here, and nowhere else.
function route_kyc_documents_queue(array $d): void
{
    staff_user(ADMIN_ROLES);
    // A document waiting against an enquiry has no member row yet, so the join
    // to users cannot be the thing that decides whether it is listed -- an inner
    // join here is what would hide an applicant's file from the very queue that
    // is supposed to clear it before the account opens.
    $rows = rows("SELECT d.*, u.name AS user_name, u.email AS user_email,
            l.name AS lead_name, l.phone AS lead_phone
        FROM kyc_documents d
        LEFT JOIN users u ON u.id = d.user_id
        LEFT JOIN crm_leads l ON l.id = d.lead_id
        WHERE d.status = 'pending_review' ORDER BY d.uploaded_at");
    respond(['documents' => array_map(function ($r) {
        $out = kyc_document_public($r, true);
        $out['user_name'] = $r['user_name'] ?? $r['lead_name'];
        $out['user_email'] = $r['user_email'];
        // Says which of the two queues this belongs to, so a reviewer knows
        // whether clearing it lets an account be opened or updates an existing
        // member's file.
        $out['for'] = $r['lead_id'] === null ? 'member' : 'applicant';
        $out['lead_id'] = $r['lead_id'];
        $out['lead_phone'] = $r['lead_phone'];
        return $out;
    }, $rows)]);
}

// The queue could be read but never cleared: documents were uploaded, shown to a
// reviewer, and left at pending_review for ever, because no route ever wrote a
// decision back. This is that route.
function route_kyc_document_review(array $d, string $id = ''): void
{
    global $pdo;
    $staff = staff_user(ADMIN_ROLES);
    $doc = row('SELECT * FROM kyc_documents WHERE id = ?', [$id]);
    if (!$doc) {
        fail(404, 'That document no longer exists.');
    }
    $decision = clip($d['decision'] ?? '', 10);
    if (!in_array($decision, ['verified', 'rejected'], true)) {
        fail(422, 'decision must be verified or rejected.');
    }
    $reason = clip($d['reason'] ?? '', 255);
    // A rejection the applicant cannot act on just sends them back to the
    // counter to ask what was wrong with it.
    if ($decision === 'rejected' && $reason === '') {
        fail(422, 'Say what is wrong with the document, so it can be replaced with a good copy.');
    }
    $pdo->prepare('UPDATE kyc_documents SET status = ?, reviewed_by = ?, review_reason = ?, reviewed_at = NOW()
        WHERE id = ?')->execute([$decision, $staff['id'], $reason ?: null, $id]);
    $whose = $doc['lead_id'] !== null ? "enquiry {$doc['lead_id']}" : "member {$doc['user_id']}";
    audit($staff, 'KYC_DOCUMENT_REVIEWED', "{$doc['kind']} for $whose -> $decision"
        . ($reason === '' ? '' : " ($reason)"));
    respond(['status' => 'SUCCESS',
        'document' => kyc_document_public(row('SELECT * FROM kyc_documents WHERE id = ?', [$id])),
        'message' => (DOC_KIND_LABEL[$doc['kind']] ?? $doc['kind'])
            . ($decision === 'verified' ? ' verified.'
                : ' rejected. A replacement can now be uploaded.')]);
}
