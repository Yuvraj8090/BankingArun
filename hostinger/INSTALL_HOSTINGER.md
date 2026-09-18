# AJSPay on Hostinger (PHP + MySQL)

This package runs the AJSPay React app on standard Hostinger web hosting with a PHP/MySQL backend. `api.php` serves the same `/api/...` routes and JSON as the original FastAPI backend, so the frontend works unchanged. Every screen in the app is supported: accounts, transfers, cards, UPI, deposits, loans, investments, cheques, statements, video KYC, passkeys, OTP, referrals, standing instructions, support and all the staff and admin panels.

## Requirements

- Hostinger Premium or Business web hosting (or any Apache/LiteSpeed host)
- PHP 8.1 or newer with `pdo_mysql`, `mbstring`, `gd`, `zip`, `openssl`, `sodium` and `curl` (all standard on Hostinger)
- MySQL 5.7+ or MariaDB 10.3+
- SSL enabled for your domain (free at Hostinger)

## What's in the package

| File | Purpose |
|---|---|
| `api.php` | Front controller and core banking routes |
| `db.php` | Configuration defaults, database connection, shared helpers |
| `modules/` | Banking services, statements, security (OTP/passkeys), staff and admin |
| `assets/` | Logo used in generated PDF statements |
| `schema.sql` | Database tables and demo data — for a **fresh** database |
| `migrate.sql` | Upgrades a database created from an **earlier** `schema.sql`, keeping its data |
| `cron.php` | Runs standing instructions and scheduled transfers when they come due |
| `.htaccess` | Routing, HTTPS, security headers, file protection |

## Deploy

### 1. Create the database

hPanel → **Databases → Management** → create a database and user with a strong password.

### 2. Import the schema

Open **phpMyAdmin** for that database → **Import** → choose `schema.sql` → **Go**.

The database user hPanel creates owns the database, so it has the rights to create
these tables. If the import reports `CREATE command denied`, you are connected as a
user that only has read/write rights — import as the owner shown in
**Databases → Management** instead.

**Already running an older build?** Import `migrate.sql` instead of `schema.sql`.
It adds the scheme, agent and collection tables and the columns `cron.php` needs,
without touching any existing row. Importing `schema.sql` over a live database is
also safe (every statement is `IF NOT EXISTS` / `INSERT IGNORE`) but it will not add
columns to tables you already have — so run `migrate.sql` for an upgrade.

### 3. Create `config.local.php`

Create a file called `config.local.php` next to `db.php`. Secrets live only in this file, never in `db.php`:

```php
<?php
return [
    'db_name'           => 'u123456789_banking_db',
    'db_user'           => 'u123456789_bank_user',
    'db_pass'           => 'your-mysql-password',
    'allowed_origins'   => ['https://yourdomain.com'],
    'token_secret'      => 'paste-64-random-hex-characters-here',
    'public_app_url'    => 'https://yourdomain.com',
    'webauthn_rp_id'    => 'yourdomain.com',
    'webauthn_origin'   => 'https://yourdomain.com',
];
```

Generate the token secret with:

```bash
php -r "echo bin2hex(random_bytes(32));"
```

It signs every login session and encrypts stored API keys, so anyone who has it can forge logins. Keep it private, and never commit it. The API refuses to start until it is set.

`allowed_origins` must list your exact site address. Never use `*`. `webauthn_rp_id` is your bare domain (no `https://`), and passkeys only work over HTTPS.

### 4. Build the frontend

```bash
cd frontend
REACT_APP_BACKEND_URL=https://yourdomain.com INLINE_RUNTIME_CHUNK=false npm run build
```

`INLINE_RUNTIME_CHUNK=false` is required: the Content-Security-Policy in `.htaccess` blocks inline scripts, and without the flag the app loads as a blank page.

### 5. Upload

In hPanel **File Manager**, open `public_html` and upload `api.php`, `db.php`, `.htaccess`, your `config.local.php`, the `modules/` and `assets/` folders, and everything inside `frontend/build/`. Don't upload `schema.sql` or this guide; `.htaccess` blocks them, but they don't belong on a web server.

### 6. Check it

- `https://yourdomain.com/api/auth/me` returns `{"detail":"Authentication token required. Please login."}`
- `https://yourdomain.com/db.php` returns **403 Forbidden**
- `https://yourdomain.com/modules/staff.php` returns **403 Forbidden**
- Open the site, log in with a demo account below, then **change every demo password**. They are public.

