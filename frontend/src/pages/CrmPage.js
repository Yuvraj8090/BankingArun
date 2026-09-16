import React, { useCallback, useEffect, useState } from 'react';
import {
  Users, Search, RefreshCw, Phone, ArrowLeft, UserPlus, CheckCircle2,
  AlertTriangle, CalendarClock, Plus, ShieldAlert
} from 'lucide-react';
import { api } from '../services/api';
import Pagination from '../components/Pagination';
import Modal from '../components/Modal';
import { toast } from 'sonner';

const TABS = [['members', 'Members'], ['leads', 'Leads'], ['tasks', 'My Tasks']];
const STAGE_STYLE = {
  new: 'bg-slate-100 text-slate-600 border-slate-200',
  contacted: 'bg-blue-50 text-blue-700 border-blue-200',
  documents: 'bg-amber-50 text-amber-700 border-amber-200',
  enrolled: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  lost: 'bg-rose-50 text-[#c8102e] border-rose-200'
};
const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

export default function CrmPage() {
  const [tab, setTab] = useState('members');
  const [memberId, setMemberId] = useState(null);

  // Opening a member takes over the whole page: it is a lot of detail and
  // reads better without a list competing beside it.
  if (memberId) return <Member360 id={memberId} onBack={() => setMemberId(null)} />;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm flex items-center gap-3">
        <div className="w-10 h-10 rounded-md bg-[#0b3b8c] text-white flex items-center justify-center">
          <Users className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900">Relationship Desk</h1>
          <p className="text-xs text-slate-500">Members, the pipeline, and who to call today</p>
        </div>
      </div>

      <div className="flex gap-1.5">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            data-testid={`crm-tab-${id}`}
            onClick={() => setTab(id)}
            className={`px-4 py-1.5 rounded-md text-xs font-semibold border ${
              tab === id ? 'bg-[#0b3b8c] text-white border-[#0b3b8c]' : 'bg-white text-slate-600 border-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'members' && <MembersTab onOpen={setMemberId} />}
      {tab === 'leads' && <LeadsTab />}
      {tab === 'tasks' && <TasksTab />}
    </div>
  );
}

// --- Members -----------------------------------------------------------------
function MembersTab({ onOpen }) {
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [uncontacted, setUncontacted] = useState(false);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);

  const load = useCallback(async () => {
    try {
      setData(await api.crmMembers({ q, page, per_page: perPage, ...(uncontacted ? { uncontacted: 1 } : {}) }));
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Could not load members');
    }
  }, [q, page, perPage, uncontacted]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
      <div className="p-4 border-b border-slate-100 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            data-testid="crm-member-search"
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }}
            placeholder="Search by name, email or phone"
            className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-md text-sm"
          />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          <input type="checkbox" checked={uncontacted} onChange={(e) => { setUncontacted(e.target.checked); setPage(1); }} />
          Never contacted
        </label>
        <button onClick={load} className="px-3 py-2 rounded-md border border-slate-200 text-xs font-semibold text-slate-700 flex items-center gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {!data ? (
        <p className="p-10 text-center text-xs text-slate-500">Loading members…</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-[11px] uppercase text-slate-600">
                <tr>
                  <th className="p-3 font-semibold">Member</th>
                  <th className="p-3 font-semibold">Contact</th>
                  <th className="p-3 font-semibold">KYC</th>
                  <th className="p-3 font-semibold text-right">Balances</th>
                  <th className="p-3 font-semibold">Last contact</th>
                  <th className="p-3 font-semibold text-right">Open tasks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.members.map((m) => (
                  <tr
                    key={m.id}
                    data-testid={`crm-member-${m.id}`}
                    onClick={() => onOpen(m.id)}
                    className="hover:bg-blue-50/50 cursor-pointer"
                  >
                    <td className="p-3">
                      <div className="font-semibold text-slate-900">{m.name}</div>
                      <div className="text-[10px] text-slate-500">{m.branch || '—'}</div>
                    </td>
                    <td className="p-3 text-slate-600">{m.email}<br /><span className="text-slate-500">{m.phone}</span></td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                        m.kyc_status === 'verified'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-amber-50 text-amber-700 border-amber-200'
                      }`}>{m.kyc_status}</span>
                    </td>
                    <td className="p-3 text-right font-semibold text-slate-900">{money(m.balances)}</td>
                    <td className="p-3 text-slate-500">
                      {m.last_contact ? day(m.last_contact) : <span className="text-[#c8102e]">Never</span>}
                    </td>
                    <td className="p-3 text-right">{m.open_tasks || '—'}</td>
                  </tr>
                ))}
                {!data.members.length && (
                  <tr><td colSpan={6} className="p-10 text-center text-slate-500">No members match.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination meta={data.pagination} onPage={setPage} onPerPage={(n) => { setPerPage(n); setPage(1); }} />
        </>
      )}
    </div>
  );
}

