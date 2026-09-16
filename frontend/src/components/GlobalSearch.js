import React, { useMemo } from 'react';
import { NAV_BY_ROLE, ALWAYS_ALLOWED, navFor } from '../navigation';
import SearchBox from './SearchBox';

// What members actually type. The sidebar label is rarely the word that comes
// to mind first — someone looking for Transfers types "send money", and someone
// looking for Deposits types "fd" or "rd".
const KEYWORDS = {
  dashboard: ['home', 'overview', 'summary', 'balance', 'account'],
  transfer: ['send money', 'payment', 'pay', 'neft', 'rtgs', 'imps', 'remit', 'beneficiary', 'payee'],
  cards: ['card', 'debit', 'atm card', 'upi', 'qr', 'pin', 'cheque', 'chequebook'],
  deposits: ['fd', 'rd', 'fixed deposit', 'recurring deposit', 'savings', 'investment', 'maturity', 'scheme'],
  loans: ['loan', 'emi', 'interest', 'borrow', 'repayment', 'installment', 'instalment'],
  'standing-instructions': ['si', 'auto pay', 'autopay', 'recurring payment', 'scheduled transfer', 'mandate'],
  referrals: ['refer', 'invite', 'reward', 'bonus'],
  statements: ['statement', 'passbook', 'history', 'transactions', 'pdf', 'excel', 'download', 'receipt'],
  'video-kyc': ['vkyc', 'video verification', 'live kyc'],
  security: ['password', 'passkey', 'otp', '2fa', 'two factor', 'login', 'device', 'privacy'],
  kyc: ['profile', 'aadhaar', 'pan', 'address proof', 'document', 'nominee'],
  branches: ['branch', 'atm', 'locator', 'nearby', 'address', 'ifsc'],
  admin: ['branch overview', 'manage', 'approvals', 'staff'],
  crm: ['relationship', 'customer', 'lead', 'follow up', 'ticket'],
  'member-register': ['member', 'register', 'enrol', 'enroll', 'shareholder'],
  collection: ['collection', 'recovery', 'overdue', 'default', 'arrears'],
  'loan-dept': ['loan pipeline', 'sanction', 'disbursement', 'application'],
  reports: ['report', 'mis', 'analytics', 'export'],
  owner: ['director', 'board', 'owner'],
  staff: ['teller', 'cash', 'counter'],
  grievance: ['complaint', 'grievance', 'dispute', 'escalation', 'ombudsman'],
  'data-requests': ['dpdp', 'data request', 'erasure', 'consent', 'privacy request'],
  screening: ['aml', 'sanctions', 'pep', 'watchlist', 'screening'],
  'fraud-monitor': ['fraud', 'suspicious', 'alert', 'risk'],
  'branch-admin': ['branch', 'atm', 'network', 'locator', 'location', 'add branch', 'edit branch']
};

// Every id the app knows about, so pages reachable from the profile menu
// rather than the sidebar are searchable too.
const ENTRIES = Object.values(NAV_BY_ROLE)
  .flat()
  .reduce((acc, item) => ({ ...acc, [item.id]: item }), {});

export default function GlobalSearch({ role, features, onNavigate }) {
  // Role and features decide the result set, so search can never offer a page
  // the router would bounce the member away from.
  const items = useMemo(() => {
    const ids = new Set(navFor(role, features).map((item) => item.id));
    ALWAYS_ALLOWED.forEach((id) => ids.add(id));
    return [...ids]
      .map((id) => ENTRIES[id])
      .filter(Boolean)
      .map((entry) => ({ key: entry.id, label: entry.label, icon: entry.icon, keywords: KEYWORDS[entry.id] }));
  }, [role, features]);

  return (
    <SearchBox
      items={items}
      onPick={(item) => onNavigate(item.key)}
      placeholder="Search payees, transactions, services…"
      testId="global-search"
    />
  );
}
