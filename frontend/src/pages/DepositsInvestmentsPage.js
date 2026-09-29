import React, { useState, useEffect } from 'react';
import { 
  PiggyBank, TrendingUp, ShieldCheck, Calculator, CheckCircle2, 
  ArrowRight, Shield, Award, Landmark 
} from 'lucide-react';
import { api } from '../services/api';
import { useBankTheme } from '../context/BankThemeContext';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';

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
  const [insuring, setInsuring] = useState('');
  // Monthly Income Scheme: a published plan, priced by its own printed slabs
  // rather than the generic tenure tiers, so it books against a fixed
  // denomination instead of a freeform amount.
  const [misScheme, setMisScheme] = useState(null);
  const [misUnit, setMisUnit] = useState('');
  // A daily-% plan (misScheme.daily_rate_percent set) has no slab table -- any
  // amount at or above the minimum qualifies, so it is typed rather than
  // picked from a dropdown of printed denominations.
  const [misAmount, setMisAmount] = useState('');
  const isDailyMis = fdType === 'mis' && misScheme?.daily_rate_percent != null;
  // Which of the three things this page offers are actually authorised.
  const { features } = useAuth();
  const canInvest = !!features?.includes('mutual_funds');
  const canInsure = !!features?.includes('insurance');

  useEffect(() => {
    const init = async () => {
      try {
        const accRes = await api.getAccounts();
        if (accRes.accounts?.length > 0) {
          setAccounts(accRes.accounts);
          setSelectedAcc(accRes.accounts[0].account_number);
        }
      } catch (err) {
        toast.error('Could not load your accounts');
        return;
      }
      try {
        const schemeRes = await api.publicSchemes();
        const mis = (schemeRes.schemes || []).find(s => s.scheme_type === 'mis' || s.daily_rate_percent != null);
        if (mis) {
          setMisScheme(mis);
          setMisUnit(String(mis.slabs?.[0]?.unit || ''));
          setMisAmount(String(mis.principal_amount || ''));
        }
      } catch (err) {
        // The plan-priced schemes are a bonus on this page, not the page's
        // reason to exist — fixed/recurring booking still works without it.
      }
      // Mutual funds need a SEBI/AMFI registration. When that capability is off
      // the endpoints refuse, which is correct — so don't call them, and don't
      // report a refusal as a failure.
      if (!canInvest) return;
      try {
        setCatalog(await api.getInvestmentCatalog());
        const myRes = await api.getMyPortfolio();
        setMyInvestments(myRes.mutual_funds || []);
      } catch (err) {
        toast.error('Could not load investment services');
      }
    };
    init();
  }, [canInvest]);

  const misSlab = fdType === 'mis' && !isDailyMis
    ? (misScheme?.slabs || []).find(s => String(s.unit) === String(misUnit)) : null;

  // FD Maturity Calculator formula: A = P(1 + r/4)^(4*t)
  const calculateMaturity = () => {
    if (isDailyMis) {
      const p = parseFloat(misAmount) || 0;
      const daily = Math.round(p * (misScheme.daily_rate_percent / 100) * 100) / 100;
      return {
        rate: misScheme.effective_rate_pa ?? 0,
        dailyAmount: daily,
        threshold: misScheme.withdrawal_threshold || null,
        total: Math.round(p),
      };
    }
    if (fdType === 'mis') {
      if (!misSlab) return { rate: 0, interest: 0, total: 0, monthlyPayout: 0 };
      // misSlab.maturity is the sum of monthly payouts only (schema note: "the
      // maturity column is the total received"). The locked principal is repaid
      // separately at term end (cron.php pays out principal_amount on top), so
      // the true total received over the term is principal + monthly payouts.
      return {
        rate: misSlab.effective_rate_pa ?? 0,
        interest: Math.round(misSlab.maturity),
        total: Math.round(misSlab.deposit + misSlab.maturity),
        monthlyPayout: misSlab.monthly_payout ?? 0,
      };
    }
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
    if (!selectedAcc) {
      toast.error("Select an account to debit");
      return;
    }
    if (isDailyMis) {
      if (!misScheme || !misAmount || parseFloat(misAmount) < misScheme.principal_amount) {
        toast.error(`Minimum deposit for this plan is ₹${Number(misScheme?.principal_amount || 0).toLocaleString('en-IN')}`);
        return;
      }
    } else if (fdType === 'mis') {
      if (!misScheme || !misSlab) {
        toast.error("Choose an MIS amount");
        return;
      }
    } else if (!fdAmount || fdAmount < 5000) {
      toast.error("Minimum deposit amount is ₹5,000");
      return;
    }
    setBooking(true);
    try {
      const res = await api.bookDeposit(
        fdType === 'mis'
          ? {
              account_number: selectedAcc, scheme_code: misScheme.code,
              amount: isDailyMis ? parseFloat(misAmount) : misSlab.unit, nominee_name: fdNominee,
            }
          : {
              account_number: selectedAcc,
              deposit_type: fdType,
              amount: parseFloat(fdAmount),
              tenure_months: parseInt(fdTenure),
              nominee_name: fdNominee
            }
      );
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

  const handleApplyInsurance = async (plan) => {
    if (!selectedAcc) {
      toast.error('Select an account to debit, on the Deposits tab');
      return;
    }
    setInsuring(plan.id);
    try {
      const res = await api.buyInsurance({ account_number: selectedAcc, plan_id: plan.id });
      toast.success(res.message);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Could not apply for this policy');
    } finally {
      setInsuring('');
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      
      {/* Header */}
      <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            {canInvest || canInsure ? 'Deposits, Mutual Funds & Insurance' : 'Member Deposits'}
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            {canInvest || canInsure
              ? 'Fixed and recurring deposits, mutual funds and term cover'
              : 'Fixed and recurring deposits for members · interest credited automatically'}
          </p>
        </div>

        <div className="flex items-center gap-2 p-1 rounded-xl bg-white border border-slate-200 text-xs">
          <button
            data-testid="tab-fd-rd"
            onClick={() => setActiveTab('fd')}
            className={`px-3 py-1.5 rounded-lg font-medium transition ${
              activeTab === 'fd' ? 'bg-[#0b3b8c] text-white font-semibold' : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            Fixed & Recurring Deposits
          </button>
          {canInvest && (
            <button
              data-testid="tab-mutual-funds"
              onClick={() => setActiveTab('mf')}
              className={`px-3 py-1.5 rounded-lg font-medium transition ${
                activeTab === 'mf' ? 'bg-[#0b3b8c] text-white font-semibold' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              Mutual Funds
            </button>
          )}
          {canInsure && (
            <button
              data-testid="tab-insurance"
              onClick={() => setActiveTab('insurance')}
              className={`px-3 py-1.5 rounded-lg font-medium transition ${
                activeTab === 'insurance' ? 'bg-[#0b3b8c] text-white font-semibold' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              Insurance Products
            </button>
          )}
        </div>
      </div>

      {activeTab === 'fd' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Booking Form */}
          <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl p-6 shadow-xl space-y-4">
            <h2 className="font-bold text-slate-900 text-sm pb-2 border-b border-slate-200 flex justify-between items-center">
              <span>Book Online Fixed / Recurring Deposit</span>
              <span className="text-[#0b3b8c] text-xs font-mono">Member deposits</span>
            </h2>

            <form onSubmit={handleBookDeposit} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-500 mb-1">Debit From Savings Account</label>
                  <select
                    value={selectedAcc}
                    onChange={(e) => setSelectedAcc(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900 font-mono"
                  >
                    {accounts.map(a => (
                      <option key={a.id} value={a.account_number}>
                        {a.account_number} (Bal: ₹{a.balance.toLocaleString('en-IN')})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-500 mb-1">Deposit Type</label>
                  <select
                    data-testid="deposit-type-select"
                    value={fdType}
                    onChange={(e) => setFdType(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900 font-semibold"
                  >
                    <option value="fixed">Fixed Deposit (Lumpsum Principal)</option>
                    <option value="recurring">Recurring Deposit (Monthly Installment)</option>
                    {misScheme && (
                      <option value="mis">
                        {isDailyMis ? `Daily Income Plan (${misScheme.name})` : `Monthly Income Scheme (${misScheme.name})`}
                      </option>
                    )}
                  </select>
                </div>
              </div>

              {isDailyMis ? (
                <div>
                  <label className="block text-slate-500 mb-1">
                    Amount to Lock (₹, minimum ₹{Number(misScheme.principal_amount).toLocaleString('en-IN')})
                  </label>
                  <input
                    data-testid="mis-daily-amount-input"
                    type="number"
                    min={misScheme.principal_amount}
                    step="1000"
                    required
                    value={misAmount}
                    onChange={(e) => setMisAmount(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900 font-bold"
                  />
                </div>
              ) : fdType === 'mis' ? (
                <div>
                  <label className="block text-slate-500 mb-1">Amount to Lock (₹)</label>
                  <select
                    data-testid="mis-unit-select"
                    value={misUnit}
                    onChange={(e) => setMisUnit(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900 font-semibold"
                  >
                    {(misScheme?.slabs || []).map(sl => (
                      <option key={sl.unit} value={sl.unit}>
                        ₹{sl.unit.toLocaleString('en-IN')} → ₹{sl.monthly_payout?.toLocaleString('en-IN')}/month for {misScheme.tenure_months} months
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-slate-500 mb-1">Deposit Principal Amount (₹)</label>
                    <input
                      data-testid="fd-amount-input"
                      type="number"
                      min="5000"
                      step="1000"
                      required
                      value={fdAmount}
                      onChange={(e) => setFdAmount(e.target.value)}
                      placeholder="e.g. 50000"
                      className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900 font-bold"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-500 mb-1">Tenure (Months)</label>
                    <select
                      data-testid="fd-tenure-select"
                      value={fdTenure}
                      onChange={(e) => setFdTenure(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900 font-semibold"
                    >
                      <option value={6}>6 Months (6.50% p.a.)</option>
                      <option value={12}>12 Months / 1 Year (7.25% p.a.)</option>
                      <option value={24}>24 Months / 2 Years (7.25% p.a.)</option>
                      <option value={36}>36 Months / 3 Years (7.50% p.a.)</option>
                      <option value={60}>60 Months / 5 Years (7.10% Tax Saver)</option>
                    </select>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-slate-500 mb-1">Nominee Details</label>
                <input
                  type="text"
                  value={fdNominee}
                  onChange={(e) => setFdNominee(e.target.value)}
                  placeholder="Enter Nominee Name"
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900"
                />
              </div>

              <button
                data-testid="book-fd-btn"
                type="submit"
                disabled={booking}
                className={`w-full py-3 rounded-xl ${currentTheme.buttonTheme} font-bold text-sm shadow-xl`}
              >
                {booking
                  ? 'Issuing Deposit Certificate...'
                  : isDailyMis
                    ? `Instantly Book for ₹${(parseFloat(misAmount) || 0).toLocaleString('en-IN')}`
                    : fdType === 'mis'
                      ? `Instantly Book MIS for ₹${(misSlab?.unit || 0).toLocaleString('en-IN')}`
                      : `Instantly Book ${fdType.toUpperCase()} for ₹${parseFloat(fdAmount || 0).toLocaleString('en-IN')}`}
              </button>
            </form>
          </div>

          {/* Calculator Card */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xl text-xs space-y-4">
            <h3 className="font-bold text-slate-900 text-sm pb-2 border-b border-slate-200 flex items-center gap-2">
              <Calculator className="w-4 h-4 text-[#0b3b8c]" />
              Maturity Breakdown Calculator
            </h3>

            <div className="p-4 rounded-xl bg-white border border-slate-200 space-y-3">
              <div className="flex justify-between text-slate-500">
                <span>Principal Locked:</span>
                <span className="font-semibold text-slate-900">
                  ₹{(isDailyMis ? (parseFloat(misAmount) || 0) : fdType === 'mis' ? (misSlab?.unit || 0) : parseFloat(fdAmount || 0)).toLocaleString('en-IN')}
                </span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>Interest Rate:</span>
                <span className="font-bold text-[#0b3b8c]">{maturityCalc.rate}% p.a.</span>
              </div>
              {isDailyMis ? (
                <div className="flex justify-between text-slate-500">
                  <span>Daily Credit:</span>
                  <span className="font-semibold text-emerald-700">
                    + ₹{maturityCalc.dailyAmount.toLocaleString('en-IN')}/day
                    {maturityCalc.threshold
                      ? ` (paid out once it reaches ₹${Number(maturityCalc.threshold).toLocaleString('en-IN')})`
                      : ' (paid out daily)'}
                  </span>
                </div>
              ) : fdType === 'mis' ? (
                <>
                  <div className="flex justify-between text-slate-500">
                    <span>Monthly Payout:</span>
                    <span className="font-semibold text-emerald-700">₹{(maturityCalc.monthlyPayout || 0).toLocaleString('en-IN')}/mo</span>
                  </div>
                  <div className="flex justify-between text-slate-500">
                    <span>Total Monthly Payouts:</span>
                    <span className="font-semibold text-emerald-700">+ ₹{maturityCalc.interest.toLocaleString('en-IN')}</span>
                  </div>
                  <div className="flex justify-between text-slate-500">
                    <span>Principal Repaid at Maturity:</span>
                    <span className="font-semibold text-slate-900">+ ₹{(misSlab?.deposit || 0).toLocaleString('en-IN')}</span>
                  </div>
                </>
              ) : (
                <div className="flex justify-between text-slate-500">
                  <span>Estimated Interest:</span>
                  <span className="font-semibold text-emerald-700">+ ₹{maturityCalc.interest.toLocaleString('en-IN')}</span>
                </div>
              )}
              <div className="pt-2 border-t border-slate-200 flex justify-between text-sm">
                <span className="font-bold text-slate-900">
                  {isDailyMis ? 'Principal Repaid at Maturity:' : fdType === 'mis' ? 'Total Received Over Term:' : 'Maturity Value:'}
                </span>
                <span data-testid="fd-maturity-value" className="font-extrabold text-emerald-700">
                  ₹{maturityCalc.total.toLocaleString('en-IN')}
                </span>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-cyan-950/40 border border-cyan-500/20 text-[11px] text-[#0b3b8c] space-y-1">
              <p className="font-semibold">Senior Citizen Benefit:</p>
              <p>Additional 0.50% interest auto-applied for customers aged 60+ as per our deposit policy.</p>
            </div>
          </div>

        </div>
      )}

      {activeTab === 'mf' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {catalog.mutual_funds?.map(mf => (
              <div key={mf.id} className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xl space-y-4">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-bold text-slate-900 text-sm">{mf.name}</h3>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-slate-100 text-slate-600 mt-1 inline-block">
                      {mf.category}
                    </span>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-slate-500">3Y CAGR</p>
                    <p className="font-bold text-emerald-700 text-sm">{mf.cagr_3yr}</p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-[11px] p-2.5 rounded-xl bg-white border border-slate-200">
                  <div>
                    <p className="text-slate-500">NAV</p>
                    <p className="font-semibold text-slate-700">₹{mf.nav}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Min SIP</p>
                    <p className="font-semibold text-slate-700">₹{mf.min_sip}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Risk</p>
                    <p className="font-semibold text-amber-600">{mf.risk}</p>
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
            <div key={ins.id} className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xl space-y-4">
              <div className="w-9 h-9 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-[#c8102e]">
                <Shield className="w-5 h-5" />
              </div>

              <div>
                <h3 className="font-bold text-slate-900 text-sm">{ins.name}</h3>
                <p className="text-xs text-slate-500 mt-0.5">{ins.type}</p>
              </div>

              <div className="p-3 rounded-xl bg-white border border-slate-200 space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">Sum Assured:</span>
                  <span className="font-bold text-emerald-700">{ins.cover}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Annual Premium:</span>
                  <span className="font-bold text-slate-900">₹{ins.annual_premium.toLocaleString('en-IN')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Claim Settlement:</span>
                  <span className="font-semibold text-[#0b3b8c]">{ins.claim_ratio}</span>
                </div>
              </div>

              <button
                onClick={() => handleApplyInsurance(ins)}
                disabled={insuring === ins.id}
                className="w-full py-2.5 rounded-xl bg-slate-100 hover:bg-slate-100 text-[#0b3b8c] font-semibold text-xs border border-slate-200 disabled:opacity-50"
              >
                {insuring === ins.id ? 'Applying…' : 'Apply for Policy Cover'}
              </button>
            </div>
          ))}
        </div>
      )}

    </div>
  );
}