| Role | Email | Password | Transaction password |
|---|---|---|---|
| Retail | rahul.sharma@example.com | Banking@123 | Txn@1234 |
| Corporate | tata.corp@example.com | Corporate@123 | Corp@1234 |
| Branch manager | manager@ajspay.in | Admin@123 | Admin@1234 |
| Bank owner | owner@ajspay.in | Owner@123 | Txn@1234 |
| Staff | meera.staff@ajspay.in | Staff@123 | Txn@1234 |
| Collections | collections@ajspay.in | Collect@123 | Txn@1234 |
| Loan officer | loans@ajspay.in | Loan@123 | Txn@1234 |

### 7. Schedule the cron job (required for standing instructions)

Standing instructions and scheduled transfers are only promises until `cron.php`
runs them. Without this step no recurring payment ever leaves an account.

hPanel → **Advanced → Cron Jobs** → **Create new cron job**:

- **Type of cron job**: PHP
- **Command**: `/usr/bin/php /home/<your-user>/public_html/cron.php`
- **Schedule**: once a day, in the small hours — **2:00 AM** is a good choice

Replace `<your-user>` with your hosting account name; hPanel shows the full path in
**Files → File Manager**. If PHP lives elsewhere on your plan, use the interpreter
path hPanel suggests for a PHP cron job.

What it does on each run:

- Pays every standing instruction whose next date has arrived, then moves that date
  on by its frequency. Monthly and quarterly instructions keep the day of the month
  the customer chose, clamped in shorter months (a 31st instruction falls on the 28th
  in February).
- Executes one-off scheduled transfers on or after their date, marking each
  `EXECUTED` with a UTR, or `FAILED` with a reason.
- Leaves an instruction it cannot pay (insufficient balance, frozen account) due, to
  retry on the next run, and pauses it after 3 failures in a row so it stops trying.
  The customer sees the reason on their Standing Instructions page.
- Writes an audit-log row for every payment, failure and pause.

Notes:

- It is safe to run more often than daily — each instruction is attempted at most
  once per calendar day, and a MySQL lock keeps two overlapping runs from paying twice.
- It never runs over HTTP: it refuses any web request and `.htaccess` denies the file.
- Check it by hand over SSH with `php cron.php --dry-run`, which lists what is due and
  writes nothing.
- Exit codes: `0` all clear, `2` it ran but something failed and needs a look, `1` it
  could not run at all. Point hPanel's cron email at yourself to see the report.

### 8. Create the mailboxes

Two addresses on the same domain, and only one of them is a mailbox anyone has to read.

In hPanel open **Emails → Email Accounts** for `ajspay.in` and create:

| Address | What it is for |
|---|---|
| `alerts@ajspay.in` | The account the app signs into to send OTPs and alerts. Nobody reads it. |
| `support@ajspay.in` | A real mailbox staff read. Every mail the app sends carries it as Reply-To. |

Then under **Emails → Forwarders**, point `alerts@` and `grievance@` at `support@`, so a
reply to an OTP mail and a grievance notice both land in the one inbox. A grievance
address is not optional for a Nidhi — name its officer under **System Config →
Compliance officers** as well.

Hostinger adds the MX, SPF and DKIM records for the domain itself when the mailbox is
created. Check them under **Emails → DNS settings**; without SPF and DKIM, OTP mail goes
to spam.

Outbound limits: Hostinger caps sending per mailbox per day (a few hundred on the lower
plans). That is enough for OTP traffic at this size, but it is a real ceiling — if you
outgrow it, put a SendGrid key in and the app falls back to the API relay on its own.

### 9. Turn on live OTP (optional)

Sign in as the bank owner and open **System Config**.

- **Email mailbox (SMTP)** — host `smtp.hostinger.com`, port `465`, the mailbox address
  `alerts@ajspay.in` and its password, and `support@ajspay.in` as the support address.
- **Twilio SMS credentials** — for OTPs over SMS.
- **SendGrid** — leave blank unless you want the API relay instead of the mailbox. It is
  only used when the SMTP fields are empty.

Then switch on live OTP. The mailbox password and the API keys are encrypted before they
are stored and only ever shown back masked. Until you do this, the app runs in demo mode
and shows the OTP on screen.

If a mail does not arrive, the failing SMTP step is in the PHP error log as
`AJSPay SMTP: ...` — the command that was refused, never the password.

## Security built in

