import React, { useEffect, useState } from 'react';
import {
  BrowserRouter, Routes, Route, Navigate, Outlet, Link,
  useLocation, useNavigate, useParams, useSearchParams
} from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { BankThemeProvider } from './context/BankThemeContext';
import { canOpen, homeFor } from './navigation';
import { api } from './services/api';
import Brand from './components/Brand';
import Navbar from './components/Navbar';
import Sidebar from './components/Sidebar';
import ChatbotWidget from './components/ChatbotWidget';
import PublicNavbar from './components/PublicNavbar';
import PublicHomePage from './pages/PublicHomePage';
import PublicRatesPage from './pages/PublicRatesPage';
import ProductPage from './pages/ProductPage';
import GroupPage from './pages/GroupPage';
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
import SchemesPage from './pages/SchemesPage';
import AgentsPage from './pages/AgentsPage';
import BranchAdminPage from './pages/BranchAdminPage';
import FraudMonitorPage from './pages/FraudMonitorPage';
import CrmPage from './pages/CrmPage';
import MemberRegisterPage from './pages/MemberRegisterPage';
import ScreeningPage from './pages/ScreeningPage';
import DataRequestsPage from './pages/DataRequestsPage';
import GrievancePage from './pages/GrievancePage';
import ReportsPage from './pages/ReportsPage';
import TutorialOverlay from './components/TutorialOverlay';
import SecurityCenterPage from './pages/SecurityCenterPage';
import AuthPage from './pages/AuthPage';
import { Toaster } from 'sonner';

function Loading() {
  return (
    <div className="min-h-screen bg-white flex items-center justify-center text-slate-700 text-sm">
      <div className="flex items-center gap-3">
        <div className="w-5 h-5 border-2 border-blue-700 border-t-transparent rounded-full animate-spin" />
        <span>Connecting to the AJS member ledger…</span>
      </div>
    </div>
  );
}

// ---------------- Public site ----------------
function PublicLayout() {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  // Signed-in members belong in the portal, not the marketing site.
  if (user) return <Navigate to={homeFor(user.role)} replace />;
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans selection:bg-blue-100">
      <PublicNavbar />
      <main className="flex-1">
        <Outlet />
      </main>
      <PublicFooter />
      <ChatbotWidget />
      <Toaster position="top-right" richColors theme="light" />
    </div>
  );
}

function HomeRoute() {
  const [params] = useSearchParams();
  const ref = params.get('ref');
  // A referral link lands on the sign-up form with the code prefilled.
  if (ref) return <Navigate to={`/open-account?ref=${encodeURIComponent(ref)}`} replace />;
  return <PublicHomePage />;
}

// ---------------- Auth ----------------
function AuthRoute({ isRegister }) {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  if (loading) return <Loading />;
  if (user) return <Navigate to={homeFor(user.role)} replace />;
  const from = location.state?.from;
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link to="/" data-testid="auth-brand-home"><Brand variant="compact" height={34} /></Link>
          <Link to="/" data-testid="auth-back-btn" className="text-xs text-slate-600 hover:text-slate-900">
            ← Back to public site
          </Link>
        </div>
      </div>
      <AuthPage
        defaultIsRegister={isRegister}
        onSuccess={(role) => navigate(from || homeFor(role), { replace: true })}
      />
      <Toaster position="top-right" richColors theme="light" />
    </div>
  );
}

// ---------------- Member portal ----------------
function AppShell() {
  const { user, loading, features } = useAuth();
  const { tab } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  // The first-run tour. Asked for once per session; the server decides whether
  // this person has already been through it.
  const [tour, setTour] = useState(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    api.tutorialState()
      .then((state) => { if (!cancelled && state.should_show) setTour(state); })
      .catch(() => {});  // the tour is never worth breaking the app over
    const restart = async () => {
      try { setTour(await api.tutorialRestart()); }
      catch { /* ignore */ }
    };
    window.addEventListener('ajspay:restart-tour', restart);
    return () => { cancelled = true; window.removeEventListener('ajspay:restart-tour', restart); };
  }, [user]);

  if (loading) return <Loading />;
  // Remember the requested page in router state, never in the URL.
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!canOpen(user.role, tab, features)) return <Navigate to={homeFor(user.role)} replace />;

  const go = (next) => navigate(`/app/${next}`);
  const pages = {
    dashboard: <Dashboard onNavigate={go} />,
    transfer: <TransferPage />,
    cards: <CardsChequesPage />,
    deposits: <DepositsInvestmentsPage />,
    loans: <LoansPage />,
    kyc: <KycAccountPage />,
    branches: <BranchLocatorPage />,
    admin: <AdminPortal />,
    owner: <BankOwnerPanel />,
    staff: <StaffPanel />,
    collection: <CollectionPanel />,
    'loan-dept': <LoanDeptPanel />,
    'video-kyc': <VideoKycPage />,
    'video-kyc-queue': <VideoKycQueuePage />,
    security: <SecurityPage />,
    statements: <StatementsPage />,
    referrals: <ReferralPage />,
    'standing-instructions': <StandingInstructionsPage />,
    'admin-config': <AdminConfigPage />,
    schemes: <SchemesPage />,
    agents: <AgentsPage />,
    'branch-admin': <BranchAdminPage />,
    fraud: <FraudMonitorPage />,
    crm: <CrmPage />,
    'member-register': <MemberRegisterPage />,
    screening: <ScreeningPage />,
    'data-requests': <DataRequestsPage />,
    grievance: <GrievancePage />,
    reports: <ReportsPage />,
    'security-center': <SecurityCenterPage />
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans selection:bg-blue-100">
      <Navbar onNavigate={go} activeTab={tab} />
      <div className="flex-1 flex flex-col md:flex-row">
        <Sidebar activeTab={tab} onSelectTab={go} />
        <main className="flex-1 overflow-y-auto bg-slate-50">{pages[tab]}</main>
      </div>
      <ChatbotWidget />
      {tour && <TutorialOverlay state={tour} onClose={() => setTour(null)} />}
      <Toaster position="top-right" richColors theme="light" />
    </div>
  );
}

