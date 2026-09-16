import React, { useCallback, useEffect, useState } from 'react';
import { ShieldAlert, RefreshCw, Play, Plus, Search, Scale, ListChecks } from 'lucide-react';
import { api } from '../services/api';
import { toast } from 'sonner';
import Pagination from '../components/Pagination';
import Modal, { Field, inputClass } from '../components/Modal';

const TABS = [['hits', 'Matches to review'], ['watchlist', 'Watchlist']];
const HIT_STATES = [['open', 'Open'], ['cleared', 'Cleared'], ['confirmed', 'Confirmed']];

const when = (v) => (v ? new Date(v).toLocaleString('en-IN') : '—');

// Sanctions and PEP screening. Clearing a genuine match and confirming a false
// one are the two ways this goes wrong, so every decision carries a written
// reason and the record is kept whichever way it goes.
export default function ScreeningPage() {
  const [tab, setTab] = useState('hits');
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-5">
      <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm flex items-center gap-3">
        <div className="w-10 h-10 rounded-md bg-[#0b3b8c] text-white flex items-center justify-center">
          <ShieldAlert className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900">Sanctions &amp; PEP Screening</h1>
          <p className="text-xs text-slate-500">
            Members and leads checked against the loaded lists · PMLA, 2002 and the RBI KYC Master Direction
          </p>
        </div>
      </div>

      <div className="flex gap-1 border-b border-slate-200">
        {TABS.map(([id, label]) => (
          <button key={id} data-testid={`screening-tab-${id}`} onClick={() => setTab(id)}
            className={`px-4 py-2 text-xs font-semibold border-b-2 -mb-px ${
              tab === id ? 'border-[#0b3b8c] text-[#0b3b8c]' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'hits' ? <Hits /> : <Watchlist />}
    </div>
  );
}

function Hits() {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('open');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [reviewing, setReviewing] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setData(await api.screeningHits({ status, page, per_page: perPage })); }
    catch (e) { toast.error(e.response?.data?.detail || 'Could not load the screening matches'); }
  }, [status, page, perPage]);
  useEffect(() => { load(); }, [load]);

  const run = async (fn, label) => {
    setBusy(true);
    try { toast.success((await fn()).message || `${label} finished`); load(); }
    catch (e) { toast.error(e.response?.data?.detail || `${label} failed`); }
    finally { setBusy(false); }
  };

  if (!data) return <Loading what="screening matches" />;

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Open" value={data.counts.open} tone={data.counts.open ? 'bad' : 'ok'} />
        <Kpi label="Cleared" value={data.counts.cleared} />
        <Kpi label="Confirmed" value={data.counts.confirmed} tone={data.counts.confirmed ? 'bad' : undefined} />
        <Kpi label="Match threshold" value={`${data.threshold}%`} />
      </div>

      <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
        <div className="p-4 border-b border-slate-100 flex flex-wrap items-center gap-2">
          <select data-testid="hits-status" value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1); }} className={`${inputClass} w-auto`}>
            {HIT_STATES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <div className="flex-1" />
          <button data-testid="screening-rerate" disabled={busy}
            onClick={() => run(api.screeningRerate, 'Re-rating')}
            className="px-3 py-2 rounded-md border border-slate-200 text-xs font-semibold text-slate-700 flex items-center gap-1.5 disabled:opacity-50">
            <Scale className="w-3.5 h-3.5" /> Re-rate risk
          </button>
          <button data-testid="screening-run" disabled={busy}
            onClick={() => run(api.screeningRun, 'Screening')}
            className="px-3 py-2 rounded-md bg-[#0b3b8c] text-white text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50">
            <Play className="w-3.5 h-3.5" /> Screen everyone now
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase text-slate-600">
              <tr>
                <th className="p-3 font-semibold">Who</th>
                <th className="p-3 font-semibold">Matched name</th>
                <th className="p-3 font-semibold">List</th>
                <th className="p-3 font-semibold text-right">Score</th>
                <th className="p-3 font-semibold">Raised</th>
                <th className="p-3 font-semibold">Decision</th>
                <th className="p-3 font-semibold text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.hits.map((h) => (
                <tr key={h.id} data-testid={`hit-row-${h.id}`} className="hover:bg-slate-50">
                  <td className="p-3">
                    <div className="font-semibold text-slate-900">{h.member_name || h.screened_name}</div>
                    <div className="text-[11px] text-slate-500">{h.member_email || 'Lead, not yet a member'}</div>
                  </td>
                  <td className="p-3 text-slate-800">{h.matched_name}</td>
                  <td className="p-3">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold border bg-slate-100 text-slate-700 border-slate-200">
                      {h.list_name}
                    </span>
                  </td>
                  <td className={`p-3 text-right font-bold tabular-nums ${h.score >= 90 ? 'text-[#c8102e]' : 'text-amber-700'}`}>
                    {h.score}
                  </td>
                  <td className="p-3 text-slate-500 whitespace-nowrap">{when(h.created_at)}</td>
                  <td className="p-3 text-slate-600 max-w-[240px]">
                    {h.note ? <span className="line-clamp-2">{h.note}</span> : '—'}
                    {h.reviewed_at && <span className="block text-[10px] text-slate-500 mt-0.5">{when(h.reviewed_at)}</span>}
                  </td>
                  <td className="p-3 text-right">
                    {h.status === 'open' ? (
                      <button data-testid={`hit-review-${h.id}`} onClick={() => setReviewing(h)}
                        className="text-[#0b3b8c] font-semibold hover:underline">Review</button>
                    ) : (
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                        h.status === 'cleared'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-rose-50 text-[#c8102e] border-rose-200'}`}>{h.status}</span>
                    )}
                  </td>
                </tr>
              ))}
              {!data.hits.length && (
                <tr><td colSpan={7} className="p-8 text-center text-slate-500">
                  {status === 'open'
                    ? 'No matches waiting. Run a screening after loading or updating the lists.'
                    : `No ${status} matches.`}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination meta={data.pagination} onPage={setPage} onPerPage={(n) => { setPerPage(n); setPage(1); }} />
      </div>

      {reviewing && <ReviewModal hit={reviewing} onClose={() => setReviewing(null)}
        onDone={() => { setReviewing(null); load(); }} />}
    </>
  );
}

