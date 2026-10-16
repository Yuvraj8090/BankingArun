import React, { useState, useEffect } from 'react';
import { Banknote, Calculator, CheckCircle2, FileCheck, ArrowRight } from 'lucide-react';
import { api } from '../services/api';
import { useBankTheme } from '../context/BankThemeContext';
import { toast } from 'sonner';

export default function LoansPage() {
  const { currentTheme } = useBankTheme();
  const [loanType, setLoanType] = useState('gold');
  const [amount, setAmount] = useState(300000);
  const [tenure, setTenure] = useState(36);
  const [monthlyIncome, setMonthlyIncome] = useState(65000);
  const [empType, setEmpType] = useState('Salaried Private Sector');
  const [purpose, setPurpose] = useState('Home Renovation / Appliance Purchase');
  const [submitting, setSubmitting] = useState(false);
  const [applicationResult, setApplicationResult] = useState(null);
  // Past and pending applications -- without this a member who reloads the
  // page, or comes back to apply for a second loan, has no way to see what
  // they already applied for; the success card above only lives in state.
  const [myLoans, setMyLoans] = useState([]);
  // Disbursed loans, each with its EMI schedule (GET /loans/my-applications -> accounts).
  const [loanAccounts, setLoanAccounts] = useState([]);
  const [openSchedule, setOpenSchedule] = useState('');
  const [paying, setPaying] = useState('');
  // Loans against the member's own deposits: which deposits can secure one, and the rate.
  const [pledgeable, setPledgeable] = useState([]);
  const [depositRate, setDepositRate] = useState(null);
  const [pledged, setPledged] = useState('');

  const loadMyLoans = () => {
    api.getMyLoans().then((res) => { setMyLoans(res.loans || []); setLoanAccounts(res.accounts || []); setPledgeable(res.pledgeable || []); setDepositRate(res.deposit_loan_rate ?? null); }).catch(() => {});
  };

  const payEmi = async (loanNumber) => {
    setPaying(loanNumber);
    try { toast.success((await api.payLoanEmi(loanNumber)).message); loadMyLoans(); }
    catch (e) { toast.error(e.response?.data?.detail || 'Could not pay the EMI'); }
    finally { setPaying(''); }
  };

  useEffect(() => {
    loadMyLoans();
  }, []);

  const interestRates = {
    personal: 10.50,
    home: 8.40,
    vehicle: 8.75,
    gold: 7.90,
    deposit: depositRate ?? 9.50
  };

  const rate = interestRates[loanType] || 10.50;
  const security = pledgeable.find((x) => x.deposit_number === pledged) || null;
  const onDeposit = loanType === 'deposit';

  // EMI Formula: [P x R x (1+R)^N]/[(1+R)^N-1]
  const calculateEmi = () => {
    const p = parseFloat(amount) || 0;
    const r = (rate / 12) / 100;
    const n = parseInt(tenure) || 12;
    if (p <= 0 || n <= 0) return 0;
    const emi = (p * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
    return Math.round(emi);
  };

  const monthlyEmi = calculateEmi();
  const totalRepayable = monthlyEmi * tenure;
  const totalInterest = totalRepayable - amount;
  const isEligible = loanType === 'deposit' || (monthlyIncome * 0.5) >= monthlyEmi;

  const handleApplyLoan = async (e) => {
    e.preventDefault();
    if (onDeposit) {
      if (!security) { toast.error('Choose the deposit to borrow against.'); return; }
      if (amount < 1000 || amount > security.max_amount) { toast.error(`Borrow between ₹1,000 and ₹${security.max_amount.toLocaleString('en-IN')} against this deposit.`); return; }
    } else if (amount < 10000 || monthlyIncome < 15000) {
      toast.error("Minimum loan is ₹10,000 and minimum monthly income is ₹15,000.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.applyLoan({
        loan_type: loanType,
        amount_requested: parseFloat(amount),
        tenure_months: parseInt(tenure),
        // A deposit loan is secured on the member's own money; income does not decide it.
        monthly_income: onDeposit ? 0 : parseFloat(monthlyIncome),
        employment_type: onDeposit ? 'Not needed (secured on deposit)' : empType,
        purpose: purpose,
        deposit_number: onDeposit ? pledged : undefined
      });
      setApplicationResult(res);
      toast.success(res.message);
      loadMyLoans();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Loan application failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">

      {/* Header */}
      <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Loans & EMI Calculator
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Secured loans for members: against gold jewellery, property, or your own deposit
          </p>
        </div>

        <div className="flex items-center gap-2 p-1 rounded-xl bg-white border border-slate-200 text-xs">
          {['gold', 'home', 'deposit'].map(t => (
            <button
              key={t}
              data-testid={`loan-type-${t}`}
              onClick={() => { setLoanType(t); setApplicationResult(null); if (t === 'deposit') { setAmount(0); setTenure(1); setPledged(''); } }}
              className={`px-3 py-1.5 rounded-lg font-medium capitalize transition ${
                loanType === t ? 'bg-[#0b3b8c] text-white font-semibold' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              {t === 'deposit' ? 'Against my deposit' : `${t} Loan`}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Interactive Loan Sliders & Application Form */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl p-6 shadow-xl space-y-5">
          <h2 className="font-bold text-slate-900 text-sm pb-2 border-b border-slate-200 flex justify-between items-center">
            <span>Calculate EMI & Submit Instant Application</span>
            <span className="text-emerald-700 text-xs font-mono">Interest Rate: {rate}% p.a.</span>
          </h2>

          <form onSubmit={handleApplyLoan} className="space-y-4 text-xs">

            {onDeposit && (
              <div className="space-y-3 p-4 rounded-xl bg-blue-50 border border-blue-100">
                {pledgeable.length === 0 ? (
                  <p className="text-slate-700">You have no active deposit that can secure a loan. Book a deposit first; you can borrow up to 90% of what you have paid into it.</p>
                ) : (<>
                  <div>
                    <label className="block text-slate-600 mb-1" htmlFor="loan-deposit">Deposit to borrow against</label>
                    <select id="loan-deposit" data-testid="loan-deposit-select" value={pledged}
                      onChange={(e) => { const d = pledgeable.find((x) => x.deposit_number === e.target.value); setPledged(e.target.value); setAmount(d ? d.max_amount : 0); setTenure(d ? Math.min(12, d.max_months) : 1); }}
                      className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900">
                      <option value="">Choose a deposit</option>
                      {pledgeable.map((x) => (
                        <option key={x.deposit_number} value={x.deposit_number}>
                          {x.deposit_number}{x.scheme_code ? ` · ${x.scheme_code}` : ''} · paid in ₹{x.value.toLocaleString('en-IN')} · up to ₹{x.max_amount.toLocaleString('en-IN')}
                        </option>
                      ))}
                    </select>
                  </div>
                  {security && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-slate-600 mb-1" htmlFor="loan-deposit-amount">Amount (₹, up to {security.max_amount.toLocaleString('en-IN')})</label>
                        <input id="loan-deposit-amount" data-testid="loan-deposit-amount" type="number" min="1000" max={security.max_amount}
                          value={amount} onChange={(e) => setAmount(Number(e.target.value))}
                          className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900 font-bold" />
                      </div>
                      <div>
                        <label className="block text-slate-600 mb-1" htmlFor="loan-deposit-tenure">Repay over (months, up to {security.max_months})</label>
                        <input id="loan-deposit-tenure" data-testid="loan-deposit-tenure" type="number" min="1" max={security.max_months}
                          value={tenure} onChange={(e) => setTenure(Number(e.target.value))}
                          className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900 font-bold" />
                      </div>
                    </div>
                  )}
                  <p className="text-[11px] text-slate-600">While the loan is open the deposit cannot be closed early, and it keeps earning. Anything still owed when it matures is taken from the maturity amount first.</p>
                </>)}
              </div>
            )}

            {!onDeposit && (<>
            {/* Amount Slider */}
            <div>
              <div className="flex justify-between text-slate-600 mb-1">
                <span>Loan Principal Amount</span>
                <span className="font-extrabold text-[#0b3b8c] text-sm">₹{amount.toLocaleString('en-IN')}</span>
              </div>
              <input
                data-testid="loan-amount-slider"
                type="range"
                min="50000"
                max={loanType === 'home' ? 10000000 : 2500000}
                step="25000"
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
                className="w-full accent-indigo-500 cursor-pointer"
              />
            </div>

            {/* Tenure Slider */}
            <div>
              <div className="flex justify-between text-slate-600 mb-1">
                <span>Tenure in Months</span>
                <span className="font-extrabold text-[#0b3b8c] text-sm">{tenure} Months ({(tenure/12).toFixed(1)} Yrs)</span>
              </div>
              <input
                data-testid="loan-tenure-slider"
                type="range"
                min="12"
                max={loanType === 'home' ? 240 : 60}
                step="6"
                value={tenure}
                onChange={(e) => setTenure(Number(e.target.value))}
                className="w-full accent-indigo-500 cursor-pointer"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-slate-500 mb-1">Monthly In-Hand Net Income (₹)</label>
                <input
                  data-testid="monthly-income-input"
                  type="number"
                  required
                  value={monthlyIncome}
                  onChange={(e) => setMonthlyIncome(Number(e.target.value))}
                  placeholder="e.g. 65000"
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900 font-bold"
                />
              </div>

              <div>
                <label className="block text-slate-500 mb-1">Employment Type</label>
                <select
                  value={empType}
                  onChange={(e) => setEmpType(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900"
                >
                  <option>Salaried Private Sector</option>
                  <option>Central / State Govt PSU</option>
                  <option>Self Employed Professional</option>
                  <option>Business Owner / Trader</option>
                </select>
              </div>
            </div>

            </>)}

            <div>
              <label className="block text-slate-500 mb-1">Purpose of Loan</label>
              <input
                type="text"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder="e.g. Higher Education / Medical Emergency"
                className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900"
              />
            </div>

            <button
              data-testid="submit-loan-btn"
              type="submit"
              disabled={submitting || (onDeposit && !security)}
              className={`w-full py-3 rounded-xl ${currentTheme.buttonTheme} font-bold text-sm shadow-xl disabled:opacity-50`}
            >
              {submitting ? 'Assessing Credit Score & Eligibility...' : `Apply for ${onDeposit ? 'a loan against your deposit' : `${loanType.toUpperCase()} Loan`} (EMI: ₹${monthlyEmi.toLocaleString('en-IN')}/mo)`}
            </button>
          </form>

          {/* Application Success Card */}
          {applicationResult && (
            <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-emerald-700 space-y-2 animate-in fade-in">
              <div className="flex items-center gap-2 font-bold text-sm">
                <CheckCircle2 className="w-5 h-5 text-emerald-700" />
                <span>Application Logged: {applicationResult.application_no}</span>
              </div>
              <p className="text-xs text-slate-600">
                Eligibility: <strong className="text-emerald-700">{applicationResult.eligibility}</strong> | Monthly EMI: <strong>₹{applicationResult.calculated_emi?.toLocaleString('en-IN')}</strong>
              </p>
            </div>
          )}

        </div>

        {/* EMI Summary Card */}
        <div className="space-y-5">
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xl text-xs space-y-4">
            <h3 className="font-bold text-slate-900 text-sm pb-2 border-b border-slate-200 flex items-center gap-2">
              <Calculator className="w-4 h-4 text-[#0b3b8c]" />
              EMI & Interest Summary
            </h3>

            <div className="p-4 rounded-xl bg-white border border-slate-200 space-y-3">
              <div>
                <p className="text-slate-500">Monthly EMI:</p>
                <h3 data-testid="loan-emi-display" className="text-2xl font-extrabold text-[#0b3b8c] mt-1">
                  ₹{monthlyEmi.toLocaleString('en-IN')}
                </h3>
              </div>

              <div className="pt-2 border-t border-slate-200 space-y-2 text-slate-600">
                <div className="flex justify-between">
                  <span className="text-slate-500">Total Interest Payable:</span>
                  <span className="font-semibold text-[#c8102e]">₹{totalInterest.toLocaleString('en-IN')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Total Amount Payable:</span>
                  <span className="font-bold text-slate-900">₹{totalRepayable.toLocaleString('en-IN')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Eligibility Status:</span>
                  <span className={`font-bold ${isEligible ? 'text-emerald-700' : 'text-amber-600'}`}>
                    {isEligible ? 'High Approval Chance' : 'Co-Applicant Recommended'}
                  </span>
                </div>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-500 space-y-1">
              <p className="font-semibold text-slate-700">Zero Foreclosure Charges:</p>
              <p>As per our credit policy, there is no prepayment penalty on floating-rate loans.</p>
            </div>
          </div>
        </div>

      </div>

      {loanAccounts.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-xl" data-testid="loan-accounts">
          <div className="p-5 border-b border-slate-200">
            <h2 className="font-bold text-slate-900 text-sm">Your loans</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">Each EMI is taken from your savings account on its due date. Keep enough there, or pay it now.</p>
          </div>
          <div className="divide-y divide-slate-100">
            {loanAccounts.map((l) => {
              const next = (l.schedule || []).find((e) => !e.paid_on);
              return (
                <div key={l.loan_number} className="p-5 text-xs space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-bold text-slate-900 text-sm capitalize">{l.loan_type} loan · <span className="font-mono">{l.loan_number}</span></p>
                      <p className="text-slate-500 mt-0.5">₹{Number(l.principal).toLocaleString('en-IN')} at {l.roi}% for {l.tenure_months} months · {l.emis_paid} of {l.tenure_months} EMIs paid</p>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${l.status === 'closed' ? 'bg-slate-50 text-slate-600 border-slate-200'
                      : l.dpd > 0 ? 'bg-rose-50 text-[#c8102e] border-rose-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
                      {l.status === 'closed' ? 'repaid' : l.dpd > 0 ? `${l.dpd} days overdue` : 'on time'}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200"><p className="text-slate-500">Still owed</p>
                      <p className="font-bold text-slate-900 text-base">₹{Number(l.outstanding).toLocaleString('en-IN')}</p></div>
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200"><p className="text-slate-500">Next EMI</p>
                      <p className="font-bold text-slate-900 text-base">{next ? `₹${Number(next.emi).toLocaleString('en-IN')}` : '—'}</p>
                      {next && <p className="text-[10px] text-slate-500">due {new Date(next.due_date).toLocaleDateString('en-IN')}</p>}</div>
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200"><p className="text-slate-500">Interest paid</p>
                      <p className="font-bold text-slate-900 text-base">₹{Number(l.interest_paid).toLocaleString('en-IN')}</p></div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {next && (
                      <button data-testid={`pay-emi-${l.loan_number}`} disabled={paying === l.loan_number} onClick={() => payEmi(l.loan_number)}
                        className="px-4 py-2 rounded-lg bg-[#0b3b8c] text-white font-semibold disabled:opacity-50">
                        {paying === l.loan_number ? 'Paying…' : `Pay EMI now · ₹${Number(next.emi).toLocaleString('en-IN')}`}
                      </button>
                    )}
                    <button onClick={() => setOpenSchedule(openSchedule === l.loan_number ? '' : l.loan_number)}
                      className="px-4 py-2 rounded-lg border border-slate-200 font-semibold text-slate-700">
                      {openSchedule === l.loan_number ? 'Hide schedule' : 'View EMI schedule'}
                    </button>
                  </div>
                  {openSchedule === l.loan_number && (
                    <div className="overflow-x-auto max-h-72 overflow-y-auto border border-slate-200 rounded-lg">
                      <table className="w-full text-left text-[11px]">
                        <thead className="bg-slate-50 text-slate-600 sticky top-0"><tr>
                          <th className="p-2">#</th><th className="p-2">Due</th><th className="p-2 text-right">EMI</th>
                          <th className="p-2 text-right">Principal</th><th className="p-2 text-right">Interest</th>
                          <th className="p-2 text-right">Owed after</th><th className="p-2">Paid</th></tr></thead>
                        <tbody className="divide-y divide-slate-100">
                          {l.schedule.map((e) => (
                            <tr key={e.n}>
                              <td className="p-2">{e.n}</td><td className="p-2">{new Date(e.due_date).toLocaleDateString('en-IN')}</td>
                              <td className="p-2 text-right">₹{Number(e.emi).toLocaleString('en-IN')}</td>
                              <td className="p-2 text-right">₹{Number(e.principal_part).toLocaleString('en-IN')}</td>
                              <td className="p-2 text-right">₹{Number(e.interest_part).toLocaleString('en-IN')}</td>
                              <td className="p-2 text-right">₹{Number(e.balance_after).toLocaleString('en-IN')}</td>
                              <td className="p-2">{e.paid_on ? new Date(e.paid_on).toLocaleDateString('en-IN') : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Application History */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-xl">
        <div className="p-5 border-b border-slate-200 flex items-center gap-2">
          <FileCheck className="w-4 h-4 text-[#0b3b8c]" />
          <h2 className="font-bold text-slate-900 text-sm">Your Loan Applications</h2>
        </div>
        <div className="overflow-x-auto">
          {myLoans.length ? (
            <table className="w-full text-left text-xs" data-testid="my-loans-table">
              <thead className="bg-slate-50 text-[11px] uppercase text-slate-600">
                <tr>
                  <th className="p-3 font-semibold">Application No.</th>
                  <th className="p-3 font-semibold">Type</th>
                  <th className="p-3 font-semibold text-right">Amount</th>
                  <th className="p-3 font-semibold text-right">EMI</th>
                  <th className="p-3 font-semibold">Applied</th>
                  <th className="p-3 font-semibold">Pre-Check</th>
                  <th className="p-3 font-semibold">Application Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {myLoans.map((l) => {
                  // eligibility_status is the instant EMI-vs-income pre-check shown
                  // at the moment of applying; status is the loan desk's actual
                  // decision (route_loan_decision) -- two different things, so they
                  // get two badges instead of one conflating the two.
                  const statusStyle = {
                    approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
                    rejected: 'bg-red-50 text-red-700 border-red-200',
                    documentation: 'bg-blue-50 text-blue-700 border-blue-200',
                  }[l.status] || 'bg-amber-50 text-amber-700 border-amber-200';
                  const statusLabel = { under_review: 'Under Review', approved: 'Approved',
                    rejected: 'Rejected', documentation: 'Docs Requested' }[l.status] || l.status;
                  return (
                    <tr key={l.id} className="hover:bg-blue-50/40 transition-colors">
                      <td className="p-3 font-mono text-slate-900">{l.loan_application_no || '—'}</td>
                      <td className="p-3 capitalize text-slate-700">{l.loan_type}</td>
                      <td className="p-3 text-right font-semibold text-slate-900">
                        {l.amount_requested != null ? `₹${l.amount_requested.toLocaleString('en-IN')}` : '—'}
                      </td>
                      <td className="p-3 text-right text-slate-700">
                        {l.calculated_emi != null ? `₹${l.calculated_emi.toLocaleString('en-IN')}` : '—'}
                      </td>
                      <td className="p-3 text-slate-500">{new Date(l.created_at).toLocaleDateString('en-IN')}</td>
                      <td className="p-3">
                        {l.eligibility_status && (
                          <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                            l.eligibility_status === 'Pre-Approved'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-amber-50 text-amber-700 border-amber-200'
                          }`}>
                            {l.eligibility_status}
                          </span>
                        )}
                      </td>
                      <td className="p-3">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold border ${statusStyle}`}>
                          {statusLabel}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="p-10 text-center text-xs text-slate-500">
              No loan applications yet — use the calculator above to apply.
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
