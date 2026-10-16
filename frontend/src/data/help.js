import { navFor } from '../navigation';
// Every page's guide, keyed by its /app/<tab> id. Read by the Guide button in the
// top bar (the page you are on) and by the Help Centre (every page your role can
// open). Kept as data in one file so a page and its guide are fixed together.
//
// Each entry: title, what (one or two sentences), steps (how to do the main
// job), fields ([label, what to enter]), tips (rules worth knowing).

const MEMBER = {
  dashboard: {
    title: 'Dashboard',
    what: 'Your balances, deposits and latest entries on one screen. It is the first page after you sign in.',
    steps: [
      'Check your savings balance and total deposits at the top.',
      'Use "Pay a member" to send money to another member quickly.',
      'Open "Full Passbook & Transfers" to see every entry.'
    ],
    fields: [
      ['Beneficiary name', 'The name of the member you are paying.'],
      ['Beneficiary account number', 'Their AJSPay account number, for example AJSP00129845612.'],
      ['Amount', 'In rupees. It cannot be more than your balance.'],
      ['Transaction password', 'Your transaction password. It is separate from your sign-in password.']
    ],
    tips: ['Five wrong transaction passwords block payments for 15 minutes.']
  },
  transfer: {
    title: 'Pay a Member',
    what: 'Send money from your account to another member\'s account. It settles at once on our own books. Payments to other banks are not offered.',
    steps: [
      'Choose the account to pay from.',
      'Enter the member\'s account number and name.',
      'Enter the amount and, if you like, a purpose.',
      'Tick "Schedule" to pay on a later date instead of now.',
      'Enter your transaction password and send.'
    ],
    fields: [
      ['Debit from account', 'Your account the money leaves.'],
      ['Beneficiary account number', 'The receiving member\'s account number.'],
      ['Beneficiary full name', 'As it appears on their account.'],
      ['Amount to transfer', 'In rupees, up to your available balance.'],
      ['Payment remarks', 'Optional. Shown on both statements.'],
      ['Transaction password', 'Required for every payment.'],
      ['Member account number', 'Under Saved payees: the account to save. You see a shortened name to check it is the right person.']
    ],
    tips: [
      'Payments above ₹25,000 go only to a payee saved at least 24 hours earlier, so a stolen password cannot empty your account to a new person.',
      'The reference on a member payment starts with UTR-INTERNAL.',
      'Your account must be KYC-verified before it can send money.'
    ]
  },
  deposits: {
    title: 'Deposits',
    what: 'Open a fixed or recurring deposit or one of our plans, and see what each deposit has earned.',
    steps: [
      'Choose the savings account to pay from.',
      'Pick a plan: a plain fixed deposit, a plan paid by monthly or daily instalments (Masik, Daily Yojana, Shubh Lakshmi), a monthly-income plan or a daily-interest plan.',
      'Choose the amount (or the instalment). The panel on the right shows what you get and what is taken today.',
      'Add a nominee and book.',
      'Click any of your deposits to see what it has earned day by day.'
    ],
    fields: [
      ['Debit from savings account', 'Where the deposit money, or each instalment, comes from.'],
      ['Plan', 'Plans are grouped by type. Each one shows its tenure and its yearly return.'],
      ['Amount / Instalment', 'A plain FD takes any amount from ₹1,000 and a tenure. A plan is sold in fixed amounts; for an instalment plan this is the amount per month or per day.'],
      ['Nominee details', 'Who receives the money if something happens to you.']
    ],
    tips: [
      'No deposit pays more than 12.5% a year: that is the legal limit for a Nidhi.',
      'Your first deposit makes you a member with 10 equity shares (₹100), as the Nidhi Rules require.',
      'Instalment plans take the first instalment today and the rest from your savings every month or day. Keep enough there; a plan not fully paid matures at the same share of its value.',
      'Interest is credited automatically. On daily plans, 10% TDS is deducted when interest is released.'
    ]
  },
  loans: {
    title: 'Loans',
    what: 'Work out an EMI, apply for a loan, and manage the loans you have. As a Nidhi we lend only against gold jewellery, property, or your own deposit.',
    steps: [
      'Choose Gold or Home loan.',
      'Move the sliders for amount and tenure to see the EMI.',
      'Fill in your income, employment and purpose, then apply.',
      'Once the loan is disbursed, the money arrives in your savings account and the loan appears under "Your loans".',
      'Each EMI is taken from your savings on its due date. You can also pay the next one early.'
    ],
    fields: [
      ['Monthly in-hand net income', 'What you take home each month, after tax and deductions.'],
      ['Employment type', 'Salaried, self-employed and so on.'],
      ['Purpose of loan', 'What the money is for.']
    ],
    tips: ['Unsecured personal and vehicle loans are not offered.',
      'An EMI that cannot be taken stays overdue and is retried every night. After 90 days a loan is classed as a non-performing asset.']
  },
  'standing-instructions': {
    title: 'Standing Instructions',
    what: 'Pay the same amount on a schedule (rent, a loan EMI, a regular payment to a member) without doing it by hand.',
    steps: [
      'Choose the account, a category and the member to pay.',
      'Set the amount, how often, and the start date.',
      'Save. You can pause, resume or edit it at any time.'
    ],
    fields: [
      ['From account', 'Your account that pays.'],
      ['Category', 'Rent, loan EMI or general. Used only for your own sorting.'],
      ['Beneficiary name / account', 'The member you are paying.'],
      ['Amount', 'Paid each time.'],
      ['Frequency', 'Daily, weekly, monthly or quarterly.'],
      ['Start date / End date', 'When it begins and, optionally, stops.']
    ],
    tips: ['If your balance is too low, the payment is retried. After three failures in a row the instruction pauses.']
  },
  referrals: {
    title: 'My Network',
    what: 'Invite people to become members, and see who joined through you. It is recognition only: no money is paid for introductions.',
    steps: [
      'Copy your link or code, or share it on WhatsApp or email.',
      'When someone opens an account with it and completes KYC, they appear in your list and tree.',
      'Your standing on the ladder updates by itself.'
    ],
    fields: [
      ['Your referral code', 'Give this to the person, or send the link.'],
      ['Personalised link', 'Opens the sign-up page with your code filled in.']
    ],
    tips: ['The Nidhi Rules forbid paying commission or incentives for bringing in members or deposits.']
  },
  statements: {
    title: 'Statements',
    what: 'Download your account statement for any period as a PDF or an Excel file.',
    steps: [
      'Choose the account.',
      'Pick a quick range or set the from and to dates.',
      'Download PDF or Excel.'
    ],
    fields: [
      ['Account', 'Which account to print.'],
      ['Quick range', 'This month, last month, this financial year and so on.'],
      ['From date / To date', 'A custom period.']
    ],
    tips: ['The PDF shows the TDS deducted on interest, so keep it for your tax return.']
  },
  'video-kyc': {
    title: 'Video KYC',
    what: 'Verify your identity from home with your camera, so you do not need to visit a branch.',
    steps: [
      'Click "Start Camera" and allow camera access.',
      'Take a selfie, then photos of your PAN and Aadhaar.',
      'Say the word shown on screen, then submit.',
      'An officer reviews it. You will see the result on your KYC page.'
    ],
    fields: [],
    tips: ['Use good light and keep the card flat, so the text is readable.']
  },
  security: {
    title: 'Security & Passkeys',
    what: 'Protect your account: change your password, add an authenticator app or a passkey, and sign out other devices.',
    steps: [
      'Set up an authenticator: scan the key in Google Authenticator or a similar app, then type the 6-digit code.',
      'Save the 10 recovery codes somewhere safe.',
      'Add a passkey to sign in with your fingerprint or face.',
      'Under sessions, sign out any device you do not recognise.'
    ],
    fields: [
      ['Current password', 'Needed to change anything sensitive.'],
      ['New password / Confirm', 'At least 8 characters. Do not reuse an old one.']
    ],
    tips: ['Once 2FA is on, your password alone no longer signs you in.']
  },
  kyc: {
    title: 'Profile & KYC',
    what: 'Your identity documents, nominee and joint holder. These must be verified before you can move money.',
    steps: [
      'Upload your PAN, Aadhaar and a proof of address.',
      'Add or change your nominee.',
      'Add a joint applicant if the account is joint.',
      'Wait for the branch to verify them. The status shows at the top.'
    ],
    fields: [
      ['PAN', 'Your 10-character PAN.'],
      ['Aadhaar', 'Only the last 4 digits are kept.'],
      ['Proof of address', 'A utility bill or passport.'],
      ['Nominee name / relationship', 'Who receives the money if needed.'],
      ['Co-applicant name / PAN', 'Only for joint accounts.']
    ],
    tips: ['If a document is rejected, the reason is shown, so you can upload a better copy.']
  },
  support: {
    title: 'Help & Support',
    what: 'Raise a query with the branch and follow the replies.',
    steps: [
      'Click "Raise a query", choose what it is about, and describe the problem.',
      'Replies appear in the ticket. Reply there if they ask for anything.',
      'Not satisfied? Open the ticket and click "Escalate to the grievance officer". They must answer within 30 days.'
    ],
    fields: [['Subject', 'One line, e.g. Interest not credited on my FD.'],
      ['Describe the problem', 'Dates, amounts and reference numbers help. Never write your password or OTP.']],
    tips: ['Beyond the grievance officer, you can approach the Registrar of Companies or a consumer forum.']
  },
  branches: {
    title: 'Branches',
    what: 'Find a branch, its address, timings and whether it offers lockers.',
    steps: ['Search by name, city or address.', 'Open the map link for directions.'],
    fields: [],
    tips: []
  }
};

