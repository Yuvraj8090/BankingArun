<?php
// Aadhunik: product master data. Deposit schemes (daily / recurring / fixed / MIS)
// and field agents with their collection records.
//
// There is deliberately no commission or payout logic here: the Nidhi Rules, 2014
// prohibit paying brokerage or incentives for mobilising deposits, so agents are
// recorded for traceability only.
declare(strict_types=1);

// Nidhi Rules, 2014: deposit interest may not exceed the maximum rate the RBI
// allows NBFCs to pay (12.5% p.a.). Schemes above that can be kept as drafts for
// reference but can never be activated.
const NIDHI_MAX_DEPOSIT_RATE = 12.5;
const SCHEME_TYPES = ['daily', 'recurring', 'fixed', 'mis'];
const SCHEME_STATUSES = ['active', 'draft', 'inactive'];
const SCHEME_WRITE_ROLES = ['bank_owner'];
const SCHEME_READ_ROLES = ['bank_owner', 'admin', 'branch_manager', 'staff'];
const AGENT_WRITE_ROLES = ['bank_owner', 'admin', 'branch_manager'];
const AGENT_READ_ROLES = ['bank_owner', 'admin', 'branch_manager', 'staff'];

// The effective annual return a scheme's own numbers imply, found by bisecting on
// the monthly rate. Installment plans are treated as an annuity, lump sums as
// straight compounding. Daily plans are approximated as monthly instalments.
function effective_rate(array $scheme): ?float
{
    $months = (int)$scheme['tenure_months'];
    $deposit = (float)$scheme['total_deposit'];
    $maturity = (float)$scheme['maturity_amount'];
    if ($months < 1 || $deposit <= 0 || $maturity <= 0) {
        return null;
    }
    if ($maturity <= $deposit) {
        return 0.0;
    }
    $byInstalment = in_array($scheme['scheme_type'], ['daily', 'recurring'], true);
    $contribution = $byInstalment ? $deposit / $months : 0.0;
    $valueAt = function (float $rate) use ($byInstalment, $months, $deposit, $contribution): float {
        if (!$byInstalment) {
            return $deposit * (1 + $rate) ** $months;
        }
        $total = 0.0;
        for ($i = 1; $i <= $months; $i++) {
            $total += $contribution * (1 + $rate) ** ($months - $i + 1);
        }
        return $total;
    };
    [$low, $high] = [0.0, 0.05];  // up to 5% per month
    for ($i = 0; $i < 80; $i++) {
        $mid = ($low + $high) / 2;
        if ($valueAt($mid) < $maturity) {
            $low = $mid;
        } else {
            $high = $mid;
        }
    }
    return round(((1 + ($low + $high) / 2) ** 12 - 1) * 100, 2);
}

function scheme_public(array $scheme): array
{
    $scheme = out($scheme);
    $rate = effective_rate($scheme);
    $scheme['effective_rate_pa'] = $rate;
    $scheme['exceeds_cap'] = $rate !== null && $rate > NIDHI_MAX_DEPOSIT_RATE;
    return $scheme;
}