1. Passwords and transaction passwords are hashed with bcrypt and only ever checked with `password_verify`.
2. Unknown emails still run a bcrypt check, so response times don't reveal which emails have accounts.
3. Passwords must be 8–72 characters (bcrypt ignores anything past 72 bytes).
4. Sessions are HMAC-SHA256-signed tokens, compared in constant time, that expire after 30 minutes.
5. Logging out revokes every session for that user on the server.
6. The session cookie is `HttpOnly`, `Secure` and `SameSite=Lax`.
7. Login lockout: 5 failures per IP and email within 15 minutes returns 429.
8. Transaction-password lockout: 5 wrong attempts within 15 minutes blocks money movement.
9. `X-Forwarded-For` is ignored by default, so lockouts can't be dodged by faking IPs.
10. CORS allows only the exact origins you list, never `*`.
11. Write requests must be JSON, which blocks form-based CSRF.
12. Every query uses real prepared statements, so no SQL injection.
13. Every lookup is scoped to the logged-in user: nobody can read or move another customer's money, cards, statements or standing instructions by guessing an ID.
14. Staff, admin, loan, collections and bank-owner APIs each check the caller's role.
15. Transfers run in a database transaction with row locks taken in a fixed order: no double-spending, races or deadlocks.
16. Amounts must be positive numbers rounded to paise; bulk payouts reject zero or negative lines.
17. A `CHECK` constraint stops any balance going negative (MySQL 8.0.16+ / MariaDB 10.2+).
18. Frozen or closed accounts can't send money, and inactive accounts can't receive it.
19. Hotlisting a card is permanent.
20. Card PINs are stored only as bcrypt hashes and never returned; new cards have no usable default PIN.
21. Card CVVs are never included in the card list: revealing one needs the transaction password, and every reveal is logged.
22. Account numbers and dates travel in POST bodies, not URLs, so they stay out of browser history, referrers and server logs.
23. Aadhaar numbers are masked to the last 4 digits before storage, and PAN format is validated.
24. OTPs are stored as HMAC hashes, expire in 5 minutes, allow 5 wrong guesses, and are rate-limited to 10 sends per 15 minutes.
25. Passkeys are verified in full: signature, challenge, origin, relying-party hash and a clone-detecting signature counter. Challenges are single-use and expire in 5 minutes.
26. Passkey sign-in gives the same answer for an unknown email and an account without a passkey, so customers can't be enumerated.
27. Twilio and SendGrid keys are encrypted before being stored and are only ever displayed masked.
28. Self-declared opening deposits are clamped between ₹1,000 and ₹10,00,000.
29. Uploaded KYC photos must be real images under 1.5 MB, and identical selfie/PAN photos can never auto-approve.
30. An audit log records logins, logouts, sign-ups, transfers, card changes, statement downloads, KYC decisions and config changes, with IP addresses.
31. Clients get generic error messages; details go only to the server error log, and PHP never displays errors.
32. The API refuses to run until `token_secret` is configured.
33. HTTPS is forced, with HSTS.
34. Content-Security-Policy, `X-Frame-Options: DENY` (clickjacking), `nosniff`, `Referrer-Policy` and `Permissions-Policy` headers are set.
35. API responses are sent with `Cache-Control: no-store`, so banking data isn't cached.
36. `.htaccess` blocks `db.php`, `config.local.php`, `modules/`, `assets/`, SQL, docs and dotfiles, and turns off directory listing. The server signature and `X-Powered-By` are hidden.
37. Request bodies are capped at 8 MB.

## Known limitations

- Standing instructions and scheduled transfers only run if you set up the cron job in step 7. Nothing recurring happens without it.
- Cron pays interbank instructions by debiting the customer only. There is no real NEFT/RTGS connection, so an outgoing payment to another bank is recorded, not actually settled.
- Deposit interest and maturity credits are implemented in `cron.php`. They require the cron job to run and a valid source account; monitor failures and reconcile the resulting ledger entries.
- Card CVVs are still stored and can be revealed when the card capability is enabled. Do not use this implementation for real payment cards. PCI DSS prohibits merchants from storing CVVs after authorisation, even encrypted; issuer-specific exceptions do not establish this application's eligibility. See https://www.pcisecuritystandards.org/faqs/are-merchants-allowed-to-request-card-verification-codes-values-from-cardholders/.
- The member-register report lists users, accounts and balances; it does not implement a share register or share-allotment records.
- Sanctions/PEP screening and customer AML risk categorisation are not implemented. Loan risk scores are not a substitute.
- Published demo credentials must be removed from a production deployment. The Security Centre checks six known demo login passwords; a passing result alone does not verify transaction passwords, other accounts or production readiness.
- Video KYC face-match compares colour histograms. It is an image heuristic, not a biometric identity check, and should never be the only KYC control in production.
- Bulk payouts only debit the corporate account, matching the original backend.
- Logging out ends the session on every device.
- This is demo banking software. Running a real bank or deposit-taking business in India requires the appropriate RBI or MCA authorisation.

## Local development

```bash
mysql -u root -e "CREATE DATABASE ajspay_php" && mysql -u root ajspay_php < schema.sql
php -S 127.0.0.1:8002 api.php
```

Put local settings in `config.local.php` (`cookie_secure => false` for plain http). The file is gitignored.
