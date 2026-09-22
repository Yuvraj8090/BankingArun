# Payment rails — how money actually enters and leaves

This explains how to make real bank transfers work: money that genuinely arrives
in the institution's account, and payments that genuinely reach another bank.

Read the first section before anything else. It decides which of the rest applies
to you.

---

## 1. What this entity can and cannot do

Aadhunik Jeewan Sanchay Nidhi Limited is a **Nidhi company** under section 406 of
the Companies Act, 2013. It is not a bank and holds no RBI licence.

**It therefore cannot:**

- become a member of NPCI, or connect to the IMPS switch directly
- join NEFT or RTGS clearing at the RBI, or get an IFSC of its own
- issue a native `@ajspay` UPI handle as an issuer/PSP bank
- put a message on INFINET, or operate an SFMS gateway

Those require a banking licence — a scheduled commercial bank, small finance
bank, or payments bank — and authorisation under section 4 of the Payment and
Settlement Systems Act, 2007. An HSM, an SFMS gateway and an ISO 8583 host
connection are the *bank* path. Building them here would produce code that can
never be certified and never be switched on.

**What it can do**, and what this software implements:

Move real money through a **regulated partner** — an RBI-authorised payment
aggregator, or a sponsor bank. The partner holds the settlement account and
carries the NPCI/RBI membership. The Nidhi instructs them; they move the money.
This is the normal, legal route for a non-bank, and it is what nearly every
fintech in India runs on.

Internal transfers between two member accounts are a book entry on our own
ledger and need none of this. They already work and are unaffected.

---

## 2. What to arrange before touching the code

1. **Pick a partner.** You need one that offers, for a non-bank entity:
   - **Payouts** — IMPS / NEFT / RTGS to any account number + IFSC
   - **Collections** — UPI collect requests or payment links that settle into
     your account
   - **Webhooks** — a callback when a payout or collection reaches a final state

2. **Complete their onboarding.** Expect: certificate of incorporation, PAN,
   GST, the Nidhi's MOA/AOA, board resolution, director KYC, bank proof for the
   settlement account, and a description of your use case. Budget weeks, not
   days.

3. **Get a current account** in the company's name that the partner can settle
   into and pay out of. This is the **pooled account** — it is the institution's
   own account, never a member's.

4. **Record the authorisation.** Once signed, the agreement reference goes into
   the capability register (3.6 below). The register refuses to enable
   outward transfers without one, on purpose.

> Nidhi Rules note: a Nidhi may deal only with its **members**, may not open
> current accounts *with* members (Rule 6), and may not pay deposit interest
> above the rate the RBI permits NBFCs (12.5% a year). A payment partner does
> not change any of that. Confirm your own position with counsel.

---

## 3. Set it up

### 3.1 Create the database tables

Fresh install — `schema.sql` already has them. Existing database:

```bash
mysql -u <db_user> -p <db_name> < migrate.sql
```

Adds `rail_transactions` (every instruction given to the partner) and
`rail_events` (webhook de-duplication). Safe to run more than once.

### 3.2 Write the config file

```bash
cp config.rails.php.example config.rails.php
```

Fill it in. Every field is commented in that file. The ones that matter most:

| Field | What it is |
|---|---|
| `driver` | `simulator` (nothing moves) or `partner` (real money) |
| `base_url` | The partner's API root. **https only** |
| `key_id` / `key_secret` | Their API credentials |
| `webhook_secret` | The signing secret from their webhook setup screen |
| `settlement_account` | Your pooled current account at the partner |
| `payout_path` / `collect_path` / `status_path` | Their endpoint paths |
| `ref_field` / `status_field` / `utr_field` | Where to read the answer in their JSON |
| `status_map` | Their status words mapped onto `SUCCESS` / `PENDING` / `FAILED` |
| `max_payout` / `daily_payout_cap` | Limits. Start low |

`config.rails.php` is git-ignored and denied over HTTP by `.htaccess`. Never
commit it.

You can also set all of this from the owner's Rails screen
(`PUT /api/rails/config`), which stores the secrets encrypted in the database
and **overrides the file**. Use the file for first setup, the screen for
rotating keys.

### 3.3 Give the partner your webhook URL

```
https://yourdomain.com/api/rails/webhook
```

Every callback must be signed: `HMAC-SHA256(raw request body, webhook_secret)`,
sent in the header named by `webhook_header` (default `X-Webhook-Signature`). An
unsigned or wrongly-signed callback is rejected with 401 and logged as a
security event — it can never credit an account.

Subscribe to at least: payout success, payout failure/reversal, and collection
success.

### 3.4 Schedule the cron

The cron dispatches queued payouts and reconciles anything the webhooks missed.
Run it **often** — every 5 minutes is reasonable, daily is not:

```bash
*/5 * * * * /usr/bin/php /home/<user>/public_html/cron.php
```

It is safe to run concurrently: a MySQL lock keeps overlapping runs apart, and
every step is idempotent.

### 3.5 If you changed the Python service's dependencies

The director's rail screen is served by the Python backend, and it needs two
packages the older releases did not: `httpx` and `PyNaCl`. A deploy ships code
but **cannot install dependencies** — the virtualenv is root-owned and
provisioning is a deliberate root action — so after any change to
`pyapi/requirements.txt`, run this once as root on the VPS:

```bash
/srv/ajspay/pyapi-venv/bin/pip install -r /srv/ajspay/pyapi/requirements.txt
```

The deploy refuses to swap in a release its virtualenv cannot import, so
forgetting this stops the deploy rather than breaking the site. It is worth
knowing why that guard exists: without it the service would fail to start while
the proxy map was applied anyway, and every already-ported route — the public
product pages, the rate card, the branch locator — would answer 502 while the
deploy reported success, because everything the smoke check looked at was served
by PHP.

