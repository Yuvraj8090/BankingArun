# Compliance and feature audit

**Entity:** Aadhunik Jeewan Sanchay Nidhi Limited (CIN U65990UP2019PLN121746)
**Application:** AJSPay — React web front end, PHP 8 + MySQL back end
**Audited:** 14 September 2026, against the code in this repository
**Auditor:** engineering review. This is not legal advice. Every regulatory
position below must be confirmed with counsel or the regulator before you rely
on it.

## Status update: 15 October 2026

The audit below is the 14 September baseline. Since then, checked against the code:

| Item | Then | Now |
|---|---|---|
| Member and share register (Rule 11) | Missing | **Implemented**: register, share ledger, minimum 10 shares, auto-admission on first deposit |
| Customer risk categorisation | Missing | **Implemented** on admission |
| Sanctions / PEP screening | Missing | **Implemented**: watchlists, screening runs, hit review, a confirmed match blocks transacting |
| Principal Officer, Designated Director, Grievance Officer | Missing | **Implemented**: named in System Config, shown on the privacy notice |
| DPDP notice, consent, data-principal requests | Missing | **Implemented**: privacy notice, consent, Data Requests queue with deadlines |
| Grievance escalation and SLA | Partial | **Implemented**: Grievance Queue, 30-day clock |
| Pagination | Missing | **Implemented**: shared `paginate()` (25 a page, up to 100) |
| Interest credit and maturity | Missing | **Implemented**: daily, monthly and maturity jobs in `cron.php`, with TDS |
| Deposit cap at 12.5% | Activation only | **Enforced at every booking**. Active over-cap plans are closed and hidden, and existing over-cap deposits are re-rated to 12.5% nightly |
| Referral bonus (₹500 each side) | Paid in cash | **Stopped**: introductions are recorded and credit nobody |
| 12-level commission table, booster programme | Displayed to members | **Removed**. "My Network" shows the tree and a recognition-only ladder |
| NOF and NOF : deposits | Typed-in strings | **Computed** from the books, with NOF as a Business Parameter. Shown, not yet enforced at booking |
| Corporate role, current account, cards, investments, unsecured loans | Live on the public site | **Unpublished**. Loans accept gold and home only (API-enforced) |
| CVV storage | Non-compliant | **Not in the schema** |
| Periodic re-KYC cycle | Missing | Still missing |
| Beneficiary management with cooling-off | Missing | Still missing (internal transfers only) |
| Passbook issue / printing | Missing | Still missing (PDF/Excel statements exist) |
| CTR/STR in FIU-IND submission format | Partial | Still partial: on-screen reports and exports, no FIU XML |
| NDH-1 / NDH-3 returns | Missing | Still missing |
| 10% unencumbered term deposits | Displayed | Reported as "not tracked": there is no treasury book |

The live task list is `docs/PENDING_TASKS.md`.

---

Status vocabulary used throughout:

| Status | Meaning |
|---|---|
| **Implemented** | Present, exercised by an automated test, works |
| **Partial** | Present but incomplete in a way that matters |
| **Missing** | Not built |
| **Gated** | Built, but deliberately switched off until authorisation is recorded |
| **N/A** | Does not apply to this entity type |

---

## 0. The finding that reframes the whole audit

The audit was requested against the Banking Regulation Act, 1949 and RBI
guidelines. **Those apply to banking companies. This entity is not one.**

Aadhunik Jeewan Sanchay Nidhi Limited is a Nidhi company under section 406 of
the Companies Act, 2013, regulated by the Ministry of Corporate Affairs through
the Nidhi Rules, 2014. It holds no banking licence under section 22 of the BR
Act. It is not an NBFC registered with the RBI either — Nidhis are specifically
exempted from most RBI registration requirements while remaining subject to
RBI's deposit-rate ceiling.

Three consequences:

1. **Most of the BR Act does not bind you** — but that is not good news. It
   means you also may not do most of what a bank does. A Nidhi may take deposits
   from its **members only**, lend to its **members only**, against the security
   the Rules permit. It may not issue cards, run UPI, join NEFT/RTGS/IMPS, issue
   cheques or demand drafts, or deal with the public.