const COUNTER = {
  'support-desk': {
    title: 'Support Tickets',
    what: 'Every query members raise, overdue first, with the full thread.',
    steps: [
      'Open a ticket from the list. Filter by status at the top.',
      'Click "Take this ticket" so others know you are handling it.',
      'Reply in "Your reply". Tick "Internal note" for a note only staff can see.',
      'When it is fixed, click "Mark resolved" and write how. The member sees that note.'
    ],
    fields: [['Your reply', 'What the member reads. Never ask for a password or OTP.'],
      ['Internal note', 'Ticked: only staff see it.']],
    tips: ['Each priority has a deadline: urgent 4 hours, high 24, medium 72, low 120. Overdue tickets are listed first.',
      'If the member escalates, the ticket also appears in the Grievance Queue for the grievance officer.']
  },
  'kyc-desk': {
    title: 'KYC Verification',
    what: 'Members waiting for their KYC to be checked. Verify them here once you have seen their original documents.',
    steps: [
      'Search for the member by name or PAN.',
      'Click Approve. You can also enrol them in a plan and take the first deposit in the same step.',
      'Click Reject if something is wrong, and type the reason. The member sees it.'
    ],
    fields: [
      ['Plan', 'Optional. The plan they are taking. Plans above the 12.5% cap are not offered.'],
      ['Deposit amount', 'The first deposit, if they are paying now.'],
      ['Mode / Cheque number', 'Cash, or a cheque with its number.'],
      ['Nominee', 'Optional.']
    ],
    tips: ['Approving KYC also records their introduction, if they joined with someone\'s link. Nobody is paid for it.']
  },
  staff: {
    title: 'Customer Console',
    what: 'The teller\'s home page: today\'s figures and the counter deposit form.',
    steps: [
      'Type the member\'s account number.',
      'Enter the amount and choose cash or cheque.',
      'Click "Credit Account". The member\'s balance updates at once.',
      'A deposit slip opens. Click "Print slip", sign it and give it to the member.'
    ],
    fields: [
      ['Member account number', 'The account to credit.'],
      ['Amount', 'In rupees.'],
      ['Mode', 'Cash or cheque.'],
      ['Cheque number', 'Required for a cheque.'],
      ['Remarks', 'Optional. Shown on the member\'s statement.']
    ],
    tips: []
  },
  crm: {
    title: 'Relationship Desk',
    what: 'Everything about one member on a single screen, your enquiries (leads), and who to call today.',
    steps: [
      'Members: open a member to see accounts, deposits, loans and past conversations.',
      'Log every conversation with "Log a contact". A follow-up date creates a task.',
      'Leads: add an enquiry, collect documents, then open the account from it.',
      'My Tasks: close a task by saying what happened.'
    ],
    fields: [
      ['Channel / Direction', 'Phone, visit, WhatsApp; and whether you called them or they called you.'],
      ['Outcome / What was it about', 'A short note of the conversation.'],
      ['Follow up on', 'Optional. Creates a task for that day.'],
      ['Full name / Phone (lead)', 'The same phone number cannot be added twice.'],
      ['Plan they asked about', 'Optional.'],
      ['Login password / Transaction password', 'Set when you open the account from a lead. Give them to the member privately.'],
      ['Opening deposit', 'Cash paid in when the account opens.'],
      ['Introducer code / name', 'Who brought them, if anyone.']
    ],
    tips: ['A lead cannot be marked lost without a reason, and a task cannot be closed without an outcome.']
  },
  'book-deposit': {
    title: 'Book Member Deposit',
    what: 'Book a fixed, recurring or plan deposit for a member who is at the counter.',
    steps: [
      'Type the member\'s account number. Their details load by themselves.',
      'Pick any plan (the same list members see), the amount or instalment, and a nominee.',
      'Book it. Today\'s amount is taken from their savings account; an instalment plan collects the rest automatically.',
      'A deposit slip opens with the plan, deposit number, maturity date and value. Click "Print slip" and hand it over.'
    ],
    fields: [
      ['Member account number', 'The savings account to debit.'],
      ['Plan', 'A plain FD, or any live plan, grouped by type.'],
      ['Amount / Instalment', 'Plans are sold in fixed amounts. For an instalment plan, the amount per month or per day.'],
      ['Nominee details', 'Who receives it if needed.']
    ],
    tips: ['An identical booking within a minute is refused, so pressing twice cannot book twice.',
      'The slip carries today\'s date and time and your name. Deposits cannot be back-dated.']
  },
  'member-register': {
    title: 'Member Register',
    what: 'The statutory share register (Nidhi Rules, Rule 11). Every depositor must hold at least 10 shares of ₹10.',
    steps: [
      'Admit a person: choose them, allot at least 10 shares, and add a nominee.',
      'Record share movements: allotment, transfer in or out, or surrender.',
      'Watch the "Never screened" and "Below minimum" counts at the top.'
    ],
    fields: [
      ['Person', 'The customer being admitted.'],
      ['Shares to allot', 'At least 10.'],
      ['Kind of movement', 'Allotment, transfer in, transfer out or surrender.'],
      ['Number of shares', 'How many.'],
      ['Note', 'Optional reference.']
    ],
    tips: ['A member with live deposits cannot drop below 10 shares, or cease membership.']
  },
  screening: {
    title: 'Sanctions & PEP Screening',
    what: 'Check members and leads against the UN sanctions and politically-exposed-person lists you load.',
    steps: [
      'Load names into a list (UNSC, PEP and so on).',
      'Run screening. Possible matches appear as open hits.',
      'Open each hit, decide "cleared" or "confirmed", and say why.'
    ],
    fields: [
      ['Which list / Names', 'The list and the names to load, one per line.'],
      ['Match threshold', 'How close a name must be to count as a match.'],
      ['Decision / Why', 'A confirmed match stops that member transacting.']
    ],
    tips: ['Screening refuses to run while the list is empty.']
  },
  'data-requests': {
    title: 'Data Requests',
    what: 'Requests from members under the Digital Personal Data Protection Act, 2023: to see, correct or erase their data.',
    steps: ['Open a waiting request.', 'Do what was asked, then record the outcome.'],
    fields: [['Outcome', 'What was done, or why it was refused.']],
    tips: ['Overdue requests are counted at the top, so answer within the deadline.']
  },
  grievance: {
    title: 'Grievance Queue',
    what: 'Complaints escalated past the support desk. They must be answered within 30 days.',
    steps: ['Open a complaint.', 'Write the decision and the reason for it, then resolve it.'],
    fields: [['Decision and the reason for it', 'Required.']],
    tips: ['A decided complaint cannot be decided again.']
  },
  reports: {
    title: 'Reports',
    what: 'Registers and lists you can filter, sort and export. Only the reports your role may see are listed.',
    steps: [
      'Choose a report.',
      'Set the filters and click Apply. Click a column heading to sort.',
      'Export to CSV or Excel.',
      'For the MCA Nidhi returns, open "Nidhi return figures (NDH-1 / NDH-3)" and set Period to "half-year ends" to see 31 March and 30 September.'
    ],
    fields: [],
    tips: ['FIU-IND CTR and STR reports give the figures to key into FIU-IND\'s FINnet utility; they are not upload files.',
      'Every export is written to the audit log with your name and the row count.']
  },
  agents: {
    title: 'Field Agents (cash collected)',
    what: 'Field agents and the money they collected from members. It is a record only, kept for traceability.',
    steps: [
      'Add an agent with a code, name, phone and branch.',
      'Record each collection: the member\'s account, the amount, the date and the receipt number.'
    ],
    fields: [
      ['Agent code / Name / Phone / Branch', 'Who the agent is.'],
      ['Member account number', 'Whose money it is.'],
      ['Amount / Collected on / Receipt no', 'What was collected and when.'],
      ['Scheme', 'Optional. The plan it is for.']
    ],
    tips: [
      'Recording a collection does not credit the member: a teller still has to.',
      'No commission is calculated or paid to agents (Nidhi Rules).'
    ]
  }
};

