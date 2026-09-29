import React, { useEffect, useState } from 'react';
import { SlidersHorizontal, RefreshCw, Plus, Save, Trash2, Search, ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import Modal from '../components/Modal';
import { ValueField as Field, PairSelect as Select } from '../components/FormField';
import { toast } from 'sonner';

const BLANK = {
  param_key: '', label: '', category: 'fees', value: '', unit: '', min_value: '', max_value: '', description: '',
};

const CATEGORY_LABEL = {
  loan_rates: 'Loan rates', deposit_rates: 'Deposit rates', fees: 'Fees', limits: 'Limits', program: 'Program',
};

// Business parameters — every rate, fee and limit that used to be a PHP
// constant. A real table (system_parameters), not another key in a settings
// blob: searchable, filterable by category, paginated, and fully editable
// without a deploy.
export default function ParametersPage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'bank_owner';
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const [qInput, setQInput] = useState('');
  const [page, setPage] = useState(1);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  // Debounce the search box so every keystroke doesn't fire a request.
  useEffect(() => {
    const t = setTimeout(() => { setQ(qInput); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [qInput]);

  const load = async () => {
    setLoading(true);
    try {
      const query = { page, per_page: 10 };
      if (category) query.category = category;
      if (q) query.q = q;
      setData(await api.parametersList(query));
    } catch (e) { toast.error(e.response?.data?.detail || 'Could not load parameters'); }
    finally { setLoading(false); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [category, q, page]);

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        ...form,
        value: form.value === '' ? '' : Number(form.value),
        min_value: form.min_value === '' ? '' : Number(form.min_value),
        max_value: form.max_value === '' ? '' : Number(form.max_value),
      };
      const r = form.id ? await api.parameterUpdate(form.id, payload) : await api.parameterCreate(payload);
      toast.success(r.message);
      setForm(null);
      load();
    } catch (e) { toast.error(e.response?.data?.detail || 'Save failed'); }
    finally { setSaving(false); }
  };

  const remove = async (p) => {
    if (!window.confirm(`Delete parameter "${p.label}" (${p.param_key})? Callers fall back to the code default.`)) return;
    try { toast.success((await api.parameterDelete(p.id)).message); load(); }
    catch (e) { toast.error(e.response?.data?.detail || 'Delete failed'); }
  };

  if (loading && !data) return <div className="p-10 flex items-center gap-2 text-slate-600"><RefreshCw className="w-4 h-4 animate-spin" /> Loading business parameters…</div>;

  const meta = data?.meta || {};
  const categories = data?.categories || [];

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-md bg-[#0b3b8c] text-white flex items-center justify-center"><SlidersHorizontal className="w-5 h-5" /></div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Business Parameters</h1>
            <p className="text-xs text-slate-500">Loan/deposit rates, fees and limits — one editable table, no deploy needed</p>
          </div>
        </div>
        {canEdit && (
          <button data-testid="param-new-btn" onClick={() => setForm({ ...BLANK })}
            className="px-4 py-2 rounded-md bg-[#0b3b8c] text-white text-xs font-semibold flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" /> New parameter
          </button>
        )}
      </div>

      <div className="flex items-start gap-2 p-3 rounded-md bg-amber-50 border border-amber-200 text-[11px] text-amber-900">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
        <p>
          A <strong>deposit_rates</strong> parameter can never be saved above the <strong>{data?.nidhi_cap ?? 12.5}%</strong> Nidhi
          Rules cap — enforced on every save, regardless of what its own min/max say.
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
        <div className="p-3 border-b border-slate-100 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input data-testid="param-search" value={qInput} onChange={e => setQInput(e.target.value)}
              placeholder="Search key, label or description…"
              className="w-full pl-8 pr-3 py-2 rounded-md border border-slate-200 text-xs text-slate-900" />
          </div>
          <select data-testid="param-category-filter" value={category}
            onChange={e => { setCategory(e.target.value); setPage(1); }}
            className="border border-slate-200 rounded-md px-3 py-2 text-xs text-slate-900 bg-white">
            <option value="">All categories</option>
            {categories.map(c => <option key={c} value={c}>{CATEGORY_LABEL[c] || c}</option>)}
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[11px] uppercase text-slate-600">
              <tr>
                <th className="p-3 font-semibold">Key</th>
                <th className="p-3 font-semibold">Label</th>
                <th className="p-3 font-semibold">Category</th>
                <th className="p-3 font-semibold text-right">Value</th>
                <th className="p-3 font-semibold">Updated</th>
                {canEdit && <th className="p-3 font-semibold text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(data?.parameters || []).map(p => (
                <tr key={p.id} data-testid={`param-row-${p.param_key}`} className="hover:bg-blue-50/40 transition-colors">
                  <td className="p-3 font-mono text-slate-900">{p.param_key}</td>
                  <td className="p-3 text-slate-700">
                    {p.label}
                    {p.description && <span className="block text-[10px] text-slate-500 mt-0.5">{p.description}</span>}
                  </td>
                  <td className="p-3">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-slate-50 text-slate-600 border-slate-200">
                      {CATEGORY_LABEL[p.category] || p.category}
                    </span>
                    {p.nidhi_capped && <span className="block text-[9px] text-[#c8102e] font-semibold mt-0.5">Nidhi-capped</span>}
                  </td>
                  <td className="p-3 text-right font-semibold text-slate-900">
                    {p.unit === '₹' ? `₹${Number(p.value).toLocaleString('en-IN')}` : `${p.value}${p.unit ? ` ${p.unit}` : ''}`}
                    {(p.min_value !== null || p.max_value !== null) && (
                      <span className="block text-[9px] font-normal text-slate-500">
                        {p.min_value ?? '−∞'} – {p.max_value ?? '∞'}
                      </span>
                    )}
                  </td>
                  <td className="p-3 text-slate-500">
                    {p.updated_by ? <>{p.updated_by}<span className="block text-[9px]">{new Date(p.updated_at).toLocaleString('en-IN')}</span></> : '—'}
                  </td>
                  {canEdit && (
                    <td className="p-3 text-right whitespace-nowrap">
                      <button onClick={() => setForm({ ...p })} data-testid={`param-edit-${p.param_key}`}
                        className="text-[#0b3b8c] font-semibold hover:underline py-1.5 px-1 -mx-1">Edit</button>
                      <button onClick={() => remove(p)} data-testid={`param-delete-${p.param_key}`}
                        className="ml-2 text-[#c8102e] hover:underline inline-flex items-center gap-1 py-1.5 px-1">
                        <Trash2 className="w-3 h-3" /> Delete
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && !(data?.parameters || []).length && (
            <p className="p-6 text-center text-xs text-slate-500">No parameters match this search/filter.</p>
          )}
        </div>

        {meta.total > 0 && (
          <div className="p-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-600">
            <span data-testid="param-page-info">Showing {meta.from}–{meta.to} of {meta.total}</span>
            <div className="flex items-center gap-2">
              <button disabled={!meta.has_prev} onClick={() => setPage(p => p - 1)} data-testid="param-prev"
                className="p-1.5 rounded-md border border-slate-200 disabled:opacity-40 disabled:cursor-not-allowed">
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span>Page {meta.page} of {meta.pages}</span>
              <button disabled={!meta.has_next} onClick={() => setPage(p => p + 1)} data-testid="param-next"
                className="p-1.5 rounded-md border border-slate-200 disabled:opacity-40 disabled:cursor-not-allowed">
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {form && (
        <Modal
          testId="param-modal"
          title={form.id ? `Edit ${form.param_key}` : 'New parameter'}
          subtitle={form.category === 'deposit_rates' || form.id === undefined
            ? `A deposit_rates value can never be saved above the ${data?.nidhi_cap ?? 12.5}% Nidhi Rules cap.`
            : undefined}
          onClose={() => setForm(null)}
          footer={<>
            <button onClick={() => setForm(null)}
              className="px-4 py-2 rounded-md border border-slate-200 text-xs font-semibold text-slate-700">Cancel</button>
            <button data-testid="param-save-btn" disabled={saving} onClick={save}
              className="px-5 py-2 rounded-md bg-[#0b3b8c] text-white text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50">
              {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save
            </button>
          </>}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Key" value={form.param_key} disabled={!!form.id} testId="param-key"
              onChange={v => setForm(f => ({ ...f, param_key: v }))} />
            <Field label="Label" value={form.label} testId="param-label"
              onChange={v => setForm(f => ({ ...f, label: v }))} />
            <Select label="Category" value={form.category} disabled={!!form.id}
              options={Object.entries(CATEGORY_LABEL)} testId="param-category"
              onChange={v => setForm(f => ({ ...f, category: v }))} />
            <Field label="Value" type="number" value={form.value} testId="param-value"
              onChange={v => setForm(f => ({ ...f, value: v }))} />
            <Field label="Unit (e.g. % p.a., ₹)" value={form.unit} testId="param-unit"
              onChange={v => setForm(f => ({ ...f, unit: v }))} />
            <Field label="Min" type="number" value={form.min_value ?? ''} testId="param-min"
              onChange={v => setForm(f => ({ ...f, min_value: v }))} />
            <Field label="Max" type="number" value={form.max_value ?? ''} testId="param-max"
              onChange={v => setForm(f => ({ ...f, max_value: v }))} />
            <div className="md:col-span-2">
              <Field label="Description" value={form.description ?? ''}
                onChange={v => setForm(f => ({ ...f, description: v }))} />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
