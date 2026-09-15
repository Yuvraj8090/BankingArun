import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

// Shared pager for every list the API returns with a `pagination` block.
// Renders nothing when there is only one page, so short lists stay uncluttered.
export default function Pagination({ meta, onPage, onPerPage }) {
  if (!meta) return null;
  const { page, pages, total, from, to, has_prev: hasPrev, has_next: hasNext } = meta;
  if (total === 0) return null;

  // A short window around the current page, so a thousand pages don't render.
  const window = [];
  for (let p = Math.max(1, page - 2); p <= Math.min(pages, page + 2); p++) window.push(p);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-slate-100 text-xs">
      <span className="text-slate-500" data-testid="pagination-summary">
        Showing <strong className="text-slate-700">{from}–{to}</strong> of{' '}
        <strong className="text-slate-700">{total.toLocaleString('en-IN')}</strong>
      </span>

      <div className="flex items-center gap-1.5">
        {onPerPage && (
          <select
            value={meta.per_page}
            onChange={(e) => onPerPage(Number(e.target.value))}
            data-testid="pagination-per-page"
            className="mr-2 border border-slate-200 rounded-md px-2 py-1 text-xs bg-white text-slate-700"
          >
            {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n} / page</option>)}
          </select>
        )}
        <button
          data-testid="pagination-prev"
          disabled={!hasPrev}
          onClick={() => onPage(page - 1)}
          className="px-2 py-1.5 rounded-md border border-slate-200 text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50"
          aria-label="Previous page"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        {window[0] > 1 && <span className="px-1 text-slate-500">…</span>}
        {window.map((p) => (
          <button
            key={p}
            onClick={() => onPage(p)}
            data-testid={`pagination-page-${p}`}
            className={`min-w-[28px] px-2 py-1.5 rounded-md border text-xs font-semibold ${
              p === page
                ? 'bg-[#0b3b8c] text-white border-[#0b3b8c]'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            {p}
          </button>
        ))}
        {window[window.length - 1] < pages && <span className="px-1 text-slate-500">…</span>}
        <button
          data-testid="pagination-next"
          disabled={!hasNext}
          onClick={() => onPage(page + 1)}
          className="px-2 py-1.5 rounded-md border border-slate-200 text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50"
          aria-label="Next page"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
