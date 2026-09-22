import React, { useCallback, useEffect, useState } from 'react';
import {
  Radio, RefreshCw, Save, Eye, EyeOff, AlertTriangle, CheckCircle2, PlugZap,
  Copy, ShieldAlert, ArrowUpRight, ArrowDownLeft, Clock
} from 'lucide-react';
import { api } from '../services/api';
import { toast } from 'sonner';
import Pagination from '../components/Pagination';

// The director's view of the payment rail: how money leaves and enters the
// institution, and what is in flight right now.
//
// Two things this screen exists to make impossible to get wrong. The first is
// believing money moved when the driver is the simulator — so that state is
// stated at the top, not buried in a field. The second is going live with an
// incomplete configuration, which the server refuses; the screen says why
// before the button is pressed rather than after.
export default function RailsPage() {
  const [cfg, setCfg] = useState(null);
  const [form, setForm] = useState({});
  const [showSecrets, setShowSecrets] = useState({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [txns, setTxns] = useState([]);
  const [meta, setMeta] = useState(null);
  const [filter, setFilter] = useState({ status: '', direction: '', page: 1, per_page: 25 });

  const [loadError, setLoadError] = useState(null);

  const load = async () => {
    try {
      const r = await api.railsConfigGet();
      setLoadError(null);
      setCfg(r);
      setForm({
        partner_name: r.partner_name, base_url: r.base_url, auth: r.auth,
        webhook_header: r.webhook_header, settlement_account: r.settlement_account,
        payout_path: r.payout_path, collect_path: r.collect_path, status_path: r.status_path,
        max_payout: r.max_payout, daily_payout_cap: r.daily_payout_cap
      });
    } catch (e) {
      // A server that refused and a server that never answered are different
      // problems, and telling a director they lack access when the backend is
      // simply down sends them looking in the wrong place.
      const detail = e.response?.data?.detail;
      setLoadError(detail || 'The payment rail could not be reached. The API may be down.');
      toast.error(detail || 'Could not reach the payment rail');
    }
  };

  const loadTxns = useCallback(async () => {
    try {
      const params = { page: filter.page, per_page: filter.per_page };
      if (filter.status) params.status = filter.status;
      if (filter.direction) params.direction = filter.direction;
      const r = await api.railsTransactions(params);
      setTxns(r.transactions || []);
      setMeta(r.pagination);
    } catch { /* the config panel already reported the access problem */ }
  }, [filter]);

  useEffect(() => { load(); }, []);
  useEffect(() => { loadTxns(); }, [loadTxns]);

  const save = async () => {
    setSaving(true);
    try {
      // Only what the director actually changed. Resending every field that was
      // loaded means an existing value that no longer validates — a base URL
      // saved before the https rule, say — blocks an unrelated edit to the
      // limits. Blank already means "leave it as it is" on the server, so an
      // untouched field simply is not sent.
      const payload = {};
      Object.entries(form).forEach(([k, v]) => {
        if (v === '' || v === null || v === undefined) return;
        if (String(v) !== String(cfg[k] ?? '')) payload[k] = v;
      });
      // Secrets reach this screen masked and are never sent back, so anything
      // typed into one of these fields is new by definition.
      ['key_id', 'key_secret', 'webhook_secret'].forEach((k) => {
        if (form[k]) payload[k] = form[k];
      });
      if (Object.keys(payload).length === 0) {
        toast.info('Nothing changed.');
        setSaving(false);
        return;
      }
      const r = await api.railsConfigSet(payload);
      toast.success(r.message);
      setForm((f) => ({ ...f, key_id: '', key_secret: '', webhook_secret: '' }));
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Save failed');
    } finally { setSaving(false); }
  };

  // Switching the driver is the moment real money starts moving, so it is a
  // deliberate separate action rather than one field among many in Save.
  const setDriver = async (driver) => {
    if (driver === 'partner' && !window.confirm(
      'Switch to the partner driver?\n\nOutward transfers will move real money through your '
      + 'payment partner from this point on.')) return;
    try {
      const r = await api.railsConfigSet({ driver });
      toast.success(r.message);
      load();
    } catch (e) { toast.error(e.response?.data?.detail || 'Could not change the driver'); }
  };

  const runTest = async () => {
    setTesting(true); setTestResult(null);
    try { setTestResult(await api.railsTest()); }
    catch (e) { setTestResult({ status: 'PROBLEM', message: e.response?.data?.detail || 'The test could not be run.' }); }
    finally { setTesting(false); }
  };

  const copy = (text) => {
    navigator.clipboard?.writeText(text).then(
      () => toast.success('Copied'), () => toast.error('Could not copy'));
  };

  if (!cfg) {
    return (
      <div className="p-10 max-w-xl">
        {loadError ? (
          <div data-testid="rails-load-error"
            className="rounded-lg border border-[#c8102e]/40 bg-rose-50 p-5 text-slate-800">
            <div className="flex items-center gap-2 font-semibold text-sm">
              <AlertTriangle className="w-4 h-4 text-[#c8102e]" /> Payment rail unavailable
            </div>
            <p className="text-[11px] mt-1.5 leading-relaxed">{loadError}</p>
            <button onClick={load} data-testid="rails-retry"
              className="mt-3 px-4 py-2 rounded-md bg-[#0b3b8c] text-white text-xs font-semibold">
              Try again
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-slate-600">
            <RefreshCw className="w-4 h-4 animate-spin" /> Loading payment rail…
          </div>
        )}
      </div>
    );
  }

  const simulated = cfg.driver === 'simulator';

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-md bg-[#0b3b8c] text-white flex items-center justify-center">
            <Radio className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Payment Rails</h1>
            <p className="text-xs text-slate-500">
              Director only — how money leaves and enters this institution
            </p>
          </div>
        </div>
        <span className="px-2.5 py-1 rounded bg-blue-50 text-[#0b3b8c] border border-blue-200 text-[10px] font-bold">
          DIRECTOR
        </span>
      </div>

      {/* The one thing nobody may misread. */}
      <div data-testid="rails-driver-banner"
        className={`rounded-lg border p-5 ${simulated
          ? 'bg-amber-50 border-amber-300' : 'bg-emerald-50 border-emerald-300'}`}>
        <div className="flex items-start gap-3">
          {simulated ? <AlertTriangle className="w-5 h-5 text-amber-700 mt-0.5 shrink-0" />
                     : <CheckCircle2 className="w-5 h-5 text-emerald-700 mt-0.5 shrink-0" />}
          <div className="flex-1">
            <div className={`font-bold text-sm ${simulated ? 'text-amber-900' : 'text-emerald-900'}`}>
              {simulated ? 'Simulator — no money moves' : `Live via ${cfg.partner_name || 'your partner'}`}
            </div>
            <p className="text-[11px] text-slate-700 mt-1 leading-relaxed">{cfg.notice}</p>
            <div className="flex flex-wrap gap-2 mt-3">
              <DriverButton label="Simulator" active={simulated} onClick={() => setDriver('simulator')}
                testId="rails-driver-simulator" />
              <DriverButton label="Partner (real money)" active={!simulated} onClick={() => setDriver('partner')}
                testId="rails-driver-partner" />
            </div>
          </div>
        </div>
      </div>

      {/* A rail can be configured and still refused: the capability register is
          a separate gate, and an operator needs to see both. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Paid out today" value={inr(cfg.paid_out_today)} testId="rails-paid-today" />
        <Stat label="Daily cap" value={inr(cfg.daily_payout_cap)} testId="rails-daily-cap" />
        <Gate label="Outward transfers" on={cfg.capability_payment_systems}
          hint="payment_systems capability" testId="rails-gate-payments" />
        <Gate label="UPI" on={cfg.capability_upi} hint="upi capability" testId="rails-gate-upi" />
      </div>

      {(!cfg.capability_payment_systems || !cfg.ready) && (
        <div data-testid="rails-blockers" className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <ShieldAlert className="w-4 h-4 text-[#c8102e]" />
            <h2 className="text-sm font-semibold text-slate-900">Before money can leave this institution</h2>
          </div>
          <ul className="text-[11px] text-slate-600 space-y-1.5 list-disc pl-5 leading-relaxed">
            {!cfg.ready && (
              <li>The partner is not fully configured — base URL, key id, key secret and webhook
                  secret are all required before the driver can be switched to partner.</li>
            )}
            {!cfg.capability_payment_systems && (
              <li>The <strong>payment_systems</strong> capability is off. It is switched on in the
                  capability register, and doing so requires recording the sponsor-bank or aggregator
                  agreement that authorises it. This institution is a Nidhi company and holds no RBI
                  payment-system membership of its own.</li>
            )}
          </ul>
        </div>
      )}

      <Section title="Partner connection" icon={PlugZap}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Plain label="Partner name" placeholder="Acme Payments" value={form.partner_name}
            onChange={(v) => setForm((f) => ({ ...f, partner_name: v }))} testId="rails-partner-name" />
          <Plain label="Base URL (https only)" placeholder="https://api.partner.com/v1" value={form.base_url}
            onChange={(v) => setForm((f) => ({ ...f, base_url: v }))} testId="rails-base-url" />
          <div>
            <label className="block text-[11px] text-slate-600 mb-1">Authentication</label>
            <select value={form.auth || 'basic'} data-testid="rails-auth"
              onChange={(e) => setForm((f) => ({ ...f, auth: e.target.value }))}
              className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm text-slate-900 bg-white">
              <option value="basic">Basic (key id + secret)</option>
              <option value="bearer">Bearer (secret only)</option>
            </select>
          </div>
          <Plain label="Settlement account (your pooled current account)" placeholder="Not a member's account"
            value={form.settlement_account}
            onChange={(v) => setForm((f) => ({ ...f, settlement_account: v }))} testId="rails-settlement" />
          <Secret label="Key ID" placeholder={cfg.key_id_masked || 'Enter the partner key id'}
            value={form.key_id || ''} onChange={(v) => setForm((f) => ({ ...f, key_id: v }))}
            show={showSecrets.kid} onToggle={() => setShowSecrets((s) => ({ ...s, kid: !s.kid }))}
            testId="rails-key-id" />
          <Secret label="Key secret" placeholder={cfg.key_secret_masked || 'Enter the partner key secret'}
            value={form.key_secret || ''} onChange={(v) => setForm((f) => ({ ...f, key_secret: v }))}
            show={showSecrets.ksec} onToggle={() => setShowSecrets((s) => ({ ...s, ksec: !s.ksec }))}
            testId="rails-key-secret" />
        </div>
      </Section>

      <Section title="Their callback to us" icon={ArrowDownLeft}>
        <p className="text-[11px] text-slate-500 mb-3 leading-relaxed">
          Give this URL to the partner. Every callback must be signed with
          HMAC-SHA256 over the raw body using the webhook secret — an unsigned one is rejected and
          can never credit an account. A member's balance moves only when a signed callback confirms
          the money actually arrived.
        </p>
        <div className="flex items-center gap-2 mb-3">
          <code data-testid="rails-webhook-url"
            className="flex-1 text-[11px] bg-slate-50 border border-slate-200 rounded-md px-3 py-2 font-mono text-slate-700 break-all">
            {cfg.webhook_url || '(set public_app_url in the server config)'}
          </code>
          <button type="button" onClick={() => copy(cfg.webhook_url)} data-testid="rails-copy-webhook"
            className="p-2 rounded-md border border-slate-200 text-slate-600 hover:text-slate-900 shrink-0">
            <Copy className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Secret label="Webhook secret" placeholder={cfg.webhook_secret_masked || 'From the partner'}
            value={form.webhook_secret || ''}
            onChange={(v) => setForm((f) => ({ ...f, webhook_secret: v }))}
            show={showSecrets.wh} onToggle={() => setShowSecrets((s) => ({ ...s, wh: !s.wh }))}
            testId="rails-webhook-secret" />
          <Plain label="Signature header" placeholder="X-Webhook-Signature" value={form.webhook_header}
            onChange={(v) => setForm((f) => ({ ...f, webhook_header: v }))} testId="rails-webhook-header" />
        </div>
      </Section>

      <Section title="Their API shape" icon={ArrowUpRight}>
        <p className="text-[11px] text-slate-500 mb-3">
          No two partners agree on these. <code className="font-mono">{'{ref}'}</code> in the status
          path is replaced with the partner's own reference.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Plain label="Payout path" placeholder="/payouts" value={form.payout_path}
            onChange={(v) => setForm((f) => ({ ...f, payout_path: v }))} testId="rails-payout-path" />
          <Plain label="Collect path" placeholder="/payment_links" value={form.collect_path}
            onChange={(v) => setForm((f) => ({ ...f, collect_path: v }))} testId="rails-collect-path" />
          <Plain label="Status path" placeholder="/payouts/{ref}" value={form.status_path}
            onChange={(v) => setForm((f) => ({ ...f, status_path: v }))} testId="rails-status-path" />
        </div>
      </Section>

      <Section title="Limits" icon={ShieldAlert}>
        <p className="text-[11px] text-slate-500 mb-3">
          The last line of defence if something goes wrong in a loop. Start low — raising them later
          takes seconds.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Plain label="Maximum per transaction (₹)" type="number" value={form.max_payout}
            onChange={(v) => setForm((f) => ({ ...f, max_payout: v }))} testId="rails-max-payout" />
          <Plain label="Daily cap for the whole institution (₹)" type="number" value={form.daily_payout_cap}
            onChange={(v) => setForm((f) => ({ ...f, daily_payout_cap: v }))} testId="rails-daily-payout-cap" />
        </div>
      </Section>

      <Section title="Check the partner is reachable" icon={PlugZap}>
        <p className="text-[11px] text-slate-600 mb-3 leading-relaxed">
          Looks up a reference that cannot exist. This tests what is <em>stored</em>, not what is typed
          above, so save first. Better that this discovers a wrong key than a member's transfer does.
        </p>
        <button type="button" onClick={runTest} disabled={testing} data-testid="rails-test-btn"
          className="px-5 py-2.5 rounded-md bg-[#0b3b8c] hover:bg-[#092e6f] text-white text-xs font-semibold disabled:opacity-50 transition">
          {testing ? 'Checking…' : 'Test connection'}
        </button>
        {testResult && (
          <div data-testid="rails-test-result"
            className={`mt-3 p-3 rounded-md border text-[11px] leading-relaxed ${
              testResult.status === 'OK' ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : testResult.status === 'SIMULATOR' ? 'bg-amber-50 border-amber-200 text-amber-900'
              : 'bg-rose-50 border-[#c8102e]/40 text-slate-800'}`}>
            <p className="font-semibold">{testResult.status}</p>
            <p className="mt-0.5">{testResult.message}</p>
            {testResult.http_status ? (
              <p className="mt-0.5 text-slate-500">Partner answered HTTP {testResult.http_status}</p>
            ) : null}
          </div>
        )}
      </Section>

      <div className="flex items-center justify-end gap-3">
        <button onClick={load} data-testid="rails-reload"
          className="px-4 py-2 rounded-md border border-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" /> Reload
        </button>
        <button onClick={save} disabled={saving} data-testid="rails-save-btn"
          className="px-5 py-2 rounded-md bg-[#0b3b8c] hover:bg-[#092e6f] text-white text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50">
          {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save changes
        </button>
      </div>

      {/* Operations. A row stuck pending with no partner reference is an
          instruction that never reached the partner, which is the one state
          worth chasing. */}
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
        <div className="p-5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-[#0b3b8c]" />
            <h2 className="text-sm font-semibold text-slate-900">In flight and recently settled</h2>
          </div>
          <div className="flex items-center gap-2">
            <select value={filter.direction} data-testid="rails-filter-direction"
              onChange={(e) => setFilter((f) => ({ ...f, direction: e.target.value, page: 1 }))}
              className="border border-slate-200 rounded-md px-2 py-1.5 text-xs bg-white text-slate-700">
              <option value="">All directions</option>
              <option value="payout">Payouts</option>
              <option value="collect">Collections</option>
            </select>
            <select value={filter.status} data-testid="rails-filter-status"
              onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value, page: 1 }))}
              className="border border-slate-200 rounded-md px-2 py-1.5 text-xs bg-white text-slate-700">
              <option value="">All states</option>
              <option value="PENDING">Pending</option>
              <option value="SUCCESS">Settled</option>
              <option value="FAILED">Failed</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <Th>Direction</Th><Th>Rail</Th><Th>Amount</Th><Th>Counterparty</Th>
                <Th>Reference</Th><Th>UTR</Th><Th>State</Th>
              </tr>
            </thead>
            <tbody>
              {txns.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                  Nothing on the rail yet.
                </td></tr>
              )}
              {txns.map((t) => (
                <tr key={t.id} data-testid="rails-txn-row" className="border-t border-slate-100">
                  <Td>
                    <span className="inline-flex items-center gap-1">
                      {t.direction === 'payout'
                        ? <ArrowUpRight className="w-3 h-3 text-slate-500" />
                        : <ArrowDownLeft className="w-3 h-3 text-slate-500" />}
                      {t.direction}
                    </span>
                  </Td>
                  <Td>{t.rail}{t.driver === 'simulator' && (
                    <span className="ml-1 text-[9px] text-amber-700 font-semibold">SIM</span>)}</Td>
                  <Td className="font-semibold text-slate-900">{inr(t.amount)}</Td>
                  <Td>{t.counterparty_name || t.counterparty_vpa || '—'}</Td>
                  <Td className="font-mono text-[10px] text-slate-500">{t.ref_number}</Td>
                  <Td className="font-mono text-[10px] text-slate-500">{t.utr || '—'}</Td>
                  <Td><StateBadge row={t} /></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination meta={meta}
          onPage={(p) => setFilter((f) => ({ ...f, page: p }))}
          onPerPage={(n) => setFilter((f) => ({ ...f, per_page: n, page: 1 }))} />
      </div>
    </div>
  );
}

// A pending row that the partner never acknowledged is not the same as one they
// are still working on, and only the first needs chasing.
function StateBadge({ row }) {
  if (row.status === 'SUCCESS') {
    return <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 font-semibold">Settled</span>;
  }
  if (row.status === 'FAILED') {
    return <span title={row.failure_reason || ''}
      className="px-2 py-0.5 rounded bg-rose-50 text-[#c8102e] border border-[#c8102e]/30 font-semibold">Failed</span>;
  }
  if (!row.partner_ref) {
    return <span title="Recorded here but never acknowledged by the partner. The cron will retry it."
      className="px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-300 font-semibold">Not sent</span>;
  }
  return <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 font-semibold">Pending</span>;
}

function DriverButton({ label, active, onClick, testId }) {
  return (
    <button type="button" onClick={onClick} data-testid={testId} disabled={active}
      className={`px-3 py-1.5 rounded-md text-[11px] font-semibold border transition ${active
        ? 'bg-white border-slate-300 text-slate-400 cursor-default'
        : 'bg-[#0b3b8c] border-[#0b3b8c] text-white hover:bg-[#092e6f]'}`}>
      {active ? `${label} (current)` : `Switch to ${label}`}
    </button>
  );
}

function Stat({ label, value, testId }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div data-testid={testId} className="text-lg font-bold text-slate-900 mt-1">{value}</div>
    </div>
  );
}