function ReviewModal({ hit, onClose, onDone }) {
  const [action, setAction] = useState('clear');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const tooShort = note.trim().length < 8;

  const save = async () => {
    setBusy(true);
    try {
      toast.success((await api.screeningAction({ hit_id: hit.id, action, note })).message || 'Decision recorded');
      onDone();
    } catch (e) { toast.error(e.response?.data?.detail || 'Could not record that decision'); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      testId="hit-review-modal"
      title="Review a screening match"
      subtitle={`${hit.member_name || hit.screened_name} matched ${hit.matched_name} on ${hit.list_name} at ${hit.score}%`}
      onClose={onClose}
      footer={<>
        <button onClick={onClose} className="px-4 py-2 rounded-md border border-slate-200 text-xs font-semibold text-slate-700">Cancel</button>
        <button data-testid="hit-review-save" disabled={busy || tooShort} onClick={save}
          className={`px-4 py-2 rounded-md text-white text-xs font-semibold disabled:opacity-50 ${
            action === 'confirm' ? 'bg-[#c8102e]' : 'bg-[#0b3b8c]'}`}>
          {busy ? 'Recording…' : action === 'clear' ? 'Clear this match' : 'Confirm the match'}
        </button>
      </>}
    >
      <Field label="Decision">
        <select data-testid="hit-action" className={inputClass} value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="clear">Not the same person — clear it</option>
          <option value="confirm">Same person — confirm the match</option>
        </select>
      </Field>
      <Field
        label="Why"
        hint="Both outcomes need a reason. It is the evidence that this match was actually considered."
      >
        <textarea data-testid="hit-note" rows={4} className={inputClass} value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Date of birth and PAN differ from the listed individual; passport checked against the entry." />
      </Field>
      {action === 'confirm' && (
        <div className="p-3 rounded-md bg-rose-50 border border-rose-200 text-[11px] text-[#c8102e]">
          Confirming marks this member as a sanctions match. Do not tell the member that a report
          has been or may be made — tipping off is an offence under section 13 of the PMLA, 2002.
        </div>
      )}
      {tooShort && note.length > 0 && (
        <p className="text-[11px] text-amber-700">Write a full sentence — at least eight characters.</p>
      )}
    </Modal>
  );
}

function Watchlist() {
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [list, setList] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try { setData(await api.watchlist({ q: q || undefined, list_name: list || undefined, page, per_page: perPage })); }
    catch (e) { toast.error(e.response?.data?.detail || 'Could not load the watchlist'); }
  }, [q, list, page, perPage]);
  useEffect(() => { const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t); }, [load, q]);

  if (!data) return <Loading what="watchlist" />;

  return (
    <>
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
        <div className="p-4 border-b border-slate-100 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input data-testid="watchlist-search" value={q}
              onChange={(e) => { setQ(e.target.value); setPage(1); }}
              placeholder="Search names and aliases" className={`${inputClass} pl-8`} />
          </div>
          <select data-testid="watchlist-filter" value={list}
            onChange={(e) => { setList(e.target.value); setPage(1); }} className={`${inputClass} w-auto`}>
            <option value="">All lists</option>
            {data.lists.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <button data-testid="watchlist-add-btn" onClick={() => setAdding(true)}
            className="px-3 py-2 rounded-md bg-[#0b3b8c] text-white text-xs font-semibold flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" /> Add names
          </button>
        </div>

        {data.total === 0 && (
          <div className="m-4 p-3 rounded-md bg-amber-50 border border-amber-200 text-[11px] text-amber-800 flex items-start gap-2">
            <ListChecks className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            The watchlist is empty, so screening cannot run. Load the UNSC and MHA designated lists,
            and your own internal names, before admitting members.
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase text-slate-600">
              <tr>
                <th className="p-3 font-semibold">List</th>
                <th className="p-3 font-semibold">Name</th>
                <th className="p-3 font-semibold">Also known as</th>
                <th className="p-3 font-semibold">Country</th>
                <th className="p-3 font-semibold">Reference</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.entries.map((e) => (
                <tr key={e.id} className="hover:bg-slate-50">
                  <td className="p-3">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold border bg-slate-100 text-slate-700 border-slate-200">
                      {e.list_name}
                    </span>
                  </td>
                  <td className="p-3 font-semibold text-slate-900">{e.full_name}</td>
                  <td className="p-3 text-slate-600">{e.aliases || '—'}</td>
                  <td className="p-3 text-slate-600">{e.country || '—'}</td>
                  <td className="p-3 text-slate-500 font-mono text-[11px]">{e.reference || '—'}</td>
                </tr>
              ))}
              {!data.entries.length && (
                <tr><td colSpan={5} className="p-8 text-center text-slate-500">No names on the list yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination meta={data.pagination} onPage={setPage} onPerPage={(n) => { setPerPage(n); setPage(1); }} />
      </div>

      {adding && <WatchlistModal lists={data.lists} onClose={() => setAdding(false)}
        onDone={() => { setAdding(false); load(); }} />}
    </>
  );
}

function WatchlistModal({ lists, onClose, onDone }) {
  const [listName, setListName] = useState(lists[0] || 'INTERNAL');
  const [names, setNames] = useState('');
  const [busy, setBusy] = useState(false);
  // One name per line, so a published list can be pasted in whole.
  const parsed = names.split('\n').map((n) => n.trim()).filter(Boolean);

  const save = async () => {
    setBusy(true);
    try {
      const r = await api.watchlistAdd({ entries: parsed.map((full_name) => ({ full_name, list_name: listName })) });
      toast.success(r.message || `${r.added ?? parsed.length} name(s) added`);
      onDone();
    } catch (e) { toast.error(e.response?.data?.detail || 'Could not add those names'); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      testId="watchlist-modal"
      title="Add names to the watchlist"
      subtitle="Paste a published list, one name per line. Names already on the list are skipped."
      onClose={onClose}
      wide
      footer={<>
        <button onClick={onClose} className="px-4 py-2 rounded-md border border-slate-200 text-xs font-semibold text-slate-700">Cancel</button>
        <button data-testid="watchlist-save" disabled={busy || !parsed.length} onClick={save}
          className="px-4 py-2 rounded-md bg-[#0b3b8c] text-white text-xs font-semibold disabled:opacity-50">
          {busy ? 'Adding…' : `Add ${parsed.length || ''} name${parsed.length === 1 ? '' : 's'}`}
        </button>
      </>}
    >
      <Field label="Which list">
        <select data-testid="watchlist-list" className={inputClass} value={listName}
          onChange={(e) => setListName(e.target.value)}>
          {lists.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      </Field>
      <Field label="Names" hint={`${parsed.length} name${parsed.length === 1 ? '' : 's'} ready · at most 5,000 at a time`}>
        <textarea data-testid="watchlist-names" rows={10} className={`${inputClass} font-mono`} value={names}
          onChange={(e) => setNames(e.target.value)}
          placeholder={'One full name per line'} />
      </Field>
    </Modal>
  );
}

function Loading({ what }) {
  return <div className="p-10 flex items-center gap-2 text-slate-600">
    <RefreshCw className="w-4 h-4 animate-spin" /> Loading the {what}…</div>;
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
