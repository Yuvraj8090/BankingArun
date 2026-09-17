import React, { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Lock, UserPlus, Phone, MapPin, ChevronDown, Menu, X } from 'lucide-react';
import Brand from './Brand';
import PublicSearch from './PublicSearch';

// Every entry here is a real route, so each product has its own shareable URL.
const NAV_GROUPS = [
  {
    key: 'personal',
    label: 'Personal',
    items: [
      ['Savings Account', '/personal/savings-account'],
      ['Salary Account', '/personal/salary-account'],
      ['Fixed Deposits', '/personal/fixed-deposits'],
      ['Recurring Deposit', '/personal/recurring-deposit'],
      ['Debit Cards', '/personal/debit-cards']
    ]
  },
  {
    key: 'corporate',
    label: 'Corporate',
    items: [
      ['Current Account', '/corporate/current-account'],
      ['Bulk NEFT / RTGS', '/corporate/bulk-neft-rtgs'],
      ['Trade Finance', '/corporate/trade-finance'],
      ['Payroll Services', '/corporate/payroll-services'],
      ['Cash Management', '/corporate/cash-management']
    ]
  },
  {
    key: 'loans',
    label: 'Loans',
    items: [
      ['Home Loan', '/loans/home-loan'],
      ['Personal Loan', '/loans/personal-loan'],
      ['Vehicle Loan', '/loans/vehicle-loan'],
      ['Gold Loan', '/loans/gold-loan'],
      ['Education Loan', '/loans/education-loan']
    ]
  },
  {
    key: 'invest',
    label: 'Investments',
    items: [
      ['Mutual Funds', '/investments/mutual-funds'],
      ['Fixed Deposits', '/personal/fixed-deposits'],
      ['Sovereign Gold Bonds', '/investments/sovereign-gold-bonds'],
      ['Insurance', '/investments/insurance']
    ]
  }
];

const TOP_LINKS = [
  ['Home', '/', 'public-nav-home'],
  ['Rates & Charges', '/rates', 'public-nav-rates'],
  ['Branch & ATM', '/branches', 'public-nav-branches']
];

const linkClass = ({ isActive }) =>
  `px-3 py-1.5 text-xs font-medium transition ${
    isActive ? 'text-blue-800 border-b-2 border-blue-800' : 'text-slate-700 hover:text-blue-800'
  }`;

export default function PublicNavbar() {
  const [showMobile, setShowMobile] = useState(false);
  const [openMenu, setOpenMenu] = useState(null);

  return (
    <header className="bg-white shadow-sm sticky top-0 z-40 border-b border-slate-200">
      {/* Top utility strip */}
      <div className="bg-white text-slate-700 text-[11px]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-8 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <span className="hidden sm:inline">Trust · Growth · Prosperity</span>
            <span className="hidden md:inline text-slate-500">|</span>
            <span className="hidden md:inline">Video KYC · Passkey sign-in · 24×7 transfers</span>
          </div>
          <div className="flex items-center gap-4">
            <a href="tel:9105015464" className="hidden sm:flex items-center gap-1 hover:text-white">
              <Phone className="w-3 h-3" /> 9105015464
            </a>
            <Link to="/branches" data-testid="public-nav-locator" className="flex items-center gap-1 hover:text-white">
              <MapPin className="w-3 h-3" /> Locate Us
            </Link>
          </div>
        </div>
      </div>

      {/* Brand + CTA row */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-4">
          <Link to="/" data-testid="public-bank-logo-btn" className="shrink-0">
            <Brand variant="compact" height={38} />
          </Link>

          <div className="hidden lg:flex flex-1 max-w-md">
            <PublicSearch />
          </div>

          <div className="flex items-center gap-2">
            <Link
              to="/open-account"
              data-testid="public-open-account-cta"
              className="hidden md:inline-flex px-4 py-2 rounded-md border border-[#0b3b8c] text-[#0b3b8c] text-xs font-semibold hover:bg-[#0b3b8c] hover:text-white transition items-center gap-1.5"
            >
              <UserPlus className="w-3.5 h-3.5" /> Open Account
            </Link>
            <Link
              to="/login"
              data-testid="public-login-cta"
              className="px-4 py-2 rounded-md bg-[#c8102e] hover:bg-[#a30d25] text-white text-xs font-semibold flex items-center gap-1.5"
            >
              <Lock className="w-3.5 h-3.5" /> Login
            </Link>
            <button
              onClick={() => setShowMobile(!showMobile)}
              className="md:hidden p-2 rounded text-slate-700"
              data-testid="public-mobile-toggle"
              aria-label="Toggle menu"
            >
              {showMobile ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Category menu */}
        <nav className="hidden md:flex items-center gap-1 h-11 border-t border-slate-100">
          {TOP_LINKS.map(([label, to, testId]) => (
            <NavLink key={to} to={to} end={to === '/'} data-testid={testId} className={linkClass}>
              {label}
            </NavLink>
          ))}
          {NAV_GROUPS.map((group) => (
            <div
              key={group.key}
              className="relative"
              onMouseEnter={() => setOpenMenu(group.key)}
              onMouseLeave={() => setOpenMenu(null)}
            >
              <button
                data-testid={`public-nav-${group.key}`}
                className={`px-3 py-1.5 text-xs font-medium flex items-center gap-1 transition ${
                  openMenu === group.key ? 'text-blue-800' : 'text-slate-700 hover:text-blue-800'
                }`}
              >
                {group.label} <ChevronDown className="w-3 h-3" />
              </button>
              {openMenu === group.key && (
                <div className="absolute left-0 top-full w-56 bg-white border border-slate-200 shadow-lg rounded-md py-2 z-30">
                  {group.items.map(([label, to]) => (
                    <Link
                      key={to}
                      to={to}
                      onClick={() => setOpenMenu(null)}
                      className="block px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 hover:text-blue-800"
                    >
                      {label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>
      </div>

      {/* Mobile menu */}
      {showMobile && (
        <div className="md:hidden bg-white border-t border-slate-200 px-4 py-3 space-y-1 text-sm max-h-[70vh] overflow-y-auto">
          {TOP_LINKS.map(([label, to]) => (
            <Link
              key={to}
              to={to}
              onClick={() => setShowMobile(false)}
              className="block px-3 py-2 rounded hover:bg-slate-50 text-slate-700"
              data-testid={`mobile-nav-${to.replace('/', '') || 'home'}`}
            >
              {label}
            </Link>
          ))}
          {NAV_GROUPS.map((group) => (
            <div key={group.key} className="pt-2">
              <p className="px-3 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{group.label}</p>
              {group.items.map(([label, to]) => (
                <Link
                  key={to}
                  to={to}
                  onClick={() => setShowMobile(false)}
                  className="block px-3 py-2 rounded hover:bg-slate-50 text-slate-700"
                >
                  {label}
                </Link>
              ))}
            </div>
          ))}
        </div>
      )}
    </header>
  );
}
