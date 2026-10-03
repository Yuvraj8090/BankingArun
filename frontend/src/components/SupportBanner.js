import React, { useState } from 'react';
import { Eye } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

// Shown on every screen for as long as a bank owner is viewing a member's
// account. The server refuses every write in this state (modules/impersonation.php),
// so this is a reminder and the way out, not the safeguard.
export default function SupportBanner() {
  const { user, impersonation } = useAuth();
  const [ending, setEnding] = useState(false);
  if (!impersonation?.active) return null;

  const end = async () => {
    setEnding(true);
    try {
      await api.impersonateStop();
      // The server swapped the session cookie back to the owner's; a reload
      // picks that up cleanly instead of patching half the app's state.
      window.location.assign('/');
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Could not end the support session');
      setEnding(false);
    }
  };

  return (
    <div data-testid="support-banner" className="bg-amber-500 text-slate-900 text-xs px-4 py-2 flex flex-wrap items-center justify-between gap-2">
      <span className="flex items-center gap-2 font-semibold">
        <Eye className="w-4 h-4" />
        Support session: you are viewing {user?.name || 'this member'}'s account as them, read only.
        <span className="font-normal">Nothing here can change it, and the session ends on its own after 15 minutes.</span>
      </span>
      <button data-testid="support-end-btn" onClick={end} disabled={ending}
        className="px-3 py-1 rounded bg-slate-900 text-white font-semibold disabled:opacity-60">
        {ending ? 'Ending…' : 'End support session'}
      </button>
    </div>
  );
}