const MANAGER = {
  admin: {
    title: 'Branch Overview',
    what: 'The branch at a glance: members, money held, pending KYC, the Nidhi Rules checks, PMLA reports and the audit trail.',
    steps: [
      'Check the statutory compliance box. Net owned funds come from Business Parameters.',
      'Work the KYC desk at the bottom.',
      'Under User access, create staff logins and reset passwords.'
    ],
    fields: [
      ['Full name / Email / Phone', 'For a new staff login.'],
      ['Role / Branch / Designation', 'What they may open, and where they work.'],
      ['Temporary password', 'They change it at first sign-in.']
    ],
    tips: ['If "Deposits from members only" names any deposits, admit those people to the register.']
  },
  'loan-dept': {
    title: 'Loan Pipeline',
    what: 'Every loan application with its EMI, the applicant\'s income and a risk grade, plus the outstanding book and its NPA share.',
    steps: ['Check the security (gold, property, or the deposit number shown) and the documents.', 'Approve, ask for documents, or reject.',
      'Disburse an approved loan: the amount is credited to the member\'s savings and its EMI schedule starts. Only approved applications can be disbursed, and disbursal is final.'],
    fields: [],
    tips: ['Only gold and home loans can be applied for.']
  },
  collection: {
    title: 'Loan Recovery',
    what: 'Every loan with an EMI past its due date, worst first: days past due (DPD), the amount overdue and the last contact.',
    steps: ['Work the cases with the highest DPD first.', 'Record each reminder, legal notice or settlement on the case.',
      'A case leaves this list by itself once the member\'s EMIs are paid (from savings, every night).'],
    fields: [],
    tips: ['Cases at 90 days past due or more count as NPA risk.']
  },
  schemes: {
    title: 'Scheme Master (FD / RD / plans)',
    what: 'The deposit plans staff can sell. Each one shows its true annual return.',
    steps: [
      'Choose the type first: the form then asks only for what that kind of plan needs.',
      'Type the tenure in months, the interest % a year, and the amounts it is sold in (e.g. 8000, 16000). The deposit and maturity for each amount are worked out for you.',
      'Choose Early withdrawal: any time after 30 days, locked for some months, or locked until maturity.',
      'Save it as a draft, check the effective rate, then set it active. A plan above 12.5% shows "Re-price to 12.5%", which fixes it in one click.',
      'To change an existing plan, click Edit on its row. Changes apply to new bookings; deposits already booked keep their terms.',
      'To stop selling a plan, set its status to inactive. Members and staff then no longer see it.'
    ],
    fields: [
      ['Code / Name / Type', 'Type is daily, recurring, fixed or MIS.'],
      ['Tenure / Pay-in months', 'Total months, and how many of them take instalments.'],
      ['Interest (% a year', 'The yearly rate, at most 12.5%. Maturity is worked out from it, compounded monthly.'],
      ['Amounts it is sold in', 'The instalment (RD / daily) or deposit (FD / MIS) amounts, comma-separated.'],
      ['Early withdrawal', 'When a member may close it early. Before then, early closing is refused.'],
      ['Daily rate / Withdrawal threshold', 'For daily-interest plans only: any amount above the minimum earns this % a day.'],
      ['Status', 'Draft, active or inactive.']
    ],
    tips: ['A plan above 12.5% a year cannot be activated or booked, and it is not shown to the public.']
  },
  'video-kyc-queue': {
    title: 'Video KYC Queue',
    what: 'Video KYC submissions waiting for an officer: selfie, PAN and Aadhaar photos, with a face-match score.',
    steps: ['Open a submission.', 'Compare the selfie with the PAN photo and read the documents.', 'Approve or reject it with a reason.'],
    fields: [],
    tips: ['The face-match score is an image check, not proof of identity. Always look yourself.']
  }
};

