import React, { useMemo, useState } from 'react';
import { Calculator, TrendingUp, AlertTriangle } from 'lucide-react';

const inr = (n) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

const UNIT_WORD = {
  daily: 'a day',
  recurring: 'a month',
  fixed: 'once',
  mis: 'once',
};

// What the member is actually asked for, and what they get back, in the plan's
// own terms. Every figure shown comes from the plan's own slab table — nothing
// is interpolated between two denominations, because a number between them is
// one the institution has not offered.
export default function ReturnsCalculator({ schemes, cap }) {
  const [code, setCode] = useState('');
  const [slabIndex, setSlabIndex] = useState(0);

  const plan = useMemo(
    () => schemes.find((s) => s.code === code) || null,
    [schemes, code],
  );
  const slab = plan?.slabs?.[slabIndex] || null;

  const pick = (nextCode) => {
    setCode(nextCode);
    setSlabIndex(0);
  };

  const earned = slab ? Number(slab.maturity) - Number(slab.deposit) : 0;
  const multiple = slab && Number(slab.deposit) > 0
    ? Number(slab.maturity) / Number(slab.deposit) : 0;

  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
      <div className="px-6 py-4 border-b border-slate-200 flex items-center gap-2">
        <Calculator className="w-4 h-4 text-[#0b3b8c]" />
        <h2 className="font-semibold text-slate-900 text-sm">
          What would I get?
        </h2>
      </div>

      <div className="p-6 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-[11px] text-slate-600 mb-1">Plan</span>
            <select
              value={code}
              onChange={(e) => pick(e.target.value)}
              data-testid="calc-plan"
              className="w-full bg-white border border-slate-300 rounded-md px-3 py-2.5 text-sm text-slate-900
                focus:outline-none focus:border-[#0b3b8c]"
            >
              <option value="">Choose a plan…</option>
              {schemes.map((s) => (
                <option key={s.code} value={s.code}>{s.name}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="block text-[11px] text-slate-600 mb-1">
              {plan ? `How much ${UNIT_WORD[plan.scheme_type] || ''}` : 'Amount'}
            </span>
            <select
              value={slabIndex}
              onChange={(e) => setSlabIndex(Number(e.target.value))}
              disabled={!plan}
              data-testid="calc-amount"
              className="w-full bg-white border border-slate-300 rounded-md px-3 py-2.5 text-sm text-slate-900
                focus:outline-none focus:border-[#0b3b8c] disabled:opacity-40"
            >
              {(plan?.slabs || []).map((s, i) => (
                <option key={i} value={i}>₹{inr(s.unit)}</option>
              ))}
              {!plan && <option>—</option>}
            </select>
          </label>
        </div>

        {!slab ? (
          <p className="text-[11px] text-slate-500">
            Pick a plan and an amount to see exactly what is paid in and what comes back.
          </p>
        ) : (
          <div data-testid="calc-result" className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-[10px] uppercase tracking-wide text-slate-500">You pay in total</p>
                <p className="text-lg font-bold text-slate-900 tabular-nums mt-0.5">₹{inr(slab.deposit)}</p>
                {plan.scheme_type !== 'fixed' && plan.scheme_type !== 'mis' && (
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    ₹{inr(slab.unit)} {UNIT_WORD[plan.scheme_type]}
                    {plan.contribution_months ? ` for ${plan.contribution_months} months` : ''}
                  </p>
                )}
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-[10px] uppercase tracking-wide text-slate-500">
                  {plan.payout_type === 'monthly' ? 'You receive in total' : 'You receive on maturity'}
                </p>
                <p className="text-lg font-bold text-[#0b3b8c] tabular-nums mt-0.5">₹{inr(slab.maturity)}</p>
                {slab.monthly_payout && (
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    ₹{inr(slab.monthly_payout)} a month for {plan.tenure_months} months
                  </p>
                )}
              </div>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                <p className="text-[10px] uppercase tracking-wide text-emerald-700">You earn</p>
                <p className="text-lg font-bold text-emerald-700 tabular-nums mt-0.5 flex items-center gap-1.5">
                  <TrendingUp className="w-4 h-4" /> ₹{inr(earned)}
                </p>
                <p className="text-[10px] text-emerald-700/80 mt-0.5">
                  {multiple.toFixed(2)}× what you put in
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-[11px] text-slate-600">
              <span>Term: <b className="text-white">{plan.tenure_months} months</b></span>
              <span>
                Effective rate:{' '}
                <b className={slab.exceeds_cap ? 'text-[#c8102e]' : 'text-slate-900'}>
                  {slab.effective_rate_pa === null ? '—' : `${slab.effective_rate_pa}% a year`}
                </b>
              </span>
            </div>

            {slab.exceeds_cap && (
              // Shown here as well as in the table: someone reading only the
              // calculator would otherwise see a return and none of the caveat.
              <div className="flex items-start gap-2 p-3 rounded-md bg-rose-50 border border-[#c8102e]/40">
                <AlertTriangle className="w-4 h-4 text-[#c8102e] shrink-0 mt-0.5" />
                <p className="text-[11px] text-slate-700 leading-relaxed">
                  This amount works out to <b className="text-[#c8102e]">{slab.effective_rate_pa}% a year</b>,
                  above the {cap}% the Nidhi Rules allow us to pay on a deposit. Please ask your branch
                  before depositing against it.
                </p>
              </div>
            )}

            <p className="text-[10px] text-slate-500 leading-relaxed">
              These are the plan&apos;s own figures for this amount, not an estimate. Amounts between the
              listed amounts are not offered, so only the ones above can be chosen.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