// --- Member 360 --------------------------------------------------------------
function Member360({ id, onBack }) {
  const [data, setData] = useState(null);
  const [logging, setLogging] = useState(false);

  const load = useCallback(async () => {
    try { setData(await api.crmMember(id)); }
    catch (e) { toast.error(e.response?.data?.detail || 'Could not load this member'); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (!data) {
    return <div className="p-10 flex items-center gap-2 text-slate-600"><RefreshCw className="w-4 h-4 animate-spin" /> Loading member…</div>;
  }
  const { member, relationship: rel } = data;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <button onClick={onBack} data-testid="crm-back" className="text-xs text-[#0b3b8c] font-semibold flex items-center gap-1">
        <ArrowLeft className="w-3.5 h-3.5" /> Back to members
      </button>

      <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">{member.name}</h1>
          <p className="text-xs text-slate-500">{member.email} · {member.phone} · {member.branch || 'No branch'}</p>
          <p className="text-[11px] text-slate-500 mt-1">
            Member for {rel.days_with_us} days · since {day(rel.member_since)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data.open_fraud_alerts > 0 && (
            <span className="px-2 py-1 rounded-md bg-rose-50 border border-rose-200 text-[#c8102e] text-[11px] font-semibold flex items-center gap-1">
              <ShieldAlert className="w-3.5 h-3.5" /> {data.open_fraud_alerts} open AML alert(s)
            </span>
          )}
          <button
            data-testid="crm-log-interaction"
            onClick={() => setLogging(true)}
            className="px-4 py-2 rounded-md bg-[#0b3b8c] text-white text-xs font-semibold flex items-center gap-1.5"
          >
            <Phone className="w-3.5 h-3.5" /> Log a contact
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Balances" value={money(rel.balances)} />
        <Kpi label="Active deposits" value={money(rel.active_deposits)} />
        <Kpi label="Borrowed" value={money(rel.borrowed)} tone={rel.borrowed > 0 ? 'warn' : undefined} />
        <Kpi label="Net relationship" value={money(rel.net_relationship_value)} tone="ok" />
      </div>

      {logging && <LogInteraction memberId={member.id} onClose={() => setLogging(false)} onSaved={() => { setLogging(false); load(); }} />}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Panel title="Accounts">
          {data.accounts.map((a) => (
            <Row key={a.id} left={<><span className="font-mono">{a.account_number}</span><br /><span className="text-slate-500">{a.account_type}</span></>}
              right={<><strong>{money(a.balance)}</strong><br /><span className="text-slate-500">{a.status}</span></>} />
          ))}
        </Panel>

        <Panel title="Deposits">
          {data.deposits.map((d) => (
            <Row key={d.deposit_number}
              left={<><span className="font-mono">{d.deposit_number}</span><br /><span className="text-slate-500">matures {day(d.maturity_date)}</span></>}
              right={<><strong>{money(d.principal_amount)}</strong><br /><span className="text-slate-500">{d.interest_rate}% · {d.status}</span></>} />
          ))}
          {!data.deposits.length && <Empty>No deposits.</Empty>}
        </Panel>

        <Panel title="Loans">
          {data.loans.map((l) => (
            <Row key={l.loan_application_no}
              left={<><span className="font-mono">{l.loan_application_no}</span><br /><span className="text-slate-500">{l.loan_type}</span></>}
              right={<><strong>{money(l.amount)}</strong><br />
                <span className="text-slate-500">
                  {l.risk_grade ? `grade ${l.risk_grade}` : 'ungraded'} · {l.status}
                </span></>} />
          ))}
          {!data.loans.length && <Empty>No loan applications.</Empty>}
        </Panel>

        <Panel title="Standing instructions">
          {data.standing_instructions.map((si, i) => (
            <Row key={i}
              left={<>{si.beneficiary_name}<br /><span className="text-slate-500">{si.frequency} · next {si.next_run || '—'}</span></>}
              right={<><strong>{money(si.amount)}</strong><br />
                <span className={si.last_status === 'failed' ? 'text-[#c8102e]' : 'text-slate-500'}>{si.status}</span></>} />
          ))}
          {!data.standing_instructions.length && <Empty>None set up.</Empty>}
        </Panel>

        <Panel title="Support tickets">
          {data.tickets.map((t) => (
            <Row key={t.ticket_id}
              left={<>{t.subject}<br /><span className="text-slate-500 font-mono">{t.ticket_id}</span></>}
              right={<span className="text-slate-500">{t.status}</span>} />
          ))}
          {!data.tickets.length && <Empty>No tickets raised.</Empty>}
        </Panel>

        <Panel title="Recent activity">
          {data.recent_transactions.map((t, i) => (
            <Row key={i}
              left={<>{t.counterparty_name || t.mode}<br /><span className="text-slate-500">{day(t.timestamp)}</span></>}
              right={<span className={t.type === 'credit' ? 'text-emerald-700 font-semibold' : 'text-slate-900 font-semibold'}>
                {t.type === 'credit' ? '+' : '−'}{money(t.amount)}
              </span>} />
          ))}
        </Panel>
      </div>

      <Panel title={`Contact history (${data.interactions.length})`}>
        {data.interactions.map((i) => (
          <div key={i.id} className="py-2.5 text-xs border-b border-slate-100 last:border-0">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-slate-800">{i.subject}</span>
              <span className="text-slate-500 text-[10px]">{day(i.created_at)} · {i.recorded_by_name}</span>
            </div>
            <div className="text-slate-500 mt-0.5">
              <span className="uppercase text-[10px] tracking-wide">{i.channel}</span>
              {i.outcome && <> · {i.outcome}</>}
              {i.notes && <> — {i.notes}</>}
            </div>
          </div>
        ))}
        {!data.interactions.length && <Empty>Nobody has recorded a conversation with this member yet.</Empty>}
      </Panel>
    </div>
  );
}

function LogInteraction({ memberId, onClose, onSaved }) {
  const [form, setForm] = useState({ channel: 'call', direction: 'outbound', subject: '', notes: '', outcome: 'reached', follow_up_on: '' });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const payload = { ...form, member_user_id: memberId };
      if (!payload.follow_up_on) delete payload.follow_up_on;
      toast.success((await api.crmLogInteraction(payload)).message);
      onSaved();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Could not log this');
    } finally { setSaving(false); }
  };

  return (
    <Modal
      testId="crm-interaction-modal"
      wide
      title="Log a contact"
      subtitle="A follow-up date creates a task for you automatically."
      onClose={onClose}
      footer={<>
        <button onClick={onClose}
          className="px-4 py-2 rounded-md border border-slate-200 text-xs font-semibold text-slate-700">Cancel</button>
        <button data-testid="crm-save-interaction" disabled={saving || !form.subject} onClick={save}
          className="px-5 py-2 rounded-md bg-[#0b3b8c] text-white text-xs font-semibold disabled:opacity-50">
          Save
        </button>
      </>}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Select label="Channel" value={form.channel} onChange={(v) => setForm({ ...form, channel: v })}
          options={['call', 'visit', 'email', 'sms', 'whatsapp', 'note']} testId="crm-channel" />
        <Select label="Direction" value={form.direction} onChange={(v) => setForm({ ...form, direction: v })}
          options={['outbound', 'inbound']} />
        <Select label="Outcome" value={form.outcome} onChange={(v) => setForm({ ...form, outcome: v })}
          options={['reached', 'no_answer', 'callback', 'resolved', 'escalated']} />
        <div className="md:col-span-2">
          <Field label="What was it about?" value={form.subject} onChange={(v) => setForm({ ...form, subject: v })} testId="crm-subject" />
        </div>
        <Field label="Follow up on (optional)" type="date" value={form.follow_up_on}
          onChange={(v) => setForm({ ...form, follow_up_on: v })} testId="crm-followup" />
        <div className="md:col-span-2">
          <Field label="Notes" value={form.notes} onChange={(v) => setForm({ ...form, notes: v })} />
        </div>
      </div>
    </Modal>
  );
}

