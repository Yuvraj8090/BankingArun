// Typo-tolerant ranking shared by the member search in the navbar and the
// product search on the public site. Both need the same behaviour: a member who
// types "trnasfer" or "deposite" should still land on the right page.

export const norm = (s) => (s || '')
  .toLowerCase()
  .replace(/[^a-z0-9 ]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

// Optimal string alignment distance, capped: we only care whether a word is
// within a typo or two, never the exact distance of unrelated words. Counting a
// transposition as one edit is what makes "trnasfer" reach "Transfers" —
// swapped letters are the most common way a name gets mistyped.
export function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let twoBack = [];
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        row[j] = Math.min(row[j], twoBack[j - 2] + 1);
      }
      if (row[j] < best) best = row[j];
    }
    if (best > max) return max + 1;
    twoBack = prev;
    prev = row;
  }
  return prev[b.length];
}

// A typo budget that scales with word length: "lons" should still find Loans,
// but "car" must not become "card" for a three-letter query.
const budget = (word) => (word.length <= 3 ? 0 : word.length <= 5 ? 1 : 2);

// Every word the member typed must match some word in the candidate text,
// allowing a few edits. Returns the total edits, or null if a word matched
// nothing at all.
function fuzzyPenalty(words, candidates) {
  let penalty = 0;
  for (const word of words) {
    const base = budget(word);
    let bestForWord = null;
    for (const candidate of candidates) {
      if (candidate.startsWith(word)) { bestForWord = 0; break; }
      // Typists rarely get the opening letters wrong, so a shared prefix earns
      // a wider budget further in: that is what carries "lone" to "loan".
      const max = word.length >= 4 && candidate.slice(0, 2) === word.slice(0, 2) ? Math.max(base, 2) : base;
      const d = editDistance(word, candidate, max);
      if (d <= max && (bestForWord === null || d < bestForWord)) bestForWord = d;
    }
    if (bestForWord === null) return null;
    penalty += bestForWord;
  }
  return penalty;
}

// `label` is the page's own name; `keywords` are the other words members use for
// it. Exact and prefix hits rank above substring hits, which rank above typos.
export function score(label, keywords, query) {
  const name = norm(label);
  const haystacks = [name, ...(keywords || []).map(norm)].filter(Boolean);

  if (haystacks.some((h) => h === query)) return 100;
  if (name.startsWith(query)) return 90;
  if (haystacks.some((h) => h.startsWith(query))) return 80;
  if (haystacks.some((h) => h.includes(query))) return 70;

  // A typo against the page's own name beats a typo against a keyword, so
  // "transfor" lands on Transfers rather than on Standing Instructions, which
  // only mentions transfers in passing.
  const words = query.split(' ').filter(Boolean);
  const onName = fuzzyPenalty(words, name.split(' ').filter(Boolean));
  if (onName !== null) return 65 - onName * 4;
  const onKeywords = fuzzyPenalty(words, haystacks.join(' ').split(' ').filter(Boolean));
  return onKeywords === null ? 0 : 55 - onKeywords * 4;
}

// items: [{ label, keywords }] plus whatever else the caller needs back.
export function rank(items, raw, limit = 7) {
  const query = norm(raw);
  if (!query) return [];
  return items
    .map((item) => ({ item, s: score(item.label, item.keywords, query) }))
    .filter((hit) => hit.s > 0)
    .sort((a, b) => b.s - a.s || a.item.label.localeCompare(b.item.label))
    .slice(0, limit)
    .map((hit) => hit.item);
}
