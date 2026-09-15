<?php
// AJSPay: the Digital Personal Data Protection Act, 2023.
//
// Three obligations, and they are all about the member being able to see and
// steer what we hold. Section 5 wants an itemised notice — what we take, why,
// and for how long — and consent recorded against it. Section 6(6) wants
// withdrawal to be as easy as giving consent. Sections 11 to 13 give the right
// to a copy, to a correction, and to erasure.
//
// Consent rows are never overwritten. A new decision supersedes the last one,
// so what somebody agreed to, and when, stays readable afterwards.
declare(strict_types=1);

const NOTICE_VERSION = '1.0';
const PRIVACY_STAFF_ROLES = ['admin', 'branch_manager', 'bank_owner'];
const DATA_REQUEST_DAYS = 30;   // the response window we publish

// Each purpose says plainly what it covers. A blanket "we process your data"
// is exactly what section 5 is written against.
const CONSENT_PURPOSES = [
    'accounts' => [
        'label' => 'Running your membership and accounts',
        'detail' => 'Your name, address, phone, email, PAN and masked Aadhaar, so we can admit you as a '
            . 'member, keep the statutory register, operate your accounts and deposits, and produce your '
            . 'statements.',
        'retention' => 'While you are a member, and eight years after the account closes, as the '
            . 'Companies Act and the PMLA require.',
        'required' => true,
    ],
    'kyc' => [
        'label' => 'Verifying who you are',
        'detail' => 'Your identity documents and the photograph or video taken at verification, used to '
            . 'satisfy Know Your Customer obligations and to screen against sanctions lists.',
        'retention' => 'Five years after the account closes, as the PMLA requires.',
        'required' => true,
    ],
    'fraud' => [
        'label' => 'Watching for fraud and money laundering',
        'detail' => 'Your transaction patterns, examined on our own servers to spot unusual activity and '
            . 'to meet reporting duties to FIU-IND. No profile is ever sent outside this institution.',
        'retention' => 'Five years from the transaction.',
        'required' => true,
    ],
    'service_updates' => [
        'label' => 'Messages about your accounts',
        'detail' => 'Your phone and email, used for one-time passwords, payment alerts and notices that '
            . 'affect your money.',
        'retention' => 'While you are a member.',
        'required' => true,
    ],
    'marketing' => [
        'label' => 'News about other products',
        'detail' => 'Your phone and email, used to tell you about deposit schemes and loans you do not '
            . 'already hold. Entirely optional, and refusing changes nothing about your accounts.',
        'retention' => 'Until you withdraw consent.',
        'required' => false,
    ],
];

function route_privacy_notice(array $d): void
{
    // Public: somebody deciding whether to join has to be able to read this
    // before they hand anything over.
    respond([
        'version' => NOTICE_VERSION,
        'data_fiduciary' => 'Aadhunik Jeewan Sanchay Nidhi Limited (CIN U65990UP2019PLN121746)',
        'purposes' => array_map(fn($k, $p) => ['key' => $k] + $p,
            array_keys(CONSENT_PURPOSES), CONSENT_PURPOSES),
        'your_rights' => [
            'A copy of everything we hold about you',
            'Correction of anything that is wrong or out of date',
            'Erasure, except where the law requires us to keep it',
            'Withdrawal of any optional consent, at any time',
            'A complaint to our grievance officer, and then to the Data Protection Board of India',
        ],
        'grievance_officer' => grievance_officer(),
        'response_window_days' => DATA_REQUEST_DAYS,
        'sharing' => 'We do not sell your data and we do not send it abroad. It is processed on our own '
            . 'servers in India. It leaves only where the law compels us — a regulator, FIU-IND, or a '
            . 'court.',
    ]);
}

