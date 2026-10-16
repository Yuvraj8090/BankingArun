// Deposit and maturity for one amount a plan is sold in, from an interest rate a
// year. The same model the server checks the 12.5% cap with (effective_rate in
// modules/master.php): monthly compounding at (1 + rate)^(1/12), instalments paid
// at the start of each month, a daily plan's 30 days counted as one month.
// Maturity is rounded down to the rupee, so a plan at exactly the cap stays inside it.
export function planFigures({ type, payout, unit, ratePa, tenureMonths, payInMonths }) {
  const m = (1 + ratePa / 100) ** (1 / 12) - 1;
  const months = Number(tenureMonths);
  if (payout === 'monthly') {
    const monthly_payout = Math.floor(unit * m * 100) / 100;
    return { unit, deposit: unit, maturity: Math.round(monthly_payout * months * 100) / 100, monthly_payout };
  }
  if (type === 'recurring' || type === 'daily') {
    const each = type === 'daily' ? unit * 30 : unit;
    const payIn = Math.min(Number(payInMonths) || months, months);
    let maturity = 0;
    for (let i = 1; i <= payIn; i += 1) maturity += each * (1 + m) ** (months - (i - 1));
    return { unit, deposit: each * payIn, maturity: Math.floor(maturity) };
  }
  return { unit, deposit: unit, maturity: Math.floor(unit * (1 + m) ** months) };
}

export const parseUnits = (text) => [...new Set(String(text).split(/[\n,\s]+/)
  .map(Number).filter((n) => Number.isFinite(n) && n > 0))].sort((a, b) => a - b);
