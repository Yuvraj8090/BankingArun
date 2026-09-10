import React, { useEffect, useState } from 'react';
import { GanttChartSquare, Check, X, FileSearch, Send, RefreshCw, Calculator, TrendingUp } from 'lucide-react';
import { api } from '../services/api';
import { toast } from 'sonner';

const STATUS_STYLE = {
  under_review: 'bg-amber-50 text-amber-700 border-amber-200',
  documentation: 'bg-blue-50 text-[#0b3b8c] border-blue-200',
  approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  rejected: 'bg-rose-50 text-[#c8102e] border-rose-200',
  disbursed: 'bg-slate-900 text-white border-slate-900'
};

export default function LoanDeptPanel() {
  const [data, setData] = useState(null);
  const load = () => api.getLoanDeptPanel().then(setData).catch(() => toast.error('Access denied'));
  useEffect(() => { load(); }, []);

  const decide = async (id, decision, label) => {
    try { await api.loanDecision({ application_id: id, decision }); toast.success(`${label} recorded`); load(); }
    catch { toast.error('Decision failed'); }
  };

  if (!data) return <div className="p-10 flex items-center gap-2 text-slate-600"><RefreshCw className="w-4 h-4 animate-spin" /> Loading loan pipeline…</div>;

  const k = data.kpis;
  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm">
        <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
          <GanttChartSquare className="w-5 h-5 text-[#0b3b8c]" /> Loan Department
        </h1>
        <p className="text-xs text-slate-500 mt-1">Application processing · Credit score · Documentation · Disbursement</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Kpi label="Applications" value={k.total_applications} icon={FileSearch} />
        <Kpi label="Disbursed" value={`₹${k.disbursed_amount.toLocaleString('en-IN')}`} icon={TrendingUp} color="text-emerald-700" />
        <Kpi label="In Review" value={k.in_review} icon={GanttChartSquare} color="text-amber-700" />
        <Kpi label="NPA Ratio" value={k.npa_ratio} icon={Calculator} color="text-[#c8102e]" />
      </div>

      <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
        <div className="p-5 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-900">Loan Pipeline</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[11px] uppercase text-slate-600">
              <tr>
                <th className="p-3 font-semibold">Applicant</th>
                <th className="p-3 font-semibold">Type</th>
                <th className="p-3 font-semibold">Amount</th>
                <th className="p-3 font-semibold">Tenure</th>
                <th className="p-3 font-semibold">ROI</th>
                <th className="p-3 font-semibold">Credit</th>
                <th className="p-3 font-semibold">Status</th>
                <th className="p-3 font-semibold text-right">Decision</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.applications.map(a => (
                <tr key={a.id} className="hover:bg-slate-50">
                  <td className="p-3 font-semibold text-slate-900">{a.applicant}</td>
                  <td className="p-3">{a.loan_type}</td>
                  <td className="p-3 font-bold text-[#0b3b8c]">₹{a.amount.toLocaleString('en-IN')}</td>
                  <td className="p-3">{a.tenure_months} mo</td>
                  <td className="p-3">{a.roi}%</td>
                  <td className="p-3">
                    <span className={`font-mono font-semibold ${a.credit_score >= 750 ? 'text-emerald-700' : a.credit_score >= 700 ? 'text-amber-700' : 'text-[#c8102e]'}`}>
                      {a.credit_score}
                    </span>
                  </td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${STATUS_STYLE[a.status] || 'bg-slate-50 text-slate-700 border-slate-200'}`}>
                      {a.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="p-3">
                    <div className="flex items-center justify-end gap-1">
                      <IconBtn testId={`loan-docs-${a.id}`} icon={FileSearch} title="Request docs" onClick={() => decide(a.id, 'request_docs', 'Docs request')} />
                      <IconBtn testId={`loan-approve-${a.id}`} icon={Check} title="Approve" color="text-emerald-700" onClick={() => decide(a.id, 'approve', 'Approval')} />
                      <IconBtn testId={`loan-reject-${a.id}`} icon={X} title="Reject" color="text-[#c8102e]" onClick={() => decide(a.id, 'reject', 'Rejection')} />
                      <IconBtn testId={`loan-disburse-${a.id}`} icon={Send} title="Disburse" color="text-slate-900" onClick={() => decide(a.id, 'disburse', 'Disbursement')} />
                    </div>
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
    <button data-testid={testId} onClick={onClick} title={title}
      className={`w-8 h-8 rounded-md hover:bg-slate-100 flex items-center justify-center ${color}`}>
      <Icon className="w-3.5 h-3.5" />
    </button>
  );
}
