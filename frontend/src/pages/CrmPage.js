import React, { useCallback, useEffect, useState } from 'react';
import {
  Users, Search, RefreshCw, Phone, ArrowLeft, UserPlus, CheckCircle2,
  AlertTriangle, CalendarClock, Plus, ShieldAlert
} from 'lucide-react';
import { api } from '../services/api';
import Pagination from '../components/Pagination';
import Modal, { PasswordGenField } from '../components/Modal';
import DocumentUpload from '../components/DocumentUpload';
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
        <label className="flex items-center gap-1.5 text-xs text-slate-600 py-1.5">
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


// The documents a person has to hand over before an account exists for them.
// Before this they could only be uploaded by someone who already had an account,
// which put the verification behind the thing it is meant to gate.
const FILE_KINDS = [
  { kind: 'pan', label: 'PAN card', hint: 'JPEG, PNG or PDF, up to 3 MB' },
  { kind: 'aadhaar', label: 'Aadhaar', hint: 'Mask all but the last four digits' },
  { kind: 'address', label: 'Proof of address', hint: 'A utility bill, passport or voter ID' },
];

const DOC_STYLE = {
  verified: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  rejected: 'bg-red-50 border-red-200 text-[#c8102e]',
  pending_review: 'bg-amber-50 border-amber-200 text-amber-800',
};

