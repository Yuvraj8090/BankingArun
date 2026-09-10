import React from 'react';
import {
  LayoutDashboard, ArrowRightLeft, CreditCard, PiggyBank, Banknote,
  FileBadge2, MapPin, HeadphonesIcon, ShieldAlert, Globe,
  Crown, Users, Wallet, GanttChartSquare, Gauge, Building2,
  Video, ShieldCheck, FileText, Gift, Repeat, Settings2
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

// Role → nav configuration (icon-heavy)
const NAV_BY_ROLE = {
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
    { id: 'locator', label: 'Branch & ATM', icon: MapPin, testId: 'tab-locator' },
    { id: 'hostinger', label: 'Hostinger Package', icon: Globe, testId: 'tab-hostinger', highlight: true }
  ],
  corporate: [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, testId: 'tab-dashboard' },
    { id: 'transfer', label: 'Bulk Transfers', icon: ArrowRightLeft, testId: 'tab-transfer' },
    { id: 'cards', label: 'Cards & UPI', icon: CreditCard, testId: 'tab-cards' },
    { id: 'deposits', label: 'Treasury', icon: PiggyBank, testId: 'tab-deposits' },
    { id: 'loans', label: 'Trade Finance', icon: Banknote, testId: 'tab-loans' },
    { id: 'statements', label: 'Statements (PDF/Excel)', icon: FileText, testId: 'tab-statements' },
    { id: 'security', label: 'Security & Passkeys', icon: ShieldCheck, testId: 'tab-security' },
    { id: 'kyc', label: 'Corporate KYC', icon: FileBadge2, testId: 'tab-kyc' },
    { id: 'locator', label: 'Branch & ATM', icon: MapPin, testId: 'tab-locator' }
  ],
  admin: [
    { id: 'admin', label: 'Branch Overview', icon: ShieldAlert, testId: 'tab-admin' },
    { id: 'staff', label: 'Staff Console', icon: Users, testId: 'tab-staff' },
    { id: 'loan-dept', label: 'Loan Pipeline', icon: GanttChartSquare, testId: 'tab-loan-dept' },
    { id: 'collection', label: 'Collections', icon: Wallet, testId: 'tab-collection' },
    { id: 'video-kyc-queue', label: 'Video KYC Queue', icon: Video, testId: 'tab-vkyc-queue' },
    { id: 'locator', label: 'Branch & ATM', icon: MapPin, testId: 'tab-locator' },
    { id: 'hostinger', label: 'Hostinger Package', icon: Globe, testId: 'tab-hostinger', highlight: true }
  ],
  branch_manager: [
    { id: 'admin', label: 'Branch Overview', icon: ShieldAlert, testId: 'tab-admin' },
    { id: 'staff', label: 'Staff Console', icon: Users, testId: 'tab-staff' },
    { id: 'loan-dept', label: 'Loan Pipeline', icon: GanttChartSquare, testId: 'tab-loan-dept' },
    { id: 'collection', label: 'Collections', icon: Wallet, testId: 'tab-collection' },
    { id: 'video-kyc-queue', label: 'Video KYC Queue', icon: Video, testId: 'tab-vkyc-queue' },
    { id: 'locator', label: 'Branch & ATM', icon: MapPin, testId: 'tab-locator' }
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
    { id: 'locator', label: 'Branch & ATM', icon: MapPin, testId: 'tab-locator' }
  ],
  collection_agent: [
    { id: 'collection', label: 'Collection Cases', icon: Wallet, testId: 'tab-collection' },
    { id: 'locator', label: 'Branch & ATM', icon: MapPin, testId: 'tab-locator' }
  ],
  loan_officer: [
    { id: 'loan-dept', label: 'Loan Pipeline', icon: GanttChartSquare, testId: 'tab-loan-dept' },
    { id: 'loans', label: 'EMI Calculator', icon: Banknote, testId: 'tab-loans' },
    { id: 'kyc', label: 'Applicant KYC', icon: FileBadge2, testId: 'tab-kyc' }
  ]
};

const ROLE_LABEL = {
  retail: 'Customer', corporate: 'Corporate', admin: 'Branch Manager',
  branch_manager: 'Branch Manager', bank_owner: 'Bank Owner',
  staff: 'Staff / Teller', collection_agent: 'Collections',
  loan_officer: 'Loan Officer'
};

export default function Sidebar({ activeTab, onSelectTab }) {
  const { user } = useAuth();
  const role = user?.role || 'retail';
  const navItems = NAV_BY_ROLE[role] || NAV_BY_ROLE.retail;

  return (
    <aside className="w-64 bg-white border-r border-slate-200 flex flex-col justify-between p-4 shrink-0 min-h-[calc(100vh-4rem)]">
      <div className="space-y-1">
        <div className="px-3 py-2 flex items-center gap-2">
          <div className="w-1 h-4 bg-[#0b3b8c] rounded" />
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
            {ROLE_LABEL[role] || 'Banking'} Menu
          </p>
        </div>

        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              data-testid={item.testId}
              onClick={() => onSelectTab(item.id)}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-md text-xs font-medium transition ${
                isActive
                  ? 'bg-[#0b3b8c] text-white shadow-sm font-semibold'
                  : item.highlight
                  ? 'bg-blue-50 text-[#0b3b8c] border border-blue-100 hover:bg-blue-100'
                  : 'text-slate-700 hover:text-[#0b3b8c] hover:bg-slate-50'
              }`}
            >
              <Icon className={`w-4 h-4 ${isActive ? 'text-white' : item.highlight ? 'text-[#0b3b8c]' : 'text-slate-500'}`} />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* Support card */}
      <div className="mt-6 p-3 rounded-md bg-slate-50 border border-slate-200 text-slate-700 text-[11px] space-y-2">
        <div className="flex items-center gap-2 text-[#0b3b8c] font-semibold">
          <HeadphonesIcon className="w-3.5 h-3.5" /> 24×7 Banking Help
        </div>
        <p className="text-slate-600">Toll-Free: <strong className="text-slate-900">1800 11 2211</strong></p>
        <p className="text-slate-600">Cyber Fraud: <strong className="text-[#c8102e]">1930</strong></p>
        <div className="pt-2 border-t border-slate-200 flex items-center justify-between text-[10px] text-slate-500">
          <span>Session Active</span>
          <span className="flex items-center gap-1 text-emerald-600">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Encrypted
          </span>
        </div>
      </div>
    </aside>
  );
}
