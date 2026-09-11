import React, { useState, useEffect } from 'react';
import {
  UserCheck, AlertTriangle, CheckCircle, XCircle, Download, RefreshCw,
  BarChart3, Database, Lock, Users, Wallet, ShieldCheck, FileText, Search
} from 'lucide-react';
import { api } from '../services/api';
import { toast } from 'sonner';

export default function AdminPortal() {
  const [overview, setOverview] = useState(null);
  const [rbiReports, setRbiReports] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

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

  const handleKycAction = async (userId, status) => {
    try {
      const res = await api.adminKycAction({
        user_id: userId, status,
        rejection_reason: status === 'rejected' ? 'Incomplete document signature' : null
      });
      toast.success(res.message);
      fetchAdminData();
    } catch {
      toast.error("KYC decision failed");
    }
  };

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
    { key: 'rbi', label: 'RBI Reports (CTR/STR)', icon: FileText },
    { key: 'audits', label: 'Audit Trails', icon: ShieldCheck }
  ];

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">

      {/* Header — clean corporate bar */}
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-md bg-[#0b3b8c] flex items-center justify-center">
                <Lock className="w-4.5 h-4.5 text-white" />
              </div>
              <div>
                <h1 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight">
                  Branch Manager &amp; RBI Compliance Portal
                </h1>
                <p className="text-[11px] text-slate-500">
                  Nariman Point Main Branch (AJSP-MUM-042) · RBI Master Direction KYC · PMLA Section 12
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
                  : 'border-transparent text-slate-600 hover:text-slate-900'
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
                    <tr key={t.id} className="hover:bg-slate-50">
                      <td className="p-3 font-mono text-[#0b3b8c]">{t.ref_number}</td>
                      <td className="p-3 font-semibold text-slate-800">{t.mode}</td>
                      <td className="p-3 text-slate-700">{t.counterparty_name}</td>
                      <td className="p-3 font-mono text-slate-700">{t.account_number}</td>
                      <td className="p-3 font-bold text-[#c8102e]">₹{t.amount.toLocaleString('en-IN')}</td>
                      <td className="p-3 text-slate-500">{new Date(t.timestamp).toLocaleString('en-IN')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* KYC */}
      {activeTab === 'kyc' && (
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
          <div className="p-5 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Pending KYC Verification Desk</h2>
            <div className="flex items-center gap-2 border border-slate-200 rounded px-2 h-8 w-full max-w-xs">
              <Search className="w-3.5 h-3.5 text-slate-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)}
                data-testid="admin-kyc-search"
                className="flex-1 text-xs outline-none bg-transparent" placeholder="Search by name / PAN…" />
            </div>
          </div>

          <div className="p-5">
            {(!overview?.pending_kyc_users || overview.pending_kyc_users.length === 0) ? (
              <p className="text-slate-500 text-xs py-10 text-center">No pending KYC submissions. All customer records are up to date.</p>
            ) : (
              <div className="space-y-3">
                {overview.pending_kyc_users
                  .filter(u => !search || (u.name + u.pan_number + u.email).toLowerCase().includes(search.toLowerCase()))
                  .map(u => (
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
                      <button data-testid={`approve-kyc-${u.id}`} onClick={() => handleKycAction(u.id, 'verified')}
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
        </div>
      )}

      {/* RBI Reports */}
      {activeTab === 'rbi' && (
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
          <div className="p-5 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Reserve Bank of India — Statutory Reporting</h2>
              <p className="text-[11px] text-slate-500">PMLA Sec 12 &amp; Master Direction KYC 2016 formats</p>
            </div>
            <button data-testid="export-rbi-csv" onClick={() => toast.success("RBI Statutory Report CSV downloaded")}
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
            <ComplianceItem label="Cash Reserve Ratio (CRR)" value={rbiReports?.statutory_compliance?.crr_cash_reserve_ratio} />
            <ComplianceItem label="Statutory Liquidity (SLR)" value={rbiReports?.statutory_compliance?.slr_statutory_liquidity_ratio} />
            <ComplianceItem label="Liquidity Coverage (LCR)" value={rbiReports?.statutory_compliance?.lcr_liquidity_coverage_ratio} />
            <ComplianceItem label="Capital Adequacy (CAR)" value={rbiReports?.statutory_compliance?.car_capital_adequacy_ratio} />
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
                  <tr key={a.id} className="hover:bg-slate-50">
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
      <h2 className={`${small ? 'text-base' : 'text-2xl'} font-bold text-slate-900 mt-2`}>{value}</h2>
      <p className="text-[10px] text-slate-500 mt-1">{sub}</p>
    </div>
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
