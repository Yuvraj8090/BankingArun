import React, { useEffect, useState } from 'react';
import { Layers, RefreshCw, Plus, Save, Trash2, AlertTriangle } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import Modal from '../components/Modal';
import { ValueField as Field, PairSelect as Select } from '../components/FormField';
import { toast } from 'sonner';
import { planFigures, parseUnits } from '../utils/planMath';

const BLANK = {
  code: '', name: '', scheme_type: 'recurring', tenure_months: 12, contribution_months: '',
  contribution_amount: '',
  principal_amount: '', total_deposit: '', maturity_amount: '', payout_type: 'maturity',
  daily_rate_percent: '', withdrawal_threshold: '', lock_in_months: '',
  status: 'draft', notes: '', slabs: []
};

const TYPE_LABEL = { daily: 'Daily', recurring: 'Recurring', fixed: 'Fixed deposit', mis: 'Monthly income' };
// What the form offers for each kind of plan. The server refuses any other pairing
// (SCHEME_PAYOUTS, modules/master.php), so the form never offers one.
const TYPE_OPTION = {
  fixed: 'Fixed deposit: one lump sum, paid back with interest at maturity',
  recurring: 'Recurring (RD / Masik): a fixed instalment every month',
  daily: 'Daily collection (Daily Yojana): a fixed instalment every day',
  mis: 'Monthly income (MIS): one lump sum, interest paid out as it goes',
};
const PAYOUTS = {
  fixed: [['maturity', 'On maturity']],
  recurring: [['maturity', 'On maturity']],
  daily: [['maturity', 'On maturity']],
  mis: [['monthly', 'Monthly payout (slab table)'], ['daily', 'Daily interest (% of the deposit)']],
};
const BY_INSTALMENT = (type) => type === 'recurring' || type === 'daily';

