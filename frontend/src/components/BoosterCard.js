import React from 'react';
import { ArrowRight, Zap } from 'lucide-react';
import { inr } from '../utils/format';

// Shared by the standing page and Refer & Earn. The member asks the same
// question in both places -- what am I on, and what gets me to the next one --
// so the answer had better not be two different components drifting apart.
function BoosterCard({ booster }) {
  if (!booster?.enabled) return null;
  const next = booster.next;
  const pct = next ? Math.min(100, Math.round((next.qualifying_now / next.needs) * 100)) : 100;

  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden"
      data-testid="booster-card">
      <div className="px-5 sm:px-6 py-5">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
          <Zap className="w-3.5 h-3.5 text-amber-500" /> Booster
        </div>
        <p className="text-xl font-bold text-slate-900 mt-1" data-testid="booster-level">
          {booster.name || 'Not yet on the booster ladder'}
        </p>
        {booster.reward_label && (
          <p className="text-xs text-amber-800 font-semibold mt-1">{booster.reward_label}</p>
        )}
      </div>

      {next && (
        <div className="px-5 sm:px-6 py-5 border-t bg-amber-50 border-amber-100">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-amber-800 font-semibold">
            Next <ArrowRight className="w-3 h-3" /> {next.name}
          </div>
          <p className="text-sm font-semibold text-slate-900 mt-1.5 leading-snug" data-testid="booster-next">
            {next.how}
          </p>
          {next.reward_label && (
            <p className="text-xs text-amber-900 mt-1">{next.reward_label}</p>
          )}
          <div className="mt-2.5">
            <div className="h-2 rounded-full bg-white border border-amber-200 overflow-hidden">
              <div className="h-full bg-amber-400" style={{ width: `${pct}%` }} />
            </div>
            <p className="text-[11px] text-amber-900 mt-1">
              {next.qualifying_now} of {next.needs} counting right now
            </p>
            {/* "0 of 4" to somebody who has plainly introduced four people reads
                as a broken page. It is nearly always because they are a level
                below, or one of them closed their deposit -- so say which. */}
            {next.qualifying_now < next.needs && booster.introduced_count > 0 && (
              <p className="text-[11px] text-amber-800 mt-0.5">
                You have introduced {booster.introduced_count}
                {booster.min_deposit_each
                  ? `, and ${booster.holding_deposit} of them ${booster.holding_deposit === 1 ? 'is' : 'are'} holding ${inr(booster.min_deposit_each)}`
                  : ''}
                {next.needs_level ? `, but this level counts only those who have reached ${next.needs_level}.` : '.'}
              </p>
            )}
          </div>
        </div>
      )}

      <div className="px-5 sm:px-6 py-4 border-t border-slate-100">
        <div className="flex flex-wrap gap-2">
          {booster.ladder.map((t) => (
            <div key={t.position} data-testid={`booster-rung-${t.position}`}
              className={`px-3 py-1.5 rounded-lg border text-[11px] font-semibold ${
                booster.level >= t.position
                  ? 'bg-amber-100 text-amber-900 border-amber-300'
                  : 'bg-slate-50 text-slate-600 border-slate-200'}`}>
              {t.name}
              <span className="block text-[10px] font-normal opacity-80">
                {t.direct_required} × {t.required_below === 0 ? 'member' : `Level ${t.required_below}`}
                {t.min_deposit_each ? `, each holding ${inr(t.min_deposit_each)}` : ''}
              </span>
              {t.reward_label && (
                <span className="block text-[10px] font-normal opacity-80">
                  {t.reward_label}
                </span>
              )}
              <span className="block text-[10px] font-normal opacity-70">
                {t.your_members_here} of yours here
              </span>
            </div>
          ))}
        </div>
        {booster.introduced?.length > 0 && (
          <div className="mt-3" data-testid="booster-introduced">
            <p className="text-[11px] font-semibold text-slate-700 mb-1.5">
              The members you introduced
            </p>
            <div className="rounded-md border border-slate-200 overflow-hidden">
              <table className="w-full text-left text-[11px]">
                <tbody className="divide-y divide-slate-100">
                  {booster.introduced.map((m, i) => (
                    <tr key={i} className="hover:bg-slate-50">
                      <td className="px-2.5 py-1.5 text-slate-800">{m.name}</td>
                      <td className="px-2.5 py-1.5 text-slate-600">
                        {m.level_name || 'not yet on the ladder'}
                      </td>
                      <td className="px-2.5 py-1.5 text-right">
                        {m.holds_deposit
                          ? <span className="text-emerald-700 font-semibold">deposit held</span>
                          : <span className="text-[#c8102e] font-semibold">no deposit</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <p className="text-[11px] text-slate-500 mt-2.5">{booster.note}</p>
      </div>
    </div>
  );
}

export default BoosterCard;
