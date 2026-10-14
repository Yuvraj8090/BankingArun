// Content for the public product pages behind the navbar and footer links.
// Each key is a real URL: /personal/savings-account, /loans/home-loan, and so on.
export const GROUP_LABEL = {
  personal: 'Personal Banking',
  loans: 'Loans',
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
  // ---------------- Loans ----------------
  'loans/home-loan': {
    title: 'Home Loan',
    tagline: 'Buy, build or transfer your home loan.',
    summary: 'Check your EMI with the calculator, then apply online. The application reaches our loan department directly, and you can follow its status from your account.',
    highlights: ['Tenure up to 30 years', 'EMI calculator before you apply', 'Balance transfer accepted', 'Track the application in NetBanking'],
    facts: [['Interest rate', '8.40% – 9.15% p.a.'], ['Processing fee', '0.25%, maximum ₹10,000'], ['Tenure', 'Up to 30 years']],
    documents: ['PAN and Aadhaar', 'Income proof: salary slips or ITR', 'Six months of bank statements', 'Property documents']
  },
  'loans/gold-loan': {
    title: 'Gold Loan',
    tagline: 'Borrow against gold jewellery, with no processing fee.',
    summary: 'Bring your jewellery to a branch for valuation and receive the loan against it. Rates are the lowest of our secured products and there is no processing fee.',
    highlights: ['Lowest rate of our loan products', 'No processing fee', 'Valuation at the branch', 'Jewellery stored in the branch vault'],
    facts: [['Interest rate', '7.90% – 8.50% p.a.'], ['Processing fee', 'Nil'], ['Valuation', 'At the branch']],
    documents: ['PAN and Aadhaar', 'Gold jewellery for valuation']
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
