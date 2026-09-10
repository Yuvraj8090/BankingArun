import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { BankThemeProvider } from './context/BankThemeContext';
import Navbar from './components/Navbar';
import Sidebar from './components/Sidebar';
import ChatbotWidget from './components/ChatbotWidget';
import PublicNavbar from './components/PublicNavbar';
import PublicHomePage from './pages/PublicHomePage';
import PublicRatesPage from './pages/PublicRatesPage';
import Dashboard from './pages/Dashboard';
import TransferPage from './pages/TransferPage';
import CardsChequesPage from './pages/CardsChequesPage';
import DepositsInvestmentsPage from './pages/DepositsInvestmentsPage';
import LoansPage from './pages/LoansPage';
import KycAccountPage from './pages/KycAccountPage';
import BranchLocatorPage from './pages/BranchLocatorPage';
import AdminPortal from './pages/AdminPortal';
import BankOwnerPanel from './pages/BankOwnerPanel';
import StaffPanel from './pages/StaffPanel';
import CollectionPanel from './pages/CollectionPanel';
import LoanDeptPanel from './pages/LoanDeptPanel';
import VideoKycPage from './pages/VideoKycPage';
import VideoKycQueuePage from './pages/VideoKycQueuePage';
import SecurityPage from './pages/SecurityPage';
import StatementsPage from './pages/StatementsPage';
import ReferralPage from './pages/ReferralPage';
import StandingInstructionsPage from './pages/StandingInstructionsPage';
import AdminConfigPage from './pages/AdminConfigPage';
import HostingerDeployPage from './pages/HostingerDeployPage';
import AuthPage from './pages/AuthPage';
import { Toaster } from 'sonner';

function MainApp() {
  const { user, loading } = useAuth();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [publicTab, setPublicTab] = useState('home');
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authIsRegister, setAuthIsRegister] = useState(false);

  // Auto-open Open Account with referral code from ?ref= URL param
  React.useEffect(() => {
    try {
      const u = new URL(window.location.href);
      if (u.searchParams.get('ref')) {
        setAuthIsRegister(true);
        setShowAuthModal(true);
      }
    } catch {}
  }, []);

  // Pick a good default tab per role after login
  React.useEffect(() => {
    if (!user) return;
    const roleDefaults = {
      retail: 'dashboard', corporate: 'dashboard',
      admin: 'admin', branch_manager: 'admin',
      bank_owner: 'owner', staff: 'staff',
      collection_agent: 'collection', loan_officer: 'loan-dept'
    };
    setActiveTab(roleDefaults[user.role] || 'dashboard');
  }, [user?.id, user?.role]);

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center text-slate-700 text-sm">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-blue-700 border-t-transparent rounded-full animate-spin"></div>
          <span>Connecting to National Bharat Core Banking Ledger…</span>
        </div>
      </div>
    );
  }

  // Public Portal
  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans selection:bg-blue-100">
        <PublicNavbar
          activePublicTab={publicTab}
          onNavigatePublic={(t) => { setPublicTab(t); setShowAuthModal(false); }}
          onOpenAuth={(isReg) => { setAuthIsRegister(isReg); setShowAuthModal(true); }}
        />

        <main className="flex-1 overflow-y-auto">
          {showAuthModal ? (
            <div className="relative bg-slate-50 min-h-[60vh]">
              <button
                onClick={() => setShowAuthModal(false)}
                data-testid="auth-back-btn"
                className="absolute top-4 right-4 z-20 px-3 py-1.5 rounded-md bg-white border border-slate-200 text-slate-600 text-xs hover:text-slate-900 hover:border-slate-300 shadow-sm"
              >
                ← Back to Public Portal
              </button>
              <AuthPage onSuccess={() => setShowAuthModal(false)} defaultIsRegister={authIsRegister} />
            </div>
          ) : (
            <>
              {publicTab === 'home' && (
                <PublicHomePage
                  onOpenAuth={(isReg) => { setAuthIsRegister(isReg); setShowAuthModal(true); }}
                  onNavigatePublic={(t) => setPublicTab(t)}
                />
              )}
              {publicTab === 'rates' && (
                <PublicRatesPage onOpenAuth={(isReg) => { setAuthIsRegister(isReg); setShowAuthModal(true); }} />
              )}
              {publicTab === 'branches' && (
                <div className="pt-6 bg-slate-50"><BranchLocatorPage /></div>
              )}
              {publicTab === 'hostinger' && (
                <div className="pt-6 bg-slate-50"><HostingerDeployPage /></div>
              )}
            </>
          )}
        </main>

        <PublicFooter />
        <ChatbotWidget />
        <Toaster position="top-right" richColors theme="light" />
      </div>
    );
  }

  // Authenticated Portal
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans selection:bg-blue-100">
      <Navbar onNavigate={(tab) => setActiveTab(tab)} activeTab={activeTab} />
      <div className="flex-1 flex flex-col md:flex-row">
        <Sidebar activeTab={activeTab} onSelectTab={(tab) => setActiveTab(tab)} />
        <main className="flex-1 overflow-y-auto bg-slate-50">
          {activeTab === 'dashboard' && <Dashboard onNavigate={(tab) => setActiveTab(tab)} />}
          {activeTab === 'transfer' && <TransferPage />}
          {activeTab === 'cards' && <CardsChequesPage />}
          {activeTab === 'deposits' && <DepositsInvestmentsPage />}
          {activeTab === 'loans' && <LoansPage />}
          {activeTab === 'kyc' && <KycAccountPage />}
          {activeTab === 'locator' && <BranchLocatorPage />}
          {activeTab === 'admin' && <AdminPortal />}
          {activeTab === 'owner' && <BankOwnerPanel />}
          {activeTab === 'staff' && <StaffPanel />}
          {activeTab === 'collection' && <CollectionPanel />}
          {activeTab === 'loan-dept' && <LoanDeptPanel />}
          {activeTab === 'video-kyc' && <VideoKycPage />}
          {activeTab === 'video-kyc-queue' && <VideoKycQueuePage />}
          {activeTab === 'security' && <SecurityPage />}
          {activeTab === 'statements' && <StatementsPage />}
          {activeTab === 'referrals' && <ReferralPage />}
          {activeTab === 'standing-instructions' && <StandingInstructionsPage />}
          {activeTab === 'admin-config' && <AdminConfigPage />}
          {activeTab === 'hostinger' && <HostingerDeployPage />}
        </main>
      </div>
      <ChatbotWidget />
      <Toaster position="top-right" richColors theme="light" />
    </div>
  );
}

