<?php
// AJSPay: regulated-capability gating.
//
// Aadhunik Jeewan Sanchay Nidhi Limited is a Nidhi company under section 406 of
// the Companies Act, 2013 and the Nidhi Rules, 2014. It is not a bank and holds
// no RBI licence. Several features this software can technically perform may
// only be offered by an entity holding a specific authorisation.
//
// So each of those features is a capability that is OFF until someone records
// the authorisation that permits it. Turning one on is a deliberate, audited act
// by the bank owner that requires a reference to the actual licence — not a
// checkbox. Everything stays available in code; what changes is whether the
// server will serve it.
//
// This registry is a build-time aid, not legal advice. Confirm the position for
// your own entity with counsel or the regulator before enabling anything.
declare(strict_types=1);

// What a Nidhi may do with its members on its own books, and therefore what
// stays on by default: member accounts, deposits, loans against them, internal
// book transfers, statements and KYC.
const CAPABILITIES = [
    'internal_transfers' => [
        'name' => 'Internal member transfers',
        'default' => true,
        'authority' => 'Permitted to a Nidhi',
        'summary' => 'Moving funds between two member accounts on our own books.',
        'requires' => 'No external authorisation. This is a book entry within the Nidhi, not a payment '
            . 'system transaction, and both sides must be members.',
    ],
    'deposits' => [
        'name' => 'Member deposits',
        'default' => true,
        'authority' => 'Ministry of Corporate Affairs',
        'summary' => 'Fixed and recurring deposits from members.',
        'requires' => 'Permitted by the Nidhi Rules, 2014 from members only. Interest may not exceed the '
            . 'maximum rate the RBI permits NBFCs to pay (12.5% a year), and deposits may not be solicited '
            . 'from the public or advertised.',
    ],
    'loans' => [
        'name' => 'Loans to members',
        'default' => true,
        'authority' => 'Ministry of Corporate Affairs',
        'summary' => 'Secured lending to members.',
        'requires' => 'Permitted by the Nidhi Rules, 2014 against the security the Rules allow — gold, '
            . 'property, deposits and specified securities — to members only, within the prescribed limits.',
    ],

    // Everything below needs an authorisation a Nidhi does not hold by default.
    'debit_cards' => [
        'name' => 'Debit cards',
        'default' => false,
        'authority' => 'Reserve Bank of India',
        'summary' => 'Issuing virtual or physical debit cards, limits, PIN and CVV.',
        'requires' => 'Authorisation to issue payment cards. Under the RBI Master Direction on Credit Card '
            . 'and Debit Card issuance, debit cards may be issued only by banks, and by certain NBFCs that '
            . 'the RBI has specifically permitted. A Nidhi company is neither, and a card programme also '
            . 'needs a sponsor bank and a card network arrangement.',
    ],
    'upi' => [
        'name' => 'UPI',
        'default' => false,
        'authority' => 'Reserve Bank of India / NPCI',
        'summary' => 'Virtual payment addresses, QR codes and UPI payments.',
        'requires' => 'Authorisation to operate or participate in a payment system under section 4 of the '
            . 'Payment and Settlement Systems Act, 2007, plus NPCI membership — in practice through a '
            . 'sponsor bank as a third-party application provider.',
    ],
    'payment_systems' => [
        'name' => 'Outward transfers (NEFT, RTGS, IMPS)',
        'default' => false,
        'authority' => 'Reserve Bank of India',
        'summary' => 'Sending money to an account outside this institution.',
        'requires' => 'Membership of the relevant RBI payment system, or a sponsor bank arrangement. '
            . 'Without it, money can move between member accounts on our own books but cannot be sent out.',
    ],
    'cheque_book' => [
        'name' => 'Cheque books and stop payment',
        'default' => false,
        'authority' => 'Reserve Bank of India',
        'summary' => 'Issuing cheque books and stopping cheques.',
        'requires' => 'Cheques are drawn on a bank. Issuing them needs banking status and membership of '
            . 'CTS clearing.',
    ],
    'demand_draft' => [
        'name' => 'Demand drafts',
        'default' => false,
        'authority' => 'Reserve Bank of India',
        'summary' => 'Issuing demand drafts.',
        'requires' => 'A demand draft is a banker\'s instrument and can only be issued by a bank.',
    ],
    'mutual_funds' => [
        'name' => 'Mutual fund distribution',
        'default' => false,
        'authority' => 'SEBI / AMFI',
        'summary' => 'Offering or selling mutual fund schemes.',
        'requires' => 'An AMFI Registration Number (ARN) after passing the NISM certification, and the '
            . 'Nidhi Rules separately restrict what business a Nidhi may carry on.',
    ],
    'insurance' => [
        'name' => 'Insurance distribution',
        'default' => false,
        'authority' => 'IRDAI',
        'summary' => 'Offering or selling insurance policies.',
        'requires' => 'Registration as a corporate agent or intermediary with the IRDAI.',
    ],
    'current_accounts' => [
        'name' => 'Current accounts',
        'default' => false,
        'authority' => 'Ministry of Corporate Affairs',
        'summary' => 'Opening current accounts for members.',
        'requires' => 'Rule 6 of the Nidhi Rules, 2014 prohibits a Nidhi from opening a current account '
            . 'with its members. This one cannot be enabled by obtaining a licence.',
        'never' => true,
    ],
];

