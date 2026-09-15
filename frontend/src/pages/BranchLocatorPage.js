import React, { useState, useEffect } from 'react';
import { MapPin, Search, Phone, Clock, ShieldCheck, Check, Navigation } from 'lucide-react';
import { api } from '../services/api';
import { useBankTheme } from '../context/BankThemeContext';

export default function BranchLocatorPage() {
  const { currentTheme } = useBankTheme();
  const [branches, setBranches] = useState([]);
  const [search, setSearch] = useState('');
  const [filterAtm, setFilterAtm] = useState(false);
  const [filterCdm, setFilterCdm] = useState(false);

  useEffect(() => {
    const load = async () => {
      const res = await api.getBranches();
      setBranches(res.branches || []);
    };
    load();
  }, []);

  const filtered = branches.filter(b => {
    const matchesSearch = b.name.toLowerCase().includes(search.toLowerCase()) || 
                          b.address.toLowerCase().includes(search.toLowerCase()) ||
                          b.bank.toLowerCase().includes(search.toLowerCase());
    if (!matchesSearch) return false;
    if (filterAtm && !b.has_atm) return false;
    if (filterCdm && !b.has_cdm) return false;
    return true;
  });

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      
      {/* Header */}
      <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Branch, ATM & Cash Deposit (CDM) Locator
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Locate 24x7 Cash Dispensers, Locker Facilities, and Forex Desks Across India
          </p>
        </div>

        {/* Search Input */}
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
          <input
            data-testid="branch-search-input"
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by city, PIN, branch..."
            className="w-full bg-white border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-900 placeholder-slate-500 focus:outline-none focus:border-[#0b3b8c]"
          />
        </div>
      </div>

      {/* Filter Checkboxes */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={filterAtm}
            onChange={(e) => setFilterAtm(e.target.checked)}
            className="w-4 h-4 rounded text-[#0b3b8c]"
          />
          <span>24x7 ATM Available</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={filterCdm}
            onChange={(e) => setFilterCdm(e.target.checked)}
            className="w-4 h-4 rounded text-[#0b3b8c]"
          />
          <span>Cash Deposit Machine (CDM)</span>
        </label>
      </div>

      {/* Branch Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filtered.map(b => (
          <div key={b.id} data-testid={`branch-card-${b.id}`} className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xl space-y-4">
            <div className="flex justify-between items-start">
              <div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-500/20 text-[#0b3b8c] border border-blue-500/30">
                  {b.bank} Branch
                </span>
                <h3 className="font-bold text-slate-900 text-sm mt-1">{b.name}</h3>
              </div>
              <span className="font-mono text-[10px] text-slate-500">{b.code}</span>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">{b.address}</p>

            <div className="space-y-1.5 text-[11px] text-slate-500 pt-2 border-t border-slate-200">
              <p className="flex items-center gap-2">
                <Phone className="w-3.5 h-3.5 text-[#0b3b8c]" /> {b.phone}
              </p>
              <p className="flex items-center gap-2">
                <Clock className="w-3.5 h-3.5 text-[#0b3b8c]" /> Timing: {b.timing}
              </p>
            </div>

            <div className="flex flex-wrap gap-1.5 pt-1 text-[10px]">
              {b.has_atm && <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-700 border border-emerald-500/20">ATM 24x7</span>}
              {b.has_cdm && <span className="px-2 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20">CDM Deposit</span>}
              {b.has_locker && <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-600 border border-amber-500/20">Lockers</span>}
            </div>

            <a
              href={`https://maps.google.com/?q=${b.lat},${b.lng}`}
              target="_blank"
              rel="noreferrer"
              className="w-full py-2 rounded-xl bg-slate-100 hover:bg-slate-100 text-[#0b3b8c] text-xs font-semibold flex items-center justify-center gap-1.5 transition"
            >
              <Navigation className="w-3.5 h-3.5" /> Navigate on Google Maps
            </a>
          </div>
        ))}
      </div>

    </div>
  );
}
