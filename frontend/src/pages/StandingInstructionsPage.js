import React, { useCallback, useEffect, useState } from 'react';
import { Repeat, Home, TrendingUp, FileText, Shield, Plus, Play, Pause, Trash2, RefreshCw, Calendar, Save, X } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { toast } from 'sonner';

const CATEGORY = {
  rent: { i: Home, label: 'Rent', color: 'text-[#c8102e]' },
  sip: { i: TrendingUp, label: 'SIP / Investment', color: 'text-emerald-700' },
  emi: { i: FileText, label: 'Loan EMI', color: 'text-[#0b3b8c]' },
  insurance: { i: Shield, label: 'Insurance', color: 'text-slate-800' },
  generic: { i: Repeat, label: 'Generic', color: 'text-slate-600' }
};

const FREQ = ['daily', 'weekly', 'monthly', 'quarterly'];

export default function StandingInstructionsPage() {
  const { features } = useAuth();
  const outside = Array.isArray(features) && features.includes('payment_systems');
  const [items, setItems] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({
    from_account_number: '', beneficiary_name: '', beneficiary_account: '', beneficiary_ifsc: 'AJSP0000042',
    amount: 25000, frequency: 'monthly', category: 'rent',
    start_date: new Date().toISOString().slice(0, 10), end_date: '', remarks: ''
  });

  const load = useCallback(async () => {
    try {
      const [a, l] = await Promise.all([api.getAccounts(), api.siList()]);
      setAccounts(a.accounts || []);
      setItems(l.items || []);
      if (a.accounts?.length) {
        setForm(f => f.from_account_number ? f : ({ ...f, from_account_number: a.accounts[0].account_number }));
      }
    } catch { toast.error('Failed to load standing instructions'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    try {
      if (editId) {
        await api.siUpdate(editId, { amount: parseFloat(form.amount), end_date: form.end_date || null, remarks: form.remarks });
        toast.success('Updated');
      } else {
        await api.siCreate({ ...form, amount: parseFloat(form.amount) });
        toast.success('Standing instruction created');
      }
      setShowModal(false); setEditId(null); load();
    } catch (e) { toast.error(e.response?.data?.detail || 'Save failed'); }
  };

  const doAction = async (id, action) => {
    try {
      if (action === 'pause') await api.siPause(id);
      else if (action === 'resume') await api.siResume(id);
      else if (action === 'delete') { if (!window.confirm('Delete this instruction?')) return; await api.siDelete(id); }
      toast.success(`${action} done`); load();
    } catch { toast.error('Action failed'); }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-md bg-[#0b3b8c] flex items-center justify-center"><Repeat className="w-5 h-5 text-slate-900" /></div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Standing Instructions</h1>
            <p className="text-xs text-slate-500">Automate rent, loan EMIs and regular payments to members — pause, resume or edit anytime</p>
          </div>
        </div>
        <button data-testid="new-si-btn" onClick={() => { setEditId(null); setShowModal(true); }}
          className="px-4 py-2 rounded-md bg-[#0b3b8c] hover:bg-[#092e6f] text-white text-xs font-semibold flex items-center gap-2">
          <Plus className="w-4 h-4" /> New Instruction
        </button>
      </div>

      {/* Category summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Object.entries(CATEGORY).slice(0, 4).map(([k, v]) => {
          const list = items.filter(i => i.category === k);
          const total = list.reduce((s, i) => s + (i.status === 'active' ? i.amount : 0), 0);
          return (
            <div key={k} className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="flex items-center gap-2">
                <v.i className={`w-4 h-4 ${v.color}`} />
                <span className="text-[11px] font-semibold text-slate-700">{v.label}</span>
              </div>
              <p className="text-xl font-bold text-slate-900 mt-2">₹{total.toLocaleString('en-IN')}</p>
              <p className="text-[10px] text-slate-500 mt-1">{list.length} active</p>
            </div>
          );
        })}
      </div>

      {/* List */}
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
        <div className="p-5 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-900">All Instructions</h2>
        </div>
        {items.length === 0 ? (
          <div className="p-10 text-center text-xs text-slate-500 space-y-2">
            <Repeat className="w-8 h-8 mx-auto text-slate-600" />
            <p>No standing instructions yet. Click <b>New Instruction</b> to automate a recurring payment.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {items.map(si => {
              const cat = CATEGORY[si.category] || CATEGORY.generic;
              return (
                <div key={si.id} data-testid={`si-item-${si.id}`}
                  className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:bg-slate-50">
                  <div className="flex items-start gap-3">
                    <div className={`w-9 h-9 rounded-md bg-slate-50 border border-slate-200 flex items-center justify-center ${cat.color}`}>
                      <cat.i className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-slate-900">{si.beneficiary_name}</div>
                      <div className="text-[11px] text-slate-500 font-mono">A/C {si.beneficiary_account} · {si.beneficiary_ifsc}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {cat.label} · {si.frequency} · Next {si.next_run}
                        {si.end_date && ` · Until ${si.end_date}`}
                        {si.executions > 0 && ` · Paid ${si.executions}×`}
                      </div>
                      {/* Why the last run didn't go through, so a paused instruction isn't a mystery */}
                      {si.last_status === 'failed' && si.last_error && (
                        <div data-testid={`si-error-${si.id}`} className="text-[11px] text-[#c8102e] mt-1">
                          Last attempt on {si.last_run} failed: {si.last_error}
                          {si.status === 'paused' && ' Paused after repeated failures — resume it once the account is funded.'}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className="text-lg font-bold text-slate-900">₹{si.amount.toLocaleString('en-IN')}</div>
                      <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded border ${
                        si.status === 'active' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : si.status === 'paused' ? 'bg-amber-50 text-amber-700 border-amber-200'
                        : 'bg-slate-100 text-slate-700 border-slate-200'
                      }`}>{si.status}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      {si.status === 'active' ? (
                        <IconBtn testId={`si-pause-${si.id}`} icon={Pause} title="Pause" onClick={() => doAction(si.id, 'pause')} />
                      ) : (
                        <IconBtn testId={`si-resume-${si.id}`} icon={Play} title="Resume" color="text-emerald-700" onClick={() => doAction(si.id, 'resume')} />
                      )}
                      <IconBtn testId={`si-edit-${si.id}`} icon={Save} title="Edit"
                        onClick={() => { setEditId(si.id); setForm({ ...form, ...si }); setShowModal(true); }} />
                      <IconBtn testId={`si-delete-${si.id}`} icon={Trash2} title="Delete" color="text-[#c8102e]"
                        onClick={() => doAction(si.id, 'delete')} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-lg max-w-lg w-full p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">{editId ? 'Edit Instruction' : 'New Standing Instruction'}</h3>
              <button onClick={() => setShowModal(false)} className="p-1 text-slate-500 hover:text-slate-700"><X className="w-4 h-4" /></button>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <Select label="From account" value={form.from_account_number} disabled={!!editId}
                onChange={v => setForm(f => ({ ...f, from_account_number: v }))}
                options={accounts.map(a => ({ v: a.account_number, l: `${a.account_number} — ${a.account_name}` }))} testId="si-from-acc" />
              <Select label="Category" value={form.category} disabled={!!editId}
                onChange={v => setForm(f => ({ ...f, category: v }))}
                options={Object.entries(CATEGORY).map(([k, v]) => ({ v: k, l: v.label }))} testId="si-category" />
              <Input label="Beneficiary name" value={form.beneficiary_name} disabled={!!editId}
                onChange={v => setForm(f => ({ ...f, beneficiary_name: v }))} testId="si-bene-name" />
              <Input label="Beneficiary account" value={form.beneficiary_account} disabled={!!editId}
                onChange={v => setForm(f => ({ ...f, beneficiary_account: v }))} testId="si-bene-acc" />
              {/* Only another member's account can be paid unless a payment partner is enabled. */}
              {outside && (
                <Input label="IFSC" value={form.beneficiary_ifsc} disabled={!!editId}
                  onChange={v => setForm(f => ({ ...f, beneficiary_ifsc: v }))} testId="si-ifsc" />
              )}
              <Input type="number" label="Amount (₹)" value={form.amount}
                onChange={v => setForm(f => ({ ...f, amount: v }))} testId="si-amount" />
              <Select label="Frequency" value={form.frequency} disabled={!!editId}
                onChange={v => setForm(f => ({ ...f, frequency: v }))}
                options={FREQ.map(f => ({ v: f, l: f }))} testId="si-frequency" />
              <Input type="date" label="Start date" value={form.start_date} disabled={!!editId}
                onChange={v => setForm(f => ({ ...f, start_date: v }))} testId="si-start" />
              <Input type="date" label="End date (optional)" value={form.end_date || ''}
                onChange={v => setForm(f => ({ ...f, end_date: v }))} testId="si-end" />
              <div className="col-span-2">
                <Input label="Remarks" value={form.remarks || ''}
                  onChange={v => setForm(f => ({ ...f, remarks: v }))} testId="si-remarks" />
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={() => setShowModal(false)}
                className="flex-1 py-2 rounded-md border border-slate-200 text-slate-700 text-xs font-semibold">Cancel</button>
              <button data-testid="si-save-btn" onClick={save}
                className="flex-1 py-2 rounded-md bg-[#0b3b8c] hover:bg-[#092e6f] text-white text-xs font-semibold">
                {editId ? 'Save changes' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function IconBtn({ icon: Icon, title, onClick, color = 'text-slate-700', testId }) {
  return (
    <button data-testid={testId} title={title} onClick={onClick}
      className={`w-8 h-8 rounded-md border border-slate-200 hover:bg-slate-100 flex items-center justify-center ${color}`}>
      <Icon className="w-3.5 h-3.5" />
    </button>
  );
}

function Input({ label, value, onChange, type = 'text', disabled, testId }) {
  return (
    <div>
      <label className="block text-[11px] text-slate-600 mb-1">{label}</label>
      <input value={value} type={type} disabled={disabled} data-testid={testId}
        onChange={e => onChange(e.target.value)}
        className="w-full border border-slate-200 rounded-md px-3 py-2 text-slate-900 disabled:bg-slate-50 disabled:text-slate-500" />
    </div>
  );
}

function Select({ label, value, options, onChange, disabled, testId }) {
  return (
    <div>
      <label className="block text-[11px] text-slate-600 mb-1">{label}</label>
      <select value={value} disabled={disabled} data-testid={testId}
        onChange={e => onChange(e.target.value)}
        className="w-full border border-slate-200 rounded-md px-3 py-2 text-slate-900 disabled:bg-slate-50 capitalize">
        {options.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    </div>
  );
}
