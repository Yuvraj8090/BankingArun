// Shared currency display -- was reimplemented slightly differently (some with
// 2 decimals, some with a ₹, some without) in half a dozen pages, so a fix to
// one never reached the others.
export const inr = (n, { decimals = 0, symbol = true } = {}) =>
  `${symbol ? '₹' : ''}${Number(n || 0).toLocaleString('en-IN', {
    minimumFractionDigits: decimals, maximumFractionDigits: decimals,
  })}`;
