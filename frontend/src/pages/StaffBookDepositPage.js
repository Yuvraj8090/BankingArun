import React, { useState, useEffect, useCallback } from 'react';
import { Search, User, PiggyBank, Calculator } from 'lucide-react';
import { api } from '../services/api';
import PlanPicker from '../components/PlanPicker';
import { useBankTheme } from '../context/BankThemeContext';
import { toast } from 'sonner';
import DepositSlip from '../components/DepositSlip';

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

  const [nominee, setNominee] = useState('Registered Nominee');
  const [booking, setBooking] = useState(false);
  const [slip, setSlip] = useState(null);


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

  const handleBook = async (e, choice) => {
    e.preventDefault();
    if (!member) {
      toast.error('Look up a member account first');
      return;
    }
    if (!choice.valid) {
      toast.error('Choose a plan and an amount it allows');
      return;
    }
    setBooking(true);
    try {
      const res = await api.staffBookDeposit({ ...choice.payload, account_number: accountNumber.trim(), nominee_name: nominee });
      toast.success(res.message);
      setSlip(res.slip);
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
      <DepositSlip slip={slip} onClose={() => setSlip(null)} />
      <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-xl">
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Book Member Deposit</h1>
        <p className="text-xs text-slate-500 mt-1">
          Look up a member by their savings account number and book any plan for them: FD, RD, daily collection or monthly income.
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
        <PlanPicker>
          {({ inputs, breakdown, choice }) => (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl p-6 shadow-xl space-y-4">
              <h2 className="font-bold text-slate-900 text-sm pb-2 border-b border-slate-200">
                Book a deposit for {member.member.name}
              </h2>

              <form onSubmit={(e) => handleBook(e, choice)} className="space-y-4 text-xs">
                {inputs}

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
                  disabled={booking || !choice.valid}
                  className={`w-full py-3 rounded-xl ${currentTheme.buttonTheme} font-bold text-sm shadow-xl disabled:opacity-50`}
                >
                  {booking ? 'Booking…' : `Book ${choice.planName} · ₹${Number(choice.dueToday || 0).toLocaleString('en-IN')} from their savings`}
                </button>
              </form>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xl text-xs space-y-4">
              <h3 className="font-bold text-slate-900 text-sm pb-2 border-b border-slate-200 flex items-center gap-2">
                <Calculator className="w-4 h-4 text-[#0b3b8c]" />
                What the member gets
              </h3>
              {breakdown}
            </div>
          </div>
          )}
        </PlanPicker>
      )}
    </div>
  );
}
