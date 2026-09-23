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
    if (($scheme['payout_type'] ?? 'maturity') === 'monthly' && $months < 2) {
        return null;
    }
    $byInstalment = in_array($scheme['scheme_type'], ['daily', 'recurring'], true);
    // Some plans take instalments for only part of the term and then hold the
    // fund. Spreading those contributions across the whole tenure would put the
    // money in later than it really goes in, and overstate the rate needed to
    // reach the maturity figure.
    $payIn = (int)($scheme['contribution_months'] ?? 0) ?: $months;
    $payIn = max(1, min($payIn, $months));
    $contribution = $byInstalment ? $deposit / $payIn : 0.0;
    // What the member pays in, discounted to the day they join. Instalments are
    // paid at the start of each month, so the first one is not discounted.
    $paidIn = function (float $rate) use ($byInstalment, $payIn, $deposit, $contribution): float {
        if (!$byInstalment) {
            return $deposit;
        }
        $total = 0.0;
        for ($i = 1; $i <= $payIn; $i++) {
            $total += $contribution / (1 + $rate) ** ($i - 1);
        }
        return $total;
    };
    // What they get back, discounted the same way. A monthly-payout scheme hands
    // the money over in equal instalments across the term rather than in one sum
    // at the end, so the member has it years earlier and the scheme is paying a
    // far higher rate than the same two totals would imply on maturity.
    $monthlyPayout = ($scheme['payout_type'] ?? 'maturity') === 'monthly';
    $paidOut = function (float $rate) use ($monthlyPayout, $months, $maturity): float {
        if (!$monthlyPayout) {
            return $maturity / (1 + $rate) ** $months;
        }
        $each = $maturity / $months;
        $total = 0.0;
        for ($i = 1; $i <= $months; $i++) {
            $total += $each / (1 + $rate) ** $i;
        }
        return $total;
    };
    [$low, $high] = [0.0, 0.05];  // up to 5% per month
    for ($i = 0; $i < 80; $i++) {
        $mid = ($low + $high) / 2;
        if ($paidOut($mid) > $paidIn($mid)) {
            $low = $mid;
        } else {
            $high = $mid;
        }
    }
    return round(((1 + ($low + $high) / 2) ** 12 - 1) * 100, 2);
}

// The maturity figure this plan would have to print to sit exactly on the cap.
// effective_rate() answers "what does this cost"; this answers "what would it
// have to say instead", which is the only form of the question anyone can act
// on. Same discounting, solved the other way round.
function cap_compliant_maturity(array $scheme): ?array
{
    $months = (int)$scheme['tenure_months'];
    $deposit = (float)$scheme['total_deposit'];
    if ($months < 1 || $deposit <= 0) {
        return null;
    }
    $r = (1 + NIDHI_MAX_DEPOSIT_RATE / 100) ** (1 / 12) - 1;
    $byInstalment = in_array($scheme['scheme_type'], ['daily', 'recurring'], true);
    $payIn = (int)($scheme['contribution_months'] ?? 0) ?: $months;
    $payIn = max(1, min($payIn, $months));

    // What the member's money is worth on the day they join.
    $paidIn = $deposit;
    if ($byInstalment) {
        $each = $deposit / $payIn;
        $paidIn = 0.0;
        for ($i = 1; $i <= $payIn; $i++) {
            $paidIn += $each / (1 + $r) ** ($i - 1);
        }
    }

    if (($scheme['payout_type'] ?? 'maturity') === 'monthly') {
        // Paid out in equal monthly instalments, so the same total is worth more
        // and the compliant figure is correspondingly lower.
        $factor = 0.0;
        for ($i = 1; $i <= $months; $i++) {
            $factor += 1 / (1 + $r) ** $i;
        }
        if ($factor <= 0) {
            return null;
        }
        $maturity = $paidIn * $months / $factor;
        return ['maturity_amount' => round($maturity, 2),
            'monthly_payout' => round($maturity / $months, 2)];
    }
    return ['maturity_amount' => round($paidIn * (1 + $r) ** $months, 2), 'monthly_payout' => null];
}

function scheme_public(array $scheme): array
{
    $scheme = out($scheme);
    $rate = effective_rate($scheme);
    $scheme['effective_rate_pa'] = $rate;
    $scheme['exceeds_cap'] = $rate !== null && $rate > NIDHI_MAX_DEPOSIT_RATE;
    // Only worked out where it is needed: a plan inside the cap has nothing to fix.
    $scheme['cap_compliant'] = $scheme['exceeds_cap'] ? cap_compliant_maturity($scheme) : null;
    // Rate every denomination, not just the representative one. A slab whose own
    // figures imply a different return is either priced differently on purpose or
    // is a misprint, and either way somebody should be able to see it.
    $slabs = json_decode((string)($scheme['slabs'] ?? ''), true);
    $scheme['slabs'] = [];
    if (is_array($slabs)) {
        foreach ($slabs as $slab) {
            $slabRate = effective_rate([
                'tenure_months' => $scheme['tenure_months'],
                'contribution_months' => $scheme['contribution_months'] ?? null,
                'total_deposit' => $slab['deposit'],
                'maturity_amount' => $slab['maturity'],
                'scheme_type' => $scheme['scheme_type'],
                'payout_type' => $scheme['payout_type'],
            ]);
            $slab['effective_rate_pa'] = $slabRate;
            $slab['exceeds_cap'] = $slabRate !== null && $slabRate > NIDHI_MAX_DEPOSIT_RATE;
            // Flag a slab that is more than half a point away from the plan's own
            // headline rate, which is how a mistyped figure shows up.
            $slab['off_headline'] = $rate !== null && $slabRate !== null
                && abs($slabRate - $rate) > 0.5;
            $scheme['slabs'][] = $slab;
        }
    }
    return $scheme;
}

