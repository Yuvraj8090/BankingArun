import React, { useMemo, useRef, useState } from 'react';
import { Search, CornerDownLeft } from 'lucide-react';
import { rank } from '../lib/fuzzy';

// The input and suggestion list. Callers supply the searchable items and decide
// what picking one does, so the member search and the public product search
// share one keyboard, mouse and matching behaviour.
export default function SearchBox({ items, onPick, placeholder, testId = 'global-search' }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef(null);

  const results = useMemo(() => rank(items, query), [items, query]);

  const close = () => { setOpen(false); setCursor(0); };
  const choose = (item) => {
    if (!item) return;
    setQuery('');
    close();
    inputRef.current?.blur();
    onPick(item);
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { setQuery(''); close(); return; }
    if (!results.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => (c + 1) % results.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => (c - 1 + results.length) % results.length); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(results[cursor]); }
  };

  return (
    <div className="relative w-full">
      <div className="w-full flex items-center border border-slate-200 rounded-md px-3 h-9 focus-within:border-[#0b3b8c] bg-slate-50">
        <Search className="w-4 h-4 text-slate-500" />
        <input
          ref={inputRef}
          data-testid={testId}
          value={query}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-xs px-2 outline-none placeholder:text-slate-500"
          autoComplete="off"
          role="combobox"
          aria-expanded={open && query.trim() !== ''}
          aria-autocomplete="list"
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setCursor(0); }}
          onFocus={() => setOpen(true)}
          onBlur={close}
          onKeyDown={onKeyDown}
        />
      </div>

      {open && query.trim() !== '' && (
        <div
          data-testid={`${testId}-results`}
          role="listbox"
          className="absolute left-0 right-0 top-11 bg-white border border-slate-200 rounded-md shadow-lg overflow-hidden z-50"
        >
          {results.length === 0 ? (
            <p className="px-3 py-3 text-xs text-slate-500" data-testid={`${testId}-empty`}>
              Nothing matches “{query.trim()}”.
            </p>
          ) : (
            results.map((item, i) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.key}
                  type="button"
                  role="option"
                  aria-selected={i === cursor}
                  data-testid={`${testId}-result-${item.key}`}
                  // onMouseDown fires before the input's blur, so the click is
                  // not swallowed by the dropdown closing first.
                  onMouseDown={(e) => { e.preventDefault(); choose(item); }}
                  onMouseEnter={() => setCursor(i)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left text-xs ${
                    i === cursor ? 'bg-slate-100 text-[#0b3b8c]' : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {Icon && <Icon className="w-4 h-4 shrink-0 text-slate-500" />}
                  <span className="flex-1 min-w-0">
                    <span className="block truncate">{item.label}</span>
                    {item.hint && <span className="block truncate text-[11px] text-slate-500">{item.hint}</span>}
                  </span>
                  {i === cursor && <CornerDownLeft className="w-3 h-3 text-slate-500 shrink-0" />}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
