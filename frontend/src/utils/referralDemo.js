// Integer paisa / basis points: each allocation rounds down, so small payments
// cannot allocate more than their funding. The demo never posts to an account.
function hundredths(value, label, max) {
  const text = String(value);
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error(`${label}: enter a non-negative number with at most two decimals.`);
  const [whole, fraction = ''] = text.split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(result) || result > max) throw new Error(`${label} is too large.`);
  return result;
}

export const LEVELS = 20;
// Declining default: 5, 3, 2, 1, 1, then 0.5 for L6–10 and 0.25 for L11–20 = 17% in all.
export const DEFAULT_RATES = [5, 3, 2, 1, 1, ...Array(5).fill(0.5), ...Array(10).fill(0.25)];
export const SLOTS = ['Left', 'Center', 'Right'];

export function validateDemoPlan(plan) {
  if (typeof plan?.name !== 'string' || !plan.name.trim() || plan.name.trim().length > 60) {
    throw new Error('Give the demo plan a name of 1–60 characters.');
  }
  if (!['FD', 'RD', 'MLM'].includes(plan.type)) throw new Error('Choose FD, RD or MLM.');
  if (!Array.isArray(plan.rates) || plan.rates.length !== LEVELS) throw new Error(`Set all ${LEVELS} percentages.`);
  const rates = plan.rates.map((rate, i) => hundredths(rate, `Level ${i + 1}`, 10000));
  if (rates.reduce((a, b) => a + b, 0) > 10000) throw new Error(`The ${LEVELS} percentages must total at most 100%.`);
  return { name: plan.name.trim(), type: plan.type, rates: rates.map(rate => rate / 100) };
}

export function rankThresholds(silver, gold) {
  const thresholds = [hundredths(silver, 'Silver threshold', 1e11), hundredths(gold, 'Gold threshold', 1e11)];
  if (thresholds[0] <= 0 || thresholds[1] <= thresholds[0]) throw new Error('Silver must be above ₹0 and Gold must be above Silver.');
  return thresholds;
}

export function calculateReferralDemo(plan, amount, funded, silver, gold, earned = Array(LEVELS).fill(0)) {
  const checked = validateDemoPlan(plan);
  const principal = funded ? hundredths(amount, 'Amount received', 1e11) : 0;
  if (funded && principal <= 0) throw new Error('Amount received must be above ₹0.');
  const [silverPaisa, goldPaisa] = rankThresholds(silver, gold);
  return checked.rates.map((rate, i) => {
    const payment = funded ? Math.floor(principal * Math.round(rate * 100) / 10000) : 0;
    const total = earned[i] + payment;
    if (!Number.isSafeInteger(total)) throw new Error('Demo total is too large. Reset the simulation.');
    return { level: i + 1, rate, payment, total, rank: total >= goldPaisa ? 'Gold' : total >= silverPaisa ? 'Silver' : 'Unranked' };
  });
}

// Three-leg matrix under one sponsor: Left, Center, Right fill first; once a
// person's three positions are full, the next member spills to the level below,
// filled left to right (breadth-first).
export function matrixTree(count) {
  const n = Number(count);
  if (!Number.isInteger(n) || n < 0 || n > 39) throw new Error('Members under the sponsor: enter 0 to 39.');
  const nodes = [{ id: 'm0', parent_id: null, name: 'Sponsor', detail: 'Person 1', children: [] }];
  for (let i = 1; i <= n; i++) {
    const parent = nodes[Math.floor((i - 1) / 3)];
    const node = { id: `m${i}`, parent_id: parent.id, name: `Member ${i}`, detail: `${SLOTS[(i - 1) % 3]} of ${parent.name}`, children: [] };
    parent.children.push(node); nodes.push(node);
  }
  return nodes[0];
}