function scheme_payload(array $d, array $existing = []): array
{
    $get = fn(string $key, $fallback = null) => $d[$key] ?? ($existing[$key] ?? $fallback);
    $type = $get('scheme_type', 'recurring');
    if (!in_array($type, SCHEME_TYPES, true)) {
        fail(422, 'scheme_type must be daily, recurring, fixed or mis.');
    }
    $status = $get('status', 'draft');
    if (!in_array($status, SCHEME_STATUSES, true)) {
        fail(422, 'status must be active, draft or inactive.');
    }
    $months = (int)$get('tenure_months', 0);
    if ($months < 1 || $months > 360) {
        fail(422, 'tenure_months must be between 1 and 360.');
    }
    $payout = $get('payout_type', 'maturity');
    $scheme = [
        'code' => strtoupper(clip($get('code', ''), 20)),
        'name' => clip($get('name', ''), 120),
        'scheme_type' => $type,
        'tenure_months' => $months,
        'contribution_amount' => $get('contribution_amount') === null || $get('contribution_amount') === ''
            ? null : money($get('contribution_amount')),
        'principal_amount' => $get('principal_amount') === null || $get('principal_amount') === ''
            ? null : money($get('principal_amount')),
        'total_deposit' => money($get('total_deposit', 0)),
        'maturity_amount' => money($get('maturity_amount', 0)),
        'payout_type' => in_array($payout, ['maturity', 'monthly'], true) ? $payout : 'maturity',
        'status' => $status,
        'notes' => clip($get('notes', ''), 255) ?: null,
    ];
    if ($scheme['code'] === '' || $scheme['name'] === '') {
        fail(422, 'code and name are required.');
    }
    if ($scheme['total_deposit'] <= 0 || $scheme['maturity_amount'] <= 0) {
        fail(422, 'total_deposit and maturity_amount must both be greater than 0.');
    }
    $rate = effective_rate($scheme);
    if ($status === 'active' && $rate !== null && $rate > NIDHI_MAX_DEPOSIT_RATE) {
        fail(422, sprintf(
            'This scheme returns about %.2f%% a year, above the %.1f%% cap in the Nidhi Rules, 2014. '
            . 'Save it as a draft or reduce the maturity amount.', $rate, NIDHI_MAX_DEPOSIT_RATE));
    }
    return $scheme;
}

function route_schemes_list(array $d): void
{
    staff_user(SCHEME_READ_ROLES);
    respond([
        'schemes' => array_map('scheme_public', rows('SELECT * FROM schemes ORDER BY scheme_type, tenure_months, code')),
        'max_rate_pa' => NIDHI_MAX_DEPOSIT_RATE,
        'types' => SCHEME_TYPES,
        'statuses' => SCHEME_STATUSES,
    ]);
}

function route_scheme_create(array $d): void
{
    global $pdo;
    $owner = staff_user(SCHEME_WRITE_ROLES);
    $scheme = scheme_payload($d);
    if (row('SELECT id FROM schemes WHERE code = ?', [$scheme['code']])) {
        fail(400, 'A scheme with this code already exists.');
    }
    $scheme = ['id' => uuid4()] + $scheme;
    $columns = implode(', ', array_keys($scheme));
    $holders = rtrim(str_repeat('?, ', count($scheme)), ', ');
    $pdo->prepare("INSERT INTO schemes ($columns) VALUES ($holders)")->execute(array_values($scheme));
    audit($owner, 'SCHEME_CREATED', "{$scheme['code']} {$scheme['name']}");
    respond(['status' => 'SUCCESS', 'message' => "Scheme {$scheme['code']} created.",
        'scheme' => scheme_public(row('SELECT * FROM schemes WHERE id = ?', [$scheme['id']]))]);
}

function route_scheme_update(array $d, string $id = ''): void
{
    global $pdo;
    $owner = staff_user(SCHEME_WRITE_ROLES);
    $existing = row('SELECT * FROM schemes WHERE id = ?', [$id]);
    if (!$existing) {
        fail(404, 'Scheme not found.');
    }
    $scheme = scheme_payload($d, $existing);
    if ($scheme['code'] !== $existing['code'] && row('SELECT id FROM schemes WHERE code = ?', [$scheme['code']])) {
        fail(400, 'A scheme with this code already exists.');
    }
    $set = implode(', ', array_map(fn($column) => "$column = ?", array_keys($scheme)));
    $pdo->prepare("UPDATE schemes SET $set WHERE id = ?")->execute([...array_values($scheme), $id]);
    audit($owner, 'SCHEME_UPDATED', "{$scheme['code']} status={$scheme['status']}");
    respond(['status' => 'SUCCESS', 'message' => "Scheme {$scheme['code']} updated.",
        'scheme' => scheme_public(row('SELECT * FROM schemes WHERE id = ?', [$id]))]);
}

