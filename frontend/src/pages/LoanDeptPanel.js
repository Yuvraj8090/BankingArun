import React, { useEffect, useState } from 'react';
import { GanttChartSquare, Check, X, FileSearch, Send, RefreshCw, Calculator, TrendingUp, Coins, Plus, Trash2 } from 'lucide-react';
import { api } from '../services/api';
import { toast } from 'sonner';
import Modal from '../components/Modal';
import DepositSlip from '../components/DepositSlip';

const STATUS_STYLE = {
  under_review: 'bg-amber-50 text-amber-700 border-amber-200',
  documentation: 'bg-blue-50 text-[#0b3b8c] border-blue-200',
  approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  rejected: 'bg-rose-50 text-[#c8102e] border-rose-200',
  disbursed: 'bg-[#0b3b8c] text-white border-[#0b3b8c]'
};

export default function LoanDeptPanel() {
  const [data, setData] = useState(null);
  const [goldFor, setGoldFor] = useState(null);
  const load = () => api.getLoanDeptPanel().then(setData).catch(() => toast.error('Access denied'));
  useEffect(() => { load(); }, []);

  const decide = async (id, decision) => {
    if (decision === 'disburse' && !window.confirm('Disburse this loan? The amount is credited to the member\'s savings account now and EMIs start next month.')) return;
    try { toast.success((await api.loanDecision({ application_id: id, decision })).message); load(); }
    catch (e) { toast.error(e.response?.data?.detail || 'Decision failed'); }
  };
  // Same as LOAN_TRANSITIONS in modules/staff.php: only offer what the server allows.
  const NEXT = {
    submitted: ['request_docs', 'approve', 'reject'], under_review: ['request_docs', 'approve', 'reject'],
    documentation: ['approve', 'reject'], approved: ['disburse', 'reject'],
  };
  // Old unsecured applications (personal, vehicle...) can be rejected but never approved or paid out.
  const actionsFor = (a) => (NEXT[a.status] || [])
    .filter((x) => !['disburse', 'approve'].includes(x) || ['gold', 'home', 'deposit'].includes(String(a.loan_type).toLowerCase()));

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

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Kpi label="Applications" value={k.total_applications} icon={FileSearch} />
        <Kpi label="Disbursed" value={`₹${Number(k.disbursed_amount).toLocaleString('en-IN')}`} icon={TrendingUp} color="text-emerald-700" />
        <Kpi label="In Review" value={k.in_review} icon={GanttChartSquare} color="text-amber-700" />
        <Kpi label="Outstanding" value={`₹${Number(k.outstanding || 0).toLocaleString('en-IN')}`} icon={Calculator} />
        <Kpi label="NPA (90+ days)" value={`${k.npa_ratio ?? 0}%`} icon={Calculator} color="text-[#c8102e]" />
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
                <tr key={a.id} className="hover:bg-blue-50/40 transition-colors">
                  <td className="p-3 font-semibold text-slate-900">{a.applicant}</td>
                  <td className="p-3">{a.loan_type}{a.security_deposit && <span className="block text-[10px] text-slate-500 font-mono">against {a.security_deposit}</span>}</td>
                  <td className="p-3 font-bold text-[#0b3b8c]">₹{Number(a.amount).toLocaleString('en-IN')}</td>
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
                      {String(a.loan_type).toLowerCase() === 'gold' && <IconBtn testId={`loan-gold-${a.id}`} icon={Coins} title="Record gold / receipt" color="text-amber-700" onClick={() => setGoldFor(a)} />}
                      {actionsFor(a).includes('request_docs') && <IconBtn testId={`loan-docs-${a.id}`} icon={FileSearch} title="Request docs" onClick={() => decide(a.id, 'request_docs')} />}
                      {actionsFor(a).includes('approve') && <IconBtn testId={`loan-approve-${a.id}`} icon={Check} title="Approve" color="text-emerald-700" onClick={() => decide(a.id, 'approve')} />}
                      {actionsFor(a).includes('reject') && <IconBtn testId={`loan-reject-${a.id}`} icon={X} title="Reject" color="text-[#c8102e]" onClick={() => decide(a.id, 'reject')} />}
                      {actionsFor(a).includes('disburse') && <IconBtn testId={`loan-disburse-${a.id}`} icon={Send} title="Disburse" color="text-slate-900" onClick={() => decide(a.id, 'disburse')} />}
                      {!NEXT[a.status] && <span className="text-[10px] text-slate-400">final</span>}
                    </div>
                  </td>
                </tr>
              ))}
              {!data.applications.length && (
                <tr><td colSpan={8} className="p-6 text-center text-slate-500">No loan applications in the pipeline.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {goldFor && <GoldPledge app={goldFor} onClose={() => { setGoldFor(null); load(); }} />}
    </div>
  );
}

