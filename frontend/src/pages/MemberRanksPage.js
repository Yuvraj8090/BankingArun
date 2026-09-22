import React, { useEffect, useState } from 'react';
import { Award, RefreshCw, Search, Info } from 'lucide-react';
import { api } from '../services/api';
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

export default function MemberRanksPage() {
  const [data, setData] = useState(null);
  const [query, setQuery] = useState('');

  const load = async () => {
    try { setData(await api.memberRanks()); }
    catch (e) { toast.error(e.response?.data?.detail || 'Could not load member standings'); }
  };
  useEffect(() => { load(); }, []);

  if (!data) {
    return <div className="p-10 flex items-center gap-2 text-slate-600">
      <RefreshCw className="w-4 h-4 animate-spin" /> Loading member standings…
    </div>;
  }

  const q = query.trim().toLowerCase();
  const shown = q
    ? data.members.filter((m) => [m.name, m.email, m.phone, m.rank]
        .some((v) => (v || '').toLowerCase().includes(q)))
    : data.members;
  const ranked = data.members.filter((m) => m.rank_level > 0).length;

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
              {ranked} of {data.members.length} members hold a standing
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
          {data.ladder.map((name, i) => (
            <div key={name} className={`px-3 py-1.5 rounded-lg border text-[11px] font-semibold ${RANK_STYLE[name] || 'bg-slate-100 text-slate-700 border-slate-300'}`}>
              {name}
              <span className="block text-[10px] font-normal opacity-80">
                {i === 0
                  ? `${data.width} members introduced`
                  : `${data.width} × ${data.ladder[i - 1]}`}
              </span>
              <span className="block text-[10px] font-normal opacity-70">
                {data.by_rank[name]} {data.by_rank[name] === 1 ? 'member' : 'members'}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
        <div className="p-3 border-b border-slate-100">
          <div className="flex items-center gap-2 border border-slate-200 rounded-md px-3 h-9 bg-slate-50 max-w-sm">
            <Search className="w-4 h-4 text-slate-500" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} data-testid="ranks-search"
              placeholder="Find a member by name, phone or standing"
              className="flex-1 bg-transparent text-xs outline-none" />
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
                <tr key={m.id} data-testid={`rank-row-${m.id}`} className="hover:bg-slate-50">
                  <td className="p-3">
                    <div className="font-semibold text-slate-900">{m.name}</div>
                    <div className="text-[11px] text-slate-500">{m.phone}{m.email ? ` · ${m.email}` : ''}</div>
                  </td>
                  <td className="p-3">
                    {m.rank ? (
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${RANK_STYLE[m.rank]}`}>
                        {m.rank}
                      </span>
                    ) : <span className="text-slate-400">—</span>}
                  </td>
                  <td className="p-3 text-right tabular-nums text-slate-700">{m.introduced}</td>
                  <td className="p-3 text-slate-600">
                    {m.next_rank
                      ? <>{m.next_rank} — needs {data.width} × {m.rank || 'introduced member'}</>
                      : <span className="text-slate-400">top of the ladder</span>}
                  </td>
                </tr>
              ))}
              {!shown.length && (
                <tr><td colSpan={4} className="p-10 text-center text-slate-500">
                  {data.members.length ? 'No member matches that search.' : 'No members yet.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
