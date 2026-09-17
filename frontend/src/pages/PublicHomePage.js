import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import {
  ShieldCheck, ArrowRight, Lock, UserPlus, Calculator, PiggyBank,
  Banknote, CreditCard, CheckCircle2, Fingerprint, HomeIcon,
  Car, GraduationCap, Briefcase, TrendingUp, Umbrella, ChevronRight,
  Phone, HelpCircle, MapPin, Video
} from 'lucide-react';

export default function PublicHomePage() {
  // Unauthenticated: the public features list needs no session.
  const [features, setFeatures] = useState(null);
  useEffect(() => {
    api.publicFeatures().then((d) => setFeatures(d.features)).catch(() => setFeatures([]));
  }, []);

  // Calculators
  const [calcType, setCalcType] = useState('emi');
  const [emiAmount, setEmiAmount] = useState(500000);
  const [emiTenure, setEmiTenure] = useState(36);
  const emiRate = 8.5;
  const r = (emiRate / 12) / 100;
  const monthlyEmi = Math.round((emiAmount * r * Math.pow(1 + r, emiTenure)) / (Math.pow(1 + r, emiTenure) - 1));

  const [fdPrincipal, setFdPrincipal] = useState(100000);
  const [fdTenureMonths, setFdTenureMonths] = useState(24);
  const fdRate = 7.25;
  const fdMaturity = Math.round(fdPrincipal * Math.pow(1 + (fdRate / 400), (4 * (fdTenureMonths / 12))));
  const fdInterest = fdMaturity - fdPrincipal;

  const rateTicker = [
    { label: 'Savings A/C', value: '4.00% p.a.' },
    { label: 'Fixed Deposit (1-2 Yrs)', value: '7.25% p.a.' },
    { label: 'Senior Citizen FD', value: '7.75% p.a.' },
    { label: 'Home Loan', value: '8.40% p.a.' },
    { label: 'Personal Loan', value: '10.50% p.a.' },
    { label: 'Gold Loan', value: '7.90% p.a.' },
    { label: 'USD / INR', value: '₹83.24' },
    { label: 'RBI Repo Rate', value: '6.50%' }
  ];

  // Every product tile is its own page at its own URL.
  const products = [
    { icon: PiggyBank, label: 'Savings Account', desc: 'Zero balance, 4.00% p.a.', to: '/personal/savings-account', color: 'text-blue-800' },
    { icon: HomeIcon, label: 'Home Loan', desc: 'From 8.40% p.a. · 30 yrs', to: '/loans/home-loan', color: 'text-emerald-700' },
    { icon: Car, label: 'Vehicle Loan', desc: 'From 8.75% p.a.', to: '/loans/vehicle-loan', color: 'text-slate-700' },
    { icon: CreditCard, label: 'Debit & Credit Cards', desc: 'Freeze, limits, UPI', to: '/personal/debit-cards', color: 'text-[#c8102e]' },
    { icon: TrendingUp, label: 'Fixed Deposit', desc: 'Up to 7.75% for seniors', to: '/personal/fixed-deposits', color: 'text-blue-800' },
    { icon: Briefcase, label: 'Corporate Banking', desc: 'Bulk NEFT · Trade finance', to: '/corporate/current-account', color: 'text-slate-700' },
    { icon: GraduationCap, label: 'Education Loan', desc: 'Study in India or abroad', to: '/loans/education-loan', color: 'text-emerald-700' },
    { icon: Umbrella, label: 'Insurance', desc: 'Term · Health · Motor', to: '/investments/insurance', color: 'text-[#c8102e]' }
  ];

  // Each shortcut names the capability it needs, so the panel never invites a
  // visitor towards a service this institution is not authorised to offer.
  const ALL_QUICK_LINKS = [
    ['Open Savings Account', '/personal/savings-account', null],
    ['Apply for a Loan', '/loans/personal-loan', 'loans'],
    ['Book a Fixed Deposit', '/personal/fixed-deposits', 'deposits'],
    ['Get a Debit Card', '/personal/debit-cards', 'debit_cards'],
    ['Start a SIP', '/investments/mutual-funds', 'mutual_funds'],
    ['Bulk NEFT / RTGS', '/corporate/bulk-neft-rtgs', 'payment_systems'],
    ['Branch & ATM Locator', '/branches', null],
    ['Rates & Charges', '/rates', null]
  ];
  const quickLinks = ALL_QUICK_LINKS
    .filter(([, , needs]) => !needs || !Array.isArray(features) || features.includes(needs))
    .map(([label, to]) => [label, to]);

  return (
    <div className="bg-slate-50">

      {/* Live rates ticker (marquee) */}
      <div className="bg-white border-b border-slate-200 py-2 overflow-hidden">
        <div className="ticker-track whitespace-nowrap flex text-xs">
          {[...rateTicker, ...rateTicker].map((t, i) => (
            <span key={i} className="mx-8 text-slate-600">
              <span className="font-semibold text-slate-800">{t.label}:</span>{' '}
              <span className="text-[#0b3b8c] font-bold">{t.value}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Hero */}
      <section className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 lg:py-14 grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">

          <div className="lg:col-span-7 space-y-5">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 text-blue-800 text-[11px] font-semibold border border-blue-100">
              <ShieldCheck className="w-3.5 h-3.5" />
              Trust · Growth · Prosperity
            </div>

            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-slate-900 leading-tight tracking-tight">
              Savings made <span className="text-[#0b3b8c]">simple</span>,
              <br className="hidden sm:inline" /> secure &amp; <span className="text-[#c8102e]">India-ready</span>.
            </h1>

            <p className="text-sm sm:text-base text-slate-600 max-w-2xl leading-relaxed">
              Become a member in minutes, move money between member accounts, book fixed and recurring
              deposits at competitive rates, and apply for a loan — all from one modern portal.
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Link
                to="/open-account"
                data-testid="hero-open-account-btn"
                className="px-6 py-3 rounded-md bg-[#0b3b8c] hover:bg-[#092e6f] text-white text-sm font-semibold shadow-sm flex items-center gap-2 transition"
              >
                <UserPlus className="w-4 h-4" /> Open Instant Account
              </Link>
              <Link
                to="/login"
                data-testid="hero-login-btn"
                className="px-6 py-3 rounded-md border border-slate-300 bg-white hover:border-[#0b3b8c] hover:text-[#0b3b8c] text-slate-800 text-sm font-semibold flex items-center gap-2 transition"
              >
                <Lock className="w-4 h-4" /> Member Login
              </Link>
            </div>

            <div className="pt-6 flex flex-wrap items-center gap-6 text-xs text-slate-600 border-t border-slate-100 mt-4">
              <div className="flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-emerald-600" /> 256-bit SSL encryption</div>
              <div className="flex items-center gap-2"><Fingerprint className="w-4 h-4 text-blue-800" /> Passkey sign-in</div>
              <div className="flex items-center gap-2"><Video className="w-4 h-4 text-slate-700" /> Video KYC, no branch visit</div>
            </div>
          </div>

          {/* Right card — quick services */}
          <div className="lg:col-span-5">
            <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-slate-900">Quick Services</h3>
                <span className="text-[11px] text-slate-500">No login needed</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {quickLinks.map(([label, to], idx) => (
                  <Link
                    key={to}
                    to={to}
                    data-testid={`quicklink-${idx}`}
                    className="text-left px-3 py-2.5 rounded-md border border-slate-200 hover:border-[#0b3b8c] hover:bg-blue-50/60 text-xs text-slate-700 hover:text-[#0b3b8c] transition flex items-center justify-between gap-1"
                  >
                    <span className="line-clamp-2">{label}</span>
                    <ChevronRight className="w-3.5 h-3.5 shrink-0 text-slate-500" />
                  </Link>
                ))}
              </div>

              <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 text-slate-600">
                  <Phone className="w-3.5 h-3.5" /> 24×7 Toll-Free
                </div>
                <a href="tel:18001234567" className="font-semibold text-[#0b3b8c]">9105015464</a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Product Grid */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-slate-900">Explore what we offer members</h2>
          <p className="text-sm text-slate-600 mt-1">Everything you need for personal finance, retail operations and corporate treasury.</p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {products.map((p, idx) => (
            <Link
              key={p.to}
              to={p.to}
              data-testid={`product-card-${idx}`}
              className="bg-white border border-slate-200 rounded-lg p-5 text-left hover:border-[#0b3b8c] hover:shadow-md transition group block"
            >
              <div className={`w-10 h-10 rounded-md bg-slate-50 border border-slate-100 flex items-center justify-center ${p.color} group-hover:scale-105 transition`}>
                <p.icon className="w-5 h-5" />
              </div>
              <h3 className="font-semibold text-slate-900 text-sm mt-3">{p.label}</h3>
              <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">{p.desc}</p>
              <div className="flex items-center gap-1 mt-3 text-[11px] text-[#0b3b8c] font-semibold">
                Know more <ChevronRight className="w-3 h-3" />
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Calculators */}
      <section className="bg-white border-y border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">

          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-100 text-slate-700 text-[11px] font-semibold">
              <Calculator className="w-3.5 h-3.5" /> Plan smarter
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mt-3">
              Free calculators for every big decision.
            </h2>
            <p className="text-sm text-slate-600 mt-2 max-w-lg">
              Estimate monthly EMIs before you apply for a loan, or find out exactly what your fixed deposit will grow to on maturity.
            </p>

            <div className="mt-6 space-y-2 text-sm">
              <div className="flex items-center gap-2 text-slate-700">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" /> No paperwork · Instant results
              </div>
              <div className="flex items-center gap-2 text-slate-700">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" /> The same formulas used on your statements
              </div>
              <div className="flex items-center gap-2 text-slate-700">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Apply online after previewing your EMI
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-6">
            <div className="flex gap-2 p-1 rounded-md bg-slate-100 mb-5 text-xs">
              <button
                data-testid="public-calc-tab-emi"
                onClick={() => setCalcType('emi')}
                className={`flex-1 px-3 py-1.5 rounded font-semibold transition ${
                  calcType === 'emi' ? 'bg-white shadow-sm text-[#0b3b8c]' : 'text-slate-600'
                }`}
              >
                Loan EMI
              </button>
              <button
                data-testid="public-calc-tab-fd"
                onClick={() => setCalcType('fd')}
                className={`flex-1 px-3 py-1.5 rounded font-semibold transition ${
                  calcType === 'fd' ? 'bg-white shadow-sm text-[#0b3b8c]' : 'text-slate-600'
                }`}
              >
                FD Returns
              </button>
            </div>

            {calcType === 'emi' ? (
              <div className="space-y-5 text-xs">
                <div>
                  <div className="flex justify-between text-slate-700 mb-1">
                    <span>Loan Amount</span>
                    <span className="font-bold text-[#0b3b8c] text-sm">₹{emiAmount.toLocaleString('en-IN')}</span>
                  </div>
                  <input type="range" min="50000" max="5000000" step="25000"
                    value={emiAmount} onChange={(e) => setEmiAmount(Number(e.target.value))}
                    className="w-full accent-blue-800 cursor-pointer" />
                </div>
                <div>
                  <div className="flex justify-between text-slate-700 mb-1">
                    <span>Tenure ({emiTenure} months / {(emiTenure/12).toFixed(1)} yrs)</span>
                    <span className="font-bold text-[#0b3b8c]">{emiRate}% p.a.</span>
                  </div>
                  <input type="range" min="12" max="120" step="6"
                    value={emiTenure} onChange={(e) => setEmiTenure(Number(e.target.value))}
                    className="w-full accent-blue-800 cursor-pointer" />
                </div>
                <div className="p-4 rounded-md bg-blue-50 border border-blue-100 text-center">
                  <p className="text-slate-600 text-[11px]">Estimated Monthly EMI</p>
                  <h3 data-testid="public-emi-result" className="text-3xl font-bold text-[#0b3b8c] mt-1">
                    ₹{monthlyEmi.toLocaleString('en-IN')}
                  </h3>
                </div>
              </div>
            ) : (
              <div className="space-y-5 text-xs">
                <div>
                  <div className="flex justify-between text-slate-700 mb-1">
                    <span>Principal Deposit</span>
                    <span className="font-bold text-[#0b3b8c] text-sm">₹{fdPrincipal.toLocaleString('en-IN')}</span>
                  </div>
                  <input type="range" min="10000" max="1000000" step="10000"
                    value={fdPrincipal} onChange={(e) => setFdPrincipal(Number(e.target.value))}
                    className="w-full accent-blue-800 cursor-pointer" />
                </div>
                <div>
                  <div className="flex justify-between text-slate-700 mb-1">
                    <span>Tenure ({fdTenureMonths} months)</span>
                    <span className="font-bold text-[#0b3b8c]">{fdRate}% p.a.</span>
                  </div>
                  <input type="range" min="6" max="60" step="6"
                    value={fdTenureMonths} onChange={(e) => setFdTenureMonths(Number(e.target.value))}
                    className="w-full accent-blue-800 cursor-pointer" />
                </div>
                <div className="p-4 rounded-md bg-blue-50 border border-blue-100 text-center">
                  <p className="text-slate-600 text-[11px]">Maturity Payout</p>
                  <h3 data-testid="public-fd-result" className="text-3xl font-bold text-[#0b3b8c] mt-1">
                    ₹{fdMaturity.toLocaleString('en-IN')}
                  </h3>
                  <p className="text-[11px] text-emerald-700 font-semibold mt-1">
                    +₹{fdInterest.toLocaleString('en-IN')} interest earned
                  </p>
                </div>
              </div>
            )}

            <Link
              to="/open-account"
              data-testid="calc-apply-btn"
              className="block text-center w-full mt-4 py-2.5 rounded-md bg-[#c8102e] hover:bg-[#a30d25] text-white text-xs font-semibold"
            >
              Apply Online in 2 Minutes →
            </Link>
          </div>

        </div>
      </section>

      {/* What you actually get — product facts, not marketing numbers */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { n: '4.00%', l: 'Savings interest p.a.', to: '/personal/savings-account' },
            { n: '7.75%', l: 'Peak FD rate for seniors', to: '/personal/fixed-deposits' },
            { n: '24×7', l: 'IMPS & UPI transfers', to: '/personal/savings-account' },
            { n: '₹0', l: 'Minimum balance', to: '/personal/salary-account' }
          ].map((s) => (
            <Link key={s.l} to={s.to} className="bg-white border border-slate-200 rounded-lg p-5 text-center hover:border-[#0b3b8c] transition">
              <div className="text-2xl font-bold text-[#0b3b8c]">{s.n}</div>
              <div className="text-xs text-slate-600 mt-1">{s.l}</div>
            </Link>
          ))}
        </div>
      </section>

      {/* Support strip */}
      <section className="bg-white border-t border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 grid grid-cols-1 md:grid-cols-3 gap-6 text-sm">
          <Link to="/support/grievance-redressal" className="flex items-start gap-3 group">
            <div className="w-10 h-10 rounded-md bg-blue-50 border border-blue-100 flex items-center justify-center text-[#0b3b8c]">
              <HelpCircle className="w-5 h-5" />
            </div>
            <div>
              <div className="font-semibold text-slate-900 group-hover:text-[#0b3b8c]">Need help?</div>
              <div className="text-xs text-slate-600">Grievance redressal · Complaint tracking · Chatbot</div>
            </div>
          </Link>
          <a href="tel:18001234567" className="flex items-start gap-3 group">
            <div className="w-10 h-10 rounded-md bg-blue-50 border border-blue-100 flex items-center justify-center text-[#0b3b8c]">
              <Phone className="w-5 h-5" />
            </div>
            <div>
              <div className="font-semibold text-slate-900 group-hover:text-[#0b3b8c]">Talk to us</div>
              <div className="text-xs text-slate-600">Toll-free 9105015464 · 24×7</div>
            </div>
          </a>
          <Link to="/branches" className="flex items-start gap-3 group">
            <div className="w-10 h-10 rounded-md bg-blue-50 border border-blue-100 flex items-center justify-center text-[#0b3b8c]">
              <MapPin className="w-5 h-5" />
            </div>
            <div>
              <div className="font-semibold text-slate-900 group-hover:text-[#0b3b8c]">Find a branch or ATM</div>
              <div className="text-xs text-slate-600">Locations, timings and services</div>
            </div>
          </Link>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="bg-white border border-slate-200 rounded-lg p-6 sm:p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 shadow-sm">
          <div className="space-y-2">
            <h3 className="text-xl font-bold text-slate-900">Open your account today</h3>
            <p className="text-xs text-slate-600 max-w-2xl">
              PAN and Aadhaar are all you need to start. Finish verification with video KYC and begin transacting the same day.
            </p>
          </div>
          <Link
            to="/open-account"
            className="px-5 py-3 rounded-md bg-[#0b3b8c] hover:bg-[#092e6f] text-white text-xs font-semibold whitespace-nowrap flex items-center gap-2 shadow-sm"
          >
            Open Instant Account <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </section>

    </div>
  );
}
