import React, { useEffect, useState } from 'react';
import { api } from '../services/api';

// Every live plan, for both the member's Deposits page and the teller's Book Member
// Deposit page, so the two always offer the same list. Plans come from
// /public/schemes, which only lists what can be booked (inside the 12.5% cap).
//
// Render-prop: children({ inputs, breakdown, choice }) lets each page lay the form
// and the summary out its own way. choice.payload is merged into the booking call.

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const TENURES = [6, 12, 24, 36, 60];
// Same tiers as deposit_tier_rate() in modules/banking.php.
const tierOf = (m) => (m < 12 ? 'under_1y' : m <= 24 ? '1y_to_2y' : m <= 36 ? '2y_to_3y' : 'over_3y');
const MIN_FD = 1000;

const kindOf = (plan) => {
  if (!plan) return 'fd';
  if (plan.daily_rate_percent != null) return 'daily_rate';
  if (plan.payout_type === 'monthly') return 'mis';
  return plan.scheme_type === 'recurring' || plan.scheme_type === 'daily' ? 'instalment' : 'lump';
};
const GROUPS = [
  ['lump', 'Fixed deposit plans (one lump sum)'],
  ['instalment', 'Recurring and daily collection plans (instalments)'],
  ['mis', 'Monthly income plans'],
  ['daily_rate', 'Daily interest plans'],
];

