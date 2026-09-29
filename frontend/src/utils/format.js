// Shared currency display -- was reimplemented slightly differently (some with
// 2 decimals, some with a ₹, some without) in half a dozen pages, so a fix to
// one never reached the others.
export const inr = (n, { decimals = 0, symbol = true } = {}) =>
  `${symbol ? '₹' : ''}${Number(n || 0).toLocaleString('en-IN', {
    minimumFractionDigits: decimals, maximumFractionDigits: decimals,
  })}`;

// Transaction "mode" is a machine code (COUNTER_DEPOSIT, MF_PURCHASE, ...) and
// several pages were printing it straight into the UI. Known acronyms stay
// upper-case; everything else becomes Title Case with the underscores gone.
const MODE_ACRONYMS = new Set(['IMPS', 'NEFT', 'RTGS', 'UPI', 'MF']);
export const txnMode = (mode) =>
  (mode || '').split('_')
    .map(w => (MODE_ACRONYMS.has(w) ? w : w.charAt(0) + w.slice(1).toLowerCase()))
    .join(' ');