const DIRECTOR = {
  owner: {
    title: 'Executive Dashboard',
    what: 'The whole institution: members, money held, deposits, transactions, branches and the loan book.',
    steps: ['Review the figures daily.', 'Open Security Centre first if anything looks wrong.'],
    fields: [],
    tips: []
  },
  'security-center': {
    title: 'Security Centre',
    what: 'Inspects this live deployment and lists what is wrong, worst first.',
    steps: ['Click Re-run.', 'Fix every critical item.', 'After a deploy you trust, click "Seal current files" so later changes are detected.'],
    fields: [],
    tips: ['It flags any account still using a published demo password.']
  },
  'support-view': {
    title: 'View as Member',
    what: 'See the app exactly as a member sees it, to help them. It is read-only: nothing can be changed or paid.',
    steps: ['Choose the member.', 'Type why you are opening their account. It is required and audited.', 'Return to your own account when you are done.'],
    fields: [['Why are you opening this account?', 'Required, and recorded in the audit log.']],
    tips: ['Directors and managers cannot be viewed this way.']
  },
  fraud: {
    title: 'Fraud & AML Review',
    what: 'Transfers scored against each member\'s own normal behaviour, with the reasons for each alert.',
    steps: ['Open an alert and read its reasons.', 'Clear it, or escalate it for a suspicious transaction report.'],
    fields: [],
    tips: ['Members are never told they were flagged. Tipping them off is an offence under PMLA.']
  },
  'branch-admin': {
    title: 'Branch Network',
    what: 'The branches shown on the public locator.',
    steps: ['Add or edit a branch.', 'Fill in latitude and longitude so it appears on the map.'],
    fields: [
      ['Branch name / code', 'As printed on documents.'],
      ['Address / Phone / Opening hours', 'Shown to the public.'],
      ['Latitude / Longitude', 'For the map pin.'],
      ['Lockers', 'Tick if the branch offers lockers.']
    ],
    tips: ['Changes appear on the public site straight away.']
  },
  'public-pages': {
    title: 'Public Pages',
    what: 'The product pages on the public website.',
    steps: ['Edit a page\'s title, summary, highlights and documents.', 'Use Visibility to publish it or keep it as a draft.'],
    fields: [
      ['Section / Address', 'Where it sits, and its URL, for example loans / gold-loan.'],
      ['Title / Tagline / Summary', 'What visitors read.'],
      ['Highlights / Documents to bring', 'One per line.'],
      ['Requires authorisation', 'Hides the page if that service is switched off.']
    ],
    tips: ['Do not publish anything a Nidhi may not offer: current accounts, cards, insurance, mutual funds or unsecured loans.']
  },
  'member-ranks': {
    title: 'Member Standings',
    what: 'The recognition ladder (Silver to Brand Ambassador), and how many members hold each rank.',
    steps: ['Edit a rank: how many introductions it needs, and at what rank.', 'Write the recognition it brings.',
      'Open Five-level referral demo to try fictional FD, RD or MLM allocations. Create or edit a demo plan and save its five percentages.',
      'Set the example Silver / Gold earnings thresholds, then preview a signup (₹0) or a funded plan. Simulate events to see ranks progress.'],
    fields: [
      ['Members to introduce / Each must already be', 'The rule for reaching the rank.'],
      ['Recognition', 'For example "Certificate at the annual meet". There is no money.'],
      ['Demo level percentages', 'Default: 5% for each of five ancestors, 25% total. All use the same paid amount; allocations round down to paisa.'],
      ['Demo amount received', 'For RD, enter only the instalment paid now. A signup alone pays nothing.'],
      ['Demo Silver / Gold', 'Example cumulative commission thresholds per fictional person. Editable; separate from real member standings.']
    ],
    tips: ['Live ranks carry no cash, commission or better deposit rate.',
      'Demo plans save in this browser only. Demo totals reset when you leave the page. No deposits or live payouts are created.']
  },
  rails: {
    title: 'Payment Rails',
    what: 'How money could leave the institution to other banks. It stays off until a payment-systems authorisation is recorded.',
    steps: ['Keep the simulator for testing.', 'Only switch to a partner with a written authorisation and a sponsor bank agreement.'],
    fields: [['Maximum per transaction / Daily cap', 'Hard limits on outward money.']],
    tips: ['Running a payment system without RBI authorisation is an offence (Payment and Settlement Systems Act, Section 4).']
  },
  'admin-config': {
    title: 'System Config',
    what: 'OTP delivery (SMS and email) and the named compliance officers.',
    steps: ['Enter the SMS (Twilio) or email (SMTP or SendGrid) details.', 'Send a test.', 'Name the grievance officer, the PMLA principal officer and the designated director.'],
    fields: [
      ['Account SID / Auth token / From number', 'From your Twilio account.'],
      ['SMTP host / Port / Mailbox', 'For sending email from your own mailbox.'],
      ['Officer name / email / phone', 'Shown to members on the privacy notice and support pages.']
    ],
    tips: ['Live OTP is refused until a delivery channel is set up.']
  },
  parameters: {
    title: 'Business Parameters',
    what: 'Rates, fees and limits in one editable table: loan and deposit rates, TDS, penalties and net owned funds.',
    steps: ['Find the parameter.', 'Change its value and save. The change is audited.'],
    fields: [
      ['Value', 'Must be between its Min and Max.'],
      ['Net owned funds', 'From the audited balance sheet. The branch dashboard\'s Nidhi Rules checks use it.']
    ],
    tips: ['Deposit rates cannot be set above 12.5%.']
  }
};

