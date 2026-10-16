import { planFigures, parseUnits } from './planMath';

test('a lump sum at 12.47% for 135 months is 3.75x', () => {
  expect(planFigures({ type: 'fixed', payout: 'maturity', unit: 8000, ratePa: 12.47, tenureMonths: 135 }).maturity)
    .toBeGreaterThanOrEqual(29990);
});
test('an RD pays in each instalment and earns on each', () => {
  const f = planFigures({ type: 'recurring', payout: 'maturity', unit: 1000, ratePa: 6, tenureMonths: 12 });
  expect(f.deposit).toBe(12000);
  expect(f.maturity).toBeGreaterThan(12300);
  expect(f.maturity).toBeLessThan(12400);
});
test('a daily plan counts 30 days a month', () => {
  expect(planFigures({ type: 'daily', payout: 'maturity', unit: 100, ratePa: 10, tenureMonths: 36 }).deposit).toBe(108000);
});
test('MIS pays the monthly equivalent of the yearly rate', () => {
  expect(planFigures({ type: 'mis', payout: 'monthly', unit: 100000, ratePa: 12, tenureMonths: 60 }).monthly_payout).toBe(948.87);
});
test('amounts parse from commas or lines, once each, sorted', () => {
  expect(parseUnits('16000, 8000\n8000 24000')).toEqual([8000, 16000, 24000]);
});
