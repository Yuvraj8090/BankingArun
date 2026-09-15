import React, { useState, useEffect } from 'react';
import { 
  ArrowRightLeft, Send, Upload, Clock, CheckCircle2, 
  ShieldAlert, Layers, Smartphone, Building, RefreshCw 
} from 'lucide-react';
import { api } from '../services/api';
import { useBankTheme } from '../context/BankThemeContext';
import { toast } from 'sonner';

export default function TransferPage() {
  const { currentTheme } = useBankTheme();
  const [activeSubTab, setActiveSubTab] = useState('single'); // single, upi, bulk, scheduled
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(false);
  
  // Single Transfer Form State
  const [fromAcc, setFromAcc] = useState('');
  const [toAcc, setToAcc] = useState('');
  const [beneficiaryName, setBeneficiaryName] = useState('');
  const [ifsc, setIfsc] = useState('AJSP0000042');
  const [transferType, setTransferType] = useState('IMPS');
  const [amount, setAmount] = useState('');
  const [remarks, setRemarks] = useState('');
  const [txnPwd, setTxnPwd] = useState('');
  const [isScheduled, setIsScheduled] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');

  // UPI State
  const [upiId, setUpiId] = useState('');

  // Bulk Upload State
  const [bulkText, setBulkText] = useState(
    "Rajesh Kumar,AJSP00918273645,AJSP0000042,12500,June Vendor Payout\nAnkita Sen,AJSP00998811223,AJSP0000001,8400,Design Freelance Stipend\nVikram Mehta,AJSP00112233445,AJSP0000007,15000,Cloud Hosting Invoice"
  );

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
    if (!amount || !txnPwd || (!toAcc && !upiId)) {
      toast.error("Please fill in all mandatory transfer parameters.");
      return;
    }

    setLoading(true);
    try {
      const payload = {
        from_account_number: fromAcc,
        to_account_number: activeSubTab === 'upi' ? upiId : toAcc,
        beneficiary_name: beneficiaryName || (activeSubTab === 'upi' ? 'UPI Payee' : 'Registered Payee'),
        beneficiary_ifsc: ifsc,
        transfer_type: activeSubTab === 'upi' ? 'UPI' : transferType,
        amount: parseFloat(amount),
        remarks: remarks || (activeSubTab === 'upi' ? 'UPI Payment' : `${transferType} Transfer`),
        transaction_password: txnPwd,
        is_scheduled: isScheduled,
        schedule_date: isScheduled ? scheduleDate : null
      };

      const res = await api.transferFunds(payload);
      toast.success(res.message);
      setAmount('');
      setToAcc('');
      setUpiId('');
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

  const handleBulkTransfer = async (e) => {
    e.preventDefault();
    if (!bulkText || !txnPwd) {
      toast.error("Please provide CSV data and Transaction Password.");
      return;
    }

    const lines = bulkText.trim().split('\n');
    const transfers = [];

    for (const line of lines) {
      const parts = line.split(',').map(s => s.trim());
      if (parts.length >= 4) {
        transfers.push({
          beneficiary_name: parts[0],
          account_number: parts[1],
          ifsc: parts[2] || 'AJSP0000042',
          amount: parseFloat(parts[3]),
          remarks: parts[4] || 'Corporate Payout'
        });
      }
    }

    if (transfers.length === 0) {
      toast.error("Invalid CSV format. Use: Name,AccountNumber,IFSC,Amount,Remarks");
      return;
    }

    setLoading(true);
    try {
      const res = await api.bulkTransfer({
        from_account_number: fromAcc,
        transfers,
        transaction_password: txnPwd
      });
      toast.success(`Batch processed! ${res.transfers_count} payouts executed successfully.`);
      setTxnPwd('');
      const txnRes = await api.getTransactions();
      setTransactions(txnRes.transactions || []);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Bulk transfer execution failed");
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
            Fund Transfers & Corporate Payout Hub
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            IMPS (24x7 Instant) | NEFT (Batch Settlement) | RTGS (High Value) | UPI Integration
          </p>
        </div>

        {/* Transfer Subtabs */}
        <div className="flex items-center gap-1.5 p-1 rounded-xl bg-white border border-slate-200 text-xs">
          <button
            data-testid="subtab-single-transfer"
            onClick={() => setActiveSubTab('single')}
            className={`px-3 py-1.5 rounded-lg font-medium transition ${
              activeSubTab === 'single' ? 'bg-[#0b3b8c] text-white font-semibold' : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            Intra/Inter-Bank
          </button>
          <button
            data-testid="subtab-upi-transfer"
            onClick={() => setActiveSubTab('upi')}
            className={`px-3 py-1.5 rounded-lg font-medium transition ${
              activeSubTab === 'upi' ? 'bg-[#0b3b8c] text-white font-semibold' : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            UPI Transfer
          </button>
          <button
            data-testid="subtab-bulk-transfer"
            onClick={() => setActiveSubTab('bulk')}
            className={`px-3 py-1.5 rounded-lg font-medium transition ${
              activeSubTab === 'bulk' ? 'bg-[#0b3b8c] text-white font-semibold' : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            Corporate Bulk Payout
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Transfer Form Box */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl p-6 shadow-xl">
          
          {activeSubTab === 'single' && (
            <form onSubmit={handleSingleTransfer} className="space-y-4 text-xs">
              <h2 className="font-bold text-slate-900 text-sm pb-2 border-b border-slate-200 flex items-center justify-between">
                <span>Inter-Bank & Intra-Bank Transfer</span>
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
                  placeholder="e.g. Monthly Rent / Supplier Invoice #98"
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

          {activeSubTab === 'upi' && (
            <form onSubmit={handleSingleTransfer} className="space-y-4 text-xs">
              <h2 className="font-bold text-slate-900 text-sm pb-2 border-b border-slate-200 flex items-center justify-between">
                <span>Unified Payments Interface (UPI 2.0)</span>
                <span className="text-[#0b3b8c] font-mono">NPCI Verified</span>
              </h2>

              <div>
                <label className="block text-slate-500 mb-1">Virtual Payment Address (VPA / UPI ID)</label>
                <input
                  data-testid="upi-id-input"
                  type="text"
                  required
                  value={upiId}
                  onChange={(e) => setUpiId(e.target.value)}
                  placeholder="e.g. merchant@ajspay, friend@ajspay"
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900 font-mono"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-500 mb-1">Debit From Account</label>
                  <select
                    value={fromAcc}
                    onChange={(e) => setFromAcc(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900 font-mono"
                  >
                    {accounts.map(a => (
                      <option key={a.id} value={a.account_number}>
                        {a.account_name} ({a.account_number})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-500 mb-1">Amount (₹)</label>
                  <input
                    data-testid="upi-amount-input"
                    type="number"
                    step="0.01"
                    required
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="e.g. 1500"
                    className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900 font-bold"
                  />
                </div>
              </div>

              <div>
                <label className="block text-rose-300 font-semibold mb-1">Transaction Password / UPI PIN</label>
                <input
                  data-testid="upi-txnpwd-input"
                  type="password"
                  required
                  value={txnPwd}
                  onChange={(e) => setTxnPwd(e.target.value)}
                  placeholder="Enter Transaction Password"
                  className="w-full bg-white border border-rose-500/40 rounded-xl px-3 py-2.5 text-slate-900"
                />
              </div>

              <button
                data-testid="execute-upi-transfer-btn"
                type="submit"
                disabled={loading}
                className={`w-full py-3 rounded-xl ${currentTheme.buttonTheme} font-bold text-sm shadow-xl`}
              >
                {loading ? 'Routing to NPCI UPI Switch...' : 'Instant Pay via UPI'}
              </button>
            </form>
          )}

          {activeSubTab === 'bulk' && (
            <form onSubmit={handleBulkTransfer} className="space-y-4 text-xs">
              <h2 className="font-bold text-slate-900 text-sm pb-2 border-b border-slate-200 flex items-center justify-between">
                <span>Corporate Multi-Beneficiary Bulk Batch Upload</span>
                <span className="text-amber-600 font-mono">AJSPay Corporate CMS</span>
              </h2>

              <p className="text-slate-500 text-[11px]">
                Format: <strong className="text-slate-700">BeneficiaryName, AccountNumber, IFSC, Amount, Remarks</strong> (one per line)
              </p>

              <div>
                <textarea
                  data-testid="bulk-transfer-textarea"
                  rows={6}
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-xl p-3 text-slate-700 font-mono text-xs leading-relaxed focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-rose-300 font-semibold mb-1">
                  Corporate Authorized Transaction Password
                </label>
                <input
                  data-testid="bulk-txnpwd-input"
                  type="password"
                  required
                  value={txnPwd}
                  onChange={(e) => setTxnPwd(e.target.value)}
                  placeholder="Enter Corporate Transaction Password"
                  className="w-full bg-white border border-rose-500/40 rounded-xl px-3 py-2.5 text-slate-900"
                />
              </div>

              <button
                data-testid="execute-bulk-transfer-btn"
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700 text-white font-bold text-sm shadow-xl"
              >
                {loading ? 'Batch Execution in Progress...' : 'Execute Corporate Payout Batch'}
              </button>
            </form>
          )}

        </div>

        {/* Transfer Limits & Info Panel */}
        <div className="space-y-5">
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xl text-xs space-y-3">
            <h3 className="font-bold text-slate-900 text-sm pb-2 border-b border-slate-200">
              Daily Transfer Limits
            </h3>
            
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
              <div className="flex justify-between items-center p-2 rounded-lg bg-slate-50">
                <span className="font-medium text-emerald-700">UPI (NPCI)</span>
                <span className="font-mono text-slate-900">₹1,00,000 / day</span>
              </div>
            </div>

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
                <tr key={t.id} className="hover:bg-slate-50 transition">
                  <td className="p-3 font-mono text-[#0b3b8c]">{t.ref_number}</td>
                  <td className="p-3 font-semibold text-slate-700">{t.mode}</td>
                  <td className="p-3">{t.counterparty_name || t.description}</td>
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