// The terms of one denomination of a plan, ready to be written as a deposit.
// $unit is the slab the member picked -- the monthly instalment on an instalment
// plan, the lump sum on a fixed or monthly-income one.
//
// The rate is worked backwards from the figures the brochure prints rather than
// taken from the plan's headline. cron.php pays monthly interest as
// principal x rate / 12, so a monthly-income plan only pays the printed amount
// if the rate stored on the deposit is the one that produces it. Where that is
// above the Nidhi cap, it is above the cap on paper too, and the caller is told
// so rather than the figure being quietly trimmed to fit.
function scheme_deposit_terms(array $scheme, float $unit): array
{
    $slabs = json_decode((string)($scheme['slabs'] ?? ''), true);
    $slab = null;
    foreach (is_array($slabs) ? $slabs : [] as $row) {
        if (abs((float)$row['unit'] - $unit) < 0.005) {
            $slab = $row;
            break;
        }
    }
    if ($slab === null) {
        fail(422, 'That amount is not one of the denominations this plan is sold in.');
    }
    $months = (int)$scheme['tenure_months'];
    $deposit = (float)$slab['deposit'];
    $maturity = (float)$slab['maturity'];
    $byInstalment = in_array($scheme['scheme_type'], ['daily', 'recurring'], true);
    $monthly = ($scheme['payout_type'] ?? 'maturity') === 'monthly';

    if ($monthly) {
        // Printed per slab. Paying anything else would contradict the brochure
        // the member was sold from.
        $payout = (float)($slab['monthly_payout'] ?? 0);
        if ($payout <= 0) {
            fail(422, 'This plan is a monthly-income plan but that slab has no monthly payout printed.');
        }
        $rate = round($payout * 12 * 100 / $deposit, 2);
    } else {
        $rate = effective_rate([
            'tenure_months' => $months,
            'contribution_months' => $scheme['contribution_months'] ?? null,
            'total_deposit' => $deposit,
            'maturity_amount' => $maturity,
            'scheme_type' => $scheme['scheme_type'],
            'payout_type' => $scheme['payout_type'],
        ]) ?? 0.0;
    }

    return [
        'scheme_code' => $scheme['code'],
        'scheme_name' => $scheme['name'],
        'unit' => $unit,
        // An instalment plan collects its total over the pay-in months; a lump
        // sum plan takes it at the counter today. Only the second is money that
        // has to change hands to open the account.
        'by_instalment' => $byInstalment,
        'due_today' => $byInstalment ? $unit : $deposit,
        'total_deposit' => $deposit,
        'maturity_amount' => $maturity,
        'monthly_payout' => $monthly ? (float)$slab['monthly_payout'] : null,
        'deposit_type' => $byInstalment ? 'recurring' : 'fixed',
        'interest_payout' => $monthly ? 'monthly' : 'on_maturity',
        'interest_rate' => $rate,
        'tenure_months' => $months,
        'exceeds_cap' => $rate > NIDHI_MAX_DEPOSIT_RATE,
    ];
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
        'contribution_months' => $get('contribution_months') === null || $get('contribution_months') === ''
            ? null : max(1, min((int)$get('contribution_months'), $months)),
        'contribution_amount' => $get('contribution_amount') === null || $get('contribution_amount') === ''
            ? null : money($get('contribution_amount')),
        'principal_amount' => $get('principal_amount') === null || $get('principal_amount') === ''
            ? null : money($get('principal_amount')),
        'total_deposit' => money($get('total_deposit', 0)),
        'maturity_amount' => money($get('maturity_amount', 0)),
        'payout_type' => in_array($payout, ['maturity', 'monthly'], true) ? $payout : 'maturity',
        'slabs' => scheme_slabs($get('slabs')),
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
    // A member buys one denomination, not the headline. A published slab table
    // can pay a different rate row by row, so every row has to clear the cap
    // before any of them may be sold.
    if ($status === 'active' && $scheme['slabs'] !== null) {
        foreach (json_decode($scheme['slabs'], true) as $slab) {
            $slabRate = effective_rate([
                'tenure_months' => $scheme['tenure_months'],
                'contribution_months' => $scheme['contribution_months'],
                'total_deposit' => $slab['deposit'],
                'maturity_amount' => $slab['maturity'],
                'scheme_type' => $scheme['scheme_type'],
                'payout_type' => $scheme['payout_type'],
            ]);
            if ($slabRate !== null && $slabRate > NIDHI_MAX_DEPOSIT_RATE) {
                fail(422, sprintf(
                    'The %s denomination of this scheme returns about %.2f%% a year, above the %.1f%% '
                    . 'cap in the Nidhi Rules, 2014, even though the headline slab is within it. '
                    . 'Correct that row or save the scheme as a draft.',
                    number_format((float)$slab['unit'], 0), $slabRate, NIDHI_MAX_DEPOSIT_RATE));
            }
        }
    }
    return $scheme;
}

