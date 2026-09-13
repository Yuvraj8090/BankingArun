import React, { useState, useEffect } from 'react';
import { 
  Download, Globe, FileCode, CheckCircle2, Copy, 
  Server, ShieldCheck, Database, Layers, ArrowRight, ExternalLink 
} from 'lucide-react';
import { api } from '../services/api';
import { toast } from 'sonner';

export default function HostingerDeployPage() {
  const [pkg, setPkg] = useState(null);
  const [activeCodeTab, setActiveCodeTab] = useState('guide'); // guide, db, api, schema, htaccess
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await api.getHostingerPackage();
        setPkg(data);
      } catch (err) {
        toast.error("Failed to load Hostinger deployment package");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || '';

  // Authenticated download: the export is restricted to admins and the bank owner.
  const handleDownloadZip = async () => {
    try {
      await api.downloadHostingerZip();
      toast.success('Downloading hostinger_banking_php_mysql_package.zip');
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Download failed');
    }
  };

  const copyCode = (text) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard!");
  };

  // Every module now runs on the PHP/MySQL backend in /hostinger.
  const capabilityData = [
    { module: "Login, Registration & Sessions", ported: true },
    { module: "Accounts, Balances & Transaction History", ported: true },
    { module: "Instant Fund Transfers (IMPS, NEFT, RTGS, UPI)", ported: true },
    { module: "Corporate Bulk CMS Batch Transfers", ported: true },
    { module: "Debit Cards: Freeze, Hotlist, Limits & PIN", ported: true },
    { module: "UPI VPA & QR Payments", ported: true },
    { module: "Online FD / RD Booking", ported: true },
    { module: "Loans & EMI Applications", ported: true },
    { module: "Mutual Funds & Insurance", ported: true },
    { module: "Cheque Book, Stop Payment & Demand Drafts", ported: true },
    { module: "Support Chatbot & Complaints", ported: true },
    { module: "Statements (PDF/Excel), Video KYC, Passkeys & OTP", ported: true },
    { module: "Admin, Compliance Reports & Staff Panels", ported: true }
  ];
  const portedCount = capabilityData.filter(row => row.ported).length;

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      
      {/* Header */}
      <div className="bg-gradient-to-r from-amber-950/80 via-slate-900 to-slate-900 border border-amber-500/30 p-6 rounded-2xl shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
              Hostinger Shared Hosting Deployment Center
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
              cPanel & hPanel Ready
            </span>
          </div>
          <p className="text-xs text-slate-300 mt-1">
            Complete exportable PHP backend scripts, MySQL database schema, and step-by-step installation manual.
          </p>
        </div>

        <button
          data-testid="download-hostinger-zip-btn"
          onClick={handleDownloadZip}
          className="px-5 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-slate-950 font-bold text-xs shadow-2xl flex items-center gap-2 transition"
        >
          <Download className="w-4 h-4 text-slate-950" /> Download Hostinger Zip Package
        </button>
      </div>

      {/* Capability checklist */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
        <div className="flex justify-between items-center pb-2 border-b border-slate-800">
          <h2 className="font-bold text-white text-sm">
            AJSPay Banking Capabilities
          </h2>
          <span className="text-amber-300 text-xs font-mono">
            {portedCount} of {capabilityData.length} modules ported to PHP/MySQL
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950 text-[11px] uppercase text-slate-400">
              <tr>
                <th className="p-3">Core Banking Feature</th>
                <th className="p-3 text-right">AJSPay Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {capabilityData.map((row, idx) => (
                <tr key={idx} className="hover:bg-slate-800/40">
                  <td className="p-3 font-semibold text-slate-200">{row.module}</td>
                  <td className={`p-3 text-right font-bold ${row.ported ? 'text-emerald-400' : 'text-slate-500'}`}>
                    {row.ported ? '✅ PHP/MySQL ready' : '⏳ FastAPI only'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Source Code & Installation Guide Viewer */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div className="flex flex-wrap gap-1.5 text-xs">
            <button
              data-testid="tab-code-guide"
              onClick={() => setActiveCodeTab('guide')}
              className={`px-3 py-1.5 rounded-lg font-medium transition ${
                activeCodeTab === 'guide' ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-white bg-slate-950'
              }`}
            >
              Installation Manual
            </button>
            <button
              data-testid="tab-code-db"
              onClick={() => setActiveCodeTab('db')}
              className={`px-3 py-1.5 rounded-lg font-medium transition ${
                activeCodeTab === 'db' ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-white bg-slate-950'
              }`}
            >
              db.php (MySQL Connector)
            </button>
            <button
              data-testid="tab-code-api"
              onClick={() => setActiveCodeTab('api')}
              className={`px-3 py-1.5 rounded-lg font-medium transition ${
                activeCodeTab === 'api' ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-white bg-slate-950'
              }`}
            >
              api.php (Core REST API)
            </button>
            <button
              data-testid="tab-code-schema"
              onClick={() => setActiveCodeTab('schema')}
              className={`px-3 py-1.5 rounded-lg font-medium transition ${
                activeCodeTab === 'schema' ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-white bg-slate-950'
              }`}
            >
              schema.sql (Database Tables)
            </button>
            <button
              data-testid="tab-code-htaccess"
              onClick={() => setActiveCodeTab('htaccess')}
              className={`px-3 py-1.5 rounded-lg font-medium transition ${
                activeCodeTab === 'htaccess' ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-white bg-slate-950'
              }`}
            >
              .htaccess (SSL & Routing)
            </button>
          </div>

          <button
            onClick={() => {
              const text = activeCodeTab === 'guide' ? pkg?.deploy_guide :
                           activeCodeTab === 'db' ? pkg?.db_php :
                           activeCodeTab === 'api' ? pkg?.api_php :
                           activeCodeTab === 'schema' ? pkg?.schema_sql : pkg?.htaccess;
              copyCode(text || '');
            }}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 border border-slate-700"
          >
            <Copy className="w-3.5 h-3.5" /> Copy Code
          </button>
        </div>

        {/* Code Container */}
        <div className="bg-slate-950 rounded-xl p-4 border border-slate-800/80 overflow-x-auto max-h-[450px]">
          <pre className="font-mono text-xs text-slate-200 whitespace-pre-wrap leading-relaxed">
            {activeCodeTab === 'guide' && pkg?.deploy_guide}
            {activeCodeTab === 'db' && pkg?.db_php}
            {activeCodeTab === 'api' && pkg?.api_php}
            {activeCodeTab === 'schema' && pkg?.schema_sql}
            {activeCodeTab === 'htaccess' && pkg?.htaccess}
          </pre>
        </div>
      </div>

    </div>
  );
}
