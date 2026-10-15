import React, { useState } from 'react';
import { Field, inputClass } from '../components/Modal';
import { NetworkTreeChart } from './ReferralPage';
import { inr } from '../utils/format';
import { calculateReferralDemo, rankThresholds, validateDemoPlan } from '../utils/referralDemo';

const STORAGE_KEY = 'ajspay.referral-demo.v1';
const newPlan = () => ({ name: '', type: 'FD', rates: [5, 5, 5, 5, 5] });
const DEFAULTS = {
  plans: ['FD', 'RD', 'MLM'].map(type => ({ ...newPlan(), name: `${type} demo`, type })),
  silver: 500, gold: 2500,
};
const buttonClass = 'px-3 py-2 rounded-md border border-slate-300 text-xs font-semibold hover:bg-slate-50';

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { settings: DEFAULTS, warning: '' };
    const settings = JSON.parse(raw);
    if (!Array.isArray(settings.plans) || !settings.plans.length) throw new Error('No plans');
    settings.plans = settings.plans.map(validateDemoPlan);
    rankThresholds(settings.silver, settings.gold);
    return { settings, warning: '' };
  } catch {
    return { settings: DEFAULTS, warning: 'Saved demo settings could not be read. Showing examples; saved data is unchanged until you save.' };
  }
}

