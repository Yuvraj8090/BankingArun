<?php
// AJSPay: the first-run tour.
//
// The steps live here rather than in the app for three reasons. They differ by
// role, so a teller is not walked through a member's transfer screen. They have
// to respect the capability register, so nobody is shown a tour of a service
// this institution is not authorised to offer. And progress is kept per user on
// the server, so somebody who gives up halfway resumes where they stopped
// rather than starting again — on whatever device they next sign in from.
declare(strict_types=1);

const TUTORIAL_STATUSES = ['pending', 'in_progress', 'completed', 'skipped'];

// Each step: an anchor (a data-testid the app already renders, or null to centre
// the card), what to say, and optionally the capability it depends on.
function tutorial_steps(string $role): array
{
    $place = match ($role) {
        'retail', 'corporate' => 'your member portal',
        'bank_owner' => 'the management console',
        default => 'the staff console',
    };
    $welcome = [
        'anchor' => null,
        'title' => 'Welcome to ' . $place,
        'body' => 'A short tour — about a minute. You can skip it now and restart it any time from your '
            . 'profile menu.',
    ];
    // Every tour ends by pointing at the per-page guide, so nobody has to remember the tour.
    $guide = ['anchor' => 'page-guide-btn', 'title' => 'Help on every page',
        'body' => 'Not sure what a page or a form field is for? Click Guide in the top bar. The Help Centre '
            . 'in your profile menu has every page and the common questions.'];
    $finish = [
        'anchor' => null,
        'title' => 'That is the tour',
        'body' => 'Restart it whenever you like from the profile menu in the top right.',
    ];

    $member = [
        $welcome,
        ['anchor' => 'tab-dashboard', 'title' => 'Your dashboard',
         'body' => 'Balances, recent entries and shortcuts. It is the first thing you see each time you sign in.'],
        ['anchor' => 'tab-transfer', 'title' => 'Sending money',
         'body' => 'Transfers between member accounts settle on our own books. You will need your transaction '
            . 'password, which is separate from your sign-in password.'],
        ['anchor' => 'tab-deposits', 'title' => 'Deposits',
         'body' => 'Open a fixed or recurring deposit and see what it matures to. Interest is credited '
            . 'automatically.'],
        ['anchor' => 'tab-statements', 'title' => 'Statements',
         'body' => 'Download any period as PDF or Excel. Filter by date, type or a search term first.'],
        ['anchor' => 'tab-security', 'title' => 'Protect your account',
         'body' => 'This is the one worth doing today. Add an authenticator app or a passkey, so a stolen '
            . 'password alone is not enough to sign in as you.'],
        ['anchor' => 'tab-kyc', 'title' => 'Your profile and KYC',
         'body' => 'Keep your address, nominee and documents current. We will ask you to refresh them '
            . 'periodically.'],
        $finish,
    ];

    $staffTour = [
        $welcome,
        ['anchor' => 'tab-staff', 'title' => 'The customer console',
         'body' => 'Who walked in today, pending KYC, and the queries waiting on you.'],
        ['anchor' => 'tab-crm', 'title' => 'The relationship desk',
         'body' => 'Everything about one member on a single screen, what was said last time, and who to '
            . 'call today. Log every conversation here.'],
        ['anchor' => 'tab-agents', 'title' => 'Agents and collections',
         'body' => 'Record what each field agent collected. It is a record for traceability — it does not '
            . 'credit the member, which stays a separate teller action.'],
        ['anchor' => 'tab-reports', 'title' => 'Reports',
         'body' => 'Filter, sort and export. Every download is written to the audit log with your name on it.'],
        $finish,
    ];

    $ownerTour = [
        $welcome,
        ['anchor' => 'tab-owner', 'title' => 'The executive dashboard',
         'body' => 'Members, liquidity, deposits and the statutory ratios the Nidhi Rules turn on.'],
        ['anchor' => 'tab-security-center', 'title' => 'Security centre',
         'body' => 'Start here. It inspects this live deployment and tells you what is wrong — including '
            . 'whether any account still uses a published demo password.'],
        ['anchor' => 'tab-fraud', 'title' => 'Fraud and AML review',
         'body' => 'Transfers scored against each member\'s own behaviour, with the reasons attached. '
            . 'Members are never told they were flagged.'],
        ['anchor' => 'tab-schemes', 'title' => 'Scheme master',
         'body' => 'Deposit plans, with each one\'s true annual return computed from its own figures. '
            . 'Anything above the 12.5% Nidhi cap cannot be activated.'],
        ['anchor' => 'tab-reports', 'title' => 'Reports and registers',
         'body' => 'The member and deposit registers live here, along with the audit trail.'],
        $finish,
    ];

    $loanTour = [
        $welcome,
        ['anchor' => 'tab-loan-dept', 'title' => 'The loan pipeline',
         'body' => 'Every application with its EMI, the applicant\'s income and a risk grade. We lend against gold '
            . 'or property only, so check the security before you decide.'],
        ['anchor' => 'tab-reports', 'title' => 'Reports',
         'body' => 'The loan register and the applications list, filtered and exported. Exports are audited.'],
        ['anchor' => 'tab-loans', 'title' => 'EMI calculator',
         'body' => 'The same calculator members see, for quoting an EMI across the desk.'],
        $finish,
    ];

    $collectionTour = [
        $welcome,
        ['anchor' => 'tab-collection', 'title' => 'Your cases',
         'body' => 'Loans in arrears, worst first by days past due. Record every follow-up on the case, so the '
            . 'next person knows what was said.'],
        ['anchor' => 'tab-locator', 'title' => 'Branches',
         'body' => 'Addresses and timings, for telling a borrower where to pay.'],
        $finish,
    ];

    $tour = match ($role) {
        'retail', 'corporate' => $member,
        'bank_owner' => $ownerTour,
        'admin', 'branch_manager', 'staff' => $staffTour,
        'loan_officer' => $loanTour,
        'collection_agent' => $collectionTour,
        default => [$welcome, $finish],
    };
    array_splice($tour, -1, 0, [$guide]);

    // Drop any step whose feature is switched off, so the tour never points at
    // something that is not on the screen.
    return array_values(array_filter($tour, fn($step) =>
        !isset($step['requires']) || capability_enabled($step['requires'])));
}