function route_scheme_delete(array $d, string $id = ''): void
{
    global $pdo;
    $owner = staff_user(SCHEME_WRITE_ROLES);
    $scheme = row('SELECT * FROM schemes WHERE id = ?', [$id]);
    if (!$scheme) {
        fail(404, 'Scheme not found.');
    }
    if (row('SELECT id FROM agent_collections WHERE scheme_id = ? LIMIT 1', [$id])) {
        fail(400, 'This scheme already has collections recorded against it. Set it to inactive instead of deleting.');
    }
    $pdo->prepare('DELETE FROM schemes WHERE id = ?')->execute([$id]);
    audit($owner, 'SCHEME_DELETED', $scheme['code']);
    respond(['status' => 'SUCCESS', 'message' => "Scheme {$scheme['code']} deleted."]);
}

// --- Field agents -------------------------------------------------------------------
function agent_payload(array $d, array $existing = []): array
{
    $get = fn(string $key, $fallback = null) => $d[$key] ?? ($existing[$key] ?? $fallback);
    $status = $get('status', 'active');
    if (!in_array($status, ['active', 'inactive'], true)) {
        fail(422, 'status must be active or inactive.');
    }
    $agent = [
        'code' => strtoupper(clip($get('code', ''), 20)),
        'name' => clip($get('name', ''), 150),
        'phone' => clip($get('phone', ''), 30),
        'branch' => clip($get('branch', ''), 100) ?: null,
        'status' => $status,
    ];
    if ($agent['code'] === '' || $agent['name'] === '' || $agent['phone'] === '') {
        fail(422, 'code, name and phone are required.');
    }
    return $agent;
}

