import React, { useEffect, useState } from 'react';
import { Settings2, Phone, Mail, ShieldCheck, RefreshCw, Save, Eye, EyeOff, AlertCircle, CheckCircle2, Percent, UserCheck} from 'lucide-react';
import { api } from '../services/api';
import { toast } from 'sonner';

export default function AdminConfigPage() {
  const [cfg, setCfg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({});
  const [showSecrets, setShowSecrets] = useState({});

  const load = async () => {
    try { const r = await api.adminConfigGet(); setCfg(r); setForm({ live_otp: r.live_otp, twilio_from_number: r.twilio_from_number, sendgrid_from_email: r.sendgrid_from_email, referral_reward_amount: r.referral_reward_amount, face_match_auto_threshold: r.face_match_auto_threshold }); }
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

      {/* Live OTP toggle */}
      <Section title="OTP Delivery Mode" icon={ShieldCheck}>
        <div className="flex items-start justify-between p-4 border border-slate-200 rounded-md bg-slate-50">
          <div>
            <div className="font-semibold text-slate-900 text-sm">Live OTP delivery</div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              When enabled, OTPs are sent through real Twilio SMS and SendGrid Email. When disabled, OTPs remain mocked and shown in the JSON response for demo.
            </div>
            <div className="text-[11px] text-slate-500 mt-2">
              {cfg.twilio_configured ? <span className="text-emerald-700 font-semibold flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Twilio configured</span> : <span className="text-amber-700 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> Twilio not configured</span>}
              {cfg.sendgrid_configured ? <span className="text-emerald-700 font-semibold flex items-center gap-1 mt-0.5"><CheckCircle2 className="w-3 h-3" /> SendGrid configured</span> : <span className="text-amber-700 flex items-center gap-1 mt-0.5"><AlertCircle className="w-3 h-3" /> SendGrid not configured</span>}
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

      {/* SendGrid */}
      <Section title="SendGrid Email credentials" icon={Mail}>
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

      <Section title="Program parameters" icon={Percent}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <PlainInput label="Referral reward (INR)" type="number"
            value={form.referral_reward_amount ?? 500}
            onChange={v => setForm(f => ({ ...f, referral_reward_amount: parseFloat(v) }))}
            testId="cfg-ref-amount" />
          <PlainInput label="Face-match auto-approval threshold (%)" type="number"
            value={form.face_match_auto_threshold ?? 92}
            onChange={v => setForm(f => ({ ...f, face_match_auto_threshold: parseFloat(v) }))}
            testId="cfg-face-threshold" />
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
        <button type="button" onClick={onToggle} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-slate-700">
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