function ApplicationFile({ leadId, onChange }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await api.leadDocuments(leadId);
      setFile(r);
      onChange?.(r);
    } catch (e) { toast.error(e.response?.data?.detail || 'Could not load the documents'); }
  }, [leadId, onChange]);
  useEffect(() => { load(); }, [load]);

  const review = async (doc, decision) => {
    let reason = '';
    if (decision === 'rejected') {
      // Refused server-side without one, because a rejection the applicant
      // cannot act on just sends them back to the counter to ask why.
      reason = window.prompt('What is wrong with this document?') || '';
      if (!reason) return;
    }
    setBusy(doc.id);
    try {
      toast.success((await api.kycDocumentReview(doc.id, { decision, reason })).message);
      await load();
    } catch (e) { toast.error(e.response?.data?.detail || 'Could not record that decision'); }
    finally { setBusy(''); }
  };

  const byKind = {};
  (file?.documents || []).forEach((d) => { byKind[d.kind] = d; });

  return (
    <div className="rounded-md border border-slate-200 bg-white p-3 space-y-3" data-testid="open-account-file">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-slate-900">Documents for this account</p>
          <p className="text-[11px] text-slate-500">
            A PAN card or Aadhaar, and a proof of address. Both have to be checked here before the
            account can be opened — the button below stays disabled until they are.
          </p>
        </div>
        {file && (
          <span data-testid="open-account-file-state"
            className={`shrink-0 px-2 py-1 rounded-full text-[10px] font-semibold border ${
              file.ready_to_open ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
            {file.ready_to_open ? 'Verified — ready to open' : 'Not yet verified'}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {FILE_KINDS.map(({ kind, label, hint }) => {
          const doc = byKind[kind];
          return (
            <div key={kind} className="space-y-1.5">
              <DocumentUpload
                kind={kind} label={label} hint={hint}
                upload={(payload) => api.leadDocumentUpload(leadId, payload)}
                onUploaded={load}
              />
              {doc && (
                <div className={`p-1.5 rounded-md border text-[10px] ${DOC_STYLE[doc.status] || DOC_STYLE.pending_review}`}>
                  <div className="font-semibold">
                    {doc.status === 'pending_review' ? 'Waiting to be checked' : doc.status}
                  </div>
                  {doc.review_reason && <div className="mt-0.5">{doc.review_reason}</div>}
                  {doc.status === 'pending_review' && (
                    <div className="flex gap-2 mt-1">
                      <button disabled={busy === doc.id} data-testid={`open-verify-${kind}`}
                        onClick={() => review(doc, 'verified')}
                        className="font-semibold text-emerald-700 hover:underline disabled:opacity-50">verify</button>
                      <button disabled={busy === doc.id} data-testid={`open-reject-${kind}`}
                        onClick={() => review(doc, 'rejected')}
                        className="font-semibold text-[#c8102e] hover:underline disabled:opacity-50">reject</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {file && !file.ready_to_open && (
        <p className="text-[11px] text-amber-800">Still needed: {file.missing.join(' and ')}.</p>
      )}
    </div>
  );
}

const inr = (n) => `₹${Number(n).toLocaleString('en-IN')}`;

// Plan and denomination together, because on their own neither opens a deposit.
// The figures shown are the brochure's own for that slab — the same ones the
// member was sold from — so the counter and the printed book cannot disagree.
function PlanChoice({ schemes, account, setAccount }) {
  const scheme = schemes.find((s) => s.code === account.scheme_code);
  const slabs = scheme?.slabs || [];
  const slab = slabs.find((s) => Number(s.unit) === Number(account.scheme_amount));
  const byInstalment = ['daily', 'recurring'].includes(scheme?.scheme_type);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <div>
        <label className="block text-[11px] text-slate-600 mb-1">Plan they are taking</label>
        <select data-testid="open-scheme" value={account.scheme_code}
          onChange={(e) => setAccount({ ...account, scheme_code: e.target.value, scheme_amount: '' })}
          className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm text-slate-900 bg-white">
          <option value="">Not decided yet</option>
          {schemes.map((sc) => <option key={sc.code} value={sc.code}>{sc.name} ({sc.code})</option>)}
        </select>
      </div>

      <div>
        <label className="block text-[11px] text-slate-600 mb-1">
          {byInstalment ? 'Monthly instalment' : 'Amount'}
        </label>
        <select data-testid="open-scheme-amount" value={account.scheme_amount || ''}
          disabled={!scheme}
          onChange={(e) => setAccount({ ...account, scheme_amount: e.target.value })}
          className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm text-slate-900 bg-white disabled:bg-slate-50">
          <option value="">{scheme ? 'Choose an amount' : 'Choose a plan first'}</option>
          {slabs.map((sl) => <option key={sl.unit} value={sl.unit}>{inr(sl.unit)}</option>)}
        </select>
      </div>

      {slab && (
        <div className="md:col-span-2 p-2.5 rounded-md bg-slate-50 border border-slate-200 text-[11px] text-slate-700"
          data-testid="open-scheme-terms">
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            <span>Pays in <b>{inr(slab.deposit)}</b>{byInstalment ? ` (${inr(slab.unit)} a month)` : ' today'}</span>
            {slab.monthly_payout
              ? <span>Receives <b>{inr(slab.monthly_payout)}</b> every month</span>
              : null}
            <span>Total back <b>{inr(slab.maturity)}</b> over {scheme.tenure_months} months</span>
          </div>
          {slab.exceeds_cap && (
            <p className="mt-1 text-[#c8102e]">
              These printed figures work out at {slab.effective_rate_pa}% a year, above the 12.5% a
              Nidhi may pay on deposits. Say so to the member rather than letting them find out later.
            </p>
          )}
          {byInstalment && (
            <p className="mt-1 text-slate-500">
              Nothing is collected at the counter today — the instalments are collected on schedule.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// --- Leads -------------------------------------------------------------------
function LeadsTab() {
  const [data, setData] = useState(null);
  const [stage, setStage] = useState('');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [opening, setOpening] = useState(null);
  const [account, setAccount] = useState(null);
  const [saving, setSaving] = useState(false);
  const [file, setFile] = useState(null);
  const [opened, setOpened] = useState(null);
  const [schemes, setSchemes] = useState([]);
  const [form, setForm] = useState({ name: '', phone: '', email: '', source: 'walk_in', interest: 'deposit', scheme_code: '', notes: '' });

  // Only the plans we actually publish, so the desk cannot record somebody as
  // having signed up for one that was never launched.
  useEffect(() => {
    api.publicSchemes().then((r) => setSchemes(r.schemes || [])).catch(() => setSchemes([]));
  }, []);

  const load = useCallback(async () => {
    try { setData(await api.crmLeads({ stage, page, per_page: 25 })); }
    catch (e) { toast.error(e.response?.data?.detail || 'Could not load leads'); }
  }, [stage, page]);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    try {
      toast.success((await api.crmLeadCreate(form)).message);
      setAdding(false);
      setForm({ name: '', phone: '', email: '', source: 'walk_in', interest: 'deposit', scheme_code: '', notes: '' });
      load();
    } catch (e) { toast.error(e.response?.data?.detail || 'Could not add this lead'); }
  };

  // The lead's own id goes with it, which is what carries a referral code
  // through to the bonus without anyone retyping it.
  useEffect(() => {
    if (!opening) return;
    setFile(null);
    setAccount({
      name: opening.name || '', email: opening.email || '', phone: opening.phone || '',
      password: '', transaction_password: '', pan_number: '', initial_deposit: 1000,
      scheme_code: opening.scheme_code || '', scheme_amount: '',
    });
  }, [opening]);

  const openAccount = async () => {
    setSaving(true);
    try {
      // The plan is saved to the enquiry first, because that is the row the
      // opening reads it back from — and the row that keeps the record of what
      // the member was told they were signing up for.
      if ((account.scheme_code || '') !== (opening.scheme_code || '')) {
        await api.crmLeadUpdate(opening.id, { scheme_code: account.scheme_code || '' });
      }
      const r = await api.openAccount({ ...account, lead_id: opening.id });
      if (r.referral_bonus) {
        toast.success(`Referral bonus of ₹${r.referral_bonus} paid to both sides.`);
      }
      setOpening(null);
      setAccount(null);
      // Shown rather than announced in a toast that disappears: this is the one
      // moment the user ID exists on screen for the teller to write down.
      setOpened(r);
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Could not open the account');
    } finally { setSaving(false); }
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

      {opening && account && (
        <Modal
          testId="crm-open-account-modal"
          wide
          title={`Open an account for ${opening.name}`}
          subtitle="Only after their identity documents have been seen and verified at the counter."
          onClose={() => { setOpening(null); setAccount(null); }}
          footer={<>
            <button onClick={() => { setOpening(null); setAccount(null); }}
              className="px-4 py-2 rounded-md border border-slate-200 text-xs font-semibold text-slate-700">Cancel</button>
            <button data-testid="crm-confirm-open-account" onClick={openAccount}
              disabled={saving || !account.name || !account.phone
                || !account.password || !account.transaction_password
                || !file?.ready_to_open}
              className="px-5 py-2 rounded-md bg-[#0b3b8c] text-white text-xs font-semibold disabled:opacity-50">
              {saving ? 'Opening…' : 'Open account'}
            </button>
          </>}
        >
          <div className="space-y-3">
            {opening.referral_code && (
              <div className="p-2.5 rounded-md bg-emerald-50 border border-emerald-200 text-[11px] text-emerald-900">
                This enquiry came through referral <b className="font-mono">{opening.referral_code}</b>.
                The bonus pays to both sides on opening — you do not need to enter the code.
              </div>
            )}
            <div className="p-2.5 rounded-md bg-slate-50 border border-slate-200 text-[11px] text-slate-600">
              The member signs in with the password you set here — with their email if they gave one,
              otherwise with the account number this creates. Give both to them in person and ask them
              to change the password from Security &amp; Passkeys.
            </div>
            <ApplicationFile leadId={opening.id} onChange={setFile} />
            <PlanChoice schemes={schemes} account={account} setAccount={setAccount} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Full name" value={account.name} onChange={(v) => setAccount({ ...account, name: v })} testId="open-name" />
              <Field label="Phone" value={account.phone} onChange={(v) => setAccount({ ...account, phone: v })} testId="open-phone" />
              <Field label="Email (optional)" value={account.email} onChange={(v) => setAccount({ ...account, email: v })} testId="open-email" />
              <Field label="PAN (optional)" value={account.pan_number} onChange={(v) => setAccount({ ...account, pan_number: v.toUpperCase() })} />
              <div>
                <label className="block text-[11px] text-slate-600 mb-1">Login password</label>
                <PasswordGenField testId="open-password" value={account.password}
                  onChange={(v) => setAccount({ ...account, password: v })} />
              </div>
              <Field label="Transaction password" value={account.transaction_password} onChange={(v) => setAccount({ ...account, transaction_password: v })} testId="open-txnpwd" />
              <Field label="Opening deposit" value={String(account.initial_deposit)} onChange={(v) => setAccount({ ...account, initial_deposit: Number(v.replace(/\D/g, '')) || 0 })} />
            </div>
          </div>
        </Modal>
      )}

      {opened && (
        <Modal
          testId="crm-account-opened-modal"
          title="Account opened"
          subtitle="Write these down and give them to the member in person."
          onClose={() => setOpened(null)}
          footer={<button onClick={() => setOpened(null)} data-testid="crm-opened-done"
            className="px-5 py-2 rounded-md bg-[#0b3b8c] text-white text-xs font-semibold">Done</button>}
        >
          <div className="space-y-3">
            <div className="p-3 rounded-md bg-emerald-50 border border-emerald-200">
              <p className="text-[11px] text-emerald-900">User ID for signing in</p>
              <p className="text-xl font-mono font-bold text-emerald-900 tracking-wide"
                data-testid="crm-opened-user-id">{opened.user_id}</p>
              <p className="text-[11px] text-emerald-800 mt-1">
                This is the account number. It is what the member types into the sign-in box, with the
                password you set. Ask them to change that password from Security &amp; Passkeys.
              </p>
            </div>
            <dl className="grid grid-cols-2 gap-2 text-[11px]">
              <div><dt className="text-slate-500">Member</dt><dd className="font-semibold text-slate-900">{opened.user?.name}</dd></div>
              <div><dt className="text-slate-500">KYC</dt><dd className="font-semibold text-slate-900">{opened.kyc_status}</dd></div>
              <div className="col-span-2">
                <dt className="text-slate-500">Plan</dt>
                <dd className="font-semibold text-slate-900" data-testid="crm-opened-plan">
                  {opened.plan ? `${opened.plan.name} (${opened.plan.code})` : 'Not decided yet'}
                </dd>
              </div>
            </dl>
            {opened.deposit && (
              <div className="p-3 rounded-md bg-slate-50 border border-slate-200 text-[11px] space-y-0.5"
                data-testid="crm-opened-deposit">
                <p className="font-semibold text-slate-900">Deposit {opened.deposit.deposit_number} booked</p>
                <p className="text-slate-600">
                  {opened.deposit.by_instalment
                    ? `${inr(opened.deposit.unit)} a month, ${inr(opened.deposit.total_deposit)} in total`
                    : `${inr(opened.deposit.total_deposit)} paid in today`}
                  {opened.deposit.monthly_payout
                    ? ` · ${inr(opened.deposit.monthly_payout)} paid out every month`
                    : ''} · {inr(opened.deposit.maturity_amount)} over {opened.deposit.tenure_months} months
                </p>
                <p className="text-slate-500">Matures {opened.deposit.maturity_date}. Visible to the member under Deposits.</p>
              </div>
            )}
            <p className="text-[11px] text-slate-500">
              The documents you verified now sit on the member's own KYC record, so they will not be
              asked for them again.
            </p>
          </div>
        </Modal>
      )}

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
            <div className="md:col-span-2">
              <label className="block text-[11px] text-slate-600 mb-1">Plan they asked about (optional)</label>
              <select data-testid="crm-lead-scheme" value={form.scheme_code}
                onChange={(e) => setForm({ ...form, scheme_code: e.target.value })}
                className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm text-slate-900 bg-white">
                <option value="">Not named</option>
                {schemes.map((sc) => <option key={sc.code} value={sc.code}>{sc.name} ({sc.code})</option>)}
              </select>
            </div>
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
                    <th className="p-3 font-semibold">Plan</th>
                    <th className="p-3 font-semibold">Documents</th>
                    <th className="p-3 font-semibold">Referral</th>
                    <th className="p-3 font-semibold">Stage</th>
                    <th className="p-3 font-semibold text-right">Move to</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.leads.map((l) => (
                    <tr key={l.id} data-testid={`crm-lead-${l.id}`} className="hover:bg-blue-50/40 transition-colors">
                      <td className="p-3 font-semibold text-slate-900">{l.name}</td>
                      <td className="p-3 text-slate-600">{l.phone}<br /><span className="text-slate-500">{l.email || '—'}</span></td>
                      <td className="p-3 text-slate-600">{l.source}{l.agent_name ? ` · ${l.agent_name}` : ''}</td>
                      <td className="p-3">
                        {/* Where a shared link ends up. Before this column the code
                            went into the notes and nothing could act on it. */}
                        {l.referral_code ? (
                          <div className="flex flex-col gap-0.5">
                            <span className="font-mono text-[11px] text-slate-900">{l.referral_code}</span>
                            <span className={`text-[10px] font-semibold ${
                              l.referral_status === 'paid' ? 'text-emerald-700'
                                : l.referral_status === 'not_paid' ? 'text-[#c8102e]' : 'text-amber-700'}`}>
                              {l.referral_status === 'paid' ? 'bonus paid'
                                : l.referral_status === 'not_paid' ? 'code did not match'
                                : 'pays on enrolment'}
                            </span>
                          </div>
                        ) : <span className="text-slate-500">—</span>}
                      </td>
                      <td className="p-3 text-slate-600">
                        {l.scheme_name
                          ? <span title={l.scheme_code}>{l.scheme_name}</span>
                          : <span className="text-slate-500">{l.interest || '—'}</span>}
                      </td>
                      <td className="p-3">
                        {/* What is actually holding the opening up, without
                            having to open the dialog to find out. */}
                        {Number(l.documents_uploaded) === 0 ? (
                          <span className="text-slate-500">none yet</span>
                        ) : (
                          <span className={Number(l.documents_verified) > 0 ? 'text-emerald-700 font-semibold' : 'text-amber-700 font-semibold'}>
                            {l.documents_verified} of {l.documents_uploaded} verified
                          </span>
                        )}
                      </td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${STAGE_STYLE[l.stage]}`}>{l.stage}</span>
                        {l.lost_reason && <div className="text-[10px] text-slate-500 mt-0.5">{l.lost_reason}</div>}
                      </td>
                      <td className="p-3 text-right whitespace-nowrap">
                        {l.stage !== 'enrolled' && l.stage !== 'lost' && (
                          <button onClick={() => setOpening(l)} data-testid={`crm-open-account-${l.id}`}
                            className="ml-2 text-[11px] font-semibold text-emerald-700 hover:underline">
                            open account
                          </button>
                        )}
                        {['contacted', 'documents', 'enrolled', 'lost']
                          .filter((s) => s !== l.stage && l.stage !== 'enrolled' && l.stage !== 'lost')
                          .map((s) => (
                            <button key={s} onClick={() => advance(l, s)}
                              className="ml-2 text-[11px] text-[#0b3b8c] hover:underline">{s}</button>
                          ))}
                      </td>
                    </tr>
                  ))}
                  {!data.leads.length && <tr><td colSpan={8} className="p-10 text-center text-slate-500">No leads yet.</td></tr>}
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
        <label className="flex items-center gap-1.5 text-xs text-slate-600 py-1.5">
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