2. **The application was built as though you were a bank.** Cards, UPI, NEFT,
   cheque books and demand drafts were all fully implemented and live to
   members. As of commit `6587936` they are gated off (section 2).
3. **If you intend to become a bank, this is a different project.** A banking
   licence under section 22 BR Act requires minimum paid-up capital in the
   hundreds of crores, RBI fit-and-proper scrutiny of promoters, and a licensing
   process measured in years. Nothing in this codebase is the blocker.

---

## 1. Legal and regulatory compliance

### 1.1 Banking Regulation Act, 1949 — **N/A, and deliberately so**

| Element | Status | Observation |
|---|---|---|
| Section 22 banking licence | N/A | Not a banking company; no licence held or applied for |
| Use of "bank"/"banking" in name or branding | **Partial** | Section 7 BR Act restricts these words to licensed banks. The UI still says "NetBanking", "Core Banking Ledger", "Bank Owner". The legal name and footer are correct, but the product language is not |
| Deposit insurance (DICGC) | **Implemented** | Correctly disclosed as *not* insured |

**Corrective action (high):** rename user-visible "banking" language. "NetBanking
Overview" → "Member Portal"; "Bank Owner" role label → "Director"; "Core Banking
Ledger" → "Member Ledger". The legal entity name and disclaimer are already
right; the surrounding vocabulary is not.

### 1.2 Nidhi Rules, 2014 — the rules that *do* bind you

| Element | Status | Observation |
|---|---|---|
| Members-only deposits and lending | **Partial** | Enforced by role in practice, but there is no formal *member register* and no share-allotment record. Rule 11 requires a Nidhi to allot at least 10 equity shares (₹10 each) to every depositor |
| 12.5% deposit interest ceiling | **Implemented** | Scheme master computes each plan's true effective annual return by bisection and refuses to activate anything above 12.5%. Plan-book schemes above the cap load as drafts |
| No brokerage or incentive for mobilising deposits | **Implemented** | Agents are tracked for traceability; no commission is calculated or paid anywhere in the codebase |
| Net Owned Funds ≥ ₹20 lakh | **Partial** | Displayed on the executive dashboard, but computed from seed data, not from a real capital account |
| NOF : deposits ratio 1:20 | **Partial** | Same — displayed, not enforced. Nothing blocks a deposit that would breach it |
| 10% unencumbered term deposits | **Partial** | Displayed only |
| No current accounts | **Implemented** | Marked permanently un-enableable in the capability register, citing Rule 6 |
| Branch restrictions (Rule 10) | **Missing** | No control on branch count or district |
| Annual return NDH-1 / NDH-3 filings | **Missing** | No statutory return generation |

**Corrective action (critical):** build a member and share register. Without it
you cannot demonstrate that deposits came from members, which is the single
foundation of Nidhi compliance. Everything else is secondary.

**Corrective action (high):** make NOF ratios *enforcing* rather than
decorative — refuse a deposit that would breach 1:20, and warn as it approaches.

### 1.3 PMLA, 2002 and FIU-IND reporting

| Element | Status | Observation |
|---|---|---|
| CTR (cash/high-value ≥ ₹10 lakh) | **Partial** | Report generated on demand from transaction data; no monthly filing workflow, no XML output in FIU-IND format |
| STR (suspicious transactions) | **Implemented** | AI module scores every transfer and raises alerts to a staff queue with the reasons that produced each one; staff can escalate |
| Tipping-off prohibition | **Implemented** | Members are never told a payment was flagged — verified by automated test |
| Structuring detection | **Implemented** | Amounts parked just under ₹10 lakh are scored as a signal |
| Principal Officer / Designated Director | **Missing** | No record of who holds these PMLA roles |
| Record retention (5 years) | **Partial** | Nothing is deleted, but there is no retention policy or purge schedule |

**Corrective action (high):** name a Principal Officer and Designated Director in
system config, and produce CTR/STR in the FIU-IND submission format.

### 1.4 KYC / Customer Due Diligence

