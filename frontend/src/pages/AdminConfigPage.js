import React, { useEffect, useState } from 'react';
import { Settings2, Phone, Mail, ShieldCheck, RefreshCw, Save, Eye, EyeOff, AlertCircle, CheckCircle2, UserCheck, Send, Clock } from 'lucide-react';
import { api } from '../services/api';
import { toast } from 'sonner';

const STATE_STYLE = {
  ok: 'bg-emerald-50 border-emerald-200 text-emerald-900',
  attention: 'bg-amber-50 border-amber-200 text-amber-900',
  stale: 'bg-red-50 border-red-200 text-[#c8102e]',
  never_run: 'bg-red-50 border-red-200 text-[#c8102e]',
};

// Whether the nightly run is happening. Worth a panel of its own because the
// answer was "no" for months and nothing on any screen said so: the jobs were
// written and tested, and simply never invoked.
function AutomationPanel() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    try { setData(await api.automationStatus()); }
    catch (e) { toast.error(e.response?.data?.detail || 'Could not read the automation status'); }
    finally { setBusy(false); }
  };
  useEffect(() => { load(); }, []);

  if (!data) return null;

  return (
    <Section title="Scheduled automation" icon={Clock}>
      <div className={`p-3 rounded-md border text-[11px] ${STATE_STYLE[data.state] || STATE_STYLE.attention}`}
        data-testid="automation-state">
        <div className="flex items-center justify-between gap-3">
          <span className="font-bold uppercase tracking-wide text-[10px]">
            {data.state.replace('_', ' ')}
          </span>
          <button onClick={load} disabled={busy} data-testid="automation-refresh"
            className="text-[10px] font-semibold underline disabled:opacity-50 py-1.5 px-1 -mx-1">
            {busy ? 'checking…' : 'check again'}
          </button>
        </div>
        <p className="mt-1">{data.message}</p>
      </div>

      <div className="mt-3 rounded-md border border-slate-200 overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase text-slate-600">
            <tr>
              <th className="p-2 font-semibold">Job</th>
              <th className="p-2 font-semibold text-right">Processed</th>
              <th className="p-2 font-semibold text-right">Failed</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.jobs.map((j) => (
              <tr key={j.key} data-testid={`automation-job-${j.key}`}>
                <td className="p-2 text-slate-800">{j.label}</td>
                <td className="p-2 text-right font-semibold text-slate-900">{j.done}</td>
                <td className={`p-2 text-right font-semibold ${j.failed ? 'text-[#c8102e]' : 'text-slate-400'}`}>
                  {j.failed}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-slate-400 mt-1.5">
        {data.schedule}. Counts are from the last completed run — a quiet night legitimately shows
        zeros, which is why the banner above reports when the run itself last happened rather than
        what it found. Dry runs are excluded: they prove the wiring but move no money.
      </p>

      {data.last_run?.error && (
        <p className="text-[11px] text-[#c8102e] mt-1.5" data-testid="automation-error">
          Last error: {data.last_run.error}
        </p>
      )}
    </Section>
  );
}

export default function AdminConfigPage() {
  const [cfg, setCfg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  // Tests what is stored, not what is typed: sending with unsaved credentials
  // would report on a configuration that is not the one in use.
  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await api.testSms(testTo));
    } catch (e) {
      setTestResult({ ok: false, reason: e.response?.data?.detail || 'The test could not be run.' });
    } finally { setTesting(false); }
  };
  const [form, setForm] = useState({});
  const [showSecrets, setShowSecrets] = useState({});

  const load = async () => {
    try { const r = await api.adminConfigGet(); setCfg(r); setForm({ live_otp: r.live_otp, twilio_from_number: r.twilio_from_number, sendgrid_from_email: r.sendgrid_from_email, smtp_host: r.smtp_host, smtp_port: r.smtp_port, smtp_user: r.smtp_user, support_email: r.support_email }); }
    catch { toast.error('Director access required'); }
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    try {
      const payload = { ...form };
      // only submit secret fields if the user typed a new value
      if (form.twilio_account_sid) payload.twilio_account_sid = form.twilio_account_sid;
      if (form.twilio_auth_token) payload.twilio_auth_token = form.twilio_auth_token;
      if (form.sendgrid_api_key) payload.sendgrid_api_key = form.sendgrid_api_key;
      if (form.smtp_password) payload.smtp_password = form.smtp_password;
      const r = await api.adminConfigSet(payload);
      toast.success(r.message);
      load();
    } catch (e) { toast.error(e.response?.data?.detail || 'Save failed'); }
    finally { setSaving(false); }
  };

  if (!cfg) return <div className="p-10 flex items-center gap-2 text-slate-600"><RefreshCw className="w-4 h-4 animate-spin" /> Loading super-admin config…</div>;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-md bg-[#0b3b8c] text-white flex items-center justify-center"><Settings2 className="w-5 h-5" /></div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Super-Admin Runtime Config</h1>
            <p className="text-xs text-slate-500">Director only — OTP delivery, compliance officers, referral rules, face-match threshold</p>
          </div>
        </div>
        <span className="px-2.5 py-1 rounded bg-blue-50 text-[#0b3b8c] border border-blue-200 text-[10px] font-bold">DIRECTOR</span>
      </div>

      <AutomationPanel />

      {/* Live OTP toggle */}
      <Section title="OTP Delivery Mode" icon={ShieldCheck}>
        <div className="flex items-start justify-between p-4 border border-slate-200 rounded-md bg-slate-50">
          <div>
            <div className="font-semibold text-slate-900 text-sm">Live OTP delivery</div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              When enabled, OTPs are sent through real Twilio SMS and real email. When disabled, OTPs remain mocked and shown in the JSON response for demo.
            </div>
            <div className="text-[11px] text-slate-500 mt-2">
              {cfg.twilio_configured ? <span className="text-emerald-700 font-semibold flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Twilio configured</span> : <span className="text-amber-700 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> Twilio not configured</span>}
              {cfg.smtp_configured ? <span className="text-emerald-700 font-semibold flex items-center gap-1 mt-0.5"><CheckCircle2 className="w-3 h-3" /> Mailbox SMTP configured</span> : <span className="text-amber-700 flex items-center gap-1 mt-0.5"><AlertCircle className="w-3 h-3" /> Mailbox SMTP not configured</span>}
              {cfg.sendgrid_configured ? <span className="text-emerald-700 font-semibold flex items-center gap-1 mt-0.5"><CheckCircle2 className="w-3 h-3" /> SendGrid fallback configured</span> : <span className="text-slate-500 flex items-center gap-1 mt-0.5">SendGrid fallback not configured</span>}
            </div>
          </div>
          <Toggle testId="live-otp-toggle" checked={form.live_otp}
            onChange={v => setForm(f => ({ ...f, live_otp: v }))} />
        </div>
      </Section>

      {/* Twilio */}
      <Section title="Twilio SMS credentials" icon={Phone}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <SecretInput label="Account SID"
            placeholder={cfg.twilio_account_sid_masked || 'Enter Twilio Account SID (AC…)'}
            value={form.twilio_account_sid || ''}
            onChange={v => setForm(f => ({ ...f, twilio_account_sid: v }))}
            show={showSecrets.twilio_sid} onToggle={() => setShowSecrets(s => ({ ...s, twilio_sid: !s.twilio_sid }))}
            testId="cfg-twilio-sid" />
          <SecretInput label="Auth Token"
            placeholder="Enter Twilio Auth Token"
            value={form.twilio_auth_token || ''}
            onChange={v => setForm(f => ({ ...f, twilio_auth_token: v }))}
            show={showSecrets.twilio_tok} onToggle={() => setShowSecrets(s => ({ ...s, twilio_tok: !s.twilio_tok }))}
            testId="cfg-twilio-token" />
          <PlainInput label="From number (E.164)"
            placeholder="+14155552671"
            value={form.twilio_from_number || ''}
            onChange={v => setForm(f => ({ ...f, twilio_from_number: v }))}
            testId="cfg-twilio-from" />
        </div>
      </Section>

      {/* Mailbox SMTP — the route email actually takes unless it is left blank */}
      <Section title="Email mailbox (SMTP)" icon={Mail}>
        <p className="text-[11px] text-slate-500 mb-3">
          The domain's own mailbox, e.g. the one created in Hostinger under Emails. Filling this in
          makes it the route every OTP and alert takes; SendGrid below is only used when it is blank.
          Replies to anything we send go to the support address.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <PlainInput label="SMTP host" placeholder="smtp.hostinger.com"
            value={form.smtp_host || ''}
            onChange={v => setForm(f => ({ ...f, smtp_host: v }))}
            testId="cfg-smtp-host" />
          <PlainInput label="Port (465 TLS, or 587 STARTTLS)" placeholder="465"
            value={form.smtp_port || ''}
            onChange={v => setForm(f => ({ ...f, smtp_port: v }))}
            testId="cfg-smtp-port" />
          <PlainInput label="Mailbox address (also the From address)" placeholder="alerts@ajspay.in"
            value={form.smtp_user || ''}
            onChange={v => setForm(f => ({ ...f, smtp_user: v }))}
            testId="cfg-smtp-user" />
          <SecretInput label="Mailbox password"
            placeholder={cfg.smtp_password_masked || 'Enter the mailbox password'}
            value={form.smtp_password || ''}
            onChange={v => setForm(f => ({ ...f, smtp_password: v }))}
            show={showSecrets.smtp} onToggle={() => setShowSecrets(s => ({ ...s, smtp: !s.smtp }))}
            testId="cfg-smtp-pass" />
          <PlainInput label="Support address (Reply-To)" placeholder="support@ajspay.in"
            value={form.support_email || ''}
            onChange={v => setForm(f => ({ ...f, support_email: v }))}
            testId="cfg-support-email" />
        </div>
      </Section>

      {/* SendGrid */}
      <Section title="SendGrid Email credentials (fallback)" icon={Mail}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <SecretInput label="API Key"
            placeholder={cfg.sendgrid_api_key_masked || 'Enter SendGrid API key (SG…)'}
            value={form.sendgrid_api_key || ''}
            onChange={v => setForm(f => ({ ...f, sendgrid_api_key: v }))}
            show={showSecrets.sg} onToggle={() => setShowSecrets(s => ({ ...s, sg: !s.sg }))}
            testId="cfg-sg-key" />
          <PlainInput label="From email address"
            placeholder="alerts@ajspay.in"
            value={form.sendgrid_from_email || ''}
            onChange={v => setForm(f => ({ ...f, sendgrid_from_email: v }))}
            testId="cfg-sg-from" />
        </div>
      </Section>

      {/* Referral + face match */}
      {/* Named officers. Members are told who to escalate to, and an inspection
          asks who holds the PMLA roles by name. */}
      <Section title="Compliance officers" icon={UserCheck}>
        {!cfg?.grievance_officer_configured && (
          <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-2.5 mb-3">
            No grievance officer is named yet. Until one is, every support ticket and the privacy
            notice tell members the post is unfilled — which the Consumer Protection Act, 2019 expects
            you to fill.
          </p>
        )}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <PlainInput label="Grievance officer — name" testId="gro-name"
            value={form.grievance_officer_name ?? ''} placeholder="e.g. Sunita Verma"
            onChange={v => setForm(f => ({ ...f, grievance_officer_name: v }))} />
          <PlainInput label="Grievance officer — email" testId="gro-email"
            value={form.grievance_officer_email ?? ''} placeholder="grievance@yourdomain.in"
            onChange={v => setForm(f => ({ ...f, grievance_officer_email: v }))} />
          <PlainInput label="Grievance officer — phone" testId="gro-phone"
            value={form.grievance_officer_phone ?? ''} placeholder="+91 ..."
            onChange={v => setForm(f => ({ ...f, grievance_officer_phone: v }))} />
          <PlainInput label="Principal officer (PMLA) — name" testId="po-name"
            value={form.principal_officer_name ?? ''}
            onChange={v => setForm(f => ({ ...f, principal_officer_name: v }))} />
          <PlainInput label="Principal officer — email" testId="po-email"
            value={form.principal_officer_email ?? ''}
            onChange={v => setForm(f => ({ ...f, principal_officer_email: v }))} />
          <PlainInput label="Designated director (PMLA)" testId="dd-name"
            value={form.designated_director_name ?? ''}
            onChange={v => setForm(f => ({ ...f, designated_director_name: v }))} />
        </div>
      </Section>

      {/* Referral reward, face-match threshold, loan/deposit rates, the DD fee and
          the card limit ceiling all live on the Business Parameters screen now —
          a searchable, paginated, fully CRUD table, not more ad-hoc fields here. */}

      <Section title="Check that SMS actually works" icon={Send}>
        <div className="space-y-3">
          <p className="text-[11px] text-slate-600 leading-relaxed">
            Sends one real message and reports what the provider said. Save your credentials first —
            this tests what is stored, not what is typed above.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="block text-[11px] text-slate-600 mb-1">Send a test to</span>
              <input value={testTo} onChange={(e) => setTestTo(e.target.value.replace(/\D/g, ''))}
                data-testid="cfg-test-number" placeholder="10-digit mobile" maxLength={10} inputMode="numeric"
                className="w-48 border border-slate-300 rounded-md px-3 py-2.5 text-sm focus:outline-none focus:border-[#0b3b8c]" />
            </label>
            <button type="button" onClick={runTest} disabled={testing || testTo.length !== 10}
              data-testid="cfg-test-btn"
              className="px-5 py-2.5 rounded-md bg-[#0b3b8c] hover:bg-[#092e6f] text-white text-xs font-semibold disabled:opacity-50 transition">
              {testing ? 'Sending…' : 'Send test SMS'}
            </button>
          </div>

          {testResult && (
            <div data-testid="cfg-test-result"
              className={`p-3 rounded-md border text-[11px] leading-relaxed ${
                testResult.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                              : 'bg-rose-50 border-[#c8102e]/40 text-slate-800'}`}>
              <p className="font-semibold">
                {testResult.ok ? `Accepted for ${testResult.sent_to}` : 'Not sent'}
              </p>
              {/* The provider's own words. "Failed" gives an operator nothing to act on. */}
              <p className="mt-0.5">{testResult.reason}</p>
              {testResult.provider_code && (
                <p className="mt-0.5 text-slate-500">Twilio code {testResult.provider_code}</p>
              )}
              <p className="mt-1.5 text-slate-500">
                Live OTP is {testResult.live_otp ? 'on' : 'off'} · SMS{' '}
                {testResult.sms_configured ? 'configured' : 'not configured'} · Email{' '}
                {testResult.email_configured ? 'configured' : 'not configured'}
              </p>
            </div>
          )}

          <p className="text-[10px] text-slate-500 leading-relaxed">
            On a Twilio trial account a message only reaches numbers you have verified in Twilio, and the
            sender shows as a number. Showing your business name instead needs DLT registration with TRAI,
            which is done on the operator portals, not here.
          </p>
        </div>
      </Section>

      <div className="flex items-center justify-end gap-3">
        <button onClick={load} className="px-4 py-2 rounded-md border border-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" /> Reload
        </button>
        <button data-testid="cfg-save-btn" disabled={saving} onClick={save}
          className="px-5 py-2 rounded-md bg-[#0b3b8c] hover:bg-[#092e6f] text-white text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50">
          {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save changes
        </button>
      </div>
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

function PlainInput({ label, value, onChange, type = 'text', placeholder, testId }) {
  return (
    <div>
      <label className="block text-[11px] text-slate-600 mb-1">{label}</label>
      <input type={type} value={value ?? ''} placeholder={placeholder} data-testid={testId}
        onChange={e => onChange(e.target.value)}
        className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm text-slate-900" />
    </div>
  );
}

function SecretInput({ label, value, onChange, show, onToggle, placeholder, testId }) {
  return (
    <div>
      <label className="block text-[11px] text-slate-600 mb-1">{label}</label>
      <div className="relative">
        <input type={show ? 'text' : 'password'} value={value} placeholder={placeholder} data-testid={testId}
          onChange={e => onChange(e.target.value)}
          className="w-full border border-slate-200 rounded-md px-3 py-2 pr-10 text-sm text-slate-900 font-mono" />
        <button type="button" onClick={onToggle} className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-500 hover:text-slate-700">
          {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );
}

function Toggle({ checked, onChange, testId }) {
  return (
    <button data-testid={testId} onClick={() => onChange(!checked)}
      className={`w-11 h-6 rounded-full transition flex items-center px-0.5 ${checked ? 'bg-[#0b3b8c]' : 'bg-slate-300'}`}>
      <div className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : ''}`} />
    </button>
  );
}