// The jewellery behind a gold loan: list each item, enter today's 24-carat rate, and
// the server values it and sets the most that can be lent (modules/banking.php).
const KARATS = [24, 22, 20, 18, 14];
const blankItem = () => ({ description: '', pieces: 1, gross_g: '', net_g: '', karat: 22 });
function GoldPledge({ app, onClose }) {
  const [pledge, setPledge] = useState(undefined);
  const [ltv, setLtv] = useState(75);
  const [rate, setRate] = useState('');
  const [items, setItems] = useState([blankItem()]);
  const [receipt, setReceipt] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    api.goldPledgeGet(app.id).then((r) => {
      setPledge(r.pledge); setLtv(r.ltv);
      if (r.pledge) { setRate(String(r.pledge.rate_per_g_24k)); setItems(r.pledge.items); }
    }).catch((e) => { toast.error(e.response?.data?.detail || 'Could not load'); onClose(); });
  // Loads once per application; onClose is a fresh arrow on every parent render.
  }, [app.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (i, k, v) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const value = Math.floor(items.reduce((n, x) => n + (Number(x.net_g) || 0) * Number(x.karat) / 24 * (Number(rate) || 0), 0));
  const max = Math.floor(value * ltv / 100);
  const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
  const save = async () => {
    setSaving(true);
    try {
      const r = await api.goldPledgeSave({ application_id: app.id, rate_per_g_24k: Number(rate),
        items: items.map((x) => ({ ...x, pieces: Number(x.pieces), gross_g: Number(x.gross_g), net_g: Number(x.net_g), karat: Number(x.karat) })) });
      toast.success(r.message); setPledge(r.pledge); setReceipt(r.receipt);
    } catch (e) { toast.error(e.response?.data?.detail || 'Could not save'); } finally { setSaving(false); }
  };
  const release = async () => {
    if (!window.confirm('Mark the jewellery as handed back to the member?')) return;
    try { toast.success((await api.goldPledgeRelease(app.id)).message); onClose(); }
    catch (e) { toast.error(e.response?.data?.detail || 'Could not release'); }
  };
  if (receipt) return <DepositSlip slip={receipt} onClose={() => setReceipt(null)} />;
  if (pledge === undefined) return null;
  const locked = pledge?.status === 'returned' || app.status === 'disbursed';
  const cell = 'w-full border border-slate-200 rounded px-2 py-1.5 text-xs';
  return (
    <Modal wide testId="gold-pledge-modal" title={`Gold for ${app.applicant}`}
      subtitle={`Loan applied for ${inr(app.amount)}. At most ${ltv}% of the gold's value can be lent.`}
      onClose={onClose}
      footer={<>
        {pledge?.status === 'held' && <button onClick={release} className="px-4 py-2 rounded-md border border-slate-200 text-xs font-semibold text-slate-700">Gold returned to member</button>}
        {pledge && <button onClick={async () => setReceipt((await api.goldPledgeGet(app.id)).receipt)} className="px-4 py-2 rounded-md border border-slate-200 text-xs font-semibold text-slate-700">Print receipt</button>}
        {!locked && <button onClick={save} disabled={saving || !rate || items.some((x) => !x.description || !x.net_g || !x.gross_g)} data-testid="gold-save"
          className="px-5 py-2 rounded-md bg-[#0b3b8c] text-white text-xs font-semibold disabled:opacity-50">{saving ? 'Saving…' : pledge ? 'Save new valuation' : 'Value the gold'}</button>}
      </>}>
      <div className="space-y-3 text-xs">
        {pledge && <p className="text-slate-600">Receipt <span className="font-mono">{pledge.receipt_no}</span> · {pledge.status === 'held' ? 'held at the branch' : `returned ${String(pledge.returned_at).slice(0, 10)}`} · valued by {pledge.valued_by}</p>}
        <label className="block max-w-xs">
          <span className="block text-slate-600 mb-1">Today's 24-carat rate (₹ per gram)</span>
          <input type="number" value={rate} disabled={locked} onChange={(e) => setRate(e.target.value)} className={cell} data-testid="gold-rate" />
        </label>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="text-[10px] uppercase text-slate-500"><tr>
              <th className="p-1 text-left">Item</th><th className="p-1">Pieces</th><th className="p-1">Gross g</th><th className="p-1">Net g (gold only)</th><th className="p-1">Purity</th><th />
            </tr></thead>
            <tbody>
              {items.map((x, i) => (
                <tr key={i}>
                  <td className="p-1"><input value={x.description} disabled={locked} placeholder="e.g. Chain" onChange={(e) => set(i, 'description', e.target.value)} className={cell} /></td>
                  <td className="p-1 w-16"><input type="number" min="1" value={x.pieces} disabled={locked} onChange={(e) => set(i, 'pieces', e.target.value)} className={cell} /></td>
                  <td className="p-1 w-24"><input type="number" step="0.001" value={x.gross_g} disabled={locked} onChange={(e) => set(i, 'gross_g', e.target.value)} className={cell} /></td>
                  <td className="p-1 w-28"><input type="number" step="0.001" value={x.net_g} disabled={locked} onChange={(e) => set(i, 'net_g', e.target.value)} className={cell} /></td>
                  <td className="p-1 w-20"><select value={x.karat} disabled={locked} onChange={(e) => set(i, 'karat', e.target.value)} className={cell}>{KARATS.map((k) => <option key={k} value={k}>{k}K</option>)}</select></td>
                  <td className="p-1 w-8">{!locked && items.length > 1 && <button aria-label="Remove item" onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))}><Trash2 className="w-3.5 h-3.5 text-slate-500" /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!locked && <button onClick={() => setItems((xs) => [...xs, blankItem()])} className="text-[#0b3b8c] font-semibold flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Add an item</button>}
        <div className="p-3 rounded-md bg-slate-50 border border-slate-200 flex flex-wrap gap-x-6 gap-y-1">
          <span>Gold value <b>{inr(value)}</b></span>
          <span>Most that can be lent <b>{inr(max)}</b></span>
          <span className={Number(app.amount) > max ? 'text-rose-700 font-semibold' : 'text-emerald-700 font-semibold'}>
            {Number(app.amount) > max ? `Applied for ${inr(app.amount)}: more than the gold allows` : `Applied for ${inr(app.amount)}: within the limit`}
          </span>
        </div>
        <p className="text-[11px] text-slate-500">Net weight is the gold alone, after stones and wax. Value = net grams × purity ÷ 24 × today's rate. The member gets the receipt; the jewellery is returned only after the loan is repaid.</p>
      </div>
    </Modal>
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
