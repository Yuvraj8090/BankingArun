<?php
// AJSPay: scheduled money movement. Runs standing instructions and one-off
// scheduled transfers that have come due.
//
// Runs once a day from a systemd timer on the VPS:
//   /usr/bin/php /srv/ajspay/current/cron.php --verbose
//
// The header here long pointed at Hostinger's shared-hosting cron panel, which
// this VPS does not have. That was a stale comment, not a missing schedule: a
// timer had been installed on the box out of band and has been running nightly
// since 17 September 2026. Reading the repository and concluding the job never
// ran was wrong, and worth recording here because the repository still cannot
// tell you what is scheduled on the server -- only the server can.
//
// scripts/provision-cron.sh installs the timer this repository defines. Check
// what is actually installed before running it: systemctl cat ajspay-cron.service
//
// CLI only — never reachable over HTTP (.htaccess denies it as well).
// Safe to run more often than daily: each instruction is attempted at most once
// per calendar day, and a MySQL lock keeps two overlapping runs apart.
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit(1);
}

// db.php bails out with fail() (which exits 0) if the database or config is
// unusable. Cron needs a non-zero status for that, so assume failure until the
// run reports otherwise.
$finished = false;
register_shutdown_function(function () use (&$finished) {
    if (!$finished) {
        exit(1);
    }
});

// api.php pulls in db.php and the modules, then returns early under the CLI,
// leaving every helper and constant defined but no request dispatched.
require __DIR__ . '/api.php';

const CRON_LOCK = 'ajspay_cron';
const SI_MAX_FAILURES = 3;      // consecutive failures before an instruction is paused
const CRON_BATCH = 500;         // most items to process in one run

$dryRun = in_array('--dry-run', $argv, true);
$verbose = $dryRun || in_array('--verbose', $argv, true);

function say(string $line): void
{
    echo gmdate('Y-m-d H:i:s') . 'Z  ' . $line . PHP_EOL;
}

// Schedules are set in Indian time, so "due today" is judged in IST.
function today_ist(): string
{
    return (new DateTimeImmutable('now', new DateTimeZone(IST)))->format('Y-m-d');
}

// The next date this instruction falls due. Monthly and quarterly keep the day
// of the month the customer chose, clamped for shorter months: a 31st
// instruction falls on the 30th in April and the 28th/29th in February.
function next_due(string $current, string $frequency, string $anchor): string
{
    $date = new DateTimeImmutable($current);
    if ($frequency === 'daily') {
        return $date->modify('+1 day')->format('Y-m-d');
    }
    if ($frequency === 'weekly') {
        return $date->modify('+7 days')->format('Y-m-d');
    }
    $months = $frequency === 'quarterly' ? 3 : 1;
    $target = $date->modify('first day of this month')->modify("+$months months");
    $day = min((int)(new DateTimeImmutable($anchor))->format('d'), (int)$target->format('t'));
    return $target->setDate((int)$target->format('Y'), (int)$target->format('m'), $day)->format('Y-m-d');
}

