import React from 'react';
import { HeadphonesIcon } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { navFor, ROLE_LABEL } from '../navigation';

export default function Sidebar({ activeTab, onSelectTab }) {
  const { user, features } = useAuth();
  const role = user?.role || 'retail';
  const navItems = navFor(role, features);

  return (
    <aside className="w-64 bg-white border-r border-slate-200 flex flex-col justify-between p-4 shrink-0 min-h-[calc(100vh-4rem)]">
      <div className="space-y-1">
        <div className="px-3 py-2 flex items-center gap-2">
          <div className="w-1 h-4 bg-[#0b3b8c] rounded" />
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
            {ROLE_LABEL[role] || 'Banking'} Menu
          </p>
        </div>

        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              data-testid={item.testId}
              onClick={() => onSelectTab(item.id)}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-md text-xs font-medium transition ${
                isActive
                  ? 'bg-[#0b3b8c] text-white shadow-sm font-semibold'
                  : item.highlight
                  ? 'bg-blue-50 text-[#0b3b8c] border border-blue-100 hover:bg-blue-100'
                  : 'text-slate-700 hover:text-[#0b3b8c] hover:bg-slate-50'
              }`}
            >
              <Icon className={`w-4 h-4 ${isActive ? 'text-slate-900' : item.highlight ? 'text-[#0b3b8c]' : 'text-slate-500'}`} />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* Support card */}
      <div className="mt-6 p-3 rounded-md bg-slate-50 border border-slate-200 text-slate-700 text-[11px] space-y-2">
        <div className="flex items-center gap-2 text-[#0b3b8c] font-semibold">
          <HeadphonesIcon className="w-3.5 h-3.5" /> 24×7 Member Help
        </div>
        <p className="text-slate-600">Toll-Free: <strong className="text-slate-900">1800 11 2211</strong></p>
        <p className="text-slate-600">Cyber Fraud: <strong className="text-[#c8102e]">1930</strong></p>
        <div className="pt-2 border-t border-slate-200 flex items-center justify-between text-[10px] text-slate-500">
          <span>Session Active</span>
          <span className="flex items-center gap-1 text-emerald-600">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Encrypted
          </span>
        </div>
      </div>
    </aside>
  );
}
