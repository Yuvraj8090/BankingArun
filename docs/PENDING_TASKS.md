# Pending tasks: checked 15 Oct 2026

How this list was made: every backend suite was run, a new role test signed in
as all 7 roles and called every read endpoint, and every menu page was opened in
the browser for every role. Each item below is something that run found.

**Latest checks (15 Oct; run `zsh hostinger/tests/run_all.sh` with the PHP API on :8002):**

| Suite | Result |
|---|---|
| `api_test.sh`: API regression | 281 / 281 |
| `cron_test.sh`: daily jobs, interest, maturity | 44 / 44 |
| `role_smoke.sh`: role, menu and report checks | 534 / 534 |
| `market_rates_test.php` | ok |
| `pyapi` pytest | 43 / 43 |
| Frontend production build | compiles |
| Referral demo calculation / access check | passes (`cd frontend && CI=true npm test -- --watchAll=false --runInBand`) |
| Browser walk: every menu page, every role | passed in the original 14 Oct audit |

Before this audit the API suite failed 163 of 190 tests. The tests had not been
updated after the login captcha and the separate staff sign-in were added, so
they could not sign in. The cron suite was also failing 5 of 31, from a
config-setup bug in the test itself. Both are fixed.

Work through the list top to bottom. Type **next** to fix the next open item.

## Current open work
- FIU-IND upload/submission files are still missing. CTR/STR figures are built;
  they are not validated FINnet submission files.
- NDH figures: fixed 16 Oct (item 24). The completed MCA e-forms are still
  filed by hand on the MCA portal; the report gives the figures to copy in.
- The new five-level referral feature is a Director-only simulation. Live
  deposit commissions remain disabled under Nidhi Rule 6(k). Demo Silver/Gold
  thresholds are editable examples, not agreed business rules.
- Historical ₹500 bonus reversals and removal of old tables remain deferred.

---

## Critical: legal exposure (Nidhi Rules, 2014)

### 1. Five ACTIVE deposit plans are above the 12.5% cap  ✅ done 15 Oct
The app's own calculator gives these effective annual returns. Each plan's
status is still `active`:

| Plan | Effective p.a. |
|---|---|
| AJS-MIS-40M Dainik Aay 40 Month (doubles in 40 months, daily credit) | **30.42%** |
| AJS-MIS-5Y Niyamit Aay 60 Month MIS | **18.71%** |
| AJS-FD-8Y Savadhi 3x in 8 years | **14.72%** |
| AJS-12M-6Y Dwigun Yojana | **13.31%** |
| AJS-SL-21Y Shubh Lakshmi payout at 21 | **12.75%** |

The scheme screen refuses to activate an over-cap plan, but these were switched
on directly in the database by migrations. Fix: enforce the cap at **booking**
time as well, so the database state cannot bypass it, and move these plans to
draft. **Your decision is needed:** what happens to deposits already booked on
them (they keep being credited daily).

### 2. Referral bonus pays ₹500 cash to both people  ✅ done 15 Oct
`modules/banking.php` credits `REFERRAL_BONUS` to the referrer and to the new
member. This is an incentive for bringing in members and deposits, which Rule
6 prohibits. The code comments even say "no code here moves money", but this
code does. Fix: stop the credit and rename "Refer & Earn" to "Invite a member".

**Done:** `record_referral()` replaces the bonus. It records the introduction (the
tree and the ladder still work) and credits nobody. The `referral_reward_amount`
parameter is removed (migrate.sql), and the menu item, page, sign-up and CRM copy
no longer promise money. Bonuses paid before today are left as they were; reversing
them is your decision.

### 3. MLM structure already exists in the member app  ✅ done 15 Oct
- **Refer & Earn** shows a 12-level commission % table, a downline "tree" and
  the line "₹2,500 earned".
- **My Standing** shows a 10-rung rank ladder (Silver to Brand Ambassador) and a
  "Booster" programme: "MIS 6% monthly after 2 direct members", "7% monthly
  after 4", "Pool 2x payout then exits".

