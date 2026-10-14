import React, { useCallback, useEffect, useState } from 'react';
import { Award, RefreshCw, Search, Info, Plus, Pencil, Trash2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import Modal from '../components/Modal';
import Pagination from '../components/Pagination';
import { api } from '../services/api';
import { inr } from '../utils/format';
import { toast } from 'sonner';

// The colour carries no meaning beyond making the ladder readable at a glance;
// the rank name is always present, so nothing depends on distinguishing them.
const RANK_STYLE = {
  'Silver': 'bg-slate-100 text-slate-700 border-slate-300',
  'Gold': 'bg-amber-50 text-amber-800 border-amber-300',
  'Platinum': 'bg-zinc-100 text-zinc-800 border-zinc-400',
  'Diamond': 'bg-sky-50 text-sky-800 border-sky-300',
  'Ruby': 'bg-rose-50 text-rose-800 border-rose-300',
  'Blue Diamond': 'bg-blue-50 text-blue-800 border-blue-300',
  'Emerald': 'bg-emerald-50 text-emerald-800 border-emerald-300',
  'Ambassador': 'bg-violet-50 text-violet-800 border-violet-300',
  'Brand Ambassador': 'bg-[#0b3b8c] text-white border-[#0b3b8c]',
};

const nextNeeds = (tiers, level) =>
  (tiers || []).find((t) => t.position === level + 1)?.direct_required ?? 2;

const rankName = (tiers, position) =>
  (tiers || []).find((t) => t.position === position)?.name || `rank ${position}`;


const blankTier = (programme, position) => ({
  programme, position, name: '', direct_required: 2, required_below: 0,
  min_deposit_each: '',
  reward_label: '', notes: '', status: 'active',
});

const LADDER_COPY = {
  standing: {
    title: 'Ranks',
    description: 'Add a rank, change what it takes, or write the recognition it brings. No money is attached to a rank.',
    add: 'Add a rank',
    edit: 'Edit',
    modal: 'Add a rank',
    save: 'Save rank',
    worth: 'Recognition this rank brings',
    rewardHead: 'Recognition',
    any: 'Any member',
  },

};

// The ladder, editable. Every rung was a line in a PHP constant until recently,
// so adding Crown Ambassador or making Gold harder to reach meant a developer
// and a deploy. The director does it here.
function LadderEditor({ programme = 'standing', onChanged }) {
  const copy = LADDER_COPY[programme] || LADDER_COPY.standing;
  const [tiers, setTiers] = useState(null);
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.rankTiers({ programme });
      setTiers(r.tiers);
      setNotice(r.notice);
    } catch (e) { toast.error(e.response?.data?.detail || 'Could not load the ladder'); }
  }, [programme]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const body = {
        ...editing,
        programme,
        position: Number(editing.position),
        direct_required: Number(editing.direct_required),
        required_below: Number(editing.required_below),
        min_deposit_each: editing.min_deposit_each === '' ? '' : Number(editing.min_deposit_each),
        // Sent as an empty string rather than 0 so "no figure" stays no figure.
      };
      const r = editing.id
        ? await api.rankTierUpdate(editing.id, body)
        : await api.rankTierCreate(body);
      toast.success(r.message);
      setEditing(null);
      await load();
      onChanged?.();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Could not save this rank');
    } finally { setSaving(false); }
  };

  const remove = async (tier) => {
    if (!window.confirm(`Remove ${tier.name}? It goes to the recycle bin and can be restored.`)) return;
    try {
      toast.success((await api.rankTierDelete(tier.id)).message);
      await load();
      onChanged?.();
    } catch (e) { toast.error(e.response?.data?.detail || 'Could not remove this rank'); }
  };

  if (!tiers) return null;
  const below = [{ position: 0, name: copy.any }, ...tiers];

  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm" data-testid={`${programme}-ladder-editor`}>
      <div className="p-4 border-b border-slate-100 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">{copy.title}</h2>
          <p className="text-[11px] text-slate-500">{copy.description}</p>
        </div>
        <button data-testid={`${programme}-rank-add`} onClick={() => setEditing(blankTier(programme, tiers.length + 1))}
          className="px-3 py-2 rounded-md bg-[#0b3b8c] text-white text-xs font-semibold flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5" /> {copy.add}
        </button>
      </div>

      {notice && (
        <p className="m-4 p-3 rounded-md bg-amber-50 border border-amber-200 text-[11px] text-amber-900"
          data-testid="rank-pay-notice">{notice}</p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase text-slate-600">
            <tr>
              <th className="p-3 font-semibold">#</th>
              <th className="p-3 font-semibold">Rank</th>
              <th className="p-3 font-semibold">To reach it</th>
              <th className="p-3 font-semibold">{copy.rewardHead}</th>
              <th className="p-3 font-semibold">Status</th>
              <th className="p-3 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {tiers.map((t) => (
              <tr key={t.id} data-testid={`rank-tier-${t.position}`} className="hover:bg-slate-50">
                <td className="p-3 tabular-nums text-slate-500">{t.position}</td>
                <td className="p-3 font-semibold text-slate-900">{t.name}</td>
                <td className="p-3 text-slate-600">
                  {t.direct_required} {t.direct_required === 1 ? 'member' : 'members'} introduced
                  {t.required_below > 0 && <>, each already {rankName(tiers, t.required_below)}</>}
                  {t.min_deposit_each && (
                    <span className="block text-[10px] text-slate-500">
                      each holding {inr(t.min_deposit_each)} on deposit
                    </span>
                  )}
                </td>
                <td className="p-3 text-slate-600">
                  {t.reward_label || <span className="text-slate-400">—</span>}
                </td>
                <td className="p-3">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                    t.status === 'active'
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-slate-100 text-slate-600 border-slate-300'}`}>{t.status}</span>
                </td>
                <td className="p-3 text-right whitespace-nowrap">
                  <button data-testid={`${programme}-rank-edit-${t.position}`}
                    onClick={() => setEditing({ ...t, min_deposit_each: t.min_deposit_each ?? '' })}
                    className="text-[11px] font-semibold text-[#0b3b8c] hover:underline inline-flex items-center gap-1">
                    <Pencil className="w-3 h-3" /> edit
                  </button>
                  <button data-testid={`${programme}-rank-delete-${t.position}`} onClick={() => remove(t)}
                    className="ml-3 text-[11px] font-semibold text-[#c8102e] hover:underline inline-flex items-center gap-1">
                    <Trash2 className="w-3 h-3" /> remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <Modal
          testId={`${programme}-rank-modal`}
          title={editing.id ? `${copy.edit} ${editing.name}` : copy.modal}
          subtitle="Position 1 is the entry rank. A rank may only require standings below its own."
          onClose={() => setEditing(null)}
          footer={<>
            <button onClick={() => setEditing(null)}
              className="px-4 py-2 rounded-md border border-slate-200 text-xs font-semibold text-slate-700">Cancel</button>
            <button data-testid={`${programme}-rank-save`} onClick={save} disabled={saving || !editing.name}
              className="px-5 py-2 rounded-md bg-[#0b3b8c] text-white text-xs font-semibold disabled:opacity-50">
              {saving ? 'Saving…' : copy.save}
            </button>
          </>}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-[11px] text-slate-600 mb-1">Position</span>
              <input type="number" min="1" data-testid="rank-position" value={editing.position}
                onChange={(e) => setEditing({ ...editing, position: e.target.value })}
                className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm" />
            </label>
            <label className="block">
              <span className="block text-[11px] text-slate-600 mb-1">Name</span>
              <input data-testid="rank-name" value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm" />
            </label>
            <label className="block">
              <span className="block text-[11px] text-slate-600 mb-1">Members to introduce</span>
              <input type="number" min="1" data-testid="rank-direct" value={editing.direct_required}
                onChange={(e) => setEditing({ ...editing, direct_required: e.target.value })}
                className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm" />
            </label>
            <label className="block">
              <span className="block text-[11px] text-slate-600 mb-1">Each of them must already be</span>
              <select data-testid="rank-below" value={editing.required_below}
                onChange={(e) => setEditing({ ...editing, required_below: e.target.value })}
                className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm bg-white">
                {below
                  .filter((b) => b.position < Number(editing.position || 1))
                  .map((b) => <option key={b.position} value={b.position}>{b.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="block text-[11px] text-slate-600 mb-1">Minimum deposit each introduced member holds</span>
              <input type="number" min="0" data-testid={`${programme}-rank-min-deposit`} value={editing.min_deposit_each ?? ''}
                onChange={(e) => setEditing({ ...editing, min_deposit_each: e.target.value })}
                className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm" />
            </label>
            <label className="block md:col-span-2">
              <span className="block text-[11px] text-slate-600 mb-1">{copy.worth}</span>
              <input data-testid="rank-reward" value={editing.reward_label ?? ''}
                placeholder="e.g. Recognised at the annual meet"
                onChange={(e) => setEditing({ ...editing, reward_label: e.target.value })}
                className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm" />
            </label>
            <label className="block">
              <span className="block text-[11px] text-slate-600 mb-1">Status</span>
              <select data-testid="rank-status" value={editing.status}
                onChange={(e) => setEditing({ ...editing, status: e.target.value })}
                className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm bg-white">
                <option value="active">active</option>
                <option value="draft">draft — off the ladder, nobody can hold it</option>
              </select>
            </label>
          </div>
          <p className="mt-3 p-2.5 rounded-md bg-slate-50 border border-slate-200 text-[11px] text-slate-600">
            The reward is shown to members and at the counter so both quote the same thing. This
            system never pays it: the Nidhi Rules, 2014 do not permit brokerage or incentive for
            bringing in deposits.
          </p>
        </Modal>
      )}
    </div>
  );
}

export default function MemberRanksPage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'bank_owner';
  const [data, setData] = useState(null);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);

  // Ranking every member needs their whole referral chain, so the backend
  // cannot answer this with a plain SQL LIMIT -- it still does the ranking
  // in full, but only ships one page of the result (modules/master.php).
  const load = useCallback(async () => {
    try { setData(await api.memberRanks({ q: query.trim() || undefined, page, per_page: perPage })); }
    catch (e) { toast.error(e.response?.data?.detail || 'Could not load member standings'); }
  }, [query, page, perPage]);
  useEffect(() => { const t = setTimeout(load, query ? 300 : 0); return () => clearTimeout(t); }, [load, query]);
  // A search that changes the result set belongs back on page 1, not wherever
  // the previous search or listing happened to be scrolled to.
  useEffect(() => { setPage(1); }, [query]);

  if (!data) {
    return <div className="p-10 flex items-center gap-2 text-slate-600">
      <RefreshCw className="w-4 h-4 animate-spin" /> Loading member standings…
    </div>;
  }

  const shown = data.members;
  const ranked = data.total_members - data.unranked;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-md bg-[#0b3b8c] text-white flex items-center justify-center">
            <Award className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Member Standings</h1>
            <p className="text-xs text-slate-500">
              {ranked} of {data.total_members} members hold a standing
            </p>
          </div>
        </div>
        <button onClick={load} data-testid="ranks-refresh"
          className="px-3 py-2 rounded-md border border-slate-200 text-xs text-slate-700 hover:border-[#0b3b8c] hover:text-[#0b3b8c] flex items-center gap-1.5 transition">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      <div className="flex items-start gap-2 p-3 rounded-md bg-amber-50 border border-amber-200 text-[11px] text-amber-900">
        <Info className="w-4 h-4 shrink-0 mt-0.5" />
        <p className="leading-relaxed">{data.note}</p>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-5">
        <h2 className="text-sm font-semibold text-slate-900 mb-3">The ladder</h2>
        <div className="flex flex-wrap gap-2">
          {(data.tiers || []).map((t) => (
            <div key={t.position} data-testid={`ladder-${t.position}`}
              className={`px-3 py-1.5 rounded-lg border text-[11px] font-semibold ${RANK_STYLE[t.name] || 'bg-slate-100 text-slate-700 border-slate-300'}`}>
              {t.name}
              {/* Each rung states its own rule now: they no longer share one width. */}
              <span className="block text-[10px] font-normal opacity-80">
                {t.required_below === 0
                  ? `${t.direct_required} members introduced`
                  : `${t.direct_required} × ${rankName(data.tiers, t.required_below)}`}
              </span>
              <span className="block text-[10px] font-normal opacity-70">
                {data.by_rank[t.name] ?? 0} {(data.by_rank[t.name] ?? 0) === 1 ? 'member' : 'members'}
              </span>
              {t.reward_label && (
                <span className="block text-[10px] font-normal opacity-70">{t.reward_label}</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {canEdit && (
        <div className="space-y-6">
          <LadderEditor programme="standing" onChanged={load} />
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
        <div className="p-3 border-b border-slate-100">
          <div className="flex items-center gap-2 border border-slate-200 rounded-md px-3 h-9 bg-slate-50 max-w-sm">
            <Search className="w-4 h-4 text-slate-500" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} data-testid="ranks-search"
              placeholder="Find a member by name, phone or standing"
              className="flex-1 bg-transparent text-xs outline-none py-1.5" />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase text-slate-600">
              <tr>
                <th className="p-3 font-semibold">Member</th>
                <th className="p-3 font-semibold">Standing</th>
                <th className="p-3 font-semibold text-right">Introduced</th>
                <th className="p-3 font-semibold">Next standing</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((m) => (
                <tr key={m.id} data-testid={`rank-row-${m.id}`} className="hover:bg-blue-50/40 transition-colors">
                  <td className="p-3">
                    <div className="font-semibold text-slate-900">{m.name}</div>
                    <div className="text-[11px] text-slate-500">{m.phone}{m.email ? ` · ${m.email}` : ''}</div>
                  </td>
                  <td className="p-3">
                    {m.rank ? (
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${RANK_STYLE[m.rank]}`}>
                        {m.rank}
                      </span>
                    ) : <span className="text-slate-500">—</span>}
                  </td>
                  <td className="p-3 text-right tabular-nums text-slate-700">{m.introduced}</td>
                  <td className="p-3 text-slate-600">
                    {/* The next rung's own requirement, not a shared width. */}
                    {m.next_rank
                      ? <>{m.next_rank} — needs {nextNeeds(data.tiers, m.rank_level)} ×{' '}
                        {m.rank || 'introduced member'}</>
                      : <span className="text-slate-500">top of the ladder</span>}
                  </td>
                </tr>
              ))}
              {!shown.length && (
                <tr><td colSpan={4} className="p-10 text-center text-slate-500">
                  {data.total_members ? 'No member matches that search.' : 'No members yet.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination meta={data.pagination} onPage={setPage} onPerPage={(n) => { setPerPage(n); setPage(1); }} />
      </div>
    </div>
  );
}
