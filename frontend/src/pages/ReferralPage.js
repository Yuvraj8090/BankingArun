import React, { useEffect, useState } from 'react';
import { Gift, Share2, Copy, Users, Wallet, MessageCircle, Twitter, Mail, RefreshCw, CheckCircle2 } from 'lucide-react';
import { api } from '../services/api';
import { toast } from 'sonner';

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
            <p className="text-sm text-white/85 mt-1">{data.reward_note}</p>
          </div>
          <div className="text-right">
            <div className="text-xs text-white/70">Total earned</div>
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
                  <tr key={r.id} className="hover:bg-slate-50">
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
    </div>
  );
}
