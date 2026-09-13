import React from 'react';
import { Link } from 'react-router-dom';
import { Percent, FileText, Info, ChevronRight } from 'lucide-react';

export default function PublicRatesPage() {
  const depositRates = [
    { tenure: "7 days to 45 days", general: "3.50%", senior: "4.00%" },
    { tenure: "46 days to 179 days", general: "5.25%", senior: "5.75%" },
    { tenure: "180 days to 364 days", general: "6.50%", senior: "7.00%" },
    { tenure: "1 year to 2 years", general: "7.25%", senior: "7.75%" },
    { tenure: "2 years to 3 years (Special)", general: "7.50%", senior: "8.00%" },
    { tenure: "3 years to 5 years", general: "7.00%", senior: "7.50%" },
    { tenure: "5 years to 10 years (Tax Saver)", general: "7.10%", senior: "7.60%" }
  ];

  const loanRates = [
    { product: "Home Loan (Floating)", roi: "8.40% – 9.15% p.a.", procFee: "0.25% (max ₹10,000)" },
    { product: "Personal Loan", roi: "10.50% – 13.50% p.a.", procFee: "1.00% of loan amount" },
    { product: "Vehicle Loan (4-wheeler)", roi: "8.75% – 9.50% p.a.", procFee: "₹1,500 flat" },
    { product: "Gold Loan (Instant Payout)", roi: "7.90% – 8.50% p.a.", procFee: "Nil" },
    { product: "Education Loan (India)", roi: "9.15% – 10.25% p.a.", procFee: "0.50% of loan amount" }
  ];

  const serviceCharges = [
    { s: "NEFT / RTGS (online)", c: "Nil" },
    { s: "IMPS transfer (up to ₹1 lakh)", c: "₹2.50 + GST" },
    { s: "IMPS transfer (₹1 lakh to ₹5 lakh)", c: "₹15 + GST" },
    { s: "ATM cash withdrawal (own bank)", c: "Free (unlimited)" },
    { s: "ATM cash withdrawal (other bank)", c: "₹21 + GST beyond 5 free/month" },
    { s: "Cheque book (25 leaves)", c: "₹75 + GST" },
    { s: "Duplicate passbook / statement", c: "₹100 + GST" }
  ];

  return (
    <div className="bg-slate-50">

      {/* Breadcrumb / header */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center gap-1.5 text-[11px] text-slate-500 mb-2">
            <span>Home</span> <ChevronRight className="w-3 h-3" /> <span className="text-slate-800">Rates &amp; Charges</span>
          </div>
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-slate-900 tracking-tight">
                Interest Rates &amp; Service Charges
              </h1>
              <p className="text-xs text-slate-600 mt-1">
                Effective from June 2026 · Set by the board under the Nidhi Rules, 2014. Indicative and subject to change.
              </p>
            </div>
            <Link
              data-testid="rates-book-fd-btn"
              to="/personal/fixed-deposits"
              className="px-5 py-2.5 rounded-md bg-[#0b3b8c] hover:bg-[#092e6f] text-white text-xs font-semibold shadow-sm"
            >
              Book High-Yield FD Now
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">

        {/* Fixed Deposit table */}
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center gap-2">
            <Percent className="w-4 h-4 text-[#0b3b8c]" />
            <h2 className="font-semibold text-slate-900 text-sm">Domestic Term Deposit Rates (below ₹2 Crore)</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase text-slate-600">
                <tr>
                  <th className="p-3 font-semibold">Tenure bucket</th>
                  <th className="p-3 font-semibold">General public</th>
                  <th className="p-3 font-semibold text-right">Senior citizens (60+)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {depositRates.map((d, idx) => (
                  <tr key={idx} className="hover:bg-slate-50" data-testid={`fd-rate-row-${idx}`}>
                    <td className="p-3 text-slate-800 text-xs">{d.tenure}</td>
                    <td className="p-3 font-semibold text-[#0b3b8c] text-xs">{d.general}</td>
                    <td className="p-3 text-right font-semibold text-emerald-700 text-xs">{d.senior}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-6 py-3 border-t border-slate-100 text-[11px] text-slate-500 bg-slate-50 flex items-start gap-2">
            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            Rates are indicative and may change without prior notice. TDS is deducted as per Income Tax Act 1961 on interest exceeding ₹40,000 (₹50,000 for seniors) per year.
          </div>
        </div>

        {/* Loans table */}
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center gap-2">
            <FileText className="w-4 h-4 text-[#c8102e]" />
            <h2 className="font-semibold text-slate-900 text-sm">Retail Lending Rates (Repo-linked EBLR)</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase text-slate-600">
                <tr>
                  <th className="p-3 font-semibold">Loan category</th>
                  <th className="p-3 font-semibold">Interest rate range</th>
                  <th className="p-3 font-semibold text-right">Processing fee</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loanRates.map((l, idx) => (
                  <tr key={idx} className="hover:bg-slate-50" data-testid={`loan-rate-row-${idx}`}>
                    <td className="p-3 text-slate-800 text-xs">{l.product}</td>
                    <td className="p-3 font-semibold text-slate-900 text-xs">{l.roi}</td>
                    <td className="p-3 text-right text-slate-600 text-xs">{l.procFee}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Service charges */}
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200">
            <h2 className="font-semibold text-slate-900 text-sm">Common Service Charges</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">A quick reference to help you plan your everyday banking.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 divide-x divide-slate-100 text-xs">
            <div className="divide-y divide-slate-100">
              {serviceCharges.slice(0, Math.ceil(serviceCharges.length/2)).map((s, idx) => (
                <div key={idx} className="px-6 py-3 flex items-center justify-between">
                  <span className="text-slate-800">{s.s}</span>
                  <span className="font-semibold text-slate-900">{s.c}</span>
                </div>
              ))}
            </div>
            <div className="divide-y divide-slate-100">
              {serviceCharges.slice(Math.ceil(serviceCharges.length/2)).map((s, idx) => (
                <div key={idx} className="px-6 py-3 flex items-center justify-between">
                  <span className="text-slate-800">{s.s}</span>
                  <span className="font-semibold text-slate-900">{s.c}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
