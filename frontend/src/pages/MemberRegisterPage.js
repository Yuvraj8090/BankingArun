import React, { useCallback, useEffect, useState } from 'react';
import { BookUser, RefreshCw, UserPlus, Search, Layers3, ShieldAlert } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { toast } from 'sonner';
import Pagination from '../components/Pagination';
import Modal, { Field, inputClass } from '../components/Modal';

const WRITE_ROLES = ['admin', 'branch_manager', 'bank_owner'];

const RISK = {
  high: 'bg-rose-50 text-[#c8102e] border-rose-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  low: 'bg-emerald-50 text-emerald-700 border-emerald-200'
};
const STATUS = {
  active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  ceased: 'bg-slate-100 text-slate-600 border-slate-200',
  suspended: 'bg-amber-50 text-amber-700 border-amber-200'
};

const MOVEMENTS = [
  ['allotment', 'Allotment — new shares issued'],
  ['transfer_in', 'Transfer in — received from another member'],
  ['transfer_out', 'Transfer out — passed to another member'],
  ['surrender', 'Surrender — returned to the company']
];

const date = (v) => (v ? new Date(v).toLocaleDateString('en-IN') : '—');

// The statutory register of members. Rule 11 of the Nidhi Rules, 2014 requires
// at least ten equity shares of ten rupees before anyone may deposit, so this is
// the screen that has to be worked before a deposit can be taken.
export default function MemberRegisterPage() {
  const { user } = useAuth();
  const canWrite = WRITE_ROLES.includes(user?.role);

  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [risk, setRisk] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [admitting, setAdmitting] = useState(false);
  const [moving, setMoving] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await api.registerMembers({
        q: q || undefined, status: status || undefined,
        risk_category: risk || undefined, page, per_page: perPage
      }));
    } catch (e) { toast.error(e.response?.data?.detail || 'Could not load the member register'); }
  }, [q, status, risk, page, perPage]);

  useEffect(() => { const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t); }, [load, q]);

  if (!data) {
    return <div className="p-10 flex items-center gap-2 text-slate-600">
      <RefreshCw className="w-4 h-4 animate-spin" /> Loading the member register…</div>;
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-5">

      <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-md bg-[#0b3b8c] text-white flex items-center justify-center">
            <BookUser className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Member Register</h1>
            <p className="text-xs text-slate-500">
              Share register kept under Rule 11 — at least {data.minimum_shares ?? 10} shares of
              ₹{data.share_face_value ?? 10} before any deposit
            </p>
          </div>
        </div>
        {canWrite && (
          <button data-testid="register-admit-btn" onClick={() => setAdmitting(true)}
            className="px-4 py-2 rounded-md bg-[#0b3b8c] text-white text-xs font-semibold flex items-center gap-1.5">
            <UserPlus className="w-3.5 h-3.5" /> Admit a member
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi label="Active members" value={data.summary.active} />
        <Kpi label="Shares issued" value={data.summary.total_shares} />
        <Kpi label="Paid-up capital"
          value={`₹${Number(data.summary.paid_up_capital).toLocaleString('en-IN')}`} />
        <Kpi label="Never screened" value={data.summary.unscreened} tone={data.summary.unscreened ? 'warn' : 'ok'} />
        <Kpi label="Below minimum" value={data.summary.below_minimum} tone={data.summary.below_minimum ? 'bad' : 'ok'} />
      </div>

      <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
        <div className="p-4 border-b border-slate-100 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              data-testid="register-search"
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(1); }}
              placeholder="Search by name, email or folio number"
              className={`${inputClass} pl-8`}
            />
          </div>
          <select data-testid="register-status" value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1); }}
            className={`${inputClass} w-auto`}>
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="ceased">Ceased</option>
          </select>
          <select data-testid="register-risk" value={risk}
            onChange={(e) => { setRisk(e.target.value); setPage(1); }}
            className={`${inputClass} w-auto`}>
            <option value="">Any risk</option>
            <option value="high">High risk</option>
            <option value="medium">Medium risk</option>
            <option value="low">Low risk</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase text-slate-600">
              <tr>
                <th className="p-3 font-semibold">Folio</th>
                <th className="p-3 font-semibold">Member</th>
                <th className="p-3 font-semibold">KYC</th>
                <th className="p-3 font-semibold text-right">Shares</th>
                <th className="p-3 font-semibold">Admitted</th>
                <th className="p-3 font-semibold">Risk</th>
                <th className="p-3 font-semibold">Status</th>
                {canWrite && <th className="p-3 font-semibold text-right">Shares</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.members.map((m) => (
                <tr key={m.id} data-testid={`register-row-${m.folio_no}`} className="hover:bg-blue-50/40 transition-colors">
                  <td className="p-3 font-mono font-semibold text-slate-900 whitespace-nowrap">{m.folio_no}</td>
                  <td className="p-3">
                    <div className="font-semibold text-slate-900">{m.name}</div>
                    <div className="text-[11px] text-slate-500">{m.email}</div>
                  </td>
                  <td className="p-3 text-slate-600">{m.kyc_status || '—'}</td>
                  <td className="p-3 text-right tabular-nums font-semibold text-slate-900">{m.shares_held}</td>
                  <td className="p-3 text-slate-600 whitespace-nowrap">{date(m.admitted_on)}</td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${RISK[m.risk_category] || RISK.low}`}>
                      {m.risk_category || 'low'}
                    </span>
                    {m.screening_status === 'hit' && (
                      <span className="block text-[10px] text-[#c8102e] font-semibold mt-1 flex items-center gap-1">
                        <ShieldAlert className="w-3 h-3" /> screening match
                      </span>
                    )}
                  </td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${STATUS[m.status] || STATUS.ceased}`}>
                      {m.status}
                    </span>
                  </td>
                  {canWrite && (
                    <td className="p-3 text-right whitespace-nowrap">
                      <button data-testid={`register-shares-${m.folio_no}`} onClick={() => setMoving(m)}
                        className="text-[#0b3b8c] font-semibold hover:underline inline-flex items-center gap-1">
                        <Layers3 className="w-3 h-3" /> Move
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {!data.members.length && (
                <tr><td colSpan={canWrite ? 8 : 7} className="p-8 text-center text-slate-500">
                  Nobody on the register matches that.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination meta={data.pagination} onPage={setPage} onPerPage={(n) => { setPerPage(n); setPage(1); }} />
      </div>

      {admitting && <AdmitModal minShares={data.minimum_shares ?? 10} onClose={() => setAdmitting(false)}
        onDone={() => { setAdmitting(false); load(); }} />}
      {moving && <SharesModal member={moving} onClose={() => setMoving(null)}
        onDone={() => { setMoving(null); load(); }} />}
    </div>
  );
}

function Kpi({ label, value, tone }) {
  const colour = tone === 'bad' ? 'text-[#c8102e]' : tone === 'warn' ? 'text-amber-700'
    : tone === 'ok' ? 'text-emerald-700' : 'text-slate-900';
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={`text-xl font-bold tabular-nums ${colour}`}>{value}</div>
    </div>
  );
}

function AdmitModal({ minShares, onClose, onDone }) {
  const [form, setForm] = useState({ user_id: '', shares: minShares, nominee_name: '', nominee_relation: '' });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const r = await api.registerAdmit({ ...form, shares: Number(form.shares) });
      toast.success(r.message || `Admitted on folio ${r.folio_no}`);
      onDone();
    } catch (e) { toast.error(e.response?.data?.detail || 'Could not admit this person'); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      testId="admit-modal"
      title="Admit a member"
      subtitle={`Allots shares and opens a folio. At least ${minShares} shares are required before any deposit.`}
      onClose={onClose}
      footer={<>
        <button onClick={onClose} className="px-4 py-2 rounded-md border border-slate-200 text-xs font-semibold text-slate-700">Cancel</button>
        <button data-testid="admit-save" disabled={busy} onClick={save}
          className="px-4 py-2 rounded-md bg-[#0b3b8c] text-white text-xs font-semibold disabled:opacity-50">
          {busy ? 'Admitting…' : 'Admit and allot'}
        </button>
      </>}
    >
      <Field label="Person" hint="Their registered email address, or their user ID.">
        <input data-testid="admit-user" className={inputClass} value={form.user_id}
          onChange={(e) => setForm((f) => ({ ...f, user_id: e.target.value }))}
          placeholder="member@example.com" />
      </Field>
      <Field label="Shares to allot" hint={`Ten rupees each. The Nidhi Rules set ${minShares} as the minimum.`}>
        <input data-testid="admit-shares" type="number" min={minShares} className={inputClass} value={form.shares}
          onChange={(e) => setForm((f) => ({ ...f, shares: e.target.value }))} />
      </Field>
      <Field label="Nominee (optional)">
        <input className={inputClass} value={form.nominee_name}
          onChange={(e) => setForm((f) => ({ ...f, nominee_name: e.target.value }))} placeholder="Full name" />
      </Field>
      <Field label="Nominee's relation (optional)">
        <input className={inputClass} value={form.nominee_relation}
          onChange={(e) => setForm((f) => ({ ...f, nominee_relation: e.target.value }))} placeholder="Spouse, son, daughter…" />
      </Field>
    </Modal>
  );
}

function SharesModal({ member, onClose, onDone }) {
  const [form, setForm] = useState({ kind: 'allotment', shares: 10, note: '' });
  const [busy, setBusy] = useState(false);
  const delta = ['allotment', 'transfer_in'].includes(form.kind) ? 1 : -1;
  const after = Number(member.shares_held) + delta * Number(form.shares || 0);

  const save = async () => {
    setBusy(true);
    try {
      const r = await api.registerShares({ user_id: member.folio_no, ...form, shares: Number(form.shares) });
      toast.success(r.message || 'Share register updated');
      onDone();
    } catch (e) { toast.error(e.response?.data?.detail || 'Could not record that movement'); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      testId="shares-modal"
      title="Record a share movement"
      subtitle={`${member.name} · folio ${member.folio_no} · holds ${member.shares_held} shares`}
      onClose={onClose}
      footer={<>
        <button onClick={onClose} className="px-4 py-2 rounded-md border border-slate-200 text-xs font-semibold text-slate-700">Cancel</button>
        <button data-testid="shares-save" disabled={busy || after < 0} onClick={save}
          className="px-4 py-2 rounded-md bg-[#0b3b8c] text-white text-xs font-semibold disabled:opacity-50">
          {busy ? 'Recording…' : 'Record movement'}
        </button>
      </>}
    >
      <Field label="Kind of movement">
        <select data-testid="shares-kind" className={inputClass} value={form.kind}
          onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}>
          {MOVEMENTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Field>
      <Field label="Number of shares">
        <input data-testid="shares-count" type="number" min="1" className={inputClass} value={form.shares}
          onChange={(e) => setForm((f) => ({ ...f, shares: e.target.value }))} />
      </Field>
      <Field label="Note (optional)">
        <input className={inputClass} value={form.note}
          onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
          placeholder="Board resolution, transfer deed reference…" />
      </Field>
      <div className={`p-3 rounded-md text-[11px] border ${after < 0
        ? 'bg-rose-50 border-rose-200 text-[#c8102e]'
        : 'bg-slate-50 border-slate-200 text-slate-600'}`}>
        {after < 0
          ? 'That would leave a negative holding.'
          : <>Holding after this movement: <strong className="text-slate-900">{after} shares</strong>.
            {after < 10 && after >= 0 && ' Below ten shares this member may not hold a deposit.'}</>}
      </div>
    </Modal>
  );
}
