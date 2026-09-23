import React, { useEffect, useState } from 'react';
import { MapPin, RefreshCw, Plus, Save, Trash2, Pencil, Info, Search } from 'lucide-react';
import { api } from '../services/api';
import Modal from '../components/Modal';
import { useAuth } from '../context/AuthContext';
import { toast } from 'sonner';

const BLANK = {
  name: '', code: '', bank: 'AJSPay', address: '', lat: '', lng: '',
  phone: '', timing: '9:30 AM - 4:30 PM', has_atm: 1, has_cdm: 1, has_locker: 0
};

const Field = ({ label, hint, children }) => (
  <label className="block">
    <span className="block text-slate-500 mb-1">{label}</span>
    {children}
    {hint && <span className="block text-[10px] text-slate-500 mt-1">{hint}</span>}
  </label>
);

const input = 'w-full border border-slate-200 rounded-md px-3 py-2 text-xs outline-none focus:border-[#0b3b8c]';

// The branch and ATM network behind the public locator. Editing a row here changes
// what visitors see at /branches, so it is the director's to change.
export default function BranchAdminPage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'bank_owner';
  const [branches, setBranches] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');

  const load = async () => {
    try { setBranches((await api.branchesList()).branches); }
    catch (e) { toast.error(e.response?.data?.detail || 'Could not load branches'); }
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    try {
      const r = form.id ? await api.branchUpdate(form.id, form) : await api.branchCreate(form);
      toast.success(r.message);
      setForm(null);
      load();
    } catch (e) { toast.error(e.response?.data?.detail || 'Save failed'); }
    finally { setSaving(false); }
  };

  const remove = async (branch) => {
    if (!window.confirm(`Remove ${branch.name} (${branch.code})? It will disappear from the public locator.`)) return;
    try { toast.success((await api.branchDelete(branch.id)).message); load(); }
    catch (e) { toast.error(e.response?.data?.detail || 'Delete failed'); }
  };

  if (!branches) {
    return <div className="p-10 flex items-center gap-2 text-slate-600"><RefreshCw className="w-4 h-4 animate-spin" /> Loading branches…</div>;
  }

  const q = query.trim().toLowerCase();
  const shown = q
    ? branches.filter((b) => [b.name, b.code, b.address].some((v) => (v || '').toLowerCase().includes(q)))
    : branches;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-md bg-[#0b3b8c] text-white flex items-center justify-center"><MapPin className="w-5 h-5" /></div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Branch &amp; ATM Network</h1>
            <p className="text-xs text-slate-500">{branches.length} location{branches.length === 1 ? '' : 's'} on the public locator</p>
          </div>
        </div>
        {canEdit && (
          <button data-testid="branch-new-btn" onClick={() => setForm({ ...BLANK })}
            className="px-4 py-2 rounded-md bg-[#0b3b8c] text-white text-xs font-semibold flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" /> New branch
          </button>
        )}
      </div>

      <div className="flex items-start gap-2 p-3 rounded-md bg-slate-50 border border-slate-200 text-[11px] text-slate-700">
        <Info className="w-4 h-4 shrink-0 mt-0.5 text-[#0b3b8c]" />
        <p>
          These rows are what the public Branch &amp; ATM locator shows. A branch with no latitude and longitude is
          still listed, but cannot be placed on the map. A branch that members or staff are attached to cannot be
          deleted until they are moved.
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
        <div className="p-3 border-b border-slate-100 flex items-center gap-2">
          <div className="flex items-center gap-2 border border-slate-200 rounded-md px-3 h-9 bg-slate-50 flex-1 max-w-sm">
            <Search className="w-4 h-4 text-slate-500" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} data-testid="branch-search"
              placeholder="Filter by name, code or address" className="flex-1 bg-transparent text-xs outline-none py-1.5" />
          </div>
          <button onClick={load} className="px-3 py-2 rounded-md border border-slate-200 text-xs text-slate-700 flex items-center gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="text-left font-semibold px-4 py-2.5">Branch</th>
                <th className="text-left font-semibold px-4 py-2.5">Address</th>
                <th className="text-left font-semibold px-4 py-2.5 whitespace-nowrap">Services</th>
                <th className="text-left font-semibold px-4 py-2.5 whitespace-nowrap">Map pin</th>
                {canEdit && <th className="px-4 py-2.5" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((b) => (
                <tr key={b.id} data-testid={`branch-row-${b.code}`} className="hover:bg-blue-50/40 transition-colors">
                  <td className="px-4 py-3 align-top">
                    <div className="font-semibold text-slate-900">{b.name}</div>
                    <div className="text-[11px] text-slate-500 font-mono">{b.code}</div>
                    {b.phone && <div className="text-[11px] text-slate-500">{b.phone}</div>}
                  </td>
                  <td className="px-4 py-3 align-top text-slate-600 max-w-xs">
                    {b.address || <span className="text-slate-500">—</span>}
                    {b.timing && <div className="text-[11px] text-slate-500 mt-1">{b.timing}</div>}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div className="flex flex-wrap gap-1">
                      {[['ATM', b.has_atm], ['CDM', b.has_cdm], ['Locker', b.has_locker]]
                        .filter(([, on]) => Number(on) === 1)
                        .map(([tag]) => (
                          <span key={tag} className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-semibold">{tag}</span>
                        ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 align-top font-mono text-[11px] text-slate-600">
                    {b.lat && b.lng ? `${b.lat}, ${b.lng}` : <span className="text-amber-700">not mapped</span>}
                  </td>
                  {canEdit && (
                    <td className="px-4 py-3 align-top whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <button data-testid={`branch-edit-${b.code}`} onClick={() => setForm({ ...BLANK, ...b })}
                          className="p-1.5 rounded-md border border-slate-200 text-slate-600 hover:border-[#0b3b8c] hover:text-[#0b3b8c]" title="Edit">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button data-testid={`branch-delete-${b.code}`} onClick={() => remove(b)}
                          className="p-1.5 rounded-md border border-slate-200 text-slate-600 hover:border-[#c8102e] hover:text-[#c8102e]" title="Remove">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {!shown.length && (
                <tr><td colSpan={canEdit ? 5 : 4} className="p-6 text-center text-xs text-slate-500">
                  {branches.length ? 'No branch matches that filter.' : 'No branches yet.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {form && (
        <Modal
          testId="branch-modal"
          title={form.id ? `Edit ${form.code}` : 'New branch'}
          subtitle="Saved changes appear on the public Branch & ATM locator straight away."
          onClose={() => setForm(null)}
          footer={<>
            <button onClick={() => setForm(null)}
              className="px-4 py-2 rounded-md border border-slate-200 text-xs font-semibold text-slate-700">Cancel</button>
            <button data-testid="branch-save-btn" disabled={saving} onClick={save}
              className="px-5 py-2 rounded-md bg-[#0b3b8c] text-white text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50">
              {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save branch
            </button>
          </>}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <Field label="Branch name">
              <input className={input} value={form.name} data-testid="branch-name"
                onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Branch code" hint="4 to 11 letters or digits, e.g. AJSP0001234">
              <input className={`${input} font-mono uppercase`} value={form.code} data-testid="branch-code"
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />
            </Field>
            <label className="block sm:col-span-2">
              <span className="block text-slate-500 mb-1">Address</span>
              <textarea rows={2} className={input} value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </label>
            <Field label="Phone">
              <input className={input} value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
            <Field label="Opening hours">
              <input className={input} value={form.timing}
                onChange={(e) => setForm({ ...form, timing: e.target.value })} />
            </Field>
            <Field label="Latitude" hint="Leave blank if the branch is not mapped">
              <input className={input} value={form.lat ?? ''} inputMode="decimal"
                onChange={(e) => setForm({ ...form, lat: e.target.value })} />
            </Field>
            <Field label="Longitude">
              <input className={input} value={form.lng ?? ''} inputMode="decimal"
                onChange={(e) => setForm({ ...form, lng: e.target.value })} />
            </Field>
            <div className="sm:col-span-2 flex flex-wrap gap-4 pt-1">
              {[['has_atm', 'ATM on site'], ['has_cdm', 'Cash deposit machine'], ['has_locker', 'Lockers']].map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-slate-700">
                  <input type="checkbox" checked={Number(form[key]) === 1} data-testid={`branch-${key}`}
                    onChange={(e) => setForm({ ...form, [key]: e.target.checked ? 1 : 0 })} />
                  {label}
                </label>
              ))}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
