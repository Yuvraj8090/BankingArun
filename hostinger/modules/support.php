<?php
// AJSPay: the support desk. A member raises a query, it lands in a staff queue
// with a deadline, and the two sides hold a threaded conversation until it is
// resolved.
//
// Two rules shape the code. A member may only ever see their own tickets, and
// may never see an internal note — staff notes are stripped before anything is
// returned to a member, rather than merely hidden in the UI. And the clock is
// the regulator's, not ours: the Consumer Protection Act expects a named
// grievance officer and a stated turnaround, so every ticket carries a deadline
// from the moment it is raised.
declare(strict_types=1);

const SUPPORT_STAFF_ROLES = ['staff', 'admin', 'branch_manager', 'bank_owner'];
const TICKET_STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING_MEMBER', 'RESOLVED', 'CLOSED'];
const TICKET_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
// Hours allowed before a ticket of each priority breaches its deadline.
const TICKET_SLA_HOURS = ['URGENT' => 4, 'HIGH' => 24, 'MEDIUM' => 72, 'LOW' => 120];

// Published so members can escalate. Set these from System Config; the defaults
// make it obvious they have not been.
function grievance_officer(): array
{
    $config = system_config();
    return [
        'name' => $config['grievance_officer_name'] ?? 'Not yet appointed',
        'email' => $config['grievance_officer_email'] ?? null,
        'phone' => $config['grievance_officer_phone'] ?? null,
        'escalation' => 'If your complaint is not resolved within 30 days you may approach the Registrar of '
            . 'Companies, or the consumer forum with jurisdiction. As a Nidhi company this institution is not '
            . 'covered by the RBI Integrated Ombudsman Scheme.',
        'configured' => isset($config['grievance_officer_name']),
    ];
}

function sla_deadline(string $priority): string
{
    $hours = TICKET_SLA_HOURS[$priority] ?? 72;
    return (new DateTimeImmutable('now'))->modify("+$hours hours")->format('Y-m-d H:i:s');
}

function ticket_public(array $ticket, bool $forStaff): array
{
    $ticket = out($ticket);
    foreach (['due_at', 'first_response_at', 'resolved_at', 'last_message_at'] as $field) {
        $ticket[$field] = empty($ticket[$field]) ? null : iso((string)$ticket[$field]);
    }
    $ticket['unread'] = (int)($forStaff ? $ticket['unread_for_staff'] : $ticket['unread_for_member']);
    $ticket['overdue'] = $ticket['due_at'] !== null
        && !in_array($ticket['status'], ['RESOLVED', 'CLOSED'], true)
        && $ticket['due_at'] < iso(now_utc());
    if (!$forStaff) {
        // Internal routing details are none of the member's business.
        unset($ticket['assigned_user_id'], $ticket['unread_for_staff'], $ticket['unread_for_member']);
    }
    return $ticket;
}

// Finds a ticket the caller is entitled to see, or fails. Staff see any ticket;
// a member sees only their own, whichever id they guess.
function ticket_for(array $user, string $id, bool &$isStaff): array
{
    $isStaff = in_array($user['role'], SUPPORT_STAFF_ROLES, true);
    $ticket = row('SELECT * FROM support_tickets WHERE id = ? OR ticket_id = ?', [$id, $id]);
    if (!$ticket || (!$isStaff && $ticket['user_id'] !== $user['id'])) {
        fail(404, 'Ticket not found.');   // same answer either way: no probing
    }
    return $ticket;
}

// --- Member view -----------------------------------------------------------------------
function route_ticket_detail(array $d, string $id = ''): void
{
    global $pdo;
    $user = current_user();
    $isStaff = false;
    $ticket = ticket_for($user, $id, $isStaff);

    $sql = 'SELECT * FROM ticket_messages WHERE ticket_id = ?';
    $params = [$ticket['id']];
    if (!$isStaff) {
        $sql .= ' AND internal = 0';      // stripped server-side, not hidden in the UI
    }
    $messages = rows("$sql ORDER BY created_at", $params);

    // Opening the thread clears the unread flag for whoever is reading it.
    $column = $isStaff ? 'unread_for_staff' : 'unread_for_member';
    $pdo->prepare("UPDATE support_tickets SET $column = 0 WHERE id = ?")->execute([$ticket['id']]);

    respond([
        'ticket' => ticket_public($ticket, $isStaff),
        'messages' => array_map(fn($m) => ['id' => $m['id'], 'author_name' => $m['author_name'],
            'author_role' => $m['author_role'], 'body' => $m['body'],
            'internal' => (bool)$m['internal'], 'created_at' => iso($m['created_at'])], $messages),
        'grievance_officer' => grievance_officer(),
        'can_reply' => !in_array($ticket['status'], ['CLOSED'], true),
    ]);
}

