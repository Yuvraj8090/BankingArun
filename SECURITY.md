# Security status

Every row was checked against the code, the live site, or the server — not
assumed. Where something is marked **Done**, there is a file and a line behind
it. Where it is **Not applicable**, the reason is stated rather than the row
being quietly dropped.

Verified against commit `526d169`, live host `ajspay.co.in`.

**Legend** — ✅ done · 🟡 partial · ⬜ not started · ➖ not applicable here · 🏢 not code (an organisational or commercial commitment)

---

## A note on scale

Roughly eighty controls were requested across five lists. They are not the same
kind of thing. Some are a few lines of PHP. Some are a purchase (a WAF, a bug
bounty). Some are a team you hire (a 24/7 SOC). Some describe infrastructure
this system does not have — there is no Kubernetes, no VPC, no containers, no
mobile app, and no GraphQL. Marking those "done" would be a lie, and marking
them "pending" would imply they are on a roadmap when they may never be right
for a single-VPS deployment.

So each is placed honestly, and the ones that are genuinely missing code are
listed at the bottom as real work.

---

## 1. Authentication and session

| # | Control | Status | Evidence |
|---|---|---|---|
| 1 | Multi-factor authentication | ✅ | TOTP in `modules/mfa.php`; password + authenticator |
| 2 | Adaptive / risk-based auth | 🟡 | `modules/ai.php` scores transactions and raises `fraud_alerts`; it does not yet step up the *login* challenge on anomaly |
| 3 | Biometric authentication | ✅ | Via WebAuthn — Touch ID / Face ID / Windows Hello / Android |
| 4 | FIDO2 / WebAuthn | ✅ | `passkeys`, `passkey_challenges`; register at Security & Passkeys |
| 5 | JWT best practices | 🟡 | HMAC-SHA256 signed, 30-minute TTL, `session_version` revocation claim. Uses HS256, not RS256/ES256 — see "Decisions needed" |
| 6 | OAuth 2.0 / OIDC | ⬜ | No third-party identity federation. Only needed if you want "sign in with…" |
| 7 | Strong password policy | 🟡 | 8–72 characters enforced (`api.php:293`). No complexity rule, no breached-password check |
| 8 | Account lockout | ✅ | 5 consecutive failures → 15-minute lock, in `route_login` |
| 9 | Credential stuffing protection | 🟡 | Lockout + per-IP throttling. No IP reputation feed or behavioural analytics |
| 10 | Session invalidation on logout | ✅ | `session_version` increments; every token issued earlier dies at once |
| 11 | Concurrent session control | ⬜ | Sessions are stateless; no device list, no "sign out everywhere" |
| 12 | Step-up authentication | ✅ | Transaction password + OTP before transfers; also required to change a nomination or joint holder |
| 13 | Secure password recovery | ⬜ | **No reset flow exists at all** — see "Real gaps" |
| 14 | Device binding / fingerprinting | ⬜ | Not implemented |
| 15 | PKI | 🟡 | Let's Encrypt TLS to Dec 2026, auto-renewing. No client certificates |

## 2. Data protection

| # | Control | Status | Evidence |
|---|---|---|---|
| 1 | TLS 1.3, 1.2 floor | ✅ | `SSLProtocol -all +TLSv1.2 +TLSv1.3` in the vhost |
| 2 | HSTS | ✅ | `max-age=63072000; includeSubDomains` — confirmed on the live response |
| 3 | Encryption at rest | ⬜ | MariaDB data files are not encrypted. Backups are gzip, not encrypted |
| 4 | End-to-end encryption | ➖ | Server must read every field it validates; E2EE would break KYC, fraud scoring and statements |
| 5 | KMS / HSM | ⬜ | `token_secret` lives in a root-owned file, `640 root:www-data`. No vault |
| 6 | Column-level encryption | 🟡 | Secrets (API keys) sealed with `sodium_crypto_secretbox`. Member PII columns are plaintext |
| 7 | Salted password hashing | ✅ | bcrypt via `password_hash` — per-password salt built in |
| 8 | Cryptographic erasure | ⬜ | Deletion is row deletion; no per-record key to destroy |
| 9 | Proper IVs / salts | ✅ | `random_bytes` nonce per sealed value; bcrypt salts itself |
| 10 | Tokenization | 🟡 | CVV is never stored; card numbers are shown as last-4. Full PAN still stored |
| 11 | Data masking on screen | ✅ | Aadhaar stored as `XXXX-XXXX-1234`; cards masked to last 4 |
| 12 | Certificate pinning (mobile) | ➖ | No mobile app exists |
| 13 | Secure local storage (mobile) | ➖ | No mobile app exists |
| 14 | Memory scrubbing | ➖ | Not achievable in PHP; the runtime owns memory and strings are immutable |
| 15 | Data loss prevention | ⬜ | No egress monitoring |

