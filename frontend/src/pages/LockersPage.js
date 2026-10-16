import React, { useCallback, useEffect, useState } from 'react';
import { KeyRound, Plus, RefreshCw } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { toast } from 'sonner';
import Modal, { Field, inputClass } from '../components/Modal';
import DepositSlip from '../components/DepositSlip';

// The branch's safe-deposit lockers: who holds each one and whether the rent is paid.
// Rent is a year at a time from the member's savings, with a printed receipt
// (modules/staff.php, Lockers). Managers and the Director add lockers.
const ADMIN = ['admin', 'branch_manager', 'bank_owner'];
const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const err = (e, m) => toast.error(e.response?.data?.detail || m);

export default function LockersPage() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [adding, setAdding] = useState(null);
  const [allotting, setAllotting] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const load = useCallback(() => api.lockersList().then(setData).catch((e) => err(e, 'Could not load lockers')), []);
  useEffect(() => { load(); }, [load]);

  const act = async (call, after) => {
    try { const r = await call(); toast.success(r.message); if (r.receipt) setReceipt(r.receipt); after?.(); load(); }
    catch (e) { err(e, 'That did not work'); }
  };
  if (!data) return <div className="p-10 text-xs text-slate-500 flex items-center gap-2"><RefreshCw className="w-4 h-4 animate-spin" /> Loading…</div>;
  const free = data.lockers.filter((l) => l.status === 'available').length;
  const overdue = data.lockers.filter((l) => l.overdue).length;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto space-y-4">
      <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2"><KeyRound className="w-5 h-5 text-[#0b3b8c]" /> Lockers</h1>
          <p className="text-xs text-slate-500 mt-1">{data.lockers.length} locker{data.lockers.length === 1 ? '' : 's'} · {free} free · {overdue} with rent overdue. For members only; rent is a year at a time from savings.</p>
        </div>
        {ADMIN.includes(user?.role) && (
          <button data-testid="locker-add-btn" onClick={() => setAdding({ branch_id: data.branches[0]?.id || '', locker_no: '', size: 'small', annual_rent: '' })}
            className="px-4 py-2 rounded-md bg-[#0b3b8c] text-white text-xs font-semibold flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Add a locker</button>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-x-auto">
        <table className="w-full text-left text-xs" data-testid="lockers-table">
          <thead className="bg-slate-50 text-[11px] uppercase text-slate-600"><tr>
            <th className="p-3">Locker</th><th className="p-3">Branch</th><th className="p-3">Size</th><th className="p-3">Rent a year</th>
            <th className="p-3">Held by</th><th className="p-3">Paid until</th><th className="p-3 text-right">Action</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {data.lockers.map((l) => (
              <tr key={l.id}>
                <td className="p-3 font-mono font-semibold">{l.locker_no}</td>
                <td className="p-3">{l.branch_name}</td>
                <td className="p-3 capitalize">{l.size}</td>
                <td className="p-3">{inr(l.annual_rent)}</td>
                <td className="p-3">{l.holder_name ? <>{l.holder_name}<span className="block text-[10px] text-slate-500 font-mono">{l.account_number}</span></> : <span className="text-emerald-700">Free</span>}</td>
                <td className={`p-3 ${l.overdue ? 'text-rose-700 font-semibold' : ''}`}>{l.rent_paid_until || '—'}{l.overdue ? ' · overdue' : ''}</td>
                <td className="p-3 text-right space-x-2 whitespace-nowrap">
                  {l.status === 'available' && <button className="text-[#0b3b8c] font-semibold" onClick={() => setAllotting({ locker_id: l.id, no: l.locker_no, rent: l.annual_rent, account_number: '', nominee_name: '' })}>Allot</button>}
                  {l.status === 'allotted' && <>
                    <button className="text-[#0b3b8c] font-semibold" onClick={() => window.confirm(`Take ${inr(l.annual_rent)} from ${l.holder_name}'s savings for another year?`) && act(() => api.lockerRent(l.id))}>Collect a year's rent</button>
                    <button className="text-slate-600" onClick={() => window.confirm(`Has ${l.holder_name} emptied locker ${l.locker_no} and handed the key back?`) && act(() => api.lockerSurrender(l.id))}>Surrender</button>
                  </>}
                </td>
              </tr>
            ))}
            {!data.lockers.length && <tr><td colSpan={7} className="p-6 text-center text-slate-500">No lockers yet.{ADMIN.includes(user?.role) ? ' Click "Add a locker".' : ' A manager adds them.'}</td></tr>}
          </tbody>
        </table>
      </div>

      {adding && (
        <Modal title="Add a locker" onClose={() => setAdding(null)}
          footer={<button onClick={() => act(() => api.lockerCreate({ ...adding, annual_rent: Number(adding.annual_rent) }), () => setAdding(null))}
            className="px-5 py-2 rounded-md bg-[#0b3b8c] text-white text-xs font-semibold">Add</button>}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Branch"><select className={inputClass} value={adding.branch_id} onChange={(e) => setAdding({ ...adding, branch_id: e.target.value })}>
              {data.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
            <Field label="Locker number" hint="As painted on the locker, e.g. A-12"><input className={inputClass} value={adding.locker_no} onChange={(e) => setAdding({ ...adding, locker_no: e.target.value })} /></Field>
            <Field label="Size"><select className={inputClass} value={adding.size} onChange={(e) => setAdding({ ...adding, size: e.target.value })}>
              {data.sizes.map((s) => <option key={s} value={s}>{s}</option>)}</select></Field>
            <Field label="Rent a year (₹)"><input type="number" className={inputClass} value={adding.annual_rent} onChange={(e) => setAdding({ ...adding, annual_rent: e.target.value })} /></Field>
          </div>
        </Modal>
      )}

      {allotting && (
        <Modal title={`Allot locker ${allotting.no}`} subtitle={`A year's rent of ${inr(allotting.rent)} is taken from the member's savings now.`} onClose={() => setAllotting(null)}
          footer={<button onClick={() => act(() => api.lockerAllot(allotting), () => setAllotting(null))} disabled={!allotting.account_number || !allotting.nominee_name}
            className="px-5 py-2 rounded-md bg-[#0b3b8c] text-white text-xs font-semibold disabled:opacity-50">Allot and take rent</button>}>
          <div className="space-y-3">
            <Field label="Member's savings account number"><input className={inputClass} value={allotting.account_number} onChange={(e) => setAllotting({ ...allotting, account_number: e.target.value })} /></Field>
            <Field label="Nominee" hint="Who may open it if the member dies"><input className={inputClass} value={allotting.nominee_name} onChange={(e) => setAllotting({ ...allotting, nominee_name: e.target.value })} /></Field>
          </div>
        </Modal>
      )}

      <DepositSlip slip={receipt} onClose={() => setReceipt(null)} />
    </div>
  );
}