// The buttons on each page and what pressing them does. The text is matched against
// the button's visible label (start of it), so "Book" finds "Book Fixed deposit · ₹50,000 today".
const ACTIONS = {
  dashboard: [['Pay a member', 'Opens a quick form to send money to another member.'],
    ['+ Book New FD', 'Takes you to Deposits to open a fixed deposit or a plan.'],
    ['Full Passbook', 'Opens every entry on your account, with transfers.']],
  transfer: [['Save payee', 'Saves the account so you can pay it with one tap; large payments to it open after 24 hours.'],
    ['Authorize & Transfer', 'Sends the money once every field is filled in and your transaction password is correct. It cannot be undone.']],
  deposits: [['Book', 'Opens the deposit and takes today\'s amount from the account you chose.'],
    ['View earnings', 'Shows what that deposit has earned, day by day.'],
    ['Close Early', 'Ends the deposit before maturity. You get back what you paid in, plus interest at a lower rate with an early-exit penalty.']],
  loans: [['Gold Loan / Home Loan', 'Chooses the kind of loan; the EMI updates as you move the sliders.'],
    ['Apply for', 'Sends your application to the loan desk. Its status shows in the list below.'],
    ['Pay EMI now', 'Pays your next EMI from savings straight away, instead of on its due date.'],
    ['View EMI schedule', 'Shows every EMI: when it is due, how much is principal and interest, and what has been paid.']],
  'standing-instructions': [['New Instruction', 'Opens the form to set up a repeating payment.']],
  referrals: [['Copy', 'Copies your invite link to share it yourself.'],
    ['WhatsApp', 'Opens WhatsApp with your invite link ready to send.']],
  statements: [['Last 30 days', 'Fills in the dates for you. The other range buttons work the same way.'],
    ['Full passbook', 'Selects every entry since the account was opened: download it as your passbook.'],
    ['Download PDF', 'Downloads the statement as a PDF.'], ['Download Excel', 'Downloads the same statement as an Excel sheet.']],
  security: [['Register passkey', 'Adds this device\'s fingerprint or face sign-in.'],
    ['Change password', 'Saves your new password; other devices are signed out.'],
    ['Send OTP', 'Sends a one-time code to check your phone or email works.']],
  kyc: [['Update Nominee', 'Saves the nominee after your transaction password is checked.']],
  'video-kyc': [['Start Camera', 'Turns on your camera. Allow it when the browser asks.'],
    ['Capture', 'Takes the photo for the current step. You can retake it.']],
  'kyc-desk': [['Approve', 'Marks the KYC verified. You can also enrol them in a plan and take the first deposit.'],
    ['Reject', 'Asks for the reason, which the member sees.']],
  staff: [['Credit Account', 'Credits the cash or cheque to the member\'s account at once.']],
  crm: [['Members / Leads / My Tasks', 'Switches between your members, your enquiries and today\'s calls.']],
  'member-register': [['Admit a member', 'Opens the form to allot shares to a new member.'],
    ['Collect share money', 'Shown on folios admitted by a first deposit before share money was taken: takes the ₹100 from their savings.']],
  screening: [['Screen everyone now', 'Checks every member and lead against the loaded lists.'],
    ['Watchlist', 'Shows and loads the names to screen against.']],
  reports: [['Apply', 'Runs the report with your filters. FIU-IND CTR and STR, and the NDH return figures, are reports here too.'], ['CSV', 'Exports it as CSV. Exports are audited.'],
    ['Excel', 'Exports it as an Excel sheet.']],
  agents: [['New agent', 'Adds a field agent.']],
  schemes: [['New scheme', 'Opens the plan form. Choose the type first.'],
    ['Re-price', 'Brings an over-cap plan down to 12.5% a year, keeping its name and amounts.'],
    ['Edit', 'Changes a plan. Deposits already booked keep their own terms.']],
  admin: [['Pending KYC', 'The verification desk.'], ['Regulatory Reports', 'Cash and suspicious transaction reports.'],
    ['Audit Trails', 'Who did what, when.'], ['User Access', 'Create staff logins and reset passwords.']],
  owner: [['Propose change', 'Opens Business Parameters to change a rate or fee.']],
  'security-center': [['Re-run', 'Runs every check again.'], ['Seal current files', 'Records today\'s files as the good copy, so later changes are spotted.']],
  'support-view': [['Open read-only', 'Opens that member\'s app after you give a reason.']],
  fraud: [['Open / Escalated / Cleared', 'Filters the alerts by where they are in review.']],
  'branch-admin': [['New branch', 'Adds a branch to the public locator.']],
  'public-pages': [['New page', 'Adds a product page to the public site.']],
  'member-ranks': [['Add a rank', 'Adds a rung to the ladder.']],
  rails: [['Test connection', 'Checks the partner\'s details work, without moving money.'], ['Save changes', 'Saves the rail settings.']],
  'admin-config': [['Send test SMS', 'Sends a test message to the number you typed.'], ['Save changes', 'Saves the settings.']],
  parameters: [['New parameter', 'Adds a rate, fee or limit.'], ['Edit', 'Changes a value. Every change is audited.']],
  'book-deposit': [['Book', 'Opens the deposit and takes today\'s amount from the member\'s savings.']],
};

