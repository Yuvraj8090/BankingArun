<?php
// AJSPay: payment rails — how money actually leaves and enters this institution.
//
// Aadhunik Jeewan Sanchay Nidhi Limited is not a bank and is not an NPCI member,
// so it cannot put a message on the IMPS switch or the RBI's NEFT/RTGS clearing
// itself. Real money moves only through a regulated partner: an RBI-authorised
// payment aggregator or a sponsor bank, which holds the settlement account and
// carries the membership. This module is the seam between our ledger and that
// partner.
//
// Two drivers:
//   simulator — no money moves. Mints a reference, marks the transfer settled
//               and says so in every response. Safe on a laptop and the default.
//   partner   — real money. Calls the configured partner's payout and collect
//               APIs, and waits for their webhook before treating anything as
//               settled.
//
// A third driver slot, "npci", is deliberately not written. It would need a
// bank licence, an HSM, INFINET connectivity and NPCI certification — none of
// which this entity holds.
//
// The rule this module exists to enforce: our ledger is never marked settled
// on our own say-so. A payout is PENDING until the partner confirms it, and an
// incoming payment is credited only when the partner says the money arrived.
declare(strict_types=1);

const RAIL_DRIVERS = ['simulator', 'partner'];
const RAIL_SECRET_KEYS = ['key_secret', 'webhook_secret'];
// Terminal states a partner can report. Anything else we treat as still pending.
const RAIL_STATES = ['PENDING', 'SUCCESS', 'FAILED'];

// Defaults shaped like the common Indian aggregator payout APIs. Every path and
// field name is configurable, because no two partners agree on any of them.
const RAIL_DEFAULTS = [
    'driver'           => 'simulator',
    'partner_name'     => '',
    'base_url'         => '',
    'auth'             => 'basic',        // basic | bearer
    'key_id'           => '',
    'key_secret'       => '',
    'webhook_secret'   => '',
    'webhook_header'   => 'X-Webhook-Signature',
    'settlement_account' => '',           // our own current account at the partner bank
    'payout_path'      => '/payouts',
    'collect_path'     => '/payment_links',
    'status_path'      => '/payouts/{ref}',
    // Where to read the partner's answer out of their JSON. Dot paths.
    'ref_field'        => 'id',
    'status_field'     => 'status',
    'utr_field'        => 'utr',
    'failure_field'    => 'failure_reason',
    // Where the payout/collection object sits inside a webhook envelope. Blank
    // means "look under payload, data or resource, and fall back to the event
    // itself" — which covers every partner we have seen. The field names above
    // are then read from that object, never from the envelope: the envelope's
    // own "id" is the event id, which is a different thing entirely.
    'event_object_path' => '',
    // Their vocabulary mapped onto ours.
    'status_map'       => [
        'processed' => 'SUCCESS', 'success' => 'SUCCESS', 'completed' => 'SUCCESS', 'paid' => 'SUCCESS',
        'queued' => 'PENDING', 'pending' => 'PENDING', 'processing' => 'PENDING', 'initiated' => 'PENDING',
        'failed' => 'FAILED', 'reversed' => 'FAILED', 'cancelled' => 'FAILED', 'rejected' => 'FAILED',
    ],
    'max_payout'       => 200000.0,       // per transaction
    'daily_payout_cap' => 1000000.0,      // across the whole institution, per IST day
    'timeout'          => 20,
];

// --- Configuration ---------------------------------------------------------------------
// config.local.php / config.rails.php provide the base; what the bank owner saves
// from the Rails screen wins over both, exactly like the OTP delivery settings.
function rail_config(): array
{
    global $config;
    $file = is_array($config['rails'] ?? null) ? $config['rails'] : [];
    $saved = is_array(system_config()['rails'] ?? null) ? system_config()['rails'] : [];
    $cfg = array_merge(RAIL_DEFAULTS, $file, $saved);
    foreach (RAIL_SECRET_KEYS as $key) {
        $value = (string)($cfg[$key] ?? '');
        if (str_starts_with($value, 'enc:')) {
            $cfg[$key] = decrypt_secret($value);
        }
    }
    if (!in_array($cfg['driver'], RAIL_DRIVERS, true)) {
        $cfg['driver'] = 'simulator';
    }
    // A partner with no address or no keys is not a partner. Falling back to the
    // simulator here would silently pretend money moved, so we refuse instead:
    // rail_ready() is what the callers check.
    return $cfg;
}

// Is this rail able to move real money right now?
function rail_ready(array $cfg): bool
{
    return $cfg['driver'] === 'simulator'
        || ($cfg['base_url'] !== '' && $cfg['key_id'] !== '' && $cfg['key_secret'] !== ''
            && $cfg['webhook_secret'] !== '');
}

function rail_is_live(): bool
{
    $cfg = rail_config();
    return $cfg['driver'] !== 'simulator' && rail_ready($cfg);
}