## 3. Application and API

| # | Control | Status | Evidence |
|---|---|---|---|
| 1 | Content Security Policy | ✅ | `default-src 'self'; script-src 'self'` — no `unsafe-eval` |
| 2 | CSRF tokens | 🟡 | `SameSite=Lax` + JSON-only API + bearer tokens. No synchroniser token — see "Decisions needed" |
| 3 | Secure cookie attributes | ✅ | `HttpOnly`, `Secure`, `SameSite=Lax` |
| 4 | Input validation | ✅ | Every route validates; `clip()` bounds every string |
| 5 | Parameterized queries | ✅ | 103 prepared statements; the one dynamic query builds `?` placeholders |
| 6 | XXE prevention | ➖ | **No XML is parsed anywhere** — the class of bug is not reachable |
| 7 | API rate limiting | ✅ | Global per-IP, per-route keys, login lockout, CAPTCHA throttle |
| 8 | API gateway | ➖ | Single application behind Apache; a gateway would add a hop, not safety |
| 9 | GraphQL controls | ➖ | No GraphQL |
| 10 | CORS hardening | ✅ | Explicit `allowed_origins`; never `*` |
| 11 | HTTP security headers | ✅ | `nosniff`, `X-Frame-Options: DENY`, `Permissions-Policy` — all confirmed live |
| 12 | Mass assignment prevention | ✅ | Four `*_payload()` functions whitelist every writable column |
| 13 | SSRF protection | ✅ | The only outbound call takes its URL from config, never from a request |
| 14 | IDOR mitigation | ✅ | Handlers scope by the session user's id, not a supplied id |
| 15 | Robust error handling | ✅ | `display_errors=0`; driver exceptions logged, generic text returned |
| 16 | WAF | ⬜ | None. Would sit in front of Apache |
| 17 | API schema validation | 🟡 | Hand-written per route; no OpenAPI contract |
| 18 | JWE (encrypted tokens) | ➖ | Claims are a user id, role and expiry — nothing secret to encrypt |
| 19 | HTTP parameter pollution | ✅ | PHP takes the last value; every input is read by name and bounded |
| 20 | ReDoS prevention | ✅ | No nested quantifiers found in any pattern |

## 4. Infrastructure

| # | Control | Status | Notes |
|---|---|---|---|
| 1 | Zero-trust architecture | 🟡 | Every request is authenticated regardless of origin. No device posture checks |
| 2 | Micro-segmentation | ➖ | One VPS, one app. MariaDB is already loopback-only |
| 3 | IaC scanning | ➖ | No Terraform or K8s manifests; provisioning is shell |
| 4 | Container security | ➖ | No containers |
| 5 | Kubernetes hardening | ➖ | No Kubernetes |
| 6 | Cloud IAM | ➖ | No cloud accounts. Least privilege *is* applied on the box: separate `ajspay-deploy`, `ajspay-api` and dump-only DB users, each with one narrow sudo grant |
| 7 | DDoS / L7 mitigation | ⬜ | No edge provider. Cloudflare in front would be the cheapest real win |
| 8 | NIDS / NIPS | ⬜ | ufw only |
| 9 | Immutable infrastructure | ✅ | Deploys are new release directories and an atomic symlink swap; nothing is patched in place |
| 10 | Secret management | 🟡 | Root-owned file outside the web root. Not a vault |
| 11 | VPC subnet isolation | ➖ | Single host |
| 12 | Database auditing | 🟡 | `audit_logs` and `security_events` record application actions. No MariaDB-level query log |
| 13 | Secure CI/CD | 🟡 | Deploy key is `restrict`ed and single-purpose; smoke-checked with rollback. No signed commits, no required review |
| 14 | SBOM | ⬜ | Not generated |
| 15 | CSPM | ➖ | No cloud posture to manage |