### 3.6 Switch the capability on

Outward transfers stay refused until the bank owner enables them and **records
the authorisation reference**:

```
PUT /api/compliance/capability
{"capability": "payment_systems", "enabled": true,
 "authorisation_reference": "<your sponsor/PA agreement reference>"}
```

Same for `upi` if you are offering UPI collections. This is deliberate: it
forces the question to be answered once, in writing, and it is audited.

### 3.7 Go live

```
PUT /api/rails/config   {"driver": "partner"}
```

This is refused unless the base URL, key id, key secret and webhook secret are
all present — so a member's transfer never discovers the config is incomplete.

Check it first:

```
POST /api/rails/test
```

It does a status lookup for a reference that cannot exist. A `404` back means
the credentials work and the endpoint is right. A `401`/`403` means the keys are
wrong.

---

## 4. How it behaves

### Sending money out

1. Member submits a transfer to an account outside the institution.
2. The capability and the rail's own limits are checked **before** anything is
   debited.
3. The member is debited and the ledger entry is written as **`PENDING`**.
4. **After** the database transaction commits — never while holding account
   locks — the partner's payout API is called.
5. The partner's answer decides what happens:
   - **accepted** → stays `PENDING`, settles when their webhook arrives
   - **rejected** → the debit is marked `FAILED`, the money is credited back,
     and a reversal line appears on the statement
   - **no answer / timeout** → stays `PENDING`. It is *not* reversed, because
     the payout may well have been accepted; reversing would risk paying twice.
     The reconciliation job resolves it.

Scheduled transfers and standing instructions to an external payee go through
the same rail: cron queues them, then dispatches them once the locks are
released.

### Receiving money

1. Member requests a collection (`POST /api/rails/collect`, needs the `upi`
   capability).
2. A payment link / UPI collect request is created with the partner.
3. Money arrives in **your pooled settlement account**.
4. The partner's webhook confirms it, and only then is the member's balance
   credited.

Nothing credits a member's balance on our own say-so. This is the whole point.

### When webhooks go missing

They do. Every pending rail transaction older than two minutes is asked about
directly by the cron job. Anything that was recorded but never handed to the
partner — say the process died between the commit and the API call — is
dispatched on the next run, using the same idempotency key, so it can never pay
twice.

---

## 5. Testing without a partner

Leave `driver` at `simulator`. Outward transfers complete instantly, every
response is flagged `"simulated": true` and says *"no money left this
institution"*, and a `rail_transactions` row is written so you can see the whole
flow. Settle a simulated collection by hand to exercise the credit path:

```
POST /api/rails/reconcile   {"ref_number": "COL-...", "simulate": "SUCCESS"}
```

To test the real partner code path without a real partner, point `base_url` at a
local mock that returns the partner's JSON shape, and post yourself a signed
webhook:

```bash
BODY='{"id":"evt_1","payload":{"payout":{"entity":{"id":"pout_x","status":"processed","utr":"TEST1"}}}}'
SIG=$(python3 -c "import hmac,hashlib,sys;print(hmac.new(b'<webhook_secret>',sys.argv[1].encode(),hashlib.sha256).hexdigest())" "$BODY")
curl -X POST http://127.0.0.1:8002/api/rails/webhook \
  -H 'Content-Type: application/json' -H "X-Webhook-Signature: $SIG" -d "$BODY"
```

---

## 6. Watching it in production

| Route | Who | What |
|---|---|---|
| `GET /api/rails/config` | owner | Current settings, secrets masked, today's payout total |
| `POST /api/rails/test` | owner | Connectivity and credential check |
| `GET /api/rails/transactions` | owner, admin | Everything in flight and everything that failed |
| `POST /api/rails/reconcile` | owner | Ask the partner about one transaction now |
| `GET /api/rails/my-payments` | member | Their own in-flight payments |

Watch for: rows stuck `PENDING` with no `partner_ref` (instructions that never
reached the partner), and `paid_out_today` approaching the cap.

---

## 7. Troubleshooting

**Transfers refused with "not available"** — the `payment_systems` capability is
off. See 3.6.

**"The payment partner is not configured"** — one of base URL, key id, key
secret or webhook secret is blank. The rail refuses rather than silently
pretending money moved.

**Webhooks return 401** — the signature does not match. Check you are signing
the **raw body** (not a re-serialised copy), with the right secret, and that
`webhook_header` matches the header the partner actually sends.

**Everything stays PENDING** — the webhook URL is wrong or unreachable, or the
cron is not running. Check `GET /api/rails/transactions` and the cron output.

**Webhook says "No matching transaction"** — `ref_field` is pointing at the
wrong place. It is read from the *object* (`payload.payout.entity`, or whatever
your partner nests it in), not from the event envelope, whose `id` is the event
id. Set `event_object_path` explicitly if auto-detection misses it.

---

## 8. If this ever becomes a bank

The driver layer is where a direct NPCI connection would go — `rail_payout()`,
`rail_collect()` and `rail_settle()` are the only functions that would change,
and nothing above them would.

It is not written, and should not be written speculatively, because it cannot be
switched on without: a banking licence, RBI authorisation under the PSS Act,
NPCI membership, an IFSC, HSMs for key management, INFINET connectivity through
IDRBT, an SFMS gateway for NEFT/RTGS, an ISO 8583 host-to-host link for IMPS,
and passing NPCI's certification in their Certification Zone.

That is a licensing programme with a software component, not a software project.
The partner rail above is what works in the meantime, and for most institutions
it is what works permanently.
