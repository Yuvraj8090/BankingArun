// Content for the public product pages behind the navbar and footer links.
// Each key is a real URL: /personal/savings-account, /loans/home-loan, and so on.
export const GROUP_LABEL = {
  personal: 'Personal Banking',
  corporate: 'Corporate Banking',
  loans: 'Loans',
  investments: 'Investments',
  support: 'Support'
};

export const PRODUCTS = {
  // ---------------- Personal ----------------
  'personal/savings-account': {
    title: 'Savings Account',
    tagline: 'Everyday banking with interest paid quarterly.',
    summary: 'A zero-balance members\u2019 savings account with the member portal, statements and transfers between member accounts. Open it online with PAN and Aadhaar, and finish verification by video KYC without visiting a branch.',
    highlights: ['Interest credited every quarter', 'Transfers between member accounts at no charge', 'Statements as PDF or Excel, any date range', 'Video KYC, no branch visit'],
    facts: [['Interest rate', '4.00% p.a.'], ['Minimum balance', 'Nil'], ['Digital transfers', 'Free'], ['Statement', 'PDF or Excel, any date range']],
    documents: ['PAN card', 'Aadhaar or another officially valid document', 'Recent photograph']
  },
  'personal/salary-account': {
    title: 'Salary Account',
    tagline: 'For monthly salary credits, with no balance requirement.',
    summary: 'A savings account configured for salary credits. It keeps every digital-banking feature of the regular savings account and drops the minimum balance while your salary arrives each month.',
    highlights: ['No minimum balance with an active salary credit', 'Free cheque book on request', 'Standing instructions for rent, SIPs and EMIs', 'Same interest as a savings account'],
    facts: [['Interest rate', '4.00% p.a.'], ['Minimum balance', 'Nil with salary credit'], ['Eligibility', 'Employer salary credit'], ['Cheque book', 'Free, 25 to 100 leaves']],
    documents: ['PAN card', 'Aadhaar or another officially valid document', 'Latest salary slip or offer letter']
  },
  'personal/fixed-deposits': {
    title: 'Fixed Deposits',
    tagline: 'Lock in a rate from 7 days to 10 years.',
    summary: 'Book a fixed deposit from your account in a few seconds. The maturity value is shown before you confirm, and senior citizens receive an extra 0.50% p.a. across every tenure.',
    highlights: ['Book online from your savings account', 'Maturity value shown up front', 'Senior citizens get +0.50% p.a.', 'Interest on maturity or periodically'],
    facts: [['1 year to 2 years', '7.25% p.a.'], ['2 years to 3 years', '7.50% p.a.'], ['Senior citizen bonus', '+0.50% p.a.'], ['Tenure', '7 days to 10 years']],
    documents: ['An active AJSPay account', 'Nominee details']
  },
  'personal/recurring-deposit': {
    title: 'Recurring Deposit',
    tagline: 'Save a fixed amount every month.',
    summary: 'A recurring deposit puts aside a set amount each month and pays fixed-deposit rates on the balance. Useful for a goal with a date attached, such as fees or a down payment.',
    highlights: ['Instalments from ₹500 a month', 'Fixed-deposit interest rates', 'Auto-debit by standing instruction', 'Tenure of 6 to 60 months'],
    facts: [['Minimum instalment', '₹500 per month'], ['Interest rate', 'Same as the FD rate card'], ['Tenure', '6 to 60 months'], ['Auto-debit', 'Standing instruction']],
    documents: ['An active AJSPay account', 'Nominee details']
  },
  'personal/debit-cards': {
    requires: 'debit_cards',
    title: 'Debit & Credit Cards',
    tagline: 'Freeze, set limits and control usage yourself.',
    summary: 'Every account comes with a virtual card immediately and a physical card on request. You control limits and switches from the app, and can freeze or permanently hotlist a card at once if it goes missing.',
    highlights: ['Virtual card the moment your account opens', 'Freeze instantly, hotlist permanently', 'Separate online and ATM limits', 'International and contactless switches'],
    facts: [['Networks', 'Visa, RuPay and Mastercard'], ['Online limit', 'Up to ₹10,00,000, set by you'], ['PIN', 'Set your own; never stored in readable form'], ['CVV reveal', 'Needs your transaction password']],
    documents: ['An active AJSPay account']
  },

  // ---------------- Corporate ----------------
  'corporate/current-account': {
    requires: 'current_accounts',
    title: 'Current Account',
    tagline: 'For businesses that move money every day.',
    summary: 'A current account for companies and firms, with bulk payouts, per-batch references for reconciliation, and statements you can export as PDF or Excel for your accountant.',
    highlights: ['Unlimited digital transfers', 'Bulk payouts up to 500 lines per batch', 'Batch references for reconciliation', 'PDF and Excel statements'],
    facts: [['Interest', 'Not applicable on current accounts'], ['Bulk payout batch', 'Up to 500 beneficiaries'], ['Authorisation', 'Transaction password per batch'], ['Statements', 'PDF or Excel']],
    documents: ['Certificate of incorporation or registration', 'Company PAN', 'Board resolution and authorised signatory list', 'KYC of signatories']
  },
  'corporate/bulk-neft-rtgs': {
    requires: 'payment_systems',
    title: 'Bulk NEFT / RTGS',
    tagline: 'Pay hundreds of beneficiaries in one authorised batch.',
    summary: 'Upload a payout batch, authorise it once with your transaction password, and every line gets its own reference number under a single batch reference. Any zero or negative line is rejected before the batch runs.',
    highlights: ['Up to 500 payouts per batch', 'One authorisation for the whole batch', 'Reference number for every line', 'Batch total checked against your balance first'],
    facts: [['Batch size', 'Up to 500 lines'], ['Modes', 'NEFT, RTGS and IMPS'], ['Authorisation', 'Transaction password'], ['Tracking', 'Batch and per-payout references']],
    documents: ['An active AJSPay current account']
  },
  'corporate/trade-finance': {
    title: 'Trade Finance',
    tagline: 'Support for import and export payments.',
    summary: 'Trade facilities such as letters of credit and bank guarantees are arranged case by case with your relationship manager. Raise a request from your corporate member portal account and the team will respond with the documents needed.',
    highlights: ['Letters of credit and guarantees', 'Import and export payment support', 'Handled by a relationship manager', 'Requests raised from NetBanking'],
    facts: [['Availability', 'On request, case by case'], ['Turnaround', 'Confirmed with your manager'], ['Charges', 'Quoted per facility']],
    documents: ['Corporate account and KYC on file', 'Trade documents for the specific transaction']
  },
  'corporate/payroll-services': {
    title: 'Payroll Services',
    tagline: 'Run salary batches from your current account.',
    summary: 'Pay salaries as a single authorised batch each month and give staff AJSPay salary accounts with no minimum balance. Every payout keeps its own reference for your payroll records.',
    highlights: ['Monthly salary batches', 'Zero-balance salary accounts for staff', 'Reference number per employee', 'Exportable payout records'],
    facts: [['Batch size', 'Up to 500 employees'], ['Staff accounts', 'Zero balance with salary credit'], ['Records', 'PDF or Excel export']],
    documents: ['Corporate account', 'Employee list with account details']
  },
  'corporate/cash-management': {
    title: 'Cash Management',
    tagline: 'Collections, payouts and reconciliation in one place.',
    summary: 'See collections and payouts against one account, filter transactions by date, and export statements for reconciliation. Standing instructions cover payments that repeat on a fixed schedule.',
    highlights: ['Collections and payouts together', 'Filter by account and date range', 'Scheduled and repeating payments', 'PDF and Excel exports'],
    facts: [['Statements', 'Any date range'], ['Repeating payments', 'Daily to quarterly'], ['Exports', 'PDF and Excel']],
    documents: ['An active AJSPay current account']
  },

  // ---------------- Loans ----------------
  'loans/home-loan': {
    title: 'Home Loan',
    tagline: 'Buy, build or transfer your home loan.',
    summary: 'Check your EMI with the calculator, then apply online. The application reaches our loan department directly, and you can follow its status from your account.',
    highlights: ['Tenure up to 30 years', 'EMI calculator before you apply', 'Balance transfer accepted', 'Track the application in NetBanking'],
    facts: [['Interest rate', '8.40% – 9.15% p.a.'], ['Processing fee', '0.25%, maximum ₹10,000'], ['Tenure', 'Up to 30 years']],
    documents: ['PAN and Aadhaar', 'Income proof: salary slips or ITR', 'Six months of bank statements', 'Property documents']
  },
  'loans/personal-loan': {
    title: 'Personal Loan',
    tagline: 'For planned expenses, with no security.',
    summary: 'An unsecured loan with a fixed EMI for the full tenure. The eligibility check compares your EMI against your declared monthly income before the application goes forward.',
    highlights: ['No collateral required', 'Fixed EMI throughout', 'Instant eligibility check', 'Tenure of 1 to 5 years'],
    facts: [['Interest rate', '10.50% – 13.50% p.a.'], ['Processing fee', '1.00% of the loan amount'], ['Tenure', '1 to 5 years']],
    documents: ['PAN and Aadhaar', 'Latest salary slips', 'Six months of bank statements']
  },
  'loans/vehicle-loan': {
    title: 'Vehicle Loan',
    tagline: 'For a new or used car or two-wheeler.',
    summary: 'Finance a vehicle with a fixed rate and a flat processing fee. Apply online, and the loan department reviews the application with your income details.',
    highlights: ['New and used vehicles', 'Flat processing fee', 'Tenure up to 7 years', 'Apply online in minutes'],
    facts: [['Interest rate', '8.75% – 9.50% p.a.'], ['Processing fee', '₹1,500 flat'], ['Tenure', 'Up to 7 years']],
    documents: ['PAN and Aadhaar', 'Income proof', 'Vehicle quotation or invoice']
  },
  'loans/gold-loan': {
    title: 'Gold Loan',
    tagline: 'Borrow against gold jewellery, with no processing fee.',
    summary: 'Bring your jewellery to a branch for valuation and receive the loan against it. Rates are the lowest of our secured products and there is no processing fee.',
    highlights: ['Lowest rate of our loan products', 'No processing fee', 'Valuation at the branch', 'Jewellery stored in the branch vault'],
    facts: [['Interest rate', '7.90% – 8.50% p.a.'], ['Processing fee', 'Nil'], ['Valuation', 'At the branch']],
    documents: ['PAN and Aadhaar', 'Gold jewellery for valuation']
  },
  'loans/education-loan': {
    title: 'Education Loan',
    tagline: 'For studies in India or abroad.',
    summary: 'Covers tuition and related costs, with repayment starting after the course period. Apply online with your admission letter and the fee schedule.',
    highlights: ['Courses in India and abroad', 'Repayment begins after the course', 'Tuition and living costs covered', 'Co-applicant income considered'],
    facts: [['Interest rate', '9.15% – 10.25% p.a.'], ['Processing fee', '0.50% of the loan amount'], ['Moratorium', 'Course period plus grace']],
    documents: ['Admission letter and fee schedule', 'PAN and Aadhaar of student and co-applicant', 'Co-applicant income proof', 'Academic records']
  },

  // ---------------- Investments ----------------
  'investments/mutual-funds': {
    requires: 'mutual_funds',
    title: 'Mutual Funds',
    tagline: 'Start a SIP from ₹500 a month.',
    summary: 'Invest in the schemes listed in your account, as a monthly SIP or a lump sum. Each purchase debits your savings account and creates a folio you can follow under Deposits and Investments.',
    highlights: ['SIP from ₹500 a month', 'Equity, hybrid and index schemes', 'Folio visible in your portfolio', 'Debited from your savings account'],
    facts: [['Minimum SIP', '₹500 per month'], ['Schemes', 'Large cap, sectoral, hybrid and index'], ['Holdings', 'Shown in your portfolio']],
    documents: ['An active AJSPay account with completed KYC'],
    note: 'Mutual fund investments carry market risk. Past performance does not indicate future returns. Read the scheme documents before investing.'
  },
  'investments/sovereign-gold-bonds': {
    requires: 'mutual_funds',
    title: 'Sovereign Gold Bonds',
    tagline: 'Gold holdings without storing metal.',
    summary: 'Sovereign Gold Bonds are issued by the Reserve Bank of India in tranches. When a tranche opens, you can place a subscription request from your account and the holding is recorded in your name.',
    highlights: ['Issued by the RBI in tranches', 'No storage or making charges', 'Interest in addition to the gold price', 'Held in your own name'],
    facts: [['Issuer', 'Reserve Bank of India'], ['Availability', 'Only while a tranche is open'], ['Tenure', 'Eight years, exit allowed from the fifth']],
    documents: ['An active AJSPay account with completed KYC']
  },
  'investments/insurance': {
    requires: 'insurance',
    title: 'Insurance',
    tagline: 'Term, health and motor cover.',
    summary: 'Compare the term, health and motor plans listed in your account and start an application. Cover is underwritten by our insurance partners, who assess and issue the policy.',
    highlights: ['Term life, family health and motor cover', 'Plan details and premiums in-app', 'Issued by insurance partners', 'Nominee recorded with the policy'],
    facts: [['Term cover', 'From ₹8,450 a year'], ['Family health floater', 'From ₹14,200 a year'], ['Motor cover', 'From ₹7,100 a year']],
    documents: ['PAN and Aadhaar', 'Health declaration where the plan requires it'],
    note: 'Insurance is underwritten by our partners. Premiums shown are indicative and depend on age, cover and underwriting.'
  },

  // ---------------- Support ----------------
  'support/grievance-redressal': {
    title: 'Grievance Redressal',
    tagline: 'How to raise a complaint and what happens next.',
    summary: 'Raise a complaint from Support inside the member portal and you get a ticket number immediately. Complaints mentioning fraud are marked high priority and routed to the grievance desk first.',
    highlights: ['Ticket number as soon as you file', 'Fraud reports prioritised', 'Track status in your account', 'Escalation if the first response does not resolve it'],
    facts: [['Level 1', 'Grievance Redressal Desk, from the member portal'], ['Level 2', 'Nodal officer at the head office'], ['Toll-free', '9105015464, 24×7'], ['Cyber fraud helpline', '1930']],
    documents: ['Your account details', 'Transaction reference for the disputed entry']
  }
};

export const productAt = (group, slug) => PRODUCTS[`${group}/${slug}`];
