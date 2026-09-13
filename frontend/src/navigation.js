import {
  LayoutDashboard, ArrowRightLeft, CreditCard, PiggyBank, Banknote,
  FileBadge2, MapPin, ShieldAlert, Globe, Crown, Users, Wallet,
  GanttChartSquare, Building2, Video, ShieldCheck, FileText, Gift, Repeat, Settings2
} from 'lucide-react';

// Role → sidebar menu. The same list is the access rule for /app/* URLs:
// a role may only open the tabs listed here (plus ALWAYS_ALLOWED below).
export const NAV_BY_ROLE = {
  retail: [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, testId: 'tab-dashboard' },
    { id: 'transfer', label: 'Transfers', icon: ArrowRightLeft, testId: 'tab-transfer' },
    { id: 'cards', label: 'Cards & UPI', icon: CreditCard, testId: 'tab-cards' },
    { id: 'deposits', label: 'Deposits', icon: PiggyBank, testId: 'tab-deposits' },
    { id: 'loans', label: 'Loans', icon: Banknote, testId: 'tab-loans' },
    { id: 'standing-instructions', label: 'Standing Instructions', icon: Repeat, testId: 'tab-si' },
    { id: 'referrals', label: 'Refer & Earn', icon: Gift, testId: 'tab-referrals' },
    { id: 'statements', label: 'Statements (PDF/Excel)', icon: FileText, testId: 'tab-statements' },
    { id: 'video-kyc', label: 'Video KYC', icon: Video, testId: 'tab-video-kyc' },
    { id: 'security', label: 'Security & Passkeys', icon: ShieldCheck, testId: 'tab-security' },
    { id: 'kyc', label: 'KYC / Profile', icon: FileBadge2, testId: 'tab-kyc' },
    { id: 'branches', label: 'Branch & ATM', icon: MapPin, testId: 'tab-locator' }
  ],
  corporate: [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, testId: 'tab-dashboard' },
    { id: 'transfer', label: 'Bulk Transfers', icon: ArrowRightLeft, testId: 'tab-transfer' },
    { id: 'cards', label: 'Cards & UPI', icon: CreditCard, testId: 'tab-cards' },
    { id: 'deposits', label: 'Treasury', icon: PiggyBank, testId: 'tab-deposits' },
    { id: 'loans', label: 'Trade Finance', icon: Banknote, testId: 'tab-loans' },
    { id: 'standing-instructions', label: 'Standing Instructions', icon: Repeat, testId: 'tab-si' },
    { id: 'statements', label: 'Statements (PDF/Excel)', icon: FileText, testId: 'tab-statements' },
    { id: 'security', label: 'Security & Passkeys', icon: ShieldCheck, testId: 'tab-security' },
    { id: 'kyc', label: 'Corporate KYC', icon: FileBadge2, testId: 'tab-kyc' },
    { id: 'branches', label: 'Branch & ATM', icon: MapPin, testId: 'tab-locator' }
  ],
  admin: [
    { id: 'admin', label: 'Branch Overview', icon: ShieldAlert, testId: 'tab-admin' },
    { id: 'staff', label: 'Staff Console', icon: Users, testId: 'tab-staff' },
    { id: 'loan-dept', label: 'Loan Pipeline', icon: GanttChartSquare, testId: 'tab-loan-dept' },
    { id: 'collection', label: 'Collections', icon: Wallet, testId: 'tab-collection' },
    { id: 'video-kyc-queue', label: 'Video KYC Queue', icon: Video, testId: 'tab-vkyc-queue' },
    { id: 'branches', label: 'Branch & ATM', icon: MapPin, testId: 'tab-locator' },
    { id: 'hostinger', label: 'Hostinger Package', icon: Globe, testId: 'tab-hostinger', highlight: true }
  ],
  branch_manager: [
    { id: 'admin', label: 'Branch Overview', icon: ShieldAlert, testId: 'tab-admin' },
    { id: 'staff', label: 'Staff Console', icon: Users, testId: 'tab-staff' },
    { id: 'loan-dept', label: 'Loan Pipeline', icon: GanttChartSquare, testId: 'tab-loan-dept' },
    { id: 'collection', label: 'Collections', icon: Wallet, testId: 'tab-collection' },
    { id: 'video-kyc-queue', label: 'Video KYC Queue', icon: Video, testId: 'tab-vkyc-queue' },
    { id: 'branches', label: 'Branch & ATM', icon: MapPin, testId: 'tab-locator' }
  ],
  bank_owner: [
    { id: 'owner', label: 'Executive Dashboard', icon: Crown, testId: 'tab-owner' },
    { id: 'admin-config', label: 'System Config (Twilio/SendGrid)', icon: Settings2, testId: 'tab-admin-config' },
    { id: 'admin', label: 'All Branches', icon: Building2, testId: 'tab-admin' },
    { id: 'staff', label: 'Staff Console', icon: Users, testId: 'tab-staff' },
    { id: 'loan-dept', label: 'Loan Pipeline', icon: GanttChartSquare, testId: 'tab-loan-dept' },
    { id: 'collection', label: 'Collections', icon: Wallet, testId: 'tab-collection' },
    { id: 'video-kyc-queue', label: 'Video KYC Queue', icon: Video, testId: 'tab-vkyc-queue' },
    { id: 'hostinger', label: 'Hostinger Package', icon: Globe, testId: 'tab-hostinger', highlight: true }
  ],
  staff: [
    { id: 'staff', label: 'Customer Console', icon: Users, testId: 'tab-staff' },
    { id: 'kyc', label: 'KYC Verification', icon: FileBadge2, testId: 'tab-kyc' },
    { id: 'transfer', label: 'Process Transfer', icon: ArrowRightLeft, testId: 'tab-transfer' },
    { id: 'branches', label: 'Branch & ATM', icon: MapPin, testId: 'tab-locator' }
  ],
  collection_agent: [
    { id: 'collection', label: 'Collection Cases', icon: Wallet, testId: 'tab-collection' },
    { id: 'branches', label: 'Branch & ATM', icon: MapPin, testId: 'tab-locator' }
  ],
  loan_officer: [
    { id: 'loan-dept', label: 'Loan Pipeline', icon: GanttChartSquare, testId: 'tab-loan-dept' },
    { id: 'loans', label: 'EMI Calculator', icon: Banknote, testId: 'tab-loans' },
    { id: 'kyc', label: 'Applicant KYC', icon: FileBadge2, testId: 'tab-kyc' }
  ]
};

// Reachable from the profile menu rather than the sidebar.
export const ALWAYS_ALLOWED = ['kyc', 'security'];

export const ROLE_HOME = {
  retail: 'dashboard', corporate: 'dashboard', admin: 'admin', branch_manager: 'admin',
  bank_owner: 'owner', staff: 'staff', collection_agent: 'collection', loan_officer: 'loan-dept'
};

export const ROLE_LABEL = {
  retail: 'Customer', corporate: 'Corporate', admin: 'Branch Manager',
  branch_manager: 'Branch Manager', bank_owner: 'Bank Owner',
  staff: 'Staff / Teller', collection_agent: 'Collections', loan_officer: 'Loan Officer'
};

export const navFor = (role) => NAV_BY_ROLE[role] || NAV_BY_ROLE.retail;
export const homeFor = (role) => `/app/${ROLE_HOME[role] || 'dashboard'}`;
export const canOpen = (role, tab) =>
  ALWAYS_ALLOWED.includes(tab) || navFor(role).some((item) => item.id === tab);
