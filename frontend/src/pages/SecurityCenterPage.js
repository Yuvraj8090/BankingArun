import React, { useEffect, useState } from 'react';
import { ShieldCheck, RefreshCw, Lock, CheckCircle2, XCircle, FileCheck2, Activity } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { toast } from 'sonner';

const SEVERITY = {
  critical: 'bg-rose-50 text-[#c8102e] border-rose-200',
  high: 'bg-orange-50 text-orange-700 border-orange-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  warning: 'bg-amber-50 text-amber-700 border-amber-200',
  info: 'bg-slate-100 text-slate-600 border-slate-200',
  none: 'bg-emerald-50 text-emerald-700 border-emerald-200'
};

// Owner-facing view of how the live deployment is actually configured, plus the
// security event log. Every check runs against this server.
export default function SecurityCenterPage() {
  const { user } = useAuth();
  const canSeal = user?.role === 'bank_owner';
  const [audit, setAudit] = useState(null);
  const [events, setEvents] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const [a, e] = await Promise.all([api.securityAudit(), api.securityEvents().catch(() => null)]);
      setAudit(a);
      if (e) setEvents(e);
    } catch (err) { toast.error(err.response?.data?.detail || 'Could not run the security audit'); }
  };
  useEffect(() => { load(); }, []);

  const seal = async () => {
    setBusy(true);
    try { toast.success((await api.securitySeal()).message); load(); }
    catch (e) { toast.error(e.response?.data?.detail || 'Could not seal the files'); }
    finally { setBusy(false); }
  };

  if (!audit) return <div className="p-10 flex items-center gap-2 text-slate-600"><RefreshCw className="w-4 h-4 animate-spin" /> Running security audit…</div>;

  const areas = audit.checks.reduce((acc, c) => ({ ...acc, [c.area]: [...(acc[c.area] || []), c] }), {});
  const scoreColour = audit.score >= 90 ? 'text-emerald-700' : audit.score >= 60 ? 'text-amber-700' : 'text-[#c8102e]';

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-md bg-[#0b3b8c] text-white flex items-center justify-center"><ShieldCheck className="w-5 h-5" /></div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Security Centre</h1>
            <p className="text-xs text-slate-500">What this deployment actually looks like right now</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className={`text-3xl font-bold ${scoreColour}`}>{audit.score}<span className="text-base text-slate-500">/100</span></div>
            <div className="text-[11px] font-semibold text-slate-600">{audit.verdict}</div>
          </div>
          <button onClick={load} className="px-3 py-2 rounded-md border border-slate-200 text-xs font-semibold text-slate-700 flex items-center gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> Re-run
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Checks run" value={audit.summary.total} />
        <Kpi label="Passed" value={audit.summary.passed} tone="ok" />
        <Kpi label="Failed" value={audit.summary.failed} tone={audit.summary.failed ? 'warn' : 'ok'} />
        <Kpi label="Critical" value={audit.summary.critical} tone={audit.summary.critical ? 'bad' : 'ok'} />
      </div>

      {audit.summary.critical > 0 && (
        <div className="p-3 rounded-md bg-rose-50 border border-rose-200 text-[11px] text-[#c8102e]">
          <strong>Fix the critical findings before this site takes real money.</strong> They are the ones an
          attacker looks for first.
        </div>
      )}

      {Object.entries(areas).map(([area, checks]) => (
        <div key={area} className="bg-white border border-slate-200 rounded-lg shadow-sm">
          <div className="px-4 py-3 border-b border-slate-100 text-sm font-semibold text-slate-900">{area}</div>
          <div className="divide-y divide-slate-100">
            {checks.map((c, i) => (
              <div key={i} data-testid={`audit-check-${c.name.replace(/\s+/g, '-').toLowerCase()}`} className="p-3 flex items-start gap-3">
                {c.status === 'pass'
                  ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  : <XCircle className="w-4 h-4 text-[#c8102e] shrink-0 mt-0.5" />}
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-slate-800">{c.name}</span>
                    {c.status === 'fail' && (
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${SEVERITY[c.severity]}`}>
                        {c.severity}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-600 mt-0.5">{c.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <FileCheck2 className="w-4 h-4 text-[#0b3b8c]" />
            <span className="text-sm font-semibold text-slate-900">Code integrity</span>
          </div>
          {canSeal && (
            <button data-testid="security-seal-btn" disabled={busy} onClick={seal}
              className="px-3 py-1.5 rounded-md bg-[#0b3b8c] text-white text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50">
              <Lock className="w-3.5 h-3.5" /> Seal current files
            </button>
          )}
        </div>
        <div className="p-4 text-[11px] text-slate-600 space-y-1">
          {audit.integrity.sealed ? (
            <>
              <p>Sealed {audit.integrity.sealed_at ? new Date(audit.integrity.sealed_at).toLocaleString('en-IN') : ''} · {audit.integrity.file_count} files.</p>
              {audit.integrity.changed.length === 0 && audit.integrity.removed.length === 0 && audit.integrity.added.length === 0
                ? <p className="text-emerald-700 font-semibold">Every file matches the seal.</p>
                : <>
                    {audit.integrity.changed.length > 0 && <p className="text-[#c8102e]">Changed: {audit.integrity.changed.join(', ')}</p>}
                    {audit.integrity.removed.length > 0 && <p className="text-[#c8102e]">Removed: {audit.integrity.removed.join(', ')}</p>}
                    {audit.integrity.added.length > 0 && <p className="text-amber-700">Added: {audit.integrity.added.join(', ')}</p>}
                  </>}
            </>
          ) : (
            <p>{audit.integrity.message}</p>
          )}
          <p className="text-slate-500">Seal the files right after a deploy. Anything that changes afterwards without
            another deploy shows up here.</p>
        </div>
      </div>

      {events && (
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2 flex-wrap">
            <Activity className="w-4 h-4 text-[#0b3b8c]" />
            <span className="text-sm font-semibold text-slate-900">Security events</span>
            <span className="text-[11px] text-slate-500">
              {events.counts.critical_24h} critical and {events.counts.warning_24h} warnings in the last 24 hours
            </span>
          </div>
          <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-[11px] uppercase text-slate-600 sticky top-0">
                <tr>
                  <th className="p-3 font-semibold">When</th>
                  <th className="p-3 font-semibold">Event</th>
                  <th className="p-3 font-semibold">Who / where</th>
                  <th className="p-3 font-semibold">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {events.events.map(e => (
                  <tr key={e.id} className="hover:bg-blue-50/40 transition-colors">
                    <td className="p-3 text-slate-500 whitespace-nowrap">{new Date(e.created_at).toLocaleString('en-IN')}</td>
                    <td className="p-3">
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${SEVERITY[e.severity]}`}>
                        {e.event_type}
                      </span>
                    </td>
                    <td className="p-3 text-slate-600 font-mono text-[10px]">{e.email || '—'}<br />{e.ip}</td>
                    <td className="p-3 text-slate-600">{e.details}</td>
                  </tr>
                ))}
                {!events.events.length && (
                  <tr><td colSpan={4} className="p-6 text-center text-slate-500">No security events recorded.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, tone }) {
  const colour = tone === 'bad' ? 'text-[#c8102e]' : tone === 'warn' ? 'text-amber-700'
    : tone === 'ok' ? 'text-emerald-700' : 'text-slate-900';
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={`text-2xl font-bold ${colour}`}>{value}</div>
    </div>
  );
}
