import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  Building2, Lock, User, Mail, Phone,
  ArrowRight, Eye, EyeOff, CheckCircle2, Fingerprint, RefreshCw, Gift
} from 'lucide-react';
import Brand from '../components/Brand';
import { toast } from 'sonner';
import { api } from '../services/api';
import { b64uToBuf, bufToB64u } from '../utils/webauthn';
import { COMPANY } from '../data/company';

export default function AuthPage({ onSuccess, defaultIsRegister, portal = 'member', referralCode = '' }) {
  const { login } = useAuth();
  // The two tabs are real URLs, so the route decides which form shows. Holding
  // this in state meant switching tabs changed the address bar while the form
  // stayed put, and only a reload — which remounts — appeared to fix it.
  const isRegister = !!defaultIsRegister;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  // register fields
  const [name, setName] = useState('');
  // Typed by the applicant, or filled in from a referral link (?ref=CODE).
  const [refCode, setRefCode] = useState(referralCode);
  const [phone, setPhone] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regPasswordConfirm, setRegPasswordConfirm] = useState('');
  const [registered, setRegistered] = useState(null);
  const [captcha, setCaptcha] = useState(null);
  const [captchaAnswer, setCaptchaAnswer] = useState('');

  const doLogin = async (e) => {
    e?.preventDefault();
    if (!email || !password) return toast.error('Enter email and password');
    if (!captchaAnswer.trim()) return toast.error('Please type the number shown in the image');
    setLoading(true);
    try {
      const r = await login(email, password, 'Web Portal', {
        captcha_id: captcha?.captcha_id, captcha_answer: captchaAnswer.trim(), portal,
      });
      toast.success('Welcome back');
      onSuccess?.(r.user?.role);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Login failed');
      // The image is spent whether the answer was right or wrong, so the one on
      // screen is already invalid — replace it rather than let them retype it.
      newCaptcha();
    } finally { setLoading(false); }
  };

  // A Nidhi still cannot enrol a *verified* member off a web form — identity
  // documents have to be seen in person or over video KYC, and that stays a
  // staff-led step (CRM → Open account). What this form gives somebody
  // straight away is a real login: an account they can sign into and look
  // around in, but that cannot move any money until staff verify their KYC.
  // A captcha guards every credentialed form here, login included, not only
  // registration.
  const newCaptcha = useCallback(async () => {
    setCaptchaAnswer('');
    try { setCaptcha(await api.publicCaptcha()); }
    catch { setCaptcha(null); }
  }, []);

  useEffect(() => { newCaptcha(); }, [isRegister, newCaptcha]);

  const doSelfRegister = async (e) => {
    e?.preventDefault();
    if (!name.trim() || !phone.trim()) return toast.error('Please give us your name and phone number');
    if (regPassword.length < 6) return toast.error('Your password must be at least 6 characters');
    if (regPassword !== regPasswordConfirm) return toast.error('Those two passwords do not match');
    if (!captchaAnswer.trim()) return toast.error('Please type the number shown in the image');
    setLoading(true);
    try {
      // The applicant picks their own login password here; the server still
      // has the final word (6+ characters, not just
      // their own name or email — see assert_password_acceptable in
      // hostinger/db.php and modules/security.php) before it is accepted.
      const r = await api.selfRegister({
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim() || undefined,
        password: regPassword,
        referral_code: refCode.trim().toUpperCase() || undefined,
        captcha_id: captcha?.captcha_id,
        captcha_answer: captchaAnswer.trim(),
      });
      setRegistered(r);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Could not create your account. Please call ' + COMPANY.phone + '.');
      // The image is spent whether the answer was right or wrong, so the one on
      // screen is already invalid — replace it rather than let them retype it.
      newCaptcha();
    } finally { setLoading(false); }
  };

  const continueToAccount = () => {
    if (!registered?.token) return;
    // The server already set the session cookie in the self-register response;
    // the reload below picks the session back up from that, not from anything
    // stored here (see AuthContext.checkAuth).
    window.location.href = '/';
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
      // Same as above: the reload restores the session from the cookie the
      // server just set, not from client-side storage.
      if (r.token) { window.location.reload(); }
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
              © {new Date().getFullYear()} {COMPANY.legalName} · {COMPANY.phone}
            </p>
          </div>
        </div>
      </div>

      {/* Right panel — form */}
      <div className="lg:col-span-3 flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-lg shadow-sm p-6 lg:p-8">
          {portal === 'staff' ? (
            <div className="mb-4">
              <h1 className="text-base font-bold text-slate-900 flex items-center gap-1.5">
                <Building2 className="w-4 h-4 text-[#0b3b8c]" /> Corporate Login
              </h1>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Directors, branch managers and staff sign in here with their registered email.
              </p>
            </div>
          ) : (
            <>
              {/* Tabs are real URLs: /login and /open-account */}
              <div className="flex gap-2 p-1 bg-slate-100 rounded-md mb-2 text-xs">
                <Link to="/login" data-testid="auth-tab-login"
                  className={`flex-1 py-2 rounded font-semibold transition text-center ${!isRegister ? 'bg-white shadow-sm text-[#0b3b8c]' : 'text-slate-600'}`}>
                  Customer / Retail Login
                </Link>
                <Link to="/open-account" data-testid="auth-tab-register"
                  className={`flex-1 py-2 rounded font-semibold transition text-center ${isRegister ? 'bg-white shadow-sm text-[#0b3b8c]' : 'text-slate-600'}`}>
                  Customer / Retail Signup
                </Link>
              </div>
              {!isRegister && (
                <p className="text-[11px] text-slate-500 mb-4">
                  Director, branch manager or staff? <Link to="/corporate-login" data-testid="auth-corporate-login-link"
                    className="font-semibold text-[#0b3b8c] hover:text-[#092e6f]">Sign in at Corporate Login →</Link>
                </p>
              )}
            </>
          )}

          {!isRegister ? (
            <form onSubmit={doLogin} className="space-y-4">
              <Field icon={Mail} label="Email or user ID">
                <input data-testid="login-email-input" type="text" required
                  value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com or AJSP0…"
                  autoComplete="username"
                  className="w-full bg-white border border-slate-300 rounded-md pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-[#0b3b8c]" />
              </Field>
              <Field icon={Lock} label="Password">
                <PasswordInput testId="login-password-input" label="password" placeholder="••••••••"
                  value={password} onChange={e => setPassword(e.target.value)} />
              </Field>
              <div className="flex justify-end -mt-1">
                <Link to="/forgot-password" data-testid="forgot-password-link"
                  className="text-[11px] font-semibold text-[#0b3b8c] hover:text-[#092e6f] py-1">
                  Forgot password?
                </Link>
              </div>

              <div>
                <CaptchaField testId="login-captcha" captcha={captcha} captchaAnswer={captchaAnswer}
                  setCaptchaAnswer={setCaptchaAnswer} onRefresh={newCaptcha} />
              </div>

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
            registered ? (
              <div className="space-y-3" data-testid="register-success">
                <div className="text-center space-y-2 pb-1">
                  <div className="w-14 h-14 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center mx-auto">
                    <CheckCircle2 className="w-7 h-7 text-emerald-600" />
                  </div>
                  <h2 className="text-lg font-bold text-slate-900">Welcome, {name.split(' ')[0]}</h2>
                </div>
                <div className="p-3 rounded-md bg-emerald-50 border border-emerald-200">
                  <p className="text-[11px] text-emerald-900">Your User ID for signing in</p>
                  <p className="text-xl font-mono font-bold text-emerald-900 tracking-wide" data-testid="register-user-id">
                    {registered.user_id}
                  </p>
                </div>
                <div className="p-3 rounded-md bg-slate-50 border border-slate-200">
                  <p className="text-[11px] text-slate-600">Your transaction password (for payments, not sign-in)</p>
                  <p className="text-base font-mono font-semibold text-slate-900" data-testid="register-transaction-password">
                    {registered.transaction_password}
                  </p>
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Sign in with the password you just chose. Write down the transaction password above — you will
                  need it to move money. You can look around now, but depositing, transferring or applying for a
                  loan needs your identity verified first. Visit a branch or complete Video KYC from your dashboard.
                </p>
                <button onClick={continueToAccount} data-testid="register-continue-btn"
                  className="w-full py-3 rounded-md bg-[#0b3b8c] hover:bg-[#092e6f] text-white text-sm font-semibold flex items-center justify-center gap-2">
                  Continue to your account <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            ) : (
            <form onSubmit={doSelfRegister} className="space-y-3" data-testid="register-form">
              {referralCode && refCode === referralCode && (
                <div data-testid="register-referral-banner"
                  className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800">
                  <Gift className="w-3.5 h-3.5 shrink-0" />
                  Referral code <b className="font-mono">{referralCode}</b> applied — you will be recorded as introduced by them once your KYC is verified.
                </div>
              )}
              <Field icon={User} label="Full name">
                <input data-testid="register-name-input" required value={name} onChange={e => setName(e.target.value)}
                  placeholder="Rahul Sharma" autoComplete="name"
                  className="w-full bg-white border border-slate-300 rounded-md pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-[#0b3b8c]" />
              </Field>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field icon={Phone} label="Mobile number">
                  <input data-testid="register-phone-input" required value={phone} onChange={e => setPhone(e.target.value)}
                    placeholder="98765 43210" inputMode="tel" autoComplete="tel"
                    className="w-full bg-white border border-slate-300 rounded-md pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-[#0b3b8c]" />
                </Field>
                <Field icon={Mail} label="Email (optional)">
                  <input data-testid="register-email-input" type="email" value={email} onChange={e => setEmail(e.target.value)}
                    placeholder="you@example.com" autoComplete="email"
                    className="w-full bg-white border border-slate-300 rounded-md pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-[#0b3b8c]" />
                </Field>
              </div>

              <Field icon={Lock} label="Choose a password">
                <PasswordInput testId="register-password-input" label="password" placeholder="At least 6 characters"
                  value={regPassword} onChange={e => setRegPassword(e.target.value)} />
              </Field>
              <PasswordStrength password={regPassword} />
              <Field icon={Lock} label="Confirm password">
                <PasswordInput testId="register-password-confirm-input" label="password confirmation" placeholder="Type it again"
                  value={regPasswordConfirm} onChange={e => setRegPasswordConfirm(e.target.value)} />
              </Field>
              {regPasswordConfirm && regPassword !== regPasswordConfirm && (
                <p className="text-[11px] text-[#c8102e] -mt-2">Passwords do not match.</p>
              )}

              <div>
              <Field icon={Gift} label="Referral ID (optional)">
                <input data-testid="register-referral-input" value={refCode} maxLength={12}
                  onChange={e => setRefCode(e.target.value.toUpperCase())}
                  placeholder="ID of the member who told you about us"
                  className="w-full bg-white border border-slate-300 rounded-md pl-9 pr-3 py-2.5 text-sm font-mono focus:outline-none focus:border-[#0b3b8c]" />
              </Field>
              <p className="text-[10px] text-slate-500 -mt-1">Recorded once your KYC is verified. No one is paid for introducing you.</p>
                <CaptchaField testId="register-captcha" captcha={captcha} captchaAnswer={captchaAnswer}
                  setCaptchaAnswer={setCaptchaAnswer} onRefresh={newCaptcha} />
                <p className="text-[10px] text-slate-500 mt-1">
                  Can't read it? Use the refresh button for a new number, or call {COMPANY.phone}.
                </p>
              </div>

              <button data-testid="register-submit-btn" type="submit" disabled={loading}
                className="w-full py-3 rounded-md bg-[#c8102e] hover:bg-[#a30d25] text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
                {loading ? 'Creating your account…' : <>Create account <ArrowRight className="w-4 h-4" /></>}
              </button>

              <p className="text-[11px] text-slate-500 text-center leading-relaxed">
                You can sign in right away. Depositing, transferring or applying for a loan needs your identity
                verified first — visit a branch or complete Video KYC from your dashboard.
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

// A live nudge while typing, nothing more — the server has the real say on
// whether a password is acceptable (length, and rejected outright if it turns
// up in a known breach; see assert_password_acceptable in hostinger/db.php).
function passwordScore(pw) {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return score;
}

const STRENGTH_LABELS = ['Too short', 'Weak', 'Fair', 'Good', 'Strong', 'Strong'];
const STRENGTH_COLORS = ['bg-slate-200', 'bg-red-500', 'bg-amber-500', 'bg-amber-500', 'bg-emerald-600', 'bg-emerald-600'];

function PasswordStrength({ password }) {
  if (!password) return null;
  const score = passwordScore(password);
  return (
    <div className="-mt-1" data-testid="register-password-strength">
      <div className="flex gap-1">
        {[0, 1, 2, 3, 4].map(i => (
          <div key={i} className={`h-1 flex-1 rounded-full ${i < score ? STRENGTH_COLORS[score] : 'bg-slate-200'}`} />
        ))}
      </div>
      <p className="text-[10px] text-slate-500 mt-1">
        {STRENGTH_LABELS[score]}
        {score < 3 && ' — try mixing upper/lower case, a number and a symbol'}
      </p>
    </div>
  );
}

// The same number-image challenge behind every credentialed form here —
// signup and login alike — so it lives once rather than being retyped per form.
function CaptchaField({ testId, captcha, captchaAnswer, setCaptchaAnswer, onRefresh }) {
  return (
    <>
      <span className="block text-[11px] text-slate-600 mb-1 font-medium">Type the number shown</span>
      <div className="flex items-center gap-2">
        {captcha ? (
          <img src={captcha.image} alt="Verification number"
            data-testid={`${testId}-image`}
            className="h-14 w-40 rounded-md border border-slate-300 bg-white shrink-0" />
        ) : (
          <div className="h-14 w-40 rounded-md border border-slate-300 bg-slate-50 shrink-0
            flex items-center justify-center text-[10px] text-slate-500 text-center px-2">
            Could not load the image
          </div>
        )}
        <button type="button" onClick={onRefresh} data-testid={`${testId}-refresh`}
          aria-label="Show a different number"
          className="p-3 rounded-md border border-slate-300 text-slate-600 hover:border-[#0b3b8c] hover:text-[#0b3b8c] shrink-0">
          <RefreshCw className="w-4 h-4" />
        </button>
        <input data-testid={`${testId}-input`} required value={captchaAnswer}
          onChange={e => setCaptchaAnswer(e.target.value.replace(/\D/g, ''))}
          inputMode="numeric" autoComplete="off" maxLength={6} placeholder="12345"
          className="w-full bg-white border border-slate-300 rounded-md px-3 py-2.5 text-sm tracking-[0.3em] font-mono focus:outline-none focus:border-[#0b3b8c]" />
      </div>
    </>
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
