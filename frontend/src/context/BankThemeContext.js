import React, { createContext, useContext, useState, useEffect } from 'react';

const BankThemeContext = createContext();

export const THEMES = {
  HYBRID: {
    id: 'hybrid',
    name: 'Universal FinTech Hub',
    badge: 'National Banking Standard',
    primary: 'from-sky-700 via-indigo-900 to-slate-950',
    headerBg: 'bg-slate-900 border-b border-indigo-500/20',
    accentColor: 'text-indigo-400',
    accentBg: 'bg-indigo-600 hover:bg-indigo-700',
    tagColor: 'bg-indigo-950/80 text-indigo-300 border border-indigo-500/30',
    cardGlow: 'shadow-[0_0_25px_-5px_rgba(99,102,241,0.25)]',
    buttonTheme: 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white'
  },
  SBI: {
    id: 'sbi',
    name: 'State Bank of India (SBI YONO)',
    badge: 'SBI YONO Digital',
    primary: 'from-blue-900 via-sky-950 to-slate-950',
    headerBg: 'bg-slate-900 border-b border-cyan-500/30',
    accentColor: 'text-cyan-400',
    accentBg: 'bg-cyan-600 hover:bg-cyan-700',
    tagColor: 'bg-cyan-950/80 text-cyan-300 border border-cyan-500/30',
    cardGlow: 'shadow-[0_0_25px_-5px_rgba(6,182,212,0.25)]',
    buttonTheme: 'bg-gradient-to-r from-cyan-600 to-blue-700 hover:from-cyan-700 hover:to-blue-800 text-white'
  },
  HDFC: {
    id: 'hdfc',
    name: 'HDFC Bank NetBanking',
    badge: 'HDFC Corporate Banking',
    primary: 'from-blue-950 via-slate-900 to-rose-950',
    headerBg: 'bg-slate-900 border-b border-rose-500/30',
    accentColor: 'text-rose-400',
    accentBg: 'bg-rose-600 hover:bg-rose-700',
    tagColor: 'bg-rose-950/80 text-rose-300 border border-rose-500/30',
    cardGlow: 'shadow-[0_0_25px_-5px_rgba(244,63,94,0.25)]',
    buttonTheme: 'bg-gradient-to-r from-blue-700 to-rose-700 hover:from-blue-800 hover:to-rose-800 text-white'
  },
  ICICI: {
    id: 'icici',
    name: 'ICICI Bank iMobile Pay',
    badge: 'ICICI Wealth & Retail',
    primary: 'from-amber-950 via-red-950 to-slate-950',
    headerBg: 'bg-slate-900 border-b border-amber-500/30',
    accentColor: 'text-amber-400',
    accentBg: 'bg-amber-600 hover:bg-amber-700',
    tagColor: 'bg-amber-950/80 text-amber-300 border border-amber-500/30',
    cardGlow: 'shadow-[0_0_25px_-5px_rgba(245,158,11,0.25)]',
    buttonTheme: 'bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700 text-white'
  }
};

export const BankThemeProvider = ({ children }) => {
  const [currentTheme, setCurrentTheme] = useState(() => {
    const saved = localStorage.getItem('bank_theme_choice');
    return saved && THEMES[saved] ? THEMES[saved] : THEMES.HYBRID;
  });

  const switchTheme = (themeKey) => {
    if (THEMES[themeKey]) {
      setCurrentTheme(THEMES[themeKey]);
      localStorage.setItem('bank_theme_choice', themeKey);
    }
  };

  return (
    <BankThemeContext.Provider value={{ currentTheme, switchTheme, availableThemes: THEMES }}>
      {children}
    </BankThemeContext.Provider>
  );
};

export const useBankTheme = () => useContext(BankThemeContext);
