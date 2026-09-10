import React, { useEffect, useState } from 'react';
import { 
  Wallet, TrendingUp, ArrowUpRight, ArrowDownLeft, ShieldCheck, 
  CreditCard, Lock, RefreshCw, Send, PlusCircle, CheckCircle, FileText, Download
} from 'lucide-react';
import { api } from '../services/api';
import { useBankTheme } from '../context/BankThemeContext';
import { toast } from 'sonner';

export default function Dashboard({ onNavigate }) {
  const { currentTheme } = useBankTheme();
  const [data, setData] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedAcc, setSelectedAcc] = useState(null);
  const [showQuickTransfer, setShowQuickTransfer] = useState(false);
  const [quickAmount, setQuickAmount] = useState('');
  const [quickBeneficiary, setQuickBeneficiary] = useState('');
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
    if (!quickBeneficiary || !quickAmount || !quickTxnPwd || !selectedAcc) {
      toast.error("Please fill all transfer fields");
      return;
    }
    setTransferring(true);
    try {
      const res = await api.transferFunds({
        from_account_number: selectedAcc.account_number,
        to_account_number: "SBI00" + Math.floor(100000000 + Math.random() * 900000000),
        beneficiary_name: quickBeneficiary,
        transfer_type: "IMPS",
        amount: parseFloat(quickAmount),
        remarks: "Instant Quick Transfer",
        transaction_password: quickTxnPwd
      });
      toast.success(res.message);
      setShowQuickTransfer(false);
      setQuickAmount('');
      setQuickBeneficiary('');
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
        <div className="flex items-center gap-3 text-cyan-400">
          <RefreshCw className="w-6 h-6 animate-spin" />
          <span>Loading secure NetBanking dashboard...</span>
        </div>
      </div>
    );
  }

  const primaryAcc = selectedAcc || data?.accounts?.[0];
  const primaryCard = data?.cards?.[0];

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      
      {/* Top Banner with KYC & Net Worth */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/90 border border-slate-800 p-5 rounded-2xl shadow-xl backdrop-blur-md">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight flex items-center gap-2">
            Welcome to NetBanking Overview
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Indian Core Banking Standard | Encrypted Multi-Tier Core Ledger
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            data-testid="refresh-dashboard-btn"
            onClick={fetchDashboardData}
            className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white transition"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            data-testid="dashboard-quick-transfer-btn"
            onClick={() => setShowQuickTransfer(true)}
            className={`px-4 py-2 rounded-xl text-xs font-semibold ${currentTheme.buttonTheme} flex items-center gap-2 shadow-lg`}
          >
            <Send className="w-3.5 h-3.5" /> Quick Pay (IMPS/UPI)
          </button>
        </div>
      </div>

      {/* Hero Financial Summary Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        
        {/* Savings Balance Card */}
        <div className={`p-6 rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950/40 border border-slate-800 ${currentTheme.cardGlow} relative overflow-hidden`}>
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs font-medium text-slate-400">Primary Savings Balance</p>
              <h2 data-testid="account-balance-display" className="text-2xl sm:text-3xl font-extrabold text-white mt-2 tracking-tight">
                ₹{primaryAcc ? primaryAcc.balance.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '0.00'}
              </h2>
            </div>
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-cyan-400">
              <Wallet className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
            <span className="font-mono text-[11px] text-slate-300">{primaryAcc?.account_number || 'A/C: N/A'}</span>
            <span className="text-emerald-400 font-semibold">{primaryAcc?.ifsc_code}</span>
          </div>
        </div>

        {/* Total Deposits & Fixed Deposits */}
        <div className="p-6 rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900 to-cyan-950/40 border border-slate-800 shadow-xl relative overflow-hidden">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs font-medium text-slate-400">Fixed & Recurring Deposits</p>
              <h2 data-testid="deposits-balance-display" className="text-2xl sm:text-3xl font-extrabold text-cyan-300 mt-2 tracking-tight">
                ₹{(data?.total_deposits_balance || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </h2>
            </div>
            <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <TrendingUp className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
            <span>{data?.deposits?.length || 0} Active Deposit(s)</span>
            <button onClick={() => onNavigate('deposits')} className="text-cyan-400 hover:underline">
              + Book New FD
            </button>
          </div>
        </div>

        {/* Total Liquid Net Worth */}
        <div className="p-6 rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950/40 border border-slate-800 shadow-xl relative overflow-hidden">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs font-medium text-slate-400">Total Net Liquidity</p>
              <h2 data-testid="networth-display" className="text-2xl sm:text-3xl font-extrabold text-emerald-400 mt-2 tracking-tight">
                ₹{(data?.net_worth || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </h2>
            </div>
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <ShieldCheck className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
            <span>UPI ID: <strong className="text-slate-300">{primaryAcc?.upi_id}</strong></span>
            <span className="text-emerald-400 flex items-center gap-1">
              <CheckCircle className="w-3 h-3" /> DICGC Insured
            </span>
          </div>
        </div>

      </div>

      {/* Main Content: Transactions & Virtual Card Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Recent Transactions / Mini Statement */}
        <div className="lg:col-span-2 bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl">
          <div className="flex items-center justify-between pb-4 border-b border-slate-800">
            <div>
              <h3 className="font-bold text-white text-base">Mini Statement & Recent Activity</h3>
              <p className="text-xs text-slate-400">Live ledger updates with UTR / Ref numbers</p>
            </div>
            <button
              data-testid="view-all-transfers-btn"
              onClick={() => onNavigate('transfer')}
              className="text-xs text-cyan-400 hover:underline font-medium"
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
                    className="flex items-center justify-between p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 hover:border-slate-700 transition"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                        isCredit ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                      }`}>
                        {isCredit ? <ArrowDownLeft className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
                      </div>
                      <div>
                        <p className="font-semibold text-xs text-white">{txn.counterparty_name || txn.description}</p>
                        <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5">
                          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">{txn.mode}</span>
                          <span>{new Date(txn.timestamp).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                      </div>
                    </div>

                    <div className="text-right">
                      <p className={`font-bold text-xs ${isCredit ? 'text-emerald-400' : 'text-slate-100'}`}>
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

        {/* Virtual Debit Card Widget & Quick Actions */}
        <div className="space-y-6">
          
          {/* Card Preview */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="font-bold text-white text-xs">Primary Debit Card</h3>
              <button onClick={() => onNavigate('cards')} className="text-xs text-cyan-400 hover:underline">
                Manage Limits
              </button>
            </div>

            {primaryCard ? (
              <div className="mt-4 p-5 rounded-2xl bg-gradient-to-tr from-slate-950 via-indigo-950 to-blue-900 border border-indigo-500/30 shadow-2xl relative text-white space-y-4">
                <div className="flex justify-between items-start">
                  <span className="text-[10px] uppercase tracking-widest font-bold text-cyan-300">
                    {primaryCard.card_type}
                  </span>
                  <div className="w-8 h-6 rounded bg-amber-400/80"></div>
                </div>

                <div className="font-mono text-base tracking-widest text-slate-200 pt-2" data-testid="virtual-card-number">
                  {primaryCard.card_number}
                </div>

                <div className="flex justify-between items-end text-[11px] pt-2">
                  <div>
                    <p className="text-[9px] text-slate-400 uppercase">Card Holder</p>
                    <p className="font-semibold text-slate-200">{primaryCard.card_holder}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[9px] text-slate-400 uppercase">Expires</p>
                    <p className="font-semibold font-mono text-slate-200">{primaryCard.expiry_date}</p>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-slate-500 text-xs py-4">No active card issued.</p>
            )}

            <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
              <button
                data-testid="quick-block-card-btn"
                onClick={() => onNavigate('cards')}
                className="py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-center font-medium transition"
              >
                Hotlist / Freeze
              </button>
              <button
                data-testid="quick-request-cheque-btn"
                onClick={() => onNavigate('cards')}
                className="py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-center font-medium transition"
              >
                Cheque Book
              </button>
            </div>
          </div>

          {/* Core Banking Fast Actions */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-2.5">
            <h3 className="font-bold text-white text-xs pb-2 border-b border-slate-800">Quick Indian Banking Services</h3>
            <button
              onClick={() => onNavigate('transfer')}
              className="w-full flex items-center justify-between p-2.5 rounded-xl bg-slate-950/60 hover:bg-slate-800 text-xs text-slate-300 transition"
            >
              <span>NEFT / RTGS Transfer</span>
              <ArrowUpRight className="w-3.5 h-3.5 text-cyan-400" />
            </button>
            <button
              onClick={() => onNavigate('loans')}
              className="w-full flex items-center justify-between p-2.5 rounded-xl bg-slate-950/60 hover:bg-slate-800 text-xs text-slate-300 transition"
            >
              <span>Loan EMI Calculator & Eligibility</span>
              <ArrowUpRight className="w-3.5 h-3.5 text-cyan-400" />
            </button>
            <button
              onClick={() => onNavigate('locator')}
              className="w-full flex items-center justify-between p-2.5 rounded-xl bg-slate-950/60 hover:bg-slate-800 text-xs text-slate-300 transition"
            >
              <span>Find ATM & Cash Deposit Machine</span>
              <ArrowUpRight className="w-3.5 h-3.5 text-cyan-400" />
            </button>
          </div>

        </div>

      </div>

      {/* Quick Transfer Modal */}
      {showQuickTransfer && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center pb-3 border-b border-slate-800">
              <h3 className="font-bold text-white text-base">Instant Fund Transfer (IMPS)</h3>
              <button onClick={() => setShowQuickTransfer(false)} className="text-slate-400 hover:text-white text-sm">✕</button>
            </div>

            <form onSubmit={handleQuickTransfer} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Beneficiary Name</label>
                <input
                  data-testid="quick-beneficiary-input"
                  type="text"
                  required
                  value={quickBeneficiary}
                  onChange={(e) => setQuickBeneficiary(e.target.value)}
                  placeholder="e.g. Ramesh Patel"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Amount (₹)</label>
                <input
                  data-testid="quick-amount-input"
                  type="number"
                  step="0.01"
                  required
                  value={quickAmount}
                  onChange={(e) => setQuickAmount(e.target.value)}
                  placeholder="e.g. 5000"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Transaction Password</label>
                <input
                  data-testid="quick-txnpwd-input"
                  type="password"
                  required
                  value={quickTxnPwd}
                  onChange={(e) => setQuickTxnPwd(e.target.value)}
                  placeholder="Enter your 6+ char Transaction Password"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white"
                />
              </div>

              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowQuickTransfer(false)}
                  className="flex-1 py-2 rounded-xl bg-slate-800 text-slate-300 font-medium"
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
