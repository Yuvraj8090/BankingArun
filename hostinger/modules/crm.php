<?php
// AJSPay: the member relationship desk.
//
// Three things a teller actually needs and a core banking screen never gives
// them: everything about one member on a single screen, a record of what was
// said last time, and a list of who to call today.
//
// It is staff-only throughout. A member has no route into any of it — their own
// history is their statements and their tickets, not our notes about them.
declare(strict_types=1);

const CRM_ROLES = ['staff', 'admin', 'branch_manager', 'bank_owner'];
const CRM_MANAGE_ROLES = ['admin', 'branch_manager', 'bank_owner'];
const CRM_CHANNELS = ['call', 'visit', 'email', 'sms', 'whatsapp', 'note'];
const CRM_OUTCOMES = ['reached', 'no_answer', 'callback', 'resolved', 'escalated'];
const LEAD_STAGES = ['new', 'contacted', 'documents', 'enrolled', 'lost'];
const LEAD_SOURCES = ['walk_in', 'referral', 'agent', 'campaign', 'phone', 'website'];
const TASK_STATUSES = ['open', 'done', 'cancelled'];

// --- Member 360 --------------------------------------------------------------------------
// One read that answers "who is this and what is going on with them".
function route_crm_member(array $d, string $id = ''): void
{
    staff_user(CRM_ROLES);
    $member = row('SELECT * FROM users WHERE id = ? OR email = ?', [$id, $id]);
    if (!$member) {
        fail(404, 'Member not found.');
    }
    $uid = $member['id'];
    $accounts = out_all(rows('SELECT * FROM accounts WHERE user_id = ? ORDER BY created_at', [$uid]));

    // A relationship value that is honest about what it counts: money the member
    // has with us, less what we have lent them.
    $balances = (float)array_sum(array_column($accounts, 'balance'));
    $deposits = (float)scalar("SELECT COALESCE(SUM(principal_amount), 0) FROM deposits
        WHERE user_id = ? AND status = 'active'", [$uid]);
    $borrowed = (float)scalar("SELECT COALESCE(SUM(amount), 0) FROM loan_applications
        WHERE user_id = ? AND status IN ('approved', 'disbursed')", [$uid]);

    respond([
        'member' => public_user($member),
        'accounts' => $accounts,
        'relationship' => [
            'balances' => round($balances, 2),
            'active_deposits' => round($deposits, 2),
            'borrowed' => round($borrowed, 2),
            'net_relationship_value' => round($balances + $deposits - $borrowed, 2),
            'member_since' => iso($member['created_at']),
            'days_with_us' => (int)((time() - strtotime($member['created_at'])) / 86400),
        ],
        'deposits' => out_all(rows('SELECT deposit_number, deposit_type, principal_amount, interest_rate,
            maturity_amount, maturity_date, status FROM deposits WHERE user_id = ?
            ORDER BY created_at DESC LIMIT 20', [$uid])),
        'loans' => out_all(rows('SELECT loan_application_no, loan_type, amount, calculated_emi, risk_grade,
            eligibility_status, status, created_at FROM loan_applications WHERE user_id = ?
            ORDER BY created_at DESC LIMIT 20', [$uid])),
        'recent_transactions' => out_all(rows('SELECT timestamp, type, mode, amount, counterparty_name,
            ref_number FROM transactions WHERE user_id = ? ORDER BY timestamp DESC LIMIT 10', [$uid])),
        'standing_instructions' => out_all(rows("SELECT beneficiary_name, amount, frequency, next_run, status,
            last_status, last_error FROM standing_instructions WHERE user_id = ? ORDER BY created_at DESC", [$uid])),
        'tickets' => out_all(rows('SELECT ticket_id, subject, status, priority, due_at, created_at
            FROM support_tickets WHERE user_id = ? ORDER BY created_at DESC LIMIT 10', [$uid])),
        // Staff need to know a member is under review; the member is never told.
        'open_fraud_alerts' => (int)scalar("SELECT COUNT(*) FROM fraud_alerts
            WHERE user_id = ? AND status = 'open'", [$uid]),
        'interactions' => out_all(rows('SELECT * FROM crm_interactions WHERE member_user_id = ?
            ORDER BY created_at DESC LIMIT 20', [$uid])),
        'open_tasks' => out_all(rows("SELECT * FROM crm_tasks WHERE member_user_id = ? AND status = 'open'
            ORDER BY due_on", [$uid])),
        'kyc' => ['status' => $member['kyc_status'], 'reason' => $member['kyc_reason'],
            'pan_on_file' => $member['pan_number'] !== null, 'aadhaar_on_file' => $member['aadhaar_number'] !== null],
    ]);
}

function route_crm_members(array $d): void
{
    staff_user(CRM_ROLES);
    $sql = "SELECT u.id, u.name, u.email, u.phone, u.role, u.kyc_status, u.branch, u.created_at,
            (SELECT COALESCE(SUM(a.balance), 0) FROM accounts a WHERE a.user_id = u.id) AS balances,
            (SELECT COUNT(*) FROM crm_tasks t WHERE t.member_user_id = u.id AND t.status = 'open') AS open_tasks,
            (SELECT MAX(i.created_at) FROM crm_interactions i WHERE i.member_user_id = u.id) AS last_contact
        FROM users u WHERE u.role IN ('retail', 'corporate')";
    $params = [];
    if (!empty($_GET['q'])) {
        $sql .= ' AND (u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)';
        $like = '%' . clip($_GET['q'], 60) . '%';
        array_push($params, $like, $like, $like);
    }
    if (!empty($_GET['kyc_status'])) {
        $sql .= ' AND u.kyc_status = ?';
        $params[] = clip($_GET['kyc_status'], 30);
    }
    if (!empty($_GET['uncontacted'])) {
        $sql .= ' AND NOT EXISTS (SELECT 1 FROM crm_interactions i WHERE i.member_user_id = u.id)';
    }
    $sql .= ' ORDER BY u.name';
    [$members, $meta] = paginate($sql, $params, 25, 100);
    respond(['members' => array_map(function ($m) {
        $m = out($m);
        $m['balances'] = (float)$m['balances'];
        $m['open_tasks'] = (int)$m['open_tasks'];
        $m['last_contact'] = $m['last_contact'] ? iso((string)$m['last_contact']) : null;
        return $m;
    }, $members), 'pagination' => $meta]);
}

// --- Interactions ------------------------------------------------------------------------
function route_crm_log_interaction(array $d): void
{
    global $pdo;
    $staff = staff_user(CRM_ROLES);
    need($d, 'channel', 'subject');
    $channel = clip($d['channel'], 20);
    if (!in_array($channel, CRM_CHANNELS, true)) {
        fail(422, 'channel must be one of: ' . implode(', ', CRM_CHANNELS));
    }
    $memberId = clip($d['member_user_id'] ?? '', 36) ?: null;
    $leadId = clip($d['lead_id'] ?? '', 36) ?: null;
    if ($memberId === null && $leadId === null) {
        fail(422, 'Log the interaction against a member or a lead.');
    }
    if ($memberId !== null && !row('SELECT id FROM users WHERE id = ?', [$memberId])) {
        fail(404, 'Member not found.');
    }
    if ($leadId !== null && !row('SELECT id FROM crm_leads WHERE id = ?', [$leadId])) {
        fail(404, 'Lead not found.');
    }
    $outcome = clip($d['outcome'] ?? '', 30);
    if ($outcome !== '' && !in_array($outcome, CRM_OUTCOMES, true)) {
        fail(422, 'outcome must be one of: ' . implode(', ', CRM_OUTCOMES));
    }
    $id = uuid4();
    $pdo->prepare('INSERT INTO crm_interactions (id, member_user_id, lead_id, channel, direction, subject, notes,
            outcome, follow_up_on, recorded_by, recorded_by_name)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        ->execute([$id, $memberId, $leadId, $channel,
            ($d['direction'] ?? 'outbound') === 'inbound' ? 'inbound' : 'outbound',
            clip($d['subject'], 200), clip($d['notes'] ?? '', 2000) ?: null, $outcome ?: null,
            empty($d['follow_up_on']) ? null : valid_date($d['follow_up_on'], 'follow_up_on'),
            $staff['id'], $staff['name']]);

    // A follow-up date without a task is a promise nobody keeps, so make one.
    if (!empty($d['follow_up_on'])) {
        $pdo->prepare('INSERT INTO crm_tasks (id, title, details, member_user_id, lead_id, assigned_to, due_on,
                priority, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
            ->execute([uuid4(), 'Follow up: ' . clip($d['subject'], 150), clip($d['notes'] ?? '', 500) ?: null,
                $memberId, $leadId, $staff['id'], valid_date($d['follow_up_on'], 'follow_up_on'),
                'MEDIUM', $staff['id']]);
    }
    audit($staff, 'CRM_INTERACTION', "$channel with " . ($memberId ?? $leadId));
    respond(['status' => 'SUCCESS', 'id' => $id,
        'message' => 'Interaction logged.' . (!empty($d['follow_up_on']) ? ' A follow-up task was created.' : '')]);
}

// --- Leads -------------------------------------------------------------------------------
function route_crm_leads(array $d): void
{
    staff_user(CRM_ROLES);
    $sql = 'SELECT l.*, a.name AS agent_name FROM crm_leads l LEFT JOIN agents a ON a.id = l.agent_id WHERE 1 = 1';
    $params = [];
    if (!empty($_GET['stage']) && in_array($_GET['stage'], LEAD_STAGES, true)) {
        $sql .= ' AND l.stage = ?';
        $params[] = $_GET['stage'];
    }
    if (!empty($_GET['q'])) {
        $sql .= ' AND (l.name LIKE ? OR l.phone LIKE ? OR l.email LIKE ?)';
        $like = '%' . clip($_GET['q'], 60) . '%';
        array_push($params, $like, $like, $like);
    }
    $sql .= " ORDER BY FIELD(l.stage, 'documents', 'contacted', 'new', 'enrolled', 'lost'), l.updated_at DESC";
    [$leads, $meta] = paginate($sql, $params, 25, 100);
    $byStage = [];
    foreach (rows('SELECT stage, COUNT(*) AS n FROM crm_leads GROUP BY stage') as $r) {
        $byStage[$r['stage']] = (int)$r['n'];
    }
    respond(['leads' => out_all($leads), 'pagination' => $meta, 'by_stage' => (object)$byStage,
        'stages' => LEAD_STAGES, 'sources' => LEAD_SOURCES]);
}

function route_crm_lead_create(array $d): void
{
    global $pdo;
    $staff = staff_user(CRM_ROLES);
    need($d, 'name', 'phone');
    $phone = clip($d['phone'], 30);
    // The same person walking in twice should not become two pipelines.
    if ($existing = row('SELECT id, name, stage FROM crm_leads WHERE phone = ?', [$phone])) {
        fail(400, "A lead for this number already exists ({$existing['name']}, {$existing['stage']}).");
    }
    $source = clip($d['source'] ?? 'walk_in', 30);
    $id = uuid4();
    $pdo->prepare('INSERT INTO crm_leads (id, name, phone, email, source, interest, stage, assigned_to, agent_id,
            notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        ->execute([$id, clip($d['name'], 150), $phone, clip($d['email'] ?? '', 150) ?: null,
            in_array($source, LEAD_SOURCES, true) ? $source : 'walk_in', clip($d['interest'] ?? '', 30) ?: null,
            'new', clip($d['assigned_to'] ?? '', 36) ?: $staff['id'], clip($d['agent_id'] ?? '', 36) ?: null,
            clip($d['notes'] ?? '', 500) ?: null, $staff['id']]);
    audit($staff, 'CRM_LEAD_CREATED', clip($d['name'], 100) . " ($phone)");
    respond(['status' => 'SUCCESS', 'id' => $id, 'message' => 'Lead added to the pipeline.']);
}

function route_crm_lead_update(array $d, string $id = ''): void
{
    global $pdo;
    $staff = staff_user(CRM_ROLES);
    $lead = row('SELECT * FROM crm_leads WHERE id = ?', [$id]);
    if (!$lead) {
        fail(404, 'Lead not found.');
    }
    $stage = clip($d['stage'] ?? $lead['stage'], 20);
    if (!in_array($stage, LEAD_STAGES, true)) {
        fail(422, 'stage must be one of: ' . implode(', ', LEAD_STAGES));
    }
    if ($stage === 'lost' && clip($d['lost_reason'] ?? $lead['lost_reason'] ?? '', 255) === '') {
        fail(422, 'Record why this lead was lost — it is the only way the pipeline teaches you anything.');
    }
    $converted = clip($d['converted_user_id'] ?? '', 36) ?: $lead['converted_user_id'];
    if ($stage === 'enrolled' && $converted === null) {
        fail(422, 'Link the member account this lead became before marking it enrolled.');
    }
    if ($converted !== null && !row('SELECT id FROM users WHERE id = ?', [$converted])) {
        fail(404, 'That member account does not exist.');
    }
    $pdo->prepare('UPDATE crm_leads SET stage = ?, assigned_to = ?, interest = ?, notes = ?, lost_reason = ?,
            converted_user_id = ? WHERE id = ?')
        ->execute([$stage, clip($d['assigned_to'] ?? $lead['assigned_to'] ?? '', 36) ?: null,
            clip($d['interest'] ?? $lead['interest'] ?? '', 30) ?: null,
            clip($d['notes'] ?? $lead['notes'] ?? '', 500) ?: null,
            clip($d['lost_reason'] ?? $lead['lost_reason'] ?? '', 255) ?: null, $converted, $id]);
    audit($staff, 'CRM_LEAD_UPDATED', "{$lead['name']} -> $stage");
    respond(['status' => 'SUCCESS', 'message' => "{$lead['name']} moved to $stage."]);
}

// --- Tasks -------------------------------------------------------------------------------
function route_crm_tasks(array $d): void
{
    $staff = staff_user(CRM_ROLES);
    $sql = "SELECT t.*, u.name AS member_name, l.name AS lead_name, s.name AS assignee_name
        FROM crm_tasks t
        LEFT JOIN users u ON u.id = t.member_user_id
        LEFT JOIN crm_leads l ON l.id = t.lead_id
        LEFT JOIN users s ON s.id = t.assigned_to
        WHERE 1 = 1";
    $params = [];
    // Default to my own open work; a manager can ask for everyone's.
    if (empty($_GET['all'])) {
        $sql .= ' AND t.assigned_to = ?';
        $params[] = $staff['id'];
    }
    $status = $_GET['status'] ?? 'open';
    if (in_array($status, TASK_STATUSES, true)) {
        $sql .= ' AND t.status = ?';
        $params[] = $status;
    }
    $sql .= ' ORDER BY t.due_on, FIELD(t.priority, \'URGENT\', \'HIGH\', \'MEDIUM\', \'LOW\')';
    [$tasks, $meta] = paginate($sql, $params, 25, 100);
    $today = (new DateTimeImmutable('today', new DateTimeZone(IST)))->format('Y-m-d');
    respond(['tasks' => array_map(function ($t) use ($today) {
        $t = out($t);
        $t['overdue'] = $t['status'] === 'open' && $t['due_on'] < $today;
        return $t;
    }, $tasks), 'pagination' => $meta, 'counts' => [
        'mine_open' => (int)scalar("SELECT COUNT(*) FROM crm_tasks WHERE assigned_to = ? AND status = 'open'",
            [$staff['id']]),
        'mine_overdue' => (int)scalar("SELECT COUNT(*) FROM crm_tasks WHERE assigned_to = ? AND status = 'open'
            AND due_on < ?", [$staff['id'], $today]),
        'due_today' => (int)scalar("SELECT COUNT(*) FROM crm_tasks WHERE assigned_to = ? AND status = 'open'
            AND due_on = ?", [$staff['id'], $today]),
    ]]);
}

function route_crm_task_create(array $d): void
{
    global $pdo;
    $staff = staff_user(CRM_ROLES);
    need($d, 'title', 'due_on');
    $assignee = clip($d['assigned_to'] ?? '', 36) ?: $staff['id'];
    if ($assignee !== $staff['id']) {
        $target = row('SELECT id, role FROM users WHERE id = ?', [$assignee]);
        if (!$target || !in_array($target['role'], CRM_ROLES, true)) {
            fail(422, 'Tasks can only be assigned to staff.');
        }
    }
    $priority = strtoupper(clip($d['priority'] ?? 'MEDIUM', 10));
    $id = uuid4();
    $pdo->prepare('INSERT INTO crm_tasks (id, title, details, member_user_id, lead_id, assigned_to, due_on,
            priority, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        ->execute([$id, clip($d['title'], 200), clip($d['details'] ?? '', 500) ?: null,
            clip($d['member_user_id'] ?? '', 36) ?: null, clip($d['lead_id'] ?? '', 36) ?: null,
            $assignee, valid_date($d['due_on'], 'due_on'),
            in_array($priority, TICKET_PRIORITIES, true) ? $priority : 'MEDIUM', $staff['id']]);
    audit($staff, 'CRM_TASK_CREATED', clip($d['title'], 100));
    respond(['status' => 'SUCCESS', 'id' => $id, 'message' => 'Task created.']);
}

function route_crm_task_update(array $d, string $id = ''): void
{
    global $pdo;
    $staff = staff_user(CRM_ROLES);
    $task = row('SELECT * FROM crm_tasks WHERE id = ?', [$id]);
    if (!$task) {
        fail(404, 'Task not found.');
    }
    $status = clip($d['status'] ?? 'done', 15);
    if (!in_array($status, TASK_STATUSES, true)) {
        fail(422, 'status must be one of: ' . implode(', ', TASK_STATUSES));
    }
    if ($status !== 'open' && clip($d['completion_note'] ?? '', 500) === '') {
        fail(422, 'Say what happened before closing the task.');
    }
    $pdo->prepare('UPDATE crm_tasks SET status = ?, completion_note = ?,
            completed_at = CASE WHEN ? = \'open\' THEN NULL ELSE ? END WHERE id = ?')
        ->execute([$status, clip($d['completion_note'] ?? '', 500) ?: null, $status, now_utc(), $id]);
    audit($staff, 'CRM_TASK_' . strtoupper($status), $task['title']);
    respond(['status' => 'SUCCESS', 'message' => "Task marked $status."]);
}

// --- Public membership enquiry ---------------------------------------------------------
// A Nidhi may not enrol a member off a web form: identity documents have to be seen and
// verified. So the public site takes an enquiry, drops it into the same pipeline a walk-in
// lands in, and the sales desk carries it from 'new' through 'documents' to 'enrolled'.
const ENQUIRY_INTERESTS = ['savings', 'deposit', 'loan', 'other'];

function route_public_enquiry(array $d): void
{
    global $pdo;
    // Unauthenticated and public, so it is rate limited by address: a form like
    // this is otherwise free to flood the sales desk with junk.
    rate_limit('enquiry:' . client_ip(), 5, 3600,
        'Too many enquiries from this connection. Please try again later, or call us on 9105015464.');
    // Checked first: a bot should not get as far as having its input validated.
    captcha_verify($d);

    need($d, 'name', 'phone');
    $name = clip($d['name'], 150);
    $phone = clip($d['phone'], 30);
    if (mb_strlen($name) < 2) {
        fail(422, 'Please tell us your full name.');
    }
    // Indian mobile numbers, with or without the country code and separators.
    $digits = preg_replace('/\D+/', '', $phone);
    if (!preg_match('/^(91)?[6-9]\d{9}$/', $digits)) {
        fail(422, 'Please enter a valid 10-digit Indian mobile number.');
    }
    $email = clip($d['email'] ?? '', 150);
    if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        fail(422, 'That email address does not look right.');
    }
    $interest = clip($d['interest'] ?? '', 30);
    if ($interest !== '' && !in_array($interest, ENQUIRY_INTERESTS, true)) {
        fail(422, 'Please choose what you are interested in.');
    }

    $notes = clip($d['notes'] ?? '', 400);
    // Kept as a column, not appended to the notes. A code in free text cannot be
    // read back when the account is finally opened, which is where the bonus is
    // paid — so a shared link used to go nowhere.
    $referral = strtoupper(clip($d['referral_code'] ?? '', 40));

    // Someone enquiring twice should not become two pipelines, and the reply must
    // not reveal whether a number is already on file — that would turn this form
    // into a way of testing who is a member.
    $existing = row('SELECT id FROM crm_leads WHERE phone = ? AND stage NOT IN (?, ?)',
        [$phone, 'lost', 'enrolled']);
    if (!$existing) {
        $pdo->prepare('INSERT INTO crm_leads (id, name, phone, email, source, interest, stage, notes,
                referral_code, referral_status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            ->execute([uuid4(), $name, $phone, $email ?: null, 'website',
                $interest ?: null, 'new', $notes ?: null,
                $referral ?: null, $referral === '' ? null : 'pending']);
    }
    respond(['status' => 'SUCCESS',
        'message' => 'Thank you. Our team will call you within one working day to arrange your document verification.']);
}