function AppHome() {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  return <Navigate to={user ? homeFor(user.role) : '/login'} replace />;
}

function NotFound() {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center px-4 text-center">
      <Brand variant="stacked" height={90} />
      <h1 className="text-2xl font-bold text-slate-900 mt-8">Page not found</h1>
      <p className="text-sm text-slate-600 mt-2">The address you entered doesn't exist on this site.</p>
      <Link to="/" className="mt-6 px-5 py-2.5 rounded-md bg-[#0b3b8c] text-white text-xs font-semibold">Back to home</Link>
    </div>
  );
}

function PublicFooter() {
  const columns = [
    {
      heading: 'Personal Banking',
      links: [
        ['Savings Account', '/personal/savings-account'],
        ['Fixed Deposits', '/personal/fixed-deposits'],
        ['Home Loan', '/loans/home-loan'],
        ['Personal Loan', '/loans/personal-loan'],
        ['Debit & Credit Cards', '/personal/debit-cards']
      ]
    },
    {
      heading: 'Corporate',
      links: [
        ['Current Account', '/corporate/current-account'],
        ['Bulk NEFT / RTGS', '/corporate/bulk-neft-rtgs'],
        ['Trade Finance', '/corporate/trade-finance'],
        ['Cash Management', '/corporate/cash-management'],
        ['Payroll Services', '/corporate/payroll-services']
      ]
    },
    {
      heading: 'Support',
      links: [
        ['Rates & Charges', '/rates'],
        ['Branch & ATM Locator', '/branches'],
        ['Grievance Redressal', '/support/grievance-redressal']
      ]
    }
  ];

  return (
    <footer className="bg-white text-slate-600 mt-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 grid grid-cols-2 md:grid-cols-4 gap-8 text-xs">
        <div className="col-span-2 md:col-span-1 space-y-3">
          <Brand variant="full" height={40} onDark />
          <p className="text-slate-500 leading-relaxed">
            Secure digital banking for personal and business customers, with video KYC, passkey sign-in and
            24×7 digital transfers.
          </p>
        </div>
        {columns.map((column) => (
          <div key={column.heading}>
            <h4 className="text-slate-900 font-semibold mb-3">{column.heading}</h4>
            <ul className="space-y-1.5 text-slate-500">
              {column.links.map(([label, to]) => (
                <li key={to}>
                  <Link to={to} className="hover:text-slate-900 transition">{label}</Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-6 flex flex-wrap gap-x-6 gap-y-2 text-[11px] text-slate-500">
        <a href="tel:9105015464" className="hover:text-slate-900">Helpline 9105015464</a>
        <a href="mailto:support@ajspay.in" className="hover:text-slate-900">support@ajspay.in</a>
        <span>Cyber fraud helpline 1930</span>
      </div>
      <div className="border-t border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 text-center text-[11px] text-slate-500 space-y-1">
        <p className="max-w-4xl mx-auto leading-relaxed">
          Aadhunik Jeewan Sanchay Nidhi Limited · CIN U65990UP2019PLN121746
        </p>
        <p>© {new Date().getFullYear()} Aadhunik Jeewan Sanchay Nidhi Limited. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BankThemeProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<AuthRoute isRegister={false} />} />
            <Route path="/open-account" element={<AuthRoute isRegister />} />
            <Route path="/app" element={<AppHome />} />
            <Route path="/app/:tab" element={<AppShell />} />
            <Route element={<PublicLayout />}>
              <Route path="/" element={<HomeRoute />} />
              <Route path="/rates" element={<PublicRatesPage />} />
              <Route path="/branches" element={<div className="pt-6 bg-slate-50"><BranchLocatorPage /></div>} />
              <Route path="/:group" element={<GroupPage />} />
              <Route path="/:group/:slug" element={<ProductPage />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </BankThemeProvider>
    </AuthProvider>
  );
}
