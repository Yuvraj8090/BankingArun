import React, { useEffect, useState } from 'react';
import { Users, RefreshCw, Plus, Save, Trash2, ReceiptText, X, Info } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { toast } from 'sonner';

const BLANK_AGENT = { code: '', name: '', phone: '', branch: '', status: 'active' };
const today = () => new Date().toISOString().slice(0, 10);

// Field agents and what they collected. No commission is calculated or paid.
export default function AgentsPage() {
  const { user } = useAuth();
  const canEdit = ['bank_owner', 'admin', 'branch_manager'].includes(user?.role);
  const [agents, setAgents] = useState(null);
  const [schemes, setSchemes] = useState([]);
  const [form, setForm] = useState(null);
  const [selected, setSelected] = useState(null);
  const [collections, setCollections] = useState(null);
  const [entry, setEntry] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const [a, s] = await Promise.all([api.agentsList(), api.schemesList().catch(() => ({ schemes: [] }))]);
      setAgents(a.agents);
      setSchemes(s.schemes || []);
    } catch (e) { toast.error(e.response?.data?.detail || 'Could not load agents'); }
  };
  useEffect(() => { load(); }, []);

  const openAgent = async (agent) => {
    setSelected(agent);
    setCollections(null);
    try { setCollections(await api.agentCollections(agent.id)); }
    catch (e) { toast.error(e.response?.data?.detail || 'Could not load collections'); }
  };

  const saveAgent = async () => {
    setSaving(true);
    try {
      const r = form.id ? await api.agentUpdate(form.id, form) : await api.agentCreate(form);
      toast.success(r.message);
      setForm(null);
      load();
    } catch (e) { toast.error(e.response?.data?.detail || 'Save failed'); }
    finally { setSaving(false); }
  };

  const removeAgent = async (agent) => {
    if (!window.confirm(`Remove agent ${agent.code}?`)) return;
    try { toast.success((await api.agentDelete(agent.id)).message); setSelected(null); load(); }
    catch (e) { toast.error(e.response?.data?.detail || 'Delete failed'); }
  };

  const saveCollection = async () => {
    setSaving(true);
    try {
      const r = await api.collectionCreate({ ...entry, agent_id: selected.id, amount: Number(entry.amount) });
      toast.success(r.message);
      setEntry(null);
      openAgent(selected);
      load();
    } catch (e) { toast.error(e.response?.data?.detail || 'Could not record collection'); }
    finally { setSaving(false); }
  };

  if (!agents) return <div className="p-10 flex items-center gap-2 text-slate-600"><RefreshCw className="w-4 h-4 animate-spin" /> Loading agents…</div>;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-md bg-slate-900 text-amber-400 flex items-center justify-center"><Users className="w-5 h-5" /></div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Agents &amp; Collections</h1>
            <p className="text-xs text-slate-500">Field agents and the deposits they collected</p>
          </div>
        </div>
        {canEdit && (
          <button data-testid="agent-new-btn" onClick={() => setForm({ ...BLANK_AGENT })}
            className="px-4 py-2 rounded-md bg-[#0b3b8c] text-white text-xs font-semibold flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" /> New agent
          </button>
        )}
      </div>

      <div className="flex items-start gap-2 p-3 rounded-md bg-slate-50 border border-slate-200 text-[11px] text-slate-700">
        <Info className="w-4 h-4 shrink-0 mt-0.5 text-[#0b3b8c]" />
        <p>
          Collections are a record for traceability. They do not credit a member's account — that stays a separate
          teller action. No commission is calculated here: the Nidhi Rules bar paying brokerage or incentives for
          mobilising deposits.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 text-sm font-semibold text-slate-900">Agents ({agents.length})</div>
          <div className="divide-y divide-slate-100 max-h-[460px] overflow-y-auto">
            {agents.map(a => (
              <button key={a.id} data-testid={`agent-row-${a.code}`} onClick={() => openAgent(a)}
                className={`w-full text-left p-4 hover:bg-slate-50 transition ${selected?.id === a.id ? 'bg-blue-50/60' : ''}`}>
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-900 text-xs">{a.name}</span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                    a.status === 'active' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                    {a.status}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 mt-1 font-mono">{a.code} · {a.phone}</div>
                <div className="text-[11px] text-slate-600 mt-1">
                  {a.collection_count} collections · ₹{Number(a.collected_total).toLocaleString('en-IN')}
                </div>
              </button>
            ))}
            {!agents.length && <p className="p-6 text-center text-xs text-slate-500">No agents yet.</p>}
          </div>
        </div>

        <div className="lg:col-span-3 space-y-4">
          {form && (
            <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
              <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900">{form.id ? `Edit ${form.code}` : 'New agent'}</h2>
                <button onClick={() => setForm(null)} className="text-slate-400 hover:text-slate-700"><X className="w-4 h-4" /></button>
              </div>
              <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="Agent code" value={form.code} onChange={v => setForm(f => ({ ...f, code: v }))} testId="agent-code" />
                <Field label="Name" value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} testId="agent-name" />
                <Field label="Phone" value={form.phone} onChange={v => setForm(f => ({ ...f, phone: v }))} testId="agent-phone" />
                <Field label="Branch" value={form.branch ?? ''} onChange={v => setForm(f => ({ ...f, branch: v }))} />
                <div>
                  <label className="block text-[11px] text-slate-600 mb-1">Status</label>
                  <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                    className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm bg-white">
                    <option value="active">active</option>
                    <option value="inactive">inactive</option>
                  </select>
                </div>
              </div>
              <div className="px-4 pb-4 flex justify-end">
                <button data-testid="agent-save-btn" disabled={saving} onClick={saveAgent}
                  className="px-5 py-2 rounded-md bg-[#0b3b8c] text-white text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50">
                  {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save agent
                </button>
              </div>
            </div>
          )}

          {selected && (
            <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
              <div className="p-4 border-b border-slate-100 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">{selected.name}</h2>
                  <p className="text-[11px] text-slate-500 font-mono">{selected.code} · {selected.branch || 'No branch set'}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button data-testid="collection-new-btn" onClick={() => setEntry({ account_number: '', amount: '', collected_on: today(), scheme_id: '', receipt_no: '', notes: '' })}
                    className="px-3 py-1.5 rounded-md bg-[#0b3b8c] text-white text-xs font-semibold flex items-center gap-1.5">
                    <ReceiptText className="w-3.5 h-3.5" /> Record collection
                  </button>
                  {canEdit && <>
                    <button onClick={() => setForm({ ...selected })} className="px-3 py-1.5 rounded-md border border-slate-200 text-xs font-semibold text-slate-700">Edit</button>
                    <button onClick={() => removeAgent(selected)} className="px-2 py-1.5 rounded-md border border-rose-200 text-[#c8102e]"><Trash2 className="w-3.5 h-3.5" /></button>
                  </>}
                </div>
              </div>

              {entry && (
                <div className="p-4 border-b border-slate-100 bg-slate-50 grid grid-cols-1 md:grid-cols-3 gap-3">
                  <Field label="Member account number" value={entry.account_number} onChange={v => setEntry(e => ({ ...e, account_number: v }))} testId="collection-account" />
                  <Field label="Amount (₹)" type="number" value={entry.amount} onChange={v => setEntry(e => ({ ...e, amount: v }))} testId="collection-amount" />
                  <Field label="Collected on" type="date" value={entry.collected_on} onChange={v => setEntry(e => ({ ...e, collected_on: v }))} testId="collection-date" />
                  <div>
                    <label className="block text-[11px] text-slate-600 mb-1">Scheme (optional)</label>
                    <select value={entry.scheme_id} onChange={e => setEntry(en => ({ ...en, scheme_id: e.target.value }))}
                      className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm bg-white">
                      <option value="">—</option>
                      {schemes.map(s => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
                    </select>
                  </div>
                  <Field label="Receipt no (optional)" value={entry.receipt_no} onChange={v => setEntry(e => ({ ...e, receipt_no: v }))} />
                  <div className="flex items-end gap-2">
                    <button data-testid="collection-save-btn" disabled={saving} onClick={saveCollection}
                      className="flex-1 px-4 py-2 rounded-md bg-[#0b3b8c] text-white text-xs font-semibold disabled:opacity-50">Save record</button>
                    <button onClick={() => setEntry(null)} className="px-3 py-2 rounded-md border border-slate-200 text-xs">Cancel</button>
                  </div>
                </div>
              )}

              <div className="overflow-x-auto">
                {!collections ? (
                  <p className="p-6 text-center text-xs text-slate-500">Loading collections…</p>
                ) : (
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-[11px] uppercase text-slate-600">
                      <tr>
                        <th className="p-3 font-semibold">Date</th>
                        <th className="p-3 font-semibold">Account</th>
                        <th className="p-3 font-semibold">Scheme</th>
                        <th className="p-3 font-semibold">Receipt</th>
                        <th className="p-3 font-semibold text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {collections.collections.map(c => (
                        <tr key={c.id}>
                          <td className="p-3 text-slate-600">{c.collected_on}</td>
                          <td className="p-3 font-mono text-slate-700">{c.account_number}</td>
                          <td className="p-3 text-slate-600">{c.scheme_code || '—'}</td>
                          <td className="p-3 font-mono text-slate-500">{c.receipt_no}</td>
                          <td className="p-3 text-right font-semibold text-slate-900">₹{Number(c.amount).toLocaleString('en-IN')}</td>
                        </tr>
                      ))}
                      {!collections.collections.length && (
                        <tr><td colSpan={5} className="p-6 text-center text-slate-500">No collections recorded yet.</td></tr>
                      )}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {!selected && !form && (
            <div className="bg-white border border-slate-200 rounded-lg p-10 text-center text-xs text-slate-500">
              Select an agent to see their collections.
            </div>
          )}
        </div>
      </div>
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