function route_agents_list(array $d): void
{
    staff_user(AGENT_READ_ROLES);
    $agents = out_all(rows('SELECT a.*, COUNT(c.id) AS collection_count, COALESCE(SUM(c.amount), 0) AS collected_total
        FROM agents a LEFT JOIN agent_collections c ON c.agent_id = a.id
        GROUP BY a.id ORDER BY a.name'));
    respond(['agents' => array_map(function ($a) {
        $a['collection_count'] = (int)$a['collection_count'];
        $a['collected_total'] = (float)$a['collected_total'];
        return $a;
    }, $agents)]);
}

function route_agent_create(array $d): void
{
    global $pdo;
    $user = staff_user(AGENT_WRITE_ROLES);
    $agent = agent_payload($d);
    if (row('SELECT id FROM agents WHERE code = ?', [$agent['code']])) {
        fail(400, 'An agent with this code already exists.');
    }
    $agent = ['id' => uuid4()] + $agent;
    $pdo->prepare('INSERT INTO agents (id, code, name, phone, branch, status) VALUES (?, ?, ?, ?, ?, ?)')
        ->execute(array_values($agent));
    audit($user, 'AGENT_CREATED', "{$agent['code']} {$agent['name']}");
    respond(['status' => 'SUCCESS', 'message' => "Agent {$agent['code']} added.", 'agent' => out($agent)]);
}

function route_agent_update(array $d, string $id = ''): void
{
    global $pdo;
    $user = staff_user(AGENT_WRITE_ROLES);
    $existing = row('SELECT * FROM agents WHERE id = ?', [$id]);
    if (!$existing) {
        fail(404, 'Agent not found.');
    }
    $agent = agent_payload($d, $existing);
    if ($agent['code'] !== $existing['code'] && row('SELECT id FROM agents WHERE code = ?', [$agent['code']])) {
        fail(400, 'An agent with this code already exists.');
    }
    $set = implode(', ', array_map(fn($column) => "$column = ?", array_keys($agent)));
    $pdo->prepare("UPDATE agents SET $set WHERE id = ?")->execute([...array_values($agent), $id]);
    audit($user, 'AGENT_UPDATED', "{$agent['code']} status={$agent['status']}");
    respond(['status' => 'SUCCESS', 'message' => "Agent {$agent['code']} updated."]);
}

function route_agent_delete(array $d, string $id = ''): void
{
    global $pdo;
    $user = staff_user(AGENT_WRITE_ROLES);
    $agent = row('SELECT * FROM agents WHERE id = ?', [$id]);
    if (!$agent) {
        fail(404, 'Agent not found.');
    }
    if (row('SELECT id FROM agent_collections WHERE agent_id = ? LIMIT 1', [$id])) {
        fail(400, 'This agent has collections recorded. Set them to inactive instead of deleting.');
    }
    $pdo->prepare('DELETE FROM agents WHERE id = ?')->execute([$id]);
    audit($user, 'AGENT_DELETED', $agent['code']);
    respond(['status' => 'SUCCESS', 'message' => "Agent {$agent['code']} removed."]);
}

// --- Collection records ---------------------------------------------------------------
// A record of what an agent collected in the field. It does not move money: crediting
// a member's account stays a separate, authorised teller action.
function route_collections_list(array $d, string $id = ''): void
{
    staff_user(AGENT_READ_ROLES);
    $agent = row('SELECT * FROM agents WHERE id = ?', [$id]);
    if (!$agent) {
        fail(404, 'Agent not found.');
    }
    $items = out_all(rows('SELECT c.*, s.code AS scheme_code FROM agent_collections c
        LEFT JOIN schemes s ON s.id = c.scheme_id
        WHERE c.agent_id = ? ORDER BY c.collected_on DESC, c.created_at DESC LIMIT 200', [$id]));
    respond(['agent' => out($agent), 'collections' => $items,
        'total' => (float)array_sum(array_column($items, 'amount'))]);
}

function route_collection_create(array $d): void
{
    global $pdo;
    $user = staff_user(AGENT_READ_ROLES);
    need($d, 'agent_id', 'account_number', 'amount', 'collected_on');
    $agent = row('SELECT * FROM agents WHERE id = ?', [clip($d['agent_id'], 36)]);
    if (!$agent) {
        fail(404, 'Agent not found.');
    }
    if ($agent['status'] !== 'active') {
        fail(400, 'This agent is inactive.');
    }
    $amount = money($d['amount']);
    if ($amount <= 0 || $amount > 1000000) {
        fail(422, 'Amount must be between ₹1 and ₹10,00,000.');
    }
    $accountNumber = clip($d['account_number'], 30);
    $account = row('SELECT user_id FROM accounts WHERE account_number = ?', [$accountNumber]);
    if (!$account) {
        fail(404, 'No member account with that number.');
    }
    $schemeId = clip($d['scheme_id'] ?? '', 36) ?: null;
    if ($schemeId !== null && !row('SELECT id FROM schemes WHERE id = ?', [$schemeId])) {
        fail(404, 'Scheme not found.');
    }
    $collection = [
        'id' => uuid4(), 'agent_id' => $agent['id'], 'member_user_id' => $account['user_id'],
        'account_number' => $accountNumber, 'scheme_id' => $schemeId, 'amount' => $amount,
        'collected_on' => valid_date($d['collected_on'], 'collected_on'),
        'receipt_no' => clip($d['receipt_no'] ?? '', 30) ?: 'RCPT-' . random_int(100000, 999999),
        'notes' => clip($d['notes'] ?? '', 255) ?: null, 'recorded_by' => $user['id'],
    ];
    $columns = implode(', ', array_keys($collection));
    $holders = rtrim(str_repeat('?, ', count($collection)), ', ');
    $pdo->prepare("INSERT INTO agent_collections ($columns) VALUES ($holders)")->execute(array_values($collection));
    audit($user, 'COLLECTION_RECORDED', "{$agent['code']} $accountNumber " . rupees($amount));
    respond(['status' => 'SUCCESS',
        'message' => 'Collection of ' . rupees($amount) . " recorded for {$agent['name']}. Receipt {$collection['receipt_no']}.",
        'collection' => out($collection)]);
}