No payout code runs, but **advertising** returns that depend on recruiting is
the offence under the Prize Chits & Money Circulation Schemes (Banning) Act,
1978 and the BUDS Act, 2019. A Nidhi cannot pay commission on deposits, and
"6% monthly" is about 72% a year.

**About the MLM tab you asked for:** a commission-paying MLM tab cannot be built
legally for a Nidhi company. What can be built is one **"My Network"** tab that
merges Refer & Earn and My Standing. It would show who you introduced and a
recognition-only rank, with no money, no percentages and no rate boosters. The
plans themselves stay in Deposits. Decide before item 3 is done (or get legal
advice in writing first).

**Done (your decision: My Network, no money):** Invite a Member and My Standing are
merged into one **My Network** tab: invite link, people introduced, the tree, and the
recognition ladder. Removed: the 12-level commission table, the plan illustration,
the turnover programmes (`/referrals/structure`), the Booster programme (rows
soft-deleted in migrate.sql) and the ₹ reward field on ranks. The `reward_programmes`
and `reward_slabs` tables are now unused and can be dropped later.

## High: wrong or misleading in the app

### 4. "KYC Verification" (staff) and "Applicant KYC" (loan officer) open the officer's own KYC page  ✅ done 15 Oct
They show "Upload Verified KYC Documents" for the signed-in officer instead
of a queue of members to verify.

**Done:** for staff, managers and the Director the KYC tab is now the verification
queue, and tellers may use the queue and document review (`CRM_ROLES`). The loan
officer's "Applicant KYC" item is removed. Also fixed: Reject used to save the stock
reason "Incomplete document signature" and now asks for the real one, and the
approve-and-fund plan list no longer offers over-cap plans.

### 5. Collections dashboard shows fake numbers  ✅ done 15 Oct
`modules/staff.php:76` hardcodes the recovery target ₹1,25,00,000 and the
recovered amount ₹48,20,000. Fix: compute them from `collection_cases` or remove the tile.

**Done:** nothing records loan recoveries, so the tile is removed. The same
problem was in the branch manager's **statutory compliance** box: "NOF ₹25 lakh",
"1:18", "11.2%" and "Compliant" were all typed in. `nidhi_statutory_checks()` now
works them out from the books. NOF comes from a new **Net owned funds** Business
Parameter (enter it from the audited balance sheet). The ratio and the
members-only check are computed. The 10% unencumbered rule says "not tracked".

### 6. Corporate role does not fit a Nidhi  ✅ done 15 Oct
Nidhi members must be individuals, and current accounts are prohibited. The
corporate login still shows "Bulk Transfers", "Treasury", "Trade Finance", a
"Current" account, and a public page `/corporate/trade-finance`. Fix: retire the
corporate role from sign-up and the menus, and unpublish the trade-finance page.

**Done:** corporate accounts already could not be created. The separate corporate
menu is removed, so the one legacy demo login gets the member menu. Twelve public
pages for things a Nidhi may not offer are set to draft (migrate.sql) and removed
from the navbar, footer, homepage tiles, quick links and the bundled fallback:
corporate (5), mutual funds, gold bonds, insurance, debit cards, and personal,
vehicle and education loans. The public site now offers savings, salary, FD, RD,
gold loan and home loan. The legacy bulk-payout route goes with item 9.

### 7. Banking language still on member screens  ✅ done 15 Oct
- Transfers: "IMPS (24x7) | NEFT | RTGS", "Corporate Payout Hub"
- Dashboard: "Quick Indian Banking Services → NEFT / RTGS Transfer, Find ATM & Cash Deposit Machine"
- Loans: "Personal, Home, Car Loans | Instant Pre-Approval". A Nidhi lends only against gold, property, FDs, NSC/KVP or insurance policies.
- Standing Instructions: "Automate rent, SIPs, EMIs and insurance premiums"
- Branch locator: "24x7 Cash Dispensers, Locker Facilities, CDM"
- Owner dashboard heading "BANK OWNER"