// The brochure sells each plan in fixed denominations. They are stored as JSON
// rather than rows of their own because they are a published price list, not
// something the ledger ever joins against.
function scheme_slabs($raw): ?string
{
    if ($raw === null || $raw === '' || $raw === []) {
        return null;
    }
    $list = is_string($raw) ? json_decode($raw, true) : $raw;
    if (!is_array($list)) {
        fail(422, 'slabs must be a list of {unit, deposit, maturity} entries.');
    }
    if (count($list) > 60) {
        fail(422, 'A scheme may publish at most 60 denominations.');
    }
    $clean = [];
    foreach ($list as $row) {
        if (!is_array($row)) {
            fail(422, 'Each slab must be an object with unit, deposit and maturity.');
        }
        $unit = money($row['unit'] ?? 0);
        $dep = money($row['deposit'] ?? 0);
        $mat = money($row['maturity'] ?? 0);
        if ($unit <= 0 || $dep <= 0 || $mat <= 0) {
            fail(422, 'Every slab needs a unit, a deposit and a maturity above zero.');
        }
        $clean[] = ['unit' => $unit, 'deposit' => $dep, 'maturity' => $mat];
    }
    usort($clean, fn($a, $b) => $a['unit'] <=> $b['unit']);
    return json_encode($clean);
}

// The company's own registration particulars, as they appear on the certificate
// of incorporation and the PAN/TAN allotment letters. Published so that a member
// can check the company on the MCA register before they part with any money.
const COMPANY_IDENTITY = [
    'legal_name' => 'Aadhunik Jeewan Sanchay Nidhi Limited',
    'cin' => 'U65990UP2019PLN121746',
    'pan' => 'AASCA7672B',
    'tan' => 'MRTA12278A',
    'incorporated_on' => '2019-09-27',
    'company_type' => 'Public company limited by shares, Nidhi under the Companies Act, 2013',
    'registered_office' => 'V Fatehpur Bhado, PO Chutmalpur, Saharanpur, Uttar Pradesh 247662',
    'corporate_office' => 'Arya Nagar, Kamalpur Road, Chhutmalpur, Saharanpur, Uttar Pradesh 247662',
    'phone' => '9105015464',
    'verify_at' => 'https://www.mca.gov.in',
];

const ECB_DAILY_RATES_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';

function ecb_usd_inr_from_xml(string $body): ?array
{
    if (!function_exists('simplexml_load_string')) {
        return null;
    }
    $xml = simplexml_load_string($body, SimpleXMLElement::class,
        LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING);
    if ($xml === false) {
        return null;
    }
    $dates = $xml->xpath('//*[local-name()="Cube"][@time]') ?: [];
    $nodes = $xml->xpath('//*[local-name()="Cube"][@currency]') ?: [];
    $rates = [];
    foreach ($nodes as $node) {
        $attrs = $node->attributes();
        $rates[(string)$attrs['currency']] = (float)$attrs['rate'];
    }
    $usd = $rates['USD'] ?? 0.0;
    $inr = $rates['INR'] ?? 0.0;
    if (!$dates || $usd <= 0 || $inr <= 0) {
        return null;
    }
    return ['rate' => round($inr / $usd, 4), 'as_of' => (string)$dates[0]->attributes()['time']];
}

function ecb_usd_inr(): ?array
{
    // ponytail: one shared hourly file cache; move to a shared store only if the API becomes multi-host.
    $cachePath = sys_get_temp_dir() . '/ajspay-ecb-usd-inr.json';
    $cached = is_file($cachePath) ? json_decode((string)file_get_contents($cachePath), true) : null;
    if (is_array($cached) && filemtime($cachePath) >= time() - 3600) {
        return $cached;
    }

    $ch = curl_init(ECB_DAILY_RATES_URL);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 5,
        CURLOPT_CONNECTTIMEOUT => 3,
        CURLOPT_USERAGENT => 'AJSPay-Public-Rates',
    ]);
    $body = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $rate = $status === 200 && is_string($body) ? ecb_usd_inr_from_xml($body) : null;
    if ($rate !== null) {
        file_put_contents($cachePath, json_encode($rate), LOCK_EX);
        return $rate;
    }
    return is_array($cached) ? $cached : null;
}

function route_public_market_rates(array $d): void
{
    respond([
        'usd_inr' => ecb_usd_inr(),
        'source' => 'European Central Bank daily reference rates',
    ]);
}

