import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

// Shared dialog for the create/edit forms. The scrim is translucent on purpose:
// the record being acted on stays readable behind it, and an opaque panel here
// is what made the product tour render as a blank screen.
export default function Modal({ title, subtitle, onClose, children, footer, testId, wide }) {
  const panel = useRef(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    // preventScroll: focusing the first field otherwise scrolls the dialog's own
    // scroll container, which drops the header out of view as it opens.
    panel.current?.querySelector('input, textarea, select, button')?.focus({ preventScroll: true });
    // Hold the page still underneath, so closing the dialog returns the reader
    // to where they were rather than to wherever the page drifted.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  // Rendered into <body>: an ancestor with a transform or a filter becomes the
  // containing block for position:fixed, which pins the backdrop a few pixels
  // down the page instead of over the whole viewport.
  return createPortal((
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-start sm:items-center justify-center p-4 overflow-y-auto"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={panel} data-testid={testId} role="dialog" aria-modal="true" aria-label={title}
        className={`bg-white rounded-xl shadow-2xl w-full my-8 ${wide ? 'max-w-3xl' : 'max-w-lg'}`}>
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-100">
          <div>
            <h3 className="text-sm font-bold text-slate-900">{title}</h3>
            {subtitle && <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="text-slate-500 hover:text-slate-800 shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>
        {/* The form scrolls inside the dialog rather than the page behind it. */}
        <div className="px-5 py-4 space-y-3 max-h-[65vh] overflow-y-auto">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-end gap-2">{footer}</div>}
      </div>
    </div>
  ), document.body);
}

export function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold text-slate-700 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-slate-500 mt-1">{hint}</span>}
    </label>
  );
}

export const inputClass =
  'w-full px-3 py-2 rounded-md border border-slate-200 text-xs text-slate-900 bg-white ' +
  'focus:outline-none focus:ring-2 focus:ring-[#0b3b8c]/30 focus:border-[#0b3b8c]';