const GUIDES = Object.fromEntries(Object.entries({ ...MEMBER, ...COUNTER, ...MANAGER, ...DIRECTOR })
  .map(([key, guide]) => [key, { ...guide, actions: ACTIONS[key] || [] }]));

const COUNTER_ROLES = ['staff', 'admin', 'branch_manager', 'bank_owner'];

// The KYC tab is a member's own profile for members, and the verification desk
// for the counter roles (see App.js), so it has two guides.
export const guideFor = (tab, role) =>
  tab === 'kyc' && COUNTER_ROLES.includes(role) ? GUIDES['kyc-desk']
    : tab === 'support' && COUNTER_ROLES.includes(role) ? GUIDES['support-desk'] : GUIDES[tab] || null;

const FAQ_MEMBER = [
  ['Is AJSPay a bank?', 'No. Aadhunik Jeewan Sanchay Nidhi Limited is a Nidhi company under the Companies Act, 2013. It takes deposits from and lends to its members only. It is not licensed by the RBI, and deposits are not insured by DICGC.'],
  ['Why can\'t I send money yet?', 'Your KYC has to be verified first. Upload your documents under Profile & KYC, or complete Video KYC.'],
  ['What is the transaction password?', 'A second password, used only to move money. It is different from the password you sign in with.'],
  ['How is interest on my deposit paid?', 'Automatically. Daily plans credit interest every day (TDS is deducted when it is released). Monthly-income plans credit monthly, and other deposits pay at maturity.'],
  ['Can I pay someone at another bank?', 'No. Transfers are between member accounts only.'],
  ['What can I borrow against?', 'Gold jewellery, property, or your own deposit: up to 90% of what you have paid into it, repaid before it matures. The deposit cannot be closed early while the loan is open.'],
  ['Do I earn money for inviting people?', 'No. The Nidhi Rules forbid paying for introductions. Your network and standing are recognition only.'],
  ['I forgot my password.', 'Use "Forgot password" on the sign-in page. Five wrong attempts lock sign-in for 15 minutes.'],
  ['How do I complain?', 'Open Help & Support and raise a query. If you are not satisfied with the answer, escalate it there to the grievance officer, who must answer within 30 days. Beyond that, you can approach the Registrar of Companies or a consumer forum.']
];

