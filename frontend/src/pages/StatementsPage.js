import React, { useEffect, useState } from 'react';
import { FileText, FileSpreadsheet, Calendar, Download, RefreshCw, Info } from 'lucide-react';
import { api } from '../services/api';
import { toast } from 'sonner';

export default function StatementsPage() {
  const [accounts, setAccounts] = useState([]);
  const [acc, setAcc] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    api.getAccounts().then(r => {
      setAccounts(r.accounts || []);
      if (r.accounts?.length) setAcc(r.accounts[0].account_number);
    }).catch(() => toast.error('Failed to load accounts'));
  }, []);

  const download = async (kind) => {
    if (!acc) return toast.error('Select an account');
    setDownloading(true);
    try {
      await api.downloadStatement(kind, acc, start, end);
      toast.success(`${kind.toUpperCase()} statement downloaded`);
    } catch { toast.error('Download failed'); }
    finally { setDownloading(false); }
  };

  const setRange = (days) => {
    const now = new Date();
    const from = new Date(); from.setDate(now.getDate() - days);
    setStart(from.toISOString().slice(0, 10));
    setEnd(now.toISOString().slice(0, 10));
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto space-y-6">
      <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-md bg-[#0b3b8c] flex items-center justify-center">
            <FileText className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Account Statements</h1>
            <p className="text-xs text-slate-500">Standard statement format · PDF or Excel · One-tap download</p>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-6 shadow-sm space-y-5">
        {/* Account picker */}
        <div>
          <label className="block text-[11px] text-slate-600 mb-1">Account</label>
          <select data-testid="stmt-account-select" value={acc} onChange={e => setAcc(e.target.value)}
            className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm">
            {accounts.map(a => (
              <option key={a.account_number} value={a.account_number}>
                {a.account_number} — {a.account_name} ({a.account_type})
              </option>
            ))}
          </select>
        </div>

        {/* Quick range chips */}
        <div>
          <label className="block text-[11px] text-slate-600 mb-1">Quick range</label>
          <div className="flex flex-wrap gap-2">
            {[
              { l: 'Last 7 days', d: 7 },
              { l: 'Last 30 days', d: 30 },
              { l: 'Last 90 days', d: 90 },
              { l: 'This financial year', d: 365 }
            ].map(o => (
              <button key={o.d} data-testid={`stmt-range-${o.d}`} onClick={() => setRange(o.d)}
                className="px-3 py-1.5 rounded-full border border-slate-200 hover:border-[#0b3b8c] text-xs text-slate-700 hover:text-[#0b3b8c]">
                {o.l}
              </button>
            ))}
          </div>
        </div>

        {/* Manual range */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] text-slate-600 mb-1">From date</label>
            <div className="flex items-center border border-slate-200 rounded-md px-3">
              <Calendar className="w-3.5 h-3.5 text-slate-500" />
              <input data-testid="stmt-from-date" type="date" value={start} onChange={e => setStart(e.target.value)}
                className="flex-1 px-2 py-2 text-sm outline-none bg-transparent" />
            </div>
          </div>
          <div>
            <label className="block text-[11px] text-slate-600 mb-1">To date</label>
            <div className="flex items-center border border-slate-200 rounded-md px-3">
              <Calendar className="w-3.5 h-3.5 text-slate-500" />
              <input data-testid="stmt-to-date" type="date" value={end} onChange={e => setEnd(e.target.value)}
                className="flex-1 px-2 py-2 text-sm outline-none bg-transparent" />
            </div>
          </div>
        </div>

        {/* Downloads */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <button data-testid="download-pdf-btn" disabled={downloading || !acc}
            onClick={() => download('pdf')}
            className="p-4 rounded-md bg-[#c8102e] hover:bg-[#a30d25] text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-50 transition">
            {downloading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
            <span>Download PDF Statement</span>
          </button>
          <button data-testid="download-excel-btn" disabled={downloading || !acc}
            onClick={() => download('excel')}
            className="p-4 rounded-md bg-emerald-700 hover:bg-emerald-800 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-50 transition">
            {downloading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
            <span>Download Excel Statement</span>
          </button>
        </div>

        <div className="p-3 rounded-md bg-blue-50 border border-blue-100 text-[11px] text-slate-700 flex items-start gap-2">
          <Info className="w-3.5 h-3.5 text-[#0b3b8c] shrink-0 mt-0.5" />
          <span>
            Statements include a bank header, transaction table (Date · Ref · Mode · Description · Debit · Credit · Balance) and a footer with TDS note under section 194A. Leave dates blank to export all history.
          </span>
        </div>
      </div>
    </div>
  );
}
