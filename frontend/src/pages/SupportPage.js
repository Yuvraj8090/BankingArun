import React, { useCallback, useEffect, useState } from 'react';
import { LifeBuoy, RefreshCw, Send, Plus, ArrowLeft } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { toast } from 'sonner';
import Modal, { Field, inputClass } from '../components/Modal';

// Support tickets, for both sides of the counter. A member raises a query, follows
// the replies and, if unhappy, escalates it to the grievance officer (who then sees
// it in the Grievance Queue). Staff see every ticket, reply, add internal notes the
// member never sees, take a ticket, and resolve it with a note. All rules are
// enforced by modules/support.php; this page only draws them.
const STAFF = ['staff', 'admin', 'branch_manager', 'bank_owner'];
const CATEGORIES = ['Account', 'Deposit', 'Loan', 'Transfer', 'KYC', 'Fraud', 'Other'];
const STATUS_LABEL = { OPEN: 'Open', IN_PROGRESS: 'In progress', WAITING_MEMBER: 'Waiting for member', RESOLVED: 'Resolved', CLOSED: 'Closed' };
const GROUNDS = [['unresolved', 'The problem was never fixed'], ['delay', 'It took too long'],
  ['dissatisfied', 'Unhappy with the answer given'], ['staff_conduct', 'How I was treated'], ['other', 'Something else']];