function tutorial_state(array $user): array
{
    $steps = tutorial_steps($user['role']);
    $status = in_array($user['tutorial_status'] ?? 'pending', TUTORIAL_STATUSES, true)
        ? $user['tutorial_status'] : 'pending';
    $step = max(0, min((int)($user['tutorial_step'] ?? 0), count($steps) - 1));
    return [
        'status' => $status,
        // The app only opens the tour unprompted for someone who has never been
        // through it; after that it is theirs to start.
        'should_show' => in_array($status, ['pending', 'in_progress'], true) && $steps !== [],
        'step' => $step,
        'total' => count($steps),
        'steps' => $steps,
        'first_login_at' => empty($user['first_login_at']) ? null : iso($user['first_login_at']),
    ];
}

function route_tutorial_state(array $d): void
{
    respond(tutorial_state(current_user()));
}

function tutorial_set(array $user, string $status, int $step): void
{
    global $pdo;
    $pdo->prepare('UPDATE users SET tutorial_status = ?, tutorial_step = ?, tutorial_updated_at = ?,
        first_login_at = COALESCE(first_login_at, ?) WHERE id = ?')
        ->execute([$status, max(0, $step), now_utc(), now_utc(), $user['id']]);
}

function route_tutorial_progress(array $d): void
{
    $user = current_user();
    $steps = tutorial_steps($user['role']);
    $step = max(0, min((int)($d['step'] ?? 0), max(count($steps) - 1, 0)));
    tutorial_set($user, 'in_progress', $step);
    respond(['status' => 'SUCCESS', 'step' => $step]);
}

function route_tutorial_finish(array $d): void
{
    $user = current_user();
    // Skipping and finishing are recorded separately: "nobody finishes it" and
    // "nobody starts it" are different problems with different fixes.
    $skipped = !empty($d['skipped']);
    $steps = tutorial_steps($user['role']);
    tutorial_set($user, $skipped ? 'skipped' : 'completed', $skipped ? (int)($d['step'] ?? 0) : count($steps) - 1);
    audit($user, $skipped ? 'TUTORIAL_SKIPPED' : 'TUTORIAL_COMPLETED',
        $skipped ? 'Skipped at step ' . (int)($d['step'] ?? 0) : 'Completed all ' . count($steps) . ' steps');
    respond(['status' => 'SUCCESS',
        'message' => $skipped
            ? 'Tour skipped. You can restart it from your profile menu whenever you like.'
            : 'Tour finished.']);
}

function route_tutorial_restart(array $d): void
{
    $user = current_user();
    tutorial_set($user, 'in_progress', 0);
    audit($user, 'TUTORIAL_RESTARTED', 'Restarted the tour');
    respond(['status' => 'SUCCESS', 'message' => 'Starting the tour again.'] + tutorial_state(
        array_merge($user, ['tutorial_status' => 'in_progress', 'tutorial_step' => 0])));
}
