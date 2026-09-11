import React, { useState } from 'react';
import {
  Building2, ShieldCheck, Lock, UserPlus, Phone, MapPin, ChevronDown,
  Menu, X, Search
} from 'lucide-react';

export default function PublicNavbar({ onOpenAuth, onNavigatePublic, activePublicTab }) {
  const [showMobile, setShowMobile] = useState(false);
  const [openMenu, setOpenMenu] = useState(null);

  const navGroups = [
    {
      key: 'personal',
      label: 'Personal',
      items: ['Savings Account', 'Salary Account', 'Fixed Deposits', 'Recurring Deposit', 'Debit Cards']
    },
    {
      key: 'corporate',
      label: 'Corporate',
      items: ['Current Account', 'Bulk NEFT / RTGS', 'Trade Finance', 'Payroll Services']
    },
    {
      key: 'loans',
      label: 'Loans',
      items: ['Home Loan', 'Personal Loan', 'Vehicle Loan', 'Gold Loan', 'Education Loan']
    },
    {
      key: 'invest',
      label: 'Investments',
      items: ['Mutual Funds', 'Fixed Deposits', 'Sovereign Gold Bonds', 'Insurance']
    }
  ];

  const primaryNavBtn = (id, label, tab) => (
    <button
      key={tab}
      data-testid={id}
      onClick={() => onNavigatePublic(tab)}
      className={`px-3 py-1.5 text-xs font-medium transition ${
        activePublicTab === tab
          ? 'text-blue-800 border-b-2 border-blue-800'
          : 'text-slate-700 hover:text-blue-800'
      }`}
    >
      {label}
    </button>
  );

  return (
    <header className="bg-white shadow-sm sticky top-0 z-40 border-b border-slate-200">

      {/* Top utility strip */}
      <div className="bg-slate-900 text-slate-200 text-[11px]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-8 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <span className="hidden sm:inline">RBI Master Direction Compliant Core Banking</span>
            <span className="hidden md:inline text-slate-400">|</span>
            <span className="hidden md:inline">DICGC Insured up to ₹5 Lakh</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden sm:flex items-center gap-1"><Phone className="w-3 h-3" /> 1800-123-4567</span>
            <button
              data-testid="public-nav-locator"
              onClick={() => onNavigatePublic('branches')}
              className="flex items-center gap-1 hover:text-white"
            >
              <MapPin className="w-3 h-3" /> Locate Us
            </button>
          </div>
        </div>
      </div>

      {/* Main brand + CTA row */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div
            className="flex items-center gap-3 cursor-pointer"
            onClick={() => onNavigatePublic('home')}
            data-testid="public-bank-logo-btn"
          >
            <div className="w-11 h-11 rounded-md bg-[#0b3b8c] flex items-center justify-center">
              <Building2 className="w-6 h-6 text-white" />
            </div>
            <div className="leading-tight">
              <div className="font-bold text-lg text-slate-900 tracking-tight">
                AJSPay
              </div>
              <div className="text-[10px] text-slate-500 flex items-center gap-1">
                <ShieldCheck className="w-3 h-3 text-emerald-600" /> Secure digital banking
              </div>
            </div>
          </div>

          {/* Search bar */}
          <div className="hidden lg:flex flex-1 max-w-md mx-8">
            <div className="w-full flex items-center border border-slate-300 rounded-md px-3 h-9 focus-within:border-blue-800">
              <Search className="w-4 h-4 text-slate-400" />
              <input
                data-testid="public-search-input"
                type="text"
                placeholder="Search products, services, FAQs…"
                className="flex-1 bg-transparent text-xs px-2 outline-none placeholder:text-slate-400"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              data-testid="public-open-account-cta"
              onClick={() => onOpenAuth(true)}
              className="hidden md:inline-flex px-4 py-2 rounded-md border border-[#0b3b8c] text-[#0b3b8c] text-xs font-semibold hover:bg-[#0b3b8c] hover:text-white transition items-center gap-1.5"
            >
              <UserPlus className="w-3.5 h-3.5" /> Open Account
            </button>
            <button
              data-testid="public-login-cta"
              onClick={() => onOpenAuth(false)}
              className="px-4 py-2 rounded-md bg-[#c8102e] hover:bg-[#a30d25] text-white text-xs font-semibold flex items-center gap-1.5"
            >
              <Lock className="w-3.5 h-3.5" /> Login
            </button>
            <button
              onClick={() => setShowMobile(!showMobile)}
              className="md:hidden p-2 rounded text-slate-700"
              data-testid="public-mobile-toggle"
            >
              {showMobile ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Bottom nav — sticky category menu */}
        <nav className="hidden md:flex items-center gap-1 h-11 border-t border-slate-100">
          {primaryNavBtn('public-nav-home', 'Home', 'home')}
          {navGroups.map(g => (
            <div
              key={g.key}
              className="relative"
              onMouseEnter={() => setOpenMenu(g.key)}
              onMouseLeave={() => setOpenMenu(null)}
            >
              <button
                data-testid={`public-nav-${g.key}`}
                className={`px-3 py-1.5 text-xs font-medium flex items-center gap-1 transition ${
                  openMenu === g.key ? 'text-blue-800' : 'text-slate-700 hover:text-blue-800'
                }`}
              >
                {g.label} <ChevronDown className="w-3 h-3" />
              </button>
              {openMenu === g.key && (
                <div className="absolute left-0 top-full w-56 bg-white border border-slate-200 shadow-lg rounded-md py-2 z-30">
                  {g.items.map(it => (
                    <button
                      key={it}
                      onClick={() => onOpenAuth(true)}
                      className="w-full text-left px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 hover:text-blue-800"
                    >
                      {it}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          {primaryNavBtn('public-nav-rates', 'Rates & Charges', 'rates')}
          {primaryNavBtn('public-nav-branches', 'Branch & ATM', 'branches')}
          <button
            data-testid="public-nav-hostinger"
            onClick={() => onNavigatePublic('hostinger')}
            className={`ml-auto px-3 py-1.5 text-xs font-semibold rounded-md ${
              activePublicTab === 'hostinger'
                ? 'bg-blue-50 text-blue-800 border border-blue-200'
                : 'text-slate-600 hover:text-blue-800'
            }`}
          >
            Hostinger Package
          </button>
        </nav>
      </div>

      {/* Mobile menu */}
      {showMobile && (
        <div className="md:hidden bg-white border-t border-slate-200 px-4 py-3 space-y-1 text-sm">
          {['home', 'rates', 'branches', 'hostinger'].map(t => (
            <button
              key={t}
              onClick={() => { onNavigatePublic(t); setShowMobile(false); }}
              className="w-full text-left px-3 py-2 rounded hover:bg-slate-50 capitalize text-slate-700"
              data-testid={`mobile-nav-${t}`}
            >
              {t}
            </button>
          ))}
        </div>
      )}
    </header>
  );
}