const when = (v) => (v ? new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const err = (e, fallback) => toast.error(e.response?.data?.detail || fallback);

export default function SupportPage() {
  const { user } = useAuth();
  const isStaff = STAFF.includes(user?.role);
  const [list, setList] = useState(null);
  const [status, setStatus] = useState('');
  const [openId, setOpenId] = useState(null);
  const [raising, setRaising] = useState(null);

  const load = useCallback(async () => {
    try {
      setList(isStaff ? await api.supportQueue({ status: status || undefined }) : await api.getMyTickets());
    } catch (e) { err(e, 'Could not load tickets'); }
  }, [isStaff, status]);
  useEffect(() => { load(); }, [load]);

  const raise = async () => {
    try {
      const r = await api.registerComplaint(raising);
      toast.success(r.message || 'Query raised');
      setRaising(null);
      load();
    } catch (e) { err(e, 'Could not raise the query'); }
  };

  if (openId) return <Ticket id={openId} isStaff={isStaff} onBack={() => { setOpenId(null); load(); }} />;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-4">
      <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <LifeBuoy className="w-5 h-5 text-[#0b3b8c]" /> {isStaff ? 'Support Tickets' : 'Help & Support'}
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            {isStaff ? 'Every member query, overdue first. Reply, take a ticket, and resolve it with a note.'
              : 'Raise a query and follow the replies here. If you are not satisfied, escalate it to the grievance officer.'}
          </p>
        </div>
        {!isStaff && (
          <button data-testid="support-new-btn" onClick={() => setRaising({ category: 'Account', subject: '', description: '' })}
            className="px-4 py-2 rounded-md bg-[#0b3b8c] text-white text-xs font-semibold flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" /> Raise a query
          </button>
        )}
      </div>

      {isStaff && list?.counts && (
        <div className="flex flex-wrap gap-2 text-[11px]">
          {[['', 'All'], ['OPEN', `Open (${list.counts.open})`], ['IN_PROGRESS', `In progress (${list.counts.in_progress})`],
            ['WAITING_MEMBER', `Waiting for member (${list.counts.waiting_member})`], ['RESOLVED', 'Resolved'], ['CLOSED', 'Closed']]
            .map(([v, label]) => (
              <button key={v} onClick={() => setStatus(v)}
                className={`px-3 py-1.5 rounded-full border ${status === v ? 'bg-[#0b3b8c] text-white border-[#0b3b8c]' : 'bg-white border-slate-200 text-slate-700'}`}>
                {label}
              </button>
            ))}
          {list.counts.overdue > 0 && <span className="px-3 py-1.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">{list.counts.overdue} overdue</span>}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-lg shadow-sm divide-y divide-slate-100" data-testid="support-list">
        {!list && <p className="p-5 text-xs text-slate-500 flex items-center gap-2"><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Loading…</p>}
        {list && !list.tickets.length && <p className="p-5 text-xs text-slate-500">No tickets here.</p>}
        {list?.tickets.map((t) => (
          <button key={t.id} onClick={() => setOpenId(t.id)} className="w-full text-left p-4 hover:bg-slate-50 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900 truncate">{t.subject}</p>
              <p className="text-[11px] text-slate-500">
                <span className="font-mono">{t.ticket_id}</span> · {t.category}{isStaff ? ` · ${t.user_name}` : ''} · {when(t.created_at)}
              </p>
            </div>
            <div className="text-right shrink-0 space-y-1">
              <span className="inline-block text-[10px] px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200">{STATUS_LABEL[t.status] || t.status}</span>
              {t.unread > 0 && <p className="text-[10px] text-[#0b3b8c] font-semibold">{t.unread} new</p>}
              {t.overdue && <p className="text-[10px] text-rose-700 font-semibold">overdue</p>}
            </div>
          </button>
        ))}
      </div>

      {raising && (
        <Modal testId="support-raise-modal" title="Raise a query" subtitle="Branch staff reply here, usually within 3 working days."
          onClose={() => setRaising(null)}
          footer={<button onClick={raise} data-testid="support-raise-submit" disabled={!raising.subject.trim() || raising.description.trim().length < 10}
            className="px-5 py-2 rounded-md bg-[#0b3b8c] text-white text-xs font-semibold disabled:opacity-50">Send</button>}>
          <div className="space-y-3">
            <Field label="What is it about?">
              <select value={raising.category} onChange={(e) => setRaising({ ...raising, category: e.target.value })} className={inputClass}>
                {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Subject" hint="One line, e.g. Interest not credited on my FD.">
              <input value={raising.subject} maxLength={200} onChange={(e) => setRaising({ ...raising, subject: e.target.value })} className={inputClass} data-testid="support-subject" />
            </Field>
            <Field label="Describe the problem" hint="Dates, amounts and reference numbers help. Never write your password or OTP.">
              <textarea rows={5} value={raising.description} maxLength={2000} onChange={(e) => setRaising({ ...raising, description: e.target.value })} className={inputClass} data-testid="support-description" />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Ticket({ id, isStaff, onBack }) {
  const [data, setData] = useState(null);
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [closing, setClosing] = useState(null);
  const [escalating, setEscalating] = useState(null);

  const load = useCallback(async () => {
    try { setData(await api.ticketDetail(id)); } catch (e) { err(e, 'Could not open the ticket'); onBack(); }
  }, [id, onBack]);
  useEffect(() => { load(); }, [load]);

  const act = async (call, after) => {
    try { const r = await call(); toast.success(r.message); after?.(); load(); } catch (e) { err(e, 'That did not work'); }
  };
  if (!data) return <div className="p-10 text-xs text-slate-500 flex items-center gap-2"><RefreshCw className="w-4 h-4 animate-spin" /> Loading…</div>;
  const t = data.ticket;
  const done = ['RESOLVED', 'CLOSED'].includes(t.status);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto space-y-4">
      <button onClick={onBack} className="text-xs text-[#0b3b8c] font-semibold flex items-center gap-1"><ArrowLeft className="w-3.5 h-3.5" /> All tickets</button>
      <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm space-y-2">
        <h1 className="text-lg font-bold text-slate-900">{t.subject}</h1>
        <p className="text-[11px] text-slate-500">
          <span className="font-mono">{t.ticket_id}</span> · {t.category} · {STATUS_LABEL[t.status] || t.status} · priority {t.priority}
          {isStaff && ` · ${t.user_name} (${t.user_email || 'no email'}) · handled by ${t.assigned_to || 'nobody yet'}`}
        </p>
        {t.resolution_note && <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded p-2">Resolution: {t.resolution_note}</p>}
        <div className="flex flex-wrap gap-2 pt-1">
          {isStaff && <button onClick={() => act(() => api.ticketAssign(t.id, {}))} className="px-3 py-1.5 rounded-md border border-slate-200 text-xs font-semibold">Take this ticket</button>}
          {isStaff && !done && <button onClick={() => setClosing({ status: 'RESOLVED', resolution_note: '' })} data-testid="ticket-resolve-btn"
            className="px-3 py-1.5 rounded-md bg-emerald-700 text-white text-xs font-semibold">Mark resolved</button>}
          {!isStaff && t.grievance_status !== 'open' && (
            <button onClick={() => setEscalating({ ground: 'unresolved', detail: '' })} data-testid="ticket-escalate-btn"
              className="px-3 py-1.5 rounded-md border border-amber-300 bg-amber-50 text-amber-900 text-xs font-semibold">Not satisfied? Escalate to the grievance officer</button>
          )}
          {t.grievance_status === 'open' && <span className="text-[11px] text-amber-800">With the grievance officer ({data.grievance_officer?.name}).</span>}
        </div>
      </div>

      <div className="space-y-2" data-testid="ticket-thread">
        {data.messages.map((m) => (
          <div key={m.id} className={`p-3 rounded-lg border text-xs ${m.internal ? 'bg-amber-50 border-amber-200' : m.author_role === 'member' ? 'bg-white border-slate-200' : 'bg-blue-50 border-blue-100'}`}>
            <p className="text-[10px] text-slate-500 mb-1">{m.author_name} · {m.author_role === 'member' ? 'member' : 'branch staff'}{m.internal ? ' · internal note' : ''} · {when(m.created_at)}</p>
            <p className="whitespace-pre-wrap text-slate-800">{m.body}</p>
          </div>
        ))}
      </div>

      {data.can_reply && (
        <form onSubmit={(e) => { e.preventDefault(); act(() => api.ticketReply(t.id, { body, internal }), () => { setBody(''); setInternal(false); }); }}
          className="bg-white border border-slate-200 rounded-lg p-4 space-y-2">
          <label className="block text-[11px] font-semibold text-slate-700" htmlFor="ticket-reply">Your reply</label>
          <textarea id="ticket-reply" rows={3} value={body} maxLength={4000} onChange={(e) => setBody(e.target.value)} className={inputClass} data-testid="ticket-reply" />
          <div className="flex items-center justify-between gap-2">
            {isStaff ? (
              <label className="text-[11px] text-slate-600 flex items-center gap-1.5">
                <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Internal note (the member will not see it)
              </label>
            ) : <span />}
            <button type="submit" disabled={body.trim().length < 2} data-testid="ticket-send"
              className="px-4 py-2 rounded-md bg-[#0b3b8c] text-white text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50">
              <Send className="w-3.5 h-3.5" /> Send
            </button>
          </div>
        </form>
      )}

      {closing && (
        <Modal title="Mark resolved" subtitle="The member sees this note." onClose={() => setClosing(null)}
          footer={<button onClick={() => act(() => api.ticketStatus(t.id, closing), () => setClosing(null))} disabled={!closing.resolution_note.trim()}
            className="px-5 py-2 rounded-md bg-emerald-700 text-white text-xs font-semibold disabled:opacity-50">Save</button>}>
          <Field label="How was it resolved?">
            <textarea rows={3} value={closing.resolution_note} maxLength={500} onChange={(e) => setClosing({ ...closing, resolution_note: e.target.value })} className={inputClass} />
          </Field>
        </Modal>
      )}

      {escalating && (
        <Modal title="Escalate to the grievance officer" subtitle="The officer must answer within 30 days." onClose={() => setEscalating(null)}
          footer={<button onClick={() => act(() => api.ticketEscalate(t.id, escalating), () => setEscalating(null))} disabled={escalating.detail.trim().length < 10}
            className="px-5 py-2 rounded-md bg-amber-600 text-white text-xs font-semibold disabled:opacity-50">Escalate</button>}>
          <div className="space-y-3">
            <Field label="Why are you escalating?">
              <select value={escalating.ground} onChange={(e) => setEscalating({ ...escalating, ground: e.target.value })} className={inputClass}>
                {GROUNDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
            <Field label="What went wrong?" hint="A sentence or two the officer can act on.">
              <textarea rows={3} value={escalating.detail} maxLength={1000} onChange={(e) => setEscalating({ ...escalating, detail: e.target.value })} className={inputClass} />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
