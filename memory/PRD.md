# PRD — AJSPay Digital Banking Web App

## Original Problem Statement
Build a comprehensive AJSPay banking app with frontend + backend deployable on Hostinger shared hosting: account opening + KYC, multi-role auth (login + txn pwd), NEFT/RTGS/IMPS/UPI transfers, cards, cheques, FD/RD, loans, investments, admin/RBI compliance, plus generation of a PHP + MySQL cPanel bundle.

Additionally per latest scope:
- Exactly 3 debit cards for retail user rahul.sharma (Visa Platinum + 2 RuPay/Mastercard dispatch-queued)
- UPI-on-Debit-Card module ("Launching Tomorrow" / pending NPCI approval)
- Multi-role RBAC panels: Bank Owner, Branch Manager, Staff, Customer, Collection, Loan Dept
- Clean white AJSPay theme — deep blue #0b3b8c + crimson #c8102e, NO orange
- Icon-heavy navigation, corporate/sober look

## Architecture
- Frontend: React + Tailwind + Shadcn UI + lucide-react
- Backend: FastAPI + MongoDB (Motor); JWT auth; bcrypt; brute-force lockout (X-Forwarded-For aware)
- Hostinger export: /api/hostinger/download-zip renders db.php + api.php + schema.sql (with real bcrypt hashes) + .htaccess + install guide

## Personas / Seeded Accounts (see /app/memory/test_credentials.md)
- retail (rahul.sharma), corporate (tata.corp), admin (manager@ajspay.in)
- bank_owner (owner@ajspay.in), staff (meera.staff), collection_agent (collections), loan_officer (loans)

## Implemented (Feb 2026)
- Full auth (register/login/me/logout/tx-pin) + brute-force lockout (5 fails / 15 min) using XFF
- CORS locked to env allow-list; no wildcard-with-credentials
- Retail card seed EXACTLY per spec: Visa 4532-9845-2109-8821 Active; RuPay 5241-7373-2160-2721 Queued; Mastercard 5241-9548-3082-4607 Queued
- Cards: freeze/unfreeze, hotlist, PIN set, limits (online/atm/intl/contactless/ecom), physical card order
- UPI module: /api/upi/status, /link-card, /qr (uri + primary UPI ID)
- Cheque book / stop cheque / demand draft
- Deposits (FD/RD), Investments (mutual funds / catalog / portfolio)
- Loans: apply, my-applications, EMI calc on public home
- Support: complaint, tickets, chat, branch locator
- Admin: overview, KYC action, RBI CTR/STR reports, audit logs
- Role Panels: bank-owner, staff, collection (+ action), loan-dept (+ decision), all RBAC-gated
- Public site (white): home hero + product grid + calculators + rate ticker + quick services; rates & charges page
- Cards page: 3 icon-heavy tiles, network badges (Visa/RuPay/Mastercard) recolored to blue+red (no orange), "Issued by Bank Only", UPI tab with "LAUNCHING TOMORROW" red badge
- Hostinger PHP export: injects real bcrypt hashes; no auth bypass in PHP login

## Prioritized Backlog
- P1: Real OTP delivery (Twilio SMS + SendGrid email) behind feature flag
- P1: Video KYC + camera document upload
- P2: WebAuthn / Passkey biometric login
- P2: PDF/Excel report export for statements & RBI filings
- P2: In-app chat with icon-based quick queries
- P3: Voice-enabled search / multi-language

## Test Credentials
See `/app/memory/test_credentials.md`.

## Phase 4 (Feb 2026) — Security & Convenience
- ✅ OTP wired for SMS (Twilio) + Email (SendGrid) — currently MOCKED (LIVE_OTP=false); flip .env flag + drop in keys to go live
- ✅ WebAuthn passkeys — register, list, delete, and biometric login flow (Fingerprint / Face-ID / Security key)
- ✅ Video KYC — webcam capture (Selfie → PAN → Aadhaar) with liveness word + admin review queue with approve/reject
- ✅ Statement export — one-tap PDF (reportlab) and Excel (openpyxl), RBI header, TDS notes, date filters, quick-range chips

## API additions
- `/api/otp/send`, `/api/otp/verify`
- `/api/passkey/{list,register/challenge,register/complete,login/challenge,login/complete}`, `DELETE /api/passkey/{id}`
- `/api/kyc/video/{submit,queue,{id},decision}`
- `/api/statements/{pdf,excel}`

## New frontend pages
- `/app/frontend/src/pages/VideoKycPage.js`, `VideoKycQueuePage.js`, `SecurityPage.js`, `StatementsPage.js`
- Passkey button added to AuthPage login form (`data-testid="passkey-login-btn"`)

## Phase 5 (Feb 2026) — Rewards, Automation, AI & Super-Admin
- ✅ Refer & Earn — personal code + shareable link (`/?ref=CODE`), ₹500 auto-credited to both parties on new-account KYC. `/api/referrals/my-code`, `/history`; `register` accepts `referral_code`.
- ✅ Standing Instructions — full CRUD + pause/resume for rent/SIP/EMI/insurance auto-debits. `/api/standing-instructions/*`.
- ✅ AI Face Match — histogram-cosine similarity between selfie & PAN photo runs automatically on video KYC submit; ≥ threshold auto-approves and marks user verified. `/api/kyc/video/{id}/face-match`.
- ✅ Super-Admin Runtime Config (bank_owner only) — Twilio SID/token/from, SendGrid key/from, referral reward, face-match threshold, live_otp toggle. Values stored in `db.system_config`, fallback to `.env`. `/api/admin/config` GET/PUT.
- ✅ AuthPage — fully rewritten in white theme, two-column brand + form, passkey button, referral field auto-fills from `?ref=` URL param, and root URL auto-opens Open Account tab on referral.

## Backlog (Phase 6+)
- Bulk SI processor cron
- Real face-recognition (dlib / cloud) behind feature flag
- Multilingual UI (Hindi/Tamil/Telugu)
- WhatsApp for Business channel for OTPs + alerts
