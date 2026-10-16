import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3, Download, RefreshCw, Filter, X, ArrowUp, ArrowDown, FileSpreadsheet, FileText
} from 'lucide-react';
import { api } from '../services/api';
import Pagination from '../components/Pagination';
import { toast } from 'sonner';

// The API describes each report, so a new report on the server appears here
// without a frontend change. All this needs to know is how to draw an input for
// a filter key and how to align a column format.
const FILTER_INPUT = {
  from_date: 'date', to_date: 'date',
  min_amount: 'number', max_amount: 'number'
};
const FILTER_LABEL = {
  q: 'Search', from_date: 'From', to_date: 'To', min_amount: 'Min amount', max_amount: 'Max amount',
  kyc_status: 'KYC status', loan_type: 'Loan type', deposit_type: 'Deposit type', risk_grade: 'Risk grade',
  account_number: 'Account number', agent_id: 'Agent id', scheme_code: 'Plan code (e.g. AJS-MIS-40M)', plan: 'Plan code (e.g. AJS-MIS-40M)', state: 'State', period: 'Period'
};
const CHOICES = {
  status: ['', 'active', 'matured', 'closed', 'approved', 'disbursed', 'under_review', 'rejected',
    'OPEN', 'IN_PROGRESS', 'WAITING_MEMBER', 'RESOLVED', 'CLOSED', 'open', 'cleared', 'escalated'],
  priority: ['', 'LOW', 'MEDIUM', 'HIGH', 'URGENT'],
  severity: ['', 'low', 'medium', 'high'],
  type: ['', 'credit', 'debit'],
  kyc_status: ['', 'verified', 'pending_approval', 'rejected'],
  risk_grade: ['', 'A', 'B', 'C', 'D', 'E'],
  deposit_type: ['', 'fixed', 'recurring'],
  period: ['', 'half-year ends'],
  state: ['', 'enrolled', 'interest pending', 'enquired, not booked', 'waiting KYC', 'matured', 'closed']
};

const label = (k) => FILTER_LABEL[k] || k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function formatCell(value, format) {
  if (value === null || value === undefined || value === '') return <span className="text-slate-600">—</span>;
  if (format === 'money') return money(value);
  if (format === 'int') return Number(value).toLocaleString('en-IN');
  if (format === 'date') return new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  if (format === 'datetime') return new Date(value).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  return String(value);
}