// --- Partner HTTP ------------------------------------------------------------------------
// Returns [httpStatus, decodedBody, networkError]. Never throws and never calls
// fail(): the cron reconciliation job runs this too, and must not exit.
function rail_http(array $cfg, string $method, string $path, array $payload = []): array
{
    $url = rtrim($cfg['base_url'], '/') . '/' . ltrim($path, '/');
    $headers = ['Content-Type: application/json', 'Accept: application/json'];
    if ($cfg['auth'] === 'bearer') {
        $headers[] = 'Authorization: Bearer ' . $cfg['key_secret'];
    }
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_TIMEOUT => (int)$cfg['timeout'],
        CURLOPT_CONNECTTIMEOUT => 10,
        // Partner endpoints are TLS and their certificate must verify. A payment
        // instruction sent to whoever answers the DNS is not a payment instruction.
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_FOLLOWLOCATION => false,
    ]);
    if ($cfg['auth'] === 'basic') {
        curl_setopt($ch, CURLOPT_USERPWD, $cfg['key_id'] . ':' . $cfg['key_secret']);
    }
    if ($method !== 'GET') {
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload, JSON_UNESCAPED_SLASHES));
    }
    $body = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $error = curl_error($ch);
    if ($body === false) {
        // No answer is not a refusal. The payout may well have been accepted, so
        // the caller leaves it PENDING for the reconciliation job to settle.
        error_log("AJSPay rail $method $path: network error $error");
        return [0, [], $error ?: 'No response from the payment partner.'];
    }
    return [$status, json_decode((string)$body, true) ?: [], ''];
}

// Reads "payout.status" style paths out of a partner's JSON.
function rail_pluck(array $data, string $path): ?string
{
    foreach (explode('.', $path) as $segment) {
        if (!is_array($data) || !array_key_exists($segment, $data)) {
            return null;
        }
        $data = $data[$segment];
    }
    return is_scalar($data) ? (string)$data : null;
}

// Digs the payout or collection object out of a webhook envelope. Getting this
// wrong means reading the event's own id as if it were the payout's, so the
// lookup quietly finds nothing and the member's money stays pending forever.
function rail_event_object(array $cfg, array $event): array
{
    $path = (string)$cfg['event_object_path'];
    if ($path !== '') {
        foreach (explode('.', $path) as $segment) {
            if (!is_array($event) || !array_key_exists($segment, $event)) {
                return [];
            }
            $event = $event[$segment];
        }
        return is_array($event) ? $event : [];
    }
    foreach (['payload', 'data', 'resource'] as $wrapper) {
        if (is_array($event[$wrapper] ?? null)) {
            $inner = $event[$wrapper];
            // Some partners wrap once more, by object type: payload.payout.entity.
            foreach ($inner as $value) {
                if (is_array($value) && isset($value['entity']) && is_array($value['entity'])) {
                    return $value['entity'];
                }
            }
            return $inner;
        }
    }
    return $event;
}

function rail_map_status(array $cfg, ?string $partnerStatus): string
{
    $map = is_array($cfg['status_map']) ? $cfg['status_map'] : [];
    $mapped = $map[strtolower((string)$partnerStatus)] ?? 'PENDING';
    return in_array($mapped, RAIL_STATES, true) ? $mapped : 'PENDING';
}

// --- The rail ledger -----------------------------------------------------------------------
// One row per instruction we gave the partner, keyed by an idempotency key we
// generate. It is the only record that survives a crash between our debit and
// their acceptance, and it is what the reconciliation job walks.
function rail_record(array $r): string
{
    global $pdo;
    $id = uuid4();
    $pdo->prepare('INSERT INTO rail_transactions (id, direction, rail, driver, user_id, account_number, amount,
            counterparty_name, counterparty_acc, counterparty_ifsc, counterparty_vpa, ref_number, idempotency_key,
            status, request_payload)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        ->execute([$id, $r['direction'], $r['rail'], $r['driver'], $r['user_id'], $r['account_number'],
            $r['amount'], $r['counterparty_name'] ?? null, $r['counterparty_acc'] ?? null,
            $r['counterparty_ifsc'] ?? null, $r['counterparty_vpa'] ?? null, $r['ref_number'],
            $r['idempotency_key'], 'PENDING', json_encode($r['request'] ?? [], JSON_UNESCAPED_SLASHES)]);
    return $id;
}

