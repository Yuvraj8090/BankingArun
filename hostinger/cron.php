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
const AJSPAY_CRON = true;  // fail() throws instead of exiting (db.php)
require __DIR__ . '/api.php';

$dryRun = in_array('--dry-run', $argv, true);
$verbose = $dryRun || in_array('--verbose', $argv, true);

// --reprice-only: just the plans, straight after a deploy (scripts/deploy-vps.sh),
// so a migration that restored brochure figures does not hide plans until tonight.
if (in_array('--reprice-only', $argv, true)) {
    say('Plans re-priced to the cap: ' . run_plan_repricing($dryRun));
    $finished = true;
    exit(0);
}

$result = run_scheduled_jobs($dryRun, $verbose);
$finished = true;
exit($result['status'] === 'attention' ? 2 : 0);  // 2 = ran, but something needs a look
