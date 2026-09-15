import React, { useEffect, useState } from 'react';
import { ShieldAlert, RefreshCw, CheckCircle2, AlertTriangle, Flag, Undo2, Search } from 'lucide-react';
import { api } from '../services/api';
import { toast } from 'sonner';

const TABS = [['open', 'Open'], ['escalated', 'Escalated'], ['cleared', 'Cleared']];
const SEVERITY = {
  high: 'bg-rose-50 text-[#c8102e] border-rose-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  low: 'bg-slate-100 text-slate-600 border-slate-200'
};

// Staff review queue for transfers the AI module scored as unusual.
export default function FraudMonitorPage() {
  const [tab, setTab] = useState('open');
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState('');
  const [anomalies, setAnomalies] = useState(null);

  const load = async (which = tab) => {
    try {
      const [queue, anom] = await Promise.all([
        api.fraudQueue(which),
        api.collectionAnomalies().catch(() => null)
      ]);
      setData(queue);
      if (anom) setAnomalies(anom);
    } catch (e) { toast.error(e.response?.data?.detail || 'Could not load the review queue'); }
  };
  useEffect(() => { load(tab); /* eslint-disable-next-line */ }, [tab]);

  const act = async (alert, action) => {
    setBusy(alert.id);
    try {
      toast.success((await api.fraudAction({ alert_id: alert.id, action })).message);
      load(tab);
    } catch (e) { toast.error(e.response?.data?.detail || 'Action failed'); }
    finally { setBusy(''); }
  };

  if (!data) return <div className="p-10 flex items-center gap-2 text-slate-600"><RefreshCw className="w-4 h-4 animate-spin" /> Loading review queue…</div>;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-md bg-[#0b3b8c] text-white flex items-center justify-center"><ShieldAlert className="w-5 h-5" /></div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Fraud &amp; AML Review</h1>
            <p className="text-xs text-slate-500">Transfers scored against each member's own behaviour · scoring runs on this server</p>
          </div>
        </div>
        <button onClick={() => load(tab)} className="px-3 py-2 rounded-md border border-slate-200 text-xs font-semibold text-slate-700 flex items-center gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Open" value={data.counts.open} tone={data.counts.open ? 'warn' : 'ok'} />
        <Kpi label="High severity, open" value={data.counts.high_open} tone={data.counts.high_open ? 'bad' : 'ok'} />
        <Kpi label="Escalated" value={data.counts.escalated} />
        <Kpi label="Cleared" value={data.counts.cleared} />
      </div>

      <div className="flex gap-1.5">
        {TABS.map(([id, label]) => (
          <button key={id} data-testid={`fraud-tab-${id}`} onClick={() => setTab(id)}
            className={`px-4 py-1.5 rounded-md text-xs font-semibold border ${
              tab === id ? 'bg-[#0b3b8c] text-white border-[#0b3b8c]' : 'bg-white text-slate-600 border-slate-200'}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {data.alerts.map(alert => (
          <div key={alert.id} data-testid={`fraud-alert-${alert.id}`} className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
            <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${SEVERITY[alert.severity]}`}>
                    {alert.severity} · {alert.score}/100
                  </span>
                  <span className="text-sm font-bold text-slate-900">₹{Number(alert.amount).toLocaleString('en-IN')}</span>
                  <span className="text-[11px] text-slate-500">
                    {alert.member_name} · {alert.account_number} → {alert.counterparty_name || alert.counterparty_acc}
                  </span>
                </div>
                <ul className="mt-2 space-y-1">
                  {alert.reasons.map((r, i) => (
                    <li key={i} className="text-[11px] text-slate-600 flex items-start gap-1.5">
                      <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0 text-amber-600" />
                      <span>{r.label} <span className="text-slate-500">(+{r.weight})</span></span>
                    </li>
                  ))}
                </ul>
                <div className="text-[10px] text-slate-500 mt-2 font-mono">
                  {alert.ref_number} · {new Date(alert.created_at).toLocaleString('en-IN')}
                  {alert.review_note && ` · note: ${alert.review_note}`}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {tab !== 'cleared' && (
                  <button disabled={busy === alert.id} data-testid={`fraud-clear-${alert.id}`} onClick={() => act(alert, 'clear')}
                    className="px-3 py-1.5 rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Clear
                  </button>
                )}
                {tab !== 'escalated' && (
                  <button disabled={busy === alert.id} data-testid={`fraud-escalate-${alert.id}`} onClick={() => act(alert, 'escalate')}
                    className="px-3 py-1.5 rounded-md border border-rose-200 bg-rose-50 text-[#c8102e] text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50">
                    <Flag className="w-3.5 h-3.5" /> Escalate
                  </button>
                )}
                {tab !== 'open' && (
                  <button disabled={busy === alert.id} onClick={() => act(alert, 'reopen')}
                    className="px-3 py-1.5 rounded-md border border-slate-200 text-slate-600 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50">
                    <Undo2 className="w-3.5 h-3.5" /> Reopen
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
        {!data.alerts.length && (
          <div className="bg-white border border-slate-200 rounded-lg p-10 text-center">
            <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto mb-2" />
            <p className="text-sm text-slate-600">Nothing in the {tab} queue.</p>
          </div>
        )}
      </div>

      <p className="text-[11px] text-slate-500 leading-relaxed">
        Escalating marks an alert for suspicious-transaction review. Members are never told that a payment was
        flagged — under the PMLA, warning a suspect is "tipping off". Reporting thresholds reference
        ₹{Number(data.ctr_threshold).toLocaleString('en-IN')}.
      </p>

      {anomalies && (
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
          <div className="p-4 border-b border-slate-100 flex items-center gap-2">
            <Search className="w-4 h-4 text-[#0b3b8c]" />
            <h2 className="text-sm font-semibold text-slate-900">Collection &amp; deposit anomalies</h2>
            <span className="text-[11px] text-slate-500">
              {anomalies.checked.collections} collections · {anomalies.checked.agents} agents checked
            </span>
          </div>
          <div className="divide-y divide-slate-100">
            {anomalies.findings.map((f, i) => (
              <div key={i} className="p-3 flex items-start gap-2">
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border shrink-0 ${SEVERITY[f.severity]}`}>
                  {f.severity}
                </span>
                <div className="text-xs">
                  <span className="font-semibold text-slate-800">{f.type}</span>
                  <span className="text-slate-600"> — {f.detail}</span>
                </div>
              </div>
            ))}
            {!anomalies.findings.length && (
              <p className="p-6 text-center text-xs text-slate-500">No anomalies found in recorded collections.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, tone }) {
  const colour = tone === 'bad' ? 'text-[#c8102e]' : tone === 'warn' ? 'text-amber-700' : 'text-slate-900';
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={`text-2xl font-bold ${colour}`}>{value}</div>
    </div>
  );
}