## 5. Monitoring and assurance

| # | Control | Status | Notes |
|---|---|---|---|
| 1 | SIEM | ⬜ | Logs are local files and DB tables; nothing aggregates them |
| 2 | 24/7 SOC | 🏢 | A staffed function, not code |
| 3 | User behaviour analytics | 🟡 | `modules/ai.php` scores transaction velocity and anomalies |
| 4 | Automated fraud scoring | ✅ | Runs per transaction; raises `fraud_alerts` for review |
| 5 | Out-of-band confirmation | ✅ | OTP on transfers; transaction password separate from login |
| 6 | Bug bounty | 🏢 | A commercial programme |
| 7 | Penetration testing | 🏢 | Engage a third party. **Nothing in this file substitutes for it** |
| 8 | SAST in CI | ⬜ | Real gap — see below |
| 9 | DAST | ⬜ | Not set up |
| 10 | IAST | ⬜ | Not set up |
| 11 | Incident response plan | 🏢 | Needs writing by you; who is called, what is switched off, who tells members |
| 12 | Regulatory compliance | 🏢 | `compliance.php` gates services by authorisation and enforces the 12.5% Nidhi cap. **Actual compliance is a compliance officer's judgement, not a code property** |
| 13 | Chaos / resilience testing | ⬜ | Deploy rollback is tested by use; failure injection is not |
| 14 | Responsible disclosure | ⬜ | No `security.txt` — real gap, cheap to fix |

---

## Screens that report success without doing anything

Found while wiring up the document upload. These are worse than a missing
feature: a member is told a regulated step completed when nothing was sent.

| Screen | What it claims | What happens |
|---|---|---|
| KYC documents | "Sent to Branch Compliance Officer" | ✅ **Fixed** — documents are now validated, stored and queued for review |
| Nominee registration | "Nominee updated successfully!" | ✅ **Fixed** — saved, transaction password required, old → new in the audit trail |
| Joint co-signatory | "Joint holder authorized on account!" | ✅ **Fixed** — saved, propagates to the member's accounts, removal supported |

`KycAccountPage` made **zero** API calls before this work. All three halves —
documents, nomination and joint holding — now reach the server, and the two
statutory ones are gated on the transaction password with lockout after five
wrong attempts.

## Real gaps worth fixing, in order

These are missing **code**, not missing infrastructure or missing staff:

1. **Password recovery** — there is no reset flow at all. A member who forgets their password currently has no route back in except staff intervention. Needs a single-use, time-bound, out-of-band token.
2. **`security.txt`** — one static file so a researcher who finds something knows where to send it.
3. **SAST in CI** — the deploy workflow builds and ships but never scans. `php -l`, `npm audit`, and a static analyser would catch regressions before they reach the VPS.
4. **Password strength** — length is checked, nothing else. A breached-password check against the HaveIBeenPwned k-anonymity API is a single request and leaks nothing.
5. **Concurrent session control** — no way for a member to see or end sessions on other devices.
6. **Encryption at rest** — database files and backups are unencrypted. A stolen backup is readable.

## Decisions needed from you

- **RS256/ES256 instead of HS256.** Asymmetric signing matters when something *other* than the issuer must verify tokens. Today one application both issues and verifies, so HS256 is not a weakness. It becomes one the moment a second service needs to verify without holding the signing key — which the Python port will eventually be.
- **CSRF synchroniser tokens.** `SameSite=Lax` plus a JSON-only API blocks the classic form-post attack. Adding tokens is defence in depth, not a fix for a live hole.
- **A WAF / edge provider.** Cloudflare in front of the VPS would add L7 DDoS protection, bot filtering and a WAF in one move. This is the single highest-value infrastructure change available.

## What is not true

This file does not certify anything. It records what was checked and what was
found, at one commit, by reading code and probing a live host. It is not a
penetration test, not an audit, and not a compliance opinion.
