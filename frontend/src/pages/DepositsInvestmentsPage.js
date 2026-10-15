import React, { useState, useEffect } from 'react';
import { Calculator } from 'lucide-react';
import { api } from '../services/api';
import PlanPicker from '../components/PlanPicker';
import { useBankTheme } from '../context/BankThemeContext';
import { toast } from 'sonner';

const inr = (n) => `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

// One deposit's earnings from the day it started: what has reached the account, then what is earned but waits for
// the next daily run. Credits are net of TDS, exactly as they appear in Transactions and the statement.
function DepositEarnings({ e }) {
  const rows = [
    ...e.pending.map(p => ({ date: p.date, amount: p.earned, note: 'earned, credited at the next daily run' })),
    ...[...e.credits].reverse().map(c => ({ date: c.date, amount: c.credited, note: 'credited to your account' })),
  ];
  const daysEarned = e.credits.length + e.pending.length;
  return (
    <div className="mt-2 p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs">
      <p className="font-semibold text-slate-900">
        {e.deposit_number}{e.plan ? ` · ${e.plan}` : ''} · started {day(e.started)} · matures {day(e.maturity_date)}
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 my-3">
        <div><p className="text-slate-500">Plan amount</p><p className="font-bold text-slate-900">{inr(e.principal)}</p></div>
        <div><p className="text-slate-500">Earning per day</p><p className="font-bold text-slate-900">{e.per_day ? inr(e.per_day) : '—'}</p></div>
        <div><p className="text-slate-500">Earned so far (before TDS)</p>
          <p className="font-bold text-emerald-700">{inr(e.earned_paid + e.held_back + e.pending.reduce((a, p) => a + p.earned, 0))}</p></div>
        <div><p className="text-slate-500">TDS withheld</p><p className="font-bold text-slate-900">{inr(e.tds_deducted)}</p></div>
      </div>
      {e.term_interest > 0 && (
        <p className="text-slate-600 mb-2">
          Over the full term this plan earns {inr(e.term_interest)}; {daysEarned} day{daysEarned === 1 ? '' : 's'} earned so far.
        </p>
      )}
      {rows.length === 0 ? (
        <p className="text-slate-500">Nothing earned yet. Interest starts the day after the deposit is booked.</p>
      ) : (
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-left">
            <thead className="text-[10px] uppercase text-slate-500">
              <tr><th className="py-1 pr-3">Day</th><th className="py-1 pr-3 text-right">Amount</th><th className="py-1">What happened</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(r => (
                <tr key={`${r.date}-${r.note}`}>
                  <td className="py-1 pr-3">{day(r.date)}</td>
                  <td className="py-1 pr-3 text-right font-semibold">{inr(r.amount)}</td>
                  <td className="py-1 text-slate-600">{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function DepositsInvestmentsPage() {
  const { currentTheme } = useBankTheme();
  const [accounts, setAccounts] = useState([]);
  const [myDeposits, setMyDeposits] = useState([]);
  const [earnings, setEarnings] = useState(null); // the deposit whose day-by-day earnings are open
  const [interestReceived, setInterestReceived] = useState({ day: 0, total: 0 });
  const [closingNumber, setClosingNumber] = useState('');

  // FD Booking Form
  const [fdNominee, setFdNominee] = useState('Registered Nominee');
  const [selectedAcc, setSelectedAcc] = useState('');
  const [booking, setBooking] = useState(false);
  const loadAccounts = async () => {
    const accRes = await api.getAccounts();
    if (accRes.accounts?.length > 0) {
      setAccounts(accRes.accounts);
      setSelectedAcc(prev => prev || accRes.accounts[0].account_number);
    }
    setMyDeposits(accRes.deposits || []);
    setInterestReceived({ day: accRes.interest_received_24h || 0, total: accRes.interest_received_total || 0 });
  };

  useEffect(() => {
    const init = async () => {
      try {
        await loadAccounts();
      } catch (err) {
        toast.error('Could not load your accounts');
        return;
      }
    };
    init();
  }, []);

  const handleBookDeposit = async (e, choice) => {
    e.preventDefault();
    if (!selectedAcc) {
      toast.error("Select an account to debit");
      return;
    }
    if (!choice.valid) {
      toast.error('Choose a plan and an amount it allows');
      return;
    }
    setBooking(true);
    try {
      const res = await api.bookDeposit({ ...choice.payload, account_number: selectedAcc, nominee_name: fdNominee });
      toast.success(res.message);
      loadAccounts();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Booking failed");
    } finally {
      setBooking(false);
    }
  };

  const toggleEarnings = async (depositNumber) => {
    if (earnings?.deposit_number === depositNumber) {
      setEarnings(null);
      return;
    }
    try {
      setEarnings(await api.depositEarnings(depositNumber));
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Could not load the earnings for this deposit');
    }
  };

  const handlePrematureClose = async (deposit) => {
    if (!window.confirm(
      `Close ${deposit.deposit_number} now? You'll get back the principal plus interest for the time you've `
      + `actually held it, at a lower rate with an early-exit penalty — not the full ${deposit.tenure_months}-month `
      + `rate you'd get by waiting for maturity (${new Date(deposit.maturity_date).toLocaleDateString('en-IN')}).`
    )) return;
    setClosingNumber(deposit.deposit_number);
    try {
      const res = await api.prematureClose(deposit.deposit_number);
      toast.success(res.message);
      loadAccounts();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Could not close this deposit');
    } finally {
      setClosingNumber('');
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      
      {/* Header */}
      <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Member Deposits
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Fixed and recurring deposits for members · interest credited automatically
          </p>
        </div>

      </div>

      <PlanPicker>
        {({ inputs, breakdown, choice }) => (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Booking Form */}
          <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl p-6 shadow-xl space-y-4">
            <h2 className="font-bold text-slate-900 text-sm pb-2 border-b border-slate-200 flex justify-between items-center">
              <span>Open a deposit</span>
              <span className="text-[#0b3b8c] text-xs font-mono">Member deposits</span>
            </h2>

            <form onSubmit={(e) => handleBookDeposit(e, choice)} className="space-y-4 text-xs">
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
              {inputs}

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
                disabled={booking || !choice.valid}
                className={`w-full py-3 rounded-xl ${currentTheme.buttonTheme} font-bold text-sm shadow-xl disabled:opacity-50`}
              >
                {booking ? 'Booking…' : `Book ${choice.planName} · ₹${Number(choice.dueToday || 0).toLocaleString('en-IN')} today`}
              </button>
            </form>
          </div>

          {/* What the member gets */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xl text-xs space-y-4">
            <h3 className="font-bold text-slate-900 text-sm pb-2 border-b border-slate-200 flex items-center gap-2">
              <Calculator className="w-4 h-4 text-[#0b3b8c]" />
              What you get
            </h3>
            {breakdown}
          </div>

        </div>
        )}
      </PlanPicker>

      {myDeposits.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xl mt-6">
          <h3 className="font-bold text-slate-900 text-sm pb-2 border-b border-slate-200 mb-3">Your Deposits</h3>
          <div data-testid="interest-summary" className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4 text-xs">
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200">
              <p className="text-emerald-800">Interest received, last 24 hours</p>
              <p data-testid="interest-24h" className="text-lg font-extrabold text-emerald-700">
                ₹{Number(interestReceived.day).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </p>
              <p className="text-[10px] text-emerald-800/80">After TDS, as credited to your account. Daily plans credit once a day.</p>
            </div>
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
              <p className="text-slate-600">Interest received, all time</p>
              <p className="text-lg font-extrabold text-slate-900">
                ₹{Number(interestReceived.total).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </p>
            </div>
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
              <p className="text-slate-600">Interest earned till now</p>
              {/* Same total as a deposit's earnings panel: paid out + held back + earned but not yet credited. */}
              <p data-testid="earned-total" className="text-lg font-extrabold text-emerald-700">
                ₹{myDeposits.reduce((sum, d) => sum + Number(d.interest_paid || 0) + Number(d.accrued_interest || 0)
                  + Number(d.pending_interest || 0), 0)
                  .toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
              <p data-testid="earning-per-day" className="text-[10px] text-slate-500">
                Before TDS. Earning ₹{myDeposits.filter(d => d.status === 'active' && d.interest_payout === 'daily')
                  .reduce((sum, d) => sum + Number(d.principal_amount) * Number(d.interest_rate) / 100 / 365, 0)
                  .toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} a day from active daily plans.
              </p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[10px] uppercase text-slate-500">
                <tr>
                  <th className="py-2 pr-3 font-semibold">Deposit</th>
                  <th className="py-2 pr-3 font-semibold text-right">Principal</th>
                  <th className="py-2 pr-3 font-semibold">Maturity</th>
                  <th className="py-2 pr-3 font-semibold text-right">Interest earned</th>
                  <th className="py-2 pr-3 font-semibold">Status</th>
                  <th className="py-2 pr-3 font-semibold text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {myDeposits.map(dep => (
                  <React.Fragment key={dep.id}>
                  <tr data-testid={`my-deposit-${dep.deposit_number}`}>
                    <td className="py-2 pr-3 font-mono text-slate-700">
                      {dep.deposit_number}
                      {dep.scheme_code && <span className="block font-sans text-[10px] text-slate-500">Plan {dep.scheme_code}</span>}
                    </td>
                    <td className="py-2 pr-3 text-right text-slate-900 font-semibold">
                      ₹{Number(dep.principal_amount).toLocaleString('en-IN')}
                      {dep.instalment_amount != null && (
                        // An instalment plan: what has come in so far, and what the nightly job takes next.
                        <span className="block text-[10px] font-normal text-slate-500" data-testid={`paid-${dep.deposit_number}`}>
                          paid ₹{Number(dep.paid_amount).toLocaleString('en-IN')} so far ·
                          ₹{Number(dep.instalment_amount).toLocaleString('en-IN')} a {dep.instalment_every} from savings
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-slate-600">
                      {new Date(dep.maturity_date).toLocaleDateString('en-IN')}
                      {dep.interest_payout === 'daily' ? (
                        // A daily plan pays its interest as it goes and returns the principal at the end; the interest
                        // total is 30-day months x tenure (same cap run_daily_interest_accrual applies in cron.php).
                        <span className="block text-[10px] text-slate-500" data-testid={`total-${dep.deposit_number}`}>
                          ₹{Number(dep.principal_amount).toLocaleString('en-IN')} back + about ₹{Math.round(
                            Number(dep.principal_amount)
                            * (Math.round(Number(dep.interest_rate) / 100 / 365 * 30 * Number(dep.tenure_months) * 100) / 100)
                          ).toLocaleString('en-IN')} interest,
                          paid daily
                        </span>
                      ) : (
                        <span className="block text-[10px] text-slate-500">
                          Maturity value ₹{Number(dep.maturity_amount).toLocaleString('en-IN')}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right text-slate-700" data-testid={`interest-${dep.deposit_number}`}>
                      ₹{Number(dep.interest_paid || 0).toLocaleString('en-IN')}
                      <span className="block text-[10px] text-slate-500">paid to your account</span>
                      {dep.status === 'active' && dep.interest_payout === 'daily' && (
                        <span className="block text-[10px] text-emerald-700">
                          earning ₹{(Number(dep.principal_amount) * Number(dep.interest_rate) / 100 / 365).toFixed(2)} a day
                        </span>
                      )}
                      {Number(dep.pending_interest) > 0 && (
                        <span className="block text-[10px] text-amber-700">
                          + ₹{Number(dep.pending_interest).toLocaleString('en-IN')} earned, waiting for the daily run
                        </span>
                      )}
                      {Number(dep.accrued_interest) > 0 && (
                        <span className="block text-[10px] text-amber-700">
                          + ₹{Number(dep.accrued_interest).toLocaleString('en-IN')} earned, not paid out yet
                        </span>
                      )}
                      {Number(dep.tds_deducted) > 0 && (
                        <span className="block text-[10px] text-slate-500">
                          ₹{Number(dep.tds_deducted).toLocaleString('en-IN')} TDS withheld
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        dep.status === 'active' ? 'bg-emerald-50 text-emerald-700'
                          : dep.status === 'matured' ? 'bg-slate-100 text-slate-600' : 'bg-amber-50 text-amber-700'}`}>
                        {dep.status}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-right">
                      <button
                        data-testid={`view-earnings-${dep.deposit_number}`}
                        onClick={() => toggleEarnings(dep.deposit_number)}
                        className="block ml-auto text-[#0b3b8c] font-semibold hover:underline mb-1"
                      >
                        {earnings?.deposit_number === dep.deposit_number ? 'Hide earnings' : 'View earnings'}
                      </button>
                      {dep.status === 'active' && (
                        <button
                          data-testid={`close-early-${dep.deposit_number}`}
                          onClick={() => handlePrematureClose(dep)}
                          disabled={closingNumber === dep.deposit_number}
                          className="text-[#c8102e] font-semibold hover:underline disabled:opacity-50"
                        >
                          {closingNumber === dep.deposit_number ? 'Closing…' : 'Close Early'}
                        </button>
                      )}
                    </td>
                  </tr>
                  {earnings?.deposit_number === dep.deposit_number && (
                    <tr data-testid={`earnings-${dep.deposit_number}`}>
                      <td colSpan={6} className="pb-4">
                        <DepositEarnings e={earnings} />
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-slate-500 mt-2">
            Closing before maturity pays a reduced rate for the time actually held, minus an early-exit penalty —
            not the full-term rate. Each plan has a lock-in (30 days unless the plan sets longer); closing before it is refused and tells you when it unlocks.
          </p>
        </div>
      )}


    </div>
  );
}
