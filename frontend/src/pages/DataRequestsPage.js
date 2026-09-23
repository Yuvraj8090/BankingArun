import React, { useCallback, useEffect, useState } from 'react';
import { FileLock2, RefreshCw, Clock, AlertTriangle } from 'lucide-react';
import { api } from '../services/api';
import { toast } from 'sonner';
import Pagination from '../components/Pagination';
import Modal, { Field, inputClass } from '../components/Modal';

const STATES = [['open', 'Open'], ['actioned', 'Answered'], ['refused', 'Refused']];

const KIND = {
  access: 'Access — a copy of their data',
  correction: 'Correction — something is wrong',
  erasure: 'Erasure — delete what you hold'
};

const date = (v) => (v ? new Date(v).toLocaleDateString('en-IN') : '—');
const daysLeft = (due) => Math.ceil((new Date(due) - new Date()) / 86400000);

// The DPDP Act, 2023 gives a member the right to ask what is held about them and
// to have it corrected or erased. The clock runs whether or not anyone is
// watching, so this queue is ordered by deadline and overdue items are marked.
export default function DataRequestsPage() {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('open');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [answering, setAnswering] = useState(null);

  const load = useCallback(async () => {
    try { setData(await api.privacyQueue({ status, page, per_page: perPage })); }
    catch (e) { toast.error(e.response?.data?.detail || 'Could not load the data requests'); }
  }, [status, page, perPage]);
  useEffect(() => { load(); }, [load]);

  if (!data) {
    return <div className="p-10 flex items-center gap-2 text-slate-600">
      <RefreshCw className="w-4 h-4 animate-spin" /> Loading the data requests…</div>;
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-5">

      <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm flex items-center gap-3">
        <div className="w-10 h-10 rounded-md bg-[#0b3b8c] text-white flex items-center justify-center">
          <FileLock2 className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900">Data Requests</h1>
          <p className="text-xs text-slate-500">
            Rights exercised under the Digital Personal Data Protection Act, 2023 ·
            answer within {data.response_window_days} days
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Kpi label="Waiting" value={data.counts.open} tone={data.counts.open ? 'warn' : 'ok'} />
        <Kpi label="Overdue" value={data.counts.overdue} tone={data.counts.overdue ? 'bad' : 'ok'} />
        <Kpi label="Answered" value={data.counts.actioned} />
      </div>

      {data.counts.overdue > 0 && (
        <div className="p-3 rounded-md bg-rose-50 border border-rose-200 text-[11px] text-[#c8102e] flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            <strong>{data.counts.overdue} request{data.counts.overdue === 1 ? ' is' : 's are'} past the
            {' '}{data.response_window_days}-day deadline.</strong> A member may complain to the Data
            Protection Board about a request that was never answered.
          </span>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
        <div className="p-4 border-b border-slate-100 flex flex-wrap items-center gap-2">
          <select data-testid="privacy-status" value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1); }} className={`${inputClass} w-auto`}>
            {STATES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase text-slate-600">
              <tr>
                <th className="p-3 font-semibold">Reference</th>
                <th className="p-3 font-semibold">Member</th>
                <th className="p-3 font-semibold">What they asked for</th>
                <th className="p-3 font-semibold">Raised</th>
                <th className="p-3 font-semibold">Due</th>
                <th className="p-3 font-semibold text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.requests.map((r) => {
                const left = daysLeft(r.due_by);
                const late = r.status === 'open' && left < 0;
                return (
                  <tr key={r.id} data-testid={`request-row-${r.reference}`} className="hover:bg-blue-50/40 transition-colors">
                    <td className="p-3 font-mono font-semibold text-slate-900 whitespace-nowrap">{r.reference}</td>
                    <td className="p-3">
                      <div className="font-semibold text-slate-900">{r.name}</div>
                      <div className="text-[11px] text-slate-500">{r.email}</div>
                    </td>
                    <td className="p-3 text-slate-700">
                      {KIND[r.kind] || r.kind}
                      {r.detail && <span className="block text-[11px] text-slate-500 mt-0.5 line-clamp-2">{r.detail}</span>}
                    </td>
                    <td className="p-3 text-slate-600 whitespace-nowrap">{date(r.created_at)}</td>
                    <td className="p-3 whitespace-nowrap">
                      <span className={`inline-flex items-center gap-1 font-semibold ${
                        late ? 'text-[#c8102e]' : left <= 5 && r.status === 'open' ? 'text-amber-700' : 'text-slate-600'}`}>
                        <Clock className="w-3 h-3" />
                        {date(r.due_by)}
                      </span>
                      {r.status === 'open' && (
                        <span className={`block text-[10px] mt-0.5 ${late ? 'text-[#c8102e] font-semibold' : 'text-slate-500'}`}>
                          {late ? `${Math.abs(left)} day${Math.abs(left) === 1 ? '' : 's'} overdue` : `${left} day${left === 1 ? '' : 's'} left`}
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-right">
                      {r.status === 'open' ? (
                        <button data-testid={`request-answer-${r.reference}`} onClick={() => setAnswering(r)}
                          className="text-[#0b3b8c] font-semibold hover:underline">Answer</button>
                      ) : (
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                          r.status === 'actioned'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-slate-100 text-slate-600 border-slate-200'}`}>{r.status}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!data.requests.length && (
                <tr><td colSpan={6} className="p-8 text-center text-slate-500">
                  {status === 'open' ? 'Nothing waiting. Every request has been answered.' : `No ${status} requests.`}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination meta={data.pagination} onPage={setPage} onPerPage={(n) => { setPerPage(n); setPage(1); }} />
      </div>

      {answering && <AnswerModal request={answering} onClose={() => setAnswering(null)}
        onDone={() => { setAnswering(null); load(); }} />}
    </div>
  );
}

function AnswerModal({ request, onClose, onDone }) {
  const [status, setStatus] = useState('actioned');
  const [response, setResponse] = useState('');
  const [busy, setBusy] = useState(false);
  const tooShort = response.trim().length < 10;

  const save = async () => {
    setBusy(true);
    try {
      toast.success((await api.privacyRespond({ reference: request.reference, status, response })).message || 'Answered');
      onDone();
    } catch (e) { toast.error(e.response?.data?.detail || 'Could not record that answer'); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      testId="answer-modal"
      title={`Answer ${request.reference}`}
      subtitle={`${request.name} asked for: ${KIND[request.kind] || request.kind}`}
      onClose={onClose}
      footer={<>
        <button onClick={onClose} className="px-4 py-2 rounded-md border border-slate-200 text-xs font-semibold text-slate-700">Cancel</button>
        <button data-testid="answer-save" disabled={busy || tooShort} onClick={save}
          className="px-4 py-2 rounded-md bg-[#0b3b8c] text-white text-xs font-semibold disabled:opacity-50">
          {busy ? 'Saving…' : 'Send the answer'}
        </button>
      </>}
    >
      {request.detail && (
        <div className="p-3 rounded-md bg-slate-50 border border-slate-200 text-[11px] text-slate-700">
          <span className="block text-[10px] uppercase tracking-wide text-slate-500 mb-1">In their words</span>
          {request.detail}
        </div>
      )}
      <Field label="Outcome">
        <select data-testid="answer-status" className={inputClass} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="actioned">Done — the request has been carried out</option>
          <option value="refused">Refused — it cannot be carried out</option>
        </select>
      </Field>
      <Field
        label={status === 'refused' ? 'Why it was refused' : 'What you did'}
        hint="The member is told this, word for word. Refusing without a reason is the failure the Act is written against."
      >
        <textarea data-testid="answer-response" rows={5} className={inputClass} value={response}
          onChange={(e) => setResponse(e.target.value)}
          placeholder={status === 'refused'
            ? 'We must keep transaction records for eight years under the PMLA, so this data cannot be erased while your deposit is open.'
            : 'A copy of everything held about you has been emailed to the address on your folio.'} />
      </Field>
      {status === 'refused' && (
        <div className="p-3 rounded-md bg-amber-50 border border-amber-200 text-[11px] text-amber-800">
          Erasure may be refused where another law requires the record to be kept — but the specific
          law has to be named, not merely referred to.
        </div>
      )}
      {tooShort && response.length > 0 && <p className="text-[11px] text-amber-700">Write at least a full sentence.</p>}
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
