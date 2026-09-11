import React, { createContext, useContext } from 'react';

const BankThemeContext = createContext();

const AJSPAY_THEME = {
  id: 'ajspay',
  name: 'AJSPay',
  badge: 'Secure Digital Banking',
  primary: 'from-sky-700 via-indigo-900 to-slate-950',
  headerBg: 'bg-slate-900 border-b border-indigo-500/20',
  accentColor: 'text-indigo-400',
  accentBg: 'bg-indigo-600 hover:bg-indigo-700',
  tagColor: 'bg-indigo-950/80 text-indigo-300 border border-indigo-500/30',
  cardGlow: 'shadow-[0_0_25px_-5px_rgba(99,102,241,0.25)]',
  buttonTheme: 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white'
};

export const BankThemeProvider = ({ children }) => {
  return (
    <BankThemeContext.Provider value={{ currentTheme: AJSPAY_THEME }}>
      {children}
    </BankThemeContext.Provider>
  );
};

export const useBankTheme = () => useContext(BankThemeContext);
