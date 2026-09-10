import React, { useEffect, useState } from 'react';
import { Video, CheckCircle2, XCircle, RefreshCw, User, CreditCard, FileText, Clock, Eye } from 'lucide-react';
import { api } from '../services/api';
import { toast } from 'sonner';

export default function VideoKycQueuePage() {
  const [items, setItems] = useState([]);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reason, setReason] = useState('');

  const load = async () => {
    try { const r = await api.kycQueue(); setItems(r.submissions || []); }
    catch { toast.error('Failed to load queue'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const viewDetail = async (id) => {
    try { const d = await api.kycDetail(id); setDetail(d); }
    catch { toast.error('Failed to load submission'); }
  };

  const decide = async (id, decision) => {
    try {
      await api.kycDecision({ submission_id: id, decision, reason: decision === 'reject' ? reason : null });
      toast.success(`KYC ${decision}d`);
      setDetail(null); setReason(''); load();
    } catch { toast.error('Action failed'); }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-md bg-[#0b3b8c] flex items-center justify-center"><Video className="w-5 h-5 text-white" /></div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Video KYC Verification Queue</h1>
            <p className="text-xs text-slate-500">Review customer selfie + PAN + Aadhaar submissions</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-lg shadow-sm">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Pending ({items.length})</h2>
            <button onClick={load} data-testid="vkyc-refresh"
              className="p-1.5 rounded hover:bg-slate-100"><RefreshCw className="w-3.5 h-3.5 text-slate-500" /></button>
          </div>
          <div className="max-h-[70vh] overflow-y-auto">
            {loading ? <div className="p-6 text-xs text-slate-500">Loading…</div> :
              items.length === 0 ? <div className="p-8 text-xs text-slate-500 text-center">No pending submissions</div> :
              items.map(it => (
                <button key={it.id} data-testid={`vkyc-item-${it.id}`}
                  onClick={() => viewDetail(it.id)}
                  className={`w-full text-left p-4 border-b border-slate-100 hover:bg-slate-50 transition ${detail?.id === it.id ? 'bg-blue-50' : ''}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">{it.user_name}</div>
                      <div className="text-[11px] text-slate-500">{it.user_email}</div>
                    </div>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                      <Clock className="w-2.5 h-2.5" /> Pending
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1">{new Date(it.submitted_at).toLocaleString('en-IN')}</div>
                </button>
              ))
            }
          </div>
        </div>

        <div className="lg:col-span-3 bg-white border border-slate-200 rounded-lg shadow-sm">
          {!detail ? (
            <div className="p-16 text-center text-xs text-slate-500 space-y-2">
              <Eye className="w-8 h-8 mx-auto text-slate-300" />
              <p>Select a submission on the left to review</p>
            </div>
          ) : (
            <div className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">{detail.user_name}</h3>
                  <p className="text-[11px] text-slate-500">{detail.user_email}</p>
                </div>
                <span className="text-[10px] text-slate-400">Submitted {new Date(detail.submitted_at).toLocaleString('en-IN')}</span>
              </div>

              {detail.liveness_words && (
                <div className="p-3 rounded-md bg-blue-50 border border-blue-100 text-xs text-slate-700">
                  Liveness word: <b className="text-[#c8102e] font-mono">{detail.liveness_words}</b>
                </div>
              )}

              <div className="grid grid-cols-3 gap-3">
                {[
                  { k: 'selfie_b64', l: 'Selfie', icon: User },
                  { k: 'pan_b64', l: 'PAN Card', icon: CreditCard },
                  { k: 'aadhaar_b64', l: 'Aadhaar', icon: FileText }
                ].map(x => (
                  <div key={x.k}>
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-700 mb-1">
                      <x.icon className="w-3 h-3 text-[#0b3b8c]" /> {x.l}
                    </div>
                    <img alt={x.l} src={detail[x.k]} className="w-full h-40 object-cover rounded border border-slate-200" />
                  </div>
                ))}
              </div>

              <div className="pt-3 border-t border-slate-100 space-y-2">
                <input value={reason} onChange={e => setReason(e.target.value)} data-testid="vkyc-reason"
                  placeholder="Rejection reason (if any)"
                  className="w-full border border-slate-200 rounded-md px-3 py-2 text-xs" />
                <div className="flex gap-2">
                  <button data-testid={`vkyc-approve-${detail.id}`} onClick={() => decide(detail.id, 'approve')}
                    className="flex-1 py-2.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center justify-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Approve
                  </button>
                  <button data-testid={`vkyc-reject-${detail.id}`} onClick={() => decide(detail.id, 'reject')}
                    className="flex-1 py-2.5 rounded-md border border-[#c8102e] text-[#c8102e] hover:bg-[#c8102e] hover:text-white text-xs font-semibold flex items-center justify-center gap-2 transition">
                    <XCircle className="w-3.5 h-3.5" /> Reject
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
