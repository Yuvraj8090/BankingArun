import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  Building2, ShieldCheck, LogOut, Bell, ChevronDown, FileText, Lock, Compass, HelpCircle } from 'lucide-react';
import Brand from './Brand';
import GlobalSearch from './GlobalSearch';
import { GuideButton } from './HelpGuide';
import { ROLE_HOME } from '../navigation';

const ROLE_BADGE = {
  retail: { label: 'Customer', color: 'bg-blue-50 text-[#0b3b8c] border-blue-200' },
  corporate: { label: 'Corporate', color: 'bg-purple-50 text-purple-700 border-purple-200' },
  admin: { label: 'Branch Manager', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  branch_manager: { label: 'Branch Manager', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  bank_owner: { label: 'Director', color: 'bg-[#0b3b8c] text-white border-[#0b3b8c]' },
  staff: { label: 'Staff', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  collection_agent: { label: 'Collections', color: 'bg-rose-50 text-[#c8102e] border-rose-200' },
  loan_officer: { label: 'Loan Officer', color: 'bg-indigo-50 text-[#0b3b8c] border-indigo-200' }
};

export default function Navbar({ onNavigate, activeTab }) {
  const { user, logout, features } = useAuth();
  const [showMenu, setShowMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const badge = ROLE_BADGE[user?.role] || ROLE_BADGE.retail;
  const notifications = [
    activeTab === 'collection'
      ? ['Collection follow-up due', 'Review active recovery cases']
      : activeTab === 'loan-dept'
      ? ['Loan pipeline updated', 'Applications are waiting for decision']
      : ['Security reminder', 'Review pending dashboard actions'],
    ['Session protected', 'Encrypted member portal session is active']
  ];

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-40 shadow-sm">
      <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-4">

          {/* Brand */}
          <button
            className="flex items-center gap-3 shrink-0"
            onClick={() => onNavigate(ROLE_HOME[user?.role] || 'dashboard')}
            data-testid="bank-logo-btn"
          >
            <Brand variant="compact" height={34} />
          </button>

          {/* Search */}
          <div className="flex-1 max-w-md hidden md:flex">
            <GlobalSearch role={user?.role} features={features} onNavigate={onNavigate} />
          </div>

          {/* Right */}
          <div className="flex items-center gap-2">
            {user && activeTab && <GuideButton tab={activeTab} role={user.role} onOpenHelp={() => onNavigate('help')} />}
            <div className="relative">
              <button
                data-testid="notification-bell-btn"
                aria-label="Open notifications"
                aria-expanded={showNotifications}
                onClick={() => { setShowNotifications(v => !v); setShowMenu(false); }}
                className="relative p-2 rounded-md hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-[#0b3b8c]/25 active:scale-95 text-slate-600 transition"
              >
                <Bell className="w-4 h-4" />
                <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-[#c8102e] rounded-full" />
              </button>
              {showNotifications && (
                <div className="absolute right-0 mt-2 w-72 bg-white border border-slate-200 rounded-md shadow-lg p-2 z-50" data-testid="notification-dropdown">
                  <div className="px-3 py-2 border-b border-slate-100">
                    <p className="font-semibold text-slate-900 text-sm">Notifications</p>
                    <p className="text-[11px] text-slate-500">Latest portal alerts</p>
                  </div>
                  <div className="py-1">
                    {notifications.map(([title, detail]) => (
                      <button key={title} className="w-full text-left px-3 py-2 rounded hover:bg-slate-50 focus:outline-none focus:bg-slate-50 transition">
                        <span className="block text-xs font-semibold text-slate-800">{title}</span>
                        <span className="block text-[11px] text-slate-500 mt-0.5">{detail}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {user && (
              <div className="relative">
                <button
                  data-testid="user-profile-menu-btn"
                  onClick={() => { setShowMenu(!showMenu); setShowNotifications(false); }}
                  className="flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-md border border-slate-200 hover:border-[#0b3b8c] focus:outline-none focus:ring-2 focus:ring-[#0b3b8c]/25 active:scale-[0.98] text-xs transition bg-white"
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
                  <ChevronDown className="w-3 h-3 text-slate-500" />
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
                      <button
                        data-testid="profile-restart-tour-btn"
                        onClick={() => {
                          // AppShell owns the tour; tell it to start again.
                          window.dispatchEvent(new CustomEvent('ajspay:restart-tour'));
                          setShowMenu(false);
                        }}
                        className="w-full text-left px-3 py-2 rounded hover:bg-slate-50 text-slate-700 text-xs flex items-center gap-2"
                      >
                        <Compass className="w-3.5 h-3.5 text-[#0b3b8c]" /> Restart the tour
                      </button>
                      <button
                        data-testid="profile-help-btn"
                        onClick={() => { onNavigate('help'); setShowMenu(false); }}
                        className="w-full text-left px-3 py-2 rounded hover:bg-slate-50 text-slate-700 text-xs flex items-center gap-2"
                      >
                        <HelpCircle className="w-3.5 h-3.5 text-[#0b3b8c]" /> Help Centre
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
