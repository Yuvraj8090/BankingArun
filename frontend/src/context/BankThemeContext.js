import React, { createContext, useContext } from 'react';

const BankThemeContext = createContext();

// White is the primary surface; this blue is the secondary, used for headers,
// buttons, active states and accents. Anything that needs to stand out earns
// the blue — the page itself stays white.
export const BRAND_BLUE = '#0b3b8c';
export const BRAND_BLUE_DEEP = '#0a2f6f';
export const BRAND_RED = '#c8102e';

const AJSPAY_THEME = {
  id: 'ajspay',
  name: 'AJSPay',
  badge: 'Secure Digital Banking',
  // The one blue band on a page: its header.
  primary: 'from-[#0b3b8c] via-[#123f86] to-[#0b3b8c]',
  headerBg: 'bg-white border-b border-slate-200',
  accentColor: 'text-[#0b3b8c]',
  accentBg: 'bg-[#0b3b8c] hover:bg-[#0a2f6f]',
  tagColor: 'bg-blue-50 text-[#0b3b8c] border border-blue-200',
  // On white, a coloured glow reads as a smudge; a plain border is cleaner.
  cardGlow: 'shadow-sm',
  buttonTheme: 'bg-[#0b3b8c] hover:bg-[#0a2f6f] text-white'
};

export const BankThemeProvider = ({ children }) => {
  return (
    <BankThemeContext.Provider value={{ currentTheme: AJSPAY_THEME }}>
      {children}
    </BankThemeContext.Provider>
  );
};

export const useBankTheme = () => useContext(BankThemeContext);
