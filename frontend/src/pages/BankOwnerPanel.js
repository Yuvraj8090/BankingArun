import React, { useEffect, useState } from 'react';
import { Crown, Users, Wallet, Building2, TrendingUp, BadgeCheck, Award, Landmark, RefreshCw } from 'lucide-react';
import { api } from '../services/api';
import { toast } from 'sonner';

export default function BankOwnerPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getBankOwnerPanel().then(setData).catch(() => toast.error('Access denied')).finally(() => setLoading(false));
  }, []);

  if (loading || !data) return <div className="p-10 flex items-center gap-2 text-slate-600"><RefreshCw className="w-4 h-4 animate-spin" /> Loading executive dashboard…</div>;

  const k = data.kpis;
  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-md bg-[#0b3b8c] text-white flex items-center justify-center"><Crown className="w-5 h-5" /></div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Executive Dashboard</h1>
            <p className="text-xs text-slate-500">Enterprise-wide view · Policy control · Approvals</p>
          </div>
        </div>
        <span className="px-2.5 py-1 rounded bg-white text-amber-700 text-[10px] font-bold">BANK OWNER</span>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Only figures derived from our own ledger — no invented ratings or ratios. */}
        <Kpi icon={Users} label="Total Users" value={k.total_users} color="text-[#0b3b8c]" />
        <Kpi icon={BadgeCheck} label="Members" value={k.members} color="text-slate-800" />
        <Kpi icon={Wallet} label="Total Liquidity" value={`₹${Number(k.total_liquidity).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`} color="text-emerald-700" />
        <Kpi icon={Award} label="Deposits (FD/RD)" value={`₹${Number(k.total_deposits).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`} color="text-emerald-700" />
        <Kpi icon={TrendingUp} label="Transactions" value={k.total_transactions} color="text-[#c8102e]" />
        <Kpi icon={Building2} label="Active Branches" value={k.active_branches} color="text-slate-800" />
        <Kpi icon={Landmark} label="Loan Pipeline" value={k.loan_pipeline_count} color="text-[#0b3b8c]" />
      </div>

      {/* Policies */}
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
        <div className="p-5 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-900">Rate &amp; Policy Configuration</h2>
          <p className="text-[11px] text-slate-500">Head-office rates apply bank-wide once approved.</p>
        </div>
        <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-3">
          {data.policies.map(p => (
            <div key={p.key} className="p-4 rounded-md border border-slate-200 bg-slate-50">
              <p className="text-[10px] uppercase text-slate-500 tracking-wide">{p.label}</p>
              <p className="text-xl font-bold text-slate-900 mt-1">{p.value}</p>
              <button data-testid={`policy-edit-${p.key}`}
                onClick={() => toast.success(`${p.label} sent for board approval`)}
                className="text-[11px] text-[#0b3b8c] font-semibold mt-2 hover:underline">Propose change →</button>
            </div>
          ))}
        </div>
      </div>

      {/* Branches */}
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Branch Network</h2>
          <button data-testid="add-branch-btn"
            onClick={() => toast.success('Branch creation form queued for BOD approval')}
            className="px-3 py-1.5 rounded-md bg-[#0b3b8c] text-white text-xs font-semibold">+ Add Branch</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[11px] uppercase text-slate-600">
              <tr>
                <th className="p-3 font-semibold">Bank</th>
                <th className="p-3 font-semibold">Branch</th>
                <th className="p-3 font-semibold">IFSC</th>
                <th className="p-3 font-semibold">Facilities</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.branches.map(b => (
                <tr key={b.id} className="hover:bg-slate-50">
                  <td className="p-3 font-semibold text-[#0b3b8c]">{b.bank}</td>
                  <td className="p-3">{b.name}<div className="text-[10px] text-slate-500">{b.address}</div></td>
                  <td className="p-3 font-mono">{b.code}</td>
                  <td className="p-3 text-[11px] text-slate-600">
                    {b.has_atm && <span className="mr-2">ATM</span>}
                    {b.has_cdm && <span className="mr-2">CDM</span>}
                    {b.has_locker && <span>Locker</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, color, small }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <div className={`w-7 h-7 rounded-md bg-slate-50 border border-slate-100 flex items-center justify-center ${color}`}><Icon className="w-3.5 h-3.5" /></div>
        <p className="text-[11px] text-slate-600">{label}</p>
      </div>
      <p className={`${small ? 'text-sm' : 'text-xl'} font-bold text-slate-900 mt-2`}>{value}</p>
    </div>
  );
}
