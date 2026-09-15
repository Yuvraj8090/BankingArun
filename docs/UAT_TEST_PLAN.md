# AJSPay — test plan

**Site:** https://srv1983286.hstgr.cloud
**Build:** live on the Hostinger KVM 2 VPS (Mumbai)
**Entity:** Aadhunik Jeewan Sanchay Nidhi Limited — a Nidhi company, *not* a bank

Hand this to a tester with the credential sheet (supplied separately — passwords
are deliberately not committed to the repository).

---

## Before you start

- Every account has **two** secrets: a **password** to sign in, and a
  **6-digit transaction PIN** to move money. They are different on purpose.
- The session expires after **30 minutes** of a signed-in token's life.
- Five wrong passwords locks that account for 15 minutes. Five wrong transaction
  PINs blocks money movement for 15 minutes. Both are intended.
- A first sign-in opens a short product tour. Skipping it is fine; it can be
  restarted from the profile menu.

| Role | Email | Password | Txn PIN |
|---|---|---|---|
| Member (retail) | rahul.sharma@example.com | *(sheet)* | *(sheet)* |
| Corporate | tata.corp@example.com | *(sheet)* | *(sheet)* |
| Staff / teller | meera.staff@ajspay.in | *(sheet)* | *(sheet)* |
| Branch manager | manager@ajspay.in | *(sheet)* | *(sheet)* |
| Director | owner@ajspay.in | *(sheet)* | *(sheet)* |
| Loan officer | loans@ajspay.in | *(sheet)* | *(sheet)* |
| Collections | collections@ajspay.in | *(sheet)* | *(sheet)* |

---

## 1. Public site — no sign-in

- [ ] `/` loads and the page is white with blue accents
- [ ] The headline reads "Savings made simple", **not** "Banking made simple"
- [ ] Quick Services lists **five** shortcuts and does **not** offer a debit card, a SIP or bulk NEFT
- [ ] `/rates` shows the interest-rate table
- [ ] `/branches` lists branches and ATMs
- [ ] `/personal/fixed-deposits` loads normally
- [ ] `/personal/debit-cards` loads **with an amber "Not currently offered" notice at the top**
- [ ] `/investments/mutual-funds` also shows that notice
- [ ] A made-up address such as `/nothing-here` shows the "Page not found" page
- [ ] The footer states the entity is a Nidhi company, not a bank, and not DICGC insured
- [ ] The padlock in the address bar shows a valid certificate for `srv1983286.hstgr.cloud`

## 2. Sign-in and security

- [ ] The login page shows **no** example credentials anywhere
- [ ] A wrong password is refused and the message counts down the remaining attempts
- [ ] Five wrong passwords produce a lockout message rather than a sixth attempt
- [ ] The correct password signs in and lands on the right home page for that role
- [ ] The product tour appears on the very first sign-in, and **Skip all** asks for confirmation
- [ ] **Restart the tour** in the profile menu brings it back at step 1
- [ ] Signing out returns to the public site, and pressing Back does not restore the session

### Two-factor (do this on the member account)

- [ ] Security & Passkeys → set up an authenticator; the wrong password is refused
- [ ] The setup key can be typed into Google Authenticator (or any TOTP app)
- [ ] A wrong 6-digit code is refused
- [ ] The live code switches 2FA on and shows **10 recovery codes**
- [ ] Sign out, sign in again: the password alone now asks for a code
- [ ] A recovery code also works, and is then used up
- [ ] Turning 2FA off requires both the password and a live code

## 3. Member (retail)

- [ ] Dashboard shows balances, deposits and recent entries
- [ ] There is **no** "Cards & UPI" item in the menu (card issuance is not authorised)
- [ ] Transfers → a payment to another **member** account succeeds
- [ ] The reference on that payment begins `UTR-INTERNAL-`, not `UTR-IMPS-`
- [ ] A payment to an **outside** bank account is refused, explaining the authorisation is not held
- [ ] A wrong transaction PIN is refused
- [ ] An amount larger than the balance is refused
- [ ] Deposits → the page is titled "Member Deposits" with **no** mutual-fund or insurance tabs
- [ ] Booking a fixed deposit debits the account and shows a maturity value
- [ ] Loans → the EMI calculator updates as the sliders move, and an application submits
- [ ] Statements → a PDF downloads and opens
- [ ] Statements → an Excel file downloads and opens
- [ ] Standing Instructions → one can be created, paused and resumed
- [ ] Transaction history pages: 25 per page, and page 2 shows **different** rows to page 1
- [ ] Filtering history by type or date changes the results
- [ ] Support → raising a query returns a ticket number and a response deadline