// Moves the money, inside a transaction the caller has already opened.
// Returns [true, ref] on success or [false, reason] if it could not be paid;
// unlike the API handlers this never calls fail(), which would kill the run.
function pay(array $payer, string $from, string $to, float $amount, string $mode,
    string $beneficiary, string $description, ?string $beneficiaryIfsc = null): array
{
    global $pdo;
    // Lock both rows in account-number order so concurrent transfers can't deadlock.
    $locked = array_column(
        rows('SELECT * FROM accounts WHERE account_number IN (?, ?) ORDER BY account_number FOR UPDATE', [$from, $to]),
        null,
        'account_number'
    );
    $sender = $locked[$from] ?? null;
    if (!$sender || $sender['user_id'] !== $payer['id']) {
        return [false, 'Source account no longer belongs to this customer.'];
    }
    if ($sender['status'] !== 'active') {
        return [false, 'Source account is not active for outgoing payments.'];
    }
    if ((float)$sender['balance'] < $amount) {
        return [false, 'Insufficient balance. Available: ' . rupees((float)$sender['balance'])];
    }
    $receiver = $locked[$to] ?? null;
    if ($receiver && $receiver['status'] !== 'active') {
        return [false, 'The beneficiary account cannot receive funds right now.'];
    }
    $external = $receiver === null;
    if ($external && !capability_enabled('payment_systems')) {
        return [false, 'Payment systems capability is disabled.'];
    }
    if ($external && ($limit = rail_limit_error($amount)) !== null) {
        return [false, $limit];
    }
    $now = now_utc();
    $ref = "UTR-$mode-" . gmdate('YmdHis') . '-' . random_int(100, 999);
    $pdo->prepare('UPDATE accounts SET balance = balance - ? WHERE id = ?')->execute([$amount, $sender['id']]);
    insert_txn(['user_id' => $payer['id'], 'account_number' => $from, 'type' => 'debit', 'mode' => $mode,
        'amount' => $amount, 'balance_after' => round((float)$sender['balance'] - $amount, 2),
        'counterparty_name' => $beneficiary, 'counterparty_acc' => $to, 'ref_number' => $ref,
        'status' => $external ? 'PENDING' : 'SUCCESS', 'description' => $description, 'timestamp' => $now]);
    if ($external) {
        rail_record([
            'direction' => 'payout', 'rail' => $mode, 'driver' => rail_config()['driver'],
            'user_id' => $payer['id'], 'account_number' => $from, 'amount' => $amount,
            'counterparty_name' => $beneficiary, 'counterparty_acc' => $to,
            'counterparty_ifsc' => $beneficiaryIfsc === null ? null : clip($beneficiaryIfsc, 11),
            'ref_number' => $ref, 'idempotency_key' => hash('sha256', "payout:$ref"),
            'request' => ['amount' => $amount, 'mode' => $mode],
        ]);
    }
    if ($receiver) {
        $pdo->prepare('UPDATE accounts SET balance = balance + ? WHERE id = ?')->execute([$amount, $receiver['id']]);
        insert_txn(['user_id' => $receiver['user_id'], 'account_number' => $to, 'type' => 'credit', 'mode' => $mode,
            'amount' => $amount, 'balance_after' => round((float)$receiver['balance'] + $amount, 2),
            'counterparty_name' => $payer['name'], 'counterparty_acc' => $from, 'ref_number' => $ref,
            'description' => "Received from {$payer['name']} ($description)", 'timestamp' => $now]);
    }
    return [true, $ref];
}

// Credits a member account and records the ledger entry. The caller is inside a
// transaction and has not yet locked the account.
// Returns [true, ref] or [false, reason]; never calls fail(), which would end the run.
function credit(string $accountNumber, float $amount, string $mode, string $counterparty,
    string $description, string $ref): array
{
    global $pdo;
    $account = row('SELECT * FROM accounts WHERE account_number = ? FOR UPDATE', [$accountNumber]);
    if (!$account) {
        return [false, 'Destination account no longer exists.'];
    }
    if ($account['status'] !== 'active') {
        return [false, 'Destination account is not active.'];
    }
    $pdo->prepare('UPDATE accounts SET balance = balance + ? WHERE id = ?')->execute([$amount, $account['id']]);
    insert_txn(['user_id' => $account['user_id'], 'account_number' => $accountNumber, 'type' => 'credit',
        'mode' => $mode, 'amount' => $amount, 'balance_after' => round((float)$account['balance'] + $amount, 2),
        'counterparty_name' => $counterparty, 'counterparty_acc' => $ref, 'ref_number' => $ref,
        'description' => $description, 'timestamp' => now_utc()]);
    return [true, $ref];
}

