import React, { useEffect, useState } from 'react';
import { Gift, Share2, Copy, Users, Wallet, MessageCircle, Twitter, Mail, RefreshCw, CheckCircle2, Info } from 'lucide-react';
import { api } from '../services/api';
import { toast } from 'sonner';

const inr = (n) => `₹${Number(n).toLocaleString('en-IN')}`;

// The twelve-level table printed in the plan book, and what it would come to on
// one plan at one amount. It is shown because members are asked about it and the
// desk had no way to answer; it is not paid, and the banner says so before any
// number appears. See route_referral_structure.
function BrochureStructure() {
  const [data, setData] = useState(null);
  const [schemes, setSchemes] = useState([]);
  const [code, setCode] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.referralStructure().then(setData).catch(() => setData(null));
    api.publicSchemes().then((r) => setSchemes(r.schemes || [])).catch(() => setSchemes([]));
  }, []);

  const scheme = schemes.find((s) => s.code === code);
  const slabs = scheme?.slabs || [];

  const illustrate = async (nextCode, nextAmount) => {
    setCode(nextCode);
    setAmount(nextAmount);
    if (!nextCode || !nextAmount) {
      return setData((d) => (d ? { ...d, illustration: null } : d));
    }
    setBusy(true);
    try {
      setData(await api.referralStructure({ scheme_code: nextCode, amount: nextAmount }));
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Could not work that out');
    } finally { setBusy(false); }
  };

  if (!data) return null;
  const ill = data.illustration;

  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm" data-testid="referral-structure">
      <div className="p-4 border-b border-slate-100">
        <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
          <Info className="w-4 h-4 text-[#0b3b8c]" /> The table printed in the plan book
        </h2>
      </div>

      <div className="p-4 space-y-4">
        <div className="p-3 rounded-md bg-amber-50 border border-amber-200 text-[11px] text-amber-900"
          data-testid="referral-structure-notice">
          {data.notice}
        </div>

        {data.chain?.length > 0 && (
          <div className="flex flex-wrap gap-2" data-testid="referral-chain">
            {data.chain.map((c) => (
              <span key={c.level} className="px-2 py-1 rounded-full text-[10px] font-semibold border border-slate-200 bg-slate-50 text-slate-700">
                Level {c.level}: {c.members} member{c.members === 1 ? '' : 's'}
              </span>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] text-slate-600 mb-1">Work it out for a plan</label>
            <select data-testid="referral-calc-scheme" value={code}
              onChange={(e) => illustrate(e.target.value, '')}
              className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm bg-white">
              <option value="">Choose a plan</option>
              {schemes.map((sc) => <option key={sc.code} value={sc.code}>{sc.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] text-slate-600 mb-1">
              {['daily', 'recurring'].includes(scheme?.scheme_type) ? 'Monthly instalment' : 'Amount'}
            </label>
            <select data-testid="referral-calc-amount" value={amount} disabled={!scheme}
              onChange={(e) => illustrate(code, e.target.value)}
              className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm bg-white disabled:bg-slate-50">
              <option value="">{scheme ? 'Choose an amount' : 'Choose a plan first'}</option>
              {slabs.map((sl) => <option key={sl.unit} value={sl.unit}>{inr(sl.unit)}</option>)}
            </select>
          </div>
        </div>

        {busy && <p className="text-[11px] text-slate-500">Working it out…</p>}

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs min-w-[480px]">
            <thead className="bg-slate-50 text-[10px] uppercase text-slate-600">
              <tr>
                <th className="p-2 font-semibold">Level</th>
                {(ill ? ill.columns : data.instalment.columns).map((c) => (
                  <th key={c} className="p-2 font-semibold text-right">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(ill ? ill.levels : data.instalment.levels).map((r) => (
                <tr key={r.level} className="hover:bg-blue-50/40 transition-colors">
                  <td className="p-2 font-semibold text-slate-900">{r.level}</td>
                  {r.rates.map((rate, i) => (
                    <td key={i} className="p-2 text-right text-slate-700">
                      {rate === null ? <span className="text-slate-500">—</span> : (
                        <>
                          {ill && <span className="font-semibold">{inr(r.amounts[i] ?? 0)}</span>}
                          <span className={ill ? 'text-slate-500 ml-1' : ''}>{rate}%</span>
                        </>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {ill?.family_unknown && (
          <p className="text-[11px] text-[#c8102e]" data-testid="referral-family-unknown">
            The book sets the first-level rate per BN plan family, and no priced page says which
            family this plan is in — so all four are shown. Ask head office before quoting one.
          </p>
        )}
        {data.mis_note && (
          <p className="text-[11px] text-slate-500" data-testid="referral-mis-note">{data.mis_note}</p>
        )}

        <p className="text-[11px] text-slate-500">
          {ill
            ? ill.basis === 'instalment'
              ? `On ${ill.scheme.name} at ${inr(ill.unit)} a month, ${inr(ill.total_paid_in)} is paid in over the plan. `
                + 'The four columns are years — the rate falls the longer the plan runs.'
              : `On ${ill.scheme.name} at ${inr(ill.total_paid_in)} paid in once. `
                + 'The four columns here are plan families, not years: the book prints a different '
                + 'first-level rate for each.'
            : 'Shown for instalment plans. Choose a plan above to see the amounts, and the one-time '
              + 'plans use a separate table where the columns are plan families rather than years.'}
        </p>
      </div>
    </div>
  );
}

export default function ReferralPage() {
  const [data, setData] = useState(null);
  const [history, setHistory] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.referralCode(), api.referralHistory()])
      .then(([c, h]) => { setData(c); setHistory(h); })
      .catch(() => toast.error('Failed to load referrals'))
      .finally(() => setLoading(false));
  }, []);

  const copyLink = () => {
    if (!data) return;
    navigator.clipboard.writeText(data.referral_link);
    toast.success('Referral link copied');
  };

  const shareTo = (channel) => {
    if (!data) return;
    const msg = encodeURIComponent(`Open a free savings account with AJSPay and we both get ₹${data.reward_amount}! ${data.referral_link}`);
    const urls = {
      whatsapp: `https://wa.me/?text=${msg}`,
      twitter: `https://twitter.com/intent/tweet?text=${msg}`,
      email: `mailto:?subject=${encodeURIComponent('Join me on AJSPay')}&body=${msg}`
    };
    window.open(urls[channel], '_blank', 'noopener,noreferrer');
  };

  if (loading || !data) return <div className="p-10 flex items-center gap-2 text-slate-600"><RefreshCw className="w-4 h-4 animate-spin" /> Loading referrals…</div>;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      {/* Header hero */}
      <div className="bg-gradient-to-br from-[#0b3b8c] to-[#092e6f] text-white rounded-lg p-6 shadow-md">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-md bg-white/10 flex items-center justify-center"><Gift className="w-6 h-6 text-white" /></div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">Refer &amp; Earn</h1>
            <p className="text-sm text-slate-900/85 mt-1">{data.reward_note}</p>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-900/70">Total earned</div>
            <div className="text-2xl font-bold">₹{(history?.total_earned || 0).toLocaleString('en-IN')}</div>
          </div>
        </div>
      </div>

      {/* Link block */}
      <div className="bg-white border border-slate-200 rounded-lg p-6 shadow-sm space-y-4">
        <div>
          <label className="text-[11px] text-slate-500 uppercase font-semibold">Your referral code</label>
          <div className="mt-2 flex items-center gap-3">
            <div className="flex-1 bg-slate-50 border border-slate-200 rounded-md px-4 py-3 font-mono text-lg font-bold text-[#0b3b8c] text-center tracking-widest">
              {data.referral_code}
            </div>
            <button data-testid="copy-ref-code-btn" onClick={() => { navigator.clipboard.writeText(data.referral_code); toast.success('Code copied'); }}
              className="p-3 rounded-md border border-slate-200 hover:border-[#0b3b8c] text-slate-700 hover:text-[#0b3b8c]">
              <Copy className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div>
          <label className="text-[11px] text-slate-500 uppercase font-semibold">Personalised link</label>
          <div className="mt-2 flex items-center gap-2">
            <div className="flex-1 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-xs text-slate-700 font-mono truncate">
              {data.referral_link}
            </div>
            <button data-testid="copy-ref-link-btn" onClick={copyLink}
              className="px-3 py-2 rounded-md bg-[#0b3b8c] hover:bg-[#092e6f] text-white text-xs font-semibold flex items-center gap-1.5">
              <Copy className="w-3.5 h-3.5" /> Copy
            </button>
          </div>
        </div>

        <div className="pt-3 border-t border-slate-100 grid grid-cols-3 gap-3">
          <button data-testid="share-whatsapp" onClick={() => shareTo('whatsapp')}
            className="py-2.5 rounded-md border border-slate-200 hover:border-emerald-500 hover:bg-emerald-50 text-xs font-semibold text-slate-700 flex items-center justify-center gap-2 transition">
            <MessageCircle className="w-4 h-4 text-emerald-600" /> WhatsApp
          </button>
          <button data-testid="share-twitter" onClick={() => shareTo('twitter')}
            className="py-2.5 rounded-md border border-slate-200 hover:border-[#0b3b8c] hover:bg-blue-50 text-xs font-semibold text-slate-700 flex items-center justify-center gap-2 transition">
            <Twitter className="w-4 h-4 text-[#0b3b8c]" /> Twitter / X
          </button>
          <button data-testid="share-email" onClick={() => shareTo('email')}
            className="py-2.5 rounded-md border border-slate-200 hover:border-[#c8102e] hover:bg-red-50 text-xs font-semibold text-slate-700 flex items-center justify-center gap-2 transition">
            <Mail className="w-4 h-4 text-[#c8102e]" /> Email
          </button>
        </div>
      </div>

      {/* How it works */}
      <div className="bg-white border border-slate-200 rounded-lg p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900 mb-3">How it works</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          {[
            { i: Share2, t: 'Share your link', d: 'Send your unique link over WhatsApp, email or social media.' },
            { i: Users, t: 'Friend joins & completes KYC', d: 'They open a new AJSPay account using your code.' },
            { i: Wallet, t: 'Both get ₹500', d: `You and your friend each receive ₹${data.reward_amount} instantly.` }
          ].map((s, i) => (
            <div key={i} className="p-4 rounded-md border border-slate-200 bg-slate-50">
              <div className="w-8 h-8 rounded-md bg-[#0b3b8c] text-white flex items-center justify-center"><s.i className="w-4 h-4" /></div>
              <div className="mt-2 font-semibold text-slate-900">{i + 1}. {s.t}</div>
              <div className="text-slate-600 mt-1">{s.d}</div>
            </div>
          ))}
        </div>
      </div>

      {/* History */}
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Your referrals ({history?.count || 0})</h2>
          <span className="text-[11px] text-slate-500">Earned ₹{(history?.total_earned || 0).toLocaleString('en-IN')} so far</span>
        </div>
        <div className="overflow-x-auto">
          {history?.referrals?.length ? (
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-[11px] uppercase text-slate-600">
                <tr>
                  <th className="p-3 font-semibold">Friend</th>
                  <th className="p-3 font-semibold">Email</th>
                  <th className="p-3 font-semibold">Joined</th>
                  <th className="p-3 font-semibold">Status</th>
                  <th className="p-3 font-semibold text-right">Credit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {history.referrals.map(r => (
                  <tr key={r.id} className="hover:bg-blue-50/40 transition-colors">
                    <td className="p-3 font-semibold text-slate-900">{r.referee_name}</td>
                    <td className="p-3 text-slate-600">{r.referee_email}</td>
                    <td className="p-3 text-slate-500">{new Date(r.created_at).toLocaleDateString('en-IN')}</td>
                    <td className="p-3">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        <CheckCircle2 className="w-2.5 h-2.5" /> {r.status}
                      </span>
                    </td>
                    <td className="p-3 text-right font-bold text-emerald-700">₹{r.credit_amount.toLocaleString('en-IN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-10 text-center text-xs text-slate-500">
              No one has joined via your link yet. Share above to start earning!
            </div>
          )}
        </div>
      </div>

      <BrochureStructure />
    </div>
  );
}
