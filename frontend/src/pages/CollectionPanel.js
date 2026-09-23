import React, { useEffect, useState } from 'react';
import { Wallet, AlertTriangle, Bell, FileWarning, Handshake, Phone, RefreshCw, TrendingUp, Target } from 'lucide-react';
import { api } from '../services/api';
import { toast } from 'sonner';

const STATUS_STYLE = {
  reminder_sent: 'bg-blue-50 text-[#0b3b8c] border-blue-200',
  follow_up: 'bg-amber-50 text-amber-700 border-amber-200',
  legal_notice: 'bg-rose-50 text-[#c8102e] border-rose-200',
  npa_risk: 'bg-rose-50 text-[#c8102e] border-rose-200',
  settled: 'bg-emerald-50 text-emerald-700 border-emerald-200'
};

export default function CollectionPanel() {
  const [data, setData] = useState(null);
  const load = () => api.getCollectionPanel().then(setData).catch(() => toast.error('Access denied'));
  useEffect(() => { load(); }, []);

  const act = async (case_id, action, label) => {
    try {
      await api.collectionAction({ case_id, action });
      toast.success(`${label} recorded`);
      load();
    } catch { toast.error('Action failed'); }
  };

  if (!data) return <div className="p-10 flex items-center gap-2 text-slate-600"><RefreshCw className="w-4 h-4 animate-spin" /> Loading collection cases…</div>;

  const k = data.kpis;
  const progress = k.recovery_target_month ? Math.round((k.recovered_month / k.recovery_target_month) * 100) : 0;

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm">
        <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
          <Wallet className="w-5 h-5 text-[#c8102e]" /> Collection Department
        </h1>
        <p className="text-xs text-slate-500 mt-1">Loan recovery · Follow-ups · Settlement negotiation · NPA monitoring</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Kpi label="Total Cases" value={k.total_cases} icon={FileWarning} />
        <Kpi label="Outstanding" value={`₹${k.total_outstanding.toLocaleString('en-IN')}`} icon={Wallet} color="text-[#c8102e]" />
        <Kpi label="NPA Risk (DPD ≥ 90)" value={k.npa_risk_count} icon={AlertTriangle} color="text-[#c8102e]" />
        <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <Target className="w-3.5 h-3.5 text-emerald-700" />
            <p className="text-[11px] text-slate-600">Monthly Recovery Target</p>
          </div>
          <p className="text-sm font-bold text-slate-900 mt-2">₹{Number(k.recovered_month).toLocaleString('en-IN')} / ₹{Number(k.recovery_target_month).toLocaleString('en-IN')}</p>
          <div className="w-full h-2 bg-slate-100 rounded-full mt-2 overflow-hidden">
            <div className="h-full bg-emerald-500" style={{ width: `${Math.min(100, progress)}%` }}></div>
          </div>
          <p className="text-[10px] text-emerald-700 font-semibold mt-1">{progress}% achieved</p>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
        <div className="p-5 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-900">Active Recovery Cases</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[11px] uppercase text-slate-600">
              <tr>
                <th className="p-3 font-semibold">Borrower</th>
                <th className="p-3 font-semibold">Loan Ref</th>
                <th className="p-3 font-semibold">Outstanding</th>
                <th className="p-3 font-semibold">DPD</th>
                <th className="p-3 font-semibold">Status</th>
                <th className="p-3 font-semibold">Last Contact</th>
                <th className="p-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.cases.map(c => (
                <tr key={c.id} className="hover:bg-blue-50/40 transition-colors">
                  <td className="p-3">
                    <div className="font-semibold text-slate-900">{c.borrower}</div>
                    <div className="text-[10px] text-slate-500 flex items-center gap-1"><Phone className="w-3 h-3" /> {c.phone}</div>
                  </td>
                  <td className="p-3 font-mono">{c.loan_ref}</td>
                  <td className="p-3 font-bold text-[#c8102e]">₹{c.outstanding.toLocaleString('en-IN')}</td>
                  <td className="p-3 font-semibold">{c.dpd_days} days</td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${STATUS_STYLE[c.status] || 'bg-slate-50 text-slate-700 border-slate-200'}`}>
                      {c.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="p-3 text-slate-500">{c.last_contact}</td>
                  <td className="p-3">
                    <div className="flex items-center justify-end gap-1">
                      <IconBtn testId={`case-remind-${c.id}`} icon={Bell} title="Reminder" onClick={() => act(c.id, 'reminder', 'Reminder')} />
                      <IconBtn testId={`case-legal-${c.id}`} icon={FileWarning} title="Legal Notice" color="text-[#c8102e]" onClick={() => act(c.id, 'legal_notice', 'Legal notice')} />
                      <IconBtn testId={`case-settle-${c.id}`} icon={Handshake} title="Settle" color="text-emerald-700" onClick={() => act(c.id, 'settle', 'Settlement')} />
                    </div>
                  </td>
                </tr>
              ))}
              {!data.cases.length && (
                <tr><td colSpan={7} className="p-6 text-center text-slate-500">No active recovery cases.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, icon: Icon, color = 'text-[#0b3b8c]' }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <div className={`w-7 h-7 rounded-md bg-slate-50 border border-slate-100 flex items-center justify-center ${color}`}><Icon className="w-3.5 h-3.5" /></div>
        <p className="text-[11px] text-slate-600">{label}</p>
      </div>
      <p className="text-xl font-bold text-slate-900 mt-2">{value}</p>
    </div>
  );
}

function IconBtn({ icon: Icon, title, onClick, color = 'text-[#0b3b8c]', testId }) {
  return (
    <button data-testid={testId} onClick={onClick} title={title} aria-label={title}
      className={`w-8 h-8 rounded-md hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-[#0b3b8c]/20 active:scale-95 transition flex items-center justify-center ${color}`}>
      <Icon className="w-3.5 h-3.5" />
    </button>
  );
}
