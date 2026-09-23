import React, { useEffect, useState } from 'react';
import { Users, UserCheck, FileText, RefreshCw, Phone, Mail, MessageSquare } from 'lucide-react';
import { api } from '../services/api';
import { toast } from 'sonner';

export default function StaffPanel() {
  const [data, setData] = useState(null);

  useEffect(() => { api.getStaffPanel().then(setData).catch(() => toast.error('Access denied')); }, []);

  if (!data) return <div className="p-10 flex items-center gap-2 text-slate-600"><RefreshCw className="w-4 h-4 animate-spin" /> Loading console…</div>;

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm">
        <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
          <Users className="w-5 h-5 text-[#0b3b8c]" /> Staff / Teller Console
        </h1>
        <p className="text-xs text-slate-500 mt-1">Customer onboarding · Transaction processing · Query resolution</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Kpi label="Served today" value={data.kpis.customers_served_today} icon={Users} />
        <Kpi label="Pending KYC" value={data.kpis.pending_kyc} icon={UserCheck} color="text-amber-700" />
        <Kpi label="Transactions" value={data.kpis.transactions_processed} icon={FileText} color="text-emerald-700" />
        <Kpi label="Open tickets" value={data.kpis.open_tickets} icon={MessageSquare} color="text-[#c8102e]" />
      </div>

      <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Recent Customers</h2>
          <span className="text-[11px] text-slate-500">Last 10 registrations</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[11px] uppercase text-slate-600">
              <tr>
                <th className="p-3 font-semibold">Customer</th>
                <th className="p-3 font-semibold">Contact</th>
                <th className="p-3 font-semibold">KYC</th>
                <th className="p-3 font-semibold">Branch</th>
                <th className="p-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.recent_customers.map(c => (
                <tr key={c.id} className="hover:bg-blue-50/40 transition-colors">
                  <td className="p-3">
                    <div className="font-semibold text-slate-900">{c.name}</div>
                    <div className="text-[10px] text-slate-500">{c.role}</div>
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-1 text-slate-600"><Mail className="w-3 h-3" /> {c.email}</div>
                    <div className="flex items-center gap-1 text-slate-600 mt-0.5"><Phone className="w-3 h-3" /> {c.phone}</div>
                  </td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                      c.kyc_status === 'verified' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-amber-50 text-amber-700 border-amber-200'
                    }`}>{c.kyc_status}</span>
                  </td>
                  <td className="p-3 text-slate-600">{c.branch}</td>
                  <td className="p-3 text-right">
                    <button data-testid={`staff-assist-${c.id}`}
                      onClick={() => toast.success(`Assisting ${c.name}`)}
                      className="px-3 py-1 rounded-md bg-[#0b3b8c] hover:bg-[#092e6f] focus:outline-none focus:ring-2 focus:ring-[#0b3b8c]/25 active:scale-[0.98] transition text-white text-[11px] font-semibold">
                      Assist
                    </button>
                  </td>
                </tr>
              ))}
              {!data.recent_customers.length && (
                <tr><td colSpan={5} className="p-6 text-center text-slate-500">No recent customers.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, icon: Icon, color = 'text-[#0b3b8c]' }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <div className={`w-7 h-7 rounded-md bg-slate-50 border border-slate-100 flex items-center justify-center ${color}`}><Icon className="w-3.5 h-3.5" /></div>
        <p className="text-[11px] text-slate-600">{label}</p>
      </div>
      <p className="text-xl font-bold text-slate-900 mt-2">{value}</p>
    </div>
  );
}
