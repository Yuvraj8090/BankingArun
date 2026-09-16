import React, { useEffect, useState } from 'react';
import { Layers, RefreshCw, Plus, Save, Trash2, AlertTriangle, X } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { toast } from 'sonner';

const BLANK = {
  code: '', name: '', scheme_type: 'recurring', tenure_months: 12, contribution_months: '',
  contribution_amount: '',
  principal_amount: '', total_deposit: '', maturity_amount: '', payout_type: 'maturity',
  status: 'draft', notes: '', slabs: []
};

const TYPE_LABEL = { daily: 'Daily', recurring: 'Recurring', fixed: 'Fixed deposit', mis: 'Monthly income' };

// Slabs are edited as plain lines rather than JSON so a manager can paste a
// column straight out of the brochure.
const slabText = (slabs) =>
  (slabs || []).map(s => `${s.unit}, ${s.deposit}, ${s.maturity}`).join('\n');

const parseSlabs = (text) => text.split('\n')
  .map(line => line.split(',').map(n => Number(n.trim())))
  .filter(p => p.length === 3 && p.every(n => Number.isFinite(n) && n > 0))
  .map(([unit, deposit, maturity]) => ({ unit, deposit, maturity }));

// Back-office scheme master. Nothing here is shown on the public site.
export default function SchemesPage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'bank_owner';
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try { setData(await api.schemesList()); }
    catch (e) { toast.error(e.response?.data?.detail || 'Could not load schemes'); }
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    try {
      const payload = { ...form };
      ['tenure_months', 'contribution_amount', 'principal_amount', 'total_deposit', 'maturity_amount']
        .forEach(k => { payload[k] = payload[k] === '' ? null : Number(payload[k]); });
      const r = form.id ? await api.schemeUpdate(form.id, payload) : await api.schemeCreate(payload);
      toast.success(r.message);
      setForm(null);
      load();
    } catch (e) { toast.error(e.response?.data?.detail || 'Save failed'); }
    finally { setSaving(false); }
  };

  const remove = async (scheme) => {
    if (!window.confirm(`Delete scheme ${scheme.code}?`)) return;
    try { toast.success((await api.schemeDelete(scheme.id)).message); load(); }
    catch (e) { toast.error(e.response?.data?.detail || 'Delete failed'); }
  };

  if (!data) return <div className="p-10 flex items-center gap-2 text-slate-600"><RefreshCw className="w-4 h-4 animate-spin" /> Loading scheme master…</div>;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-md bg-[#0b3b8c] text-white flex items-center justify-center"><Layers className="w-5 h-5" /></div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Scheme Master</h1>
            <p className="text-xs text-slate-500">Deposit plans used by staff · internal only, never shown on the public site</p>
          </div>
        </div>
        {canEdit && (
          <button data-testid="scheme-new-btn" onClick={() => setForm({ ...BLANK })}
            className="px-4 py-2 rounded-md bg-[#0b3b8c] text-white text-xs font-semibold flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" /> New scheme
          </button>
        )}
      </div>

      <div className="flex items-start gap-2 p-3 rounded-md bg-amber-50 border border-amber-200 text-[11px] text-amber-900">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
        <p>
          The Nidhi Rules, 2014 cap deposit interest at <strong>{data.max_rate_pa}% a year</strong>. The effective
          return below is computed from each plan's own deposit and maturity figures. A plan above the cap can be kept
          as a draft for reference, but cannot be set to active.
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-[11px] uppercase text-slate-600">
            <tr>
              <th className="p-3 font-semibold">Code</th>
              <th className="p-3 font-semibold">Scheme</th>
              <th className="p-3 font-semibold">Type</th>
              <th className="p-3 font-semibold text-right">Tenure</th>
              <th className="p-3 font-semibold text-right">Deposit</th>
              <th className="p-3 font-semibold text-right">Maturity</th>
              <th className="p-3 font-semibold text-right">Denominations</th>
              <th className="p-3 font-semibold text-right">Effective p.a.</th>
              <th className="p-3 font-semibold">Status</th>
              {canEdit && <th className="p-3 font-semibold text-right">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.schemes.map(s => (
              <tr key={s.id} data-testid={`scheme-row-${s.code}`} className="hover:bg-slate-50">
                <td className="p-3 font-mono font-semibold text-slate-900">{s.code}</td>
                <td className="p-3 text-slate-700">{s.name}</td>
                <td className="p-3 text-slate-600">{TYPE_LABEL[s.scheme_type] || s.scheme_type}</td>
                <td className="p-3 text-right text-slate-600">
                  {s.tenure_months} mo
                  {s.contribution_months && s.contribution_months < s.tenure_months
                    && <span className="block text-[9px] text-slate-400">pay in {s.contribution_months} mo</span>}
                </td>
                <td className="p-3 text-right text-slate-700">₹{Number(s.total_deposit).toLocaleString('en-IN')}</td>
                <td className="p-3 text-right text-slate-700">₹{Number(s.maturity_amount).toLocaleString('en-IN')}</td>
                <td className="p-3 text-right text-slate-600">
                  {s.slabs?.length || 0}
                  {s.slabs?.some(x => x.exceeds_cap) && (
                    <span className="block text-[9px] text-[#c8102e] font-semibold">
                      {s.slabs.filter(x => x.exceeds_cap).length} over cap
                    </span>
                  )}
                  {!s.slabs?.some(x => x.exceeds_cap) && s.slabs?.some(x => x.off_headline) && (
                    <span className="block text-[9px] text-amber-700">
                      {s.slabs.filter(x => x.off_headline).length} priced differently
                    </span>
                  )}
                </td>
                <td className={`p-3 text-right font-semibold ${s.exceeds_cap ? 'text-[#c8102e]' : 'text-emerald-700'}`}>
                  {s.effective_rate_pa === null ? '—' : `${s.effective_rate_pa}%`}
                  {s.exceeds_cap && <span className="block text-[9px] font-normal">above cap</span>}
                </td>
                <td className="p-3">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                    s.status === 'active' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : s.status === 'draft' ? 'bg-amber-50 text-amber-700 border-amber-200'
                      : 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                    {s.status}
                  </span>
                </td>
                {canEdit && (
                  <td className="p-3 text-right whitespace-nowrap">
                    <button onClick={() => setForm({ ...s })} data-testid={`scheme-edit-${s.code}`}
                      className="text-[#0b3b8c] font-semibold hover:underline">Edit</button>
                    <button onClick={() => remove(s)} className="ml-3 text-[#c8102e] hover:underline inline-flex items-center gap-1">
                      <Trash2 className="w-3 h-3" /> Delete
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {!data.schemes.length && <p className="p-6 text-center text-xs text-slate-500">No schemes yet.</p>}
      </div>

      {form && (
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
          <div className="p-5 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">{form.id ? `Edit ${form.code}` : 'New scheme'}</h2>
            <button onClick={() => setForm(null)} className="text-slate-500 hover:text-slate-700"><X className="w-4 h-4" /></button>
          </div>
          <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Code" value={form.code} onChange={v => setForm(f => ({ ...f, code: v }))} testId="scheme-code" />
            <Field label="Name" value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} testId="scheme-name" />
            <Select label="Type" value={form.scheme_type} options={data.types.map(t => [t, TYPE_LABEL[t] || t])}
              onChange={v => setForm(f => ({ ...f, scheme_type: v }))} testId="scheme-type" />
            <Field label="Tenure (months)" type="number" value={form.tenure_months} onChange={v => setForm(f => ({ ...f, tenure_months: v }))} testId="scheme-tenure" />
            <Field label="Pay-in months (blank = whole tenure)" type="number" value={form.contribution_months ?? ''}
              onChange={v => setForm(f => ({ ...f, contribution_months: v }))} testId="scheme-payin" />
            <Field label="Per instalment (₹)" type="number" value={form.contribution_amount ?? ''} onChange={v => setForm(f => ({ ...f, contribution_amount: v }))} />
            <Field label="Lump sum principal (₹)" type="number" value={form.principal_amount ?? ''} onChange={v => setForm(f => ({ ...f, principal_amount: v }))} />
            <Field label="Total deposit (₹)" type="number" value={form.total_deposit} onChange={v => setForm(f => ({ ...f, total_deposit: v }))} testId="scheme-deposit" />
            <Field label="Maturity amount (₹)" type="number" value={form.maturity_amount} onChange={v => setForm(f => ({ ...f, maturity_amount: v }))} testId="scheme-maturity" />
            <Select label="Payout" value={form.payout_type} options={[['maturity', 'On maturity'], ['monthly', 'Monthly']]}
              onChange={v => setForm(f => ({ ...f, payout_type: v }))} />
            <Select label="Status" value={form.status} options={data.statuses.map(s => [s, s])}
              onChange={v => setForm(f => ({ ...f, status: v }))} testId="scheme-status" />
            <div className="md:col-span-2">
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                Denominations this plan is sold in
              </label>
              <p className="text-[11px] text-slate-500 mb-1.5">
                One line per amount: <span className="font-mono">unit, total deposit, maturity</span>.
                Every line has to stay within the {data.max_rate_pa}% cap before the plan can go active.
              </p>
              <textarea
                data-testid="scheme-slabs"
                rows={6}
                value={slabText(form.slabs)}
                onChange={e => setForm(f => ({ ...f, slabs: parseSlabs(e.target.value) }))}
                className="w-full px-3 py-2 rounded-md border border-slate-200 text-xs font-mono text-slate-900 bg-white"
                placeholder={'500, 36000, 52500\n1000, 72000, 105000'}
              />
            </div>
            <div className="md:col-span-2">
              <Field label="Notes" value={form.notes ?? ''} onChange={v => setForm(f => ({ ...f, notes: v }))} />
            </div>
          </div>
          <div className="px-5 pb-5 flex justify-end">
            <button data-testid="scheme-save-btn" disabled={saving} onClick={save}
              className="px-5 py-2 rounded-md bg-[#0b3b8c] text-white text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50">
              {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save scheme
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', testId }) {
  return (
    <div>
      <label className="block text-[11px] text-slate-600 mb-1">{label}</label>
      <input type={type} value={value} data-testid={testId} onChange={e => onChange(e.target.value)}
        className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm text-slate-900" />
    </div>
  );
}

function Select({ label, value, options, onChange, testId }) {
  return (
    <div>
      <label className="block text-[11px] text-slate-600 mb-1">{label}</label>
      <select value={value} data-testid={testId} onChange={e => onChange(e.target.value)}
        className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm text-slate-900 bg-white">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}
