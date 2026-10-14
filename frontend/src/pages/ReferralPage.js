import React, { useEffect, useState } from 'react';
import { Gift, Share2, Copy, Users, MessageCircle, Twitter, Mail, RefreshCw, CheckCircle2, Info, Award } from 'lucide-react';
import { api } from '../services/api';
import MyStandingPage from './MyStandingPage';
import { toast } from 'sonner';

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
    const msg = encodeURIComponent(`Become a member of Aadhunik Jeewan Sanchay Nidhi (AJSPay): ${data.referral_link}`);
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
            <h1 className="text-2xl font-bold">My Network</h1>
            <p className="text-sm text-white/85 mt-1">{data.note}</p>
          </div>
          <div className="text-right">
            <div className="text-xs text-white/70">Introduced</div>
            <div className="text-2xl font-bold">{history?.count || 0}</div>
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
            { i: Award, t: 'Counted as your introduction', d: 'They show in your list and network below. No money is paid for an introduction.' }
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
                          {paid ? 'joined' : 'pending KYC'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="p-10 text-center text-xs text-slate-500">
              No one has joined via your link yet.
            </div>
          )}
        </div>
      </div>

      <NetworkTree />

      <MyStandingPage embedded />
    </div>
  );
}
