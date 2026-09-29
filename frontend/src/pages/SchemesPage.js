import React, { useEffect, useState } from 'react';
import { Layers, RefreshCw, Plus, Save, Trash2, AlertTriangle } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import Modal from '../components/Modal';
import { ValueField as Field, PairSelect as Select } from '../components/FormField';
import { toast } from 'sonner';

const BLANK = {
  code: '', name: '', scheme_type: 'recurring', tenure_months: 12, contribution_months: '',
  contribution_amount: '',
  principal_amount: '', total_deposit: '', maturity_amount: '', payout_type: 'maturity',
  daily_rate_percent: '', withdrawal_threshold: '',
  status: 'draft', notes: '', slabs: []
};

const TYPE_LABEL = { daily: 'Daily', recurring: 'Recurring', fixed: 'Fixed deposit', mis: 'Monthly income' };

// Slabs are edited as plain lines rather than JSON so a manager can paste a
// column straight out of the brochure.
// A monthly-income plan carries a fourth number per row: what the member is
// handed each month. It was being dropped on the way out and again on the way
// back, so editing such a plan silently removed the thing that gets paid.
const slabText = (slabs, monthly) =>
  (slabs || []).map(s => monthly
    ? `${s.unit}, ${s.deposit}, ${s.maturity}, ${s.monthly_payout ?? ''}`
    : `${s.unit}, ${s.deposit}, ${s.maturity}`).join('\n');

const parseSlabs = (text, monthly) => text.split('\n')
  .map(line => line.split(',').map(n => Number(n.trim())))
  .filter(p => p.length >= (monthly ? 4 : 3) && p.every(n => Number.isFinite(n) && n > 0))
  .map(([unit, deposit, maturity, monthlyPayout]) => (monthly
    ? { unit, deposit, maturity, monthly_payout: monthlyPayout }
    : { unit, deposit, maturity }));

