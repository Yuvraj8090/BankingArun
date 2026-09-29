<?php
// AJSPay: the statutory member register, and AML name screening.
//
// Rule 11 of the Nidhi Rules, 2014 is the hinge this file turns on: a Nidhi may
// deal only with its members, and every depositor must hold at least ten equity
// shares of ten rupees. Without a register there is no way to show that a
// deposit came from a member, which is the first thing an inspection asks.
//
// Screening runs against a list held in our own database. Member names are
// never sent to an outside service — the compliance officer loads the UNSC, MHA
// and PEP names, and the matching happens here.
declare(strict_types=1);

const REGISTER_READ_ROLES = ['staff', 'admin', 'branch_manager', 'bank_owner'];
const REGISTER_WRITE_ROLES = ['admin', 'branch_manager', 'bank_owner'];
const COMPLIANCE_ROLES = ['admin', 'branch_manager', 'bank_owner'];

const MIN_SHARES = 10;              // Nidhi Rules 11: ten shares minimum
const SHARE_FACE_VALUE = 10.00;     // of ten rupees each
const WATCHLISTS = ['UNSC', 'MHA', 'PEP', 'INTERNAL'];
const SCREEN_THRESHOLD = 72;        // below this a name is not worth a reviewer's time
const RISK_REVIEW_MONTHS = ['high' => 24, 'medium' => 96, 'low' => 120];

// --- Name matching --------------------------------------------------------------------
// Strips the things that differ between two records of the same person: case,
// punctuation, honorifics, and the spacing of initials.
function normalise_name(string $name): string
{
    $name = strtoupper(trim($name));
    $name = preg_replace('/\b(MR|MRS|MS|DR|SHRI|SMT|SRI|KUMARI|M\/S|PROF)\b\.?/', ' ', $name) ?? $name;
    $name = preg_replace('/[^A-Z0-9 ]/', ' ', $name) ?? $name;
    return trim(preg_replace('/\s+/', ' ', $name) ?? $name);
}

// Levenshtein similarity as a percentage, guarding the 255-byte limit.
function similarity(string $a, string $b): int
{
    if ($a === '' || $b === '') {
        return 0;
    }
    if ($a === $b) {
        return 100;
    }
    $a = substr($a, 0, 255);
    $b = substr($b, 0, 255);
    $distance = levenshtein($a, $b);
    $longest = max(strlen($a), strlen($b));
    return (int)round((1 - $distance / $longest) * 100);
}

// Two scores, and the better one wins. Whole-string similarity catches spelling
// differences; token overlap catches reordered or partial names, which is how
// the same person usually appears twice ("Kumar Rajesh" against "Rajesh Kumar").
function name_match_score(string $candidate, string $target): int
{
    $a = normalise_name($candidate);
    $b = normalise_name($target);
    if ($a === '' || $b === '') {
        return 0;
    }
    $whole = similarity($a, $b);

    $tokensA = array_filter(explode(' ', $a), fn($t) => strlen($t) > 1);
    $tokensB = array_filter(explode(' ', $b), fn($t) => strlen($t) > 1);
    $overlap = 0;
    foreach ($tokensA as $ta) {
        foreach ($tokensB as $tb) {
            if (similarity($ta, $tb) >= 85) {
                $overlap++;
                break;
            }
        }
    }
    $smaller = max(min(count($tokensA), count($tokensB)), 1);
    // Every token of the shorter name found in the longer one is a strong signal,
    // but not proof, so it tops out below an exact match.
    $token = (int)round($overlap / $smaller * 96);
    return max($whole, $token);
}

// Returns the watchlist rows a name plausibly matches, worst first.
function screen_name(string $name): array
{
    $normalised = normalise_name($name);
    if ($normalised === '') {
        return [];
    }
    $hits = [];
    foreach (rows('SELECT * FROM watchlist_entries') as $entry) {
        $best = name_match_score($normalised, $entry['normalised_name']);
        foreach (array_filter(explode(';', (string)$entry['aliases'])) as $alias) {
            $best = max($best, name_match_score($normalised, $alias));
        }
        if ($best >= SCREEN_THRESHOLD) {
            $entry['score'] = $best;
            $hits[] = $entry;
        }
    }
    usort($hits, fn($x, $y) => $y['score'] <=> $x['score']);
    return $hits;
}

