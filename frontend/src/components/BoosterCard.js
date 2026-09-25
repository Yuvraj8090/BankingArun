import React from 'react';
import { ArrowRight, Zap } from 'lucide-react';

// Shared by the standing page and Refer & Earn. The member asks the same
// question in both places -- what am I on, and what gets me to the next one --
// so the answer had better not be two different components drifting apart.
const inr = (n) => `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

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
      </div>

      {next && (
        <div className="px-5 sm:px-6 py-5 border-t bg-amber-50 border-amber-100">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-amber-800 font-semibold">
            Next <ArrowRight className="w-3 h-3" /> {next.name}
          </div>
          <p className="text-sm font-semibold text-slate-900 mt-1.5 leading-snug" data-testid="booster-next">
            {next.how}
          </p>
          <div className="mt-2.5">
            <div className="h-2 rounded-full bg-white border border-amber-200 overflow-hidden">
              <div className="h-full bg-amber-400" style={{ width: `${pct}%` }} />
            </div>
            <p className="text-[11px] text-amber-900 mt-1">
              {next.qualifying_now} of {next.needs} counting right now
            </p>
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
            </div>
          ))}
        </div>
        <p className="text-[11px] text-slate-500 mt-2.5">{booster.note}</p>
      </div>
    </div>
  );
}

export default BoosterCard;