function rail_update(string $id, string $status, array $fields = [], array $event = []): void
{
    global $pdo;
    $pdo->prepare('UPDATE rail_transactions SET status = ?, partner_ref = COALESCE(?, partner_ref),
            utr = COALESCE(?, utr), failure_reason = COALESCE(?, failure_reason), last_event = ?
        WHERE id = ?')
        ->execute([$status, $fields['partner_ref'] ?? null, $fields['utr'] ?? null,
            isset($fields['failure_reason']) ? mb_substr((string)$fields['failure_reason'], 0, 255) : null,
            json_encode($event, JSON_UNESCAPED_SLASHES), $id]);
}

// How much this institution has already pushed out today, so the cap means
// something. Counts everything not yet known to have failed.
function rail_payout_today(?string $exceptKey = null): float
{
    $since = (new DateTimeImmutable('today', new DateTimeZone(IST)))->setTimezone(new DateTimeZone('UTC'));
    $sql = "SELECT COALESCE(SUM(amount), 0) FROM rail_transactions
        WHERE direction = 'payout' AND status <> 'FAILED' AND created_at >= ?";
    $params = [$since->format('Y-m-d H:i:s')];
    if ($exceptKey !== null) {
        $sql .= ' AND idempotency_key <> ?';
        $params[] = $exceptKey;
    }
    return (float)scalar($sql, $params);
}

// The limits we can check on our own, before a rupee moves. Callers run this
// before debiting, so a transfer that was never going to be allowed does not
// leave a debit and a reversal on the member's statement. rail_payout() checks
// again as a backstop.
function rail_limit_error(float $amount, ?string $exceptKey = null): ?string
{
    $cfg = rail_config();
    if ($amount > (float)$cfg['max_payout']) {
        return 'Amount exceeds the per-transaction rail limit of ' . rupees((float)$cfg['max_payout']) . '.';
    }
    if (rail_payout_today($exceptKey) + $amount > (float)$cfg['daily_payout_cap']) {
        return 'This would exceed the institution\'s daily payout cap. It can be sent after the cap '
            . 'resets, or the cap raised from the Rails screen.';
    }
    return null;
}

// --- Outbound: paying someone at another bank ------------------------------------------------
// Called after the sender has been debited and the ledger entry written as
// PENDING, outside the database transaction — a partner API call must never be
// made while holding row locks. Returns a terminal or pending state; it never
// calls fail().
function rail_payout(array $req): array
{
    $cfg = rail_config();
    if (!rail_ready($cfg)) {
        return ['status' => 'FAILED', 'message' => 'The payment partner is not configured. '
            . 'No money can be sent out until the bank owner completes the rail setup.'];
    }
    $limit = rail_limit_error($req['amount'], $req['idempotency_key'] ?? null);
    if ($limit !== null) {
        return ['status' => 'FAILED', 'message' => $limit];
    }

    if ($cfg['driver'] === 'simulator') {
        // Deliberately loud. A simulated payout that reads like a real one is how
        // someone ends up believing money left the building when it did not.
        return ['status' => 'SUCCESS', 'partner_ref' => 'SIM-' . strtoupper(bin2hex(random_bytes(6))),
            'utr' => 'SIM' . gmdate('YmdHis') . random_int(100, 999),
            'message' => 'Simulated payout. No money left this institution.', 'simulated' => true];
    }

    // The partner's own idempotency contract: retrying the same key must never
    // pay twice. Ours is derived from the transfer reference, so a retried
    // request after a timeout resolves to the same payout on their side.
    [$http, $body, $network] = rail_http($cfg, 'POST', $cfg['payout_path'], [
        'idempotency_key'    => $req['idempotency_key'],
        'reference_id'       => $req['ref_number'],
        'mode'               => $req['rail'],                 // IMPS | NEFT | RTGS | UPI
        'amount'             => (int)round($req['amount'] * 100),  // paise, the usual unit
        'currency'           => 'INR',
        'purpose'            => 'payout',
        'narration'          => mb_substr($req['remarks'] ?? 'Fund transfer', 0, 30),
        'settlement_account' => $cfg['settlement_account'],
        'beneficiary'        => array_filter([
            'name'  => $req['counterparty_name'],
            'account_number' => $req['counterparty_acc'] ?? null,
            'ifsc'  => $req['counterparty_ifsc'] ?? null,
            'vpa'   => $req['counterparty_vpa'] ?? null,
        ]),
    ]);

    if ($network !== '' || $http === 0) {
        // Unknown, not failed. Reversing here could pay the beneficiary twice.
        return ['status' => 'PENDING', 'message' => 'The payment partner did not answer in time. '
            . 'The transfer is pending and will be confirmed automatically.'];
    }
    if ($http >= 400) {
        $reason = rail_pluck($body, $cfg['failure_field']) ?? rail_pluck($body, 'error.description')
            ?? "Partner rejected the payout (HTTP $http).";
        error_log("AJSPay rail payout rejected: HTTP $http " . json_encode($body));
        return ['status' => 'FAILED', 'message' => $reason, 'raw' => $body];
    }
    return [
        'status'      => rail_map_status($cfg, rail_pluck($body, $cfg['status_field'])),
        'partner_ref' => rail_pluck($body, $cfg['ref_field']),
        'utr'         => rail_pluck($body, $cfg['utr_field']),
        'message'     => 'Handed to ' . ($cfg['partner_name'] ?: 'the payment partner') . '.',
        'raw'         => $body,
    ];
}

// --- Inbound: pulling money into a member's account ---------------------------------------
// Money arrives in the partner's settlement account held in this institution's
// name; the member's balance moves only when the partner's webhook confirms it.
// Nothing here credits anything.
function rail_collect(array $req): array
{
    $cfg = rail_config();
    if (!rail_ready($cfg)) {
        return ['status' => 'FAILED', 'message' => 'The payment partner is not configured.'];
    }
    if ($cfg['driver'] === 'simulator') {
        return ['status' => 'PENDING', 'partner_ref' => 'SIM-' . strtoupper(bin2hex(random_bytes(6))),
            'pay_url' => '', 'upi_uri' => 'upi://pay?pa=simulator@ajspay&am=' . $req['amount'],
            'message' => 'Simulated collect request. Settle it from the Rails screen to test the credit path.',
            'simulated' => true];
    }
    [$http, $body, $network] = rail_http($cfg, 'POST', $cfg['collect_path'], [
        'idempotency_key' => $req['idempotency_key'],
        'reference_id'    => $req['ref_number'],
        'amount'          => (int)round($req['amount'] * 100),
        'currency'        => 'INR',
        'description'     => mb_substr($req['remarks'] ?? 'Deposit to AJSPay account', 0, 60),
        'customer'        => array_filter(['name' => $req['payer_name'] ?? null, 'upi' => $req['payer_vpa'] ?? null]),
        'notify'          => ['sms' => false, 'email' => false],
    ]);
    if ($network !== '' || $http === 0) {
        return ['status' => 'FAILED', 'message' => 'The payment partner did not answer. Please try again.'];
    }
    if ($http >= 400) {
        error_log("AJSPay rail collect rejected: HTTP $http " . json_encode($body));
        return ['status' => 'FAILED',
            'message' => rail_pluck($body, $cfg['failure_field']) ?? 'The payment partner refused the request.'];
    }
    return ['status' => 'PENDING', 'partner_ref' => rail_pluck($body, $cfg['ref_field']),
        'pay_url' => rail_pluck($body, 'short_url') ?? rail_pluck($body, 'payment_url') ?? '',
        'upi_uri' => rail_pluck($body, 'upi_uri') ?? '',
        'message' => 'Payment request created. The balance updates once the money actually arrives.',
        'raw' => $body];
}

// --- Settlement ------------------------------------------------------------------------------
// The one place a rail transaction reaches a terminal state and the member's
// ledger is touched to match. Called by the webhook and by the reconciliation
// job, so it must be idempotent: a row already terminal is left alone.
// Returns a short description of what it did, for the cron log.
function rail_settle(array $railTxn, string $status, array $fields = [], array $event = []): string
{
    global $pdo;
    if ($railTxn['status'] !== 'PENDING') {
        return 'already ' . $railTxn['status'];
    }
    if (!in_array($status, ['SUCCESS', 'FAILED'], true)) {
        rail_update($railTxn['id'], 'PENDING', $fields, $event);
        return 'still pending';
    }

    $pdo->beginTransaction();
    try {
        // Re-read the row under a lock and decide from that, not from the copy
        // the caller handed in. Every caller reads it without one and outside a
        // transaction, and the two that matter — the partner's webhook and the
        // cron reconciler — are built to chase the same row at the same time.
        // Checking the caller's snapshot let both pass, and a failed payout was
        // then reversed twice: the member's balance rose by the amount of a
        // transfer that never left.
        $locked = row('SELECT * FROM rail_transactions WHERE id = ? FOR UPDATE', [$railTxn['id']]);
        if (!$locked) {
            $pdo->rollBack();
            return 'no longer present';
        }
        if ($locked['status'] !== 'PENDING') {
            $pdo->rollBack();
            return 'already ' . $locked['status'];
        }
        $railTxn = $locked;
        if ($railTxn['direction'] === 'payout') {
            if ($status === 'SUCCESS') {
                // The money really left. The member's debit, held as PENDING
                // since they authorised it, becomes final.
                $pdo->prepare("UPDATE transactions SET status = 'SUCCESS' WHERE ref_number = ? AND status = 'PENDING'")
                    ->execute([$railTxn['ref_number']]);
                $outcome = 'payout settled';
            } else {
                $outcome = rail_reverse_payout($railTxn, $fields['failure_reason'] ?? 'Payout failed at the partner.');
            }
        } else {
            $outcome = $status === 'SUCCESS'
                ? rail_credit_collection($railTxn)
                : 'collection failed, nothing credited';
        }
        rail_update($railTxn['id'], $status, $fields, $event);
        $pdo->commit();
        return $outcome;
    } catch (Throwable $e) {
        $pdo->rollBack();
        error_log('AJSPay rail settle failed for ' . $railTxn['ref_number'] . ': ' . $e);
        return 'settlement error: ' . $e->getMessage();
    }
}

// A payout the partner could not make. The member's money comes back, and the
// failed debit stays on the statement beside the reversal, because a balance
// that silently changes twice is a balance nobody can reconcile.
function rail_reverse_payout(array $railTxn, string $reason): string
{
    global $pdo;
    $account = row('SELECT * FROM accounts WHERE account_number = ? FOR UPDATE', [$railTxn['account_number']]);
    if (!$account) {
        error_log('AJSPay rail reversal: account ' . $railTxn['account_number'] . ' is gone');
        return 'reversal failed: account missing';
    }
    $amount = (float)$railTxn['amount'];
    $pdo->prepare("UPDATE transactions SET status = 'FAILED' WHERE ref_number = ? AND status = 'PENDING'")
        ->execute([$railTxn['ref_number']]);
    $pdo->prepare('UPDATE accounts SET balance = balance + ? WHERE id = ?')->execute([$amount, $account['id']]);
    insert_txn(['user_id' => $account['user_id'], 'account_number' => $account['account_number'],
        'type' => 'credit', 'mode' => $railTxn['rail'], 'amount' => $amount,
        'balance_after' => round((float)$account['balance'] + $amount, 2),
        'counterparty_name' => $railTxn['counterparty_name'], 'counterparty_acc' => $railTxn['counterparty_acc'],
        'ref_number' => 'REV-' . $railTxn['ref_number'],
        'description' => 'Reversal — ' . mb_substr($reason, 0, 200)]);
    return 'payout failed, ' . rupees($amount) . ' returned';
}

// Money that actually arrived in the settlement account, passed on to the member.
function rail_credit_collection(array $railTxn): string
{
    global $pdo;
    $account = row('SELECT * FROM accounts WHERE account_number = ? FOR UPDATE', [$railTxn['account_number']]);
    if (!$account) {
        error_log('AJSPay rail credit: account ' . $railTxn['account_number'] . ' is gone');
        return 'credit failed: account missing';
    }
    $amount = (float)$railTxn['amount'];
    $pdo->prepare('UPDATE accounts SET balance = balance + ? WHERE id = ?')->execute([$amount, $account['id']]);
    insert_txn(['user_id' => $account['user_id'], 'account_number' => $account['account_number'],
        'type' => 'credit', 'mode' => $railTxn['rail'], 'amount' => $amount,
        'balance_after' => round((float)$account['balance'] + $amount, 2),
        'counterparty_name' => $railTxn['counterparty_name'] ?: 'Inward payment',
        'counterparty_acc' => $railTxn['counterparty_vpa'] ?: $railTxn['partner_ref'],
        'ref_number' => $railTxn['ref_number'],
        'description' => 'Received via ' . $railTxn['rail'] . ' (' . ($railTxn['utr'] ?: $railTxn['partner_ref']) . ')']);
    return 'credited ' . rupees($amount);
}

// --- Dispatch ---------------------------------------------------------------------------------
// A payout row with no partner reference was recorded but never handed over:
// either the process died between the commit and the API call, or it was queued
// by the cron run, which cannot make HTTP calls while holding account locks.
// Either way the member has been debited and nobody has been paid, so this is
// the job that must not be skipped. cron.php calls it before reconciling.
function rail_dispatch_pending(bool $dryRun = false): array
{
    $sent = 0;
    $failed = 0;
    $notes = [];
    $queued = rows("SELECT * FROM rail_transactions
        WHERE direction = 'payout' AND status = 'PENDING' AND partner_ref IS NULL
        ORDER BY created_at LIMIT 100");
    foreach ($queued as $txn) {
        if ($dryRun) {
            $notes[] = $txn['ref_number'] . ': would be sent to the partner';
            $sent++;
            continue;
        }
        $result = rail_payout([
            'amount' => (float)$txn['amount'], 'rail' => $txn['rail'], 'ref_number' => $txn['ref_number'],
            'idempotency_key' => $txn['idempotency_key'], 'remarks' => '',
            'counterparty_name' => $txn['counterparty_name'], 'counterparty_acc' => $txn['counterparty_acc'],
            'counterparty_ifsc' => $txn['counterparty_ifsc'], 'counterparty_vpa' => $txn['counterparty_vpa'],
        ]);
        rail_update($txn['id'], 'PENDING', ['partner_ref' => $result['partner_ref'] ?? null,
            'utr' => $result['utr'] ?? null], $result['raw'] ?? []);
        if ($result['status'] === 'PENDING') {
            $notes[] = $txn['ref_number'] . ': sent, awaiting confirmation';
            $sent++;
            continue;
        }
        $fresh = row('SELECT * FROM rail_transactions WHERE id = ?', [$txn['id']]);
        $notes[] = $txn['ref_number'] . ': ' . rail_settle($fresh, $result['status'],
            ['failure_reason' => $result['message'] ?? null], $result['raw'] ?? []);
        $result['status'] === 'FAILED' ? $failed++ : $sent++;
    }
    return [$sent, $failed, $notes];
}

// --- Reconciliation --------------------------------------------------------------------------
// Webhooks get lost. Every pending rail transaction older than a couple of
// minutes is asked about directly, so nothing sits in limbo because one HTTP
// callback never arrived. cron.php calls this.
function rail_reconcile(bool $dryRun = false, int $maxAgeMinutes = 2): array
{
    $cfg = rail_config();
    if ($cfg['driver'] === 'simulator' || !rail_ready($cfg)) {
        return [0, 0, []];
    }
    $cutoff = gmdate('Y-m-d H:i:s', time() - $maxAgeMinutes * 60);
    $pending = rows("SELECT * FROM rail_transactions WHERE status = 'PENDING' AND created_at <= ?
        ORDER BY created_at LIMIT 200", [$cutoff]);
    $settled = 0;
    $stuck = 0;
    $notes = [];
    foreach ($pending as $txn) {
        if (!$txn['partner_ref']) {
            // We never got an acknowledgement. Ask by our own reference instead;
            // if the partner does not know it either, the instruction never landed.
            $stuck++;
            $notes[] = $txn['ref_number'] . ': no partner reference yet';
            continue;
        }
        [$http, $body] = rail_http($cfg, 'GET', str_replace('{ref}', rawurlencode($txn['partner_ref']),
            $cfg['status_path']));
        if ($http < 200 || $http >= 300) {
            $stuck++;
            continue;
        }
        $status = rail_map_status($cfg, rail_pluck($body, $cfg['status_field']));
        if ($status === 'PENDING') {
            $stuck++;
            continue;
        }
        if ($dryRun) {
            $notes[] = $txn['ref_number'] . ": would settle as $status";
            $settled++;
            continue;
        }
        $notes[] = $txn['ref_number'] . ': ' . rail_settle($txn, $status, [
            'utr' => rail_pluck($body, $cfg['utr_field']),
            'failure_reason' => rail_pluck($body, $cfg['failure_field']),
        ], $body);
        $settled++;
    }
    return [$settled, $stuck, $notes];
}

// --- Webhook ------------------------------------------------------------------------------------
// The partner's callback. Open to the internet, so it authenticates by signature
// over the raw body and nothing else — never by the contents of the payload.
function route_rail_webhook(array $d): void
{
    global $pdo;
    $cfg = rail_config();
    $raw = file_get_contents('php://input') ?: '';
    $sent = $_SERVER['HTTP_' . strtoupper(str_replace('-', '_', $cfg['webhook_header']))] ?? '';
    if ($cfg['webhook_secret'] === '' || $sent === ''
        || !hash_equals(hash_hmac('sha256', $raw, $cfg['webhook_secret']), (string)$sent)) {
        // Deliberately vague to the caller; the detail goes to the security log.
        security_event('RAIL_WEBHOOK_REJECTED', 'warning', 'Bad or missing signature from ' . client_ip());
        fail(401, 'Unauthorised.');
    }

    $event = json_decode($raw, true) ?: [];
    // Partners retry until they get a 2xx, so the same event arrives repeatedly.
    // The event id is the primary key: a duplicate insert is the dedupe.
    $eventId = clip($event['id'] ?? $event['event_id'] ?? '', 100);
    if ($eventId === '') {
        fail(422, 'Event is missing an id.');
    }
    try {
        $pdo->prepare('INSERT INTO rail_events (id, payload) VALUES (?, ?)')
            ->execute([$eventId, mb_substr($raw, 0, 60000)]);
    } catch (PDOException $e) {
        respond(['status' => 'DUPLICATE', 'message' => 'Event already processed.']);
    }

    // The object the event is about — never the envelope, whose "id" is the
    // event id we just de-duplicated on.
    $object = rail_event_object($cfg, $event);
    $partnerRef = clip(rail_pluck($object, $cfg['ref_field']) ?? '', 100);
    $ourRef = clip($object['reference_id'] ?? ($event['reference_id'] ?? ''), 100);
    $railTxn = $partnerRef !== ''
        ? row('SELECT * FROM rail_transactions WHERE partner_ref = ?', [$partnerRef])
        : null;
    $railTxn ??= $ourRef !== '' ? row('SELECT * FROM rail_transactions WHERE ref_number = ?', [$ourRef]) : null;
    if (!$railTxn) {
        // Acknowledge anyway: a 4xx would make the partner retry an event about
        // a transaction that is not ours, forever.
        error_log("AJSPay rail webhook for unknown transaction: $partnerRef / $ourRef");
        respond(['status' => 'IGNORED', 'message' => 'No matching transaction.']);
    }

    $status = rail_map_status($cfg, rail_pluck($object, $cfg['status_field'])
        ?? rail_pluck($event, $cfg['status_field']));
    $outcome = rail_settle($railTxn, $status, [
        'partner_ref' => $partnerRef ?: null,
        'utr' => rail_pluck($object, $cfg['utr_field']),
        'failure_reason' => rail_pluck($object, $cfg['failure_field']),
    ], $event);
    respond(['status' => 'OK', 'result' => $outcome]);
}

// --- Member-facing: ask for money to be paid in -------------------------------------------------
function route_rail_collect(array $d): void
{
    $user = current_user();
    require_capability('upi');
    need($d, 'account_number', 'amount');
    $amount = money($d['amount']);
    if ($amount <= 0 || $amount > 200000) {
        fail(422, 'Amount must be between ₹1 and ₹2,00,000.');
    }
    $account = owned_account($user, $d['account_number']);
    if (!$account) {
        fail(404, 'Account not found.');
    }
    if ($account['status'] !== 'active') {
        fail(403, 'This account cannot receive payments right now.');
    }
    $cfg = rail_config();
    $ref = 'COL-' . gmdate('YmdHis') . '-' . random_int(100, 999);
    $key = hash('sha256', 'collect:' . $ref);
    $result = rail_collect(['amount' => $amount, 'ref_number' => $ref, 'idempotency_key' => $key,
        'remarks' => clip($d['remarks'] ?? '', 60), 'payer_name' => clip($d['payer_name'] ?? '', 150),
        'payer_vpa' => clip($d['payer_vpa'] ?? '', 100)]);
    if ($result['status'] === 'FAILED') {
        fail(502, $result['message']);
    }
    $id = rail_record(['direction' => 'collect', 'rail' => 'UPI', 'driver' => $cfg['driver'],
        'user_id' => $user['id'], 'account_number' => $account['account_number'], 'amount' => $amount,
        'counterparty_name' => clip($d['payer_name'] ?? '', 150) ?: null,
        'counterparty_vpa' => clip($d['payer_vpa'] ?? '', 100) ?: null,
        'ref_number' => $ref, 'idempotency_key' => $key, 'request' => ['amount' => $amount]]);
    rail_update($id, 'PENDING', ['partner_ref' => $result['partner_ref'] ?? null]);
    audit($user, 'RAIL_COLLECT_CREATED', "$ref " . rupees($amount));
    respond(['status' => 'PENDING', 'reference' => $ref, 'pay_url' => $result['pay_url'] ?? '',
        'upi_uri' => $result['upi_uri'] ?? '', 'message' => $result['message'],
        'simulated' => $result['simulated'] ?? false]);
}

// What a member sees about their own in-flight payments. Nothing about the
// partner, the settlement account or anyone else's transactions.
function route_rail_my_pending(array $d): void
{
    $user = current_user();
    [$txns, $meta] = paginate('SELECT direction, rail, amount, counterparty_name, ref_number, utr, status,
            failure_reason, created_at
        FROM rail_transactions WHERE user_id = ?', [$user['id']], 25, 100);
    respond(['payments' => out_all($txns), 'pagination' => $meta]);
}

// --- Owner-facing: configuring and watching the rail ----------------------------------------------
function route_rail_config_get(array $d): void
{
    staff_user(['bank_owner']);
    $cfg = rail_config();
    respond([
        'driver' => $cfg['driver'],
        'live' => rail_is_live(),
        'ready' => rail_ready($cfg),
        'partner_name' => $cfg['partner_name'],
        'base_url' => $cfg['base_url'],
        'auth' => $cfg['auth'],
        'key_id_masked' => mask_secret($cfg['key_id']),
        'key_secret_masked' => mask_secret($cfg['key_secret']),
        'webhook_secret_masked' => mask_secret($cfg['webhook_secret']),
        'webhook_header' => $cfg['webhook_header'],
        'webhook_url' => rtrim((string)($GLOBALS['config']['public_app_url'] ?? ''), '/') . '/api/rails/webhook',
        'settlement_account' => $cfg['settlement_account'],
        'payout_path' => $cfg['payout_path'],
        'collect_path' => $cfg['collect_path'],
        'status_path' => $cfg['status_path'],
        'max_payout' => (float)$cfg['max_payout'],
        'daily_payout_cap' => (float)$cfg['daily_payout_cap'],
        'paid_out_today' => rail_payout_today(),
        'capability_payment_systems' => capability_enabled('payment_systems'),
        'capability_upi' => capability_enabled('upi'),
        'notice' => $cfg['driver'] === 'simulator'
            ? 'Simulator driver: no money moves. Transfers to accounts outside this institution are recorded '
              . 'but nothing is actually sent.'
            : 'Partner driver: transfers move real money through ' . ($cfg['partner_name'] ?: 'your partner')
              . '. Outward transfers also need the payment_systems capability switched on in the '
              . 'capability register, with the authorisation recorded.',
    ]);
}

function route_rail_config_set(array $d): void
{
    $owner = staff_user(['bank_owner']);
    $rails = is_array(system_config()['rails'] ?? null) ? system_config()['rails'] : [];
    $changed = [];
    if (isset($d['driver'])) {
        $driver = clip($d['driver'], 20);
        if (!in_array($driver, RAIL_DRIVERS, true)) {
            fail(422, 'driver must be one of: ' . implode(', ', RAIL_DRIVERS) . '.');
        }
        // Going live without complete credentials would make every outward
        // transfer fail at the moment a member presses send. Refuse here instead.
        if ($driver === 'partner' && !rail_ready(array_merge(rail_config(), $rails, ['driver' => 'partner']))) {
            fail(422, 'Enter the partner base URL, key id, key secret and webhook secret, save those, and '
                . 'then switch the driver to "partner".');
        }
        $rails['driver'] = $driver;
        $changed[] = 'driver';
    }
    foreach (['partner_name' => 60, 'base_url' => 200, 'auth' => 10, 'key_id' => 120, 'key_secret' => 200,
        'webhook_secret' => 200, 'webhook_header' => 60, 'settlement_account' => 40, 'payout_path' => 120,
        'collect_path' => 120, 'status_path' => 120] as $key => $max) {
        $value = clip($d[$key] ?? '', $max);
        if ($value === '') {
            continue;  // blank means "leave it as it is"
        }
        if ($key === 'base_url' && !preg_match('#\Ahttps://#', $value)) {
            fail(422, 'base_url must be an https:// address. Payment instructions may not travel in the clear.');
        }
        if ($key === 'auth' && !in_array($value, ['basic', 'bearer'], true)) {
            fail(422, 'auth must be "basic" or "bearer".');
        }
        $rails[$key] = in_array($key, RAIL_SECRET_KEYS, true) ? encrypt_secret($value) : $value;
        $changed[] = $key;
    }
    foreach (['max_payout', 'daily_payout_cap'] as $key) {
        if (isset($d[$key])) {
            $rails[$key] = money($d[$key]);
            if ($rails[$key] <= 0) {
                fail(422, str_replace('_', ' ', $key) . ' must be greater than zero.');
            }
            $changed[] = $key;
        }
    }
    if (!$changed) {
        fail(422, 'Nothing to update.');
    }
    save_system_config(['rails' => $rails], $owner);
    audit($owner, 'RAIL_CONFIG_UPDATED', implode(', ', $changed));
    security_event('RAIL_CONFIG_UPDATED', 'critical', 'Payment rail settings changed: '
        . implode(', ', $changed), $owner);
    respond(['status' => 'SUCCESS', 'message' => 'Rail settings saved.', 'changed' => $changed]);
}

// Proves the credentials and the network path work, before a member's money is
// the thing that discovers they do not.
function route_rail_test(array $d): void
{
    staff_user(['bank_owner']);
    $cfg = rail_config();
    if ($cfg['driver'] === 'simulator') {
        respond(['status' => 'SIMULATOR', 'reachable' => true,
            'message' => 'The simulator driver is selected. Nothing is called and no money moves. '
                . 'Configure a partner and switch the driver to test a real connection.']);
    }
    if (!rail_ready($cfg)) {
        fail(422, 'The partner is not fully configured. Base URL, key id, key secret and webhook secret '
            . 'are all required.');
    }
    // A status lookup for a reference that cannot exist: a 401/403 means the keys
    // are wrong, a 404 means the keys work and the endpoint is right.
    [$http, $body, $network] = rail_http($cfg, 'GET',
        str_replace('{ref}', 'ajspay-connectivity-test', $cfg['status_path']));
    $verdict = match (true) {
        $network !== '' || $http === 0 => 'Could not reach the partner: ' . $network,
        $http === 401 || $http === 403 => 'Reached the partner, but the credentials were refused (HTTP '
            . $http . '). Check the key id and key secret.',
        $http === 404 => 'Credentials accepted and the endpoint exists. The rail is ready.',
        $http >= 200 && $http < 300 => 'Credentials accepted and the endpoint answered. The rail is ready.',
        default => "Reached the partner but it answered HTTP $http. Check the configured paths.",
    };
    respond(['status' => $http === 404 || ($http >= 200 && $http < 300) ? 'OK' : 'PROBLEM',
        'http_status' => $http, 'reachable' => $network === '' && $http !== 0, 'message' => $verdict,
        'partner_said' => $body ? array_slice($body, 0, 5) : []]);
}

// The operations view: everything in flight, and everything that failed.
function route_rail_transactions(array $d): void
{
    staff_user(['bank_owner', 'admin']);
    $sql = 'SELECT id, direction, rail, driver, account_number, amount, counterparty_name, counterparty_acc,
            counterparty_vpa, ref_number, partner_ref, utr, status, failure_reason, created_at
        FROM rail_transactions WHERE 1 = 1';
    $params = [];
    if (!empty($_GET['status']) && in_array($_GET['status'], RAIL_STATES, true)) {
        $sql .= ' AND status = ?';
        $params[] = $_GET['status'];
    }
    if (!empty($_GET['direction']) && in_array($_GET['direction'], ['payout', 'collect'], true)) {
        $sql .= ' AND direction = ?';
        $params[] = $_GET['direction'];
    }
    [$txns, $meta] = paginate("$sql ORDER BY created_at DESC, id", $params, 25, 200);
    respond(['transactions' => out_all($txns), 'pagination' => $meta,
        'pending_value' => (float)scalar("SELECT COALESCE(SUM(amount), 0) FROM rail_transactions
            WHERE status = 'PENDING'"),
        'paid_out_today' => rail_payout_today()]);
}

// Ask the partner about one pending transaction now, rather than waiting for the
// next cron run. On the simulator this is how a test collection gets credited.
function route_rail_reconcile_one(array $d): void
{
    $owner = staff_user(['bank_owner']);
    need($d, 'ref_number');
    $railTxn = row('SELECT * FROM rail_transactions WHERE ref_number = ?', [clip($d['ref_number'], 100)]);
    if (!$railTxn) {
        fail(404, 'No rail transaction with that reference.');
    }
    if ($railTxn['status'] !== 'PENDING') {
        respond(['status' => $railTxn['status'], 'message' => 'Already settled as ' . $railTxn['status'] . '.']);
    }
    $cfg = rail_config();
    if ($cfg['driver'] === 'simulator') {
        // Only the simulator lets a human decide the outcome. With a real partner
        // the answer comes from them, never from us.
        $outcome = clip($d['simulate'] ?? 'SUCCESS', 10) === 'FAILED' ? 'FAILED' : 'SUCCESS';
        $result = rail_settle($railTxn, $outcome, ['utr' => 'SIM' . gmdate('YmdHis'),
            'failure_reason' => $outcome === 'FAILED' ? 'Simulated failure' : null], ['simulated' => true]);
        audit($owner, 'RAIL_SIMULATED_SETTLEMENT', $railTxn['ref_number'] . " => $outcome");
        respond(['status' => $outcome, 'message' => "Simulated settlement: $result", 'simulated' => true]);
    }
    [$http, $body] = rail_http($cfg, 'GET', str_replace('{ref}', rawurlencode((string)$railTxn['partner_ref']),
        $cfg['status_path']));
    if ($http < 200 || $http >= 300) {
        fail(502, "The partner could not be asked about this transaction (HTTP $http).");
    }
    $status = rail_map_status($cfg, rail_pluck($body, $cfg['status_field']));
    $result = rail_settle($railTxn, $status, ['utr' => rail_pluck($body, $cfg['utr_field']),
        'failure_reason' => rail_pluck($body, $cfg['failure_field'])], $body);
    audit($owner, 'RAIL_RECONCILED', $railTxn['ref_number'] . " => $status");
    respond(['status' => $status, 'message' => $result]);
}