| Element | Status | Observation |
|---|---|---|
| Identity collection (PAN, Aadhaar) | **Implemented** | Aadhaar stored masked; full number never stored |
| Document upload and storage | **Implemented** | Video KYC captures selfie and PAN images |
| Officer verification workflow | **Implemented** | Queue, decision, reason capture, audit trail |
| Face match | **Partial** | RGB-histogram cosine similarity. This is an image heuristic, **not biometric identity verification**. An identical selfie/PAN pair can never auto-approve, but it must not be your only control |
| **Customer risk categorisation (low/medium/high)** | **Missing** | CDD requires classifying every customer by risk. Not implemented |
| **PEP screening** | **Missing** | No politically-exposed-person check |
| **Sanctions / UNSC list screening** | **Missing** | No screening at all |
| Periodic KYC refresh | **Missing** | No re-KYC cycle (high risk 2y / medium 8y / low 10y) |
| Beneficial ownership (non-individual) | **Missing** | Corporate accounts capture no UBO |

**Corrective action (critical):** risk categorisation and sanctions screening are
not optional under the RBI Master Direction on KYC, which applies to Nidhis for
AML purposes. These are the largest compliance gaps in the application.

### 1.5 Payment and Settlement Systems Act, 2007

| Element | Status | Observation |
|---|---|---|
| Operating a payment system without authorisation | **Gated** | UPI, NEFT/RTGS/IMPS outward and card rails are all off pending a recorded authorisation. Section 4 PSS Act makes operating one without authorisation an offence |
| Internal member transfers | **Implemented** | Correctly treated as a book entry on our own ledger, not a payment system transaction, and recorded as `INTERNAL` rather than falsely labelled IMPS |

This is the area the gating work directly addressed and is now, in my judgement,
the strongest part of the application's compliance posture.

### 1.6 IT Act, 2000 and DPDP Act, 2023

| Element | Status | Observation |
|---|---|---|
| Reasonable security practices (s.43A / SPDI Rules) | **Implemented** | bcrypt, HMAC sessions, libsodium-encrypted secrets, prepared statements, TLS enforcement, rate limiting, audit logs |
| Privacy policy | **Missing** | No published policy |
| **DPDP consent notice** | **Missing** | The DPDP Act, 2023 requires an itemised notice and consent for personal data. Not implemented |
| **Data principal rights** (access, correction, erasure) | **Missing** | No mechanism |
| Data Protection Officer | **Missing** | Not named |
| Breach notification procedure | **Missing** | No documented process |
| Data localisation | **Implemented** | Single Hostinger instance; no data leaves it. The AI module runs entirely on-server precisely so member data never goes to a third party |
| CERT-In 6-hour incident reporting | **Missing** | No procedure |

**Corrective action (high):** DPDP consent and a privacy policy. You are
collecting Aadhaar, PAN, financial history and biometric-adjacent selfies with
no consent artefact.

### 1.7 Consumer Protection Act, 2019

| Element | Status | Observation |
|---|---|---|
| Complaint lodging | **Implemented** | Tickets with category, account, description |
| Complaint tracking | **Partial** | Member can list their tickets; no status workflow, no SLA clock |
| **Grievance Redressal Officer** | **Missing** | Must be named with contact details |
| **Escalation matrix / turnaround times** | **Missing** | No documented escalation path |
| **Schedule of charges** | **Missing** | Only a hardcoded ₹50 demand-draft fee. No published fee schedule |
| Ombudsman reference | **N/A** | The RBI Integrated Ombudsman Scheme does not cover Nidhis. Members' recourse is the Registrar of Companies and consumer forums — which should be stated |

---

## 2. Debit card and payment systems

All of this is **built and working**, and all of it is now **gated off** because
the authorisation to offer it is not held.

