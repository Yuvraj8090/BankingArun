import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Percent, Info, ChevronRight, RefreshCw, ShieldCheck, Building2, AlertTriangle } from 'lucide-react';
import { api } from '../services/api';

const TYPE_LABEL = {
  daily: 'Daily deposit',
  recurring: 'Monthly deposit',
  fixed: 'Fixed deposit',
  mis: 'Monthly income'
};

// Per-day for a daily plan, per-month for a recurring one, one payment for the rest.
const UNIT_LABEL = { daily: 'Per day', recurring: 'Per month', fixed: 'Amount', mis: 'Amount' };

const inr = (n) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });

const years = (months) => (months % 12 === 0 ? `${months / 12} year` : `${months} month`);

// The public rate card. Every figure comes from the scheme master, so what is
// advertised here is exactly what the back office has approved. A plan may be
// published whose printed figures work out above the Nidhi cap; where that is
// so, the rate is marked on the row it applies to rather than being averaged
// away or left for the reader to work out.
export default function PublicRatesPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [openCode, setOpenCode] = useState(null);

  useEffect(() => {
    api.publicSchemes()
      .then((d) => { setData(d); setOpenCode(d.schemes?.[0]?.code ?? null); })
      .catch(() => setError('The rate card could not be loaded. Please try again shortly.'));
  }, []);

  if (error) {
    return <div className="max-w-3xl mx-auto px-4 py-16 text-sm text-slate-700">{error}</div>;
  }
  if (!data) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 flex items-center gap-2 text-sm text-slate-600">
        <RefreshCw className="w-4 h-4 animate-spin" /> Loading the rate card…
      </div>
    );
  }

  const { company, schemes, max_rate_pa: cap, disclosure } = data;
  const byType = schemes.reduce((acc, s) => ({ ...acc, [s.scheme_type]: [...(acc[s.scheme_type] || []), s] }), {});

  return (
    <div className="bg-slate-50">

      <div className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center gap-1.5 text-[11px] text-slate-500 mb-2">
            <span>Home</span> <ChevronRight className="w-3 h-3" /> <span className="text-slate-800">Savings Plans</span>
          </div>
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-slate-900 tracking-tight">
                Savings Plans &amp; Returns
              </h1>
              <p className="text-xs text-slate-600 mt-1 max-w-2xl">
                Every plan we accept deposits into, with the exact amount payable and the amount
                returned. Interest is shown as the effective rate a year, which is what the plan&apos;s
                own figures work out to.
              </p>
            </div>
            <Link
              data-testid="rates-open-account-btn"
              to="/open-account"
              className="px-5 py-2.5 rounded-md bg-[#0b3b8c] hover:bg-[#092e6f] text-white text-xs font-semibold shadow-sm whitespace-nowrap"
            >
              Become a member
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">

        <div className="bg-[#141414] border border-[#f5c518]/40 rounded-lg p-4 flex items-start gap-2.5">
          <ShieldCheck className="w-4 h-4 text-[#f5c518] shrink-0 mt-0.5" />
          <p className="text-[11px] text-slate-300 leading-relaxed">
            {disclosure} The Nidhi Rules, 2014 cap what we may pay on a deposit at <strong>{cap}% a year</strong>.
            Where a plan's printed figures work out above that, the row is marked — ask your branch
            before depositing against it.
          </p>
        </div>

        {Object.entries(byType).map(([type, list]) => (
          <div key={type} className="bg-[#141414] border border-[#2a2a2a] rounded-lg overflow-hidden">
            {/* The printed plan book's own treatment: a gold pill on black. */}
            <div className="px-6 py-4 flex items-center gap-2 border-b border-[#2a2a2a]">
              <Percent className="w-4 h-4 text-[#f5c518]" />
              <h2 className="font-bold text-sm tracking-wide px-3 py-1 rounded-full bg-[#f5c518] text-[#141414]">
                {TYPE_LABEL[type] || type} plans
              </h2>
            </div>

            <div className="divide-y divide-[#2a2a2a]">
              {list.map((s) => {
                const open = openCode === s.code;
                const payIn = s.contribution_months && s.contribution_months < s.tenure_months
                  ? s.contribution_months : null;
                return (
                  <div key={s.code} data-testid={`public-scheme-${s.code}`}>
                    <button
                      onClick={() => setOpenCode(open ? null : s.code)}
                      aria-expanded={open}
                      className="w-full text-left px-6 py-4 hover:bg-[#1d1d1d] transition flex items-center justify-between gap-4"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-white">{s.name}</div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          {years(s.tenure_months)} term
                          {payIn && <> · paid in for {payIn} months, then held</>}
                          {s.payout_type === 'monthly' && <> · paid out every month</>}
                          {' · '}{s.slabs.length} amount{s.slabs.length === 1 ? '' : 's'} to choose from
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-xl font-bold text-[#f5c518] leading-none tabular-nums">
                          {s.effective_rate_pa === null ? '—' : `${s.effective_rate_pa}%`}
                        </div>
                        <div className="text-[10px] text-slate-400 mt-1">a year</div>
                      </div>
                    </button>

                    {open && (
                      <div className="px-6 pb-5 -mt-1">
                        <div className="overflow-x-auto border border-[#3a3a3a] rounded-md">
                          <table className="w-full text-left text-xs">
                            {/* Deep red header on black, as the plan book prints it. */}
                            <thead className="bg-[#8b0d22] text-[10px] uppercase tracking-wide text-[#f5c518]">
                              <tr>
                                <th className="p-2.5 font-bold">{UNIT_LABEL[s.scheme_type]}</th>
                                <th className="p-2.5 font-bold text-right">You pay in total</th>
                                <th className="p-2.5 font-bold text-right">
                                  {s.payout_type === 'monthly' ? 'You receive in total' : 'You receive on maturity'}
                                </th>
                                <th className="p-2.5 font-bold text-right">Effective a year</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[#2a2a2a]">
                              {s.slabs.map((slab, i) => (
                                // Red is decoration in this palette, so a row that prices above
                                // the cap is marked by its own tint and a badge rather than by
                                // text colour alone, which would disappear into the styling.
                                <tr key={i} className={slab.exceeds_cap ? 'bg-[#2a0f14]' : 'hover:bg-[#1d1d1d]'}>
                                  <td className="p-2.5 font-bold text-white tabular-nums whitespace-nowrap">₹{inr(slab.unit)}</td>
                                  <td className="p-2.5 text-right text-slate-300 tabular-nums whitespace-nowrap">₹{inr(slab.deposit)}</td>
                                  <td className="p-2.5 text-right font-bold text-[#f5c518] tabular-nums whitespace-nowrap">₹{inr(slab.maturity)}</td>
                                  <td className="p-2.5 text-right tabular-nums whitespace-nowrap">
                                    <span className={slab.exceeds_cap ? 'font-bold text-white' : 'text-slate-300'}>
                                      {slab.effective_rate_pa === null ? '—' : `${slab.effective_rate_pa}%`}
                                    </span>
                                    {slab.exceeds_cap && (
                                      <span className="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded
                                        bg-[#f5c518] text-[#141414] text-[9px] font-bold uppercase tracking-wide">
                                        <AlertTriangle className="w-2.5 h-2.5" /> above cap
                                      </span>
                                    )}
                                    {slab.off_headline && !slab.exceeds_cap && (
                                      <span className="block text-[10px] text-amber-300">differs from the plan rate</span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {s.notes && <p className="text-[11px] text-slate-400 mt-2">{s.notes}</p>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center gap-2">
            <Building2 className="w-4 h-4 text-[#0b3b8c]" />
            <h2 className="font-semibold text-slate-900 text-sm">Who you are dealing with</h2>
          </div>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 px-6 py-5 text-xs">
            <Row label="Registered name" value={company.legal_name} />
            <Row label="Corporate Identity Number" value={company.cin} mono />
            <Row label="PAN" value={company.pan} mono />
            <Row label="TAN" value={company.tan} mono />
            <Row label="Incorporated on"
              value={new Date(company.incorporated_on).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })} />
            <Row label="Constitution" value={company.company_type} />
            <Row label="Registered office" value={company.registered_office} />
            <Row label="Corporate office" value={company.corporate_office} />
            <Row label="Telephone" value={company.phone} mono />
            <Row label="Verify us"
              value={<a className="text-[#0b3b8c] font-semibold hover:underline" href={company.verify_at}
                rel="noreferrer noopener" target="_blank">MCA register (mca.gov.in)</a>} />
          </dl>
          <div className="px-6 py-3 border-t border-slate-100 text-[11px] text-slate-500 bg-slate-50 flex items-start gap-2">
            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            Check the Corporate Identity Number above on the MCA register before you deposit money with
            anyone, including us.
          </div>
        </div>

      </div>
    </div>
  );
}

function Row({ label, value, mono }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={`text-slate-900 mt-0.5 ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  );
}
