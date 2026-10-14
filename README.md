# AJSPay

Member portal for **Aadhunik Jeewan Sanchay Nidhi Limited** (CIN U65990UP2019PLN121746) —
deposits, loans, transfers, KYC and the back-office panels that run them.

Live at **https://ajspay.co.in**

---

## Architecture

| Layer | Technology | Status |
|---|---|---|
| Frontend | React (CRA + craco), Tailwind | Live |
| API | PHP 8.5 (`hostinger/`) | **Live — serves every route** |
| API | FastAPI (`pyapi/`) | Port in progress, 11 of ~196 routes |
| API | FastAPI + MongoDB (`backend/`) | Legacy dev stack, not deployed |
| Database | MariaDB, 40 tables | Live |
| Host | Apache on a VPS, Let's Encrypt | Live |

Three backends exist, which is two more than anyone wants. `hostinger/` is the
only one serving traffic. `pyapi/` is replacing it one route at a time.
`backend/` is the original development stack on MongoDB and is not deployed —
its data layer does not match production and it should be retired once `pyapi/`
overtakes it.

### The frontend calls relative URLs

The production build sets `REACT_APP_BACKEND_URL=''`, so every request is
same-origin. Building with a hostname baked in is what caused the public pages
to fail CORS after the domain moved — don't reintroduce it.

---

## Repository layout

```
frontend/        React app; `src/pages` is one file per screen
hostinger/       PHP backend — api.php routes, modules/ holds the handlers
  schema.sql     Full schema + seed, for a fresh database
  migrate.sql    Additive upgrades for a database that already has data
pyapi/           Python port (see pyapi/README.md)
backend/         Legacy FastAPI + MongoDB dev stack
scripts/         Build, deploy and one-time provisioning
.github/         Deploy workflow
```

---

## Development

```bash
cd frontend && npm install && npm start     # note: craco, not react-scripts
```

The `@/` import alias is defined in `craco.config.js`. Running `react-scripts`
directly bypasses it and the build fails on `Can't resolve '@/index.css'`.

Backend development needs PHP 8.1+ and MariaDB; import `schema.sql` into an
empty database and create `hostinger/config.local.php` (see
`hostinger/INSTALL_HOSTINGER.md`). That file is gitignored and must stay so.

Tests: with the API on 127.0.0.1:8002 (`php -S 127.0.0.1:8002 api.php` from
`hostinger/`), run `zsh hostinger/tests/run_all.sh`. It covers the API, the daily
jobs, every role against every page, and the Python port. Never point it at
production: the suites write and delete rows.

---

## Deployment

Push to `main` and GitHub Actions deploys. The workflow needs two repository
secrets: `VPS_SSH_KEY` and `VPS_KNOWN_HOSTS`.

Each deploy, in order:

1. Builds the frontend and packages only public runtime files
2. Uploads to a new release directory named for the commit
3. **Dumps the database** and verifies the dump is a complete gzip stream
4. Swaps `/srv/ajspay/current` — one atomic symlink move, no downtime
5. Reloads PHP-FPM, because OPcache keys on a path that never changes
6. Smoke-checks `/version.txt` and `/api/auth/me`, rolling back if either fails
7. Prunes to the five most recent releases; backups keep 14 days

To skip a deploy, put `[skip ci]` in the commit message.

**Schema changes are never automatic.** `migrate.sql` is delivered to
`/srv/ajspay/migrate.sql` but applied by hand, deliberately:

```bash
mariadb ajspay < /srv/ajspay/migrate.sql
```

---

## Security

What the live backend does, and what a change here must not undo:

- Every query parameterised — values are never formatted into SQL
- bcrypt passwords, with a separate transaction password
- HMAC-SHA256 session tokens; the API refuses to start without `token_secret`
- A `session_version` claim, so logging out revokes every token issued before it
- TOTP MFA, rate limiting, audit logging on back-office writes
- CSP, HSTS, `X-Frame-Options: DENY`, `nosniff`
- `db.php`, `config.local.php` and `modules/` are unreachable over HTTP
- Config lives in `/etc/ajspay/`, outside the document root
- MariaDB is bound to loopback; 3306 is not open. Remote access is an SSH
  tunnel to a `SELECT`-only account

**Never commit a secret.** `.env` files and `config.local.php` are gitignored.
`backend/.env` was tracked historically and its Twilio and SendGrid keys should
be treated as compromised until rotated at those vendors.

---

## What this company is

A Nidhi company under the Companies Act, 2013, governed by the Nidhi Rules,
2014. It deals only with its members. The Nidhi Rules cap deposit interest at
**12.5% a year**, and no commission or brokerage may be paid for bringing in
deposits — `compliance.php` encodes which services the institution is actually
authorised to offer, and hides the rest rather than advertising them.