**Done:** without the payment-systems authorisation, Transfers is now "Pay a
Member" with no IMPS/NEFT/RTGS mode, IFSC, UPI or bulk-payout controls, and the
default remark is "Member transfer". Dashboard shortcuts, the locator (ATM/CDM
filters and badges removed; lockers kept, since a Nidhi may offer them), Standing
Instructions, the home page, chatbot prompts, "Branches" menu labels and the
"DIRECTOR" badge are all updated. **Loans now accept gold and home only**, checked by
the API (`NIDHI_LOAN_TYPES`). Also fixed: the dashboard's branch shortcut pointed
to a tab that does not exist.

## Medium: guides and help (your request)

### 8. Help Centre and per-page guide for every role  ✅ done 15 Oct
What exists now: a first-sign-in tour (`modules/tutorial.php`) for members,
staff and the director. **Loan officers and collection agents get an empty
tour** (welcome and finish only). There is **no Help page** and no per-page
help. Plan:
- `/app/help`: a Help Centre per role, with FAQ and "how do I…" for each of that role's pages
- A **"?" Guide** button on each page that walks through that page's form fields,
  reusing the existing tour engine
- Tours for loan officer and collections
- A public `/help` page with member FAQs (before sign-in)

**Done:**
- **Guide button** in the top bar on every page. It opens that page's guide: what
  the page is for, the steps, and what each form field wants.
- **Help Centre** at `/app/help`, from the profile menu and the sidebar. It holds the
  guide for every page your role can open, plus FAQs for members, staff and the
  Director.
- **Public `/help`**, with membership FAQs, linked in the footer.
- **Tours** for loan officers and collection agents. Every tour now ends on the
  Guide button.

All the content lives in `frontend/src/data/help.js`. `role_smoke.sh` fails if
any menu page has no guide.

## Low: cleanup

### 9. Dead regulated features still in the code  ✅ done 15 Oct
Cards, UPI, cheque book, demand draft and mutual funds are gated off but still
fully built, both front and back. Choose: delete them (smaller and safer), or
keep them gated.

**Done (your decision: delete):**
- **Removed:** the routes, handlers, Cards page, dashboard card widget, UPI and
  bulk-payout tabs, the mutual-fund and insurance sections, API client methods, and
  their capability switches (PHP and pyapi).
- **Also found and removed:** account opening still **issued a virtual debit card to
  every new member**, and `/accounts` returned cards.