function consent_state(string $userId): array
{
    $state = [];
    foreach (CONSENT_PURPOSES as $key => $purpose) {
        // The most recent decision for each purpose is the one that stands.
        $row = row('SELECT * FROM consents WHERE user_id = ? AND purpose = ?
            ORDER BY recorded_at DESC LIMIT 1', [$userId, $key]);
        $state[] = [
            'key' => $key,
            'label' => $purpose['label'],
            'detail' => $purpose['detail'],
            'retention' => $purpose['retention'],
            'required' => $purpose['required'],
            'granted' => $row ? (bool)$row['granted'] : false,
            'recorded_at' => $row ? iso($row['recorded_at']) : null,
            'notice_version' => $row['notice_version'] ?? null,
        ];
    }
    return $state;
}

function route_privacy_consent_get(array $d): void
{
    $user = current_user();
    $state = consent_state($user['id']);
    $outstanding = array_values(array_filter($state,
        fn($c) => $c['required'] && (!$c['granted'] || $c['notice_version'] !== NOTICE_VERSION)));
    respond([
        'version' => NOTICE_VERSION,
        'consents' => $state,
        // The app uses this to decide whether to put the notice in front of them.
        'needs_consent' => $outstanding !== [],
        'outstanding' => array_column($outstanding, 'key'),
    ]);
}

function route_privacy_consent_set(array $d): void
{
    global $pdo;
    $user = current_user();
    $choices = $d['consents'] ?? null;
    if (!is_array($choices) || $choices === []) {
        fail(422, 'Send your choice for each purpose.');
    }
    $recorded = [];
    $pdo->beginTransaction();
    foreach ($choices as $key => $granted) {
        $purpose = CONSENT_PURPOSES[clip((string)$key, 40)] ?? null;
        if ($purpose === null) {
            continue;
        }
        $granted = (bool)$granted;
        // A required purpose cannot be declined and still leave an account that
        // works, so say so rather than recording a refusal we would ignore.
        if ($purpose['required'] && !$granted) {
            $pdo->rollBack();
            fail(422, '"' . $purpose['label'] . '" cannot be declined while you hold an account with us: '
                . 'it is how the account is operated and what the law requires us to keep. You may close '
                . 'the account instead, and ask for erasure of everything we are not obliged to retain.');
        }
        $pdo->prepare('INSERT INTO consents (id, user_id, purpose, notice_version, granted, ip)
            VALUES (?, ?, ?, ?, ?, ?)')
            ->execute([uuid4(), $user['id'], $key, NOTICE_VERSION, (int)$granted, client_ip()]);
        $recorded[$key] = $granted;
    }
    $pdo->commit();
    audit($user, 'CONSENT_RECORDED', 'v' . NOTICE_VERSION . ': ' . json_encode($recorded));
    respond(['status' => 'SUCCESS', 'recorded' => $recorded, 'consents' => consent_state($user['id']),
        'message' => 'Your choices are recorded. You can change the optional ones whenever you like.']);
}

// Section 11: a copy of what we hold. Assembled live rather than from an
// export job, so it cannot go stale.
function route_privacy_my_data(array $d): void
{
    $user = current_user();
    $uid = $user['id'];
    $member = row('SELECT folio_no, admitted_on, shares_held, status, risk_category
        FROM member_register WHERE user_id = ?', [$uid]);
    respond([
        'generated_at' => iso(now_utc()),
        'notice_version' => NOTICE_VERSION,
        'about_you' => public_user($user),
        'membership' => $member ? out($member) : null,
        'accounts' => out_all(rows('SELECT account_number, account_type, balance, status, created_at
            FROM accounts WHERE user_id = ?', [$uid])),
        'deposits' => out_all(rows('SELECT deposit_number, principal_amount, interest_rate, maturity_date,
            status FROM deposits WHERE user_id = ?', [$uid])),
        'loans' => out_all(rows('SELECT loan_application_no, loan_type, amount, status, created_at
            FROM loan_applications WHERE user_id = ?', [$uid])),
        'transactions' => out_all(rows('SELECT timestamp, type, mode, amount, counterparty_name, ref_number
            FROM transactions WHERE user_id = ? ORDER BY timestamp DESC LIMIT 500', [$uid])),
        'support_tickets' => out_all(rows('SELECT ticket_id, subject, status, created_at
            FROM support_tickets WHERE user_id = ?', [$uid])),
        'consents' => consent_state($uid),
        'sign_in_history' => out_all(rows("SELECT action, details, ip, timestamp FROM audit_logs
            WHERE user_id = ? AND action LIKE 'USER_LOGIN%' ORDER BY timestamp DESC LIMIT 50", [$uid])),
        // Being told we hold notes about you is part of the right; the notes
        // themselves are staff working material.
        'staff_notes_held' => (int)scalar('SELECT COUNT(*) FROM crm_interactions WHERE member_user_id = ?', [$uid]),
        'note' => 'This is everything we hold that identifies you. Ask for a correction or erasure from '
            . 'the same screen if any of it is wrong.',
    ]);
}

function route_privacy_request(array $d): void
{
    global $pdo;
    $user = current_user();
    need($d, 'kind', 'detail');
    $kind = clip($d['kind'], 12);
    if (!in_array($kind, ['access', 'correction', 'erasure'], true)) {
        fail(422, 'kind must be access, correction or erasure.');
    }
    $detail = clip($d['detail'], 1000);
    if (mb_strlen($detail) < 10) {
        fail(422, 'Tell us what you would like corrected or erased, so we can act on it.');
    }
    $reference = 'DPR-' . gmdate('Ymd') . '-' . random_int(1000, 9999);
    $pdo->prepare('INSERT INTO data_requests (id, reference, user_id, kind, detail, due_by)
        VALUES (?, ?, ?, ?, ?, DATE_ADD(CURDATE(), INTERVAL ? DAY))')
        ->execute([uuid4(), $reference, $user['id'], $kind, $detail, DATA_REQUEST_DAYS]);
    audit($user, 'DATA_REQUEST', "$reference ($kind)");
    security_event('DATA_REQUEST', 'info', "$reference — $kind", $user);
    respond(['status' => 'SUCCESS', 'reference' => $reference,
        'message' => "Logged as $reference. We will respond within " . DATA_REQUEST_DAYS . ' days.'
            . ($kind === 'erasure'
                ? ' Anything the Companies Act or the PMLA obliges us to keep will be explained rather '
                    . 'than deleted.'
                : '')]);
}

function route_privacy_my_requests(array $d): void
{
    $user = current_user();
    [$requests, $meta] = paginate('SELECT reference, kind, detail, status, response, due_by, created_at
        FROM data_requests WHERE user_id = ? ORDER BY created_at DESC', [$user['id']], 20, 100);
    respond(['requests' => out_all($requests), 'pagination' => $meta,
        'grievance_officer' => grievance_officer()]);
}

// --- Staff side ---------------------------------------------------------------------------
function route_privacy_queue(array $d): void
{
    staff_user(PRIVACY_STAFF_ROLES);
    $status = in_array($_GET['status'] ?? '', ['open', 'actioned', 'refused'], true) ? $_GET['status'] : 'open';
    [$requests, $meta] = paginate('SELECT r.*, u.name, u.email FROM data_requests r
        JOIN users u ON u.id = r.user_id WHERE r.status = ? ORDER BY r.due_by', [$status], 25, 100);
    respond([
        'requests' => out_all($requests),
        'pagination' => $meta,
        'counts' => [
            'open' => (int)scalar("SELECT COUNT(*) FROM data_requests WHERE status = 'open'"),
            'overdue' => (int)scalar("SELECT COUNT(*) FROM data_requests WHERE status = 'open' AND due_by < CURDATE()"),
            'actioned' => (int)scalar("SELECT COUNT(*) FROM data_requests WHERE status = 'actioned'"),
        ],
        'response_window_days' => DATA_REQUEST_DAYS,
    ]);
}

function route_privacy_respond(array $d): void
{
    global $pdo;
    $staff = staff_user(PRIVACY_STAFF_ROLES);
    need($d, 'reference', 'status', 'response');
    $status = clip($d['status'], 12);
    if (!in_array($status, ['actioned', 'refused'], true)) {
        fail(422, 'status must be actioned or refused.');
    }
    $response = clip($d['response'], 1000);
    if (mb_strlen($response) < 10) {
        // Refusing without a reason is the failure mode the Act is written
        // against, so the reason is mandatory either way.
        fail(422, 'Write what you did, or why you could not. The member is entitled to be told.');
    }
    $request = row('SELECT * FROM data_requests WHERE reference = ?', [clip($d['reference'], 20)]);
    if (!$request) {
        fail(404, 'No such request.');
    }
    $pdo->prepare('UPDATE data_requests SET status = ?, response = ?, handled_by = ?, handled_at = ?
        WHERE id = ?')->execute([$status, $response, $staff['id'], now_utc(), $request['id']]);
    audit($staff, 'DATA_REQUEST_' . strtoupper($status), $request['reference']);
    respond(['status' => 'SUCCESS', 'message' => "{$request['reference']} marked $status."]);
}