| Element | Status | Observation |
|---|---|---|
| Card issuance (virtual + physical) | **Gated** | Full flow exists: issue, ordering, dispatch status |
| Card number generation | **Partial** | Generates plausible 16-digit numbers from a fixed BIN. **No Luhn checksum**, and the BIN is not allocated to you. These are display artefacts, not real cards |
| **EMV chip / contactless** | **Missing** | EMV is physical-chip cryptography (ARQC generation, issuer key management). Nothing of the sort exists — the "contactless" flag is a UI toggle only |
| PIN security | **Partial** | PIN stored as bcrypt, never returned — correct. But a real card PIN must be held in an HSM under PIN-block encryption, not a web app database |
| **CVV storage** | **Non-compliant** | CVV is stored to power the virtual-card display. **PCI DSS forbids storing CVV after authorisation, without exception.** Acceptable for a demo; must be removed before any real card programme |
| Card hotlisting / blocking | **Implemented** | Hotlisting is permanent and cannot be undone — correct behaviour |
| Limits (online/ATM/international) | **Implemented** | Per-card, bounded |
| **ATM transaction processing** | **Missing** | No ATM switch, no ISO 8583, no settlement. The "Branch & ATM" page is a locator only |
| **POS integration** | **Missing** | Nothing |
| **UPI** | **Gated** | VPA display and QR generation exist; there is no NPCI connection, no PSP, no sponsor bank. The QR is generated by an external service |
| **NEFT / RTGS / IMPS** | **Gated** | Labels only. No RBI payment-system connectivity. An "outward transfer" previously debited the member and credited nobody |
| 2FA for card transactions (RBI AFA mandate) | **N/A until cards are real** | Transaction password + OTP + TOTP exist at the application layer |
| Chargeback / dispute | **Missing** | No mechanism |

**The honest summary:** the payment and card functionality is a convincing
simulation of a bank's UI, with none of the interbank plumbing underneath. That
was fine while it was a demo. It becomes dangerous the moment a real member
believes an "IMPS transfer" left the building. Gating it was the correct fix.

---

## 3. Submitted document (ADHUNIK plan book) — feature cross-reference

| Plan-book item | Status | Observation |
|---|---|---|
| Daily deposit scheme (3/5/6 yr) | **Partial** | Recorded in the scheme master as drafts. **No daily-collection product exists** — a member cannot hold one |
| Monthly RD (Masik Yojana) | **Partial** | In scheme master; booking uses the generic deposit flow, not the plan |
| Shubh Lakshmi / Savadhi (3× in 8 years) | **Partial (blocked)** | Recorded as a draft. Implies ~14.7% a year — **above the 12.5% ceiling**, so the system refuses to activate it |
| MIS (monthly income) | **Partial** | Recorded. No monthly payout engine |
| Fixed deposit | **Implemented** | Booking, rate tiers, maturity value |
| Loans after 2 years of membership | **Partial** | Loans work; the 2-year membership rule is not enforced |
| Gold / land investment projects | **Not built — deliberately** | A Nidhi may not invest member deposits in land. Building this would be unlawful |
| **12-level + binary team commission plan** | **Not built — deliberately** | Nidhi Rules prohibit brokerage for mobilising deposits; a multi-level structure implicates the Prize Chits and Money Circulation Schemes (Banning) Act, 1978 and the BUDS Act, 2019. Agents are tracked with **no payouts**, per your instruction |
| Passbook | **Missing** | No passbook issue or printing |
| Maturity payout / auto-credit | **Missing** | Deposits never mature. `cron.php` runs standing instructions and scheduled transfers only |

**The plan book's numbers do not agree with themselves.** Stated rates and stated
maturity amounts imply different returns — the 3-year RD is printed at 10.5% but
its maturity figure works out to ~13.4%. Reconcile the brochure before any of it
is offered.

---

## 4. Technical implementation

| Element | Status | Observation |
|---|---|---|
| AJAX / async loading | **Implemented** | React + axios throughout; no full-page reloads. Genuinely well done |
| **Pagination** | **Missing** | **No endpoint paginates.** Every list returns a fixed slice — `LIMIT 50`, `LIMIT 100`, `LIMIT 200`. No `page`, `offset` or `cursor` parameter exists anywhere. Past the cap, data is silently invisible |
| **Table filters** | **Partial** | Statements filter by date; fraud queue by status; scheme master not at all. No column filters, no search within tables |
| **Sort** | **Missing** | All ordering is server-fixed; no column is sortable |
| Export | **Implemented** | PDF and XLSX statements, both hand-written, no dependencies |
| Report generation | **Partial** | Statements and the RBI/FIU report exist; no date-ranged, filterable report builder |
| Responsive design | **Partial** | Tailwind responsive classes throughout; tables overflow on narrow screens; not tested on real devices |
| **Mobile application** | **Missing** | **There is no mobile app.** No React Native, no Capacitor, no Cordova, no native project. There is a responsive website only |
| API web/mobile parity | **N/A** | The REST API would serve a mobile app well when one exists |