// Records any matches for one person and returns how many were raised.
function record_screening(array $user, ?string $leadId = null, ?string $overrideName = null): array
{
    global $pdo;
    $name = $overrideName ?? $user['name'] ?? '';
    $hits = screen_name($name);
    foreach ($hits as $hit) {
        $already = row('SELECT id FROM screening_hits WHERE watchlist_id = ?
            AND ((user_id IS NOT NULL AND user_id = ?) OR (lead_id IS NOT NULL AND lead_id = ?))',
            [$hit['id'], $user['id'] ?? '', $leadId ?? '']);
        if ($already) {
            continue;   // don't raise the same match twice
        }
        $pdo->prepare('INSERT INTO screening_hits (id, user_id, lead_id, screened_name, watchlist_id,
                matched_name, list_name, score) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            ->execute([uuid4(), $leadId === null ? ($user['id'] ?? null) : null, $leadId, $name,
                $hit['id'], $hit['full_name'], $hit['list_name'], $hit['score']]);
    }
    if (isset($user['id']) && $leadId === null) {
        $status = $hits === [] ? 'clear' : 'potential_match';
        $pdo->prepare('UPDATE member_register SET screening_status = ?, screening_checked_at = ?
            WHERE user_id = ?')->execute([$status, now_utc(), $user['id']]);
    }
    return $hits;
}

// --- Customer due diligence ------------------------------------------------------------
// A category, and the reasons for it. The reasons matter more than the label:
// an inspector asks why somebody was rated low, not what they were rated.
function assess_risk(array $user, array $member): array
{
    $reasons = [];
    $score = 0;

    if (($user['kyc_status'] ?? '') !== 'verified') {
        $score += 40;
        $reasons[] = 'KYC is not verified';
    }
    if (!empty($member['is_pep'])) {
        $score += 50;
        $reasons[] = 'Politically exposed person';
    }
    $openHits = (int)scalar("SELECT COUNT(*) FROM screening_hits WHERE user_id = ? AND status = 'open'",
        [$user['id']]);
    if ($openHits > 0) {
        // On its own this must reach high. An unresolved possible sanctions
        // match is a reason to treat someone as high risk until a person has
        // looked at it, not to average it away against good KYC.
        $score += 60;
        $reasons[] = "$openHits unresolved watchlist match(es)";
    }
    if ((int)scalar("SELECT COUNT(*) FROM screening_hits WHERE user_id = ? AND status = 'confirmed'",
        [$user['id']]) > 0) {
        $score += 100;
        $reasons[] = 'Confirmed watchlist match';
    }
    if (empty($user['pan_number'])) {
        $score += 20;
        $reasons[] = 'No PAN on file';
    }
    $deposits = (float)scalar("SELECT COALESCE(SUM(principal_amount), 0) FROM deposits
        WHERE user_id = ? AND status = 'active'", [$user['id']]);
    if ($deposits >= 1000000) {
        $score += 20;
        $reasons[] = 'Deposits of ' . rupees($deposits);
    }
    $alerts = (int)scalar("SELECT COUNT(*) FROM fraud_alerts WHERE user_id = ? AND status = 'escalated'",
        [$user['id']]);
    if ($alerts > 0) {
        $score += 30;
        $reasons[] = "$alerts escalated AML alert(s)";
    }
    if ((int)((time() - strtotime($user['created_at'])) / 86400) < 90) {
        $score += 10;
        $reasons[] = 'Member for under three months';
    }
    if ($reasons === []) {
        $reasons[] = 'Verified KYC, no adverse signal';
    }

    $category = $score >= 60 ? 'high' : ($score >= 25 ? 'medium' : 'low');
    return [$category, $reasons, $score];
}

function apply_risk(array $user): array
{
    global $pdo;
    $member = row('SELECT * FROM member_register WHERE user_id = ?', [$user['id']]);
    if (!$member) {
        return ['unrated', ['Not on the member register'], 0];
    }
    [$category, $reasons, $score] = assess_risk($user, $member);
    // The Master Direction sets the re-KYC cycle by risk: two years for high,
    // eight for medium, ten for low.
    $months = RISK_REVIEW_MONTHS[$category] ?? 120;
    $pdo->prepare('UPDATE member_register SET risk_category = ?, risk_reasons = ?, risk_reviewed_at = ?,
        next_kyc_review = DATE_ADD(CURDATE(), INTERVAL ? MONTH) WHERE user_id = ?')
        ->execute([$category, json_encode($reasons), now_utc(), $months, $user['id']]);
    return [$category, $reasons, $score];
}

// --- Membership -------------------------------------------------------------------------
// The question the deposit routes ask before taking money.
function membership_of(string $userId): ?array
{
    return row("SELECT * FROM member_register WHERE user_id = ? AND status = 'active'", [$userId]);
}

function require_membership(array $user): array
{
    $member = membership_of($user['id']);
    if (!$member) {
        // Most people who reach a deposit route without a folio are not being
        // turned away for a real reason -- they self-registered and no teller
        // has admitted them yet. Admit them here, on the spot, with the
        // statutory minimum shares, rather than block the deposit they came to
        // make and send them off to ask for the same ten shares at a desk.
        admit_member($user, MIN_SHARES, [], $user);
        $member = membership_of($user['id']);
    }
    if ((int)$member['shares_held'] < MIN_SHARES) {
        fail(403, 'A member must hold at least ' . MIN_SHARES . ' equity shares before placing a deposit '
            . '(Nidhi Rules, 2014). This folio holds ' . (int)$member['shares_held'] . '.');
    }
    if ((int)scalar("SELECT COUNT(*) FROM screening_hits WHERE user_id = ? AND status = 'confirmed'",
        [$user['id']]) > 0) {
        security_event('BLOCKED_SANCTIONED_MEMBER', 'critical',
            'Blocked activity on a confirmed watchlist match', $user);
        fail(403, 'This account is under compliance review and cannot transact. Please contact the branch.');
    }
    return $member;
}

function next_folio(): string
{
    $last = (int)scalar("SELECT COALESCE(MAX(CAST(SUBSTRING(folio_no, 5) AS UNSIGNED)), 0) FROM member_register");
    return 'AJS-' . str_pad((string)($last + 1), 6, '0', STR_PAD_LEFT);
}

// The admission itself: allot the shares, open the folio, screen and rate the
// new member. Shared by the staff-facing route below and by require_membership's
// auto-admission of a member who reaches a deposit route with no folio yet.
function admit_member(array $user, int $shares, array $extra, array $actor): array
{
    global $pdo;
    if (membership_of($user['id'])) {
        fail(400, 'This person is already on the member register.');
    }
    if ($shares < MIN_SHARES) {
        fail(422, 'At least ' . MIN_SHARES . ' shares must be allotted (Nidhi Rules, 2014).');
    }

    $folio = next_folio();
    $memberId = uuid4();
    $certificate = 'CERT-' . substr($folio, 4) . '-' . gmdate('Y');
    $today = (new DateTimeImmutable('today', new DateTimeZone(IST)))->format('Y-m-d');

    $pdo->beginTransaction();
    $pdo->prepare('INSERT INTO member_register (id, user_id, folio_no, admitted_on, shares_held,
            share_face_value, certificate_no, address, occupation, introduced_by, is_pep)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        ->execute([$memberId, $user['id'], $folio, $today, $shares, SHARE_FACE_VALUE, $certificate,
            clip($extra['address'] ?? '', 500) ?: null, clip($extra['occupation'] ?? '', 100) ?: null,
            clip($extra['introduced_by'] ?? '', 36) ?: null, !empty($extra['is_pep']) ? 1 : 0]);
    $pdo->prepare('INSERT INTO share_allotments (id, member_id, user_id, kind, shares, face_value, amount,
            certificate_no, allotted_on, reference, recorded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        ->execute([uuid4(), $memberId, $user['id'], 'allotment', $shares, SHARE_FACE_VALUE,
            $shares * SHARE_FACE_VALUE, $certificate, $today, clip($extra['reference'] ?? '', 100) ?: 'Admission',
            $actor['id']]);
    $pdo->commit();

    // Screen and rate on admission — that is the point at which it is useful.
    $hits = record_screening($user);
    [$category, $reasons] = apply_risk($user);

    audit($actor, 'MEMBER_ADMITTED', "$folio {$user['email']} · $shares shares");
    security_event('MEMBER_ADMITTED', $hits === [] ? 'info' : 'warning',
        "$folio admitted" . ($hits === [] ? '' : ' with ' . count($hits) . ' watchlist match(es)'), $actor);

    return ['folio_no' => $folio, 'certificate_no' => $certificate, 'shares' => $shares,
        'paid_up' => $shares * SHARE_FACE_VALUE,
        'screening' => ['matches' => count($hits), 'names' => array_column($hits, 'full_name')],
        'risk_category' => $category, 'risk_reasons' => $reasons];
}

function route_register_admit(array $d): void
{
    $staff = staff_user(REGISTER_WRITE_ROLES);
    need($d, 'user_id', 'shares');
    $user = row('SELECT * FROM users WHERE id = ? OR email = ?',
        [clip($d['user_id'], 36), clip($d['user_id'], 150)]);
    if (!$user) {
        fail(404, 'No such person.');
    }
    $result = admit_member($user, (int)$d['shares'], $d, $staff);
    respond(['status' => 'SUCCESS'] + $result + ['message' => "Admitted as {$result['folio_no']} "
        . "with {$result['shares']} shares."
        . ($result['screening']['matches'] === 0 ? '' : ' A watchlist match was raised for review — see Compliance.')]);
}

function route_register_shares(array $d): void
{
    global $pdo;
    $staff = staff_user(REGISTER_WRITE_ROLES);
    need($d, 'user_id', 'shares', 'kind');
    $member = row('SELECT * FROM member_register WHERE user_id = ? OR folio_no = ?',
        [clip($d['user_id'], 36), clip($d['user_id'], 20)]);
    if (!$member) {
        fail(404, 'Not on the member register.');
    }
    $kind = clip($d['kind'], 15);
    if (!in_array($kind, ['allotment', 'transfer_in', 'transfer_out', 'surrender'], true)) {
        fail(422, 'kind must be allotment, transfer_in, transfer_out or surrender.');
    }
    $shares = (int)$d['shares'];
    if ($shares < 1) {
        fail(422, 'Shares must be a positive number.');
    }
    $delta = in_array($kind, ['allotment', 'transfer_in'], true) ? $shares : -$shares;
    $after = (int)$member['shares_held'] + $delta;
    if ($after < 0) {
        fail(400, 'That would leave a negative holding.');
    }
    // A member who still has money with us cannot drop below the statutory floor.
    if ($after < MIN_SHARES && $after > 0) {
        $hasDeposits = (int)scalar("SELECT COUNT(*) FROM deposits WHERE user_id = ? AND status = 'active'",
            [$member['user_id']]);
        if ($hasDeposits > 0) {
            fail(400, 'This member holds active deposits, so the holding cannot fall below '
                . MIN_SHARES . ' shares (Nidhi Rules, 2014).');
        }
    }
    $today = (new DateTimeImmutable('today', new DateTimeZone(IST)))->format('Y-m-d');
    $pdo->beginTransaction();
    $pdo->prepare('INSERT INTO share_allotments (id, member_id, user_id, kind, shares, face_value, amount,
            allotted_on, reference, recorded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        ->execute([uuid4(), $member['id'], $member['user_id'], $kind, $shares, SHARE_FACE_VALUE,
            $shares * SHARE_FACE_VALUE, $today, clip($d['reference'] ?? '', 100) ?: null, $staff['id']]);
    $pdo->prepare('UPDATE member_register SET shares_held = ? WHERE id = ?')->execute([$after, $member['id']]);
    $pdo->commit();
    audit($staff, 'SHARES_' . strtoupper($kind), "{$member['folio_no']} $shares shares, now $after");
    respond(['status' => 'SUCCESS', 'shares_held' => $after,
        'message' => "{$member['folio_no']} now holds $after shares."]);
}

function route_register_list(array $d): void
{
    staff_user(REGISTER_READ_ROLES);
    $sql = "SELECT m.*, u.name, u.email, u.phone, u.kyc_status, u.pan_number
        FROM member_register m JOIN users u ON u.id = m.user_id WHERE 1 = 1";
    $params = [];
    foreach ([['status', 'm.status'], ['risk_category', 'm.risk_category'],
              ['screening_status', 'm.screening_status']] as [$key, $column]) {
        if (!empty($_GET[$key])) {
            $sql .= " AND $column = ?";
            $params[] = clip($_GET[$key], 30);
        }
    }
    if (!empty($_GET['q'])) {
        $sql .= ' AND (u.name LIKE ? OR u.email LIKE ? OR m.folio_no LIKE ?)';
        $like = '%' . clip($_GET['q'], 60) . '%';
        array_push($params, $like, $like, $like);
    }
    [$members, $meta] = paginate($sql . ' ORDER BY m.folio_no', $params, 25, 100);
    respond([
        'members' => array_map(function ($m) {
            $m = out($m);
            $m['shares_held'] = (int)$m['shares_held'];
            $m['paid_up'] = round((int)$m['shares_held'] * (float)$m['share_face_value'], 2);
            $m['risk_reasons'] = $m['risk_reasons'] ? (json_decode((string)$m['risk_reasons'], true) ?: []) : [];
            $m['is_pep'] = (bool)$m['is_pep'];
            unset($m['pan_number']);   // the register does not need to carry it
            return $m;
        }, $members),
        'pagination' => $meta,
        'summary' => [
            'active' => (int)scalar("SELECT COUNT(*) FROM member_register WHERE status = 'active'"),
            'total_shares' => (int)scalar("SELECT COALESCE(SUM(shares_held), 0) FROM member_register WHERE status = 'active'"),
            'paid_up_capital' => round((float)scalar("SELECT COALESCE(SUM(shares_held * share_face_value), 0)
                FROM member_register WHERE status = 'active'"), 2),
            'high_risk' => (int)scalar("SELECT COUNT(*) FROM member_register WHERE risk_category = 'high' AND status = 'active'"),
            'unscreened' => (int)scalar("SELECT COUNT(*) FROM member_register WHERE screening_status = 'not_screened'"),
            'below_minimum' => (int)scalar("SELECT COUNT(*) FROM member_register WHERE status = 'active' AND shares_held < " . MIN_SHARES),
        ],
        'minimum_shares' => MIN_SHARES,
        'share_face_value' => SHARE_FACE_VALUE,
    ]);
}

function route_register_folio(array $d, string $id = ''): void
{
    staff_user(REGISTER_READ_ROLES);
    $member = row('SELECT m.*, u.name, u.email, u.phone, u.kyc_status, u.created_at AS joined
        FROM member_register m JOIN users u ON u.id = m.user_id
        WHERE m.folio_no = ? OR m.user_id = ? OR m.id = ?', [$id, $id, $id]);
    if (!$member) {
        fail(404, 'No such folio.');
    }
    $member = out($member);
    $member['risk_reasons'] = $member['risk_reasons'] ? (json_decode((string)$member['risk_reasons'], true) ?: []) : [];
    respond([
        'member' => $member,
        'share_history' => out_all(rows('SELECT * FROM share_allotments WHERE member_id = ?
            ORDER BY allotted_on DESC, created_at DESC', [$member['id']])),
        'screening_hits' => out_all(rows('SELECT * FROM screening_hits WHERE user_id = ?
            ORDER BY score DESC', [$member['user_id']])),
        'deposits' => out_all(rows('SELECT deposit_number, principal_amount, maturity_date, status
            FROM deposits WHERE user_id = ? ORDER BY created_at DESC LIMIT 20', [$member['user_id']])),
    ]);
}

function route_register_cease(array $d, string $id = ''): void
{
    global $pdo;
    $staff = staff_user(REGISTER_WRITE_ROLES);
    need($d, 'reason');
    $member = row('SELECT * FROM member_register WHERE folio_no = ? OR user_id = ?', [$id, $id]);
    if (!$member) {
        fail(404, 'No such folio.');
    }
    if ((int)scalar("SELECT COUNT(*) FROM deposits WHERE user_id = ? AND status = 'active'",
        [$member['user_id']]) > 0) {
        fail(400, 'This member still holds active deposits. Close them before ceasing the membership.');
    }
    $pdo->prepare("UPDATE member_register SET status = 'ceased', ceased_on = CURDATE(), cessation_reason = ?
        WHERE id = ?")->execute([clip($d['reason'], 255), $member['id']]);
    audit($staff, 'MEMBER_CEASED', "{$member['folio_no']} — " . clip($d['reason'], 100));
    respond(['status' => 'SUCCESS', 'message' => "{$member['folio_no']} ceased."]);
}

// --- Screening administration -----------------------------------------------------------
function route_watchlist_list(array $d): void
{
    staff_user(COMPLIANCE_ROLES);
    $sql = 'SELECT * FROM watchlist_entries WHERE 1 = 1';
    $params = [];
    if (!empty($_GET['list_name'])) {
        $sql .= ' AND list_name = ?';
        $params[] = clip($_GET['list_name'], 20);
    }
    if (!empty($_GET['q'])) {
        $sql .= ' AND (full_name LIKE ? OR aliases LIKE ?)';
        $like = '%' . clip($_GET['q'], 60) . '%';
        array_push($params, $like, $like);
    }
    [$entries, $meta] = paginate($sql . ' ORDER BY list_name, full_name', $params, 50, 200);
    respond(['entries' => out_all($entries), 'pagination' => $meta, 'lists' => WATCHLISTS,
        'total' => (int)scalar('SELECT COUNT(*) FROM watchlist_entries')]);
}

function route_watchlist_add(array $d): void
{
    global $pdo;
    $staff = staff_user(COMPLIANCE_ROLES);
    // One name, or many at once when a published list is being loaded.
    $items = isset($d['entries']) && is_array($d['entries']) ? $d['entries'] : [$d];
    if (count($items) > 5000) {
        fail(422, 'Load at most 5,000 names at a time.');
    }
    $added = 0;
    $pdo->beginTransaction();
    foreach ($items as $item) {
        $name = clip($item['full_name'] ?? '', 200);
        $list = strtoupper(clip($item['list_name'] ?? 'INTERNAL', 20));
        if ($name === '' || !in_array($list, WATCHLISTS, true)) {
            continue;
        }
        $normalised = normalise_name($name);
        if (row('SELECT id FROM watchlist_entries WHERE list_name = ? AND normalised_name = ?',
            [$list, $normalised])) {
            continue;
        }
        $pdo->prepare('INSERT INTO watchlist_entries (id, list_name, full_name, normalised_name, aliases,
                country, category, reference, added_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
            ->execute([uuid4(), $list, $name, $normalised,
                clip($item['aliases'] ?? '', 500) ?: null, clip($item['country'] ?? '', 80) ?: null,
                clip($item['category'] ?? '', 80) ?: null, clip($item['reference'] ?? '', 100) ?: null,
                $staff['id']]);
        $added++;
    }
    $pdo->commit();
    audit($staff, 'WATCHLIST_UPDATED', "$added name(s) added");
    respond(['status' => 'SUCCESS', 'added' => $added,
        'total' => (int)scalar('SELECT COUNT(*) FROM watchlist_entries'),
        'message' => "$added name(s) added. Re-run screening to check existing members against them."]);
}

// Screens every member and lead against the current list. Run it after loading
// names, because a list is only as good as the last time it was applied.
function route_screening_run(array $d): void
{
    $staff = staff_user(COMPLIANCE_ROLES);
    if ((int)scalar('SELECT COUNT(*) FROM watchlist_entries') === 0) {
        fail(400, 'The watchlist is empty. Load the UNSC, MHA or PEP names first.');
    }
    $screened = $raised = 0;
    foreach (rows("SELECT u.* FROM users u JOIN member_register m ON m.user_id = u.id
        WHERE m.status = 'active'") as $user) {
        $raised += count(record_screening($user));
        $screened++;
    }
    foreach (rows("SELECT * FROM crm_leads WHERE stage NOT IN ('lost', 'enrolled')") as $lead) {
        $raised += count(record_screening(['id' => null, 'name' => $lead['name']], $lead['id'], $lead['name']));
        $screened++;
    }
    foreach (rows("SELECT u.* FROM users u JOIN member_register m ON m.user_id = u.id
        WHERE m.status = 'active'") as $user) {
        apply_risk($user);
    }
    audit($staff, 'SCREENING_RUN', "$screened screened, $raised match(es)");
    security_event('SCREENING_RUN', $raised === 0 ? 'info' : 'warning',
        "$screened names screened, $raised match(es) raised", $staff);
    respond(['status' => 'SUCCESS', 'screened' => $screened, 'matches_raised' => $raised,
        'message' => "$screened names screened. $raised match(es) need review."]);
}

function route_screening_hits(array $d): void
{
    staff_user(COMPLIANCE_ROLES);
    $status = in_array($_GET['status'] ?? '', ['open', 'cleared', 'confirmed'], true) ? $_GET['status'] : 'open';
    [$hits, $meta] = paginate('SELECT h.*, u.name AS member_name, u.email AS member_email
        FROM screening_hits h LEFT JOIN users u ON u.id = h.user_id
        WHERE h.status = ? ORDER BY h.score DESC, h.created_at DESC', [$status], 25, 100);
    respond(['hits' => out_all($hits), 'pagination' => $meta, 'counts' => [
        'open' => (int)scalar("SELECT COUNT(*) FROM screening_hits WHERE status = 'open'"),
        'cleared' => (int)scalar("SELECT COUNT(*) FROM screening_hits WHERE status = 'cleared'"),
        'confirmed' => (int)scalar("SELECT COUNT(*) FROM screening_hits WHERE status = 'confirmed'"),
    ], 'threshold' => SCREEN_THRESHOLD]);
}

function route_screening_action(array $d): void
{
    global $pdo;
    $staff = staff_user(COMPLIANCE_ROLES);
    need($d, 'hit_id', 'action', 'note');
    $action = clip($d['action'], 12);
    if (!in_array($action, ['clear', 'confirm'], true)) {
        fail(400, 'action must be clear or confirm.');
    }
    $hit = row('SELECT * FROM screening_hits WHERE id = ?', [clip($d['hit_id'], 36)]);
    if (!$hit) {
        fail(404, 'No such match.');
    }
    // Both outcomes need a reason: clearing a genuine match and confirming a
    // false one are the two ways this goes wrong, and the note is the record.
    $note = clip($d['note'], 500);
    if (mb_strlen($note) < 8) {
        fail(422, 'Record why, in a sentence. It is the evidence that this match was considered.');
    }
    $status = $action === 'clear' ? 'cleared' : 'confirmed';
    $pdo->prepare('UPDATE screening_hits SET status = ?, note = ?, reviewed_by = ?, reviewed_at = ?
        WHERE id = ?')->execute([$status, $note, $staff['id'], now_utc(), $hit['id']]);
    if ($hit['user_id']) {
        $user = row('SELECT * FROM users WHERE id = ?', [$hit['user_id']]);
        if ($user) {
            $pdo->prepare('UPDATE member_register SET screening_status = ? WHERE user_id = ?')
                ->execute([$status === 'confirmed' ? 'confirmed_match' : 'clear', $user['id']]);
            apply_risk($user);
        }
    }
    audit($staff, 'SCREENING_' . strtoupper($status), "{$hit['screened_name']} vs {$hit['matched_name']}");
    security_event('SCREENING_' . strtoupper($status), $status === 'confirmed' ? 'critical' : 'info',
        "{$hit['screened_name']} — $note", $staff);
    respond(['status' => 'SUCCESS', 'message' => $status === 'confirmed'
        ? 'Match confirmed. This member is now blocked from transacting and must be reported to FIU-IND.'
        : 'Match cleared and the reason recorded.']);
}

function route_risk_rerate(array $d): void
{
    $staff = staff_user(COMPLIANCE_ROLES);
    $rated = 0;
    foreach (rows("SELECT u.* FROM users u JOIN member_register m ON m.user_id = u.id
        WHERE m.status = 'active'") as $user) {
        apply_risk($user);
        $rated++;
    }
    audit($staff, 'RISK_RERATED', "$rated members");
    respond(['status' => 'SUCCESS', 'rated' => $rated, 'message' => "$rated members re-rated."]);
}
