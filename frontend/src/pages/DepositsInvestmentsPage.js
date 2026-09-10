import React, { useState, useEffect } from 'react';
import { 
  PiggyBank, TrendingUp, ShieldCheck, Calculator, CheckCircle2, 
  ArrowRight, Shield, Award, Landmark 
} from 'lucide-react';
import { api } from '../services/api';
import { useBankTheme } from '../context/BankThemeContext';
import { toast } from 'sonner';

export default function DepositsInvestmentsPage() {
  const { currentTheme } = useBankTheme();
  const [activeTab, setActiveTab] = useState('fd'); // fd, mf, insurance
  const [accounts, setAccounts] = useState([]);
  const [catalog, setCatalog] = useState({ mutual_funds: [], insurance_plans: [] });
  const [myInvestments, setMyInvestments] = useState([]);

  // FD Booking Form
  const [fdAmount, setFdAmount] = useState(50000);
  const [fdTenure, setFdTenure] = useState(12);
  const [fdType, setFdType] = useState('fixed');
  const [fdNominee, setFdNominee] = useState('Registered Nominee');
  const [selectedAcc, setSelectedAcc] = useState('');
  const [booking, setBooking] = useState(false);

  useEffect(() => {
    const init = async () => {
      try {
        const accRes = await api.getAccounts();
        if (accRes.accounts?.length > 0) {
          setAccounts(accRes.accounts);
          setSelectedAcc(accRes.accounts[0].account_number);
        }
        const catRes = await api.getInvestmentCatalog();
        setCatalog(catRes);
        const myRes = await api.getMyPortfolio();
        setMyInvestments(myRes.mutual_funds || []);
      } catch (err) {
        toast.error("Failed to load investment services");
      }
    };
    init();
  }, []);

  // FD Maturity Calculator formula: A = P(1 + r/4)^(4*t)
  const calculateMaturity = () => {
    const rate = fdTenure < 12 ? 6.50 : fdTenure <= 24 ? 7.25 : fdTenure <= 36 ? 7.50 : 7.10;
    const p = parseFloat(fdAmount) || 0;
    const t = fdTenure / 12.0;
    const r = rate / 100.0;
    const maturity = p * Math.pow((1 + r / 4), (4 * t));
    return {
      rate,
      interest: Math.round(maturity - p),
      total: Math.round(maturity)
    };
  };

  const maturityCalc = calculateMaturity();

  const handleBookDeposit = async (e) => {
    e.preventDefault();
    if (!fdAmount || fdAmount < 5000 || !selectedAcc) {
      toast.error("Minimum deposit amount is ₹5,000");
      return;
    }
    setBooking(true);
    try {
      const res = await api.bookDeposit({
        account_number: selectedAcc,
        deposit_type: fdType,
        amount: parseFloat(fdAmount),
        tenure_months: parseInt(fdTenure),
        nominee_name: fdNominee
      });
      toast.success(res.message);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Booking failed");
    } finally {
      setBooking(false);
    }
  };

  const handleInvestMutualFund = async (scheme) => {
    if (!selectedAcc) return;
    try {
      const res = await api.investMutualFund({
        account_number: selectedAcc,
        scheme_id: scheme.id,
        scheme_name: scheme.name,
        investment_type: "SIP",
        amount: scheme.min_sip
      });
      toast.success(res.message);
      const myRes = await api.getMyPortfolio();
      setMyInvestments(myRes.mutual_funds || []);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Investment order failed");
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      
      {/* Header */}
      <div className="bg-slate-900/90 border border-slate-800 p-5 rounded-2xl shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
            Deposits, Mutual Funds & Insurance Hub
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Guaranteed Return FDs | Wealth Builder Mutual Funds | Comprehensive Term Cover
          </p>
        </div>

        <div className="flex items-center gap-2 p-1 rounded-xl bg-slate-950 border border-slate-800 text-xs">
          <button
            data-testid="tab-fd-rd"
            onClick={() => setActiveTab('fd')}
            className={`px-3 py-1.5 rounded-lg font-medium transition ${
              activeTab === 'fd' ? 'bg-indigo-600 text-white font-semibold' : 'text-slate-400 hover:text-white'
            }`}
          >
            Fixed & Recurring Deposits
          </button>
          <button
            data-testid="tab-mutual-funds"
            onClick={() => setActiveTab('mf')}
            className={`px-3 py-1.5 rounded-lg font-medium transition ${
              activeTab === 'mf' ? 'bg-indigo-600 text-white font-semibold' : 'text-slate-400 hover:text-white'
            }`}
          >
            Mutual Funds
          </button>
          <button
            data-testid="tab-insurance"
            onClick={() => setActiveTab('insurance')}
            className={`px-3 py-1.5 rounded-lg font-medium transition ${
              activeTab === 'insurance' ? 'bg-indigo-600 text-white font-semibold' : 'text-slate-400 hover:text-white'
            }`}
          >
            Insurance Products
          </button>
        </div>
      </div>

      {activeTab === 'fd' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Booking Form */}
          <div className="lg:col-span-2 bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
            <h2 className="font-bold text-white text-sm pb-2 border-b border-slate-800 flex justify-between items-center">
              <span>Book Online Fixed / Recurring Deposit</span>
              <span className="text-cyan-400 text-xs font-mono">DICGC Insured up to ₹5 Lakh</span>
            </h2>

            <form onSubmit={handleBookDeposit} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-400 mb-1">Debit From Savings Account</label>
                  <select
                    value={selectedAcc}
                    onChange={(e) => setSelectedAcc(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-white font-mono"
                  >
                    {accounts.map(a => (
                      <option key={a.id} value={a.account_number}>
                        {a.account_number} (Bal: ₹{a.balance.toLocaleString('en-IN')})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Deposit Type</label>
                  <select
                    data-testid="deposit-type-select"
                    value={fdType}
                    onChange={(e) => setFdType(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-white font-semibold"
                  >
                    <option value="fixed">Fixed Deposit (Lumpsum Principal)</option>
                    <option value="recurring">Recurring Deposit (Monthly Installment)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-400 mb-1">Deposit Principal Amount (₹)</label>
                  <input
                    data-testid="fd-amount-input"
                    type="number"
                    min="5000"
                    step="1000"
                    required
                    value={fdAmount}
                    onChange={(e) => setFdAmount(e.target.value)}
                    placeholder="e.g. 50000"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-white font-bold"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Tenure (Months)</label>
                  <select
                    data-testid="fd-tenure-select"
                    value={fdTenure}
                    onChange={(e) => setFdTenure(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-white font-semibold"
                  >
                    <option value={6}>6 Months (6.50% p.a.)</option>
                    <option value={12}>12 Months / 1 Year (7.25% p.a.)</option>
                    <option value={24}>24 Months / 2 Years (7.25% p.a.)</option>
                    <option value={36}>36 Months / 3 Years (7.50% p.a.)</option>
                    <option value={60}>60 Months / 5 Years (7.10% Tax Saver)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Nominee Details</label>
                <input
                  type="text"
                  value={fdNominee}
                  onChange={(e) => setFdNominee(e.target.value)}
                  placeholder="Enter Nominee Name"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-white"
                />
              </div>

              <button
                data-testid="book-fd-btn"
                type="submit"
                disabled={booking}
                className={`w-full py-3 rounded-xl ${currentTheme.buttonTheme} font-bold text-sm shadow-xl`}
              >
                {booking ? 'Issuing Deposit Certificate...' : `Instantly Book ${fdType.toUpperCase()} for ₹${parseFloat(fdAmount || 0).toLocaleString('en-IN')}`}
              </button>
            </form>
          </div>

          {/* Calculator Card */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl text-xs space-y-4">
            <h3 className="font-bold text-white text-sm pb-2 border-b border-slate-800 flex items-center gap-2">
              <Calculator className="w-4 h-4 text-cyan-400" />
              Maturity Breakdown Calculator
            </h3>

            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
              <div className="flex justify-between text-slate-400">
                <span>Principal Invested:</span>
                <span className="font-semibold text-white">₹{parseFloat(fdAmount || 0).toLocaleString('en-IN')}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Interest Rate:</span>
                <span className="font-bold text-cyan-400">{maturityCalc.rate}% p.a.</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Estimated Interest:</span>
                <span className="font-semibold text-emerald-400">+ ₹{maturityCalc.interest.toLocaleString('en-IN')}</span>
              </div>
              <div className="pt-2 border-t border-slate-800 flex justify-between text-sm">
                <span className="font-bold text-white">Maturity Value:</span>
                <span data-testid="fd-maturity-value" className="font-extrabold text-emerald-400">
                  ₹{maturityCalc.total.toLocaleString('en-IN')}
                </span>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-cyan-950/40 border border-cyan-500/20 text-[11px] text-cyan-300 space-y-1">
              <p className="font-semibold">Senior Citizen Benefit:</p>
              <p>Additional 0.50% interest auto-applied for customers aged 60+ as per RBI regulations.</p>
            </div>
          </div>

        </div>
      )}

      {activeTab === 'mf' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {catalog.mutual_funds?.map(mf => (
              <div key={mf.id} className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl space-y-4">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-bold text-white text-sm">{mf.name}</h3>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 mt-1 inline-block">
                      {mf.category}
                    </span>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-slate-400">3Y CAGR</p>
                    <p className="font-bold text-emerald-400 text-sm">{mf.cagr_3yr}</p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-[11px] p-2.5 rounded-xl bg-slate-950 border border-slate-800/80">
                  <div>
                    <p className="text-slate-500">NAV</p>
                    <p className="font-semibold text-slate-200">₹{mf.nav}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Min SIP</p>
                    <p className="font-semibold text-slate-200">₹{mf.min_sip}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Risk</p>
                    <p className="font-semibold text-amber-400">{mf.risk}</p>
                  </div>
                </div>

                <button
                  data-testid={`invest-mf-btn-${mf.id}`}
                  onClick={() => handleInvestMutualFund(mf)}
                  className={`w-full py-2 rounded-xl ${currentTheme.buttonTheme} text-xs font-semibold`}
                >
                  Start SIP (₹{mf.min_sip}/mo)
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'insurance' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {catalog.insurance_plans?.map(ins => (
            <div key={ins.id} className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl space-y-4">
              <div className="w-9 h-9 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400">
                <Shield className="w-5 h-5" />
              </div>

              <div>
                <h3 className="font-bold text-white text-sm">{ins.name}</h3>
                <p className="text-xs text-slate-400 mt-0.5">{ins.type}</p>
              </div>

              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-400">Sum Assured:</span>
                  <span className="font-bold text-emerald-400">{ins.cover}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Annual Premium:</span>
                  <span className="font-bold text-white">₹{ins.annual_premium.toLocaleString('en-IN')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Claim Settlement:</span>
                  <span className="font-semibold text-cyan-400">{ins.claim_ratio}</span>
                </div>
              </div>

              <button
                onClick={() => toast.success(`Application initiated for ${ins.name}. Policy documents dispatched!`)}
                className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-300 font-semibold text-xs border border-slate-700"
              >
                Apply for Policy Cover
              </button>
            </div>
          ))}
        </div>
      )}

    </div>
  );
}