function Gate({ label, on, hint, testId }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div data-testid={testId}
        className={`text-sm font-bold mt-1 flex items-center gap-1.5 ${on ? 'text-emerald-700' : 'text-slate-400'}`}>
        {on ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
        {on ? 'Authorised' : 'Not authorised'}
      </div>
      <div className="text-[10px] text-slate-400 mt-0.5">{hint}</div>
    </div>
  );
}

function Section({ title, icon: Icon, children }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
      <div className="p-5 border-b border-slate-100 flex items-center gap-2">
        <Icon className="w-4 h-4 text-[#0b3b8c]" />
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function Plain({ label, value, onChange, type = 'text', placeholder, testId }) {
  return (
    <div>
      <label className="block text-[11px] text-slate-600 mb-1">{label}</label>
      <input type={type} value={value ?? ''} placeholder={placeholder} data-testid={testId}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm text-slate-900" />
    </div>
  );
}

function Secret({ label, value, onChange, show, onToggle, placeholder, testId }) {
  return (
    <div>
      <label className="block text-[11px] text-slate-600 mb-1">{label}</label>
      <div className="relative">
        <input type={show ? 'text' : 'password'} value={value} placeholder={placeholder} data-testid={testId}
          onChange={(e) => onChange(e.target.value)}
          className="w-full border border-slate-200 rounded-md px-3 py-2 pr-10 text-sm text-slate-900 font-mono" />
        <button type="button" onClick={onToggle}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-slate-700">
          {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );
}

const Th = ({ children }) => <th className="px-4 py-2.5 text-left font-semibold">{children}</th>;
const Td = ({ children, className = '' }) => <td className={`px-4 py-2.5 text-slate-700 ${className}`}>{children}</td>;

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
