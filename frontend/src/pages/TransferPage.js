import React, { useState, useEffect } from 'react';

import { api } from '../services/api';
import { useBankTheme } from '../context/BankThemeContext';
import { toast } from 'sonner';
import { txnMode, showsDetail } from '../utils/format';
import { useAuth } from '../context/AuthContext';

export default function TransferPage() {
  const { currentTheme } = useBankTheme();
  // Without the payment-systems authorisation every transfer is a book entry
  // between member accounts, so the page offers only that: no IMPS/NEFT/RTGS
  // modes and no IFSC (see modules/compliance.php).
  const { features } = useAuth();
  const outside = Array.isArray(features) && features.includes('payment_systems');
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(false);
  
  // Single Transfer Form State
  const [fromAcc, setFromAcc] = useState('');
  const [toAcc, setToAcc] = useState('');
  // Saved payees: above the new-payee limit, money only goes to one saved a day earlier.
  const [payees, setPayees] = useState({ payees: [], new_payee_limit: 25000, cooling_hours: 24 });
  const [newPayee, setNewPayee] = useState({ account_number: '', nickname: '' });
  const loadPayees = () => api.payees().then(setPayees).catch(() => {});
  useEffect(() => { loadPayees(); }, []);
  const savePayee = async () => {
    try { toast.success((await api.payeeAdd(newPayee)).message); setNewPayee({ account_number: '', nickname: '' }); loadPayees(); }
    catch (e) { toast.error(e.response?.data?.detail || 'Could not save the payee'); }
  };
  const removePayee = async (p) => {
    if (!window.confirm(`Remove ${p.nickname || p.name}? Saving them again restarts the ${payees.cooling_hours}-hour wait.`)) return;
    try { toast.success((await api.payeeRemove(p.id)).message); loadPayees(); }
    catch (e) { toast.error(e.response?.data?.detail || 'Could not remove the payee'); }
  };
  const [beneficiaryName, setBeneficiaryName] = useState('');
  const [ifsc, setIfsc] = useState('AJSP0000042');
  const [transferType, setTransferType] = useState('IMPS');
  const [amount, setAmount] = useState('');
  const [remarks, setRemarks] = useState('');
  const [txnPwd, setTxnPwd] = useState('');
  const [isScheduled, setIsScheduled] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');

  const [transactions, setTransactions] = useState([]);

  useEffect(() => {
    const loadAccs = async () => {
      try {
        const res = await api.getAccounts();
        if (res.accounts?.length > 0) {
          setAccounts(res.accounts);
          setFromAcc(res.accounts[0].account_number);
        }
        const txnRes = await api.getTransactions();
        setTransactions(txnRes.transactions || []);
      } catch (err) {
        toast.error("Failed to load accounts");
      }
    };
    loadAccs();
  }, []);

  const handleSingleTransfer = async (e) => {
    e.preventDefault();
    if (!amount || !txnPwd || !toAcc) {
      toast.error("Please fill in all mandatory transfer parameters.");
      return;
    }

    setLoading(true);
    try {
      const payload = {
        from_account_number: fromAcc,
        to_account_number: toAcc,
        beneficiary_name: beneficiaryName || 'Registered Payee',
        beneficiary_ifsc: ifsc,
        transfer_type: transferType,
        amount: parseFloat(amount),
        remarks: remarks || (outside ? `${transferType} Transfer` : 'Member transfer'),
        transaction_password: txnPwd,
        is_scheduled: isScheduled,
        schedule_date: isScheduled ? scheduleDate : null
      };

      const res = await api.transferFunds(payload);
      toast.success(res.message);
      setAmount('');
      setToAcc('');
      setRemarks('');
      setTxnPwd('');
      
      const txnRes = await api.getTransactions();
      setTransactions(txnRes.transactions || []);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Transfer request rejected");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white border border-slate-200 p-5 rounded-2xl shadow-xl">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            {outside ? 'Fund Transfers' : 'Pay a Member'}
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            {outside ? 'IMPS | NEFT | RTGS'
              : 'Transfers between member accounts settle instantly on our own books. Payments to other banks are not offered.'}
          </p>
        </div>

      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Transfer Form Box */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl p-6 shadow-xl">
          
            <div className="mb-5 p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-3" data-testid="saved-payees">
              <div className="flex items-center justify-between">
                <h2 className="font-bold text-slate-900 text-sm">Saved payees</h2>
                <span className="text-[10px] text-slate-500">
                  Over ₹{Number(payees.new_payee_limit).toLocaleString('en-IN')} only to a payee saved {payees.cooling_hours}+ hours ago
                </span>
              </div>
              {payees.payees.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {payees.payees.map((p) => (
                    <span key={p.id} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white pl-3 pr-1 py-1">
                      <button type="button" onClick={() => { setToAcc(p.account_number); setBeneficiaryName(p.name); }}
                        className="font-semibold text-[#0b3b8c]" title={`Pay ${p.name} (${p.account_number})`}>
                        {p.nickname || p.name}
                      </button>
                      {!p.full_limit && <span className="text-[9px] text-amber-700">new</span>}
                      <button type="button" onClick={() => removePayee(p)} aria-label={`Remove ${p.nickname || p.name}`}
                        className="px-1.5 text-slate-400 hover:text-[#c8102e]">×</button>
                    </span>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-[1fr,1fr,auto] gap-2">
                <input value={newPayee.account_number} onChange={(e) => setNewPayee({ ...newPayee, account_number: e.target.value })}
                  placeholder="Member account number" aria-label="Payee account number"
                  className="bg-white border border-slate-200 rounded-lg px-3 py-2 font-mono" />
                <input value={newPayee.nickname} onChange={(e) => setNewPayee({ ...newPayee, nickname: e.target.value })}
                  placeholder="Nickname (optional)" aria-label="Payee nickname"
                  className="bg-white border border-slate-200 rounded-lg px-3 py-2" />
                <button type="button" onClick={savePayee} disabled={!newPayee.account_number.trim()}
                  className="px-4 py-2 rounded-lg bg-[#0b3b8c] text-white font-semibold disabled:opacity-50">Save payee</button>
              </div>
            </div>

          {(
            <form onSubmit={handleSingleTransfer} className="space-y-4 text-xs">
              <h2 className="font-bold text-slate-900 text-sm pb-2 border-b border-slate-200 flex items-center justify-between">
                <span>{outside ? 'Inter-Bank & Intra-Bank Transfer' : 'Transfer to a member account'}</span>
                <span className="text-emerald-700 text-[11px] font-mono">256-Bit Encrypted UTR</span>
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-500 mb-1">Debit From Account</label>
                  <select
                    data-testid="transfer-from-account"
                    value={fromAcc}
                    onChange={(e) => setFromAcc(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900 font-mono"
                  >
                    {accounts.map(a => (
                      <option key={a.id} value={a.account_number}>
                        {a.account_name} ({a.account_number}) - ₹{a.balance.toLocaleString('en-IN')}
                      </option>
                    ))}
                  </select>
                </div>

                {outside && (
                <div>
                  <label className="block text-slate-500 mb-1">Payment Mode</label>
                  <select
                    data-testid="transfer-mode-select"
                    value={transferType}
                    onChange={(e) => setTransferType(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900 font-semibold"
                  >
                    <option value="IMPS">IMPS (Instant 24x7 - Max ₹5 Lakh)</option>
                    <option value="NEFT">NEFT (National Clearing - No Limit)</option>
                    <option value="RTGS">RTGS (Real Time - Min ₹2 Lakh)</option>
                  </select>
                </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-500 mb-1">Beneficiary Account Number</label>
                  <input
                    data-testid="beneficiary-account-input"
                    type="text"
                    required
                    value={toAcc}
                    onChange={(e) => setToAcc(e.target.value)}
                    placeholder="e.g. AJSP00129845612"
                    className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-slate-500 mb-1">Beneficiary Full Name</label>
                  <input
                    data-testid="beneficiary-name-input"
                    type="text"
                    required
                    value={beneficiaryName}
                    onChange={(e) => setBeneficiaryName(e.target.value)}
                    placeholder="e.g. Ramesh Chandra"
                    className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {outside && (
                <div>
                  <label className="block text-slate-500 mb-1">Beneficiary Bank IFSC Code</label>
                  <input
                    data-testid="beneficiary-ifsc-input"
                    type="text"
                    required
                    value={ifsc}
                    onChange={(e) => setIfsc(e.target.value)}
                    placeholder="AJSP0000042"
                    className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900 font-mono uppercase"
                  />
                </div>
                )}

                <div>
                  <label className="block text-slate-500 mb-1">Amount to Transfer (₹)</label>
                  <input
                    data-testid="transfer-amount-input"
                    type="number"
                    step="0.01"
                    required
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="e.g. 25000"
                    className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900 font-bold"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-500 mb-1">Payment Remarks / Purpose</label>
                <input
                  data-testid="transfer-remarks-input"
                  type="text"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="e.g. Monthly rent"
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900"
                />
              </div>

              {/* Scheduled Toggle */}
              <div className="p-3 rounded-xl bg-white border border-slate-200 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-slate-600 font-medium">Schedule for future date?</span>
                  <input
                    type="checkbox"
                    checked={isScheduled}
                    onChange={(e) => setIsScheduled(e.target.checked)}
                    className="w-4 h-4 rounded text-[#0b3b8c] focus:ring-[#0b3b8c]"
                  />
                </div>
                {isScheduled && (
                  <input
                    type="date"
                    value={scheduleDate}
                    onChange={(e) => setScheduleDate(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-slate-900"
                  />
                )}
              </div>

              {/* Transaction Password Required */}
              <div className="pt-2">
                <label className="block text-rose-300 font-semibold mb-1">
                  Transaction Password / PIN (Mandatory for Fund Transfer)
                </label>
                <input
                  data-testid="transaction-password-input"
                  type="password"
                  required
                  value={txnPwd}
                  onChange={(e) => setTxnPwd(e.target.value)}
                  placeholder="Enter Transaction Password (e.g. Txn@1234)"
                  className="w-full bg-white border border-rose-500/40 focus:border-rose-500 rounded-xl px-3 py-2.5 text-slate-900"
                />
              </div>

              <button
                data-testid="execute-transfer-btn"
                type="submit"
                disabled={loading}
                className={`w-full py-3 rounded-xl ${currentTheme.buttonTheme} font-bold text-sm shadow-xl mt-2`}
              >
                {loading ? 'Authenticating & Routing UTR...' : `Authorize & Transfer ₹${amount ? parseFloat(amount).toLocaleString('en-IN') : '0.00'}`}
              </button>
            </form>
          )}


        </div>

        {/* Transfer Limits & Info Panel */}
        <div className="space-y-5">
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xl text-xs space-y-3">
            <h3 className="font-bold text-slate-900 text-sm pb-2 border-b border-slate-200">
              {outside ? 'Daily Transfer Limits' : 'How transfers work'}
            </h3>
            
            {outside ? (
            <div className="space-y-2.5 text-slate-600">
              <div className="flex justify-between items-center p-2 rounded-lg bg-slate-50">
                <span className="font-medium text-[#0b3b8c]">IMPS (Instant)</span>
                <span className="font-mono text-slate-900">₹5,00,000 / day</span>
              </div>
              <div className="flex justify-between items-center p-2 rounded-lg bg-slate-50">
                <span className="font-medium text-[#0b3b8c]">NEFT (Batch)</span>
                <span className="font-mono text-slate-900">No Upper Limit</span>
              </div>
              <div className="flex justify-between items-center p-2 rounded-lg bg-slate-50">
                <span className="font-medium text-purple-400">RTGS (High Value)</span>
                <span className="font-mono text-slate-900">Min ₹2 Lakh</span>
              </div>
            </div>
            ) : (
              <p className="text-slate-600">
                Member transfers settle at once on our own books, up to your available balance.
                Payments to other banks are not offered.
              </p>
            )}

            <div className="p-3 rounded-xl bg-blue-50/40 border border-slate-200 text-[11px] text-[#0b3b8c] space-y-1">
              <p className="font-semibold">Security Note:</p>
              <p>Two-factor authentication with separate login password and transaction password is enforced on every transfer.</p>
            </div>
          </div>
        </div>

      </div>

      {/* Transaction History Table */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xl">
        <h3 className="font-bold text-slate-900 text-base mb-4">Complete Account Passbook</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="text-[11px] uppercase bg-white text-slate-500 border-b border-slate-200">
              <tr>
                <th className="p-3">UTR / Reference</th>
                <th className="p-3">Mode</th>
                <th className="p-3">Beneficiary / Party</th>
                <th className="p-3">Date & Time</th>
                <th className="p-3">Status</th>
                <th className="p-3 text-right">Amount (₹)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100/60">
              {transactions.map(t => (
                <tr key={t.id} className="hover:bg-blue-50/40 transition-colors transition">
                  <td className="p-3 font-mono text-[#0b3b8c]">{t.ref_number}</td>
                  <td className="p-3 font-semibold text-slate-700">{txnMode(t.mode)}</td>
                  <td className="p-3">
                    {t.counterparty_name || t.description}
                    {showsDetail(t.mode) && t.description && (
                      <span className="block text-[10px] text-slate-500 font-normal">{t.description}</span>
                    )}
                  </td>
                  <td className="p-3 text-slate-500">{new Date(t.timestamp).toLocaleString('en-IN')}</td>
                  <td className="p-3">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-700 border border-emerald-500/20">
                      {t.status}
                    </span>
                  </td>
                  <td className={`p-3 text-right font-bold ${t.type === 'credit' ? 'text-emerald-700' : 'text-[#c8102e]'}`}>
                    {t.type === 'credit' ? '+' : '-'} ₹{t.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
