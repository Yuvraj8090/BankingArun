import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  Building2, Lock, User, Mail, Phone, PiggyBank,
  ArrowRight, Eye, EyeOff, CheckCircle2, Fingerprint, Gift, RefreshCw
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
  const { login } = useAuth();
  const navigate = useNavigate();
  // The two tabs are real URLs, so the route decides which form shows. Holding
  // this in state meant switching tabs changed the address bar while the form
  // stayed put, and only a reload — which remounts — appeared to fix it.
  const isRegister = !!defaultIsRegister;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  // enquiry fields
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [interest, setInterest] = useState('savings');
  const [notes, setNotes] = useState('');
  const [enquirySent, setEnquirySent] = useState(false);
  const [captcha, setCaptcha] = useState(null);
  const [captchaAnswer, setCaptchaAnswer] = useState('');

  // Prefill referral from URL ?ref=
  useEffect(() => {
    try {
      const u = new URL(window.location.href);
      const r = u.searchParams.get('ref');
      if (!r) return;
      setReferralCode(r.toUpperCase());
      // A referral link opens the registration form by going there, rather than
      // by overriding the form on /login and leaving the URL disagreeing with
      // what is on screen.
      if (!defaultIsRegister) navigate(`/open-account${u.search}`, { replace: true });
    } catch {}
  }, [defaultIsRegister, navigate]);

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

  // A Nidhi cannot enrol a member off a web form — identity documents have to be
  // seen and verified — so this raises an enquiry and the sales desk takes it
  // from there. No account is created here and no credentials are collected.
  const newCaptcha = useCallback(async () => {
    setCaptchaAnswer('');
    try { setCaptcha(await api.publicCaptcha()); }
    catch { setCaptcha(null); }
  }, []);

  useEffect(() => { if (isRegister) newCaptcha(); }, [isRegister, newCaptcha]);

  const doEnquiry = async (e) => {
    e?.preventDefault();
    if (!name.trim() || !phone.trim()) return toast.error('Please give us your name and phone number');
    setLoading(true);
    try {
      const r = await api.publicEnquiry({
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim() || undefined,
        interest,
        notes: notes.trim() || undefined,
        referral_code: referralCode.trim() || undefined,
        captcha_id: captcha?.captcha_id,
        captcha_answer: captchaAnswer.trim(),
      });
      setEnquirySent(true);
      toast.success(r.message);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Could not send your enquiry. Please call 9105015464.');
      // The image is spent whether the answer was right or wrong, so the one on
      // screen is already invalid — replace it rather than let them retype it.
      newCaptcha();
    } finally { setLoading(false); }
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
    <div className="min-h-[calc(100vh-4rem)] bg-slate-50 grid grid-cols-1 lg:grid-cols-5">
      {/* Left panel — brand and what this institution actually is. The content is
          centred rather than stretched, so the panel does not open with a void. */}
      {/* Hidden below lg: on a phone this panel is a screenful of marketing the
          member has to scroll past to reach the form they came for. The brand
          is already in the header above. */}
      <div className="hidden lg:col-span-2 bg-[#0b3b8c] text-white px-8 py-10 lg:px-12 lg:py-14 lg:flex flex-col justify-center">
        <div className="max-w-sm mx-auto w-full space-y-8">
          <Brand variant="stacked" height={68} onDark />

          <div className="space-y-3">
            <h2 className="text-2xl lg:text-[27px] font-bold leading-[1.2]">
              Your savings, looked after properly.
            </h2>
            <p className="text-sm text-blue-100 leading-relaxed">
              Become a member in minutes. Move money between member accounts, open fixed and
              recurring deposits, and apply for a loan — all in one place.
            </p>
          </div>

          <ul className="space-y-2.5 text-sm text-blue-50">
            <li className="flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-300 shrink-0 mt-0.5" />
              <span>Encrypted end to end, with a 30&#8209;minute session timeout</span>
            </li>
            <li className="flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-300 shrink-0 mt-0.5" />
              <span>Passkey, biometric or authenticator sign&#8209;in</span>
            </li>
            <li className="flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-300 shrink-0 mt-0.5" />
              <span>Video KYC — no branch visit needed</span>
            </li>
          </ul>

          <div className="pt-6 border-t border-white/15 space-y-1.5">
            <p className="text-[11px] text-blue-100/70">
              © {new Date().getFullYear()} Aadhunik Jeewan Sanchay Nidhi Limited · 1800&#8209;123&#8209;4567
            </p>
          </div>
        </div>
      </div>

      {/* Right panel — form */}
      <div className="lg:col-span-3 flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-lg shadow-sm p-6 lg:p-8">
          {/* Tabs are real URLs: /login and /open-account */}
          <div className="flex gap-2 p-1 bg-slate-100 rounded-md mb-6 text-xs">
            <Link to="/login" data-testid="auth-tab-login"
              className={`flex-1 py-2 rounded font-semibold transition text-center ${!isRegister ? 'bg-white shadow-sm text-[#0b3b8c]' : 'text-slate-600'}`}>
              Member Login
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
                <PasswordInput testId="login-password-input" label="password" placeholder="••••••••"
                  value={password} onChange={e => setPassword(e.target.value)} />
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

            </form>
          ) : (
            enquirySent ? (
              <div className="text-center py-6 space-y-4" data-testid="enquiry-sent">
                <div className="w-14 h-14 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-7 h-7 text-emerald-600" />
                </div>
                <div className="space-y-1.5">
                  <h2 className="text-lg font-bold text-slate-900">Thank you, {name.split(' ')[0]}</h2>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Our team will call you on <b className="text-slate-900">{phone}</b> within one working day to
                    arrange your document verification and complete the opening.
                  </p>
                </div>
                <div className="p-3 rounded-md bg-slate-50 border border-slate-200 text-left text-[11px] text-slate-600 space-y-1.5">
                  <p className="font-semibold text-slate-900">Please keep ready</p>
                  <p>PAN card, Aadhaar or another officially valid document, and a recent photograph.</p>
                </div>
                <a href="tel:9105015464" className="inline-flex items-center gap-2 text-xs font-semibold text-[#0b3b8c]">
                  <Phone className="w-3.5 h-3.5" /> Or call us now on 9105015464
                </a>
              </div>
            ) : (
            <form onSubmit={doEnquiry} className="space-y-3" data-testid="enquiry-form">
              <div className="p-3 rounded-md bg-blue-50 border border-blue-100 text-[11px] text-[#0b3b8c] leading-relaxed">
                Membership needs your documents verified in person, so this form starts the process rather
                than opening the account. Tell us how to reach you and our team will take it from there.
              </div>

              <Field icon={User} label="Full name">
                <input data-testid="enquiry-name-input" required value={name} onChange={e => setName(e.target.value)}
                  placeholder="Rahul Sharma" autoComplete="name"
                  className="w-full bg-white border border-slate-300 rounded-md pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-[#0b3b8c]" />
              </Field>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field icon={Phone} label="Mobile number">
                  <input data-testid="enquiry-phone-input" required value={phone} onChange={e => setPhone(e.target.value)}
                    placeholder="98765 43210" inputMode="tel" autoComplete="tel"
                    className="w-full bg-white border border-slate-300 rounded-md pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-[#0b3b8c]" />
                </Field>
                <Field icon={Mail} label="Email (optional)">
                  <input data-testid="enquiry-email-input" type="email" value={email} onChange={e => setEmail(e.target.value)}
                    placeholder="you@example.com" autoComplete="email"
                    className="w-full bg-white border border-slate-300 rounded-md pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-[#0b3b8c]" />
                </Field>
              </div>

              <Field icon={PiggyBank} label="What are you interested in?">
                <select data-testid="enquiry-interest-input" value={interest} onChange={e => setInterest(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-md pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-[#0b3b8c]">
                  <option value="savings">Savings account</option>
                  <option value="deposit">Fixed or recurring deposit</option>
                  <option value="loan">A loan</option>
                  <option value="other">Something else</option>
                </select>
              </Field>

              <Field icon={Gift} label="Referral code (optional)">
                <input data-testid="enquiry-referral-input" value={referralCode}
                  onChange={e => setReferralCode(e.target.value.toUpperCase())}
                  placeholder="If a member introduced you"
                  className="w-full bg-white border border-slate-300 rounded-md pl-9 pr-3 py-2.5 text-sm font-mono focus:outline-none focus:border-[#0b3b8c]" />
              </Field>

              <label className="block">
                <span className="block text-[11px] text-slate-600 mb-1 font-medium">Anything else? (optional)</span>
                <textarea data-testid="enquiry-notes-input" rows={2} value={notes} onChange={e => setNotes(e.target.value)}
                  placeholder="A good time to call, your nearest branch, or a question"
                  className="w-full bg-white border border-slate-300 rounded-md px-3 py-2.5 text-sm focus:outline-none focus:border-[#0b3b8c]" />
              </label>

              <div>
                <span className="block text-[11px] text-slate-600 mb-1 font-medium">
                  Type the number shown
                </span>
                <div className="flex items-center gap-2">
                  {captcha ? (
                    <img src={captcha.image} alt="Verification number"
                      data-testid="enquiry-captcha-image"
                      className="h-14 w-40 rounded-md border border-slate-300 bg-white shrink-0" />
                  ) : (
                    <div className="h-14 w-40 rounded-md border border-slate-300 bg-slate-50 shrink-0
                      flex items-center justify-center text-[10px] text-slate-500 text-center px-2">
                      Could not load the image
                    </div>
                  )}
                  <button type="button" onClick={newCaptcha} data-testid="enquiry-captcha-refresh"
                    aria-label="Show a different number"
                    className="p-3 rounded-md border border-slate-300 text-slate-600 hover:border-[#0b3b8c] hover:text-[#0b3b8c] shrink-0">
                    <RefreshCw className="w-4 h-4" />
                  </button>
                  <input data-testid="enquiry-captcha-input" required value={captchaAnswer}
                    onChange={e => setCaptchaAnswer(e.target.value.replace(/\D/g, ''))}
                    inputMode="numeric" autoComplete="off" maxLength={6} placeholder="12345"
                    className="w-full bg-white border border-slate-300 rounded-md px-3 py-2.5 text-sm tracking-[0.3em] font-mono focus:outline-none focus:border-[#0b3b8c]" />
                </div>
                <p className="text-[10px] text-slate-400 mt-1">
                  Can't read it? Use the refresh button for a new number, or call 9105015464.
                </p>
              </div>

              <button data-testid="enquiry-submit-btn" type="submit" disabled={loading}
                className="w-full py-3 rounded-md bg-[#c8102e] hover:bg-[#a30d25] text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
                {loading ? 'Sending…' : <>Request a call back <ArrowRight className="w-4 h-4" /></>}
              </button>

              <p className="text-[11px] text-slate-500 text-center leading-relaxed">
                We use these details only to contact you about membership. No account is opened until your
                documents are verified.
              </p>
            </form>
            )
          )}
        </div>
      </div>
    </div>
  );
}

