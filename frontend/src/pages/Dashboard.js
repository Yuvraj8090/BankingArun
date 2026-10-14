import React, { useEffect, useState } from 'react';
import {
  Wallet, TrendingUp, ArrowUpRight, ArrowDownLeft, ShieldCheck, RefreshCw, Send, CheckCircle
} from 'lucide-react';
import { api } from '../services/api';
import { useBankTheme } from '../context/BankThemeContext';
import { toast } from 'sonner';
import { txnMode, showsDetail } from '../utils/format';

export default function Dashboard({ onNavigate }) {
  const { currentTheme } = useBankTheme();
  // Services this institution is not yet authorised to offer must not appear
  // on the dashboard either (see hostinger/modules/compliance.php).
  const [data, setData] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedAcc, setSelectedAcc] = useState(null);
  const [showQuickTransfer, setShowQuickTransfer] = useState(false);
  const [quickAmount, setQuickAmount] = useState('');
  const [quickBeneficiary, setQuickBeneficiary] = useState('');
  const [quickAccountNumber, setQuickAccountNumber] = useState('');
  const [quickTxnPwd, setQuickTxnPwd] = useState('');
  const [transferring, setTransferring] = useState(false);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      const accData = await api.getAccounts();
      setData(accData);
      if (accData.accounts?.length > 0) {
        setSelectedAcc(accData.accounts[0]);
      }
      const txnData = await api.getTransactions();
      setTransactions(txnData.transactions || []);
    } catch (err) {
      toast.error("Failed to load account details");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const handleQuickTransfer = async (e) => {
    e.preventDefault();
    if (!quickBeneficiary || !quickAccountNumber || !quickAmount || !quickTxnPwd || !selectedAcc) {
      toast.error("Please fill all transfer fields");
      return;
    }
    setTransferring(true);
    try {
      const res = await api.transferFunds({
        from_account_number: selectedAcc.account_number,
        to_account_number: quickAccountNumber.trim(),
        beneficiary_name: quickBeneficiary,
        transfer_type: "IMPS",
        amount: parseFloat(quickAmount),
        remarks: "Member transfer",
        transaction_password: quickTxnPwd
      });
      toast.success(res.message);
      setShowQuickTransfer(false);
      setQuickAmount('');
      setQuickBeneficiary('');
      setQuickAccountNumber('');
      setQuickTxnPwd('');
      fetchDashboardData();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Transfer failed");
    } finally {
      setTransferring(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[400px]">
        <div className="flex items-center gap-3 text-[#0b3b8c]">
          <RefreshCw className="w-6 h-6 animate-spin" />
          <span>Loading your member portal…</span>
        </div>
      </div>
    );
  }

  const primaryAcc = selectedAcc || data?.accounts?.[0];

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      
      {/* Top Banner with KYC & Net Worth */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white border border-slate-200 p-5 rounded-2xl shadow-xl backdrop-blur-md">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            Your member portal
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Member ledger · every entry double-recorded and auditable
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            data-testid="refresh-dashboard-btn"
            onClick={fetchDashboardData}
            className="p-2.5 rounded-xl bg-slate-100 hover:bg-slate-100 border border-slate-200 text-slate-600 hover:text-slate-900 transition"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            data-testid="dashboard-quick-transfer-btn"
            onClick={() => setShowQuickTransfer(true)}
            className={`px-4 py-2 rounded-xl text-xs font-semibold ${currentTheme.buttonTheme} flex items-center gap-2 shadow-lg`}
          >
            <Send className="w-3.5 h-3.5" /> Pay a member
          </button>
        </div>
      </div>

      {/* Hero Financial Summary Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        
        {/* Savings Balance Card */}
        <div className={`p-6 rounded-2xl bg-white/40 border border-slate-200 ${currentTheme.cardGlow} relative overflow-hidden`}>
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs font-medium text-slate-500">Primary Savings Balance</p>
              <h2 data-testid="account-balance-display" className="text-2xl sm:text-3xl font-extrabold text-slate-900 mt-2 tracking-tight">
                ₹{primaryAcc ? primaryAcc.balance.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '0.00'}
              </h2>
            </div>
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-[#0b3b8c]">
              <Wallet className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
            <span className="font-mono text-[11px] text-slate-600">{primaryAcc?.account_number || 'A/C: N/A'}</span>
            <span className="text-emerald-700 font-semibold">{primaryAcc?.ifsc_code}</span>
          </div>
        </div>

        {/* Total Deposits & Fixed Deposits */}
        <div className="p-6 rounded-2xl bg-white/40 border border-slate-200 shadow-xl relative overflow-hidden">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs font-medium text-slate-500">Fixed & Recurring Deposits</p>
              <h2 data-testid="deposits-balance-display" className="text-2xl sm:text-3xl font-extrabold text-[#0b3b8c] mt-2 tracking-tight">
                ₹{(data?.total_deposits_balance || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </h2>
            </div>
            <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-[#0b3b8c]">
              <TrendingUp className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
            <span>{data?.deposits?.length || 0} Active Deposit(s)</span>
            <button onClick={() => onNavigate('deposits')} className="text-[#0b3b8c] hover:underline">
              + Book New FD
            </button>
          </div>
        </div>

        {/* Total Liquid Net Worth */}
        <div className="p-6 rounded-2xl bg-white/40 border border-slate-200 shadow-xl relative overflow-hidden">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs font-medium text-slate-500">Total Net Liquidity</p>
              <h2 data-testid="networth-display" className="text-2xl sm:text-3xl font-extrabold text-emerald-700 mt-2 tracking-tight">
                ₹{(data?.net_worth || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </h2>
            </div>
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-700">
              <ShieldCheck className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
            <span>Member account</span>
            <span className="text-emerald-700 flex items-center gap-1">
              <CheckCircle className="w-3 h-3" /> Member deposits
            </span>
          </div>
        </div>

      </div>

      {/* Main Content: Transactions & Virtual Card Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Recent Transactions / Mini Statement */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl p-5 shadow-xl">
          <div className="flex items-center justify-between pb-4 border-b border-slate-200">
            <div>
              <h3 className="font-bold text-slate-900 text-base">Mini Statement & Recent Activity</h3>
              <p className="text-xs text-slate-500">Live ledger updates with UTR / Ref numbers</p>
            </div>
            <button
              data-testid="view-all-transfers-btn"
              onClick={() => onNavigate('transfer')}
              className="text-xs text-[#0b3b8c] hover:underline font-medium"
            >
              Full Passbook & Transfers &rarr;
            </button>
          </div>

          <div className="mt-4 space-y-3 overflow-x-auto">
            {transactions.length === 0 ? (
              <p className="text-slate-500 text-xs py-8 text-center">No transactions found for this account.</p>
            ) : (
              transactions.slice(0, 5).map((txn) => {
                const isCredit = txn.type === 'credit';
                return (
                  <div
                    key={txn.id}
                    data-testid={`txn-row-${txn.id}`}
                    className="flex items-center justify-between p-3.5 rounded-xl bg-slate-50 border border-slate-200 hover:border-slate-200 transition"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                        isCredit ? 'bg-emerald-500/10 text-emerald-700 border border-emerald-500/20' : 'bg-rose-500/10 text-[#c8102e] border border-rose-500/20'
                      }`}>
                        {isCredit ? <ArrowDownLeft className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
                      </div>
                      <div>
                        <p className="font-semibold text-xs text-slate-900">{txn.counterparty_name || txn.description}</p>
                        {showsDetail(txn.mode) && txn.description && (
                          <p className="text-[10px] text-slate-500 max-w-md">{txn.description}</p>
                        )}
                        <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5">
                          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{txnMode(txn.mode)}</span>
                          <span>{new Date(txn.timestamp).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                      </div>
                    </div>

                    <div className="text-right">
                      <p className={`font-bold text-xs ${isCredit ? 'text-emerald-700' : 'text-slate-800'}`}>
                        {isCredit ? '+' : '-'} ₹{txn.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </p>
                      <p className="text-[10px] text-slate-500 font-mono mt-0.5">Ref: {txn.ref_number.slice(0, 16)}...</p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="space-y-6">
          
          {/* Quick actions */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xl space-y-2.5">
            <h3 className="font-bold text-slate-900 text-xs pb-2 border-b border-slate-200">Shortcuts</h3>
            <button
              onClick={() => onNavigate('transfer')}
              className="w-full flex items-center justify-between p-2.5 rounded-xl bg-slate-50 hover:bg-slate-100 text-xs text-slate-600 transition"
            >
              <span>Pay a member</span>
              <ArrowUpRight className="w-3.5 h-3.5 text-[#0b3b8c]" />
            </button>
            <button
              onClick={() => onNavigate('loans')}
              className="w-full flex items-center justify-between p-2.5 rounded-xl bg-slate-50 hover:bg-slate-100 text-xs text-slate-600 transition"
            >
              <span>Loans and EMI calculator</span>
              <ArrowUpRight className="w-3.5 h-3.5 text-[#0b3b8c]" />
            </button>
            <button
              onClick={() => onNavigate('branches')}
              className="w-full flex items-center justify-between p-2.5 rounded-xl bg-slate-50 hover:bg-slate-100 text-xs text-slate-600 transition"
            >
              <span>Find a branch</span>
              <ArrowUpRight className="w-3.5 h-3.5 text-[#0b3b8c]" />
            </button>
          </div>

        </div>

      </div>

      {/* Quick Transfer Modal */}
      {showQuickTransfer && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center pb-3 border-b border-slate-200">
              <h3 className="font-bold text-slate-900 text-base">Pay a member</h3>
              <button onClick={() => setShowQuickTransfer(false)} className="text-slate-500 hover:text-slate-900 text-sm">✕</button>
            </div>

            <form onSubmit={handleQuickTransfer} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-500 mb-1">Beneficiary Name</label>
                <input
                  data-testid="quick-beneficiary-input"
                  type="text"
                  required
                  value={quickBeneficiary}
                  onChange={(e) => setQuickBeneficiary(e.target.value)}
                  placeholder="e.g. Ramesh Patel"
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-900"
                />
              </div>

              <div>
                <label className="block text-slate-500 mb-1">Beneficiary Account Number</label>
                <input
                  data-testid="quick-account-input"
                  type="text"
                  required
                  value={quickAccountNumber}
                  onChange={(e) => setQuickAccountNumber(e.target.value)}
                  placeholder="e.g. AJSP0123456789"
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-900"
                />
              </div>

              <div>
                <label className="block text-slate-500 mb-1">Amount (₹)</label>
                <input
                  data-testid="quick-amount-input"
                  type="number"
                  step="0.01"
                  required
                  value={quickAmount}
                  onChange={(e) => setQuickAmount(e.target.value)}
                  placeholder="e.g. 5000"
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-900"
                />
              </div>

              <div>
                <label className="block text-slate-500 mb-1">Transaction Password</label>
                <input
                  data-testid="quick-txnpwd-input"
                  type="password"
                  required
                  value={quickTxnPwd}
                  onChange={(e) => setQuickTxnPwd(e.target.value)}
                  placeholder="Enter your 6+ char Transaction Password"
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-900"
                />
              </div>

              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowQuickTransfer(false)}
                  className="flex-1 py-2 rounded-xl bg-slate-100 text-slate-600 font-medium"
                >
                  Cancel
                </button>
                <button
                  data-testid="confirm-quick-transfer-btn"
                  type="submit"
                  disabled={transferring}
                  className={`flex-1 py-2 rounded-xl ${currentTheme.buttonTheme} font-semibold`}
                >
                  {transferring ? 'Processing UTR...' : 'Confirm Transfer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