export default function ReportsPage() {
  const [reports, setReports] = useState(null);
  const [active, setActive] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await api.reportsList();
        setReports(data.reports);
        if (data.reports.length) setActive(data.reports[0]);
      } catch (e) {
        // Show the reason rather than spinning forever on a failed load.
        setReports([]);
        toast.error(e.response?.data?.detail || 'Could not load the report list');
      }
    })();
  }, []);

  if (!reports) {
    return <div className="p-10 flex items-center gap-2 text-slate-600"><RefreshCw className="w-4 h-4 animate-spin" /> Loading reports…</div>;
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm flex items-center gap-3">
        <div className="w-10 h-10 rounded-md bg-[#0b3b8c] text-white flex items-center justify-center">
          <BarChart3 className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900">Reports</h1>
          <p className="text-xs text-slate-500">
            Filter, sort and export. Every download is recorded in the audit log.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-1 bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden h-fit">
          <div className="px-4 py-3 border-b border-slate-100 text-sm font-semibold text-slate-900">
            Available to you ({reports.length})
          </div>
          {!reports.length && (
            <p className="p-6 text-center text-xs text-slate-500">
              No reports are available to your role.
            </p>
          )}
          <div className="divide-y divide-slate-100">
            {reports.map((r) => (
              <button
                key={r.key}
                data-testid={`report-${r.key}`}
                onClick={() => setActive(r)}
                className={`w-full text-left p-3 hover:bg-slate-50 transition ${
                  active?.key === r.key ? 'bg-blue-50/60 border-l-2 border-l-[#0b3b8c]' : ''
                }`}
              >
                <div className="text-xs font-semibold text-slate-900">{r.name}</div>
                <div className="text-[10px] text-slate-500 mt-0.5 leading-snug">{r.note}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="lg:col-span-3">
          {active ? <ReportView key={active.key} report={active} /> : (
            <div className="bg-white border border-slate-200 rounded-lg p-10 text-center text-xs text-slate-500">
              Pick a report.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ReportView({ report }) {
  const [filters, setFilters] = useState({});
  const [draft, setDraft] = useState({});
  const [sort, setSort] = useState({ key: '', dir: 'asc' });
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState('');
  const [showFilters, setShowFilters] = useState(true);

  const params = useMemo(() => ({
    ...filters,
    page,
    per_page: perPage,
    ...(sort.key ? { sort: sort.key, dir: sort.dir } : {})
  }), [filters, page, perPage, sort]);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await api.reportRun(report.key, params)); }
    catch (e) { toast.error(e.response?.data?.detail || 'Could not run this report'); }
    finally { setLoading(false); }
  }, [report.key, params]);
  useEffect(() => { load(); }, [load]);

  const apply = () => {
    // Drop empty boxes so they never reach the query string.
    const cleaned = Object.fromEntries(Object.entries(draft).filter(([, v]) => v !== '' && v != null));
    setFilters(cleaned);
    setPage(1);
  };
  const clear = () => { setDraft({}); setFilters({}); setPage(1); };

  const toggleSort = (key) => {
    setSort((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }));
    setPage(1);
  };

  const exportAs = async (format) => {
    setExporting(format);
    try {
      // Fetched with the auth header and saved from memory, so nothing sensitive
      // ends up in a URL or browser history.
      await api.reportExport(report.key, { ...filters, format });
      toast.success(`${format.toUpperCase()} downloaded. The export is in the audit log.`);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Export failed');
    } finally { setExporting(''); }
  };

  const columns = data ? Object.entries(data.columns) : [];
  const totals = data?.totals || {};
  const hasTotals = Object.keys(totals).length > 0;
  const activeFilterCount = Object.keys(filters).length;

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
        <div className="p-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">{report.name}</h2>
            <p className="text-[11px] text-slate-500">{report.note}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowFilters((v) => !v)}
              data-testid="report-toggle-filters"
              className="px-3 py-2 rounded-md border border-slate-200 text-xs font-semibold text-slate-700 flex items-center gap-1.5"
            >
              <Filter className="w-3.5 h-3.5" /> Filters
              {activeFilterCount > 0 && (
                <span className="ml-1 px-1.5 rounded-full bg-[#0b3b8c] text-white text-[10px]">{activeFilterCount}</span>
              )}
            </button>
            <button onClick={load} className="px-3 py-2 rounded-md border border-slate-200 text-xs font-semibold text-slate-700">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              data-testid="report-export-csv"
              disabled={!!exporting}
              onClick={() => exportAs('csv')}
              className="px-3 py-2 rounded-md border border-slate-200 text-xs font-semibold text-slate-700 flex items-center gap-1.5 disabled:opacity-50"
            >
              <FileText className="w-3.5 h-3.5" /> CSV
            </button>
            <button
              data-testid="report-export-xlsx"
              disabled={!!exporting}
              onClick={() => exportAs('xlsx')}
              className="px-3 py-2 rounded-md bg-[#0b3b8c] text-white text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
            >
              {exporting === 'xlsx' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <FileSpreadsheet className="w-3.5 h-3.5" />}
              Excel
            </button>
          </div>
        </div>

        {showFilters && (
          <div className="p-4 bg-slate-50 border-b border-slate-100">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {report.filters.map((key) => (
                <div key={key}>
                  <label className="block text-[11px] text-slate-600 mb-1">{label(key)}</label>
                  {CHOICES[key] ? (
                    <select
                      value={draft[key] ?? ''}
                      data-testid={`report-filter-${key}`}
                      onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                      className="w-full border border-slate-200 rounded-md px-3 py-2 text-xs bg-white"
                    >
                      {CHOICES[key].map((c) => <option key={c} value={c}>{c || 'Any'}</option>)}
                    </select>
                  ) : (
                    <input
                      type={FILTER_INPUT[key] || 'text'}
                      value={draft[key] ?? ''}
                      data-testid={`report-filter-${key}`}
                      onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                      onKeyDown={(e) => e.key === 'Enter' && apply()}
                      className="w-full border border-slate-200 rounded-md px-3 py-2 text-xs"
                    />
                  )}
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 mt-3">
              <button data-testid="report-apply" onClick={apply}
                className="px-4 py-2 rounded-md bg-[#0b3b8c] text-white text-xs font-semibold">Apply</button>
              {activeFilterCount > 0 && (
                <button onClick={clear} className="px-3 py-2 rounded-md border border-slate-200 text-xs text-slate-600 flex items-center gap-1">
                  <X className="w-3 h-3" /> Clear
                </button>
              )}
            </div>
          </div>
        )}

        {!data ? (
          <p className="p-10 text-center text-xs text-slate-500">Running…</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-[11px] uppercase text-slate-600">
                  <tr>
                    {columns.map(([col, format]) => (
                      <th
                        key={col}
                        onClick={() => toggleSort(col)}
                        data-testid={`report-sort-${col}`}
                        className={`p-3 font-semibold cursor-pointer select-none hover:text-[#0b3b8c] whitespace-nowrap ${
                          format === 'money' || format === 'int' ? 'text-right' : ''
                        }`}
                      >
                        <span className="inline-flex items-center gap-1">
                          {label(col)}
                          {sort.key === col && (sort.dir === 'asc'
                            ? <ArrowUp className="w-3 h-3" />
                            : <ArrowDown className="w-3 h-3" />)}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.rows.map((row, i) => (
                    <tr key={i} className="hover:bg-blue-50/40 transition-colors">
                      {columns.map(([col, format]) => (
                        <td key={col} className={`p-3 ${
                          format === 'money' || format === 'int'
                            ? 'text-right font-medium text-slate-900 whitespace-nowrap'
                            : 'text-slate-700'
                        }`}>
                          {formatCell(row[col], format)}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {!data.rows.length && (
                    <tr><td colSpan={columns.length} className="p-10 text-center text-slate-500">
                      Nothing matches these filters.
                    </td></tr>
                  )}
                </tbody>
                {hasTotals && data.rows.length > 0 && (
                  <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                    <tr>
                      {columns.map(([col, format], i) => (
                        <td key={col} className={`p-3 font-bold text-slate-900 ${
                          format === 'money' || format === 'int' ? 'text-right' : ''
                        }`}>
                          {i === 0 ? 'Total (all pages)' : (totals[col] !== undefined ? money(totals[col]) : '')}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            <Pagination meta={data.pagination} onPage={setPage} onPerPage={(n) => { setPerPage(n); setPage(1); }} />
          </>
        )}
      </div>

      <p className="text-[11px] text-slate-500 leading-relaxed flex items-start gap-1.5">
        <Download className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        Totals cover every row matching the current filters, not just the page shown. Exports are capped at
        20,000 rows and each one is written to the audit log with its row count.
      </p>
    </div>
  );
}