export default function PlanPicker({ children }) {
  const [plans, setPlans] = useState([]);
  const [fdRates, setFdRates] = useState([]);
  const [code, setCode] = useState('');
  const [unit, setUnit] = useState('');
  const [amount, setAmount] = useState('50000');
  const [tenure, setTenure] = useState(12);

  useEffect(() => {
    api.publicSchemes()
      .then((r) => { setPlans(r.schemes || []); setFdRates(r.fd_rates || []); })
      .catch(() => {});
  }, []);

  const plan = plans.find((p) => p.code === code) || null;
  const kind = kindOf(plan);
  const slabs = (plan?.slabs || []).filter((s) => !s.exceeds_cap);
  const slab = slabs.find((s) => String(s.unit) === String(unit)) || null;
  const every = plan?.scheme_type === 'daily' ? 'day' : 'month';
  const fdRate = (m) => fdRates.find((r) => r.tier === tierOf(m))?.rate;

  const choose = (next) => {
    const p = plans.find((x) => x.code === next) || null;
    setCode(next);
    setUnit(String((p?.slabs || []).find((s) => !s.exceeds_cap)?.unit || ''));
    if (p?.daily_rate_percent != null) setAmount(String(p.principal_amount || ''));
    else if (!p) setAmount('50000');
  };

  // What is taken today, what the booking call needs, and the lines of the summary.
  let payload; let valid; let dueToday; let rows = []; let note = '';
  if (kind === 'fd') {
    const p = Number(amount) || 0;
    const rate = fdRate(Number(tenure)) ?? 0;
    const maturity = p * (1 + rate / 400) ** (4 * Number(tenure) / 12);
    payload = { deposit_type: 'fixed', amount: p, tenure_months: Number(tenure) };
    valid = p >= MIN_FD;
    dueToday = p;
    rows = [['Deposit', inr(p)], ['Rate', `${rate}% a year, compounded quarterly`],
      ['Interest', inr(maturity - p)], ['Maturity value', inr(maturity)]];
  } else if (kind === 'daily_rate') {
    const p = Number(amount) || 0;
    payload = { scheme_code: plan.code, amount: p };
    valid = p >= Number(plan.principal_amount || 0);
    dueToday = p;
    rows = [['Deposit', inr(p)], ['Credited daily', `${inr(p * plan.daily_rate_percent / 100)} a day (${plan.effective_rate_pa}% a year)`],
      ['Paid out', plan.withdrawal_threshold ? `once it reaches ${inr(plan.withdrawal_threshold)}` : 'every day'],
      ['Returned at maturity', inr(p)]];
    note = 'TDS is deducted from each payout under Section 194A, as applicable.';
  } else {
    payload = { scheme_code: plan.code, amount: slab?.unit };
    valid = !!slab;
    if (kind === 'instalment') {
      dueToday = slab?.unit;
      rows = slab ? [['Instalment', `${inr(slab.unit)} a ${every}`], ['Paid in over the plan', inr(slab.deposit)],
        ['Maturity value', inr(slab.maturity)], ['Return', `${slab.effective_rate_pa}% a year`]] : [];
      note = `The first instalment is taken today. The rest is taken from the savings account every ${every}; keep enough there. Missed instalments are taken when money arrives, and a plan that is not fully paid matures at the same share of its value.`;
    } else if (kind === 'mis') {
      dueToday = slab?.deposit;
      rows = slab ? [['Deposit', inr(slab.deposit)], ['Paid to you', `${inr(slab.monthly_payout)} a month`],
        ['Total payouts', inr(slab.maturity)], ['Returned at maturity', inr(slab.deposit)],
        ['Return', `${slab.effective_rate_pa}% a year`]] : [];
    } else {
      dueToday = slab?.deposit;
      rows = slab ? [['Deposit', inr(slab.deposit)], ['Maturity value', inr(slab.maturity)],
        ['Return', `${slab.effective_rate_pa}% a year`]] : [];
    }
  }
  rows = plan ? [['Plan', `${plan.name} · ${plan.tenure_months} months`], ...rows]
    : [['Plan', `Fixed deposit · ${tenure} months`], ...rows];

  const control = 'w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900';
  const inputs = (
    <>
      <div>
        <label className="block text-slate-500 mb-1" htmlFor="plan-select">Plan</label>
        <select id="plan-select" data-testid="deposit-type-select" value={code} onChange={(e) => choose(e.target.value)}
          className={`${control} font-semibold`}>
          <option value="">Fixed deposit (choose your own amount and tenure)</option>
          {GROUPS.map(([k, label]) => {
            const inGroup = plans.filter((p) => kindOf(p) === k);
            return inGroup.length ? (
              <optgroup key={k} label={label}>
                {inGroup.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.name} · {p.tenure_months} months{p.effective_rate_pa != null ? ` · ${p.effective_rate_pa}% a year` : ''}
                  </option>
                ))}
              </optgroup>
            ) : null;
          })}
        </select>
      </div>

      {kind === 'fd' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-slate-500 mb-1" htmlFor="fd-amount">Amount (₹, at least {inr(MIN_FD)})</label>
            <input id="fd-amount" data-testid="fd-amount-input" type="number" min={MIN_FD} step="1000" required
              value={amount} onChange={(e) => setAmount(e.target.value)} className={`${control} font-bold`} />
          </div>
          <div>
            <label className="block text-slate-500 mb-1" htmlFor="fd-tenure">Tenure</label>
            <select id="fd-tenure" data-testid="fd-tenure-select" value={tenure} onChange={(e) => setTenure(Number(e.target.value))}
              className={`${control} font-semibold`}>
              {TENURES.map((m) => (
                <option key={m} value={m}>{m} months{fdRate(m) != null ? ` · ${fdRate(m)}% a year` : ''}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {kind === 'daily_rate' && (
        <div>
          <label className="block text-slate-500 mb-1" htmlFor="plan-amount">
            Amount (₹, at least {inr(plan.principal_amount)})
          </label>
          <input id="plan-amount" data-testid="mis-daily-amount-input" type="number" min={plan.principal_amount} step="1000"
            required value={amount} onChange={(e) => setAmount(e.target.value)} className={`${control} font-bold`} />
        </div>
      )}

      {(kind === 'instalment' || kind === 'mis' || kind === 'lump') && (
        <div>
          <label className="block text-slate-500 mb-1" htmlFor="plan-unit">
            {kind === 'instalment' ? `Instalment (₹ a ${every})` : 'Amount (₹)'}
          </label>
          <select id="plan-unit" data-testid="mis-unit-select" value={unit} onChange={(e) => setUnit(e.target.value)}
            className={`${control} font-semibold`}>
            {slabs.map((s) => (
              <option key={s.unit} value={s.unit}>
                {kind === 'instalment'
                  ? `${inr(s.unit)} a ${every} → ${inr(s.maturity)} at maturity`
                  : kind === 'mis'
                    ? `${inr(s.deposit)} → ${inr(s.monthly_payout)} a month`
                    : `${inr(s.deposit)} → ${inr(s.maturity)} at maturity`}
              </option>
            ))}
          </select>
        </div>
      )}
    </>
  );

  const breakdown = (
    <div className="p-4 rounded-xl bg-white border border-slate-200 space-y-2" data-testid="plan-breakdown">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-3 text-slate-500">
          <span>{label}</span>
          <span className="font-semibold text-slate-900 text-right">{value}</span>
        </div>
      ))}
      <div className="pt-2 border-t border-slate-200 flex justify-between text-sm">
        <span className="font-bold text-slate-900">Taken today</span>
        <span data-testid="fd-maturity-value" className="font-extrabold text-emerald-700">{inr(dueToday)}</span>
      </div>
      {note && <p className="text-[10px] text-slate-500">{note}</p>}
    </div>
  );

  return children({ inputs, breakdown, choice: { payload, valid, dueToday, planName: plan?.name || 'Fixed deposit' } });
}
