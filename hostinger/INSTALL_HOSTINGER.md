# AJSPay on Hostinger (PHP + MySQL)

This package runs the AJSPay React app on standard Hostinger web hosting with a PHP/MySQL backend. `api.php` serves the same `/api/...` routes and JSON as the FastAPI backend, so the frontend works unchanged.

## What's ported so far

| Module | PHP/MySQL |
|---|---|
| Login, registration, sessions, transaction-password check | ✅ |
| Accounts, balances, transaction history | ✅ |
| Transfers (IMPS/NEFT/RTGS/UPI), scheduled transfers, corporate bulk payouts | ✅ |
| Debit cards: list, freeze/unfreeze, hotlist, limits, set PIN, order a physical card | ✅ |
| UPI on debit card: status, link a card, payment QR | ✅ |
| Deposits, loans, investments, cheques/DDs, support, KYC, passkeys, OTP, statements, referrals, standing instructions, admin and staff panels | ⏳ Not yet. These features show "Not Found" on this deployment |

## Requirements

- Hostinger Premium or Business web hosting (or any Apache/LiteSpeed host)
- PHP 8.1 or newer with `pdo_mysql` and `mbstring` (both on by default at Hostinger)
- MySQL 5.7+ or MariaDB 10.3+
- SSL enabled for your domain (free at Hostinger)

## Deploy

### 1. Create the database

hPanel → **Databases → Management** → create a database and a user with a strong password.

### 2. Import the schema

Open **phpMyAdmin** for that database → **Import** → choose `schema.sql` → **Go**.

### 3. Configure `db.php`

Edit the `$config` block at the top:

- `db_name`, `db_user`, `db_pass`: from step 1.
- `allowed_origins`: your site, e.g. `['https://yourdomain.com']`. Never `*`.
- `token_secret`: a fresh random value. The API refuses to run until it's set.

  ```bash
  php -r "echo bin2hex(random_bytes(32));"
  ```

  Anyone who has this value can forge logins, so keep it private and out of git.
- Leave `cookie_secure` as `true`. Leave `trust_proxy` as `false` unless the site sits behind a CDN you control, such as Cloudflare.

### 4. Build the frontend

```bash
cd frontend
REACT_APP_BACKEND_URL=https://yourdomain.com INLINE_RUNTIME_CHUNK=false npm run build
```

`INLINE_RUNTIME_CHUNK=false` is required: the Content-Security-Policy in `.htaccess` blocks inline scripts, and without the flag the app loads as a blank page.

### 5. Upload

In hPanel **File Manager**, open `public_html` and upload `api.php`, `db.php` and `.htaccess`, plus everything inside `frontend/build/`. Don't upload `schema.sql`, this guide, or `config.local.php`. `.htaccess` blocks them anyway, but they don't belong on a web server.

### 6. Check it

- `https://yourdomain.com/api/auth/me` should return `{"detail":"Authentication token required. Please login."}`.
- `https://yourdomain.com/db.php` should return **403 Forbidden**.
- Log in with a demo account below, then **change every demo password**. They are public.

| Role | Email | Password | Transaction password |
|---|---|---|---|
| Retail | rahul.sharma@example.com | Banking@123 | Txn@1234 |
| Corporate | tata.corp@example.com | Corporate@123 | Corp@1234 |
| Branch manager | manager@ajspay.in | Admin@123 | Admin@1234 |
| Bank owner | owner@ajspay.in | Owner@123 | Txn@1234 |
| Staff | meera.staff@ajspay.in | Staff@123 | Txn@1234 |
| Collections | collections@ajspay.in | Collect@123 | Txn@1234 |
| Loan officer | loans@ajspay.in | Loan@123 | Txn@1234 |

## Security built in

1. Passwords and transaction passwords are hashed with bcrypt and only ever checked with `password_verify`.
2. Unknown emails still run a bcrypt check, so response times don't reveal which emails have accounts.
3. Passwords must be 8–72 characters (bcrypt ignores anything past 72 bytes).
4. Sessions are HMAC-SHA256-signed tokens, compared in constant time, that expire after 30 minutes.
5. Logging out revokes every session for that user on the server.
6. The session cookie is `HttpOnly`, `Secure` and `SameSite=Lax`.
7. Login lockout: 5 failures per IP and email within 15 minutes returns 429.
8. Transaction-password lockout: 5 wrong attempts within 15 minutes blocks money movement.
9. `X-Forwarded-For` is ignored by default, so the lockouts can't be dodged by faking IPs.
10. CORS allows only the exact origins you list, never `*`.
11. Write requests must be JSON, which blocks form-based CSRF.
12. Every query uses real prepared statements, so no SQL injection.
13. Every lookup is scoped to the logged-in user: nobody can read or move another customer's money or cards by guessing an ID.
14. Transfers run in a database transaction with row locks taken in a fixed order, so there's no double-spending, race or deadlock.
15. Amounts must be positive numbers, rounded to paise. Bulk payouts reject zero or negative lines.
16. A `CHECK` constraint stops any balance going negative (MySQL 8.0.16+ / MariaDB 10.2+).
17. Frozen or closed accounts can't send money, and inactive accounts can't receive it.
18. Hotlisting a card is permanent.
19. Card PINs are stored only as bcrypt hashes and are never returned. New cards have no usable default PIN.
20. Card limits are capped at ₹10,00,000.
21. Bulk payouts are for corporate customers only, at most 500 lines per batch.
22. Aadhaar numbers are masked to the last 4 digits before storage. PAN format is validated.
23. Self-declared opening deposits are clamped between ₹1,000 and ₹10,00,000.
24. An audit log records logins, logouts, sign-ups, transfers and card changes, with IP addresses.
25. Clients get generic error messages. Details go only to the server error log, and PHP never displays errors.
26. The API refuses to run while `token_secret` is still the placeholder.
27. HTTPS is forced, with HSTS.
28. Headers set: Content-Security-Policy, `X-Frame-Options: DENY` (blocks clickjacking), `nosniff`, `Referrer-Policy` and `Permissions-Policy`.
29. API responses are sent with `Cache-Control: no-store`, so banking data isn't cached.
30. `.htaccess` blocks `db.php`, config files, SQL, docs and dotfiles, and turns off directory listing. The server signature and `X-Powered-By` are hidden.
31. Request bodies are capped at 8 MB.

## Known limitations

- Scheduled transfers are stored, but nothing executes them yet. The same is true in FastAPI; a cPanel cron job is the planned fix.
- Referral codes entered at sign-up are ignored until the referrals module is ported.
- Card CVVs are stored so the virtual-card screen can show them. That's fine for a demo, but PCI DSS forbids storing CVVs in a real card system.
- Bulk payouts only debit the corporate account (they're outbound interbank transfers), matching FastAPI.
- Logging out ends the session on every device.
- This is demo banking software. Running a real bank or taking real deposits in India requires RBI authorisation.

## Local development

```bash
mysql -u root -e "CREATE DATABASE ajspay_php" && mysql -u root ajspay_php < schema.sql
php -S 127.0.0.1:8002 api.php
```

Put local settings in `config.local.php`. It returns an array that overrides `$config` in `db.php`, and it's gitignored.
