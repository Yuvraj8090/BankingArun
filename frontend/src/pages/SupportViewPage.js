import React, { useEffect, useState } from 'react';
import { Eye, Search, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../services/api';

// Bank owner only (the menu entry and the server both enforce it). Opens a
// member's account exactly as they see it, read only -- for working out what
// went wrong on a support call. Administrator accounts are refused server-side.
export default function SupportViewPage() {
  const [query, setQuery] = useState('');
  const [members, setMembers] = useState(null);
  const [reason, setReason] = useState('');
  const [openingId, setOpeningId] = useState('');

  useEffect(() => {
    const t = setTimeout(async () => {
      try { setMembers((await api.impersonateCandidates({ q: query.trim() || undefined })).members); }
      catch (err) { toast.error(err.response?.data?.detail || 'Could not load members'); }
    }, query ? 300 : 0);
    return () => clearTimeout(t);
  }, [query]);

  const open = async (member) => {
    if (reason.trim().length < 8) {
      toast.error('Write why you are opening this account first (at least a few words). It goes in the audit log and on the member\'s own record.');
      return;
    }
    setOpeningId(member.id);
    try {
      await api.impersonateStart({ user_id: member.id, reason: reason.trim() });
      // The server set the session cookie for the member's read-only view.
      window.location.assign('/');
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Could not open this account');
      setOpeningId('');
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-5">
      <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm flex items-start gap-3">
        <div className="w-10 h-10 rounded-md bg-[#0b3b8c] text-white flex items-center justify-center shrink-0"><Eye className="w-5 h-5" /></div>
        <div>
          <h1 className="text-xl font-bold text-slate-900">View as Member</h1>
          <p className="text-xs text-slate-500 mt-1">
            See the app exactly as a member sees it. It is <strong>read only</strong>: you can look, but cannot change
            anything or move money. It ends after 15 minutes, is written to the audit log and to the member's own
            record, and administrator accounts cannot be opened.
          </p>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm space-y-3">
        <label className="block text-[11px] font-semibold text-slate-700">Why are you opening this account? (required)</label>
        <input data-testid="support-reason" value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Member says their daily interest is not showing — checking their Deposits page"
          className="w-full px-3 py-2 rounded-md border border-slate-200 text-xs" />
        <div className="relative max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input data-testid="support-search" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search members by name or email"
            className="w-full pl-9 pr-3 py-2 rounded-md border border-slate-200 text-xs" />
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-x-auto">
        {!members ? (
          <p className="p-6 text-xs text-slate-500 flex items-center gap-2"><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Loading members…</p>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[11px] uppercase text-slate-600">
              <tr>
                <th className="p-3 font-semibold">Member</th>
                <th className="p-3 font-semibold">Email</th>
                <th className="p-3 font-semibold">Type</th>
                <th className="p-3 font-semibold">KYC</th>
                <th className="p-3 font-semibold text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {members.map((m) => (
                <tr key={m.id} data-testid={`support-member-${m.id}`}>
                  <td className="p-3 font-semibold text-slate-900">{m.name}</td>
                  <td className="p-3 text-slate-600">{m.email || '—'}</td>
                  <td className="p-3 text-slate-600">{m.role}</td>
                  <td className="p-3 text-slate-600">{m.kyc_status}</td>
                  <td className="p-3 text-right">
                    <button data-testid={`support-open-${m.id}`} onClick={() => open(m)} disabled={openingId === m.id}
                      className="text-[#0b3b8c] font-semibold hover:underline disabled:opacity-50">
                      {openingId === m.id ? 'Opening…' : 'Open read-only'}
                    </button>
                  </td>
                </tr>
              ))}
              {!members.length && <tr><td colSpan={5} className="p-6 text-center text-slate-500">No members match.</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
