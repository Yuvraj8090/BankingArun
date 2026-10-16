import React from 'react';
import { HeadphonesIcon, HelpCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { navFor, ROLE_LABEL } from '../navigation';
import { COMPANY } from '../data/company';

export default function Sidebar({ activeTab, onSelectTab }) {
  const { user, features } = useAuth();
  const role = user?.role || 'retail';
  const navItems = navFor(role, features);

  // Stacked above the content on a phone, a column beside it from md up. The
  // full height and the fixed width only apply once it is a column: on a phone
  // they made every screen open on a screenful of menu, with the page itself a
  // scroll away.
  return (
    <aside className="w-full md:w-64 bg-white border-b md:border-b-0 md:border-r border-slate-200 flex flex-col justify-between p-3 md:p-4 shrink-0 md:min-h-[calc(100vh-4rem)]">
      <div className="flex md:block gap-1.5 md:gap-0 md:space-y-1 overflow-x-auto md:overflow-x-visible -mx-1 px-1 md:mx-0 md:px-0">
        <div className="hidden md:flex px-3 py-2 items-center gap-2">
          <div className="w-1 h-4 bg-[#0b3b8c] rounded" />
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
            {ROLE_LABEL[role] || 'Banking'} Menu
          </p>
        </div>

        {navItems.map((item, i) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          const heading = item.group && item.group !== navItems[i - 1]?.group;
          return (
            <React.Fragment key={item.id}>
            {heading && (
              <p className="hidden md:block px-3 pt-3 pb-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{item.group}</p>
            )}
            <button
              data-testid={item.testId}
              onClick={() => onSelectTab(item.id)}
              className={`shrink-0 md:w-full flex items-center gap-2 md:gap-3 px-3 md:px-3.5 py-2 md:py-2.5 rounded-md text-xs font-medium transition whitespace-nowrap ${
                isActive
                  ? 'bg-[#0b3b8c] text-white shadow-sm font-semibold'
                  : item.highlight
                  ? 'bg-blue-50 text-[#0b3b8c] border border-blue-100 hover:bg-blue-100'
                  : 'text-slate-700 hover:text-[#0b3b8c] hover:bg-slate-50'
              }`}
            >
              {/* The icon follows the button's own text colour. The active tab is
                  white on navy, and a near-black icon there reads as missing. */}
              <Icon className={`w-4 h-4 ${isActive ? 'text-white' : item.highlight ? 'text-[#0b3b8c]' : 'text-slate-500'}`} />
              <span className="truncate">{item.label}</span>
            </button>
            </React.Fragment>
          );
        })}
      </div>

      {/* Support card */}
      <div className="hidden md:block mt-6 p-3 rounded-md bg-slate-50 border border-slate-200 text-slate-700 text-[11px] space-y-2">
        <div className="flex items-center gap-2 text-[#0b3b8c] font-semibold">
          <HeadphonesIcon className="w-3.5 h-3.5" /> 24×7 Member Help
        </div>
        <p className="text-slate-600">Helpline: <strong className="text-slate-900">{COMPANY.phone}</strong></p>
        <p className="text-slate-600">Cyber Fraud: <strong className="text-[#c8102e]">1930</strong></p>
        <button type="button" data-testid="sidebar-help-btn" onClick={() => onSelectTab('help')}
          className="flex items-center gap-1.5 text-[#0b3b8c] font-semibold hover:underline">
          <HelpCircle className="w-3.5 h-3.5" /> Help Centre &amp; guides
        </button>
        <div className="pt-2 border-t border-slate-200 flex items-center justify-between text-[10px] text-slate-500">
          <span>Session Active</span>
          <span className="flex items-center gap-1 text-emerald-700">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Encrypted
          </span>
        </div>
      </div>
    </aside>
  );
}