// Open to anyone, no login: the plans on sale and the terms attached to them.
// Draft plans are never listed. A published plan may still price above the cap —
// several do, on the owner's instruction — so scheme_public() rates every
// denomination and marks the ones that exceed it rather than the listing
// filtering them out.
function route_public_schemes(array $d): void
{
    $schemes = array_map('scheme_public', rows(
        'SELECT * FROM schemes WHERE status = ? AND deleted_at IS NULL
            ORDER BY scheme_type, tenure_months, code', ['active']));
    respond([
        'company' => COMPANY_IDENTITY,
        'schemes' => $schemes,
        'max_rate_pa' => NIDHI_MAX_DEPOSIT_RATE,
        'disclosure' => 'Returns are the amounts the scheme itself promises.',
    ]);
}

function route_schemes_list(array $d): void
{
    staff_user(SCHEME_READ_ROLES);
    respond([
        'schemes' => array_map('scheme_public', rows('SELECT * FROM schemes WHERE deleted_at IS NULL
            ORDER BY scheme_type, tenure_months, code')),
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
    if ($held = row('SELECT deleted_at FROM schemes WHERE code = ?', [$scheme['code']])) {
        // Deleted schemes keep their code, so an admin can be told a code is
        // taken by something no listing shows. Say which it is.
        fail(400, $held['deleted_at'] === null
            ? 'A scheme with this code already exists.'
            : 'This code belongs to a deleted scheme. Restore it from the recycle bin, '
                . 'or choose another code.');
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
    $existing = row('SELECT * FROM schemes WHERE id = ? AND deleted_at IS NULL', [$id]);
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
    $scheme = row('SELECT * FROM schemes WHERE id = ? AND deleted_at IS NULL', [$id]);
    if (!$scheme) {
        fail(404, 'Scheme not found.');
    }
    if (row('SELECT id FROM agent_collections WHERE scheme_id = ? LIMIT 1', [$id])) {
        fail(400, 'This scheme already has collections recorded against it. Set it to inactive instead of deleting.');
    }
    $pdo->prepare('UPDATE schemes SET deleted_at = NOW(), deleted_by = ? WHERE id = ?')
        ->execute([$owner['id'], $id]);
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
        WHERE a.deleted_at IS NULL
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
    if ($held = row('SELECT deleted_at FROM agents WHERE code = ?', [$agent['code']])) {
        // A deleted row keeps its code, so a code can be taken by something
        // no listing shows. Say which, rather than leaving an admin to guess.
        if ($held['deleted_at'] !== null) {
            fail(400, 'This code belongs to a deleted agent. Restore it from the recycle bin, '
                . 'or choose another code.');
        }
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
    $existing = row('SELECT * FROM agents WHERE id = ? AND deleted_at IS NULL', [$id]);
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
    $agent = row('SELECT * FROM agents WHERE id = ? AND deleted_at IS NULL', [$id]);
    if (!$agent) {
        fail(404, 'Agent not found.');
    }
    if (row('SELECT id FROM agent_collections WHERE agent_id = ? LIMIT 1', [$id])) {
        fail(400, 'This agent has collections recorded. Set them to inactive instead of deleting.');
    }
    $pdo->prepare('UPDATE agents SET deleted_at = NOW(), deleted_by = ? WHERE id = ?')
        ->execute([$user['id'], $id]);
    audit($user, 'AGENT_DELETED', $agent['code']);
    respond(['status' => 'SUCCESS', 'message' => "Agent {$agent['code']} removed."]);
}

// --- Collection records ---------------------------------------------------------------
// A record of what an agent collected in the field. It does not move money: crediting
// a member's account stays a separate, authorised teller action.
function route_collections_list(array $d, string $id = ''): void
{
    staff_user(AGENT_READ_ROLES);
    $agent = row('SELECT * FROM agents WHERE id = ? AND deleted_at IS NULL', [$id]);
    if (!$agent) {
        fail(404, 'Agent not found.');
    }
    [$rows, $meta] = paginate('SELECT c.*, s.code AS scheme_code FROM agent_collections c
        LEFT JOIN schemes s ON s.id = c.scheme_id
        WHERE c.agent_id = ? ORDER BY c.collected_on DESC, c.created_at DESC', [$id], 25, 100);
    $items = out_all($rows);
    // The total is over every collection, not just the page being shown.
    $total = (float)scalar('SELECT COALESCE(SUM(amount), 0) FROM agent_collections WHERE agent_id = ?', [$id]);
    respond(['agent' => out($agent), 'collections' => $items, 'pagination' => $meta, 'total' => $total]);
}

function route_collection_create(array $d): void
{
    global $pdo;
    $user = staff_user(AGENT_READ_ROLES);
    need($d, 'agent_id', 'account_number', 'amount', 'collected_on');
    $agent = row('SELECT * FROM agents WHERE id = ? AND deleted_at IS NULL', [clip($d['agent_id'], 36)]);
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

// --- Branch and ATM network -----------------------------------------------------------
// The public locator reads this table, so a branch added here appears on the public site
// immediately. Only the director may change it.
const BRANCH_WRITE_ROLES = ['bank_owner'];
const BRANCH_READ_ROLES = ['bank_owner', 'admin', 'branch_manager', 'staff'];

function branch_payload(array $d, array $existing = []): array
{
    $get = fn(string $key, $fallback = null) => $d[$key] ?? ($existing[$key] ?? $fallback);
    $name = clip($get('name', ''), 150);
    $code = strtoupper(clip($get('code', ''), 11));
    if ($name === '') {
        fail(422, 'Branch name is required.');
    }
    if (!preg_match('/^[A-Z0-9]{4,11}$/', $code)) {
        fail(422, 'Branch code must be 4 to 11 letters or digits.');
    }
    // A blank coordinate is legitimate — a branch with no pin simply is not mapped —
    // but a value that is present must be a real point on the globe.
    $point = function (string $key, float $limit) use ($get) {
        $value = $get($key);
        if ($value === null || $value === '') {
            return null;
        }
        if (!is_numeric($value) || abs((float)$value) > $limit) {
            fail(422, "$key must be a number between -$limit and $limit.");
        }
        return round((float)$value, 6);
    };
    return [
        'name' => $name,
        'bank' => clip($get('bank', 'AJSPay'), 50) ?: 'AJSPay',
        'code' => $code,
        'address' => clip($get('address', ''), 255),
        'lat' => $point('lat', 90.0),
        'lng' => $point('lng', 180.0),
        'phone' => clip($get('phone', ''), 30),
        'has_atm' => empty($get('has_atm')) ? 0 : 1,
        'has_cdm' => empty($get('has_cdm')) ? 0 : 1,
        'has_locker' => empty($get('has_locker')) ? 0 : 1,
        'timing' => clip($get('timing', ''), 50),
    ];
}

function route_branches_list(array $d): void
{
    staff_user(BRANCH_READ_ROLES);
    respond(['branches' => out_all(rows('SELECT * FROM branches WHERE deleted_at IS NULL ORDER BY name'))]);
}

function route_branch_create(array $d): void
{
    global $pdo;
    $user = staff_user(BRANCH_WRITE_ROLES);
    $branch = branch_payload($d);
    if ($held = row('SELECT deleted_at FROM branches WHERE code = ?', [$branch['code']])) {
        // A deleted row keeps its code, so a code can be taken by something
        // no listing shows. Say which, rather than leaving an admin to guess.
        if ($held['deleted_at'] !== null) {
            fail(400, 'This code belongs to a deleted branch. Restore it from the recycle bin, '
                . 'or choose another code.');
        }
        fail(400, 'A branch with this code already exists.');
    }
    $branch = ['id' => uuid4()] + $branch;
    $columns = implode(', ', array_keys($branch));
    $holders = rtrim(str_repeat('?, ', count($branch)), ', ');
    $pdo->prepare("INSERT INTO branches ($columns) VALUES ($holders)")->execute(array_values($branch));
    audit($user, 'BRANCH_CREATED', "{$branch['code']} {$branch['name']}");
    respond(['status' => 'SUCCESS', 'message' => "Branch {$branch['code']} created.",
        'branch' => out(row('SELECT * FROM branches WHERE id = ?', [$branch['id']]))]);
}

function route_branch_update(array $d, string $id = ''): void
{
    global $pdo;
    $user = staff_user(BRANCH_WRITE_ROLES);
    $existing = row('SELECT * FROM branches WHERE id = ? AND deleted_at IS NULL', [$id]);
    if (!$existing) {
        fail(404, 'Branch not found.');
    }
    $branch = branch_payload($d, $existing);
    if ($branch['code'] !== $existing['code'] && row('SELECT id FROM branches WHERE code = ?', [$branch['code']])) {
        fail(400, 'A branch with this code already exists.');
    }
    $set = implode(', ', array_map(fn($column) => "$column = ?", array_keys($branch)));
    $pdo->prepare("UPDATE branches SET $set WHERE id = ?")->execute([...array_values($branch), $id]);
    audit($user, 'BRANCH_UPDATED', "{$branch['code']} {$branch['name']}");
    respond(['status' => 'SUCCESS', 'message' => "Branch {$branch['code']} updated.",
        'branch' => out(row('SELECT * FROM branches WHERE id = ?', [$id]))]);
}

function route_branch_delete(array $d, string $id = ''): void
{
    global $pdo;
    $user = staff_user(BRANCH_WRITE_ROLES);
    $branch = row('SELECT * FROM branches WHERE id = ? AND deleted_at IS NULL', [$id]);
    if (!$branch) {
        fail(404, 'Branch not found.');
    }
    // Members and staff are attached to a branch by name; removing it from under
    // them would leave their records pointing at a branch that no longer exists.
    $attached = row('SELECT COUNT(*) AS n FROM users WHERE branch = ?', [$branch['name']]);
    if ($attached && (int)$attached['n'] > 0) {
        fail(400, "{$branch['name']} still has {$attached['n']} member(s) or staff attached to it. Move them first.");
    }
    $pdo->prepare('UPDATE branches SET deleted_at = NOW(), deleted_by = ? WHERE id = ?')
        ->execute([$user['id'], $id]);
    audit($user, 'BRANCH_DELETED', "{$branch['code']} {$branch['name']}");
    respond(['status' => 'SUCCESS', 'message' => "Branch {$branch['code']} removed."]);
}

// --- Public product pages -------------------------------------------------------------
// The content behind /personal/savings-account and its siblings. The public reader is
// unauthenticated; only the director may change what visitors are told.
const PRODUCT_WRITE_ROLES = ['bank_owner'];
const PRODUCT_READ_ROLES = ['bank_owner', 'admin', 'branch_manager'];
const PRODUCT_GROUPS = ['personal', 'corporate', 'loans', 'investments', 'support'];

function product_public(array $row): array
{
    // A malformed list must not take the public page down with it, so anything
    // that does not decode to a list is served as an empty one.
    $list = function (?string $raw): array {
        $value = json_decode((string)$raw, true);
        return is_array($value) ? $value : [];
    };
    return [
        'id' => $row['id'],
        'path' => "{$row['group_key']}/{$row['slug']}",
        'group' => $row['group_key'],
        'slug' => $row['slug'],
        'title' => $row['title'],
        'tagline' => $row['tagline'],
        'summary' => $row['summary'],
        'highlights' => $list($row['highlights']),
        'facts' => $list($row['facts']),
        'documents' => $list($row['documents']),
        'note' => $row['note'],
        'requires' => $row['requires'],
        'sort_order' => (int)$row['sort_order'],
        'status' => $row['status'],
    ];
}

function route_public_products(array $d): void
{
    $rows = rows("SELECT * FROM site_products WHERE status = 'active' AND deleted_at IS NULL
        ORDER BY sort_order, title");
    respond(['products' => array_map('product_public', $rows)]);
}

function route_products_list(array $d): void
{
    staff_user(PRODUCT_READ_ROLES);
    respond([
        'products' => array_map('product_public', rows('SELECT * FROM site_products WHERE deleted_at IS NULL
            ORDER BY sort_order, title')),
        'groups' => PRODUCT_GROUPS,
    ]);
}

function product_payload(array $d, array $existing = []): array
{
    $get = fn(string $key, $fallback = null) => $d[$key] ?? ($existing[$key] ?? $fallback);
    $group = clip($get('group', $get('group_key', '')), 30);
    if (!in_array($group, PRODUCT_GROUPS, true)) {
        fail(422, 'group must be one of: ' . implode(', ', PRODUCT_GROUPS));
    }
    $slug = strtolower(clip($get('slug', ''), 80));
    if (!preg_match('/^[a-z0-9]+(-[a-z0-9]+)*$/', $slug)) {
        fail(422, 'slug must be lowercase words joined by hyphens, e.g. savings-account.');
    }
    $title = clip($get('title', ''), 150);
    if ($title === '') {
        fail(422, 'Title is required.');
    }
    // Lists arrive as arrays from the editor. Strings are dropped rather than
    // stored, so a malformed payload cannot corrupt a live public page.
    $strings = function ($value): string {
        $items = [];
        foreach (is_array($value) ? $value : [] as $item) {
            $text = clip($item, 300);
            if ($text !== '') {
                $items[] = $text;
            }
        }
        return json_encode(array_values($items), JSON_UNESCAPED_UNICODE);
    };
    $pairs = function ($value): string {
        $items = [];
        foreach (is_array($value) ? $value : [] as $pair) {
            if (!is_array($pair) || count($pair) < 2) {
                continue;
            }
            $label = clip($pair[0], 120);
            if ($label !== '') {
                $items[] = [$label, clip($pair[1], 300)];
            }
        }
        return json_encode(array_values($items), JSON_UNESCAPED_UNICODE);
    };
    $status = $get('status', 'active');
    if (!in_array($status, ['active', 'draft'], true)) {
        fail(422, 'status must be active or draft.');
    }
    return [
        'group_key' => $group,
        'slug' => $slug,
        'title' => $title,
        'tagline' => clip($get('tagline', ''), 255),
        'summary' => clip($get('summary', ''), 4000),
        'highlights' => $strings($get('highlights', [])),
        'facts' => $pairs($get('facts', [])),
        'documents' => $strings($get('documents', [])),
        'note' => clip($get('note', ''), 2000) ?: null,
        'requires' => clip($get('requires', ''), 50) ?: null,
        'sort_order' => (int)$get('sort_order', 0),
        'status' => $status,
    ];
}

function route_product_create(array $d): void
{
    global $pdo;
    $user = staff_user(PRODUCT_WRITE_ROLES);
    $product = product_payload($d);
    if (row('SELECT id FROM site_products WHERE group_key = ? AND slug = ?', [$product['group_key'], $product['slug']])) {
        fail(400, "A page already exists at /{$product['group_key']}/{$product['slug']}.");
    }
    $product = ['id' => uuid4()] + $product;
    $columns = implode(', ', array_keys($product));
    $holders = rtrim(str_repeat('?, ', count($product)), ', ');
    $pdo->prepare("INSERT INTO site_products ($columns) VALUES ($holders)")->execute(array_values($product));
    audit($user, 'PRODUCT_CREATED', "{$product['group_key']}/{$product['slug']}");
    respond(['status' => 'SUCCESS', 'message' => "Page /{$product['group_key']}/{$product['slug']} created.",
        'product' => product_public(row('SELECT * FROM site_products WHERE id = ?', [$product['id']]))]);
}

function route_product_update(array $d, string $id = ''): void
{
    global $pdo;
    $user = staff_user(PRODUCT_WRITE_ROLES);
    $existing = row('SELECT * FROM site_products WHERE id = ? AND deleted_at IS NULL', [$id]);
    if (!$existing) {
        fail(404, 'Page not found.');
    }
    $product = product_payload($d, $existing);
    $moved = $product['group_key'] !== $existing['group_key'] || $product['slug'] !== $existing['slug'];
    if ($moved && row('SELECT id FROM site_products WHERE group_key = ? AND slug = ?', [$product['group_key'], $product['slug']])) {
        fail(400, "A page already exists at /{$product['group_key']}/{$product['slug']}.");
    }
    $set = implode(', ', array_map(fn($column) => "$column = ?", array_keys($product)));
    $pdo->prepare("UPDATE site_products SET $set WHERE id = ?")->execute([...array_values($product), $id]);
    audit($user, 'PRODUCT_UPDATED', "{$product['group_key']}/{$product['slug']}");
    respond(['status' => 'SUCCESS', 'message' => "Page /{$product['group_key']}/{$product['slug']} updated.",
        'product' => product_public(row('SELECT * FROM site_products WHERE id = ?', [$id]))]);
}

function route_product_delete(array $d, string $id = ''): void
{
    global $pdo;
    $user = staff_user(PRODUCT_WRITE_ROLES);
    $product = row('SELECT * FROM site_products WHERE id = ? AND deleted_at IS NULL', [$id]);
    if (!$product) {
        fail(404, 'Page not found.');
    }
    $pdo->prepare('UPDATE site_products SET deleted_at = NOW(), deleted_by = ? WHERE id = ?')
        ->execute([$user['id'], $id]);
    audit($user, 'PRODUCT_DELETED', "{$product['group_key']}/{$product['slug']}");
    respond(['status' => 'SUCCESS', 'message' => "Page /{$product['group_key']}/{$product['slug']} removed."]);
}

// --- Recycle bin ------------------------------------------------------------------------
// The four tables above mark rows deleted rather than removing them, which is
// only half a feature: without somewhere to see and undo it, a soft delete is
// just a delete that leaves litter. This is the other half.
const RECYCLABLE = [
    'scheme'  => ['table' => 'schemes',       'label' => 'code', 'name' => 'name'],
    'agent'   => ['table' => 'agents',        'label' => 'code', 'name' => 'name'],
    'branch'  => ['table' => 'branches',      'label' => 'code', 'name' => 'name'],
    'product' => ['table' => 'site_products', 'label' => 'slug', 'name' => 'title'],
];

function route_recycle_bin(array $d): void
{
    staff_user(SCHEME_WRITE_ROLES);
    $items = [];
    foreach (RECYCLABLE as $kind => $meta) {
        // The table name comes from the constant above, never from the request.
        $rows = rows("SELECT r.id, r.{$meta['label']} AS label, r.{$meta['name']} AS name,
                r.deleted_at, u.name AS deleted_by_name
            FROM {$meta['table']} r LEFT JOIN users u ON u.id = r.deleted_by
            WHERE r.deleted_at IS NOT NULL ORDER BY r.deleted_at DESC LIMIT 100");
        foreach ($rows as $row) {
            $items[] = ['kind' => $kind] + out($row);
        }
    }
    usort($items, fn($a, $b) => strcmp($b['deleted_at'], $a['deleted_at']));
    respond(['items' => $items, 'kinds' => array_keys(RECYCLABLE)]);
}

function route_recycle_restore(array $d): void
{
    global $pdo;
    $owner = staff_user(SCHEME_WRITE_ROLES);
    $kind = clip($d['kind'] ?? '', 20);
    if (!isset(RECYCLABLE[$kind])) {
        fail(422, 'kind must be one of: ' . implode(', ', array_keys(RECYCLABLE)));
    }
    $meta = RECYCLABLE[$kind];
    $id = clip($d['id'] ?? '', 36);
    $row = row("SELECT * FROM {$meta['table']} WHERE id = ? AND deleted_at IS NOT NULL", [$id]);
    if (!$row) {
        fail(404, 'That item is not in the recycle bin.');
    }
    // A backstop, not a routine path: the create routes refuse a code a deleted
    // row is holding, so nothing should normally be sitting on it. It stays
    // because the cost of being wrong is two live rows on one code and lookups
    // returning whichever the database felt like that query.
    $clash = row("SELECT id FROM {$meta['table']} WHERE {$meta['label']} = ? AND deleted_at IS NULL",
        [$row[$meta['label']]]);
    if ($clash) {
        fail(409, "Another live {$kind} already uses {$row[$meta['label']]}. "
            . 'Rename or remove that one first, then restore this.');
    }
    $pdo->prepare("UPDATE {$meta['table']} SET deleted_at = NULL, deleted_by = NULL WHERE id = ?")
        ->execute([$id]);
    audit($owner, strtoupper($kind) . '_RESTORED', (string)$row[$meta['label']]);
    respond(['status' => 'SUCCESS',
        'message' => ucfirst($kind) . " {$row[$meta['label']]} restored."]);
}

// --- Member ranks ----------------------------------------------------------------------
// A standing earned from how many members someone has introduced, and what standing those
// members have reached in turn. It is recognition only: nothing here pays anybody. The
// Nidhi Rules, 2014 prohibit brokerage or incentives for mobilising deposits, so there is
// no commission attached to a rank and none is calculated anywhere in this file.
const MEMBER_RANKS = [
    1 => 'Silver',
    2 => 'Gold',
    3 => 'Platinum',
    4 => 'Diamond',
    5 => 'Ruby',
    6 => 'Blue Diamond',
    7 => 'Emerald',
    8 => 'Ambassador',
    9 => 'Brand Ambassador',
];
// Each rank needs two members directly introduced who hold the rank below it. Silver is
// the entry: two introductions of any standing.
const RANK_WIDTH = 2;

function member_rank_map(): array
{
    // referrer -> the members they introduced. Only referrals that actually
    // completed count; a lead that never became a member is not an introduction.
    $children = [];
    foreach (rows("SELECT referrer_id, referee_id FROM referrals WHERE status = 'paid'") as $r) {
        $children[$r['referrer_id']][] = $r['referee_id'];
    }

    $rank = [];
    // Settle by repetition rather than recursion: a rank can only rise when one
    // below it rises, so nine passes is the most the ladder can need.
    for ($pass = 0; $pass < count(MEMBER_RANKS); $pass++) {
        $changed = false;
        foreach ($children as $parent => $kids) {
            $best = 0;
            for ($level = count(MEMBER_RANKS); $level >= 1; $level--) {
                $needed = $level - 1;   // Silver needs two of rank 0, i.e. any member
                $qualifying = 0;
                foreach ($kids as $kid) {
                    if (($rank[$kid] ?? 0) >= $needed) {
                        $qualifying++;
                    }
                }
                if ($qualifying >= RANK_WIDTH) {
                    $best = $level;
                    break;
                }
            }
            if ($best !== ($rank[$parent] ?? 0)) {
                $rank[$parent] = $best;
                $changed = true;
            }
        }
        if (!$changed) {
            break;
        }
    }
    return array_filter($rank, fn($level) => $level > 0);
}

// What a member sees about their own standing. The director's view above lists
// everybody; this answers the only two questions a member actually asks --
// where am I, and what do I do next -- and answers the second as a number
// rather than as the ladder's rule, because "introduce two members who have
// reached Silver" is a rule and "you need one more" is an instruction.
//
// Deliberately no money anywhere in this response. A standing is a standing:
// the Nidhi Rules, 2014 forbid paying brokerage or incentive for bringing in
// deposits, and a screen that showed a figure beside a rung would be read as a
// promise to pay it.
function route_my_standing(array $d): void
{
    global $config;
    $user = current_user();
    $ranks = member_rank_map();
    $level = $ranks[$user['id']] ?? 0;

    // Everyone this member introduced, and where each of them stands. This is
    // the "who is under whom" of the ladder, one level deep: a member may see
    // the people they introduced, and not the rest of anybody's chain.
    $introduced = [];
    foreach (rows("SELECT r.referee_id, r.referee_name, r.created_at, u.name AS member_name
        FROM referrals r LEFT JOIN users u ON u.id = r.referee_id
        WHERE r.referrer_id = ? AND r.status = 'paid'
        ORDER BY r.created_at DESC", [$user['id']]) as $r) {
        $theirLevel = $ranks[$r['referee_id']] ?? 0;
        $introduced[] = [
            'name' => $r['member_name'] ?? $r['referee_name'],
            'standing' => $theirLevel === 0 ? null : MEMBER_RANKS[$theirLevel],
            'standing_level' => $theirLevel,
            'joined_at' => iso($r['created_at']),
        ];
    }

    $next = null;
    if ($level < count(MEMBER_RANKS)) {
        $nextLevel = $level + 1;
        $needAt = $nextLevel - 1;   // Silver counts any member; every rung above counts the one below
        $have = count(array_filter($introduced, fn($m) => $m['standing_level'] >= $needAt));
        $short = max(0, RANK_WIDTH - $have);
        $next = [
            'standing' => MEMBER_RANKS[$nextLevel],
            'needs' => RANK_WIDTH,
            'needs_standing' => $needAt === 0 ? null : MEMBER_RANKS[$needAt],
            'have' => $have,
            'short_by' => $short,
            'step' => $needAt === 0
                ? ($short === 0
                    ? 'You have everything you need for ' . MEMBER_RANKS[$nextLevel] . '.'
                    : 'Introduce ' . $short . ' more member' . ($short === 1 ? '' : 's') . '. '
                      . 'Anyone who opens an account and completes their KYC counts.')
                : ($short === 0
                    ? 'You have everything you need for ' . MEMBER_RANKS[$nextLevel] . '.'
                    : $short . ' more of the members you introduced ' . ($short === 1 ? 'needs' : 'need')
                      . ' to reach ' . MEMBER_RANKS[$needAt] . '. Helping the ones you have already '
                      . 'introduced get there counts for you as well as for them.'),
        ];
    }

    $code = ensure_referral_code($user);
    respond([
        'standing' => $level === 0 ? null : MEMBER_RANKS[$level],
        'standing_level' => $level,
        'introduced' => $introduced,
        'introduced_count' => count($introduced),
        'next' => $next,
        'ladder' => array_values(MEMBER_RANKS),
        'width' => RANK_WIDTH,
        'referral_code' => $code,
        'referral_link' => rtrim((string)$config['public_app_url'], '/') . '/open-account?ref=' . rawurlencode($code),
        'note' => 'A standing is recognition only. No commission, brokerage or incentive is paid on it — '
            . 'the Nidhi Rules, 2014 prohibit a Nidhi from paying for the mobilising of deposits.',
    ]);
}

function route_member_ranks(array $d): void
{
    staff_user(SCHEME_READ_ROLES);
    $ranks = member_rank_map();

    $counts = [];
    foreach (rows("SELECT referrer_id, COUNT(*) AS n FROM referrals WHERE status = 'paid' GROUP BY referrer_id") as $r) {
        $counts[$r['referrer_id']] = (int)$r['n'];
    }

    $members = [];
    foreach (rows('SELECT id, name, email, phone, branch FROM users WHERE role = ?', ['retail']) as $u) {
        $level = $ranks[$u['id']] ?? 0;
        $members[] = [
            'id' => $u['id'],
            'name' => $u['name'],
            'email' => $u['email'],
            'phone' => $u['phone'],
            'branch' => $u['branch'],
            'rank_level' => $level,
            'rank' => $level === 0 ? null : MEMBER_RANKS[$level],
            'introduced' => $counts[$u['id']] ?? 0,
            // What the next step would take, so a member can be told plainly.
            'next_rank' => $level >= count(MEMBER_RANKS) ? null : MEMBER_RANKS[$level + 1],
        ];
    }
    // Highest standing first, then by how many they have introduced.
    usort($members, fn($a, $b) => [$b['rank_level'], $b['introduced']] <=> [$a['rank_level'], $a['introduced']]);

    $byRank = [];
    foreach (MEMBER_RANKS as $level => $name) {
        $byRank[$name] = count(array_filter($members, fn($m) => $m['rank_level'] === $level));
    }

    respond([
        'members' => $members,
        'by_rank' => $byRank,
        'unranked' => count(array_filter($members, fn($m) => $m['rank_level'] === 0)),
        'ladder' => array_values(MEMBER_RANKS),
        'width' => RANK_WIDTH,
        'note' => 'Standing only. No commission, brokerage or incentive is paid on it — '
            . 'the Nidhi Rules, 2014 prohibit paying for the mobilising of deposits.',
    ]);
}