function PublicFooter() {
  return (
    <footer className="bg-slate-900 text-slate-300 mt-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 grid grid-cols-2 md:grid-cols-4 gap-8 text-xs">
        <div className="col-span-2 md:col-span-1">
          <h4 className="text-white font-semibold mb-3 text-sm">National Bharat Bank</h4>
          <p className="text-slate-400 leading-relaxed">
            A demo core-banking suite modelled on SBI YONO, ICICI iMobile & HDFC NetBanking. RBI Master Direction compliant architecture.
          </p>
        </div>
        <div>
          <h4 className="text-white font-semibold mb-3">Personal Banking</h4>
          <ul className="space-y-1.5 text-slate-400">
            <li>Savings Account</li>
            <li>Fixed Deposits</li>
            <li>Home / Personal Loans</li>
            <li>Debit &amp; Credit Cards</li>
          </ul>
        </div>
        <div>
          <h4 className="text-white font-semibold mb-3">Corporate</h4>
          <ul className="space-y-1.5 text-slate-400">
            <li>Current Accounts</li>
            <li>Bulk NEFT / RTGS</li>
            <li>Trade Finance</li>
            <li>Cash Management</li>
          </ul>
        </div>
        <div>
          <h4 className="text-white font-semibold mb-3">Support</h4>
          <ul className="space-y-1.5 text-slate-400">
            <li>Toll-Free: 1800-123-4567</li>
            <li>customercare@nbbank.in</li>
            <li>Branch &amp; ATM Locator</li>
            <li>Grievance Redressal</li>
          </ul>
        </div>
      </div>
      <div className="border-t border-slate-800 py-4 text-center text-[11px] text-slate-500">
        © 2026 National Bharat Bank Ltd. All Rights Reserved. Deposits insured by DICGC up to ₹5 Lakh.
      </div>
    </footer>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BankThemeProvider>
        <MainApp />
      </BankThemeProvider>
    </AuthProvider>
  );
}
