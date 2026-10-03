import React, { useState, useEffect, useCallback } from 'react';
import { Search, User, PiggyBank, Calculator } from 'lucide-react';
import { api } from '../services/api';
import { useBankTheme } from '../context/BankThemeContext';
import { toast } from 'sonner';

// Staff-assisted counter booking: a teller types a member's account number,
// the member's identity, KYC status and existing FD/RD/MIS holdings are
// fetched automatically, and the teller books a new deposit against that
// same account -- mirroring the member's own self-service form on the
// Deposits page, but priced and booked through the staff-only endpoints.
export default function StaffBookDepositPage() {
  const { currentTheme } = useBankTheme();

  const [accountNumber, setAccountNumber] = useState('');
  const [looking, setLooking] = useState(false);
  const [member, setMember] = useState(null);
  const [lookupError, setLookupError] = useState('');

  const [misScheme, setMisScheme] = useState(null);
  // A daily-% plan: no amount list, any amount at or above its minimum.
  const [dailyScheme, setDailyScheme] = useState(null);
  const [dailyAmount, setDailyAmount] = useState('');
  const [depositType, setDepositType] = useState('fixed');
  const [amount, setAmount] = useState(50000);
  const [tenure, setTenure] = useState(12);
  const [misUnit, setMisUnit] = useState('');
  const [nominee, setNominee] = useState('Registered Nominee');
  const [booking, setBooking] = useState(false);

  useEffect(() => {
    api.publicSchemes()
      .then((res) => {
        // Slab-priced MIS only: a daily-% plan has no amount list to pick from
        // here, and without this it sorts first and leaves the dropdown empty.
        const mis = (res.schemes || []).find((s) => s.scheme_type === 'mis' && s.daily_rate_percent == null);
        if (mis) {
          setMisScheme(mis);
          setMisUnit(String(mis.slabs?.[0]?.unit || ''));
        }
        const daily = (res.schemes || []).find((s) => s.daily_rate_percent != null);
        if (daily) {
          setDailyScheme(daily);
          setDailyAmount(String(daily.principal_amount || ''));
        }
      })
      .catch(() => {});
  }, []);

  // Debounced auto-fetch: look the member up a moment after the teller stops typing,
  // rather than on every keystroke or requiring an explicit search click.
  useEffect(() => {
    const acc = accountNumber.trim();
    setLookupError('');
    if (acc.length < 6) {
      setMember(null);
      return;
    }
    setLooking(true);
    const handle = setTimeout(async () => {
      try {
        const res = await api.staffMemberLookup(acc);
        setMember(res);
      } catch (err) {
        setMember(null);
        setLookupError(err.response?.data?.detail || 'No member account with that number.');
      } finally {
        setLooking(false);
      }
    }, 500);
    return () => clearTimeout(handle);
  }, [accountNumber]);

  const refreshLookup = useCallback(async () => {
    const acc = accountNumber.trim();
    if (!acc) return;
    try {
      setMember(await api.staffMemberLookup(acc));
    } catch (err) {
      // Booking already succeeded; a refresh failure here isn't worth alarming the teller over.
    }
  }, [accountNumber]);

  const misSlab = depositType === 'mis' ? (misScheme?.slabs || []).find((s) => String(s.unit) === String(misUnit)) : null;

  const calculateMaturity = () => {
    if (depositType === 'daily') {
      const p = parseFloat(dailyAmount) || 0;
      return {
        rate: dailyScheme.effective_rate_pa ?? 0,
        dailyCredit: Math.round(p * dailyScheme.daily_rate_percent) / 100,
        total: Math.round(p),
      };
    }
    if (depositType === 'mis') {
      if (!misSlab) return { rate: 0, total: 0, monthlyPayout: 0 };
      return {
        rate: misSlab.effective_rate_pa ?? 0,
        total: Math.round(misSlab.deposit + misSlab.maturity),
        monthlyPayout: misSlab.monthly_payout ?? 0,
      };
    }
    const rate = tenure < 12 ? 6.50 : tenure <= 24 ? 7.25 : tenure <= 36 ? 7.50 : 7.10;
    const p = parseFloat(amount) || 0;
    const t = tenure / 12.0;
    const r = rate / 100.0;
    const maturity = p * Math.pow((1 + r / 4), (4 * t));
    return { rate, total: Math.round(maturity) };
  };
  const maturityCalc = calculateMaturity();

  const handleBook = async (e) => {
    e.preventDefault();
    if (!member) {
      toast.error('Look up a member account first');
      return;
    }
    if (depositType === 'daily') {
      if (!dailyScheme || !(parseFloat(dailyAmount) >= dailyScheme.principal_amount)) {
        toast.error(`Minimum deposit for this plan is ₹${Number(dailyScheme?.principal_amount || 0).toLocaleString('en-IN')}`);
        return;
      }
    } else if (depositType === 'mis') {
      if (!misScheme || !misSlab) {
        toast.error('Choose an MIS amount');
        return;
      }
    } else if (!amount || amount < 5000) {
      toast.error('Minimum deposit amount is ₹5,000');
      return;
    }
    setBooking(true);
    try {
      const res = await api.staffBookDeposit(
        depositType === 'daily'
          ? { account_number: accountNumber.trim(), scheme_code: dailyScheme.code, amount: parseFloat(dailyAmount), nominee_name: nominee }
          : depositType === 'mis'
          ? { account_number: accountNumber.trim(), scheme_code: misScheme.code, amount: misSlab.unit, nominee_name: nominee }
          : {
              account_number: accountNumber.trim(),
              deposit_type: depositType,
              amount: parseFloat(amount),
              tenure_months: parseInt(tenure),
              nominee_name: nominee,
            }
      );
      toast.success(res.message);
      await refreshLookup();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Booking failed');
    } finally {
      setBooking(false);
    }
  };

  const summary = member?.deposit_summary;

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-xl">
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Book Member Deposit</h1>
        <p className="text-xs text-slate-500 mt-1">
          Look up a member by their savings account number and book an FD, RD or MIS on their behalf at the counter.
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xl space-y-4">
        <label className="block text-slate-500 text-xs mb-1">Member Account Number</label>
        <div className="relative max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            data-testid="staff-book-deposit-account-input"
            type="text"
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value)}
            placeholder="e.g. AJSP0580987938"
            className="w-full bg-white border border-slate-200 rounded-xl pl-9 pr-3 py-2.5 text-slate-900 font-mono"
          />
        </div>
        {looking && <p className="text-xs text-slate-400">Looking up member…</p>}
        {lookupError && <p className="text-xs text-rose-600">{lookupError}</p>}

        {member && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            <div className="p-4 rounded-xl bg-white border border-slate-200 space-y-2 text-xs">
              <div className="flex items-center gap-2 text-slate-900 font-semibold text-sm">
                <User className="w-4 h-4 text-[#0b3b8c]" />
                {member.member.name}
              </div>
              <div className="flex justify-between text-slate-500">
                <span>Account:</span>
                <span className="font-mono text-slate-900">{member.account.account_number}</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>Balance:</span>
                <span className="font-semibold text-slate-900">₹{member.account.balance.toLocaleString('en-IN')}</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>KYC Status:</span>
                <span className={`font-semibold ${member.kyc.status === 'verified' ? 'text-emerald-700' : 'text-amber-600'}`}>
                  {member.kyc.status}
                </span>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-white border border-slate-200 space-y-2 text-xs">
              <div className="flex items-center gap-2 text-slate-900 font-semibold text-sm">
                <PiggyBank className="w-4 h-4 text-[#0b3b8c]" />
                Existing Deposit Holdings
              </div>
              <div className="flex justify-between text-slate-500">
                <span>Fixed Deposits:</span>
                <span className="font-semibold text-slate-900">₹{(summary?.fixed || 0).toLocaleString('en-IN')}</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>Recurring Deposits:</span>
                <span className="font-semibold text-slate-900">₹{(summary?.recurring || 0).toLocaleString('en-IN')}</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>Monthly Income Scheme:</span>
                <span className="font-semibold text-slate-900">₹{(summary?.mis || 0).toLocaleString('en-IN')}</span>
              </div>
              <div className="flex justify-between pt-1 border-t border-slate-200">
                <span className="font-bold text-slate-900">Total Locked:</span>
                <span className="font-extrabold text-[#0b3b8c]">₹{(summary?.total || 0).toLocaleString('en-IN')}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {member && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl p-6 shadow-xl space-y-4">
            <h2 className="font-bold text-slate-900 text-sm pb-2 border-b border-slate-200">
              Book Fixed / Recurring / MIS Deposit
            </h2>

            <form onSubmit={handleBook} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-500 mb-1">Deposit Type</label>
                <select
                  data-testid="staff-deposit-type-select"
                  value={depositType}
                  onChange={(e) => setDepositType(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900 font-semibold"
                >
                  <option value="fixed">Fixed Deposit (Lumpsum Principal)</option>
                  <option value="recurring">Recurring Deposit (Monthly Installment)</option>
                  {misScheme && <option value="mis">Monthly Income Scheme ({misScheme.name})</option>}
                  {dailyScheme && <option value="daily">Daily Income Plan ({dailyScheme.name})</option>}
                </select>
              </div>

              {depositType === 'daily' ? (
                <div>
                  <label className="block text-slate-500 mb-1">
                    Amount to Lock (₹, minimum ₹{Number(dailyScheme.principal_amount).toLocaleString('en-IN')})
                  </label>
                  <input
                    data-testid="staff-daily-amount-input"
                    type="number"
                    min={dailyScheme.principal_amount}
                    step="1000"
                    required
                    value={dailyAmount}
                    onChange={(e) => setDailyAmount(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900 font-bold"
                  />
                </div>
              ) : depositType === 'mis' ? (
                <div>
                  <label className="block text-slate-500 mb-1">Amount to Lock (₹)</label>
                  <select
                    data-testid="staff-mis-unit-select"
                    value={misUnit}
                    onChange={(e) => setMisUnit(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900 font-semibold"
                  >
                    {(misScheme?.slabs || []).map((sl) => (
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
                      data-testid="staff-fd-amount-input"
                      type="number"
                      min="5000"
                      step="1000"
                      required
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900 font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-500 mb-1">Tenure (Months)</label>
                    <select
                      value={tenure}
                      onChange={(e) => setTenure(e.target.value)}
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
                  value={nominee}
                  onChange={(e) => setNominee(e.target.value)}
                  placeholder="Enter Nominee Name"
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900"
                />
              </div>

              <button
                data-testid="staff-book-deposit-btn"
                type="submit"
                disabled={booking}
                className={`w-full py-3 rounded-xl ${currentTheme.buttonTheme} font-bold text-sm shadow-xl`}
              >
                {booking ? 'Issuing Deposit Certificate...' : `Book for ${member.member.name}`}
              </button>
            </form>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xl text-xs space-y-4">
            <h3 className="font-bold text-slate-900 text-sm pb-2 border-b border-slate-200 flex items-center gap-2">
              <Calculator className="w-4 h-4 text-[#0b3b8c]" />
              Maturity Breakdown
            </h3>
            <div className="p-4 rounded-xl bg-white border border-slate-200 space-y-3">
              <div className="flex justify-between text-slate-500">
                <span>Principal Locked:</span>
                <span className="font-semibold text-slate-900">
                  ₹{(depositType === 'daily' ? (parseFloat(dailyAmount) || 0) : depositType === 'mis' ? (misSlab?.unit || 0) : parseFloat(amount || 0)).toLocaleString('en-IN')}
                </span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>Interest Rate:</span>
                <span className="font-bold text-[#0b3b8c]">{maturityCalc.rate}% p.a.</span>
              </div>
              {depositType === 'daily' && (
                <div className="flex justify-between text-slate-500">
                  <span>Daily Credit (before TDS):</span>
                  <span className="font-semibold text-emerald-700">₹{maturityCalc.dailyCredit.toLocaleString('en-IN')}/day</span>
                </div>
              )}
              {depositType === 'mis' && (
                <div className="flex justify-between text-slate-500">
                  <span>Monthly Payout:</span>
                  <span className="font-semibold text-emerald-700">₹{(maturityCalc.monthlyPayout || 0).toLocaleString('en-IN')}/mo</span>
                </div>
              )}
              <div className="pt-2 border-t border-slate-200 flex justify-between text-sm">
                <span className="font-bold text-slate-900">{depositType === 'daily' ? 'Principal Repaid at Maturity:' : depositType === 'mis' ? 'Total Received Over Term:' : 'Maturity Value:'}</span>
                <span className="font-extrabold text-emerald-700">₹{maturityCalc.total.toLocaleString('en-IN')}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