// --- Leads -------------------------------------------------------------------
function LeadsTab() {
  const [data, setData] = useState(null);
  const [stage, setStage] = useState('');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', email: '', source: 'walk_in', interest: 'deposit', notes: '' });

  const load = useCallback(async () => {
    try { setData(await api.crmLeads({ stage, page, per_page: 25 })); }
    catch (e) { toast.error(e.response?.data?.detail || 'Could not load leads'); }
  }, [stage, page]);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    try {
      toast.success((await api.crmLeadCreate(form)).message);
      setAdding(false);
      setForm({ name: '', phone: '', email: '', source: 'walk_in', interest: 'deposit', notes: '' });
      load();
    } catch (e) { toast.error(e.response?.data?.detail || 'Could not add this lead'); }
  };

  const advance = async (lead, next) => {
    const body = { stage: next };
    if (next === 'lost') {
      const reason = window.prompt('Why was this lead lost?');
      if (!reason) return;
      body.lost_reason = reason;
    }
    if (next === 'enrolled') {
      const memberId = window.prompt('Member account id this lead became:');
      if (!memberId) return;
      body.converted_user_id = memberId;
    }
    try { toast.success((await api.crmLeadUpdate(lead.id, body)).message); load(); }
    catch (e) { toast.error(e.response?.data?.detail || 'Could not update'); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select value={stage} onChange={(e) => { setStage(e.target.value); setPage(1); }}
          data-testid="crm-lead-stage-filter"
          className="border border-slate-200 rounded-md px-3 py-2 text-xs bg-white">
          <option value="">All stages</option>
          {['new', 'contacted', 'documents', 'enrolled', 'lost'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {data && Object.entries(data.by_stage || {}).map(([s, n]) => (
          <span key={s} className={`px-2 py-1 rounded-full text-[10px] font-semibold border ${STAGE_STYLE[s]}`}>{s}: {n}</span>
        ))}
        <button data-testid="crm-new-lead" onClick={() => setAdding(true)}
          className="ml-auto px-4 py-2 rounded-md bg-[#0b3b8c] text-white text-xs font-semibold flex items-center gap-1.5">
          <UserPlus className="w-3.5 h-3.5" /> New lead
        </button>
      </div>

      {adding && (
        <Modal
          testId="crm-lead-modal"
          title="New lead"
          subtitle="Somebody who has enquired but is not yet on the member register."
          onClose={() => setAdding(false)}
          footer={<>
            <button onClick={() => setAdding(false)}
              className="px-4 py-2 rounded-md border border-slate-200 text-xs font-semibold text-slate-700">Cancel</button>
            <button data-testid="crm-save-lead" onClick={create} disabled={!form.name || !form.phone}
              className="px-5 py-2 rounded-md bg-[#0b3b8c] text-white text-xs font-semibold disabled:opacity-50">Add lead</button>
          </>}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} testId="crm-lead-name" />
            <Field label="Phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} testId="crm-lead-phone" />
            <Field label="Email (optional)" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
            <Select label="Source" value={form.source} onChange={(v) => setForm({ ...form, source: v })}
              options={['walk_in', 'referral', 'agent', 'campaign', 'phone']} />
            <Select label="Interested in" value={form.interest} onChange={(v) => setForm({ ...form, interest: v })}
              options={['savings', 'deposit', 'loan', 'other']} />
          </div>
        </Modal>
      )}

      <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
        {!data ? <p className="p-10 text-center text-xs text-slate-500">Loading…</p> : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-[11px] uppercase text-slate-600">
                  <tr>
                    <th className="p-3 font-semibold">Name</th>
                    <th className="p-3 font-semibold">Contact</th>
                    <th className="p-3 font-semibold">Source</th>
                    <th className="p-3 font-semibold">Interest</th>
                    <th className="p-3 font-semibold">Stage</th>
                    <th className="p-3 font-semibold text-right">Move to</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.leads.map((l) => (
                    <tr key={l.id} data-testid={`crm-lead-${l.id}`} className="hover:bg-slate-50">
                      <td className="p-3 font-semibold text-slate-900">{l.name}</td>
                      <td className="p-3 text-slate-600">{l.phone}<br /><span className="text-slate-500">{l.email || '—'}</span></td>
                      <td className="p-3 text-slate-600">{l.source}{l.agent_name ? ` · ${l.agent_name}` : ''}</td>
                      <td className="p-3 text-slate-600">{l.interest || '—'}</td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${STAGE_STYLE[l.stage]}`}>{l.stage}</span>
                        {l.lost_reason && <div className="text-[10px] text-slate-500 mt-0.5">{l.lost_reason}</div>}
                      </td>
                      <td className="p-3 text-right whitespace-nowrap">
                        {['contacted', 'documents', 'enrolled', 'lost']
                          .filter((s) => s !== l.stage && l.stage !== 'enrolled' && l.stage !== 'lost')
                          .map((s) => (
                            <button key={s} onClick={() => advance(l, s)}
                              className="ml-2 text-[11px] text-[#0b3b8c] hover:underline">{s}</button>
                          ))}
                      </td>
                    </tr>
                  ))}
                  {!data.leads.length && <tr><td colSpan={6} className="p-10 text-center text-slate-500">No leads yet.</td></tr>}
                </tbody>
              </table>
            </div>
            <Pagination meta={data.pagination} onPage={setPage} />
          </>
        )}
      </div>
    </div>
  );
}

// --- Tasks -------------------------------------------------------------------
function TasksTab() {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('open');
  const [all, setAll] = useState(false);
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: '', details: '', due_on: '', priority: 'MEDIUM' });

  const load = useCallback(async () => {
    try { setData(await api.crmTasks({ status, page, per_page: 25, ...(all ? { all: 1 } : {}) })); }
    catch (e) { toast.error(e.response?.data?.detail || 'Could not load tasks'); }
  }, [status, all, page]);
  useEffect(() => { load(); }, [load]);

  const complete = async (task) => {
    const note = window.prompt(`What happened with "${task.title}"?`);
    if (!note) return;
    try { toast.success((await api.crmTaskUpdate(task.id, { status: 'done', completion_note: note })).message); load(); }
    catch (e) { toast.error(e.response?.data?.detail || 'Could not close the task'); }
  };

  const create = async () => {
    try {
      toast.success((await api.crmTaskCreate(form)).message);
      setAdding(false);
      setForm({ title: '', details: '', due_on: '', priority: 'MEDIUM' });
      load();
    } catch (e) { toast.error(e.response?.data?.detail || 'Could not create the task'); }
  };

  return (
    <div className="space-y-4">
      {data && (
        <div className="grid grid-cols-3 gap-3">
          <Kpi label="Open" value={data.counts.mine_open} />
          <Kpi label="Due today" value={data.counts.due_today} tone={data.counts.due_today ? 'warn' : undefined} />
          <Kpi label="Overdue" value={data.counts.mine_overdue} tone={data.counts.mine_overdue ? 'bad' : 'ok'} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="border border-slate-200 rounded-md px-3 py-2 text-xs bg-white">
          {['open', 'done', 'cancelled'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          <input type="checkbox" checked={all} onChange={(e) => { setAll(e.target.checked); setPage(1); }} />
          Everyone's
        </label>
        <button data-testid="crm-new-task" onClick={() => setAdding(true)}
          className="ml-auto px-4 py-2 rounded-md bg-[#0b3b8c] text-white text-xs font-semibold flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5" /> New task
        </button>
      </div>

      {adding && (
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="md:col-span-2"><Field label="Task" value={form.title} onChange={(v) => setForm({ ...form, title: v })} testId="crm-task-title" /></div>
          <Field label="Due" type="date" value={form.due_on} onChange={(v) => setForm({ ...form, due_on: v })} testId="crm-task-due" />
          <Select label="Priority" value={form.priority} onChange={(v) => setForm({ ...form, priority: v })}
            options={['LOW', 'MEDIUM', 'HIGH', 'URGENT']} />
          <div className="md:col-span-3"><Field label="Details" value={form.details} onChange={(v) => setForm({ ...form, details: v })} /></div>
          <div className="flex items-end gap-2">
            <button data-testid="crm-save-task" onClick={create} disabled={!form.title || !form.due_on}
              className="flex-1 px-4 py-2 rounded-md bg-[#0b3b8c] text-white text-xs font-semibold disabled:opacity-50">Create</button>
            <button onClick={() => setAdding(false)} className="px-3 py-2 rounded-md border border-slate-200 text-xs">Cancel</button>
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
        {!data ? <p className="p-10 text-center text-xs text-slate-500">Loading…</p> : (
          <>
            <div className="divide-y divide-slate-100">
              {data.tasks.map((t) => (
                <div key={t.id} data-testid={`crm-task-${t.id}`} className="p-4 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold text-slate-900">{t.title}</span>
                      {t.overdue && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold border bg-rose-50 text-[#c8102e] border-rose-200 flex items-center gap-1">
                          <AlertTriangle className="w-2.5 h-2.5" /> overdue
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-1">
                      <CalendarClock className="w-3 h-3" /> due {day(t.due_on)}
                      {t.member_name && <> · {t.member_name}</>}
                      {t.lead_name && <> · lead: {t.lead_name}</>}
                      {t.assignee_name && <> · {t.assignee_name}</>}
                    </div>
                    {t.details && <p className="text-[11px] text-slate-500 mt-1">{t.details}</p>}
                    {t.completion_note && <p className="text-[11px] text-emerald-700 mt-1">✓ {t.completion_note}</p>}
                  </div>
                  {t.status === 'open' && (
                    <button onClick={() => complete(t)} data-testid={`crm-complete-${t.id}`}
                      className="px-3 py-1.5 rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs font-semibold flex items-center gap-1.5 shrink-0">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Done
                    </button>
                  )}
                </div>
              ))}
              {!data.tasks.length && <p className="p-10 text-center text-xs text-slate-500">Nothing here. Good.</p>}
            </div>
            <Pagination meta={data.pagination} onPage={setPage} />
          </>
        )}
      </div>
    </div>
  );
}

// --- Small shared bits -------------------------------------------------------
function Kpi({ label, value, tone }) {
  const colour = tone === 'bad' ? 'text-[#c8102e]' : tone === 'warn' ? 'text-amber-700'
    : tone === 'ok' ? 'text-emerald-700' : 'text-slate-900';
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={`text-xl font-bold ${colour}`}>{value}</div>
    </div>
  );
}

function Panel({ title, children }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
      <div className="px-4 py-3 border-b border-slate-100 text-sm font-semibold text-slate-900">{title}</div>
      <div className="px-4 py-2">{children}</div>
    </div>
  );
}

const Row = ({ left, right }) => (
  <div className="py-2.5 text-xs flex items-start justify-between gap-3 border-b border-slate-100 last:border-0">
    <div className="text-slate-700 min-w-0">{left}</div>
    <div className="text-right text-slate-700 shrink-0">{right}</div>
  </div>
);

const Empty = ({ children }) => <p className="py-6 text-center text-xs text-slate-500">{children}</p>;

function Field({ label, value, onChange, type = 'text', testId }) {
  return (
    <div>
      <label className="block text-[11px] text-slate-600 mb-1">{label}</label>
      <input type={type} value={value} data-testid={testId} onChange={(e) => onChange(e.target.value)}
        className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm text-slate-900" />
    </div>
  );
}

function Select({ label, value, onChange, options, testId }) {
  return (
    <div>
      <label className="block text-[11px] text-slate-600 mb-1">{label}</label>
      <select value={value} data-testid={testId} onChange={(e) => onChange(e.target.value)}
        className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm text-slate-900 bg-white">
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}
