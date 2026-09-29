import React, { useEffect, useState } from 'react';
import { Gift, Share2, Copy, Users, Wallet, MessageCircle, Twitter, Mail, RefreshCw, CheckCircle2, Info, Award } from 'lucide-react';
import { api } from '../services/api';
import BoosterCard from '../components/BoosterCard';
import { inr } from '../utils/format';
import { toast } from 'sonner';

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
          <Info className="w-4 h-4 text-[#0b3b8c]" /> What the plan book states
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

        <div className="flex items-baseline gap-2 mt-4">
          <span className="text-[10px] font-bold text-slate-400">PART 1</span>
          <h3 className="text-sm font-semibold text-slate-900">Commission Structure</h3>
        </div>

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

        {/* Parts 2 and 3. The book numbers them as one structure, so showing
            only the commission table showed a third of it. */}
        {(data.programmes || []).map((prog) => (
          <div key={prog.code} className="pt-4 mt-4 border-t border-slate-100"
            data-testid={`programme-${prog.code}`}>
            <div className="flex items-baseline gap-2">
              {prog.part_no != null && (
                <span className="text-[10px] font-bold text-slate-400">PART {prog.part_no}</span>
              )}
              <h3 className="text-sm font-semibold text-slate-900">{prog.name}</h3>
            </div>
            {prog.headline && <p className="text-[11px] text-slate-700 mt-0.5">{prog.headline}</p>}
            {prog.qualifying_note && (
              <p className="text-[11px] text-slate-500 mt-1">{prog.qualifying_note}</p>
            )}
            {prog.slabs.length > 0 && (
              <div className="overflow-x-auto mt-2">
                <table className="w-full text-left text-xs min-w-[320px]">
                  <thead className="bg-slate-50 text-[10px] uppercase text-slate-600">
                    <tr>
                      <th className="p-2 font-semibold">Business in the year</th>
                      <th className="p-2 font-semibold text-right">What the book states</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {prog.slabs.map((sl) => (
                      <tr key={sl.position} className="hover:bg-slate-50">
                        <td className="p-2 text-slate-800">{sl.label}</td>
                        <td className="p-2 text-right text-slate-900 font-semibold">
                          {sl.payout_percent != null
                            ? `${sl.payout_percent}%`
                            : inr(sl.payout_amount)}
                          {sl.payout_note && (
                            <span className="font-normal text-slate-500"> {sl.payout_note}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {prog.source_note && (
              <p className="text-[10px] text-slate-400 mt-1">{prog.source_note}</p>
            )}
          </div>
        ))}

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

// A member-by-member view of who joined under whom, multiple levels deep --
// unlike the flat "Level 1: N members" pills above, this shows the actual
// names and how they connect, as an org-chart: circular nodes joined by
// connector lines, shaded darker at the root and lighter with each level.
// Visualisation only: no reward or commission is attached to it (see
// route_referral_structure's notice on why not).
function buildNetworkTree(root, nodes) {
  const byParent = {};
  nodes.forEach((n) => {
    (byParent[n.parent_id] = byParent[n.parent_id] || []).push(n);
  });
  const attach = (node) => ({ ...node, children: (byParent[node.id] || []).map(attach) });
  return attach(root);
}

const NODE_D = 44;
const NODE_R = NODE_D / 2;
const UNIT_W = 96;
const LEVEL_H = 96;
const LABEL_W = 92;
const DEPTH_COLORS = ['#0b3b8c', '#1e56b3', '#2f6fd8', '#4a8ef0', '#7db3f7', '#a8cdfa'];
const depthColor = (d) => DEPTH_COLORS[Math.min(d, DEPTH_COLORS.length - 1)];

// Assigns each node an x slot (in leaf-width units, post-order) and a depth,
// centering every parent over the midpoint of its own children -- the
// standard tidy-tree layout, kept deliberately simple since a referral tree
// here is small enough that it doesn't need collision-avoidance.
function layoutTree(root) {
  let cursor = 0;
  const placed = [];
  let maxDepth = 0;
  const visit = (node, depth) => {
    maxDepth = Math.max(maxDepth, depth);
    if (!node.children || node.children.length === 0) {
      const x = cursor;
      cursor += 1;
      placed.push({ node, depth, x });
      return x;
    }
    const xs = node.children.map((c) => visit(c, depth + 1));
    const x = (xs[0] + xs[xs.length - 1]) / 2;
    placed.push({ node, depth, x });
    return x;
  };
  visit(root, 0);
  return { placed, leafCount: cursor, maxDepth };
}

function NetworkTree() {
  const [tree, setTree] = useState(null);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    api.referralTree()
      .then((data) => {
        setTree(buildNetworkTree({ id: data.root.id, name: 'You', direct_count: data.root.direct_count }, data.nodes || []));
        setTotal(data.total_members || 0);
      })
      .catch(() => setTree(null));
  }, []);

  if (!tree) return null;
  const hasNetwork = tree.children?.length > 0;
  const { placed, leafCount, maxDepth } = hasNetwork ? layoutTree(tree) : { placed: [], leafCount: 1, maxDepth: 0 };
  const width = Math.max(leafCount, 1) * UNIT_W;
  const height = (maxDepth + 1) * LEVEL_H + 30;
  const byId = Object.fromEntries(placed.map((p) => [p.node.id, p]));
  const px = (p) => p.x * UNIT_W + UNIT_W / 2;
  const py = (p) => p.depth * LEVEL_H + NODE_R + 10;

  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-5" data-testid="referral-network-tree">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
          <Users className="w-4 h-4 text-[#0b3b8c]" /> Your Network
        </h2>
        <span className="text-[11px] text-slate-500">{total} member{total === 1 ? '' : 's'} in your tree</span>
      </div>
      {hasNetwork ? (
        <div className="overflow-x-auto">
          <div className="relative mx-auto" style={{ width, height }}>
            <svg className="absolute inset-0" width={width} height={height}>
              {placed.filter((p) => p.node.parent_id).map((p) => {
                const parent = byId[p.node.parent_id];
                if (!parent) return null;
                const x1 = px(parent), y1 = py(parent) + NODE_R;
                const x2 = px(p), y2 = py(p) - NODE_R;
                const midY = (y1 + y2) / 2;
                return (
                  <path key={p.node.id} d={`M${x1},${y1} C${x1},${midY} ${x2},${midY} ${x2},${y2}`}
                    fill="none" stroke="#cbd5e1" strokeWidth={2} />
                );
              })}
            </svg>
            {placed.map((p) => (
              <div key={p.node.id} className="absolute flex flex-col items-center"
                style={{ left: px(p) - LABEL_W / 2, top: py(p) - NODE_R, width: LABEL_W }}>
                <div className="rounded-full flex items-center justify-center text-white shadow-md ring-2 ring-white"
                  style={{ width: NODE_D, height: NODE_D, background: depthColor(p.depth) }}>
                  <Users className="w-5 h-5" />
                </div>
                <div className="mt-1.5 text-center">
                  <p className="text-[11px] font-semibold text-slate-900 truncate" style={{ maxWidth: LABEL_W }}>{p.node.name}</p>
                  {!!p.node.direct_count && (
                    <span className="inline-block mt-0.5 text-[9px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                      {p.node.direct_count} joined
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-xs text-slate-500">No one has joined under you yet — share your link to start your tree.</p>
      )}
    </div>
  );
}

export default function ReferralPage() {
  const [data, setData] = useState(null);
  const [history, setHistory] = useState({ referrals: [], total_earned: 0, count: 0 });
  const [standing, setStanding] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadReferrals = () => {
    setLoading(true);
    setError('');
    api.referralCode()
      .then(setData)
      .catch((e) => {
        const detail = e.response?.data?.detail || 'Failed to load referrals';
        setError(detail);
        toast.error(detail);
      })
      .finally(() => setLoading(false));
    api.referralHistory()
      .then(setHistory)
      .catch(() => setHistory({ referrals: [], total_earned: 0, count: 0 }));
    // Separate, and allowed to fail quietly: the ladders are worth showing here
    // but nobody came to this page to be told they could not be loaded.
    api.myStanding().then(setStanding).catch(() => setStanding(null));
  };

  useEffect(() => {
    loadReferrals();
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

  if (loading) return <div className="p-10 flex items-center gap-2 text-slate-600"><RefreshCw className="w-4 h-4 animate-spin" /> Loading referrals…</div>;
  if (!data) return (
    <div className="p-10 text-slate-600">
      <p className="text-sm font-semibold text-slate-900">Could not load referrals.</p>
      {error && <p className="mt-1 text-xs">{error}</p>}
      <button onClick={loadReferrals}
        className="mt-4 px-3 py-2 rounded-md bg-[#0b3b8c] hover:bg-[#092e6f] text-white text-xs font-semibold">
        Retry
      </button>
    </div>
  );

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
                  <th className="p-3 font-semibold">Contact</th>
                  <th className="p-3 font-semibold">Joined</th>
                  <th className="p-3 font-semibold">Status</th>
                  <th className="p-3 font-semibold text-right">Credit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {history.referrals.map(r => {
                  const paid = r.status === 'paid';
                  return (
                    <tr key={r.id} className="hover:bg-blue-50/40 transition-colors">
                      <td className="p-3 font-semibold text-slate-900">
                        {r.referee_name || <span className="text-slate-400">name not recorded</span>}
                      </td>
                      {/* Phone first: an email is optional for a member and most
                          do not have one, so an email column was usually blank. */}
                      <td className="p-3 text-slate-600">
                        {r.referee_phone || r.referee_email || <span className="text-slate-400">—</span>}
                        {r.referee_phone && r.referee_email && (
                          <span className="block text-[10px] text-slate-500">{r.referee_email}</span>
                        )}
                      </td>
                      <td className="p-3 text-slate-500">{new Date(r.created_at).toLocaleDateString('en-IN')}</td>
                      <td className="p-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border ${
                          paid
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-amber-50 text-amber-700 border-amber-200'
                        }`}>
                          {paid ? <CheckCircle2 className="w-2.5 h-2.5" /> : <Info className="w-2.5 h-2.5" />}
                          {paid ? 'paid' : 'pending KYC'}
                        </span>
                      </td>
                      <td className={`p-3 text-right font-bold ${paid ? 'text-emerald-700' : 'text-slate-500'}`}>
                        {paid ? `₹${r.credit_amount.toLocaleString('en-IN')}` : 'After KYC'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="p-10 text-center text-xs text-slate-500">
              No one has joined via your link yet. Share above to start earning!
            </div>
          )}
        </div>
      </div>

      <NetworkTree />

      {standing && (
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-5" data-testid="referral-standing">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
            <Award className="w-3.5 h-3.5 text-[#0b3b8c]" /> Your standing
          </div>
          <p className="text-xl font-bold text-slate-900 mt-1">
            {standing.standing || 'Not yet on the ladder'}
          </p>
          {standing.next && (
            <p className="text-[11px] text-slate-600 mt-1">{standing.next.step}</p>
          )}
          <p className="text-[11px] text-slate-500 mt-2">{standing.note}</p>
        </div>
      )}

      <BoosterCard booster={standing?.booster} />

      <BrochureStructure />
    </div>
  );
}