const FAQ_STAFF = [
  ['A member says their payment did not go through.', 'Open them in the Relationship Desk and check their transactions. A wrong transaction password five times blocks payments for 15 minutes.'],
  ['Can I credit money an agent collected?', 'Yes, from the counter deposit form on the Customer Console. Recording the collection under Agents does not credit the member by itself.'],
  ['A plan is missing from the list.', 'Plans above the 12.5% cap are closed to new deposits and hidden. Ask the Director.'],
  ['Someone asks about commission for bringing members.', 'None is paid. A Nidhi may not pay brokerage or incentives for deposits or members.']
];

const FAQ_DIRECTOR = [
  ['Why is a plan closed to new deposits?', 'Its own figures work out above 12.5% a year. Edit it to a compliant maturity figure, or keep it as a draft.'],
  ['What happened to deposits booked above the cap?', 'Each night they are re-rated to 12.5%. Interest already credited is kept. Each change is in the audit log as DEPOSIT_RERATED_TO_CAP.'],
  ['Where do the NOF checks come from?', 'Enter Net owned funds in Business Parameters. The deposits side is worked out from the books.'],
  ['How do I see what a member sees?', 'Use View as Member. It is read-only and audited.']
];

export const faqFor = (role) =>
  role === 'retail' || role === 'corporate' ? FAQ_MEMBER
    : role === 'bank_owner' ? [...FAQ_DIRECTOR, ...FAQ_STAFF]
    : FAQ_STAFF;

