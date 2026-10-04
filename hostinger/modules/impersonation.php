<?php
// AJSPay: support impersonation — a bank owner viewing the app exactly as a
// member sees it, to work out what went wrong on a support call.
//
// The rule that makes this safe: an impersonated session is READ ONLY. Support
// needs to see what a member sees, not act as them. Rather than listing which
// writes to block and risking a gap, every write is refused and only two
// actions are allowed through — ending the impersonation, and signing out.
//
// Everything else about it is deliberately noisy: a reason is required, the
// window is short, the member's own screen is unaffected, and both the start
// and the end are written to the audit log and raised as security events.
declare(strict_types=1);

const IMPERSONATION_ROLES = ['bank_owner'];   // who may start one
const IMPERSONATION_TTL = 900;                // 15 minutes, shorter than a normal session
// Roles that can never be impersonated: taking over another administrator would
// be privilege escalation rather than support.
const IMPERSONATION_PROTECTED_ROLES = ['bank_owner', 'admin', 'branch_manager'];
// The only writes an impersonated session may perform.
// Plus POST routes that only read (the deposit number goes in the body, not the URL) so the owner can open a
// member's earnings screen while viewing as them.
const IMPERSONATION_ALLOWED_WRITES = ['POST /impersonate/stop', 'POST /auth/logout', 'POST /deposits/earnings'];

// Called by the dispatcher before any handler. Fails closed: anything that is
// not a plain read is refused unless it is explicitly allowed above.
function guard_impersonation(string $method, string $route): void
{
    // Read the claim straight from the token: this runs before any handler has
    // authenticated, so impersonator() is not populated yet.
    $claims = peek_session_claims();
    if ($claims === null || !isset($claims['imp'])) {
        return;
    }
    if (in_array($method, ['GET', 'HEAD', 'OPTIONS'], true)) {
        return;
    }
    if (in_array("$method $route", IMPERSONATION_ALLOWED_WRITES, true)) {
        return;
    }
    security_event('IMPERSONATION_WRITE_BLOCKED', 'warning',
        ($claims['imp_email'] ?? 'support') . " attempted $method $route while impersonating");
    fail(403, 'This is a read-only support session. You can see the member\'s account but cannot change '
        . 'anything or move money. End the support session to act as yourself.');
}

// Reported on /auth/me so the app can show a banner and hide its action buttons.
function impersonation_state(): ?array
{
    $actor = impersonator();
    return $actor === null ? null : [
        'active' => true,
        'by_name' => $actor['name'],
        'by_email' => $actor['email'],
        'read_only' => true,
        'notice' => 'Support session — read only. Nothing you do here can change this member\'s account.',
    ];
}

function route_impersonate_start(array $d): void
{
    $owner = staff_user(IMPERSONATION_ROLES);
    if (impersonator() !== null) {
        fail(400, 'You are already in a support session. End it before starting another.');
    }
    need($d, 'user_id', 'reason');
    $reason = clip($d['reason'], 255);
    if (mb_strlen($reason) < 8) {
        fail(422, 'Record why you are opening this member\'s account — at least a few words. '
            . 'It is written to the audit log.');
    }
    $target = row('SELECT * FROM users WHERE id = ?', [clip($d['user_id'], 36)]);
    if (!$target) {
        fail(404, 'No such member.');
    }
    if ($target['id'] === $owner['id']) {
        fail(400, 'You are already signed in as yourself.');
    }
    if (in_array($target['role'], IMPERSONATION_PROTECTED_ROLES, true)) {
        security_event('IMPERSONATION_REFUSED', 'critical',
            "{$owner['email']} tried to impersonate {$target['role']} {$target['email']}", $owner);
        fail(403, 'Administrator accounts cannot be impersonated.');
    }

    // The token identifies the member but carries the owner as the real actor.
    $token = start_session($target, $owner, IMPERSONATION_TTL);
    audit($owner, 'IMPERSONATION_STARTED', "Viewing {$target['email']} — $reason");
    audit($target, 'ACCOUNT_VIEWED_BY_SUPPORT', "Opened by {$owner['email']} — $reason");
    security_event('IMPERSONATION_STARTED', 'critical',
        "{$owner['email']} opened {$target['email']} — $reason", $owner);
    respond([
        'status' => 'SUCCESS',
        'token' => $token,
        'user' => public_user($target),
        'features' => enabled_capabilities(),
        'impersonation' => impersonation_state() ?? ['active' => true, 'by_name' => $owner['name'],
            'by_email' => $owner['email'], 'read_only' => true],
        'expires_in' => IMPERSONATION_TTL,
        'message' => "Support session open for {$target['name']}. Read only, and it ends in "
            . (IMPERSONATION_TTL / 60) . ' minutes.',
    ]);
}

function route_impersonate_stop(array $d): void
{
    $member = current_user();
    $owner = impersonator();
    if ($owner === null) {
        fail(400, 'You are not in a support session.');
    }
    $token = start_session($owner);  // back to the owner's own identity
    audit($owner, 'IMPERSONATION_ENDED', "Closed {$member['email']}");
    security_event('IMPERSONATION_ENDED', 'info', "{$owner['email']} closed {$member['email']}", $owner);
    respond([
        'status' => 'SUCCESS',
        'token' => $token,
        'user' => public_user($owner),
        'features' => enabled_capabilities(),
        'impersonation' => null,
        'message' => 'Support session ended. You are signed in as yourself again.',
    ]);
}

// Who the owner may open, for the support console's picker.
function route_impersonate_candidates(array $d): void
{
    staff_user(IMPERSONATION_ROLES);
    $holders = implode(', ', array_fill(0, count(IMPERSONATION_PROTECTED_ROLES), '?'));
    $sql = "SELECT id, name, email, role, kyc_status, created_at FROM users
        WHERE role NOT IN ($holders) ORDER BY name";
    $params = IMPERSONATION_PROTECTED_ROLES;
    if (!empty($_GET['q'])) {
        $sql = "SELECT id, name, email, role, kyc_status, created_at FROM users
            WHERE role NOT IN ($holders) AND (name LIKE ? OR email LIKE ?) ORDER BY name";
        $like = '%' . clip($_GET['q'], 60) . '%';
        $params = [...IMPERSONATION_PROTECTED_ROLES, $like, $like];
    }
    [$members, $meta] = paginate($sql, $params, 25, 100);
    respond(['members' => out_all($members), 'pagination' => $meta]);
}
