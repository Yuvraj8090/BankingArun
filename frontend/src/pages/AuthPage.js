import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  Building2, ShieldCheck, Lock, User, Mail, Phone, CreditCard,
  ArrowRight, Eye, EyeOff, CheckCircle2, Fingerprint, Gift
} from 'lucide-react';
import Brand from '../components/Brand';
import { toast } from 'sonner';
import { api } from '../services/api';

const b64uToBuf = (b) => {
  const s = b.replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  const bin = atob(s + pad); const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u.buffer;
};
const bufToB64u = (buf) => {
  const bytes = new Uint8Array(buf); let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export default function AuthPage({ onSuccess, defaultIsRegister }) {
  const { login, register } = useAuth();
  const [isRegister, setIsRegister] = useState(!!defaultIsRegister);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);

  // register fields
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [txnPwd, setTxnPwd] = useState('');
  const [pan, setPan] = useState('');
  const [aadhaar, setAadhaar] = useState('');
  const [referralCode, setReferralCode] = useState('');

  // Prefill referral from URL ?ref=
  useEffect(() => {
    try {
      const u = new URL(window.location.href);
      const r = u.searchParams.get('ref');
      if (r) { setReferralCode(r.toUpperCase()); setIsRegister(true); }
    } catch {}
  }, []);

  const doLogin = async (e) => {
    e?.preventDefault();
    if (!email || !password) return toast.error('Enter email and password');
    setLoading(true);
    try {
      const r = await login(email, password);
      toast.success('Welcome back');
      onSuccess?.(r.user?.role);
    } catch (err) { toast.error(err.response?.data?.detail || 'Login failed'); }
    finally { setLoading(false); }
  };

  const doRegister = async (e) => {
    e?.preventDefault();
    if (!name || !email || !password || !txnPwd) return toast.error('Fill all mandatory fields');
    setLoading(true);
    try {
      const r = await register({
        name, email, phone: phone || '+91 98765 43210',
        password, transaction_password: txnPwd,
        pan_number: pan || 'ABCDE1234F',
        aadhaar_number: aadhaar || '987654321098',
        account_type: 'savings', initial_deposit: 1000,
        referral_code: referralCode || null
      });
      if (r.referral_bonus) toast.success(`Welcome bonus ₹${r.referral_bonus} credited!`);
      else toast.success('Account created successfully');
      onSuccess?.(r.user?.role || 'retail');
    } catch (err) { toast.error(err.response?.data?.detail || 'Registration failed'); }
    finally { setLoading(false); }
  };

  const passkeyLogin = async () => {
    if (!email) return toast.error('Enter your email first');
    if (!window.PublicKeyCredential) return toast.error('Passkeys not supported on this browser');
    setLoading(true);
    try {
      const opts = await api.passkeyLoginChallenge(email);
      opts.challenge = b64uToBuf(opts.challenge);
      if (opts.allowCredentials) opts.allowCredentials.forEach(c => { c.id = b64uToBuf(c.id); });
      const assertion = await navigator.credentials.get({ publicKey: opts });
      const payload = {
        email,
        credential: {
          id: assertion.id, rawId: bufToB64u(assertion.rawId), type: assertion.type,
          response: {
            authenticatorData: bufToB64u(assertion.response.authenticatorData),
            clientDataJSON: bufToB64u(assertion.response.clientDataJSON),
            signature: bufToB64u(assertion.response.signature),
            userHandle: assertion.response.userHandle ? bufToB64u(assertion.response.userHandle) : null
          }
        }
      };
      const r = await api.passkeyLoginComplete(payload);
      if (r.token) { localStorage.setItem('banking_token', r.token); window.location.reload(); }
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message || 'Passkey login failed');
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-[80vh] bg-slate-50 grid grid-cols-1 lg:grid-cols-5 gap-0">
      {/* Left panel — brand + trust */}
      <div className="lg:col-span-2 bg-[#0b3b8c] text-white p-8 lg:p-12 flex flex-col justify-between gap-10">
        <Brand variant="stacked" height={80} onDark />
        <div className="space-y-4">
          <h2 className="text-2xl lg:text-3xl font-bold leading-tight">
            Secure banking, <br/>reimagined for every Indian.
          </h2>
          <p className="text-sm text-white/80">
            Open a savings account in minutes, transfer via NEFT/RTGS/IMPS/UPI, manage cards, book FDs, apply for loans — all in one place.
          </p>
          <ul className="space-y-2 text-sm">
            <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-300" /> 256-bit SSL end-to-end</li>
            <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-300" /> Passkey / biometric login</li>
            <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-300" /> Video KYC — no branch visit</li>
          </ul>
        </div>
        <div className="text-[11px] text-white/60">
          © {new Date().getFullYear()} Aadhunik Jeewan Sanchay Nidhi Limited · Toll-free 1800-123-4567
        </div>
      </div>

      {/* Right panel — form */}
      <div className="lg:col-span-3 flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-lg shadow-sm p-6 lg:p-8">
          {/* Tabs are real URLs: /login and /open-account */}
          <div className="flex gap-2 p-1 bg-slate-100 rounded-md mb-6 text-xs">
            <Link to="/login" data-testid="auth-tab-login"
              className={`flex-1 py-2 rounded font-semibold transition text-center ${!isRegister ? 'bg-white shadow-sm text-[#0b3b8c]' : 'text-slate-600'}`}>
              NetBanking Login
            </Link>
            <Link to="/open-account" data-testid="auth-tab-register"
              className={`flex-1 py-2 rounded font-semibold transition text-center ${isRegister ? 'bg-white shadow-sm text-[#0b3b8c]' : 'text-slate-600'}`}>
              Open Account
            </Link>
          </div>

          {!isRegister ? (
            <form onSubmit={doLogin} className="space-y-4">
              <Field icon={Mail} label="Email / User ID">
                <input data-testid="login-email-input" type="email" required
                  value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full bg-white border border-slate-300 rounded-md pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-[#0b3b8c]" />
              </Field>
              <Field icon={Lock} label="Password">
                <div className="relative">
                  <input data-testid="login-password-input" type={showPwd ? 'text' : 'password'} required
                    value={password} onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-white border border-slate-300 rounded-md pl-9 pr-9 py-2.5 text-sm focus:outline-none focus:border-[#0b3b8c]" />
                  <button type="button" onClick={() => setShowPwd(!showPwd)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700">
                    {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </Field>
              <button data-testid="login-submit-btn" type="submit" disabled={loading}
                className="w-full py-3 rounded-md bg-[#0b3b8c] hover:bg-[#092e6f] text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
                {loading ? 'Validating…' : <>Login <ArrowRight className="w-4 h-4" /></>}
              </button>

              <div className="relative py-1">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200" /></div>
                <div className="relative flex justify-center text-[10px] uppercase"><span className="bg-white px-2 text-slate-500">or</span></div>
              </div>

              <button data-testid="passkey-login-btn" type="button" onClick={passkeyLogin} disabled={loading}
                className="w-full py-2.5 rounded-md border border-slate-300 hover:border-[#0b3b8c] hover:bg-blue-50 text-slate-800 text-sm font-semibold flex items-center justify-center gap-2 transition">
                <Fingerprint className="w-4 h-4 text-[#0b3b8c]" /> Sign in with Passkey / Biometric
              </button>

              <p className="text-[11px] text-slate-500 text-center pt-2">
                Demo — Retail: <b>rahul.sharma@example.com</b> / <b>Banking@123</b>
              </p>
            </form>
          ) : (
            <form onSubmit={doRegister} className="space-y-3">
              <Field icon={User} label="Full name (as per PAN)">
                <input data-testid="register-name-input" required value={name} onChange={e => setName(e.target.value)}
                  placeholder="Rahul Sharma"
                  className="w-full bg-white border border-slate-300 rounded-md pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-[#0b3b8c]" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field icon={Mail} label="Email">
                  <input data-testid="register-email-input" type="email" required value={email} onChange={e => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full bg-white border border-slate-300 rounded-md pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-[#0b3b8c]" />
                </Field>
                <Field icon={Phone} label="Phone">
                  <input value={phone} onChange={e => setPhone(e.target.value)}
                    placeholder="+91 98765 43210"
                    className="w-full bg-white border border-slate-300 rounded-md pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-[#0b3b8c]" />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field icon={Lock} label="Login password">
                  <input data-testid="register-password-input" type="password" required value={password} onChange={e => setPassword(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-md pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-[#0b3b8c]" />
                </Field>
                <Field icon={ShieldCheck} label="Transaction PIN">
                  <input data-testid="register-txnpwd-input" type="password" required value={txnPwd} onChange={e => setTxnPwd(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-md pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-[#0b3b8c]" />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field icon={CreditCard} label="PAN (optional)">
                  <input value={pan} onChange={e => setPan(e.target.value.toUpperCase())} placeholder="ABCDE1234F"
                    className="w-full bg-white border border-slate-300 rounded-md pl-9 pr-3 py-2 text-sm font-mono focus:outline-none focus:border-[#0b3b8c]" />
                </Field>
                <Field icon={CreditCard} label="Aadhaar (optional)">
                  <input value={aadhaar} onChange={e => setAadhaar(e.target.value)} placeholder="XXXX-XXXX-XXXX"
                    className="w-full bg-white border border-slate-300 rounded-md pl-9 pr-3 py-2 text-sm font-mono focus:outline-none focus:border-[#0b3b8c]" />
                </Field>
              </div>
              <Field icon={Gift} label="Referral code (optional)">
                <input data-testid="register-referral-input" value={referralCode} onChange={e => setReferralCode(e.target.value.toUpperCase())}
                  placeholder="Your friend's code — both get ₹500"
                  className="w-full bg-white border border-slate-300 rounded-md pl-9 pr-3 py-2 text-sm font-mono focus:outline-none focus:border-[#0b3b8c]" />
              </Field>
              {referralCode && (
                <div className="p-2 rounded-md bg-emerald-50 border border-emerald-200 text-[11px] text-emerald-800 flex items-center gap-2">
                  <Gift className="w-3.5 h-3.5" /> Referral <b className="font-mono">{referralCode}</b> applied — you'll receive ₹500 bonus.
                </div>
              )}
              <button data-testid="register-submit-btn" type="submit" disabled={loading}
                className="w-full py-3 rounded-md bg-[#c8102e] hover:bg-[#a30d25] text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
                {loading ? 'Opening account…' : <>Submit application <ArrowRight className="w-4 h-4" /></>}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ icon: Icon, label, children }) {
  return (
    <div>
      <label className="block text-[11px] text-slate-600 mb-1 font-medium">{label}</label>
      <div className="relative">
        <Icon className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
        {children}
      </div>
    </div>
  );
}
