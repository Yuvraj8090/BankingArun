import React, { useCallback, useEffect, useState } from 'react';
import { Gavel, RefreshCw, Clock, AlertTriangle, Search, UserCheck } from 'lucide-react';
import { api } from '../services/api';
import { toast } from 'sonner';
import Pagination from '../components/Pagination';
import Modal, { Field, inputClass } from '../components/Modal';

const STATES = [['open', 'Open'], ['resolved', 'Resolved'], ['rejected', 'Rejected']];

const GROUND = {
  unresolved: 'The problem was never fixed',
  delay: 'It took too long',
  dissatisfied: 'Unhappy with the answer given',
  staff_conduct: 'How they were treated',
  other: 'Something else'
};

const date = (v) => (v ? new Date(v).toLocaleDateString('en-IN') : '—');
const daysLeft = (due) => Math.ceil((new Date(due) - new Date()) / 86400000);

// The grievance officer's queue. A grievance is a support ticket the member is
// not satisfied with, escalated to the named officer with a fresh thirty-day
// clock — the turnaround published to members under the Consumer Protection
// Act, 2019.
export default function GrievancePage() {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('open');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [deciding, setDeciding] = useState(null);

  const load = useCallback(async () => {
    try { setData(await api.grievanceQueue({ status, q: q || undefined, page, per_page: perPage })); }
    catch (e) { toast.error(e.response?.data?.detail || 'Could not load the grievance queue'); }
  }, [status, q, page, perPage]);
  useEffect(() => { const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t); }, [load, q]);

  if (!data) {
    return <div className="p-10 flex items-center gap-2 text-slate-600">
      <RefreshCw className="w-4 h-4 animate-spin" /> Loading the grievance queue…</div>;
  }

  const officer = data.grievance_officer;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-5">

      <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm flex items-center gap-3">
        <div className="w-10 h-10 rounded-md bg-[#0b3b8c] text-white flex items-center justify-center">
          <Gavel className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900">Grievance Queue</h1>
          <p className="text-xs text-slate-500">
            Complaints escalated past the support desk · answer within {data.response_window_days} days
          </p>
        </div>
      </div>

      {!officer.configured ? (
        <div className="p-3 rounded-md bg-rose-50 border border-rose-200 text-[11px] text-[#c8102e] flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            <strong>No grievance officer has been appointed.</strong> The public site is telling members
            their complaint goes to a named officer, and there is nobody in the post. Set the name,
            email and phone on <strong>System Config</strong>.
          </span>
        </div>
      ) : (
        <div className="p-3 rounded-md bg-slate-50 border border-slate-200 text-[11px] text-slate-600 flex items-center gap-2 flex-wrap">
          <UserCheck className="w-3.5 h-3.5 text-[#0b3b8c] shrink-0" />
          <span>Grievance officer: <strong className="text-slate-900">{officer.name}</strong></span>
          {officer.email && <span className="font-mono">{officer.email}</span>}
          {officer.phone && <span className="font-mono">{officer.phone}</span>}
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <Kpi label="Open" value={data.counts.open} tone={data.counts.open ? 'warn' : 'ok'} />
        <Kpi label="Overdue" value={data.counts.overdue} tone={data.counts.overdue ? 'bad' : 'ok'} />
        <Kpi label="Resolved" value={data.counts.resolved} />
      </div>

      <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
        <div className="p-4 border-b border-slate-100 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input data-testid="grievance-search" value={q}
              onChange={(e) => { setQ(e.target.value); setPage(1); }}
              placeholder="Search by ticket, member or subject" className={`${inputClass} pl-8`} />
          </div>
          <select data-testid="grievance-status" value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1); }} className={`${inputClass} w-auto`}>
            {STATES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase text-slate-600">
              <tr>
                <th className="p-3 font-semibold">Ticket</th>
                <th className="p-3 font-semibold">Member</th>
                <th className="p-3 font-semibold">Complaint</th>
                <th className="p-3 font-semibold">Escalated</th>
                <th className="p-3 font-semibold">Due</th>
                <th className="p-3 font-semibold text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.grievances.map((g) => {
                const left = daysLeft(g.grievance_due_by);
                const late = g.grievance_status === 'open' && left < 0;
                return (
                  <tr key={g.id} data-testid={`grievance-row-${g.ticket_id}`} className="hover:bg-slate-50">
                    <td className="p-3 font-mono font-semibold text-slate-900 whitespace-nowrap">{g.ticket_id}</td>
                    <td className="p-3">
                      <div className="font-semibold text-slate-900">{g.user_name}</div>
                      <div className="text-[11px] text-slate-500">{g.user_email}</div>
                    </td>
                    <td className="p-3 text-slate-700 max-w-[300px]">
                      <div className="font-semibold text-slate-900">{GROUND[g.grievance_ground] || g.grievance_ground}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5 line-clamp-2">{g.grievance_detail}</div>
                    </td>
                    <td className="p-3 text-slate-600 whitespace-nowrap">{date(g.escalated_at)}</td>
                    <td className="p-3 whitespace-nowrap">
                      <span className={`inline-flex items-center gap-1 font-semibold ${
                        late ? 'text-[#c8102e]' : left <= 7 && g.grievance_status === 'open' ? 'text-amber-700' : 'text-slate-600'}`}>
                        <Clock className="w-3 h-3" /> {date(g.grievance_due_by)}
                      </span>
                      {g.grievance_status === 'open' && (
                        <span className={`block text-[10px] mt-0.5 ${late ? 'text-[#c8102e] font-semibold' : 'text-slate-500'}`}>
                          {late ? `${Math.abs(left)} day${Math.abs(left) === 1 ? '' : 's'} overdue` : `${left} day${left === 1 ? '' : 's'} left`}
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-right">
                      {g.grievance_status === 'open' ? (
                        <button data-testid={`grievance-decide-${g.ticket_id}`} onClick={() => setDeciding(g)}
                          className="text-[#0b3b8c] font-semibold hover:underline">Decide</button>
                      ) : (
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                          g.grievance_status === 'resolved'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-slate-100 text-slate-600 border-slate-200'}`}>{g.grievance_status}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!data.grievances.length && (
                <tr><td colSpan={6} className="p-8 text-center text-slate-500">
                  {status === 'open'
                    ? 'No complaints with the officer. Members escalate from a support ticket they are unhappy with.'
                    : `No ${status} complaints.`}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination meta={data.pagination} onPage={setPage} onPerPage={(n) => { setPerPage(n); setPage(1); }} />
      </div>

      {deciding && <DecideModal grievance={deciding} onClose={() => setDeciding(null)}
        onDone={() => { setDeciding(null); load(); }} />}
    </div>
  );
}

function DecideModal({ grievance, onClose, onDone }) {
  const [outcome, setOutcome] = useState('resolved');
  const [decision, setDecision] = useState('');
  const [busy, setBusy] = useState(false);
  const tooShort = decision.trim().length < 10;

  const save = async () => {
    setBusy(true);
    try {
      toast.success((await api.grievanceResolve(grievance.ticket_id, { outcome, decision })).message || 'Decision recorded');
      onDone();
    } catch (e) { toast.error(e.response?.data?.detail || 'Could not record that decision'); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      testId="grievance-modal"
      title={`Decide ${grievance.ticket_id}`}
      subtitle={`${grievance.user_name} · ${GROUND[grievance.grievance_ground] || grievance.grievance_ground}`}
      onClose={onClose}
      footer={<>
        <button onClick={onClose} className="px-4 py-2 rounded-md border border-slate-200 text-xs font-semibold text-slate-700">Cancel</button>
        <button data-testid="grievance-save" disabled={busy || tooShort} onClick={save}
          className={`px-4 py-2 rounded-md text-white text-xs font-semibold disabled:opacity-50 ${
            outcome === 'rejected' ? 'bg-[#c8102e]' : 'bg-[#0b3b8c]'}`}>
          {busy ? 'Recording…' : outcome === 'resolved' ? 'Resolve the complaint' : 'Reject the complaint'}
        </button>
      </>}
    >
      <div className="p-3 rounded-md bg-slate-50 border border-slate-200 text-[11px] text-slate-700 space-y-2">
        <div>
          <span className="block text-[10px] uppercase tracking-wide text-slate-500 mb-0.5">Original ticket</span>
          {grievance.subject}
        </div>
        <div>
          <span className="block text-[10px] uppercase tracking-wide text-slate-500 mb-0.5">Why they escalated</span>
          {grievance.grievance_detail}
        </div>
        {grievance.resolution_note && (
          <div>
            <span className="block text-[10px] uppercase tracking-wide text-slate-500 mb-0.5">What the desk had said</span>
            {grievance.resolution_note}
          </div>
        )}
      </div>

      <Field label="Outcome">
        <select data-testid="grievance-outcome" className={inputClass} value={outcome}
          onChange={(e) => setOutcome(e.target.value)}>
          <option value="resolved">Upheld — put right for the member</option>
          <option value="rejected">Not upheld — the complaint does not stand</option>
        </select>
      </Field>
      <Field
        label="Decision and the reason for it"
        hint="The member is sent this. A complaint dismissed without a reason is the thing the Act is written against."
      >
        <textarea data-testid="grievance-decision" rows={5} className={inputClass} value={decision}
          onChange={(e) => setDecision(e.target.value)}
          placeholder={outcome === 'rejected'
            ? 'The instalment was received on 4 March and credited the same day; the passbook entry is attached. No interest has been lost.'
            : 'The late fee was charged in error and has been reversed to your folio. The staff member has been spoken to.'} />
      </Field>
      {outcome === 'rejected' && (
        <div className="p-3 rounded-md bg-amber-50 border border-amber-200 text-[11px] text-amber-800">
          A member whose complaint is not upheld may approach the Registrar of Companies or the
          consumer forum with jurisdiction. Tell them the decision plainly, and the evidence for it.
        </div>
      )}
      {tooShort && decision.length > 0 && <p className="text-[11px] text-amber-700">Write at least a full sentence.</p>}
    </Modal>
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