- **Chatbot:** it now gives one honest "not offered" answer for these, and its
  wrong answers are fixed (IMPS/NEFT limits, personal and vehicle loans, bank IFSC
  codes, and a helpline that did not match the app's).
- **Statements:** they say "Branch code" instead of "IFSC".
- **Kept:** Payment Rails and the `upi` / `payment_systems` switches for a future
  sponsor-bank tie-up. The database tables (cards, investments and so on) and
  their old rows are kept; dropping them is a separate call.

### 10. Stale .md files  ✅ done 15 Oct
- `memory/PRD.md`, `test_result.md`, `auth_testing.md`: Emergent-era, describe
  FastAPI/Mongo, cards, UPI and mutual funds, and two of them **contain the demo
  passwords**. Delete them, or replace them with a current summary.
- `docs/COMPLIANCE_AUDIT.md`: dated 14 Sep. Several of its "Missing" items are
  now built (pagination, member register, screening, interest credit, maturity),
  and it does not mention items 1–3 above. Refresh it.
- `docs/UAT_TEST_PLAN.md`: still points at `srv1983286.hstgr.cloud`, not
  `ajspay.co.in`.
- `README.md`: the pyapi status line is out of date.

**Done:** `memory/PRD.md`, `test_result.md` and `auth_testing.md` are deleted.
`COMPLIANCE_AUDIT.md` opens with a status update checked against the code: what is
built now, and what is still missing (re-KYC, beneficiaries, passbook, FIU XML,
NDH returns). The UAT plan points at ajspay.co.in and checks the new behaviour. The
README has the correct pyapi status and how to run the tests.
`memory/test_credentials.md` stays, because the test suites read it. It holds
**demo** passwords only; production must never use them, and Security Centre checks
for that.

### 11. Shares on auto-admission are not paid for  ✅ done 15 Oct
A first deposit auto-admits the member with 10 shares (₹100), but no ₹100 is
collected or posted.

**Done:** auto-admission takes the ₹100 from the member's account in the same
transaction as the folio. It appears on their statement as "Share Allotment"
("Shares" in the PDF). Admission now happens only after the plan and the amount have
passed, and only if the account covers both the deposit and the ₹100, so a refused
booking charges nothing. Counter admissions are unchanged (the teller takes cash).
**Your decision:** members auto-admitted before today got their shares without
paying. Collecting that ₹100 from them retroactively is not done.

### 12. The API test suite wipes development data  ✅ done 15 Oct
Its cleanup deletes the **whole** member register, all CRM data and the agents.
It should delete only the rows it created. (The run on 14 Oct emptied the local
member register and agents table.)

**Done:** `api_test.sh` snapshots the dev database before it starts and restores it
on exit, including on a failure or Ctrl-C, so a run leaves the data exactly as it
found it (proved with a marker row in a table the suite empties). The local rows
deleted by earlier runs had no seed and cannot be rebuilt. They were local test data
only.

---

## Round 2 (15 Oct): plans and deposits

### 13. Every plan bookable by members and by staff  ✅
Before this round, members could book only a generic FD, a generic "RD" (which
took the whole amount up front) and the monthly-income plans. Staff could book one
MIS plan and one daily plan. Most plans (Masik, Daily Yojana, Shubh Lakshmi,
Dwigun, Savadhi) could be booked only during account opening. Now one shared
`PlanPicker` lists **every** live plan, grouped by type, on both the member's
Deposits page and the teller's Book Member Deposit page. It shows the right amount
control for each type, live FD rates from Business Parameters (no more typed-in
rates), and a summary of what is taken today and what the member gets. The false
"senior citizen +0.50%" promise is removed.

### 14. Instalment plans actually collected  ✅
Booking took only the first instalment. Nothing collected the rest, yet maturity
paid the **full** amount. Now:
- deposits record `paid_amount`, `instalment_amount` and `instalment_every`
  (backfilled in migrate.sql);
- the nightly `run_instalments` takes due and overdue instalments from savings,
  and retries the next night when the balance is short;
- maturity pays in proportion to what was paid in;
- early closure of instalment plans works, using what was paid;
- reports use the real paid figure.

### 15. Over-cap plans re-priced to 12.5% (your decision)  ✅
`reprice_scheme_to_cap()` keeps each plan's name, tenure and amounts and lowers
what it pays to the cap, rounded down. It runs nightly, and Scheme Master has a
"Re-price to 12.5%" button. All 16 plans are now within the cap and live. Also
fixed: monthly-income plans were rated without counting the principal returned at
maturity, so their true return was understated (Niyamit Aay 5Y showed 18.71% but
paid about 30%).
**Your call:** "Savadhi Yojana 3x in 8 years" and "Dwigun … doubles by year 6"
no longer triple or double. Rename them so the name doesn't promise it.

### 16. Plan creation form follows the plan type  ✅
The Type dropdown explains each kind of plan and drives the form. Fixed, RD and
daily plans pay at maturity; MIS chooses monthly payout or daily interest. Only
the fields that type needs are shown, and "Generate table" now works for
instalment plans. The server refuses mismatched type and payout combinations.

---

## Round 3 (15 Oct)

### 17. Plan names  ✅
"Savadhi Yojana 3x in 8 years" is now **Savadhi Yojana 8 Year**, and "Dwigun Yojana
(12 instalments, doubles by year 6)" is now **Dwigun Yojana 6 Year (12 instalments)**.
**Found while doing it:** 20 statements in migrate.sql rewrote every plan back to
its brochure figures **on every deploy**. That silently wiped Scheme Master edits, and
it would have undone the 12.5% re-pricing. Each now touches only a plan nobody has
changed since 15 Oct.

### 18. Real notifications; members told about rates and instalments  ✅
The bell showed typed-in text. `GET /notifications` now works out real items per
role:
- **Members:** deposits re-rated to 12.5% (interest already credited is kept),
  instalments due tonight, the next instalment date, KYC not verified, KYC review
  due, and support replies.
- **Staff:** KYC waiting, KYC reviews due, open grievances, fraud alerts, loans
  waiting, and cases past 90 days.
- **Director:** plans above the cap, and net owned funds not entered.

### 19. Periodic re-KYC  ✅
The review date already set by risk rating (2/8/10 years) is now acted on. A
**KYC reviews due** report lists overdue and due-in-30-days members, staff get a
notice, and each member gets their own reminder.

### 20. NOF limit enforced  ✅
New money (counter cash, account opening, funding at KYC) is refused if it would
take deposits above 20 × net owned funds. It applies once the Director enters NOF
in Business Parameters.

### 21. Loan accounts, EMIs, collections  ✅
Disbursing used to only change a status label: no money moved and no loan
existed. Now:
- **Approvals follow the proper order.** Each decision can only follow the ones
  before it (under review → documents → approved → disbursed). Rejected and
  disbursed are final, and unsecured loan types can't be approved or paid out.
- **Disbursal is real.** It requires a KYC-verified member, credits the principal
  to their savings, and writes a reducing-balance EMI schedule (`loans`,
  `loan_emis`).
- **EMIs are collected nightly.** `run_loan_emis` takes due EMIs from savings and
  tracks days past due; at 90 days the loan is NPA.
- **Members manage their loan.** The Loans page shows what's owed, the next EMI,
  a "Pay EMI now" button and the schedule. EMI reminders appear in the bell.
- **Collections works real overdue loans** instead of typed-in demo cases. The
  loan desk shows the real outstanding book and NPA %.
- **Fake ratio removed.** The branch dashboard's "CRR 4.5% · SLR 18% · Basel III"
  tile is now the real NOF : deposits ratio.

### 22. Regulatory returns, passbook, saved payees, share money  ✅
- **FIU-IND CTR:** members whose cash paid in reached ₹10 lakh in a month, ready
  for the Principal Officer to key into FINnet by the 15th.
- **FIU-IND STR:** the register of escalated fraud alerts, with reasons, for
  filing within 7 days.
- **NDH-1 / NDH-3 figures:** members, share capital, savings / fixed / recurring
  deposits, gold and property loans, NPA, net owned funds and branches, as at
  today. Run it on the period's last day. These are reports in Reports, and
  exports are audited.
- **Passbook:** Statements has "Full passbook (since opening)" for PDF or Excel.
  Also fixed: "This financial year" used to mean the last 365 days; it now starts
  from 1 April.
- **Saved payees with a cooling-off period:** payments above ₹25,000 go only to a
  payee saved 24 or more hours earlier. When saving, the member sees a masked
  name to confirm the account. Adding a payee is logged as a security event.
- **Unpaid share money:** the member register flags folios admitted by an
  automatic deposit before share money was taken, and "Collect share money"
  takes the ₹100 from savings, once.

## Round 4 (15 Oct): referral demo and version check

### 23. Five-level referral demo, editable plans and Silver / Gold ✅
Director → Member Standings → **Five-level referral demo**:
- Defaults to 5% of the amount received for each of five ancestors: 25% total.
  Signup alone allocates ₹0; the old ₹500 signup bonus stays disabled.
- FD, RD and MLM-labelled fictional plans, with a form to add or edit names,
  types and all five percentages. RD uses only the instalment received now.
- Reuses the existing network chart for a binary path through five ancestors,
  with empty right positions. No pair-matching or spillover payout is assumed.
- Silver/Gold follow cumulative simulated earnings. Initial example thresholds
  are ₹500 / ₹2,500 and are editable; rank does not override the plan percentage.
- Plans and thresholds save in this browser. Simulated totals reset on leaving
  the page. No booking, balance, referral record or live rank is changed.
- Amounts and percentages are validated, combined percentages cannot exceed
  100%, and individual allocations round down to paisa.

At the start of this check, the live `version.txt` and local `HEAD` both pointed
to `8bcc1e53a5909ca2bb68a8d0dc861a3d9dbcca0b`; there was no version mismatch.
Also corrected stale deployment instructions: the existing deployment script
already applies migrations after a backup and before swapping releases.

## Round 5 (16 Oct): past NDH figures

### 24. NDH-1 / NDH-3 figures for a past date ✅
The report only showed today, so 31 March could not be reported once it had
passed. Now cron.php stores the day's figures in `ndh_snapshots` at every run
(the 21:30 IST run is the one a date keeps). Reports → Nidhi return figures
shows today live plus every recorded day; filter by date, or set **Period** to
"half-year ends" for 31 March and 30 September only. History starts from the
first night this is deployed; earlier dates cannot be rebuilt.

Tests: api 281/281, cron 44/44, role smoke 534/534, pyapi 43/43, frontend
tests and build pass.

### 25. Deposit slip, 3.75x plan, rate-driven plan form, staff help bot ✅
- **Deposit slip:** after a counter deposit or a staff booking, a printable slip
  (member, account, amount, plan, deposit number, maturity, date/time, cashier)
  with signature lines. Built by the server from what was recorded.
- **AJS-FD-135M:** every ₹8,000 → ₹30,000 (₹16,000 → ₹60,000 …, up to ₹2 lakh).
  Asked for over 10 years, but that is 14.1% a year, above the cap; at 135
  months (11 years 3 months) it is 12.47%. A 10-year version could pay at most
  ₹25,978 per ₹8,000.
- **Plan form:** type the interest % a year, tenure and amounts; deposit and
  maturity per amount are worked out (same model as the server's cap check).
  Early withdrawal: after 30 days, locked N months, or locked until maturity.
- **Staff help bot:** "Ask AJS Assistant" for staff and directors answers from
  the page guides with Claude. Needs `anthropic_api_key` in config.local.php on
  the server; without it the bot answers by searching the guides in the browser.
- Live referral commissions on deposits stay off (Nidhi Rule 6).

### 26. Duplicates and dead code removed; support tickets given a screen ✅
- **Support tickets:** the server had a full ticket system but no screen, so
  members could not raise a query and the Grievance Queue could never fill.
  Now: members → Help & Support (raise, follow replies, escalate to the
  grievance officer); staff → Support Tickets (queue, reply, internal notes,
  take, resolve with a note).
- **Wrong phone numbers:** the home page dialled a placeholder 1800 number and
  called the helpline "toll-free"; the sign-in footer showed the placeholder.
  All company details now come from `frontend/src/data/company.js`.
- **Owner menu** grouped into sections; Collections → Loan Recovery, Agents &
  Collections → Field Agents (cash collected).
- **Removed:** 46 unused UI-kit files, the unused toast hook, 44 unused npm
  packages, 5 unused API client calls, an unused PHP password helper.

### 27. Plans missing from the live site; fake numbers and buttons ✅
- **5 plans hidden on ajspay.co.in** (Savadhi 8 Year, both MIS plans, Dwigun 6
  Year, Shubh Lakshmi 21): still priced above 12.5% on the server, so the public
  list hid them. Re-pricing now runs first in the nightly job (a failure in an
  earlier job used to skip it) and once on every deploy (`cron.php --reprice-only`).
- **Owner dashboard rate tiles** were fixed numbers in the code (savings 4%,
  FD 8%, personal loan 10.5%). They now show the real Business Parameters, and
  the button opens that page instead of a fake "sent for approval" message.
- **Fake buttons** ("+ Add Branch", statutory "Export CSV", teller "Assist")
  now open the real pages.
- **Removed settings** for products a Nidhi does not offer: personal and vehicle
  loan rates, demand-draft fee, card limit. "Home loan" is now "Property loan".
- **Brochure (ADHUNIK PDF) checked:** every plan and denomination is in the
  system. Not added: the commission, turnover-incentive and "fix monthly
  income" pages (Nidhi Rule 6, Money Circulation Schemes Act), the land
  investment offer (not a Nidhi activity), and the 5-month weekly loan as
  printed (no security shown; a Nidhi lends only against gold, property or
  the member's own deposits).

### 28. Loan against the member's own deposit ✅
Nidhi Rules rule 15 allows lending against the member's deposits; the brochure's
"loan facility" now has a lawful form. Loans → **Against my deposit**:
- Up to 90% of what has been paid into an active deposit (Business Parameters:
  "Loan against deposit, most lent"), at "Loan against deposit rate" (9.5%).
- Repaid within the time the deposit has left; one loan per deposit.
- While the loan or application is open the deposit cannot be closed early.
- At maturity the loan is repaid from the proceeds before they are spendable.
- The loan desk sees which deposit secures each application; NDH figures count
  deposit loans separately.

### 29. Sample branches on the public locator; other leftovers ✅
- **The live branch locator listed five sample branches** (Nariman Point,
  Bandra Kurla Complex, Connaught Place, Koramangala, Hitech City) with ATMs.
  The two whose codes members' accounts carry are now the real Corporate Office
  (Chhutmalpur) and Registered Office (Fatehpur Bhado); the other three are
  removed (and pyapi, which serves the live locator, now skips removed ones).
  Opening hours and map position are blank: fill them in under Branch Network.
- ATM / cash-machine options removed (a Nidhi has neither); lockers kept.
- Standing instructions to a non-member account are refused at setup instead
  of failing every night; the IFSC field is hidden.
- Every member's KYC page showed "Electricity Bill - Arya Nagar, Chhutmalpur"
  as their address proof; it now shows what they actually uploaded.
- "24×7 Toll-Free" label on the home page fixed.

### 30. Public product pages promised what the system does not do ✅
- Savings: "4% interest, credited every quarter" (no savings interest is paid).
  Now says so, and points to deposit plans.
- Salary Account (free cheque book): hidden.
- FD: "7 days to 10 years", "+0.50% for senior citizens" (neither exists).
  Now the real tenures, the 12.5% cap and the live rate card.
- RD: "6 to 60 months at FD rates". Now plan-based, as the system books them.
- Home loan: balance transfer, 30 years, NetBanking. Now "Loan Against
  Property", up to 20 years.
- Grievance: "toll-free, 24×7". Now Help & Support → grievance officer.
- New page: Loan Against Deposit. Home page FD calculator reads the live rate
  card instead of page text.
- Only pages still holding the original text were changed; anything edited
  under Public Pages is untouched.
- To check: the footer email support@ajspay.in (the site is ajspay.co.in).

### 31. Messages, Claude key, leftover pages, gold pledge register ✅
- OTP SMS/emails name the company, say what the code is for, and warn that
  staff never ask for it; emails carry the company footer.
- System Config → "Staff help bot (Claude)": the owner pastes the Anthropic key
  (stored encrypted, shown masked) and the model.
- 13 hidden draft pages for products a Nidhi cannot offer removed.
- Gold pledge register: Loan Pipeline → coins button on a gold application.
  Items, net weight, purity and today's 24K rate → value and the most that can
  be lent (75%, Business Parameters "Gold loan, most lent"). A gold loan cannot
  be approved or paid out without it, or above it. Printed receipt; jewellery
  marked returned only after the loan is repaid (or the application rejected).

## Not done, deliberately
- **Reversing ₹500 referral bonuses already paid.** Taking money back out of
  members' accounts without their agreement needs a decision, and legal advice.
- **Dropping the old card and investment tables.** No code reads them any more,
  so they are inert. Dropping them would permanently delete records you may need
  for audit; archive them first if you want them gone.
- **Live MLM / binary deposit commissions:** disabled under Nidhi Rule 6(k).
  The Director's fictional demo is separate from live banking.

## Earlier "Still open" list (kept for history)
- FIU-IND submission files (CTR/STR XML), NDH-1/NDH-3 returns, passbook printing,
  and beneficiary (saved payee) management.
- **Your decisions:**
  - collect ₹100 share money from members auto-admitted earlier;
  - reverse ₹500 referral bonuses already paid;
  - drop the old card and investment tables.
- **MLM / binary commission plan:** not built. It is illegal for a Nidhi (Nidhi
  Rules Rule 6; Prize Chits & Money Circulation Schemes (Banning) Act, 1978).
