import { calculateReferralDemo, DEFAULT_RATES, LEVELS, matrixTree, validateDemoPlan } from '../utils/referralDemo';
import { canOpen } from '../navigation';

test('twenty-level demo uses paid amounts, exact percentages and independent rank thresholds', () => {
  const plan = { name: 'FD demo', type: 'FD', rates: Array(LEVELS).fill(5) };
  const z = Array(LEVELS - 5).fill(0);
  const run = (overrides = {}, amount = '10000', funded = true, earned) =>
    calculateReferralDemo({ ...plan, ...overrides }, amount, funded, 500, 2500, earned);
  const rows = run();
  expect(rows.map(row => row.payment)).toEqual(Array(LEVELS).fill(50000));
  expect(rows.reduce((sum, row) => sum + row.payment, 0)).toBe(1000000);
  expect(run({ rates: DEFAULT_RATES }).reduce((sum, row) => sum + row.payment, 0)).toBe(170000);
  expect(rows.every(row => row.rank === 'Silver')).toBe(true);
  expect(run({}, '10000', true, [200000, ...Array(LEVELS - 1).fill(0)]).map(row => row.rank))
    .toEqual(['Gold', ...Array(LEVELS - 1).fill('Silver')]);
  expect(run({}, '9999.99').every(row => row.rank === 'Unranked')).toBe(true);
  expect(run({}, '10000', false).every(row => row.payment === 0 && row.rank === 'Unranked')).toBe(true);
  expect(run({}, '', false).every(row => row.payment === 0)).toBe(true);
  expect(run({}, '10000', false, [250000, ...Array(LEVELS - 1).fill(0)])[0].total).toBe(250000);
  for (const type of ['FD', 'RD', 'MLM']) {
    expect(run({ type }, '1000')[0].payment).toBe(5000);
  }
  expect(run({ rates: [1.25, 0, 5, 10, 20, ...z] }, '100.01').map(row => row.payment).slice(0, 5))
    .toEqual([125, 0, 500, 1000, 2000]);
  expect(run({ rates: [20, 20, 20, 20, 20, ...z] }, '0.03').reduce((sum, row) => sum + row.payment, 0)).toBeLessThanOrEqual(3);
  expect(run({}, '1000000000')[0].payment).toBe(5000000000);
  expect(plan.rates).toEqual(Array(LEVELS).fill(5));
  for (const amount of ['', '-1', '0', 'NaN', 'Infinity', '1e3', '1.001', '1000000001']) {
    expect(() => run({}, amount)).toThrow();
  }
  for (const rates of [[5, 5, 5, 5, 5], [25, 25, 25, 25, 25, ...z], [-1, ...plan.rates.slice(1)], ['', ...plan.rates.slice(1)], [0.001, ...plan.rates.slice(1)]]) {
    expect(() => run({ rates })).toThrow();
  }
  expect(() => run({ name: ' ' })).toThrow();
  expect(() => run({ type: 'other' })).toThrow();
  expect(() => calculateReferralDemo(plan, 1000, true, 500, 500)).toThrow();
  expect(() => calculateReferralDemo(plan, 1000, true, 0, 500)).toThrow();
  expect(validateDemoPlan({ ...plan, name: ' Custom ', rates: ['5', ...plan.rates.slice(1)] }).name).toBe('Custom');
  const sponsor = matrixTree(13);
  expect(sponsor.children.map(c => c.detail)).toEqual(['Left of Sponsor', 'Center of Sponsor', 'Right of Sponsor']);
  expect(sponsor.children[0].children.map(c => c.name)).toEqual(['Member 4', 'Member 5', 'Member 6']);
  expect(sponsor.children[0].children[0].children.map(c => c.detail)).toEqual(['Left of Member 4']);
  expect(matrixTree(0).children).toEqual([]);
  for (const bad of ['-1', '40', '1.5', 'x']) expect(() => matrixTree(bad)).toThrow();
  expect(canOpen('bank_owner', 'member-ranks')).toBe(true);
  for (const role of ['retail', 'staff', 'admin', 'branch_manager', 'loan_officer', 'collection_agent']) {
    expect(canOpen(role, 'member-ranks')).toBe(false);
  }
});
