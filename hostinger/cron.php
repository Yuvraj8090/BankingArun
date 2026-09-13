<?php
// AJSPay: scheduled money movement. Runs standing instructions and one-off
// scheduled transfers that have come due.
//
// Run once a day from Hostinger's cron panel (see INSTALL_HOSTINGER.md):
//   /usr/bin/php /home/<user>/public_html/cron.php
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
    string $beneficiary, string $description): array
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
    $receiver = $locked[$to] ?? null;  // absent for a payee outside AJSPay: debit only
    if ($receiver && $receiver['status'] !== 'active') {
        return [false, 'The beneficiary account cannot receive funds right now.'];
    }
    $now = now_utc();
    $ref = "UTR-$mode-" . gmdate('YmdHis') . '-' . random_int(100, 999);
    $pdo->prepare('UPDATE accounts SET balance = balance - ? WHERE id = ?')->execute([$amount, $sender['id']]);
    insert_txn(['user_id' => $payer['id'], 'account_number' => $from, 'type' => 'debit', 'mode' => $mode,
        'amount' => $amount, 'balance_after' => round((float)$sender['balance'] - $amount, 2),
        'counterparty_name' => $beneficiary, 'counterparty_acc' => $to, 'ref_number' => $ref,
        'description' => $description, 'timestamp' => $now]);
    if ($receiver) {
        $pdo->prepare('UPDATE accounts SET balance = balance + ? WHERE id = ?')->execute([$amount, $receiver['id']]);
        insert_txn(['user_id' => $receiver['user_id'], 'account_number' => $to, 'type' => 'credit', 'mode' => $mode,
            'amount' => $amount, 'balance_after' => round((float)$receiver['balance'] + $amount, 2),
            'counterparty_name' => $payer['name'], 'counterparty_acc' => $from, 'ref_number' => $ref,
            'description' => "Received from {$payer['name']} ($description)", 'timestamp' => $now]);
    }
    return [true, $ref];
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
            'NEFT', $locked['beneficiary_name'], $locked['remarks'] ?: "Standing instruction to {$locked['beneficiary_name']}");

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
            $mode, $locked['beneficiary_name'], $locked['remarks'] ?: "Scheduled transfer to {$locked['beneficiary_name']}");

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

// --- Run ------------------------------------------------------------------------------
$today = today_ist();
say('AJSPay cron starting for ' . $today . ' IST' . ($dryRun ? ' (dry run — nothing will be written)' : ''));

// One run at a time. An overlapping run exits quietly rather than double-paying.
if ((int)scalar('SELECT GET_LOCK(?, 0)', [CRON_LOCK]) !== 1) {
    say('Another cron run holds the lock. Exiting.');
    $finished = true;
    exit(0);
}

try {
    [$siDone, $siFailed] = run_standing_instructions($today, $dryRun, $verbose);
    [$payDone, $payFailed] = run_scheduled_payments($today, $dryRun, $verbose);
} catch (Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    error_log('AJSPay cron error: ' . $e);
    say('ERROR: ' . $e->getMessage());
    scalar('SELECT RELEASE_LOCK(?)', [CRON_LOCK]);
    exit(1);  // $finished stays false; the shutdown handler would do this anyway
}

scalar('SELECT RELEASE_LOCK(?)', [CRON_LOCK]);
say("Standing instructions: $siDone run, $siFailed failed. "
    . "Scheduled transfers: $payDone run, $payFailed failed.");
$finished = true;
exit($siFailed + $payFailed > 0 ? 2 : 0);  // 2 = ran, but something needs a look
