import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  Building2, ShieldCheck, LogOut, Bell, ChevronDown, FileText, Lock, Search
} from 'lucide-react';

const ROLE_BADGE = {
  retail: { label: 'Customer', color: 'bg-blue-50 text-[#0b3b8c] border-blue-200' },
  corporate: { label: 'Corporate', color: 'bg-purple-50 text-purple-700 border-purple-200' },
  admin: { label: 'Branch Manager', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  branch_manager: { label: 'Branch Manager', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  bank_owner: { label: 'Bank Owner', color: 'bg-slate-900 text-white border-slate-900' },
  staff: { label: 'Staff', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  collection_agent: { label: 'Collections', color: 'bg-rose-50 text-[#c8102e] border-rose-200' },
  loan_officer: { label: 'Loan Officer', color: 'bg-indigo-50 text-indigo-700 border-indigo-200' }
};

export default function Navbar({ onNavigate, activeTab }) {
  const { user, logout } = useAuth();
  const [showMenu, setShowMenu] = useState(false);
  const badge = ROLE_BADGE[user?.role] || ROLE_BADGE.retail;

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-40 shadow-sm">
      <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-4">

          {/* Brand */}
          <div
            className="flex items-center gap-3 cursor-pointer shrink-0"
            onClick={() => onNavigate(user?.role === 'bank_owner' ? 'owner' : user?.role === 'retail' || user?.role === 'corporate' ? 'dashboard' : 'admin')}
            data-testid="bank-logo-btn"
          >
            <div className="w-10 h-10 rounded-md bg-[#0b3b8c] flex items-center justify-center">
              <Building2 className="w-5 h-5 text-white" />
            </div>
            <div className="leading-tight hidden sm:block">
              <div className="font-bold text-base text-slate-900">
                National <span className="text-[#c8102e]">Bharat</span> Bank
              </div>
              <div className="text-[10px] text-slate-500 flex items-center gap-1">
                <ShieldCheck className="w-3 h-3 text-emerald-600" /> Secure NetBanking
              </div>
            </div>
          </div>

          {/* Search */}
          <div className="flex-1 max-w-md hidden md:flex">
            <div className="w-full flex items-center border border-slate-200 rounded-md px-3 h-9 focus-within:border-[#0b3b8c] bg-slate-50">
              <Search className="w-4 h-4 text-slate-400" />
              <input
                data-testid="global-search"
                placeholder="Search payees, transactions, services…"
                className="flex-1 bg-transparent text-xs px-2 outline-none placeholder:text-slate-400"
              />
            </div>
          </div>

          {/* Right */}
          <div className="flex items-center gap-2">
            <button data-testid="notification-bell-btn" className="relative p-2 rounded-md hover:bg-slate-100 text-slate-600">
              <Bell className="w-4 h-4" />
              <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-[#c8102e] rounded-full" />
            </button>

            {user && (
              <div className="relative">
                <button
                  data-testid="user-profile-menu-btn"
                  onClick={() => setShowMenu(!showMenu)}
                  className="flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-md border border-slate-200 hover:border-[#0b3b8c] text-xs transition bg-white"
                >
                  <div className="w-7 h-7 rounded-full bg-[#0b3b8c] text-white flex items-center justify-center font-bold text-[11px]">
                    {user.name ? user.name[0].toUpperCase() : 'U'}
                  </div>
                  <div className="text-left hidden md:block">
                    <p className="font-semibold text-slate-900 leading-tight text-[12px]">{user.name?.split(' ')[0]}</p>
                    <span className={`inline-block text-[9px] font-semibold px-1.5 py-0.5 rounded border ${badge.color}`}>
                      {badge.label}
                    </span>
                  </div>
                  <ChevronDown className="w-3 h-3 text-slate-400" />
                </button>

                {showMenu && (
                  <div className="absolute right-0 mt-2 w-64 bg-white border border-slate-200 rounded-md shadow-lg p-2 z-50" data-testid="user-dropdown">
                    <div className="px-3 py-2 border-b border-slate-100">
                      <p className="font-semibold text-slate-900 text-sm">{user.name}</p>
                      <p className="text-[11px] text-slate-500 truncate">{user.email}</p>
                      <div className="mt-1 flex items-center gap-1 text-[10px] text-emerald-700">
                        <ShieldCheck className="w-3 h-3" /> KYC: {user.kyc_status?.toUpperCase() || 'VERIFIED'}
                      </div>
                    </div>
                    <div className="py-1">
                      <button
                        data-testid="profile-kyc-btn"
                        onClick={() => { onNavigate('kyc'); setShowMenu(false); }}
                        className="w-full text-left px-3 py-2 rounded hover:bg-slate-50 text-slate-700 text-xs flex items-center gap-2"
                      >
                        <FileText className="w-3.5 h-3.5 text-[#0b3b8c]" /> Profile &amp; KYC
                      </button>
                    </div>
                    <div className="pt-1 border-t border-slate-100">
                      <button
                        data-testid="logout-btn"
                        onClick={() => { logout(); setShowMenu(false); }}
                        className="w-full text-left px-3 py-2 rounded hover:bg-red-50 text-[#c8102e] text-xs flex items-center gap-2 font-medium"
                      >
                        <LogOut className="w-3.5 h-3.5" /> Secure Logout
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