export const PUBLIC_FAQ = [
  ['Who can become a member?', 'Any individual with PAN and Aadhaar. You become a member when 10 equity shares are allotted to you, which happens with your first deposit.'],
  ['How do I open an account?', 'Click "Open Account", sign up with your phone number, then complete Video KYC or visit a branch with your documents.'],
  ...FAQ_MEMBER
];

// Every guide this role can open, as plain text: what the staff help bot answers from.
const guideText = (label, g) => [`## ${label} (menu: ${label})`, g.what,
  ...g.steps.map((x, i) => `${i + 1}. ${x}`), ...g.fields.map(([f, h]) => `Field "${f}": ${h}`),
  ...(g.actions || []).map(([b, h]) => `Button "${b}": ${h}`), ...g.tips.map((t) => `Note: ${t}`)].join('\n');
const roleGuides = (role, features) =>
  navFor(role, features).map((item) => [item.label, guideFor(item.id, role)]).filter(([, g]) => g);
export const guidesText = (role, features) =>
  [...roleGuides(role, features).map(([label, g]) => guideText(label, g)),
    '## Common questions', ...faqFor(role).map(([q, a]) => `Q: ${q}\nA: ${a}`)].join('\n\n');

// Without the Claude bot (no API key set, or it is down): the page whose guide
// shares the most words with the question.
// ponytail: plain word overlap, no stemming or Hindi; the Claude bot is the real answer.
// Words staff use for what the menu calls something else.
const ALIASES = { plan: 'scheme', fd: 'fixed', rd: 'recurring', slip: 'slip', ndh: 'nidhi' };
const STOP = new Set(['where', 'how', 'the', 'and', 'for', 'can', 'what', 'see', 'this', 'that', 'with', 'from', 'into']);
export function searchGuides(question, role, features) {
  const words = (t) => new Set((t.toLowerCase().match(/[a-z0-9]{2,}/g) || [])
    .map((w) => w.replace(/s$/, '')).flatMap((w) => (ALIASES[w] ? [w, ALIASES[w]] : [w])).filter((w) => !STOP.has(w)));
  const pages = roleGuides(role, features).map(([label, g]) => [label, g, words(guideText(label, g)), words(`${label} ${g.title}`)]);
  // A word in every guide ("deposit", "member") says little; one in a single guide says a lot.
  // A word in the page's own name counts three times.
  const weight = (w) => 1 / Math.max(1, pages.filter(([, , t]) => t.has(w)).length);
  const asked = [...words(question)];
  const scored = pages.map(([label, g, text, name]) =>
    [asked.reduce((n, w) => n + (text.has(w) ? weight(w) : 0) + (name.has(w) ? 3 * weight(w) : 0), 0), label, g])
    .sort((x, y) => y[0] - x[0]);
  if (!scored.length || scored[0][0] === 0) {
    return 'I could not find that in the page guides. Open Help Centre in your profile menu, or ask the Director.';
  }
  const [, label, g] = scored[0];
  return [`Open "${label}" in the menu.`, g.what, ...g.steps.map((x, i) => `${i + 1}. ${x}`),
    'Press Guide in the top bar on that page for a field-by-field walk-through.'].join('\n');
}

