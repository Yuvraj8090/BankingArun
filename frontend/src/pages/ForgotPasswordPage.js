import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, KeyRound, ArrowRight, ArrowLeft, CheckCircle2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../services/api';

// Two steps on one page: ask for the address, then take the code and the new
// password. The reply to step one is identical whether or not the address is
// registered, so this screen never tells anyone who banks here.
export default function ForgotPasswordPage() {
  const [step, setStep] = useState('request');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const input = 'w-full bg-white border border-slate-300 rounded-md pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-[#0b3b8c]';

  const request = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.forgotPassword(email.trim());
      toast.success(r.message);
      setStep('reset');
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Could not send the code. Please try again.');
    } finally { setBusy(false); }
  };

  const reset = async (e) => {
    e.preventDefault();
    if (password !== confirm) return toast.error('The two passwords do not match.');
    if (password.length < 8) return toast.error('Use at least 8 characters.');
    setBusy(true);
    try {
      const r = await api.resetPassword({ email: email.trim(), otp: otp.trim(), new_password: password });
      toast.success(r.message);
      setStep('done');
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Could not reset the password.');
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-lg shadow-sm p-6 sm:p-8">
        <Link to="/login" data-testid="forgot-back" className="inline-flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-900 py-2 -mt-2">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to login
        </Link>

        {step === 'done' ? (
          <div className="text-center py-6 space-y-4" data-testid="forgot-done">
            <div className="w-14 h-14 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-7 h-7 text-emerald-600" />
            </div>
            <h1 className="text-lg font-bold text-slate-900">Password changed</h1>
            <p className="text-xs text-slate-600 leading-relaxed">
              Every device that was signed in has been logged out. Sign in again with your new password.
            </p>
            <Link to="/login" className="inline-block px-5 py-2.5 rounded-md bg-[#0b3b8c] hover:bg-[#092e6f] text-white text-xs font-semibold transition">
              Go to login
            </Link>
          </div>
        ) : step === 'request' ? (
          <form onSubmit={request} className="space-y-4 mt-3" data-testid="forgot-request-form">
            <div>
              <h1 className="text-lg font-bold text-slate-900">Forgot your password?</h1>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                Enter the email registered on your account and we'll send a 6-digit code to it.
              </p>
            </div>
            <label className="block">
              <span className="block text-[11px] text-slate-600 mb-1 font-medium">Email</span>
              <span className="relative block">
                <Mail className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 z-10 pointer-events-none" />
                <input data-testid="forgot-email" type="email" required value={email}
                  onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
                  autoComplete="email" className={input} />
              </span>
            </label>
            <button type="submit" disabled={busy} data-testid="forgot-submit"
              className="w-full py-3 rounded-md bg-[#0b3b8c] hover:bg-[#092e6f] text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50 transition">
              {busy ? <><RefreshCw className="w-4 h-4 animate-spin" /> Sending…</> : <>Send code <ArrowRight className="w-4 h-4" /></>}
            </button>
            <p className="text-[11px] text-slate-500 text-center leading-relaxed">
              Didn't register an email? Call 9105015464 and your branch will verify you in person.
            </p>
          </form>
        ) : (
          <form onSubmit={reset} className="space-y-4 mt-3" data-testid="forgot-reset-form">
            <div>
              <h1 className="text-lg font-bold text-slate-900">Enter the code</h1>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                If <b className="text-slate-900">{email}</b> is registered, a 6-digit code is in that inbox.
                It expires in 5 minutes.
              </p>
            </div>
            <label className="block">
              <span className="block text-[11px] text-slate-600 mb-1 font-medium">6-digit code</span>
              <span className="relative block">
                <KeyRound className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 z-10 pointer-events-none" />
                <input data-testid="forgot-otp" required value={otp} inputMode="numeric" maxLength={6}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} placeholder="123456"
                  className={`${input} tracking-[0.3em] font-mono`} />
              </span>
            </label>
            <label className="block">
              <span className="block text-[11px] text-slate-600 mb-1 font-medium">New password</span>
              <input data-testid="forgot-new-password" type="password" required value={password}
                onChange={(e) => setPassword(e.target.value)} autoComplete="new-password"
                className={`${input} pl-3`} />
            </label>
            <label className="block">
              <span className="block text-[11px] text-slate-600 mb-1 font-medium">Confirm new password</span>
              <input data-testid="forgot-confirm-password" type="password" required value={confirm}
                onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password"
                className={`${input} pl-3`} />
            </label>
            <button type="submit" disabled={busy} data-testid="forgot-reset-submit"
              className="w-full py-3 rounded-md bg-[#0b3b8c] hover:bg-[#092e6f] text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50 transition">
              {busy ? <><RefreshCw className="w-4 h-4 animate-spin" /> Changing…</> : <>Change password <ArrowRight className="w-4 h-4" /></>}
            </button>
            <button type="button" onClick={() => setStep('request')}
              className="w-full text-[11px] text-slate-500 hover:text-slate-800 py-1">
              Use a different email
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