function route_ticket_reply(array $d, string $id = ''): void
{
    global $pdo;
    $user = current_user();
    $isStaff = false;
    $ticket = ticket_for($user, $id, $isStaff);
    need($d, 'body');
    $body = clip($d['body'], 4000);
    if (mb_strlen($body) < 2) {
        fail(422, 'Write a message before sending.');
    }
    if ($ticket['status'] === 'CLOSED') {
        fail(400, 'This ticket is closed. Please raise a new one.');
    }
    // Only staff can leave an internal note, and only staff ever read one.
    $internal = $isStaff && !empty($d['internal']);

    $pdo->beginTransaction();
    $pdo->prepare('INSERT INTO ticket_messages (id, ticket_id, author_user_id, author_name, author_role, body, internal)
        VALUES (?, ?, ?, ?, ?, ?, ?)')
        ->execute([uuid4(), $ticket['id'], $user['id'], $user['name'], $isStaff ? 'staff' : 'member',
            $body, (int)$internal]);

    $now = now_utc();
    if ($internal) {
        $pdo->prepare('UPDATE support_tickets SET last_message_at = ? WHERE id = ?')->execute([$now, $ticket['id']]);
    } elseif ($isStaff) {
        // First staff reply stops the response clock.
        $pdo->prepare("UPDATE support_tickets SET last_message_at = ?, unread_for_member = unread_for_member + 1,
                first_response_at = COALESCE(first_response_at, ?),
                status = CASE WHEN status = 'OPEN' THEN 'WAITING_MEMBER' ELSE status END
            WHERE id = ?")->execute([$now, $now, $ticket['id']]);
    } else {
        // A member replying to a resolved ticket reopens it.
        $pdo->prepare("UPDATE support_tickets SET last_message_at = ?, unread_for_staff = unread_for_staff + 1,
                status = CASE WHEN status IN ('RESOLVED', 'WAITING_MEMBER') THEN 'IN_PROGRESS' ELSE status END
            WHERE id = ?")->execute([$now, $ticket['id']]);
    }
    audit($user, 'TICKET_REPLY', $ticket['ticket_id'] . ($internal ? ' (internal note)' : ''));
    $pdo->commit();
    respond(['status' => 'SUCCESS',
        'message' => $internal ? 'Internal note added. The member cannot see it.' : 'Reply sent.']);
}

// --- Staff desk ------------------------------------------------------------------------
function route_support_queue(array $d): void
{
    $staff = staff_user(SUPPORT_STAFF_ROLES);
    $sql = 'SELECT * FROM support_tickets WHERE 1 = 1';
    $params = [];
    if (!empty($_GET['status']) && in_array($_GET['status'], TICKET_STATUSES, true)) {
        $sql .= ' AND status = ?';
        $params[] = $_GET['status'];
    }
    if (!empty($_GET['priority']) && in_array($_GET['priority'], TICKET_PRIORITIES, true)) {
        $sql .= ' AND priority = ?';
        $params[] = $_GET['priority'];
    }
    if (!empty($_GET['mine'])) {
        $sql .= ' AND assigned_user_id = ?';
        $params[] = $staff['id'];
    }
    if (!empty($_GET['q'])) {
        $sql .= ' AND (ticket_id LIKE ? OR subject LIKE ? OR user_email LIKE ?)';
        $like = '%' . clip($_GET['q'], 60) . '%';
        array_push($params, $like, $like, $like);
    }
    // Overdue first, then by priority, then oldest.
    $sql .= " ORDER BY CASE WHEN status IN ('RESOLVED','CLOSED') THEN 1 ELSE 0 END,
        FIELD(priority, 'URGENT', 'HIGH', 'MEDIUM', 'LOW'), due_at";
    [$tickets, $meta] = paginate($sql, $params, 25, 100);
    respond([
        'tickets' => array_map(fn($t) => ticket_public($t, true), $tickets),
        'pagination' => $meta,
        'counts' => [
            'open' => (int)scalar("SELECT COUNT(*) FROM support_tickets WHERE status = 'OPEN'"),
            'in_progress' => (int)scalar("SELECT COUNT(*) FROM support_tickets WHERE status = 'IN_PROGRESS'"),
            'waiting_member' => (int)scalar("SELECT COUNT(*) FROM support_tickets WHERE status = 'WAITING_MEMBER'"),
            'overdue' => (int)scalar("SELECT COUNT(*) FROM support_tickets
                WHERE status NOT IN ('RESOLVED','CLOSED') AND due_at IS NOT NULL AND due_at < ?", [now_utc()]),
            'unread' => (int)scalar('SELECT COUNT(*) FROM support_tickets WHERE unread_for_staff > 0'),
            'mine' => (int)scalar('SELECT COUNT(*) FROM support_tickets WHERE assigned_user_id = ?', [$staff['id']]),
        ],
        'statuses' => TICKET_STATUSES,
        'priorities' => TICKET_PRIORITIES,
        'sla_hours' => TICKET_SLA_HOURS,
    ]);
}

function route_ticket_assign(array $d, string $id = ''): void
{
    global $pdo;
    $staff = staff_user(SUPPORT_STAFF_ROLES);
    $ticket = row('SELECT * FROM support_tickets WHERE id = ? OR ticket_id = ?', [$id, $id]);
    if (!$ticket) {
        fail(404, 'Ticket not found.');
    }
    // Default to claiming it yourself; a manager may hand it to someone else.
    $assignee = $staff;
    if (!empty($d['assignee_id']) && $d['assignee_id'] !== $staff['id']) {
        $assignee = row('SELECT * FROM users WHERE id = ?', [clip($d['assignee_id'], 36)]);
        if (!$assignee || !in_array($assignee['role'], SUPPORT_STAFF_ROLES, true)) {
            fail(422, 'Tickets can only be assigned to support staff.');
        }
    }
    $pdo->prepare("UPDATE support_tickets SET assigned_user_id = ?, assigned_to = ?,
            status = CASE WHEN status = 'OPEN' THEN 'IN_PROGRESS' ELSE status END WHERE id = ?")
        ->execute([$assignee['id'], $assignee['name'], $ticket['id']]);
    audit($staff, 'TICKET_ASSIGNED', "{$ticket['ticket_id']} to {$assignee['email']}");
    respond(['status' => 'SUCCESS', 'message' => "{$ticket['ticket_id']} assigned to {$assignee['name']}."]);
}

function route_ticket_status(array $d, string $id = ''): void
{
    global $pdo;
    $staff = staff_user(SUPPORT_STAFF_ROLES);
    need($d, 'status');
    $status = strtoupper(clip($d['status'], 20));
    if (!in_array($status, TICKET_STATUSES, true)) {
        fail(422, 'status must be one of: ' . implode(', ', TICKET_STATUSES));
    }
    $ticket = row('SELECT * FROM support_tickets WHERE id = ? OR ticket_id = ?', [$id, $id]);
    if (!$ticket) {
        fail(404, 'Ticket not found.');
    }
    $note = clip($d['resolution_note'] ?? '', 500);
    if (in_array($status, ['RESOLVED', 'CLOSED'], true) && $note === '') {
        fail(422, 'Record how this was resolved before closing it.');
    }
    $priority = strtoupper(clip($d['priority'] ?? '', 10));
    $newDue = null;
    if ($priority !== '' && in_array($priority, TICKET_PRIORITIES, true) && $priority !== $ticket['priority']) {
        $newDue = sla_deadline($priority);   // re-prioritising resets the clock
    }
    $pdo->prepare('UPDATE support_tickets SET status = ?, priority = COALESCE(NULLIF(?, \'\'), priority),
            due_at = COALESCE(?, due_at), resolution_note = COALESCE(NULLIF(?, \'\'), resolution_note),
            resolved_at = CASE WHEN ? IN (\'RESOLVED\', \'CLOSED\') THEN COALESCE(resolved_at, ?) ELSE NULL END,
            unread_for_member = unread_for_member + 1
        WHERE id = ?')
        ->execute([$status, $priority, $newDue, $note, $status, now_utc(), $ticket['id']]);
    audit($staff, 'TICKET_STATUS', "{$ticket['ticket_id']} -> $status");
    respond(['status' => 'SUCCESS', 'message' => "{$ticket['ticket_id']} is now $status."]);
}

// Drives the bell in the header for whichever side is asking.
function route_support_notifications(array $d): void
{
    $user = current_user();
    if (in_array($user['role'], SUPPORT_STAFF_ROLES, true)) {
        respond([
            'unread_tickets' => (int)scalar('SELECT COUNT(*) FROM support_tickets WHERE unread_for_staff > 0'),
            'assigned_to_me' => (int)scalar("SELECT COUNT(*) FROM support_tickets
                WHERE assigned_user_id = ? AND status NOT IN ('RESOLVED','CLOSED')", [$user['id']]),
            'overdue' => (int)scalar("SELECT COUNT(*) FROM support_tickets
                WHERE status NOT IN ('RESOLVED','CLOSED') AND due_at IS NOT NULL AND due_at < ?", [now_utc()]),
        ]);
    }
    respond([
        'unread_tickets' => (int)scalar('SELECT COUNT(*) FROM support_tickets
            WHERE user_id = ? AND unread_for_member > 0', [$user['id']]),
        'open_tickets' => (int)scalar("SELECT COUNT(*) FROM support_tickets
            WHERE user_id = ? AND status NOT IN ('RESOLVED','CLOSED')", [$user['id']]),
        'grievance_officer' => grievance_officer(),
    ]);
}

// What the bell in the top bar shows: things this person should act on, worked out
// from the data each time (nothing to mark read). Each item names the /app tab that
// deals with it; the app only links it if the role can open that tab.
function route_notifications(array $d): void
{
    $user = current_user();
    $today = (new DateTimeImmutable('now', new DateTimeZone(IST)))->format('Y-m-d');
    $items = [];
    $add = function (string $title, string $detail, string $tab, string $tone = 'info') use (&$items): void {
        $items[] = ['title' => $title, 'detail' => $detail, 'tab' => $tab, 'tone' => $tone];
    };
    $count = fn(string $sql, array $p = []) => (int)scalar($sql, $p);

    if (in_array($user['role'], ['retail', 'corporate'], true)) {
        if ($user['kyc_status'] !== 'verified') {
            $add('Verify your KYC', 'You cannot move money or open deposits until your KYC is verified.', 'video-kyc', 'warn');
        }
        $review = scalar("SELECT next_kyc_review FROM member_register WHERE user_id = ? AND status = 'active'", [$user['id']]);
        if ($review && $review <= date('Y-m-d', strtotime("$today +30 days"))) {
            $add('KYC review due', 'Please refresh your KYC documents by ' . date('j M Y', strtotime($review)) . '.', 'kyc',
                $review < $today ? 'warn' : 'info');
        }
        foreach (rows("SELECT * FROM deposits WHERE user_id = ? AND status = 'active' AND instalment_amount > 0
                AND paid_amount < principal_amount ORDER BY created_at LIMIT 5", [$user['id']]) as $dep) {
            $o = instalments_owed($dep, $today);
            if ($o['owed'] >= (float)$dep['instalment_amount'] - 0.005) {
                $add('Instalment due on ' . $dep['deposit_number'], 'Keep ' . rupees($o['owed'])
                    . ' in your savings account; it is taken tonight.', 'deposits', 'warn');
            } elseif ($o['next_due']) {
                $add('Next instalment on ' . $dep['deposit_number'], rupees((float)$dep['instalment_amount']) . ' on '
                    . date('j M Y', strtotime($o['next_due'])) . ', taken from your savings.', 'deposits');
            }
        }
        foreach (rows("SELECT details, timestamp FROM audit_logs WHERE user_id = ? AND action = 'DEPOSIT_RERATED_TO_CAP'
                AND timestamp >= ? ORDER BY timestamp DESC LIMIT 3", [$user['id'], gmdate('Y-m-d', strtotime('-90 days'))]) as $r) {
            $add('Your deposit rate changed', $r['details'] . '. 12.5% a year is the most a Nidhi may pay; interest '
                . 'already credited is yours to keep.', 'deposits');
        }
        if ($n = $count('SELECT COUNT(*) FROM support_tickets WHERE user_id = ? AND unread_for_member > 0', [$user['id']])) {
            $add('Reply from support', "$n of your queries ha" . ($n === 1 ? 's' : 've') . ' a new reply.', 'kyc');
        }
    } else {
        if (in_array($user['role'], CRM_ROLES, true)) {
            if ($n = $count("SELECT COUNT(*) FROM users WHERE role IN ('retail','corporate') AND kyc_status = 'pending_approval'")) {
                $add('KYC waiting', "$n member" . ($n === 1 ? '' : 's') . ' waiting for KYC verification.', 'kyc', 'warn');
            }
            if ($n = $count("SELECT COUNT(*) FROM member_register WHERE status = 'active' AND next_kyc_review <= ?", [$today])) {
                $add('KYC reviews due', "$n member" . ($n === 1 ? '' : 's') . ' due a periodic KYC refresh (see the KYC reviews report).',
                    'reports', 'warn');
            }
        }
        if (in_array($user['role'], GRIEVANCE_ROLES, true)
            && ($n = $count("SELECT COUNT(*) FROM support_tickets WHERE grievance_status = 'open'"))) {
            $add('Open grievances', "$n complaint" . ($n === 1 ? '' : 's') . ' waiting for a decision (30-day limit).', 'grievance', 'warn');
        }
        if (in_array($user['role'], AML_REVIEW_ROLES, true)
            && ($n = $count("SELECT COUNT(*) FROM fraud_alerts WHERE status = 'open'"))) {
            $add('Fraud alerts', "$n alert" . ($n === 1 ? '' : 's') . ' to review.', 'fraud', 'warn');
        }
        if (in_array($user['role'], ['loan_officer', ...ADMIN_ROLES], true)
            && ($n = $count("SELECT COUNT(*) FROM loan_applications WHERE status IN ('submitted','under_review','documentation')"))) {
            $add('Loans waiting', "$n application" . ($n === 1 ? '' : 's') . ' waiting for a decision.', 'loan-dept');
        }
        if (in_array($user['role'], ['collection_agent', ...ADMIN_ROLES], true)
            && ($n = $count('SELECT COUNT(*) FROM collection_cases WHERE dpd_days >= 90'))) {
            $add('Cases past 90 days', "$n loan" . ($n === 1 ? ' is' : 's are') . ' 90 or more days past due.', 'collection', 'warn');
        }
        if ($user['role'] === 'bank_owner') {
            $over = array_filter(array_map('scheme_public', rows("SELECT * FROM schemes WHERE status = 'active'
                AND deleted_at IS NULL")), fn($x) => $x['exceeds_cap']);
            if ($over) {
                $add('Plans above 12.5%', count($over) . ' plan(s) are closed to new deposits until re-priced.', 'schemes', 'warn');
            }
            if (param_value('net_owned_funds', 0.0) <= 0) {
                $add('Net owned funds not entered', 'The Nidhi Rules checks need it. Enter it in Business Parameters.', 'parameters');
            }
        }
    }
    respond(['notifications' => $items]);
}

// ---------------------------------------------------------------------------
// Grievance escalation.
//
// A grievance is not a second kind of ticket: it is a ticket the member is not
// satisfied with. Escalating hands it to the named grievance officer and starts
// a fresh clock — thirty days, which is the turnaround published to members and
// the one the Consumer Protection Act, 2019 expects a complaint to be answered
// within. The support SLA keeps running underneath so neither deadline is lost.
const GRIEVANCE_DAYS = 30;
const GRIEVANCE_ROLES = ['admin', 'branch_manager', 'bank_owner'];
const GRIEVANCE_GROUNDS = ['unresolved', 'delay', 'dissatisfied', 'staff_conduct', 'other'];

function grievance_due(): string
{
    return (new DateTimeImmutable('now'))->modify('+' . GRIEVANCE_DAYS . ' days')->format('Y-m-d H:i:s');
}

// A member escalates their own ticket; staff may escalate on their behalf, which
// is what happens when somebody complains at the counter.
function route_grievance_escalate(array $d, string $id = ''): void
{
    global $pdo;
    $user = current_user();
    need($d, 'ground', 'detail');
    $ground = clip($d['ground'], 20);
    if (!in_array($ground, GRIEVANCE_GROUNDS, true)) {
        fail(422, 'ground must be one of: ' . implode(', ', GRIEVANCE_GROUNDS));
    }
    $detail = clip($d['detail'], 1000);
    if (mb_strlen($detail) < 10) {
        fail(422, 'Say what went wrong, in a sentence. The officer needs something to act on.');
    }
    $ticket = row('SELECT * FROM support_tickets WHERE id = ? OR ticket_id = ?', [$id, $id]);
    if (!$ticket) {
        fail(404, 'Ticket not found.');
    }
    $isStaff = in_array($user['role'], SUPPORT_STAFF_ROLES, true);
    if (!$isStaff && $ticket['user_id'] !== $user['id']) {
        fail(404, 'Ticket not found.');   // never confirm another member's ticket exists
    }
    if ($ticket['grievance_status'] === 'open') {
        fail(400, 'This complaint is already with the grievance officer.');
    }
    $pdo->prepare('UPDATE support_tickets SET grievance_status = ?, grievance_ground = ?,
            grievance_detail = ?, escalated_by = ?, escalated_at = ?, grievance_due_by = ?,
            unread_for_staff = unread_for_staff + 1
        WHERE id = ?')
        ->execute(['open', $ground, $detail, $user['id'], now_utc(), grievance_due(), $ticket['id']]);
    audit($user, 'GRIEVANCE_RAISED', $ticket['ticket_id']);
    security_event('GRIEVANCE_RAISED', 'warning', "{$ticket['ticket_id']} escalated to the grievance officer");
    respond(['status' => 'SUCCESS', 'grievance_officer' => grievance_officer(),
        'due_by' => iso(grievance_due()),
        'message' => "{$ticket['ticket_id']} is with the grievance officer. You will have an answer within "
            . GRIEVANCE_DAYS . ' days.']);
}

function route_grievance_queue(array $d): void
{
    staff_user(GRIEVANCE_ROLES);
    $status = in_array($_GET['status'] ?? '', ['open', 'resolved', 'rejected'], true)
        ? $_GET['status'] : 'open';
    $sql = 'SELECT t.id, t.ticket_id, t.user_name, t.user_email, t.subject, t.category, t.priority,
                   t.status, t.created_at, t.grievance_status, t.grievance_ground, t.grievance_detail,
                   t.escalated_at, t.grievance_due_by, t.grievance_outcome, t.resolution_note
        FROM support_tickets t WHERE t.grievance_status = ?';
    $params = [$status];
    if (!empty($_GET['q'])) {
        $sql .= ' AND (t.ticket_id LIKE ? OR t.user_name LIKE ? OR t.subject LIKE ?)';
        $like = '%' . clip($_GET['q'], 60) . '%';
        array_push($params, $like, $like, $like);
    }
    [$items, $meta] = paginate($sql . ' ORDER BY t.grievance_due_by', $params, 25, 100);
    respond([
        'grievances' => out_all($items),
        'pagination' => $meta,
        'counts' => [
            'open' => (int)scalar("SELECT COUNT(*) FROM support_tickets WHERE grievance_status = 'open'"),
            'overdue' => (int)scalar("SELECT COUNT(*) FROM support_tickets
                WHERE grievance_status = 'open' AND grievance_due_by < NOW()"),
            'resolved' => (int)scalar("SELECT COUNT(*) FROM support_tickets WHERE grievance_status = 'resolved'"),
        ],
        'grounds' => GRIEVANCE_GROUNDS,
        'response_window_days' => GRIEVANCE_DAYS,
        'grievance_officer' => grievance_officer(),
    ]);
}

function route_grievance_resolve(array $d, string $id = ''): void
{
    global $pdo;
    $staff = staff_user(GRIEVANCE_ROLES);
    need($d, 'outcome', 'decision');
    $outcome = clip($d['outcome'], 12);
    if (!in_array($outcome, ['resolved', 'rejected'], true)) {
        fail(422, 'outcome must be resolved or rejected.');
    }
    // Rejecting a complaint without telling the member why is the failure the
    // Act is written against, so the reason is required for both outcomes.
    $decision = clip($d['decision'], 1000);
    if (mb_strlen($decision) < 10) {
        fail(422, 'Write the decision and the reason for it. The member is entitled to be told.');
    }
    $ticket = row('SELECT * FROM support_tickets WHERE id = ? OR ticket_id = ?', [$id, $id]);
    if (!$ticket) {
        fail(404, 'No such complaint.');
    }
    if ($ticket['grievance_status'] !== 'open') {
        fail(400, 'This complaint is not open with the grievance officer.');
    }
    $pdo->prepare('UPDATE support_tickets SET grievance_status = ?, grievance_outcome = ?,
            grievance_handled_by = ?, grievance_handled_at = ?, unread_for_member = unread_for_member + 1
        WHERE id = ?')
        ->execute([$outcome, $decision, $staff['id'], now_utc(), $ticket['id']]);
    audit($staff, 'GRIEVANCE_' . strtoupper($outcome), $ticket['ticket_id']);
    respond(['status' => 'SUCCESS', 'message' => "{$ticket['ticket_id']} marked $outcome."]);
}