// A password field with its reveal toggle. The toggle is padded out to a real
// tap target: the icon alone is 16px, well under the 24px minimum, and a tap
// that lands beside it makes the button feel broken.
function PasswordInput({ value, onChange, testId, label, placeholder, dense = false }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        data-testid={testId}
        type={show ? 'text' : 'password'}
        required
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className={`w-full bg-white border border-slate-300 rounded-md pl-9 pr-11 ${dense ? 'py-2' : 'py-2.5'} text-sm focus:outline-none focus:border-[#0b3b8c]`}
      />
      <button
        type="button"
        onClick={() => setShow(!show)}
        aria-label={`${show ? 'Hide' : 'Show'} ${label}`}
        data-testid={`${testId}-toggle`}
        className={`absolute right-0.5 top-1/2 -translate-y-1/2 ${dense ? 'p-2.5' : 'p-3'} text-slate-500 hover:text-slate-700 rounded-md`}
      >
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
}

function Field({ icon: Icon, label, children }) {
  return (
    <div>
      <label className="block text-[11px] text-slate-600 mb-1 font-medium">{label}</label>
      <div className="relative">
        {/* z-10 keeps the icon above the field. A password field brings its own
            relative wrapper for the reveal button, and being positioned and later
            in the DOM it would otherwise paint its white background over this. */}
        <Icon className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 z-10 pointer-events-none" />
        {children}
      </div>
    </div>
  );
}