**Corrective action (high):** pagination is the most significant technical gap.
A member with more than 50 transactions cannot see the rest, and staff queues
silently truncate. This is a correctness bug, not a nicety.

---

## 5. Required banking features checklist

| # | Feature | Status | Observation |
|---|---|---|---|
| 1 | Account opening and management | **Implemented** | Registration, KYC, account creation, freeze/close |
| 2 | Balance inquiry and mini statement | **Implemented** | Dashboard and API |
| 3 | Fund transfer — self / third party | **Implemented** | Internal, with row locks and a real ledger |
| 4 | Fund transfer — interbank | **Gated** | No authorisation (section 1.5) |
| 5 | Fixed and recurring deposits | **Partial** | Booking works; **no maturity, no closure, no interest credit** |
| 6 | Loan application and tracking | **Implemented** | Application, EMI, pipeline, AI risk grade. No disbursement or repayment schedule |
| 7 | Cheque book request and stop payment | **Gated** | Built; needs banking status |
| 8 | **Beneficiary management** | **Missing** | **No beneficiary table.** Payee details are retyped every transfer. No cooling-off period, which is an RBI control against fraud |
| 9 | Transaction history and e-statements | **Implemented** | History, PDF and Excel statements |
| 10 | **Interest calculation and credit** | **Partial** | Maturity value computed at booking; **no interest is ever actually credited** to any account |
| 11 | **Service charge and fee disclosure** | **Missing** | One hardcoded ₹50 fee; no schedule of charges |
| 12 | **Grievance redressal** | **Partial** | Tickets exist; no officer named, no SLA, no escalation |

---

## 6. Corrective actions, in priority order

**Critical — before any real member money is accepted**

1. Build the **member and share register** (Nidhi Rules 11). Without it, nothing
   else about Nidhi compliance can be demonstrated.
2. Implement **customer risk categorisation and sanctions/PEP screening**.
3. Remove **CVV storage** if a real card programme is ever contemplated.
4. Change the **demo passwords** — the Security Centre flags this as critical on
   every run, and they are published in the install guide.
5. Name a **Principal Officer and Designated Director** for PMLA.

**High — before launch**

6. **Pagination** on every list endpoint.
7. **Interest accrual and crediting**, and deposit maturity in `cron.php`.
8. **Beneficiary management** with an activation cooling-off period.
9. **DPDP consent notice and privacy policy**.
10. **Schedule of charges** and a named **Grievance Redressal Officer** with SLAs.
11. Make **NOF ratio checks enforcing** rather than displayed.
12. Remove "bank"/"banking" from user-visible copy (section 1.1).

**Medium**

13. Table sorting and filters; a proper report builder.
14. CTR/STR in FIU-IND submission format; NDH-1/NDH-3 returns.
15. Passbook issue and printing.
16. Periodic KYC refresh cycle.
17. A real mobile application, if one is genuinely wanted.

**Do not build**

- The 12-level / binary commission plan (Prize Chits Act, 1978; BUDS Act, 2019).
- Land or gold investment of member deposits (outside permitted Nidhi business).
- Any scheme whose effective return exceeds 12.5% a year.

---

## 7. What is genuinely strong

To keep the picture honest, the application is well ahead of typical work of
this kind in several respects:

- **Money movement is correct.** Transfers run in a database transaction with
  row locks taken in a fixed order; balances cannot go negative; a `CHECK`
  constraint backs it at the database level. 98 automated tests pass, including
  one that reconciles closing balance against recorded debits.
- **Authentication is strong.** bcrypt, HMAC sessions with server-side
  revocation, per-account and per-IP lockouts, passkeys, and RFC 6238 TOTP
  verified against the specification's own test vectors.
- **No member data leaves the server.** The AI module is statistical and runs
  in PHP against your own MySQL — no third-party API, no key, nothing exported.
- **The capability register** forces the authorisation question to be answered
  in writing before a regulated service can be switched on, and logs it.
- **Nothing claims a rail it is not on** — an internal transfer is recorded as
  `INTERNAL`, not dressed up as IMPS.
