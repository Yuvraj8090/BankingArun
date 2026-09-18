import React, { useEffect, useState } from 'react';
import { Fingerprint, ShieldCheck, Smartphone, Key, Trash2, PlusCircle, RefreshCw, Mail, Phone, CheckCircle2, Lock } from 'lucide-react';
import { api } from '../services/api';
import { toast } from 'sonner';
import { b64uToBuf, bufToB64u } from '../utils/webauthn';

export default function SecurityPage() {
  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [changingPwd, setChangingPwd] = useState(false);

  const [sessions, setSessions] = useState(null);

  const loadSessions = async () => {
    try { setSessions((await api.activeSessions()).sessions); }
    catch { setSessions([]); }
  };
  useEffect(() => { loadSessions(); }, []);

  const endSession = async (s) => {
    if (!window.confirm(`Sign out ${s.device}?`)) return;
    try { toast.success((await api.revokeSession(s.id)).message); loadSessions(); }
    catch (e) { toast.error(e.response?.data?.detail || 'Could not end that session.'); }
  };

  const changePassword = async () => {
    if (newPwd !== confirmPwd) return toast.error('The two new passwords do not match.');
    setChangingPwd(true);
    try {
      const r = await api.changePassword({ current_password: currentPwd, new_password: newPwd });
      toast.success(r.message);
      setCurrentPwd(''); setNewPwd(''); setConfirmPwd('');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Could not change the password.');
    } finally { setChangingPwd(false); }
  };

  const [passkeys, setPasskeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(false);
  const [label, setLabel] = useState('My Device');

  // OTP state
  const [otpChannel, setOtpChannel] = useState('email');
  const [otpPurpose, setOtpPurpose] = useState('login');
  const [otpCode, setOtpCode] = useState('');
  const [otpDemo, setOtpDemo] = useState(null);
  const [otpSending, setOtpSending] = useState(false);

  const loadPasskeys = async () => {
    try {
      setLoading(true);
      const r = await api.passkeyList();
      setPasskeys(r.passkeys || []);
    } catch { toast.error('Failed to load passkeys'); }
    finally { setLoading(false); }
  };
  useEffect(() => { loadPasskeys(); }, []);

  const enroll = async () => {
    if (!window.PublicKeyCredential) {
      toast.error('This browser does not support passkeys / WebAuthn');
      return;
    }
    setEnrolling(true);
    try {
      const options = await api.passkeyRegisterChallenge();
      // Convert fields
      options.challenge = b64uToBuf(options.challenge);
      options.user.id = b64uToBuf(options.user.id);
      if (options.excludeCredentials) options.excludeCredentials.forEach(c => { c.id = b64uToBuf(c.id); });

      const cred = await navigator.credentials.create({ publicKey: options });
      if (!cred) throw new Error('cancelled');

      const attestation = {
        id: cred.id,
        rawId: bufToB64u(cred.rawId),
        type: cred.type,
        authenticatorAttachment: cred.authenticatorAttachment || null,
        response: {
          attestationObject: bufToB64u(cred.response.attestationObject),
          clientDataJSON: bufToB64u(cred.response.clientDataJSON),
          transports: cred.response.getTransports ? cred.response.getTransports() : []
        },
        clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {}
      };
      const res = await api.passkeyRegisterComplete({ credential: attestation, label });
      toast.success(res.message);
      loadPasskeys();
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message || 'Passkey enrollment failed');
    } finally { setEnrolling(false); }
  };

  const removeKey = async (id) => {
    try { await api.passkeyDelete(id); toast.success('Passkey removed'); loadPasskeys(); }
    catch { toast.error('Delete failed'); }
  };

  const sendOtp = async () => {
    setOtpSending(true); setOtpDemo(null);
    try {
      const r = await api.otpSend({ channel: otpChannel, purpose: otpPurpose });
      toast.success(r.message + (r.live_mode ? '' : ' (Demo)'));
      if (r.demo_otp) setOtpDemo(r.demo_otp);
    } catch { toast.error('OTP send failed'); }
    finally { setOtpSending(false); }
  };
  const verifyOtp = async () => {
    if (!otpCode || otpCode.length !== 6) return toast.error('Enter 6-digit OTP');
    try {
      const r = await api.otpVerify({ purpose: otpPurpose, otp: otpCode });
      toast.success(r.message);
      setOtpCode(''); setOtpDemo(null);
    } catch (e) { toast.error(e.response?.data?.detail || 'OTP verification failed'); }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-6">

      <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-md bg-[#0b3b8c] flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Security &amp; Login</h1>
            <p className="text-xs text-slate-500">Manage passkeys, MFA and login methods</p>
          </div>
        </div>
      </div>

      {/* Passkeys */}
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <Fingerprint className="w-4 h-4 text-[#0b3b8c]" /> Passkeys (Biometric / Face-ID Login)
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">Replace passwords with your device's built-in biometric — fastest and most secure.</p>
          </div>
          <div className="flex items-center gap-2">
            <input value={label} onChange={e => setLabel(e.target.value)} data-testid="passkey-label-input"
              className="border border-slate-200 rounded-md px-3 py-1.5 text-xs w-40" placeholder="Device name" />
            <button data-testid="enroll-passkey-btn" disabled={enrolling} onClick={enroll}
              className="px-3 py-1.5 rounded-md bg-[#0b3b8c] hover:bg-[#092e6f] text-white text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50">
              {enrolling ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <PlusCircle className="w-3.5 h-3.5" />}
              Register passkey
            </button>
          </div>
        </div>
        <div className="p-5">
          {loading ? (
            <div className="text-xs text-slate-500 flex items-center gap-2"><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Loading…</div>
          ) : passkeys.length === 0 ? (
            <div className="text-center py-8 text-xs text-slate-500 space-y-2">
              <Key className="w-8 h-8 text-slate-600 mx-auto" />
              <p>You haven't registered any passkey yet.</p>
              <p>Click <b>Register passkey</b> above — your browser will prompt you to use fingerprint, Face-ID or a security key.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {passkeys.map(p => (
                <div key={p.id} data-testid={`passkey-item-${p.id}`}
                  className="flex items-center justify-between p-3 rounded-md border border-slate-200 bg-slate-50">
                  <div className="flex items-center gap-3">
                    <Smartphone className="w-5 h-5 text-[#0b3b8c]" />
                    <div>
                      <div className="text-xs font-semibold text-slate-900">{p.label}</div>
                      <div className="text-[10px] text-slate-500 font-mono">Cred: •••{(p.credential_id || '').slice(-8)}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-slate-500">Added {new Date(p.created_at).toLocaleDateString()}</span>
                    <button data-testid={`passkey-delete-${p.id}`} onClick={() => removeKey(p.id)}
                      className="p-2 rounded-md text-[#c8102e] hover:bg-red-50">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Where you are signed in */}
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-[#0b3b8c]" /> Where you are signed in
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              If you do not recognise a device, sign it out and change your password.
            </p>
          </div>
          <button type="button" onClick={loadSessions} data-testid="sessions-refresh"
            className="px-3 py-2 rounded-md border border-slate-200 text-xs text-slate-700 hover:border-[#0b3b8c] hover:text-[#0b3b8c] flex items-center gap-1.5 transition">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>
        <div className="divide-y divide-slate-100">
          {sessions === null ? (
            <p className="p-5 text-xs text-slate-500 flex items-center gap-2">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Loading…
            </p>
          ) : sessions.length === 0 ? (
            <p className="p-5 text-xs text-slate-500">No other sessions.</p>
          ) : sessions.map((s) => (
            <div key={s.id} data-testid={`session-${s.id}`} className="p-4 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-slate-900">{s.device}</span>
                  {s.is_current && (
                    <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      this device
                    </span>
                  )}
                  {s.is_impersonation && (
                    <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                      support session
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5 font-mono truncate">{s.ip}</p>
                <p className="text-[11px] text-slate-500">Last active {new Date(s.last_seen_at + 'Z').toLocaleString('en-IN')}</p>
              </div>
              {!s.is_current && (
                <button type="button" onClick={() => endSession(s)} data-testid={`session-revoke-${s.id}`}
                  className="px-3 py-2 rounded-md border border-slate-200 text-xs font-semibold text-slate-700 hover:border-[#c8102e] hover:text-[#c8102e] shrink-0 transition">
                  Sign out
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Change password */}
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
        <div className="p-5 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <Lock className="w-4 h-4 text-[#0b3b8c]" /> Change your password
          </h2>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Every other signed-in device is logged out when you change it. This one stays in.
          </p>
        </div>
        <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-4 text-xs items-end">
          <label className="block">
            <span className="block text-[11px] text-slate-600 mb-1">Current password</span>
            <input type="password" value={currentPwd} onChange={(e) => setCurrentPwd(e.target.value)}
              data-testid="change-current-password" autoComplete="current-password"
              className="w-full border border-slate-300 rounded-md px-3 py-2.5 text-sm focus:outline-none focus:border-[#0b3b8c]" />
          </label>
          <label className="block">
            <span className="block text-[11px] text-slate-600 mb-1">New password</span>
            <input type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)}
              data-testid="change-new-password" autoComplete="new-password"
              className="w-full border border-slate-300 rounded-md px-3 py-2.5 text-sm focus:outline-none focus:border-[#0b3b8c]" />
          </label>
          <label className="block">
            <span className="block text-[11px] text-slate-600 mb-1">Confirm new password</span>
            <input type="password" value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)}
              data-testid="change-confirm-password" autoComplete="new-password"
              className="w-full border border-slate-300 rounded-md px-3 py-2.5 text-sm focus:outline-none focus:border-[#0b3b8c]" />
          </label>
          <div className="md:col-span-3 flex flex-wrap items-center gap-3">
            <button type="button" onClick={changePassword} disabled={changingPwd || !currentPwd || !newPwd}
              data-testid="change-password-btn"
              className="px-5 py-2.5 rounded-md bg-[#0b3b8c] hover:bg-[#092e6f] text-white text-xs font-semibold disabled:opacity-50 transition">
              {changingPwd ? 'Changing…' : 'Change password'}
            </button>
            <p className="text-[11px] text-slate-500">
              At least 8 characters, and not one that has appeared in a known breach.
            </p>
          </div>
        </div>
      </div>

      {/* MFA / OTP */}
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
        <div className="p-5 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <Key className="w-4 h-4 text-[#0b3b8c]" /> Multi-Factor OTP (SMS / Email)
          </h2>
          <p className="text-[11px] text-slate-500 mt-0.5">Wire your Twilio &amp; SendGrid keys in backend .env and set LIVE_OTP=true to send real OTPs.</p>
        </div>
        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="space-y-3">
            <div>
              <label className="block text-[11px] text-slate-600 mb-1">Channel</label>
              <div className="flex gap-2">
                {[
                  { k: 'sms', l: 'SMS', i: Phone },
                  { k: 'email', l: 'Email', i: Mail },
                  { k: 'both', l: 'Both', i: ShieldCheck }
                ].map(c => (
                  <button key={c.k} data-testid={`otp-channel-${c.k}`}
                    onClick={() => setOtpChannel(c.k)}
                    className={`flex-1 py-2 px-2 rounded-md border text-xs font-semibold flex items-center justify-center gap-1.5 transition ${
                      otpChannel === c.k ? 'bg-[#0b3b8c] text-white border-[#0b3b8c]' : 'border-slate-200 text-slate-700 hover:border-[#0b3b8c]'
                    }`}>
                    <c.i className="w-3.5 h-3.5" /> {c.l}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-[11px] text-slate-600 mb-1">Purpose</label>
              <select data-testid="otp-purpose-select" value={otpPurpose} onChange={e => setOtpPurpose(e.target.value)}
                className="w-full border border-slate-200 rounded-md px-3 py-2 text-xs">
                <option value="login">Login</option>
                <option value="txn">Transaction Approval</option>
                <option value="pin_reset">Card PIN Reset</option>
                <option value="high_value">High-Value Transfer</option>
              </select>
            </div>
            <button data-testid="otp-send-btn" disabled={otpSending} onClick={sendOtp}
              className="w-full py-2.5 rounded-md bg-[#0b3b8c] hover:bg-[#092e6f] text-white text-xs font-semibold disabled:opacity-50 flex items-center justify-center gap-2">
              {otpSending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />} Send OTP
            </button>
          </div>

          <div className="space-y-3">
            <label className="block text-[11px] text-slate-600">Enter received OTP</label>
            <input data-testid="otp-code-input" value={otpCode}
              onChange={e => setOtpCode(e.target.value.replace(/\D/g, ''))}
              maxLength={6} placeholder="6-digit code"
              className="w-full border border-slate-300 rounded-md px-3 py-3 text-center text-lg font-mono tracking-widest" />
            {otpDemo && (
              <div className="text-[11px] p-2 rounded-md bg-amber-50 border border-amber-200 text-amber-800">
                <b>Demo mode:</b> your OTP is <span className="font-mono font-bold">{otpDemo}</span> (in live mode this will only reach your SMS/email).
              </div>
            )}
            <button data-testid="otp-verify-btn" onClick={verifyOtp}
              className="w-full py-2.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center justify-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5" /> Verify OTP
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