// --- Deposit interest and maturity ------------------------------------------------
// Monthly-payout deposits pay simple interest on the principal each month; every
// deposit pays out its maturity value on or after its maturity date. Both are
// idempotent: a deposit is paid at most once per month and matures exactly once.
function run_deposit_interest(string $today, bool $dryRun, bool $verbose): array
{
    global $pdo;
    $paid = $failed = 0;
    $due = rows("SELECT * FROM deposits
        WHERE status = 'active' AND interest_payout = 'monthly' AND source_account IS NOT NULL
          AND maturity_date > ?
          AND (last_payout_date IS NULL OR last_payout_date <= DATE_SUB(?, INTERVAL 1 MONTH))
          AND created_at <= DATE_SUB(?, INTERVAL 1 MONTH)
        ORDER BY created_at LIMIT " . CRON_BATCH, [$today, $today, $today]);

    foreach ($due as $deposit) {
        $interest = round((float)$deposit['principal_amount'] * (float)$deposit['interest_rate'] / 100 / 12, 2);
        $label = "Deposit {$deposit['deposit_number']} monthly interest " . rupees($interest);
        if ($interest <= 0) {
            continue;
        }
        if ($dryRun) {
            say("  would pay  $label");
            $paid++;
            continue;
        }
        $pdo->beginTransaction();
        $locked = row("SELECT * FROM deposits WHERE id = ? AND status = 'active' FOR UPDATE", [$deposit['id']]);
        if (!$locked || ($locked['last_payout_date'] !== null && $locked['last_payout_date'] > $today)) {
            $pdo->rollBack();
            continue;
        }
        $ref = 'INT-' . $locked['deposit_number'] . '-' . str_replace('-', '', $today);
        [$ok, $result] = credit($locked['source_account'], $interest, 'DEPOSIT_INTEREST',
            'AJSPay Deposit Interest', "Monthly interest on deposit {$locked['deposit_number']}", $ref);
        if (!$ok) {
            $pdo->rollBack();
            $failed++;
            say("  FAILED     $label — $result");
            continue;
        }
        $pdo->prepare('UPDATE deposits SET interest_paid = interest_paid + ?, last_payout_date = ? WHERE id = ?')
            ->execute([$interest, $today, $locked['id']]);
        $pdo->commit();
        $paid++;
        if ($verbose) {
            say("  paid       $label to {$locked['source_account']}");
        }
    }
    return [$paid, $failed];
}

// A simple daily-interest deposit (scheme.daily_rate_percent set) earns
// principal x rate every day, but the credit is not paid into the account
// straight away -- it piles up in deposits.accrued_interest until it reaches
// the scheme's withdrawal_threshold, then goes out in one credit. A scheme
// with no threshold (or 0) pays out daily with nothing held back, the same
// as run_deposit_interest above but daily instead of monthly.
function run_daily_interest_accrual(string $today, bool $dryRun, bool $verbose): array
{
    global $pdo;
    $accrued = $released = $failed = 0;
    // The rate comes off the deposit's own interest_rate, not a fresh read of
    // schemes.daily_rate_percent -- deposits.interest_rate is what
    // scheme_deposit_terms() worked out and stored the day this was booked,
    // same as every other deposit type here. Re-reading the scheme's current
    // rate would let an admin editing a scheme's rate later silently change
    // what an already-booked member earns, which nothing else in this file
    // does. withdrawal_threshold has no such contract to honour -- it is an
    // operational setting, not a promised return -- so that part alone is
    // read live.
    $due = rows("SELECT d.*, s.withdrawal_threshold FROM deposits d
        JOIN schemes s ON s.code = d.scheme_code
        WHERE d.status = 'active' AND d.interest_payout = 'daily' AND d.source_account IS NOT NULL
          AND d.maturity_date > ?
          AND (d.last_payout_date IS NULL OR d.last_payout_date < ?)
        ORDER BY d.created_at LIMIT " . CRON_BATCH, [$today, $today]);

    $ist = new DateTimeZone(IST);
    foreach ($due as $deposit) {
        $pdo->beginTransaction();
        $locked = row("SELECT * FROM deposits WHERE id = ? AND status = 'active' FOR UPDATE", [$deposit['id']]);
        if (!$locked || ($locked['last_payout_date'] !== null && $locked['last_payout_date'] >= $today)) {
            $pdo->rollBack();
            continue;
        }
        // Catch-up: every calendar day after the last one paid (or after the booking day, for a new deposit) up
        // to today is owed, so a run that was late or missed is made good by the next one, a day at a time, each
        // with its own credit dated in its description. Interest starts the day after booking.
        $day = new DateTimeImmutable($locked['last_payout_date']
            ?? (new DateTimeImmutable($locked['created_at'], new DateTimeZone('UTC')))->setTimezone($ist)->format('Y-m-d'));
        $end = min(new DateTimeImmutable($today), new DateTimeImmutable($locked['maturity_date'] . ' -1 day'));
        // Total interest is capped at the term's 30-day-month figure: a plan sold as "N months of 30 days" (40
        // months doubling the money) must not pay for the extra calendar days a month-based tenure holds --
        // 1217 days at 0.08333% would pay 101.4%, not 100%. Ratio to 2dp is 1.00 for the 40-month plan.
        // ponytail: the 2dp ratio is +-0.5% of principal for odd rates; store a per-deposit cap if that matters.
        $perDay = round((float)$locked['principal_amount'] * (float)$locked['interest_rate'] / 100 / 365, 2);
        $cap = round((float)$locked['principal_amount']
            * round((float)$locked['interest_rate'] / 100 / 365 * 30 * (int)$locked['tenure_months'], 2), 2);
        $threshold = (float)$deposit['withdrawal_threshold'];
        $paid = (float)$locked['interest_paid'];
        $held = (float)$locked['accrued_interest'];
        $tdsPaid = (float)$locked['tds_deducted'];
        $last = $locked['last_payout_date'];
        $ok = true;
        for ($n = 0; $n < 400; $n++) {
            $day = $day->modify('+1 day');
            if ($day > $end) {
                break;
            }
            $dayStr = $day->format('Y-m-d');
            $last = $dayStr;
            $interest = min($perDay, round($cap - $paid - $held, 2));
            if ($interest <= 0) {
                continue;
            }
            $label = "Deposit {$locked['deposit_number']} daily interest " . rupees($interest) . " for $dayStr";
            if ($dryRun) {
                say("  would accrue $label");
                $accrued++;
                continue;
            }
            $total = round($held + $interest, 2);
            if ($threshold <= 0 || $total >= $threshold) {
                // Section 194A: TDS comes off the interest itself, not off the principal, so it is worked out on
                // $total (the accrued interest being released) and never touches anything else this deposit holds.
                $tdsRate = param_value('tds_rate_daily_interest', 10.0);
                $tds = round($total * $tdsRate / 100, 2);
                $net = round($total - $tds, 2);
                $ref = 'DINT-' . $locked['deposit_number'] . '-' . $day->format('Ymd');
                [$credited, $result] = credit($locked['source_account'], $net, 'DEPOSIT_INTEREST',
                    'AJSPay Daily Interest',
                    // Short on purpose: the PDF statement clips a description at 38 characters, and the TDS
                    // is the part a member needs to see. The credit column carries the net; the deposit number
                    // is in the ref.
                    'Interest ' . rupees($total) . ' - TDS ' . rupees($tds) . ', ' . $day->format('j M'),
                    $ref);
                if (!$credited) {
                    $ok = false;
                    say("  FAILED     $label — $result");
                    break;
                }
                $paid = round($paid + $total, 2);
                $tdsPaid = round($tdsPaid + $tds, 2);
                $held = 0.0;
                $released++;
                if ($verbose) {
                    say("  released   " . rupees($net) . " (of " . rupees($total) . ", " . rupees($tds)
                        . " TDS) on {$locked['deposit_number']} for $dayStr");
                }
            } else {
                $held = $total;
                $accrued++;
                if ($verbose) {
                    say("  accrued    $label (" . rupees($total) . " of " . rupees($threshold) . ")");
                }
            }
        }
        if (!$ok) {
            $pdo->rollBack();
            $failed++;
            continue;
        }
        if (!$dryRun && $last !== null) {
            $pdo->prepare('UPDATE deposits SET interest_paid = ?, tds_deducted = ?, accrued_interest = ?,
                last_payout_date = ? WHERE id = ?')->execute([$paid, $tdsPaid, $held, $last, $locked['id']]);
        }
        $pdo->commit();
    }
    return [$accrued, $released, $failed];
}

function run_deposit_maturities(string $today, bool $dryRun, bool $verbose): array
{
    global $pdo;
    $matured = $failed = 0;
    $due = rows("SELECT * FROM deposits WHERE status = 'active' AND maturity_date <= ?
        AND source_account IS NOT NULL ORDER BY maturity_date LIMIT " . CRON_BATCH, [$today]);

    foreach ($due as $deposit) {
        // A monthly-payout deposit has already had its interest paid out along the
        // way, so only the principal is returned at the end. A daily-payout
        // deposit is the same, except whatever is still sitting in
        // accrued_interest below the withdrawal threshold has nowhere else to
        // go, so it rides along with the principal rather than being lost --
        // still net of the same Section 194A TDS a normal release would deduct.
        $grossInterest = 0.0;
        $tds = 0.0;
        if ($deposit['interest_payout'] === 'monthly') {
            $payout = (float)$deposit['principal_amount'];
        } elseif ($deposit['interest_payout'] === 'daily') {
            $grossInterest = (float)$deposit['accrued_interest'];
            $tds = round($grossInterest * param_value('tds_rate_daily_interest', 10.0) / 100, 2);
            $payout = (float)$deposit['principal_amount'] + round($grossInterest - $tds, 2);
        } else {
            $payout = (float)$deposit['maturity_amount'];
        }
        $label = "Deposit {$deposit['deposit_number']} matured, " . rupees($payout);
        if ($dryRun) {
            say("  would pay  $label");
            $matured++;
            continue;
        }
        $pdo->beginTransaction();
        $locked = row("SELECT * FROM deposits WHERE id = ? AND status = 'active' FOR UPDATE", [$deposit['id']]);
        if (!$locked) {
            $pdo->rollBack();
            continue;  // another run took it
        }
        $ref = 'MAT-' . $locked['deposit_number'];
        [$ok, $result] = credit($locked['source_account'], $payout, 'DEPOSIT_MATURITY',
            'AJSPay Term Deposit', $tds > 0
                ? "Maturity proceeds of deposit {$locked['deposit_number']} (" . rupees($tds) . " TDS deducted from the accrued interest)"
                : "Maturity proceeds of deposit {$locked['deposit_number']}", $ref);
        if (!$ok) {
            $pdo->rollBack();
            $failed++;
            say("  FAILED     $label — $result");
            continue;
        }
        // Gross interest earned, not what was actually paid out -- same
        // convention run_daily_interest_accrual uses for interest_paid.
        $interestPart = $grossInterest > 0 ? $grossInterest : round($payout - (float)$locked['principal_amount'], 2);
        $pdo->prepare("UPDATE deposits SET status = 'matured', matured_on = ?, interest_paid = interest_paid + ?,
            tds_deducted = tds_deducted + ?, accrued_interest = 0 WHERE id = ?")
            ->execute([now_utc(), max($interestPart, 0), $tds, $locked['id']]);
        $owner = row('SELECT * FROM users WHERE id = ?', [$locked['user_id']]);
        if ($owner) {
            audit($owner, 'DEPOSIT_MATURED', "{$locked['deposit_number']} paid " . rupees($payout));
        }
        $pdo->commit();
        $matured++;
        if ($verbose) {
            say("  paid       $label to {$locked['source_account']}");
        }
    }
    return [$matured, $failed];
}

// --- Standing instructions ---------------------------------------------------------
function run_standing_instructions(string $today, bool $dryRun, bool $verbose): array
{
    global $pdo;
    $done = $failed = 0;

    // Close out instructions whose end date has passed.
    if (!$dryRun) {
        $pdo->prepare("UPDATE standing_instructions SET status = 'completed'
            WHERE status = 'active' AND end_date IS NOT NULL AND end_date < ?")->execute([$today]);
    }

    $due = rows("SELECT * FROM standing_instructions
        WHERE status = 'active' AND next_run IS NOT NULL AND next_run <= ?
          AND (last_run IS NULL OR last_run < ?)
        ORDER BY next_run, id LIMIT " . CRON_BATCH, [$today, $today]);

    foreach ($due as $si) {
        $amount = (float)$si['amount'];
        $label = "SI {$si['id']} " . rupees($amount) . " {$si['from_account_number']} -> {$si['beneficiary_account']}";
        if ($dryRun) {
            say("  would run  $label (due {$si['next_run']})");
            $done++;
            continue;
        }
        $pdo->beginTransaction();
        // Re-read under a lock: another run may have taken this one already.
        $locked = row('SELECT * FROM standing_instructions WHERE id = ? FOR UPDATE', [$si['id']]);
        if (!$locked || $locked['status'] !== 'active' || $locked['next_run'] > $today
            || ($locked['last_run'] !== null && $locked['last_run'] >= $today)) {
            $pdo->rollBack();
            continue;
        }
        $owner = row('SELECT * FROM users WHERE id = ?', [$locked['user_id']]);
        if (!$owner) {
            $pdo->rollBack();
            say("  SKIP       $label (owner missing)");
            continue;
        }
        [$ok, $result] = pay($owner, $locked['from_account_number'], $locked['beneficiary_account'], $amount,
            'NEFT', $locked['beneficiary_name'], $locked['remarks'] ?: "Standing instruction to {$locked['beneficiary_name']}",
            $locked['beneficiary_ifsc']);

        if ($ok) {
            // One occurrence per run: if cron was down for a week, the arrears are
            // paid off a day at a time rather than all at once.
            $nextRun = next_due($locked['next_run'], $locked['frequency'], $locked['start_date']);
            $ended = $locked['end_date'] !== null && $nextRun > $locked['end_date'];
            $pdo->prepare("UPDATE standing_instructions SET executions = executions + 1, next_run = ?,
                    last_run = ?, last_status = 'success', last_error = NULL, failures = 0, status = ?
                WHERE id = ?")->execute([$nextRun, $today, $ended ? 'completed' : 'active', $locked['id']]);
            audit($owner, 'SI_EXECUTED', rupees($amount) . " to {$locked['beneficiary_name']} ($result)");
            $pdo->commit();
            $done++;
            if ($verbose) {
                say("  paid       $label ref $result, next " . ($ended ? 'none (completed)' : $nextRun));
            }
            continue;
        }

        // Leave next_run alone so it retries on the next run, but record the
        // attempt so it is tried once a day, not once an hour.
        $pdo->rollBack();
        $failures = (int)$locked['failures'] + 1;
        $paused = $failures >= SI_MAX_FAILURES;
        $pdo->prepare("UPDATE standing_instructions SET failures = ?, last_run = ?, last_status = 'failed',
                last_error = ?, status = ? WHERE id = ?")
            ->execute([$failures, $today, mb_substr($result, 0, 255), $paused ? 'paused' : 'active', $locked['id']]);
        audit($owner, $paused ? 'SI_PAUSED' : 'SI_FAILED',
            rupees($amount) . " to {$locked['beneficiary_name']}: $result");
        $failed++;
        say("  FAILED     $label — $result" . ($paused ? ' (paused after ' . SI_MAX_FAILURES . ' tries)' : ''));
    }
    return [$done, $failed];
}

// --- One-off scheduled transfers ----------------------------------------------------
function run_scheduled_payments(string $today, bool $dryRun, bool $verbose): array
{
    global $pdo;
    $done = $failed = 0;
    $due = rows("SELECT * FROM scheduled_payments WHERE status = 'SCHEDULED' AND schedule_date <= ?
        ORDER BY schedule_date, id LIMIT " . CRON_BATCH, [$today]);

    foreach ($due as $payment) {
        $amount = (float)$payment['amount'];
        $label = "Payment {$payment['id']} " . rupees($amount)
            . " {$payment['from_account_number']} -> {$payment['to_account_number']}";
        if ($dryRun) {
            say("  would run  $label (due {$payment['schedule_date']})");
            $done++;
            continue;
        }
        $pdo->beginTransaction();
        $locked = row('SELECT * FROM scheduled_payments WHERE id = ? FOR UPDATE', [$payment['id']]);
        if (!$locked || $locked['status'] !== 'SCHEDULED') {
            $pdo->rollBack();
            continue;
        }
        $owner = row('SELECT * FROM users WHERE id = ?', [$locked['user_id']]);
        if (!$owner) {
            $pdo->rollBack();
            say("  SKIP       $label (owner missing)");
            continue;
        }
        $mode = in_array($locked['transfer_type'], TRANSFER_MODES, true) ? $locked['transfer_type'] : 'NEFT';
        [$ok, $result] = pay($owner, $locked['from_account_number'], $locked['to_account_number'], $amount,
            $mode, $locked['beneficiary_name'], $locked['remarks'] ?: "Scheduled transfer to {$locked['beneficiary_name']}",
            $locked['beneficiary_ifsc']);

        if ($ok) {
            $pdo->prepare("UPDATE scheduled_payments SET status = 'EXECUTED', processed_at = ?, ref_number = ?,
                failure_reason = NULL WHERE id = ?")->execute([now_utc(), $result, $locked['id']]);
            audit($owner, 'SCHEDULED_TRANSFER_EXECUTED',
                "$mode " . rupees($amount) . " to {$locked['beneficiary_name']} ($result)");
            $pdo->commit();
            $done++;
            if ($verbose) {
                say("  paid       $label ref $result");
            }
            continue;
        }

        // A one-off transfer is not retried: the customer is told it failed and
        // can send it again when the account is funded.
        $pdo->rollBack();
        $pdo->prepare("UPDATE scheduled_payments SET status = 'FAILED', processed_at = ?, failure_reason = ?
            WHERE id = ?")->execute([now_utc(), mb_substr($result, 0, 255), $locked['id']]);
        audit($owner, 'SCHEDULED_TRANSFER_FAILED', rupees($amount) . " to {$locked['beneficiary_name']}: $result");
        $failed++;
        say("  FAILED     $label — $result");
    }
    return [$done, $failed];
}

// --- Payment rail reconciliation ---------------------------------------------------
// Webhooks get lost. Every payout or collection still marked pending is asked
// about directly, so no member's money sits in limbo because one HTTP callback
// never arrived. Worth running far more often than daily.
function run_rail_reconciliation(bool $dryRun, bool $verbose): array
{
    [$dispatched, $dispatchFailed, $dispatchNotes] = rail_dispatch_pending($dryRun);
    [$settled, $stuck, $notes] = rail_reconcile($dryRun);
    if ($verbose) {
        foreach (array_merge($dispatchNotes, $notes) as $note) {
            say("  rail: $note");
        }
    }
    return [$dispatched, $dispatchFailed, $settled, $stuck];
}

// --- Run ------------------------------------------------------------------------------
$today = today_ist();
say('AJSPay cron starting for ' . $today . ' IST' . ($dryRun ? ' (dry run — nothing will be written)' : ''));

// One run at a time. An overlapping run exits quietly rather than double-paying.
if ((int)scalar('SELECT GET_LOCK(?, 0)', [CRON_LOCK]) !== 1) {
    say('Another cron run holds the lock. Exiting.');
    $finished = true;
    exit(0);
}

// Written before any work, not after it. A run that dies half way through
// leaves a row stuck at 'running', which is the state worth being able to see;
// a row only written on success would make a crash look exactly like a night
// with nothing to do.
$runId = uuid4();
$pdo->prepare('INSERT INTO cron_runs (id, dry_run, status) VALUES (?, ?, ?)')
    ->execute([$runId, (int)$dryRun, 'running']);

try {
    [$siDone, $siFailed] = run_standing_instructions($today, $dryRun, $verbose);
    [$payDone, $payFailed] = run_scheduled_payments($today, $dryRun, $verbose);
    [$intDone, $intFailed] = run_deposit_interest($today, $dryRun, $verbose);
    [$dailyAccrued, $dailyReleased, $dailyFailed] = run_daily_interest_accrual($today, $dryRun, $verbose);
    [$matDone, $matFailed] = run_deposit_maturities($today, $dryRun, $verbose);
    [$railSent, $railFailed, $railDone, $railStuck] = run_rail_reconciliation($dryRun, $verbose);
} catch (Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    error_log('AJSPay cron error: ' . $e);
    say('ERROR: ' . $e->getMessage());
    // Recorded before the lock goes, and deliberately not inside a transaction
    // that may have just been rolled back.
    $pdo->prepare("UPDATE cron_runs SET finished_at = NOW(), status = 'failed', error = ? WHERE id = ?")
        ->execute([mb_substr($e->getMessage(), 0, 500), $runId]);
    scalar('SELECT RELEASE_LOCK(?)', [CRON_LOCK]);
    exit(1);  // $finished stays false; the shutdown handler would do this anyway
}

scalar('SELECT RELEASE_LOCK(?)', [CRON_LOCK]);
say("Standing instructions: $siDone run, $siFailed failed. "
    . "Scheduled transfers: $payDone run, $payFailed failed. "
    . "Deposit interest: $intDone paid, $intFailed failed. "
    . "Daily interest: $dailyAccrued accrued, $dailyReleased released, $dailyFailed failed. "
    . "Maturities: $matDone paid, $matFailed failed. "
    . "Payment rail: $railSent dispatched, $railFailed failed, $railDone settled, $railStuck still pending.");
$finished = true;
// A rail transaction that is still pending is not a failure — the partner has
// simply not answered yet — so it does not make the run report a problem.
$problems = $siFailed + $payFailed + $intFailed + $dailyFailed + $matFailed + $railFailed;
$pdo->prepare('UPDATE cron_runs SET finished_at = NOW(), status = ?, jobs = ? WHERE id = ?')
    ->execute([$problems > 0 ? 'attention' : 'ok', json_encode([
        'standing_instructions' => ['done' => $siDone, 'failed' => $siFailed],
        'scheduled_payments' => ['done' => $payDone, 'failed' => $payFailed],
        'deposit_interest' => ['done' => $intDone, 'failed' => $intFailed],
        'daily_interest' => ['accrued' => $dailyAccrued, 'released' => $dailyReleased, 'failed' => $dailyFailed],
        'deposit_maturities' => ['done' => $matDone, 'failed' => $matFailed],
        'payment_rail' => ['done' => $railDone, 'failed' => $railFailed,
            'dispatched' => $railSent, 'pending' => $railStuck],
    ]), $runId]);
exit($problems > 0 ? 2 : 0);  // 2 = ran, but something needs a look