## 4. Staff / teller

- [ ] Customer console shows today's figures
- [ ] Relationship Desk → Members lists members with balances and last contact
- [ ] Opening a member shows accounts, deposits, loans, tickets and contact history on one screen
- [ ] "Log a contact" with a follow-up date saves **and** says a task was created
- [ ] That task appears under **My Tasks**
- [ ] A task cannot be closed without saying what happened
- [ ] Leads → a lead can be added; the same phone number twice is refused
- [ ] A lead cannot be marked lost without a reason
- [ ] Reports → only the reports permitted to this role are listed
- [ ] Staff **cannot** open the Scheme Master, the fraud queue or the Security Centre

## 5. Branch manager and Director

- [ ] Director sees the Executive Dashboard with members, liquidity and deposits
- [ ] **Security Centre** runs and scores the deployment
- [ ] No check reports a demo password still in use
- [ ] "Seal current files" succeeds, and re-running the audit then reports the code matches
- [ ] **Fraud & AML Review** opens (it will be empty until a large transfer is made)
- [ ] Scheme Master lists nine plans with an effective annual return for each
- [ ] Plans above 12.5% are marked **above cap** and cannot be set to active
- [ ] Reports → Member register and Deposit register run, and totals appear beneath the table
- [ ] Sorting by a column changes the order
- [ ] CSV export downloads and opens in Excel
- [ ] Excel export downloads and opens
- [ ] Audit trail shows that export, naming who ran it and how many rows

### Support impersonation (Director only)

- [ ] A member's account can be opened with a reason recorded
- [ ] An administrator account **cannot** be impersonated
- [ ] While impersonating, the member's data is visible
- [ ] While impersonating, a transfer is **refused** as read-only
- [ ] "End support session" returns the Director to their own identity

## 6. Fraud detection

- [ ] As the member, transfer a large amount (say ₹1,20,000) to another member
- [ ] The transfer succeeds and the member is told **nothing** about being flagged
- [ ] As staff or the Director, the alert appears in Fraud & AML Review with its reasons
- [ ] The alert can be escalated or cleared, and the note is kept

## 7. Things that must stay blocked

- [ ] `https://srv1983286.hstgr.cloud/db.php` → **403**
- [ ] `https://srv1983286.hstgr.cloud/config.local.php` → **403**
- [ ] `https://srv1983286.hstgr.cloud/cron.php` → **403**
- [ ] `https://srv1983286.hstgr.cloud/schema.sql` → **403**
- [ ] `https://srv1983286.hstgr.cloud/modules/staff.php` → **403**
- [ ] `http://srv1983286.hstgr.cloud` redirects to `https://`
- [ ] A member signed in on one account cannot reach another member's data by changing a URL

## 8. Mobile and layout

- [ ] The site is usable on a phone: menus reachable, tables scroll rather than overflow the page
- [ ] No text is invisible or unreadable on its background on any screen
- [ ] Nothing still calls the institution a bank

---

## Known and expected

These are **not** bugs. A tester should not raise them:

- Cards, UPI, cheque books, demand drafts, outward NEFT/RTGS/IMPS, mutual funds and
  insurance are all switched off. The institution does not hold the authorisation
  for them, and the register in the code says which authority each needs.
- OTP runs in demo mode and shows the code on screen — Twilio and SendGrid keys
  have not been entered.
- Deposits show interest and maturity values; the nightly job credits them at 02:00 IST.
- The database carries a small amount of seed data, so figures are illustrative.

## How to report a problem

Say what you did, what you expected, what happened, which role you were signed in
as, and the time. If the screen showed an error message, quote it exactly.