// Back-office scheme master. Nothing here is shown on the public site.
export default function SchemesPage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'bank_owner';
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [autoMonthly, setAutoMonthly] = useState('');
  const [autoMultiple, setAutoMultiple] = useState('');
  // The plan is set by its rate a year and the amounts it is sold in; deposit and
  // maturity for each amount are worked out (utils/planMath.js), never typed.
  // Until either is touched, an existing plan keeps its own published figures.
  const [ratePa, setRatePa] = useState('');
  const [units, setUnits] = useState('');
  const [touched, setTouched] = useState(false);
  const open = (scheme) => {
    setForm({ ...scheme });
    setRatePa(scheme.effective_rate_pa != null ? String(scheme.effective_rate_pa) : '');
    setUnits((scheme.slabs || []).map((x) => x.unit).join(', '));
    setTouched(false); setAutoMonthly(''); setAutoMultiple('');
  };
  const monthly = form?.payout_type === 'monthly';
  const slabs = !form || form.payout_type === 'daily' ? [] : !touched ? form.slabs || []
    : Number(ratePa) > 0 ? parseUnits(units).map((unit) => planFigures({ type: form.scheme_type, payout: form.payout_type,
      unit, ratePa: Number(ratePa), tenureMonths: form.tenure_months, payInMonths: form.contribution_months })) : [];
  const lockMode = !form ? 'default' : form.lock_in_months == null || form.lock_in_months === '' ? 'default'
    : Number(form.lock_in_months) >= Number(form.tenure_months) ? 'term' : 'months';
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
        'daily_rate_percent', 'withdrawal_threshold', 'lock_in_months']
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
        if (touched) {
          if (!slabs.length) throw { response: { data: { detail: 'Enter the interest % a year and at least one amount.' } } };
          const top = slabs[slabs.length - 1];
          payload.slabs = slabs;
          payload.total_deposit = top.deposit;
          payload.maturity_amount = top.maturity;
          if (BY_INSTALMENT(payload.scheme_type)) payload.contribution_amount = top.unit;
          else payload.principal_amount = top.unit;
        }
      }
      const r = form.id ? await api.schemeUpdate(form.id, payload) : await api.schemeCreate(payload);
      toast.success(r.message);
      setForm(null);
      load();
    } catch (e) { toast.error(e.response?.data?.detail || 'Save failed'); }
    finally { setSaving(false); }
  };

  // Keeps the plan, its name, tenure and amounts; brings every figure down to the cap.
  const reprice = async (scheme) => {
    if (!window.confirm(`Re-price ${scheme.code} so it pays no more than ${data.max_rate_pa}% a year? Deposits already booked are brought to the cap separately.`)) return;
    try { toast.success((await api.schemeReprice(scheme.id)).message); load(); }
    catch (e) { toast.error(e.response?.data?.detail || 'Re-pricing failed'); }
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
          <button data-testid="scheme-new-btn" onClick={() => open(BLANK)}
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
                    <button onClick={() => open(s)} data-testid={`scheme-edit-${s.code}`}
                      className="text-[#0b3b8c] font-semibold hover:underline py-1.5 px-1 -mx-1">Edit</button>
                    {(s.exceeds_cap || s.slabs?.some(x => x.exceeds_cap)) && (
                      <button data-testid={`scheme-reprice-${s.code}`} onClick={() => reprice(s)}
                        className="ml-2 text-amber-700 font-semibold hover:underline py-1.5 px-1">Re-price to {data.max_rate_pa}%</button>
                    )}
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
            <Select label="Type" value={form.scheme_type} options={data.types.map(t => [t, TYPE_OPTION[t] || t])}
              onChange={v => setForm(f => ({ ...f, scheme_type: v,
                payout_type: PAYOUTS[v].some(([p]) => p === f.payout_type) ? f.payout_type : PAYOUTS[v][0][0] }))}
              testId="scheme-type" />
            <Field label={`Tenure (months)${Number(form.tenure_months) ? ` = ${(Number(form.tenure_months) / 12).toFixed(Number(form.tenure_months) % 12 ? 2 : 0)} years` : ''}`}
              type="number" value={form.tenure_months} onChange={v => { setTouched(true); setForm(f => ({ ...f, tenure_months: v, lock_in_months: lockMode === 'term' ? v : f.lock_in_months })); }} testId="scheme-tenure" />
            {BY_INSTALMENT(form.scheme_type) && (
              <Field label="Pay-in months (blank = the whole tenure)" type="number" value={form.contribution_months ?? ''}
                onChange={v => { setTouched(true); setForm(f => ({ ...f, contribution_months: v })); }} testId="scheme-payin" />
            )}
            {form.payout_type === 'daily' ? (
              <Field label="Minimum deposit (₹)" type="number" value={form.principal_amount ?? ''}
                onChange={v => setForm(f => ({ ...f, principal_amount: v }))} />
            ) : (
              <Field label={`Interest (% a year, at most ${data.max_rate_pa})`} type="number" value={ratePa}
                onChange={v => { setTouched(true); setRatePa(v); }} testId="scheme-rate-pa" />
            )}
            {PAYOUTS[form.scheme_type].length > 1 ? (
              <Select label="How interest is paid" value={form.payout_type} options={PAYOUTS[form.scheme_type]}
                onChange={v => setForm(f => ({ ...f, payout_type: v }))} testId="scheme-payout" />
            ) : (
              <p className="text-[11px] text-slate-600 self-end pb-2" data-testid="scheme-payout">
                Pays out: <strong>{PAYOUTS[form.scheme_type][0][1].toLowerCase()}</strong>
              </p>
            )}
            {form.payout_type === 'daily' && (<>
              <Field label="Daily rate (%)" type="number" value={form.daily_rate_percent ?? ''}
                onChange={v => setForm(f => ({ ...f, daily_rate_percent: v }))} testId="scheme-daily-rate" />
              <Field label="…or type a monthly rate (%) — daily = monthly ÷ 30" type="number" value={autoMonthly}
                onChange={v => {
                  setAutoMonthly(v);
                  const m = Number(v);
                  if (m > 0) setForm(f => ({ ...f, daily_rate_percent: Math.round(m / 30 * 100000) / 100000 }));
                }} testId="scheme-monthly-rate" />
              <Field label="…or: money grows to ×N of the deposit over the tenure (2 = doubles, 3 = triples)" type="number"
                value={autoMultiple}
                onChange={v => {
                  setAutoMultiple(v);
                  const x = Number(v);
                  const days = Number(form.tenure_months) * 30;
                  if (x > 1 && days > 0) setForm(f => ({ ...f, daily_rate_percent: Math.round((x - 1) * 100 / days * 100000) / 100000 }));
                }} testId="scheme-multiple" />
              {Number(form.daily_rate_percent) > 0 && (() => {
                const principal = Number(form.principal_amount) || 10000;
                const perDay = principal * Number(form.daily_rate_percent) / 100;
                const days = Number(form.tenure_months) * 30;
                return (
                  <div data-testid="scheme-daily-preview"
                    className="md:col-span-2 p-3 rounded-md bg-emerald-50 border border-emerald-200 text-[11px] text-emerald-900">
                    On ₹{principal.toLocaleString('en-IN')}: <strong>₹{perDay.toFixed(2)} a day</strong>,
                    about ₹{(perDay * 30).toFixed(0)} a month, ₹{(perDay * days).toFixed(0)} in interest over
                    {' '}{form.tenure_months} months (deposit comes back ×{(1 + perDay * days / principal).toFixed(2)} in total),
                    which is {(Number(form.daily_rate_percent) * 365).toFixed(2)}% a year — the Nidhi Rules cap is {data.max_rate_pa}%.
                  </div>
                );
              })()}
              <Field label="Withdrawal threshold (₹, blank = pay out daily)" type="number"
                value={form.withdrawal_threshold ?? ''}
                onChange={v => setForm(f => ({ ...f, withdrawal_threshold: v }))} testId="scheme-threshold" />
            </>)}
            <Select label="Early withdrawal" value={lockMode} testId="scheme-lock-mode"
              options={[['default', 'Allowed any time after 30 days'], ['months', 'Locked for a number of months'],
                ['term', 'Locked until maturity']]}
              onChange={v => setForm(f => ({ ...f, lock_in_months: v === 'default' ? null : v === 'term' ? f.tenure_months : 12 }))} />
            {lockMode === 'months' && (
              <Field label="Locked for (months) — early closing is refused before this" type="number"
                value={form.lock_in_months ?? ''} onChange={v => setForm(f => ({ ...f, lock_in_months: v }))}
                testId="scheme-lock-in" />
            )}
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
            <div className="md:col-span-2 space-y-2">
              <label className="block text-[11px] font-semibold text-slate-700" htmlFor="scheme-units">
                Amounts it is sold in (₹ {BY_INSTALMENT(form.scheme_type) ? `instalment a ${form.scheme_type === 'daily' ? 'day' : 'month'}` : 'deposit'}, comma-separated, e.g. 8000, 16000, 24000)
              </label>
              <textarea id="scheme-units" data-testid="scheme-units" rows={2} value={units}
                onChange={e => { setTouched(true); setUnits(e.target.value); }}
                className="w-full px-3 py-2 rounded-md border border-slate-200 text-xs font-mono text-slate-900 bg-white" />
              {Number(ratePa) > data.max_rate_pa && (
                <p className="text-[11px] text-rose-700">Above the {data.max_rate_pa}% cap: it can be saved as a draft but not made active.</p>
              )}
              <p className="text-[11px] text-slate-500">
                {touched ? 'Worked out from the rate and tenure:' : 'As published now. Change the rate, tenure or amounts to recalculate.'}
              </p>
              <div className="overflow-x-auto border border-slate-200 rounded-md">
                <table className="w-full text-[11px]" data-testid="scheme-slab-table">
                  <thead className="bg-slate-50 text-slate-500"><tr>
                    <th className="p-2 text-left">Amount</th><th className="p-2 text-right">Paid in</th>
                    {monthly && <th className="p-2 text-right">Paid out a month</th>}
                    <th className="p-2 text-right">{monthly ? 'Payouts in total' : 'At maturity'}</th>
                  </tr></thead>
                  <tbody>
                    {slabs.map((x) => (
                      <tr key={x.unit} className="border-t border-slate-100">
                        <td className="p-2">₹{Number(x.unit).toLocaleString('en-IN')}</td>
                        <td className="p-2 text-right">₹{Number(x.deposit).toLocaleString('en-IN')}</td>
                        {monthly && <td className="p-2 text-right">₹{Number(x.monthly_payout).toLocaleString('en-IN')}</td>}
                        <td className="p-2 text-right font-semibold">₹{Number(x.maturity).toLocaleString('en-IN')}</td>
                      </tr>
                    ))}
                    {!slabs.length && <tr><td colSpan={4} className="p-2 text-slate-500">Enter the interest % a year and the amounts.</td></tr>}
                  </tbody>
                </table>
              </div>
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