// Routes refused outright when their capability is off. The transfer routes are
// not here: they are checked inside the handler, because an internal transfer
// stays permitted while an outward one does not.
const ROUTE_CAPABILITIES = [
    'GET /cards' => 'debit_cards',
    'POST /cards/manage' => 'debit_cards',
    'POST /cards/request-physical' => 'debit_cards',
    'POST /cards/reveal-cvv' => 'debit_cards',
    'GET /upi/status' => 'upi',
    'POST /upi/link-card' => 'upi',
    'GET /upi/qr' => 'upi',
    'POST /services/cheque-book' => 'cheque_book',
    'POST /services/stop-cheque' => 'cheque_book',
    'POST /services/demand-draft' => 'demand_draft',
    'GET /investments/catalog' => 'mutual_funds',
    'POST /investments/invest' => 'mutual_funds',
    'GET /investments/my-portfolio' => 'mutual_funds',
];

function capability_state(string $key): array
{
    $spec = CAPABILITIES[$key] ?? null;
    if ($spec === null) {
        return ['enabled' => false, 'name' => $key, 'requires' => 'Unknown capability.'];
    }
    $stored = system_config()['capabilities'][$key] ?? null;
    $enabled = is_array($stored) ? (bool)($stored['enabled'] ?? false) : (bool)$spec['default'];
    if (!empty($spec['never'])) {
        $enabled = false;  // prohibited outright; no switch can turn it on
    }
    return array_merge($spec, [
        'key' => $key,
        'enabled' => $enabled,
        'authorisation_reference' => is_array($stored) ? ($stored['reference'] ?? null) : null,
        'authorised_on' => is_array($stored) ? ($stored['authorised_on'] ?? null) : null,
        'changed_by' => is_array($stored) ? ($stored['by'] ?? null) : null,
    ]);
}

function capability_enabled(string $key): bool
{
    return capability_state($key)['enabled'];
}

// Just the keys that are on, for the app to hide what it must not offer. It
// carries no regulatory detail, so it is safe to hand to any signed-in member.
function enabled_capabilities(): array
{
    return array_values(array_filter(array_keys(CAPABILITIES), 'capability_enabled'));
}

// Refuses with an explanation the member can actually understand, rather than a
// bare 403.
function require_capability(string $key): void
{
    $state = capability_state($key);
    if ($state['enabled']) {
        return;
    }
    fail(403, $state['name'] . ' is not available. ' . (empty($state['never'])
        ? 'This institution is a Nidhi company and does not yet hold the authorisation from '
          . $state['authority'] . ' that this service requires.'
        : 'The Nidhi Rules, 2014 do not permit this service.'));
}

// --- Owner-facing register ---------------------------------------------------------------
function route_capabilities(array $d): void
{
    staff_user(['bank_owner', 'admin', 'branch_manager']);
    $all = array_map('capability_state', array_combine(array_keys(CAPABILITIES), array_keys(CAPABILITIES)));
    respond([
        'capabilities' => array_values($all),
        'entity' => 'Aadhunik Jeewan Sanchay Nidhi Limited',
        'entity_type' => 'Nidhi company under section 406 of the Companies Act, 2013',
        'summary' => [
            'enabled' => count(array_filter($all, fn($c) => $c['enabled'])),
            'gated' => count(array_filter($all, fn($c) => !$c['enabled'])),
        ],
        'disclaimer' => 'This register is an engineering control, not legal advice. Confirm your own '
            . 'position with counsel or the regulator before enabling any capability.',
    ]);
}

function route_capability_set(array $d): void
{
    $owner = staff_user(['bank_owner']);
    need($d, 'capability', 'enabled');
    $key = clip($d['capability'], 40);
    $spec = CAPABILITIES[$key] ?? null;
    if ($spec === null) {
        fail(404, 'Unknown capability.');
    }
    $enabled = (bool)$d['enabled'];
    if ($enabled && !empty($spec['never'])) {
        fail(422, $spec['name'] . ' cannot be enabled: ' . $spec['requires']);
    }
    // Turning something on has to name the authorisation that permits it. This
    // is the whole point of the register — it forces the question to be answered
    // once, in writing, instead of being nodded through.
    $reference = clip($d['authorisation_reference'] ?? '', 120);
    if ($enabled && strlen($reference) < 4) {
        fail(422, 'To enable ' . $spec['name'] . ' you must record the authorisation that permits it — '
            . 'the licence or registration number issued by ' . $spec['authority'] . '.');
    }
    $capabilities = system_config()['capabilities'] ?? [];
    $capabilities[$key] = ['enabled' => $enabled, 'reference' => $enabled ? $reference : null,
        'authorised_on' => $enabled ? ($d['authorised_on'] ?? now_utc()) : null, 'by' => $owner['email']];
    save_system_config(['capabilities' => $capabilities], $owner);

    audit($owner, $enabled ? 'CAPABILITY_ENABLED' : 'CAPABILITY_DISABLED',
        $spec['name'] . ($enabled ? " under $reference" : ''));
    security_event($enabled ? 'CAPABILITY_ENABLED' : 'CAPABILITY_DISABLED',
        $enabled ? 'critical' : 'warning', $spec['name'] . ($enabled ? " under $reference" : ''), $owner);
    respond(['status' => 'SUCCESS', 'message' => $spec['name'] . ($enabled
        ? ' is now available to members. The authorisation reference has been recorded in the audit log.'
        : ' is now switched off for all members.'), 'capability' => capability_state($key)]);
}