export default function ReferralDemo() {
  const [initial] = useState(loadSettings);
  const [settings, setSettings] = useState(initial.settings);
  const [selected, setSelected] = useState(0);
  const [plan, setPlan] = useState(initial.settings.plans[0]);
  const [silver, setSilver] = useState(initial.settings.silver);
  const [gold, setGold] = useState(initial.settings.gold);
  const [amount, setAmount] = useState('10000');
  const [funded, setFunded] = useState(true);
  const [earned, setEarned] = useState([0, 0, 0, 0, 0]);
  const [message, setMessage] = useState(initial.warning);
  let preview = [], error = '';
  try { preview = calculateReferralDemo(plan, amount, funded, silver, gold, earned); }
  catch (e) { error = e.message; }
  const total = preview.reduce((sum, row) => sum + row.payment, 0);
  let tree = { id: 'buyer', parent_id: 'person-1', name: 'New member', detail: funded ? `${plan.type} funded` : 'Signup only' };
  preview.forEach(row => {
    tree = {
      id: `person-${row.level}`, parent_id: row.level < 5 ? `person-${row.level + 1}` : null,
      name: `Person ${row.level}`, detail: `L${row.level} · ${row.rate}%`,
      children: [tree, { id: `empty-${row.level}`, parent_id: `person-${row.level}`, name: 'Empty right', detail: 'No payout' }],
    };
  });

  const save = (event) => {
    event.preventDefault();
    try {
      const checked = validateDemoPlan(plan);
      rankThresholds(silver, gold);
      const plans = [...settings.plans];
      const index = selected === '' ? plans.length : selected;
      if (plans.some((p, i) => i !== index && p.name.toLowerCase() === checked.name.toLowerCase())) {
        throw new Error('Use a different name for each demo plan.');
      }
      plans[index] = checked;
      const next = { plans, silver: Number(silver), gold: Number(gold) };
      // ponytail: settings stay in this browser; use a separate demo service if
      // cross-device sharing is needed. Never store these in live scheme tables.
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setSettings(next); setSelected(index); setPlan(checked);
      setMessage('Demo plan and rank settings saved in this browser.');
    } catch (e) { setMessage(`Not saved: ${e.message}`); }
  };

  return (
    <section className="space-y-4" aria-label="Referral commission demo" data-testid="referral-demo">
      <div className="p-4 rounded-lg border border-amber-300 bg-amber-50 text-sm text-amber-950">
        <h2 className="font-semibold">Referral demo · no real payouts</h2>
        <p className="mt-1 text-xs">Fictional people only. A signup pays ₹0. A funded plan allocates 5% to each of five ancestors by default (25% total).
          This simulation does not book deposits, change live ranks or move money.</p>
      </div>
      <form onSubmit={save} className="bg-white p-5 rounded-lg border border-slate-200 space-y-4">
        <div className="flex items-end gap-3">
          <Field label="Saved demo plan">
            <select className={inputClass} value={selected} onChange={e => {
              const index = Number(e.target.value); setSelected(index); setPlan(settings.plans[index]); setMessage('');
            }}>
              {selected === '' && <option value="" disabled>New demo plan</option>}
              {settings.plans.map((p, i) => <option key={i} value={i}>{p.name}</option>)}
            </select>
          </Field>
          <button className={buttonClass} type="button" onClick={() => { setSelected(''); setPlan(newPlan()); setMessage(''); }}>New demo plan</button>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Demo plan name"><input className={inputClass} required maxLength={60} value={plan.name}
            onChange={e => setPlan({ ...plan, name: e.target.value })} /></Field>
          <Field label="Plan type"><select className={inputClass} value={plan.type} onChange={e => setPlan({ ...plan, type: e.target.value })}>
            {['FD', 'RD', 'MLM'].map(type => <option key={type}>{type}</option>)}
          </select></Field>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {plan.rates.map((rate, i) => <Field key={i} label={`Level ${i + 1} (%)`}>
            <input className={inputClass} type="number" required min="0" max="100" step="0.01" value={rate}
              onChange={e => setPlan({ ...plan, rates: plan.rates.map((r, j) => j === i ? e.target.value : r) })} />
          </Field>)}
        </div>
        <p className="text-xs text-slate-600">Level 1 is the direct referrer; level 5 is the fifth ancestor. Each percentage uses the same amount received.</p>
        <fieldset className="border-t border-slate-100 pt-3">
          <legend className="text-sm font-semibold">Demo rank thresholds</legend>
          <p className="text-xs text-slate-600 mb-3">Editable examples: Silver from ₹500 and Gold from ₹2,500 of cumulative simulated commission per person. These do not set commission rates.</p>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Silver from (₹)"><input className={inputClass} type="number" required min="0.01" max="1000000000" step="0.01" value={silver} onChange={e => setSilver(e.target.value)} /></Field>
            <Field label="Gold from (₹)"><input className={inputClass} type="number" required min="0.01" max="1000000000" step="0.01" value={gold} onChange={e => setGold(e.target.value)} /></Field>
          </div>
        </fieldset>
        <button className={buttonClass} type="submit">Save demo plan & ranks</button>
        <p className="text-xs text-slate-500">Settings save in this browser only. Simulation totals reset when you leave this page.</p>
      </form>
      <div className="bg-white p-5 rounded-lg border border-slate-200 space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Demo event"><select className={inputClass} value={funded ? 'funded' : 'signup'} onChange={e => setFunded(e.target.value === 'funded')}>
            <option value="signup">Signup only — ₹0 commission</option>
            <option value="funded">Plan payment received</option>
          </select></Field>
          <Field label={plan.type === 'RD' ? 'RD instalment received now (₹)' : 'Amount received now (₹)'}>
            <input className={inputClass} type="number" disabled={!funded} min="0.01" max="1000000000" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} />
          </Field>
        </div>
        <p className="text-xs text-slate-600">RD uses only this paid instalment, not future instalments or maturity value. Each allocation rounds down to the nearest paisa.</p>
        {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : <>
          <p className="text-sm font-semibold" data-testid="demo-total">Next event: {inr(total / 100, { decimals: 2 })} total · {funded ? preview.reduce((sum, row) => sum + Math.round(row.rate * 100), 0) / 100 : 0}%</p>
          <div className="overflow-x-auto"><table className="w-full text-xs text-left">
            <caption className="text-left mb-2 text-slate-600">Five fictional referrers · rank after the next event</caption>
            <thead><tr>{['Person / level', 'Rate', 'Next allocation', 'Total after event', 'Demo rank'].map(label => <th key={label} scope="col" className="p-2">{label}</th>)}</tr></thead>
            <tbody>{preview.map(row => <tr key={row.level} className="border-t border-slate-100">
              <th scope="row" className="p-2">Person {row.level} / L{row.level}</th><td className="p-2">{row.rate}%</td>
              <td className="p-2">{inr(row.payment / 100, { decimals: 2 })}</td><td className="p-2">{inr(row.total / 100, { decimals: 2 })}</td>
              <td className={`p-2 font-semibold ${row.rank === 'Gold' ? 'text-amber-800' : 'text-slate-700'}`}>{row.rank}</td>
            </tr>)}</tbody>
          </table></div>
        </>}
        <div className="flex flex-wrap gap-3">
          <button type="button" disabled={!!error} className={`${buttonClass} disabled:opacity-50`} onClick={() => {
            setEarned(preview.map(row => row.total));
            setMessage(`Simulated ${funded ? 'one plan payment' : 'one signup'}: ${inr(total / 100, { decimals: 2 })} allocated. The table now previews the next event.`);
          }}>Simulate this event</button>
          <button type="button" className={buttonClass} onClick={() => { setEarned([0, 0, 0, 0, 0]); setMessage('Simulation totals reset. Saved plans are kept.'); }}>Reset simulation</button>
        </div>
        <p className="text-xs text-slate-500">Each click simulates another event for the same fictional member.</p>
        <p role="status" className="text-xs text-slate-700">{message}</p>
      </div>
      {!error && <>
        <NetworkTreeChart tree={tree} title="Binary demo · five ancestor levels" />
        <p className="text-xs text-slate-600">Left path shown. Each ancestor has two positions; the right positions are empty and receive nothing. There is no pair-matching bonus.</p>
      </>}
    </section>
  );
}