// Back-office scheme master. Nothing here is shown on the public site.
export default function SchemesPage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'bank_owner';
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const overCap = (data?.schemes || []).filter((x) => x.exceeds_cap);

  const load = async () => {
    try { setData(await api.schemesList()); }
    catch (e) { toast.error(e.response?.data?.detail || 'Could not load schemes'); }
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    try {
      const payload = { ...form };
      ['tenure_months', 'contribution_amount', 'principal_amount', 'total_deposit', 'maturity_amount',
        'daily_rate_percent', 'withdrawal_threshold']
        .forEach(k => { payload[k] = payload[k] === '' ? null : Number(payload[k]); });
      // A simple daily-% plan has no slab table -- total_deposit/maturity_amount
      // are filled in server-side as an illustrative example, and slabs stays
      // empty so an old plan's leftover rows are not carried into it by mistake.
      if (payload.payout_type === 'daily') {
        payload.total_deposit = null;
        payload.maturity_amount = null;
        payload.slabs = [];
      } else {
        payload.daily_rate_percent = null;
        payload.withdrawal_threshold = null;
      }
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
        <div className="space-y-1.5">
          <p>
            The Nidhi Rules, 2014 cap deposit interest at <strong>{data.max_rate_pa}% a year</strong>. The effective
            return below is computed from each plan's own deposit and maturity figures.
          </p>
          {/* This notice used to end "a plan above the cap cannot be set to active",
              which was not true of the plans sitting on this very page. The editor
              does refuse it; plans activated directly in the database were never
              asked. Saying it plainly beats a member finding the contradiction. */}
          {overCap.length > 0 ? (
            <p data-testid="scheme-cap-truth">
              <strong>{overCap.length} active plan{overCap.length === 1 ? '' : 's'} price
              above the cap.</strong> This editor refuses to activate one — they were published
              straight to the database from the printed brochure, which does not go through that
              check. Each is marked below with the maturity figure that would bring it to
              exactly {data.max_rate_pa}%.
            </p>
          ) : (
            <p>No active plan prices above the cap. The editor refuses to activate one.</p>
          )}
          <p className="text-amber-800">
            Three ways out of an over-cap plan, in the order they cost least: reprint it at the
            compliant figure shown, leave it active and disclose the rate wherever it is quoted
            (which is what happens today), or set it to draft so it stops being sold. Reducing a
            figure a member has already been sold on is a decision for the board, not this screen.
          </p>
        </div>
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
              <th className="p-3 font-semibold text-right">Amounts offered</th>
              <th className="p-3 font-semibold text-right">Effective p.a.</th>
              <th className="p-3 font-semibold">Status</th>
              {canEdit && <th className="p-3 font-semibold text-right">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.schemes.map(s => (
              <tr key={s.id} data-testid={`scheme-row-${s.code}`} className="hover:bg-blue-50/40 transition-colors">
                <td className="p-3 font-mono font-semibold text-slate-900">{s.code}</td>
                <td className="p-3 text-slate-700">{s.name}</td>
                <td className="p-3 text-slate-600">{TYPE_LABEL[s.scheme_type] || s.scheme_type}</td>
                <td className="p-3 text-right text-slate-600">
                  {s.tenure_months} mo
                  {s.contribution_months && s.contribution_months < s.tenure_months
                    && <span className="block text-[9px] text-slate-500">pay in {s.contribution_months} mo</span>}
                </td>
                <td className="p-3 text-right text-slate-700">
                  {s.daily_rate_percent != null ? `₹${Number(s.principal_amount).toLocaleString('en-IN')}+` : `₹${Number(s.total_deposit).toLocaleString('en-IN')}`}
                </td>
                <td className="p-3 text-right text-slate-700">
                  {s.daily_rate_percent != null ? `${s.daily_rate_percent}%/day` : `₹${Number(s.maturity_amount).toLocaleString('en-IN')}`}
                </td>
                <td className="p-3 text-right text-slate-600">
                  {s.daily_rate_percent != null ? 'any amount' : (s.slabs?.length || 0)}
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
                  {/* The warning and the remedy in the same cell: a flag with no
                      number beside it leaves whoever has to fix it doing the
                      arithmetic by hand, which is how it stays unfixed. */}
                  {s.exceeds_cap && (
                    <span className="block text-[9px] font-normal" data-testid={`scheme-fix-${s.code}`}>
                      above cap
                      {s.cap_compliant && (
                        <span className="block text-slate-500">
                          {s.max_rate_pa || 12.5}% would be ₹
                          {Number(s.cap_compliant.maturity_amount).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                          {s.cap_compliant.monthly_payout
                            ? ` (₹${Number(s.cap_compliant.monthly_payout).toLocaleString('en-IN', { maximumFractionDigits: 0 })}/mo)`
                            : ''}
                        </span>
                      )}
                    </span>
                  )}
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
                      className="text-[#0b3b8c] font-semibold hover:underline py-1.5 px-1 -mx-1">Edit</button>
                    <button onClick={() => remove(s)} className="ml-2 text-[#c8102e] hover:underline inline-flex items-center gap-1 py-1.5 px-1">
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
        <Modal
          testId="scheme-modal"
          wide
          title={form.id ? `Edit ${form.code}` : 'New scheme'}
          subtitle={`The effective rate is worked out as you save; nothing above ${data.max_rate_pa}% a year can be made active.`}
          onClose={() => setForm(null)}
          footer={<>
            <button onClick={() => setForm(null)}
              className="px-4 py-2 rounded-md border border-slate-200 text-xs font-semibold text-slate-700">Cancel</button>
            <button data-testid="scheme-save-btn" disabled={saving} onClick={save}
              className="px-5 py-2 rounded-md bg-[#0b3b8c] text-white text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50">
              {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save scheme
            </button>
          </>}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Code" value={form.code} onChange={v => setForm(f => ({ ...f, code: v }))} testId="scheme-code" />
            <Field label="Name" value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} testId="scheme-name" />
            <Select label="Type" value={form.scheme_type} options={data.types.map(t => [t, TYPE_LABEL[t] || t])}
              onChange={v => setForm(f => ({ ...f, scheme_type: v }))} testId="scheme-type" />
            <Field label="Tenure (months)" type="number" value={form.tenure_months} onChange={v => setForm(f => ({ ...f, tenure_months: v }))} testId="scheme-tenure" />
            <Field label="Pay-in months (blank = whole tenure)" type="number" value={form.contribution_months ?? ''}
              onChange={v => setForm(f => ({ ...f, contribution_months: v }))} testId="scheme-payin" />
            <Field label="Per instalment (₹)" type="number" value={form.contribution_amount ?? ''} onChange={v => setForm(f => ({ ...f, contribution_amount: v }))} />
            <Field label={form.payout_type === 'daily' ? 'Minimum deposit (₹)' : 'Lump sum principal (₹)'}
              type="number" value={form.principal_amount ?? ''} onChange={v => setForm(f => ({ ...f, principal_amount: v }))} />
            {form.payout_type !== 'daily' && (<>
              <Field label="Total deposit (₹)" type="number" value={form.total_deposit} onChange={v => setForm(f => ({ ...f, total_deposit: v }))} testId="scheme-deposit" />
              <Field label="Maturity amount (₹)" type="number" value={form.maturity_amount} onChange={v => setForm(f => ({ ...f, maturity_amount: v }))} testId="scheme-maturity" />
            </>)}
            <Select label="Payout" value={form.payout_type}
              options={[['maturity', 'On maturity'], ['monthly', 'Monthly (slab table)'], ['daily', 'Daily % (simple)']]}
              onChange={v => setForm(f => ({ ...f, payout_type: v }))} testId="scheme-payout" />
            {form.payout_type === 'daily' && (<>
              <Field label="Daily rate (%)" type="number" value={form.daily_rate_percent ?? ''}
                onChange={v => setForm(f => ({ ...f, daily_rate_percent: v }))} testId="scheme-daily-rate" />
              <Field label="Withdrawal threshold (₹, blank = pay out daily)" type="number"
                value={form.withdrawal_threshold ?? ''}
                onChange={v => setForm(f => ({ ...f, withdrawal_threshold: v }))} testId="scheme-threshold" />
            </>)}
            <Select label="Status" value={form.status} options={data.statuses.map(s => [s, s])}
              onChange={v => setForm(f => ({ ...f, status: v }))} testId="scheme-status" />
            {form.payout_type === 'daily' ? (
              <div className="md:col-span-2 p-3 rounded-md bg-blue-50 border border-blue-200 text-[11px] text-blue-900">
                Any deposit at or above the minimum earns this percent of itself every day, credited
                straight to the deposit. Once the earned-but-unpaid total reaches the withdrawal
                threshold, it is paid into the member's account in one go and starts building up
                again — leave the threshold blank to pay it out daily instead. No amount list needed.
              </div>
            ) : (
            <div className="md:col-span-2">
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                The amounts this plan is sold in
              </label>
              <p className="text-[11px] text-slate-500 mb-1.5">
                One line per amount:{' '}
                <span className="font-mono">
                  unit, total deposit, maturity{form.payout_type === 'monthly' ? ', monthly payout' : ''}
                </span>.
                {form.payout_type === 'monthly' && (
                  <> This plan pays out every month, so each line needs the fourth number — it is
                  what the member is handed each month, and what their payout is calculated from.
                  A line without it is rejected rather than saved with the payout missing.</>
                )}{' '}
                Every line has to stay within the {data.max_rate_pa}% cap before a new plan can go
                active.
              </p>
              <textarea
                data-testid="scheme-slabs"
                rows={6}
                value={slabText(form.slabs, form.payout_type === 'monthly')}
                onChange={e => setForm(f => ({
                  ...f, slabs: parseSlabs(e.target.value, f.payout_type === 'monthly'),
                }))}
                className="w-full px-3 py-2 rounded-md border border-slate-200 text-xs font-mono text-slate-900 bg-white"
                placeholder={form.payout_type === 'monthly'
                  ? '10000, 10000, 15000, 250\n20000, 20000, 30000, 500'
                  : '500, 36000, 52500\n1000, 72000, 105000'}
              />
            </div>
            )}
            <div className="md:col-span-2">
              <Field label="Notes" value={form.notes ?? ''} onChange={v => setForm(f => ({ ...f, notes: v }))} />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
