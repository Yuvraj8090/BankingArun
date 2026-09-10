import React, { useState } from 'react';
import {
  ShieldCheck, ArrowRight, Lock, UserPlus, Calculator, PiggyBank,
  Banknote, CreditCard, CheckCircle2, Globe, Award, Home as HomeIcon,
  Car, GraduationCap, Briefcase, TrendingUp, Umbrella, ChevronRight,
  Phone, HelpCircle
} from 'lucide-react';

export default function PublicHomePage({ onOpenAuth, onNavigatePublic }) {
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

  const products = [
    { icon: PiggyBank, label: 'Savings Account', desc: 'Zero balance, up to 4% p.a.', color: 'text-blue-800' },
    { icon: HomeIcon, label: 'Home Loan', desc: 'From 8.40% p.a. · 30 yrs', color: 'text-emerald-700' },
    { icon: Car, label: 'Vehicle Loan', desc: 'Instant approval · 8.75%', color: 'text-slate-700' },
    { icon: CreditCard, label: 'Debit / Credit Card', desc: 'Reward points, offers', color: 'text-[#c8102e]' },
    { icon: TrendingUp, label: 'Fixed Deposit', desc: 'Up to 7.75% for seniors', color: 'text-blue-800' },
    { icon: Briefcase, label: 'Corporate Banking', desc: 'Bulk NEFT · Trade finance', color: 'text-slate-700' },
    { icon: GraduationCap, label: 'Education Loan', desc: 'Study in India / Abroad', color: 'text-emerald-700' },
    { icon: Umbrella, label: 'Insurance', desc: 'Term · Health · Motor', color: 'text-[#c8102e]' }
  ];

  const quickLinks = [
    'Open Savings Account', 'Apply for Loan', 'Book a Fixed Deposit',
    'Get a Credit Card', 'Pay Bills / Recharge', 'Fund Transfer (NEFT/RTGS/IMPS/UPI)',
    'Cheque Book Request', 'Update KYC / Aadhaar'
  ];

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

      {/* Hero — clean white, ICICI style */}
      <section className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 lg:py-14 grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">

          <div className="lg:col-span-7 space-y-5">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 text-blue-800 text-[11px] font-semibold border border-blue-100">
              <Award className="w-3.5 h-3.5" />
              Rated India's Simplest Digital Banking Experience
            </div>

            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-slate-900 leading-tight tracking-tight">
              Banking made <span className="text-[#0b3b8c]">simple</span>,
              <br className="hidden sm:inline" /> secure & <span className="text-[#c8102e]">Bharat-ready</span>.
            </h1>

            <p className="text-sm sm:text-base text-slate-600 max-w-2xl leading-relaxed">
              Open an account in minutes, transfer funds through NEFT · RTGS · IMPS · UPI, book FDs at industry-leading rates, and manage cards, cheques and loans — all from one modern portal designed for every Indian.
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                data-testid="hero-open-account-btn"
                onClick={() => onOpenAuth(true)}
                className="px-6 py-3 rounded-md bg-[#0b3b8c] hover:bg-[#092e6f] text-white text-sm font-semibold shadow-sm flex items-center gap-2 transition"
              >
                <UserPlus className="w-4 h-4" /> Open Instant Account
              </button>
              <button
                data-testid="hero-login-btn"
                onClick={() => onOpenAuth(false)}
                className="px-6 py-3 rounded-md border border-slate-300 bg-white hover:border-[#0b3b8c] hover:text-[#0b3b8c] text-slate-800 text-sm font-semibold flex items-center gap-2 transition"
              >
                <Lock className="w-4 h-4" /> NetBanking Login
              </button>
            </div>

            <div className="pt-6 flex flex-wrap items-center gap-6 text-xs text-slate-600 border-t border-slate-100 mt-4">
              <div className="flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-emerald-600" /> 256-bit SSL Encryption</div>
              <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-blue-800" /> RBI Compliant</div>
              <div className="flex items-center gap-2"><Globe className="w-4 h-4 text-slate-700" /> Hostinger cPanel Ready</div>
            </div>
          </div>

          {/* Right card — quick services (ICICI-style card) */}
          <div className="lg:col-span-5">
            <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-slate-900">Quick Services</h3>
                <span className="text-[11px] text-slate-500">No login needed</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {quickLinks.map((q, idx) => (
                  <button
                    key={idx}
                    data-testid={`quicklink-${idx}`}
                    onClick={() => onOpenAuth(true)}
                    className="text-left px-3 py-2.5 rounded-md border border-slate-200 hover:border-[#0b3b8c] hover:bg-blue-50/60 text-xs text-slate-700 hover:text-[#0b3b8c] transition flex items-center justify-between gap-1"
                  >
                    <span className="line-clamp-2">{q}</span>
                    <ChevronRight className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                  </button>
                ))}
              </div>

              <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 text-slate-600">
                  <Phone className="w-3.5 h-3.5" /> 24×7 Toll-Free
                </div>
                <span className="font-semibold text-[#0b3b8c]">1800-123-4567</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Product Grid — sober bank cards */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-slate-900">Explore our banking products</h2>
          <p className="text-sm text-slate-600 mt-1">Everything you need for personal finance, retail operations and corporate treasury.</p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {products.map((p, idx) => (
            <button
              key={idx}
              data-testid={`product-card-${idx}`}
              onClick={() => onOpenAuth(true)}
              className="bg-white border border-slate-200 rounded-lg p-5 text-left hover:border-[#0b3b8c] hover:shadow-md transition group"
            >
              <div className={`w-10 h-10 rounded-md bg-slate-50 border border-slate-100 flex items-center justify-center ${p.color} group-hover:scale-105 transition`}>
                <p.icon className="w-5 h-5" />
              </div>
              <h3 className="font-semibold text-slate-900 text-sm mt-3">{p.label}</h3>
              <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">{p.desc}</p>
              <div className="flex items-center gap-1 mt-3 text-[11px] text-[#0b3b8c] font-semibold">
                Know more <ChevronRight className="w-3 h-3" />
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Calculator Section — subtle bg */}
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
                <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Same formulas used by SBI, ICICI, HDFC
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

            <button
              onClick={() => onOpenAuth(true)}
              data-testid="calc-apply-btn"
              className="w-full mt-4 py-2.5 rounded-md bg-[#c8102e] hover:bg-[#a30d25] text-white text-xs font-semibold"
            >
              Apply Online in 2 Minutes →
            </button>
          </div>

        </div>
      </section>

      {/* Trust / Awards strip */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { n: '1 Cr+', l: 'Active Customers' },
            { n: '5000+', l: 'Branches & ATMs' },
            { n: '₹1.5 Lakh Cr', l: 'Total Deposits Managed' },
            { n: 'AAA', l: 'CRISIL / ICRA Rating' }
          ].map((s, i) => (
            <div key={i} className="bg-white border border-slate-200 rounded-lg p-5 text-center">
              <div className="text-2xl font-bold text-[#0b3b8c]">{s.n}</div>
              <div className="text-xs text-slate-600 mt-1">{s.l}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Hostinger deployment banner — sober */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
        <div className="bg-white border border-slate-200 rounded-lg p-6 sm:p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 shadow-sm">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded bg-blue-50 border border-blue-100 text-blue-800 text-[11px] font-semibold">
              <Globe className="w-3.5 h-3.5" /> Deploy anywhere
            </div>
            <h3 className="text-xl font-bold text-slate-900">Ready-to-deploy PHP + MySQL package for Hostinger</h3>
            <p className="text-xs text-slate-600 max-w-2xl">
              Download a cPanel-ready bundle with schema.sql, api.php, db.php, .htaccess and a step-by-step INSTALL guide — the entire banking stack running on Hostinger shared hosting.
            </p>
          </div>
          <button
            data-testid="public-hostinger-btn"
            onClick={() => onNavigatePublic('hostinger')}
            className="px-5 py-3 rounded-md bg-[#0b3b8c] hover:bg-[#092e6f] text-white text-xs font-semibold whitespace-nowrap flex items-center gap-2 shadow-sm"
          >
            View Deployment Package <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </section>

      {/* FAQ / support strip */}
      <section className="bg-white border-t border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 grid grid-cols-1 md:grid-cols-3 gap-6 text-sm">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-md bg-blue-50 border border-blue-100 flex items-center justify-center text-[#0b3b8c]">
              <HelpCircle className="w-5 h-5" />
            </div>
            <div>
              <div className="font-semibold text-slate-900">Need help?</div>
              <div className="text-xs text-slate-600">FAQs · Grievance redressal · Chatbot support</div>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-md bg-blue-50 border border-blue-100 flex items-center justify-center text-[#0b3b8c]">
              <Phone className="w-5 h-5" />
            </div>
            <div>
              <div className="font-semibold text-slate-900">Talk to us</div>
              <div className="text-xs text-slate-600">Toll-free 1800-123-4567 · 24×7</div>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-md bg-blue-50 border border-blue-100 flex items-center justify-center text-[#0b3b8c]">
              <Banknote className="w-5 h-5" />
            </div>
            <div>
              <div className="font-semibold text-slate-900">Secure banking</div>
              <div className="text-xs text-slate-600">Report fraud · Block card · Freeze account</div>
            </div>
          </div>
        </div>
      </section>

    </div>
  );
}
