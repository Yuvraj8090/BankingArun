import React, { useState, useEffect, useCallback } from 'react';
import {
  UserCheck, AlertTriangle, CheckCircle, XCircle, Download, RefreshCw,
  BarChart3, Database, Lock, Users, Wallet, ShieldCheck, FileText, Search,
  UserPlus, Key
} from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import Modal, { Field, inputClass, PasswordGenField } from '../components/Modal';
import Pagination from '../components/Pagination';
import { toast } from 'sonner';
import { txnMode } from '../utils/format';

const ACCESS_ROLES = [
  ['bank_owner', 'Director'],
  ['staff', 'Staff / Teller'],
  ['collection_agent', 'Collection Agent'],
  ['loan_officer', 'Loan Officer'],
  ['branch_manager', 'Branch Manager'],
  ['admin', 'Admin']
];
const ROLE_LABELS = Object.fromEntries([
  ...ACCESS_ROLES,
  ['retail', 'Retail Member'],
  ['corporate', 'Corporate Member']
]);

export default function AdminPortal() {
  const { user } = useAuth();
  const [overview, setOverview] = useState(null);
  const [rbiReports, setRbiReports] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const canManageUsers = user?.role === 'bank_owner';

  const fetchAdminData = async () => {
    try {
      setLoading(true);
      const data = await api.getAdminOverview();
      setOverview(data);
      const rbi = await api.getRbiReports();
      setRbiReports(rbi);
    } catch {
      toast.error("Failed to load branch manager portal");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAdminData(); }, []);

  if (loading) {
    return (
      <div className="p-10 flex items-center justify-center min-h-[400px]">
        <div className="flex items-center gap-3 text-slate-600">
          <RefreshCw className="w-5 h-5 animate-spin text-[#0b3b8c]" />
          <span className="text-sm">Authorising Chief Branch Manager access…</span>
        </div>
      </div>
    );
  }

  const tabs = [
    { key: 'overview', label: 'Branch Overview', icon: BarChart3 },
    { key: 'kyc', label: `Pending KYC (${overview?.stats?.pending_kyc_count || 0})`, icon: UserCheck },
    { key: 'rbi', label: 'Regulatory Reports (CTR/STR)', icon: FileText },
    { key: 'audits', label: 'Audit Trails', icon: ShieldCheck },
    ...(canManageUsers ? [{ key: 'users', label: 'User Access', icon: Users }] : [])
  ];

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">

      {/* Header — clean corporate bar */}
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-md bg-[#0b3b8c] flex items-center justify-center">
                <Lock className="w-4 h-4 text-white" />
              </div>
              <div>
                <h1 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight">
                  Branch Manager &amp; Compliance Portal
                </h1>
                <p className="text-[11px] text-slate-500">
                  Chhutmalpur Branch, Saharanpur (AJS-SRE-001) · PAN/Aadhaar KYC · PMLA Section 12
                </p>
              </div>
            </div>
          </div>
          <span className="px-2.5 py-1 rounded text-[10px] font-semibold bg-[#0b3b8c]/5 text-[#0b3b8c] border border-[#0b3b8c]/20 self-start md:self-auto">
            Authorised Officer
          </span>
        </div>

        {/* Tab bar */}
        <div className="mt-5 flex flex-wrap gap-1 border-b border-slate-100 -mx-5 px-5">
          {tabs.map(t => (
            <button
              key={t.key}
              data-testid={`admin-tab-${t.key}`}
              onClick={() => setActiveTab(t.key)}
              className={`px-4 py-2.5 text-xs font-semibold flex items-center gap-2 border-b-2 transition ${
                activeTab === t.key
                  ? 'border-[#0b3b8c] text-[#0b3b8c]'
                  : 'border-transparent text-slate-600 hover:text-[#0b3b8c] hover:bg-blue-50/60'
              }`}
            >
              <t.icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Overview */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard icon={Users} label="Total Customers" value={overview?.stats?.total_customers}
              sub="Retail & Corporate entities" color="text-[#0b3b8c]" />
            <StatCard icon={Wallet} label="Total Vault Liquidity"
              value={`₹${(overview?.stats?.total_liquidity || 0).toLocaleString('en-IN', {maximumFractionDigits:0})}`}
              sub="Active ledger balances" color="text-emerald-700" />
            <StatCard icon={UserCheck} label="Pending KYC" value={overview?.stats?.pending_kyc_count}
              sub="Awaiting compliance sign-off" color="text-[#c8102e]" />
            <StatCard icon={Database} label="Statutory Reserves"
              value="CRR 4.5% · SLR 18%" sub="Basel III compliant" color="text-slate-800" small />
          </div>

          <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-[#c8102e]" />
                High-Value Transaction Surveillance (&gt; ₹50,000)
              </h3>
              <span className="text-[10px] text-slate-500 font-mono">Live AML Rule Engine</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-[11px] uppercase text-slate-600">
                  <tr>
                    <th className="p-3 font-semibold">Ref ID</th>
                    <th className="p-3 font-semibold">Mode</th>
                    <th className="p-3 font-semibold">Beneficiary</th>
                    <th className="p-3 font-semibold">Account</th>
                    <th className="p-3 font-semibold">Amount (₹)</th>
                    <th className="p-3 font-semibold">Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(overview?.high_value_transactions || []).map(t => (
                    <tr key={t.id} className="hover:bg-blue-50/40 transition-colors">
                      <td className="p-3 font-mono text-[#0b3b8c]">{t.ref_number}</td>
                      <td className="p-3 font-semibold text-slate-800">{txnMode(t.mode)}</td>
                      <td className="p-3 text-slate-700">{t.counterparty_name}</td>
                      <td className="p-3 font-mono text-slate-700">{t.account_number}</td>
                      <td className="p-3 font-bold text-[#c8102e]">₹{t.amount.toLocaleString('en-IN')}</td>
                      <td className="p-3 text-slate-500">{new Date(t.timestamp).toLocaleString('en-IN')}</td>
                    </tr>
                  ))}
                  {!(overview?.high_value_transactions || []).length && (
                    <tr><td colSpan={6} className="p-6 text-center text-slate-500">No high-value transactions found.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* KYC */}
      {activeTab === 'kyc' && <PendingKycPanel onDecided={fetchAdminData} />}

      {/* RBI Reports */}
      {activeTab === 'rbi' && (
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
          <div className="p-5 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Statutory Reporting — PMLA / FIU-IND</h2>
              <p className="text-[11px] text-slate-500">PMLA Sec 12 &amp; Master Direction KYC 2016 formats</p>
            </div>
            <button data-testid="export-rbi-csv" onClick={() => toast.success("Statutory report CSV downloaded")}
              className="px-3 py-1.5 rounded-md bg-[#0b3b8c] hover:bg-[#092e6f] text-white text-xs font-semibold flex items-center gap-1.5">
              <Download className="w-3.5 h-3.5" /> Export CSV
            </button>
          </div>

          <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
            <ReportBox title={rbiReports?.cash_transaction_report_ctr?.title} count={rbiReports?.cash_transaction_report_ctr?.count} tag="CTR"
              desc="Reports all individual transactions above ₹1,00,000 to Financial Intelligence Unit (FIU-IND)." />
            <ReportBox title={rbiReports?.suspicious_transaction_report_str?.title} count={rbiReports?.suspicious_transaction_report_str?.count} tag="STR"
              desc="Automated anomaly detection on corporate bulk disbursements and rapid-velocity patterns." accent />
          </div>

          <div className="p-5 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-4 gap-4">
            <ComplianceItem label="Net Owned Funds (NOF)" value={rbiReports?.statutory_compliance?.net_owned_funds} />
            <ComplianceItem label="NOF : Deposits ratio" value={rbiReports?.statutory_compliance?.nof_to_deposits_ratio} />
            <ComplianceItem label="Unencumbered term deposits" value={rbiReports?.statutory_compliance?.unencumbered_term_deposits} />
            <ComplianceItem label="Deposits from members only" value={rbiReports?.statutory_compliance?.member_only_deposits} />
          </div>
        </div>
      )}

      {/* Audits */}
      {activeTab === 'audits' && (
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
          <div className="p-5 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-900">Immutable Audit Trail &amp; User Action Logs</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-[11px] uppercase text-slate-600">
                <tr>
                  <th className="p-3 font-semibold">Action</th>
                  <th className="p-3 font-semibold">User</th>
                  <th className="p-3 font-semibold">Details</th>
                  <th className="p-3 font-semibold">IP Address</th>
                  <th className="p-3 font-semibold">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(overview?.audit_logs || []).map(a => (
                  <tr key={a.id} className="hover:bg-blue-50/40 transition-colors">
                    <td className="p-3 font-semibold text-[#0b3b8c]">{a.action}</td>
                    <td className="p-3 font-mono text-slate-700">{a.email}</td>
                    <td className="p-3 text-slate-700">{a.details}</td>
                    <td className="p-3 font-mono text-slate-500">{a.ip}</td>
                    <td className="p-3 text-slate-500">{new Date(a.timestamp).toLocaleString('en-IN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'users' && canManageUsers && <UserAccessPanel />}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, sub, color, small }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm hover:shadow-md transition">
      <div className="flex items-center gap-2">
        <div className={`w-8 h-8 rounded-md bg-slate-50 border border-slate-100 flex items-center justify-center ${color}`}>
          <Icon className="w-4 h-4" />
        </div>
        <p className="text-[11px] text-slate-600">{label}</p>
      </div>
      <h2 className={`${small ? 'text-base' : 'text-2xl'} font-bold text-slate-900 mt-2`}>{value ?? 0}</h2>
      <p className="text-[10px] text-slate-500 mt-1">{sub}</p>
    </div>
  );
}

// Approving KYC and, optionally in the same step, funding + booking a
// savings plan for the member (POST /admin/kyc-verify-and-fund). Leaving
// "enrol in a plan" off just verifies KYC, same as the old plain Approve.
function KycVerifyModal({ customer, onClose, onDone }) {
  const [schemes, setSchemes] = useState([]);
  const [enrol, setEnrol] = useState(false);
  const [schemeCode, setSchemeCode] = useState('');
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState('cash');
  const [chequeNumber, setChequeNumber] = useState('');
  const [nomineeName, setNomineeName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.schemesList()
      .then(r => setSchemes((r.schemes || []).filter(s => s.status === 'active')))
      .catch(() => setSchemes([]));
  }, []);

  const selectedScheme = schemes.find(s => s.code === schemeCode) || null;

  const handleSubmit = async () => {
    if (enrol && (!schemeCode || !amount)) {
      toast.error('Pick a plan and a deposit amount');
      return;
    }
    if (enrol && mode === 'cheque' && !chequeNumber.trim()) {
      toast.error('Enter the cheque number');
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.kycVerifyAndFund({
        user_id: customer.id,
        scheme_code: enrol ? schemeCode : undefined,
        amount: enrol ? amount : undefined,
        mode: enrol ? mode : undefined,
        cheque_number: enrol && mode === 'cheque' ? chequeNumber.trim() : undefined,
        nominee_name: enrol ? (nomineeName.trim() || undefined) : undefined,
      });
      toast.success(res.message);
      onDone();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'KYC verification failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title={`Approve KYC — ${customer.name}`}
      subtitle="Verifies the member's identity, and can fund + book a plan in the same step."
      onClose={onClose} testId="kyc-verify-modal"
      footer={<>
        <button onClick={onClose} className="px-4 py-2 rounded-md border border-slate-200 text-xs font-semibold text-slate-700">
          Cancel
        </button>
        <button data-testid="kyc-verify-confirm-btn" onClick={handleSubmit} disabled={submitting}
          className="px-4 py-2 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold disabled:opacity-60">
          {submitting ? 'Verifying…' : (enrol ? 'Verify & Book Plan' : 'Verify KYC')}
        </button>
      </>}>
      <label className="flex items-center gap-2 text-xs text-slate-700">
        <input type="checkbox" data-testid="kyc-enrol-toggle" checked={enrol}
          onChange={e => setEnrol(e.target.checked)} />
        Also enrol in a savings plan now (member is here with cash/cheque)
      </label>

      {enrol && (
        <>
          <Field label="Plan">
            <select data-testid="kyc-scheme-select" className={inputClass} value={schemeCode}
              onChange={e => { setSchemeCode(e.target.value); setAmount(''); }}>
              <option value="">Select a plan…</option>
              {schemes.map(s => (
                <option key={s.code} value={s.code}>{s.name} ({s.code})</option>
              ))}
            </select>
          </Field>

          {selectedScheme && (
            <Field label="Deposit amount" hint="Only the plan's own printed denominations are accepted.">
              <select data-testid="kyc-amount-select" className={inputClass} value={amount}
                onChange={e => setAmount(e.target.value)}>
                <option value="">Select an amount…</option>
                {(selectedScheme.slabs || []).map(slab => (
                  <option key={slab.unit} value={slab.unit}>
                    ₹{Number(slab.unit).toLocaleString('en-IN')} → matures ₹{Number(slab.maturity).toLocaleString('en-IN')}
                    {slab.monthly_payout ? ` (₹${Number(slab.monthly_payout).toLocaleString('en-IN')}/mo)` : ''}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <Field label="Mode">
            <select data-testid="kyc-mode-select" className={inputClass} value={mode} onChange={e => setMode(e.target.value)}>
              <option value="cash">Cash</option>
              <option value="cheque">Cheque</option>
            </select>
          </Field>

          {mode === 'cheque' && (
            <Field label="Cheque number">
              <input data-testid="kyc-cheque-input" className={inputClass} value={chequeNumber}
                onChange={e => setChequeNumber(e.target.value)} placeholder="e.g. 000123" />
            </Field>
          )}

          <Field label="Nominee (optional)">
            <input data-testid="kyc-nominee-input" className={inputClass} value={nomineeName}
              onChange={e => setNomineeName(e.target.value)} placeholder="Defaults to the member's registered nominee" />
          </Field>
        </>
      )}
    </Modal>
  );
}

// The tab's own paginated queue (GET /admin/kyc-pending), separate from the
// capped preview route_admin_overview keeps for its dashboard widgets --
// a queue staff work through end to end needs every row reachable, not
// just the newest 20 (modules/staff.php).
function PendingKycPanel({ onDecided }) {
  const [data, setData] = useState(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [verifyingUser, setVerifyingUser] = useState(null);

  const load = useCallback(async () => {
    try { setData(await api.adminKycPending({ q: search.trim() || undefined, page, per_page: perPage })); }
    catch { toast.error('Could not load the KYC queue'); }
  }, [search, page, perPage]);
  useEffect(() => { const t = setTimeout(load, search ? 300 : 0); return () => clearTimeout(t); }, [load, search]);
  useEffect(() => { setPage(1); }, [search]);

  const handleKycAction = async (userId, status) => {
    try {
      const res = await api.adminKycAction({
        user_id: userId, status,
        rejection_reason: status === 'rejected' ? 'Incomplete document signature' : null
      });
      toast.success(res.message);
      load();
      onDecided?.();
    } catch {
      toast.error("KYC decision failed");
    }
  };

  const users = data?.users || [];
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
      <div className="p-5 border-b border-slate-100 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">Pending KYC Verification Desk</h2>
        <div className="flex items-center gap-2 border border-slate-200 rounded px-2 h-8 w-full max-w-xs">
          <Search className="w-3.5 h-3.5 text-slate-500" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            data-testid="admin-kyc-search"
            className="flex-1 text-xs outline-none bg-transparent" placeholder="Search by name / PAN…" />
        </div>
      </div>

      <div className="p-5">
        {!data ? (
          <p className="text-slate-500 text-xs py-10 text-center">Loading…</p>
        ) : users.length === 0 ? (
          <p className="text-slate-500 text-xs py-10 text-center">
            {search ? 'No pending KYC submissions match that search.'
              : 'No pending KYC submissions. All customer records are up to date.'}
          </p>
        ) : (
          <div className="space-y-3">
            {users.map(u => (
              <div key={u.id} className="p-4 rounded-md border border-slate-200 bg-white hover:border-[#0b3b8c] flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition">
                <div>
                  <h4 className="font-semibold text-slate-900 text-sm">{u.name}</h4>
                  <p className="text-[11px] text-slate-500 mt-0.5">{u.email} · {u.phone}</p>
                  <div className="flex flex-wrap gap-3 text-[11px] text-slate-600 mt-2">
                    <span>PAN: <strong className="font-mono text-slate-800">{u.pan_number || 'N/A'}</strong></span>
                    <span>Aadhaar: <strong className="font-mono text-slate-800">{u.aadhaar_number || 'N/A'}</strong></span>
                    <span>Branch: {u.branch}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button data-testid={`approve-kyc-${u.id}`} onClick={() => setVerifyingUser(u)}
                    className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center gap-1.5">
                    <CheckCircle className="w-3.5 h-3.5" /> Approve
                  </button>
                  <button data-testid={`reject-kyc-${u.id}`} onClick={() => handleKycAction(u.id, 'rejected')}
                    className="px-3 py-1.5 rounded-md border border-[#c8102e] text-[#c8102e] hover:bg-[#c8102e] hover:text-white text-xs font-semibold flex items-center gap-1.5 transition">
                    <XCircle className="w-3.5 h-3.5" /> Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {data && <Pagination meta={data.pagination} onPage={setPage} onPerPage={(n) => { setPerPage(n); setPage(1); }} />}

      {verifyingUser && (
        <KycVerifyModal
          customer={verifyingUser}
          onClose={() => setVerifyingUser(null)}
          onDone={() => { setVerifyingUser(null); load(); onDecided?.(); }}
        />
      )}
    </div>
  );
}

function UserAccessPanel() {
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [resetting, setResetting] = useState(null);
  const [created, setCreated] = useState(null);

  const load = async (next = {}) => {
    const query = next.q ?? q;
    const selectedRole = next.role ?? role;
    const nextPage = next.page ?? (('q' in next || 'role' in next) ? 1 : page);
    const nextPerPage = next.per_page ?? perPage;
    try {
      setData(await api.adminUsers({ q: query || undefined, role: selectedRole || undefined,
        page: nextPage, per_page: nextPerPage }));
      setPage(nextPage);
      setPerPage(nextPerPage);
    } catch (e) { toast.error(e.response?.data?.detail || 'Could not load user access'); }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = data?.users || [];
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
      <div className="p-5 border-b border-slate-100 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={q} onChange={(e) => setQ(e.target.value)}
            onBlur={(e) => load({ q: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') load({ q: e.currentTarget.value }); }}
            data-testid="admin-user-search" placeholder="Search users"
            className={`${inputClass} pl-8`} />
        </div>
        <select value={role} onChange={(e) => { const nextRole = e.target.value; setRole(nextRole); load({ role: nextRole }); }}
          data-testid="admin-user-role" className={`${inputClass} w-auto`}>
          <option value="">All roles</option>
          {ACCESS_ROLES.map(([r]) => <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>)}
        </select>
        <button onClick={load}
          className="px-3 py-2 rounded-md border border-slate-200 text-xs font-semibold text-slate-700 flex items-center gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
        <button data-testid="admin-create-user" onClick={() => setCreating(true)}
          className="px-4 py-2 rounded-md bg-[#0b3b8c] text-white text-xs font-semibold flex items-center gap-1.5">
          <UserPlus className="w-3.5 h-3.5" /> Create login
        </button>
      </div>
      {!data ? <p className="p-10 text-center text-xs text-slate-500">Loading users...</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[11px] uppercase text-slate-600">
              <tr>
                <th className="p-3 font-semibold">User</th>
                <th className="p-3 font-semibold">Login ID</th>
                <th className="p-3 font-semibold">Staff ID</th>
                <th className="p-3 font-semibold">Role</th>
                <th className="p-3 font-semibold">Branch</th>
                <th className="p-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map(u => (
                <tr key={u.id} className="hover:bg-blue-50/40 transition-colors">
                  <td className="p-3">
                    <div className="font-semibold text-slate-900">{u.name}</div>
                    <div className="text-[11px] text-slate-500">{u.email || u.phone}</div>
                  </td>
                  <td className="p-3 font-mono font-semibold text-slate-900">{u.login_id}</td>
                  <td className="p-3 font-mono text-slate-600">{u.staff_id || '-'}</td>
                  <td className="p-3 text-slate-600">{ROLE_LABELS[u.role] || u.role}</td>
                  <td className="p-3 text-slate-600">{u.branch || '-'}</td>
                  <td className="p-3 text-right">
                    <div className="inline-flex items-center gap-2">
                      {ACCESS_ROLES.some(([r]) => r === u.role) && (
                        <button onClick={() => setEditing(u)} data-testid={`admin-edit-user-${u.id}`}
                          className="px-3 py-1.5 rounded-md border border-slate-200 text-slate-700 text-[11px] font-semibold">
                          Edit
                        </button>
                      )}
                      <button disabled={!u.can_reset_password} onClick={() => setResetting(u)}
                      data-testid={`admin-reset-password-${u.id}`}
                      className="px-3 py-1.5 rounded-md border border-slate-200 text-[#0b3b8c] disabled:text-slate-400 disabled:bg-slate-50 text-[11px] font-semibold inline-flex items-center gap-1.5">
                        <Key className="w-3.5 h-3.5" /> Password
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!filtered.length && <tr><td colSpan={6} className="p-8 text-center text-slate-500">No users found.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pagination meta={data.pagination}
        onPage={(p) => load({ page: p })}
        onPerPage={(n) => load({ page: 1, per_page: n })} />}
      {creating && <CreateUserModal onClose={() => setCreating(false)} onDone={(r) => {
        setCreating(false); setCreated(r); load();
      }} />}
      {editing && <EditUserModal user={editing} onClose={() => setEditing(null)}
        onDone={() => { setEditing(null); load(); }} />}
      {resetting && <ResetPasswordModal user={resetting} onClose={() => setResetting(null)}
        onDone={() => { setResetting(null); load(); }} />}
      {created && <Modal title="Login created" subtitle="Give these details to the user in person." onClose={() => setCreated(null)}
        footer={<button onClick={() => setCreated(null)}
          className="px-5 py-2 rounded-md bg-[#0b3b8c] text-white text-xs font-semibold">Done</button>}>
        <div className="p-3 rounded-md bg-emerald-50 border border-emerald-200">
          <p className="text-[11px] text-emerald-900">User ID for signing in</p>
          <p className="text-xl font-mono font-bold text-emerald-900 tracking-wide">{created.login_id}</p>
        </div>
        <div className="p-3 rounded-md bg-slate-50 border border-slate-200 mt-3">
          <p className="text-[11px] text-slate-600">Staff ID (reference number)</p>
          <p className="text-xl font-mono font-bold text-slate-900 tracking-wide">{created.staff_id}</p>
        </div>
      </Modal>}
    </div>
  );
}

function CreateUserModal({ onClose, onDone }) {
  const [form, setForm] = useState({
    name: '', email: '', phone: '', role: 'staff', branch: 'Head Office - Nariman Point',
    designation: '', password: ''
  });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { onDone(await api.adminUserCreate(form)); }
    catch (e) { toast.error(e.response?.data?.detail || 'Could not create login'); }
    finally { setBusy(false); }
  };
  return (
    <Modal title="Create login" subtitle="Internal users sign in with their email address."
      testId="admin-create-user-modal" onClose={onClose}
      footer={<>
        <button onClick={onClose} className="px-4 py-2 rounded-md border border-slate-200 text-xs font-semibold text-slate-700">Cancel</button>
        <button data-testid="admin-create-user-save" disabled={busy || !form.name || !form.email || !form.phone || !form.password}
          onClick={save} className="px-4 py-2 rounded-md bg-[#0b3b8c] text-white text-xs font-semibold disabled:opacity-50">
          {busy ? 'Creating...' : 'Create'}
        </button>
      </>}>
      <Field label="Full name"><input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
      <Field label="Email / login ID"><input className={inputClass} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
      <Field label="Phone"><input className={inputClass} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
      <Field label="Role"><select className={inputClass} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
        {ACCESS_ROLES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></Field>
      <Field label="Branch"><input className={inputClass} value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} /></Field>
      <Field label="Designation"><input className={inputClass} value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} /></Field>
      <Field label="Temporary password">
        <PasswordGenField testId="admin-create-user-password" value={form.password}
          onChange={(v) => setForm({ ...form, password: v })} />
      </Field>
    </Modal>
  );
}

function EditUserModal({ user, onClose, onDone }) {
  const [form, setForm] = useState({
    user_id: user.id, name: user.name || '', email: user.email || '', phone: user.phone || '',
    role: user.role || 'staff', branch: user.branch || '', designation: user.designation || ''
  });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { toast.success((await api.adminUserUpdate(form)).message); onDone(); }
    catch (e) { toast.error(e.response?.data?.detail || 'Could not update login'); }
    finally { setBusy(false); }
  };
  return (
    <Modal title="Manage login" subtitle={user.login_id} testId="admin-edit-user-modal" onClose={onClose}
      footer={<>
        <button onClick={onClose} className="px-4 py-2 rounded-md border border-slate-200 text-xs font-semibold text-slate-700">Cancel</button>
        <button data-testid="admin-edit-user-save" disabled={busy || !form.name || !form.email || !form.phone}
          onClick={save} className="px-4 py-2 rounded-md bg-[#0b3b8c] text-white text-xs font-semibold disabled:opacity-50">
          {busy ? 'Saving...' : 'Save'}
        </button>
      </>}>
      <Field label="Full name"><input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
      <Field label="Email / login ID"><input className={inputClass} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
      <Field label="Phone"><input className={inputClass} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
      <Field label="Role"><select className={inputClass} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
        {ACCESS_ROLES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></Field>
      <Field label="Branch"><input className={inputClass} value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} /></Field>
      <Field label="Designation"><input className={inputClass} value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} /></Field>
    </Modal>
  );
}

function ResetPasswordModal({ user, onClose, onDone }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { toast.success((await api.adminUserPassword({ user_id: user.id, password })).message); onDone(); }
    catch (e) { toast.error(e.response?.data?.detail || 'Could not change password'); }
    finally { setBusy(false); }
  };
  return (
    <Modal title="Change password" subtitle={`${user.name} - ${user.login_id}`} testId="admin-reset-password-modal"
      onClose={onClose} footer={<>
        <button onClick={onClose} className="px-4 py-2 rounded-md border border-slate-200 text-xs font-semibold text-slate-700">Cancel</button>
        <button data-testid="admin-reset-password-save" disabled={busy || !password} onClick={save}
          className="px-4 py-2 rounded-md bg-[#0b3b8c] text-white text-xs font-semibold disabled:opacity-50">
          {busy ? 'Changing...' : 'Change password'}
        </button>
      </>}>
      <Field label="New password">
        <PasswordGenField testId="admin-reset-password-value" value={password} onChange={setPassword} />
      </Field>
    </Modal>
  );
}

function ReportBox({ title, count, tag, desc, accent }) {
  return (
    <div className="p-4 rounded-md border border-slate-200 bg-slate-50/40">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${accent ? 'bg-[#c8102e]/10 text-[#c8102e]' : 'bg-[#0b3b8c]/10 text-[#0b3b8c]'}`}>{tag}</span>
          <h3 className="font-semibold text-slate-900 text-xs">{title}</h3>
        </div>
        <span className={`text-xs font-bold ${accent ? 'text-[#c8102e]' : 'text-[#0b3b8c]'}`}>{count} records</span>
      </div>
      <p className="text-[11px] text-slate-600 mt-2 leading-relaxed">{desc}</p>
    </div>
  );
}

function ComplianceItem({ label, value }) {
  return (
    <div className="p-3 rounded-md bg-slate-50 border border-slate-100">
      <p className="text-[10px] text-slate-500">{label}</p>
      <p className="font-bold text-emerald-700 text-sm mt-0.5">{value}</p>
    </div>
  );
}
