import {
  LayoutDashboard, ArrowRightLeft, PiggyBank, Banknote,
  FileBadge2, MapPin, ShieldAlert, Globe, Crown, Users, Wallet,
  GanttChartSquare, Building2, Video, ShieldCheck, FileText, Repeat, Settings2,
  Layers, ClipboardList, Contact2, BarChart3, BookUser, FileLock2, Gavel, Award, Radio,
  SlidersHorizontal, Eye, LifeBuoy, KeyRound
} from 'lucide-react';

// Role → sidebar menu. A role not listed here (the legacy 'corporate' login) gets the
// member menu: a Nidhi's members are individuals, so there is no separate corporate one. The same list is the access rule for /app/* URLs:
// a role may only open the tabs listed here (plus ALWAYS_ALLOWED below).
export const NAV_BY_ROLE = {
  retail: [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, testId: 'tab-dashboard' },
    { id: 'transfer', label: 'Transfers', icon: ArrowRightLeft, testId: 'tab-transfer' },
    { id: 'deposits', label: 'Deposits', icon: PiggyBank, testId: 'tab-deposits' },
    { id: 'loans', label: 'Loans', icon: Banknote, testId: 'tab-loans' },
    { id: 'standing-instructions', label: 'Standing Instructions', icon: Repeat, testId: 'tab-si' },
    { id: 'referrals', label: 'My Network', icon: Users, testId: 'tab-referrals' },
    { id: 'statements', label: 'Statements (PDF/Excel)', icon: FileText, testId: 'tab-statements' },
    { id: 'video-kyc', label: 'Video KYC', icon: Video, testId: 'tab-video-kyc' },
    { id: 'security', label: 'Security & Passkeys', icon: ShieldCheck, testId: 'tab-security' },
    { id: 'kyc', label: 'KYC / Profile', icon: FileBadge2, testId: 'tab-kyc' },
    { id: 'branches', label: 'Branches', icon: MapPin, testId: 'tab-locator' },
    { id: 'support', label: 'Help & Support', icon: LifeBuoy, testId: 'tab-support' }
  ],
  // Grouped into sections (Sidebar.js draws a heading where `group` changes):
  // every banking product is set up under "Deposits & plans", and the referral
  // network, which carries no money (Nidhi Rules 2014, rule 6), on its own.
  admin: [
    { id: 'admin', label: 'Branch Overview', icon: ShieldAlert, testId: 'tab-admin', group: 'Overview' },
    { id: 'branches', label: 'Branches', icon: MapPin, testId: 'tab-locator', group: 'Overview' },
    { id: 'schemes', label: 'Scheme Master (FD / RD / plans)', icon: Layers, testId: 'tab-schemes', group: 'Deposits & plans' },
    { id: 'book-deposit', label: 'Book Member Deposit', icon: PiggyBank, testId: 'tab-book-deposit', group: 'Deposits & plans' },
    { id: 'staff', label: 'Staff Console', icon: Users, testId: 'tab-staff', group: 'Deposits & plans' },
    { id: 'agents', label: 'Field Agents (cash collected)', icon: ClipboardList, testId: 'tab-agents', group: 'Deposits & plans' },
    { id: 'loan-dept', label: 'Loan Pipeline', icon: GanttChartSquare, testId: 'tab-loan-dept', group: 'Loans' },
    { id: 'collection', label: 'Loan Recovery', icon: Wallet, testId: 'tab-collection', group: 'Loans' },
    { id: 'crm', label: 'Relationship Desk', icon: Contact2, testId: 'tab-crm', group: 'Members' },
    { id: 'support', label: 'Support Tickets', icon: LifeBuoy, testId: 'tab-support', group: 'Members' },
    { id: 'lockers', label: 'Lockers', icon: KeyRound, testId: 'tab-lockers', group: 'Members' },
    { id: 'member-register', label: 'Member Register', icon: BookUser, testId: 'tab-member-register', group: 'Members' },
    { id: 'video-kyc-queue', label: 'Video KYC Queue', icon: Video, testId: 'tab-vkyc-queue', group: 'Members' },
    { id: 'grievance', label: 'Grievance Queue', icon: Gavel, testId: 'tab-grievance', group: 'Members' },
    { id: 'data-requests', label: 'Data Requests', icon: FileLock2, testId: 'tab-data-requests', group: 'Members' },
    { id: 'reports', label: 'Reports', icon: BarChart3, testId: 'tab-reports', group: 'Compliance & reports' },
    { id: 'screening', label: 'Sanctions Screening', icon: ShieldAlert, testId: 'tab-screening', group: 'Compliance & reports' }
  ],
  branch_manager: [
    { id: 'admin', label: 'Branch Overview', icon: ShieldAlert, testId: 'tab-admin', group: 'Overview' },
    { id: 'branches', label: 'Branches', icon: MapPin, testId: 'tab-locator', group: 'Overview' },
    { id: 'schemes', label: 'Scheme Master (FD / RD / plans)', icon: Layers, testId: 'tab-schemes', group: 'Deposits & plans' },
    { id: 'book-deposit', label: 'Book Member Deposit', icon: PiggyBank, testId: 'tab-book-deposit', group: 'Deposits & plans' },
    { id: 'staff', label: 'Staff Console', icon: Users, testId: 'tab-staff', group: 'Deposits & plans' },
    { id: 'agents', label: 'Field Agents (cash collected)', icon: ClipboardList, testId: 'tab-agents', group: 'Deposits & plans' },
    { id: 'loan-dept', label: 'Loan Pipeline', icon: GanttChartSquare, testId: 'tab-loan-dept', group: 'Loans' },
    { id: 'collection', label: 'Loan Recovery', icon: Wallet, testId: 'tab-collection', group: 'Loans' },
    { id: 'crm', label: 'Relationship Desk', icon: Contact2, testId: 'tab-crm', group: 'Members' },
    { id: 'support', label: 'Support Tickets', icon: LifeBuoy, testId: 'tab-support', group: 'Members' },
    { id: 'lockers', label: 'Lockers', icon: KeyRound, testId: 'tab-lockers', group: 'Members' },
    { id: 'member-register', label: 'Member Register', icon: BookUser, testId: 'tab-member-register', group: 'Members' },
    { id: 'video-kyc-queue', label: 'Video KYC Queue', icon: Video, testId: 'tab-vkyc-queue', group: 'Members' },
    { id: 'grievance', label: 'Grievance Queue', icon: Gavel, testId: 'tab-grievance', group: 'Members' },
    { id: 'data-requests', label: 'Data Requests', icon: FileLock2, testId: 'tab-data-requests', group: 'Members' },
    { id: 'reports', label: 'Reports', icon: BarChart3, testId: 'tab-reports', group: 'Compliance & reports' },
    { id: 'screening', label: 'Sanctions Screening', icon: ShieldAlert, testId: 'tab-screening', group: 'Compliance & reports' }
  ],
  bank_owner: [
    { id: 'owner', label: 'Executive Dashboard', icon: Crown, testId: 'tab-owner', group: 'Overview' },
    { id: 'admin', label: 'All Branches', icon: Building2, testId: 'tab-admin', group: 'Overview' },
    { id: 'security-center', label: 'Security Centre', icon: ShieldCheck, testId: 'tab-security-center', highlight: true, group: 'Overview' },
    { id: 'schemes', label: 'Scheme Master (FD / RD / plans)', icon: Layers, testId: 'tab-schemes', group: 'Deposits & plans' },
    { id: 'book-deposit', label: 'Book Member Deposit', icon: PiggyBank, testId: 'tab-book-deposit', group: 'Deposits & plans' },
    { id: 'staff', label: 'Staff Console', icon: Users, testId: 'tab-staff', group: 'Deposits & plans' },
    { id: 'agents', label: 'Field Agents (cash collected)', icon: ClipboardList, testId: 'tab-agents', group: 'Deposits & plans' },
    { id: 'loan-dept', label: 'Loan Pipeline', icon: GanttChartSquare, testId: 'tab-loan-dept', group: 'Loans' },
    { id: 'collection', label: 'Loan Recovery', icon: Wallet, testId: 'tab-collection', group: 'Loans' },
    { id: 'crm', label: 'Relationship Desk', icon: Contact2, testId: 'tab-crm', group: 'Members' },
    { id: 'support', label: 'Support Tickets', icon: LifeBuoy, testId: 'tab-support', group: 'Members' },
    { id: 'lockers', label: 'Lockers', icon: KeyRound, testId: 'tab-lockers', group: 'Members' },
    { id: 'member-register', label: 'Member Register', icon: BookUser, testId: 'tab-member-register', group: 'Members' },
    { id: 'video-kyc-queue', label: 'Video KYC Queue', icon: Video, testId: 'tab-vkyc-queue', group: 'Members' },
    { id: 'support-view', label: 'View as Member (read-only)', icon: Eye, testId: 'tab-support-view', group: 'Members' },
    { id: 'grievance', label: 'Grievance Queue', icon: Gavel, testId: 'tab-grievance', group: 'Members' },
    { id: 'data-requests', label: 'Data Requests', icon: FileLock2, testId: 'tab-data-requests', group: 'Members' },
    { id: 'member-ranks', label: 'Member Standings', icon: Award, testId: 'tab-member-ranks', group: 'Network (recognition only, no money)' },
    { id: 'reports', label: 'Reports', icon: BarChart3, testId: 'tab-reports', group: 'Compliance & reports' },
    { id: 'fraud', label: 'Fraud & AML Review', icon: ShieldAlert, testId: 'tab-fraud', group: 'Compliance & reports' },
    { id: 'screening', label: 'Sanctions Screening', icon: ShieldAlert, testId: 'tab-screening', group: 'Compliance & reports' },
    { id: 'branch-admin', label: 'Branch Network', icon: MapPin, testId: 'tab-branch-admin', group: 'Settings' },
    { id: 'public-pages', label: 'Public Pages', icon: FileText, testId: 'tab-public-pages', group: 'Settings' },
    { id: 'parameters', label: 'Business Parameters', icon: SlidersHorizontal, testId: 'tab-parameters', group: 'Settings' },
    { id: 'rails', label: 'Payment Rails', icon: Radio, testId: 'tab-rails', group: 'Settings' },
    { id: 'admin-config', label: 'System Config (SMS, email, Claude)', icon: Settings2, testId: 'tab-admin-config', group: 'Settings' }
  ],
  staff: [
    { id: 'staff', label: 'Customer Console', icon: Users, testId: 'tab-staff' },
    { id: 'crm', label: 'Relationship Desk', icon: Contact2, testId: 'tab-crm' },
    { id: 'support', label: 'Support Tickets', icon: LifeBuoy, testId: 'tab-support' },
    { id: 'lockers', label: 'Lockers', icon: KeyRound, testId: 'tab-lockers' },
    { id: 'book-deposit', label: 'Book Member Deposit', icon: PiggyBank, testId: 'tab-book-deposit' },
    { id: 'member-register', label: 'Member Register', icon: BookUser, testId: 'tab-member-register' },
    { id: 'reports', label: 'Reports', icon: BarChart3, testId: 'tab-reports' },
    { id: 'agents', label: 'Agents & Collections', icon: ClipboardList, testId: 'tab-agents' },
    { id: 'kyc', label: 'KYC Verification', icon: FileBadge2, testId: 'tab-kyc' },
    { id: 'transfer', label: 'Process Transfer', icon: ArrowRightLeft, testId: 'tab-transfer' },
    { id: 'branches', label: 'Branches', icon: MapPin, testId: 'tab-locator' }
  ],
  collection_agent: [
    { id: 'collection', label: 'Collection Cases', icon: Wallet, testId: 'tab-collection' },
    { id: 'branches', label: 'Branches', icon: MapPin, testId: 'tab-locator' }
  ],
  loan_officer: [
    { id: 'loan-dept', label: 'Loan Pipeline', icon: GanttChartSquare, testId: 'tab-loan-dept' },
    { id: 'reports', label: 'Reports', icon: BarChart3, testId: 'tab-reports' },
    { id: 'loans', label: 'EMI Calculator', icon: Banknote, testId: 'tab-loans' }
  ]
};

