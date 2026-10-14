# Pending tasks: audit of 14 Oct 2026

How this list was made: every backend suite was run, a new role test signed in
as all 7 roles and called every read endpoint, and every menu page was opened in
the browser for every role. Each item below is something that run found.

**Tests (run `zsh hostinger/tests/run_all.sh` with the PHP API on :8002):**

| Suite | Result |
|---|---|
| `api_test.sh`: API regression | 190 / 190 |
| `cron_test.sh`: daily jobs, interest, maturity | 31 / 31 |
| `role_smoke.sh` (new): 7 roles × 71 GET routes, every menu page, every report | 572 / 572 |
| `market_rates_test.php` | ok |
| `pyapi` pytest | 43 / 43 |
| Frontend production build | compiles |
| Browser walk: every menu page, every role | all render, guards redirect correctly |

Before this audit the API suite failed 163 of 190 tests. The tests had not been
updated after the login captcha and the separate staff sign-in were added, so
they could not sign in. The cron suite was also failing 5 of 31, from a
config-setup bug in the test itself. Both are fixed.

Work through the list top to bottom. Type **next** to fix the next open item.

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

### 8. Help Centre and per-page guide for every role  ⬜
What exists now: a first-sign-in tour (`modules/tutorial.php`) for members,
staff and the director. **Loan officers and collection agents get an empty
tour** (welcome and finish only). There is **no Help page** and no per-page
help. Plan:
- `/app/help`: a Help Centre per role, with FAQ and "how do I…" for each of that role's pages
- A **"?" Guide** button on each page that walks through that page's form fields,
  reusing the existing tour engine
- Tours for loan officer and collections
- A public `/help` page with member FAQs (before sign-in)

## Low: cleanup

### 9. Dead regulated features still in the code  ⬜
Cards, UPI, cheque book, demand draft and mutual funds are gated off but still
fully built, both front and back. Choose: delete them (smaller and safer), or
keep them gated.

### 10. Stale .md files  ⬜
- `memory/PRD.md`, `test_result.md`, `auth_testing.md`: Emergent-era, describe
  FastAPI/Mongo, cards, UPI and mutual funds, and two of them **contain the demo
  passwords**. Delete them, or replace them with a current summary.
- `docs/COMPLIANCE_AUDIT.md`: dated 14 Sep. Several of its "Missing" items are
  now built (pagination, member register, screening, interest credit, maturity),
  and it does not mention items 1–3 above. Refresh it.
- `docs/UAT_TEST_PLAN.md`: still points at `srv1983286.hstgr.cloud`, not
  `ajspay.co.in`.
- `README.md`: the pyapi status line is out of date.

### 11. Shares on auto-admission are not paid for  ⬜
A first deposit auto-admits the member with 10 shares (₹100), but no ₹100 is
collected or posted.

### 12. The API test suite wipes development data  ⬜
Its cleanup deletes the **whole** member register, all CRM data and the agents.
It should delete only the rows it created. (The run on 14 Oct emptied the local
member register and agents table.)