// Reachable from the profile menu rather than the sidebar.
export const ALWAYS_ALLOWED = ['kyc', 'security', 'help'];

export const ROLE_HOME = {
  retail: 'dashboard', corporate: 'dashboard', admin: 'admin', branch_manager: 'admin',
  bank_owner: 'owner', staff: 'staff', collection_agent: 'collection', loan_officer: 'loan-dept'
};

export const ROLE_LABEL = {
  retail: 'Customer', corporate: 'Corporate', admin: 'Branch Manager',
  branch_manager: 'Branch Manager', bank_owner: 'Director',
  staff: 'Staff / Teller', collection_agent: 'Collections', loan_officer: 'Loan Officer'
};

// `features` is the list of regulated capabilities this institution is
// currently authorised to offer (see hostinger/modules/compliance.php). A tab
// whose `requires` is not in that list is hidden and its URL is not openable,
// so members are never shown a service the server would refuse.
const allowed = (item, features) =>
  !item.requires || !Array.isArray(features) || features.includes(item.requires);

export const navFor = (role, features) =>
  (NAV_BY_ROLE[role] || NAV_BY_ROLE.retail).filter((item) => allowed(item, features));
export const homeFor = (role) => `/app/${ROLE_HOME[role] || 'dashboard'}`;
export const canOpen = (role, tab, features) =>
  ALWAYS_ALLOWED.includes(tab) || navFor(role, features).some((item) => item.id === tab);
