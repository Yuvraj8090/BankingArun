import React, { useCallback, useEffect, useState } from 'react';
import { X, ArrowRight, Check } from 'lucide-react';
import { api } from '../services/api';
import { toast } from 'sonner';

// A coach-mark tour. The steps come from the server, so they vary by role and
// never point at a feature this institution is not authorised to offer.
//
// Each step names a data-testid the app already renders. If that element is not
// on the page — a collapsed sidebar on mobile, a tab hidden by the capability
// register — the card centres itself instead of pointing at nothing.
const CARD_W = 320;
const GAP = 14;

export default function TutorialOverlay({ state, onClose }) {
  const [index, setIndex] = useState(state.step || 0);
  const [rect, setRect] = useState(null);
  const [confirmSkip, setConfirmSkip] = useState(false);

  const steps = state.steps || [];
  const step = steps[index];
  const isLast = index >= steps.length - 1;

  // Re-measure on scroll and resize, so the card tracks its target.
  const measure = useCallback(() => {
    if (!step?.anchor) { setRect(null); return; }
    const el = document.querySelector(`[data-testid="${step.anchor}"]`);
    if (!el) { setRect(null); return; }
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [step]);

  useEffect(() => {
    if (step?.anchor) {
      document.querySelector(`[data-testid="${step.anchor}"]`)
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [step]);

  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [measure]);

  // Escape asks to skip rather than silently abandoning the tour.
  useEffect(() => {
    const onKey = (e) => {
      if (confirmSkip) { if (e.key === 'Escape') setConfirmSkip(false); return; }
      if (e.key === 'Escape') setConfirmSkip(true);
      if (e.key === 'ArrowRight' || e.key === 'Enter') next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const next = async () => {
    if (isLast) return finish(false);
    const to = index + 1;
    setIndex(to);
    // Fire and forget: a lost progress save must not interrupt the tour.
    api.tutorialProgress(to).catch(() => {});
  };

  const finish = async (skipped) => {
    try {
      const res = await api.tutorialFinish(skipped, index);
      if (skipped) toast.success(res.message);
    } catch { /* closing the tour should never block the app */ }
    onClose();
  };

  if (!step) return null;

  // Place the card beside the target where there is room, else below it.
  let cardStyle = { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
  if (rect) {
    const roomRight = window.innerWidth - (rect.left + rect.width);
    if (roomRight > CARD_W + GAP * 2) {
      cardStyle = { top: Math.min(rect.top, window.innerHeight - 220), left: rect.left + rect.width + GAP };
    } else if (rect.top + rect.height + 200 < window.innerHeight) {
      cardStyle = { top: rect.top + rect.height + GAP, left: Math.max(GAP, Math.min(rect.left, window.innerWidth - CARD_W - GAP)) };
    } else {
      cardStyle = { top: Math.max(GAP, rect.top - 200), left: Math.max(GAP, Math.min(rect.left, window.innerWidth - CARD_W - GAP)) };
    }
  }

  return (
    <div className="fixed inset-0 z-[70]" data-testid="tutorial-overlay" role="dialog" aria-modal="true"
      aria-label="Product tour">
      {/* Dim everything, then punch a hole over the target with a ring. The
          backdrop stays transparent while a target is spotlit — the ring's
          box-shadow is what dims, and the hole has to show the live page. */}
      <div className={`absolute inset-0 ${rect ? '' : 'bg-slate-900/60'}`}
        onClick={() => setConfirmSkip(true)} />
      {rect && (
        <div
          className="absolute rounded-lg pointer-events-none transition-all duration-300"
          style={{
            top: rect.top - 4, left: rect.left - 4, width: rect.width + 8, height: rect.height + 8,
            // The ring and the dim are one property: a Tailwind `ring-*` class
            // sets box-shadow too and would simply be overwritten by this style.
            boxShadow: '0 0 0 3px #f59e0b, 0 0 0 9999px rgba(2, 6, 23, 0.55)'
          }}
        />
      )}

      <div
        className="absolute bg-white rounded-xl shadow-2xl p-5 transition-all duration-300"
        style={{ ...cardStyle, width: CARD_W }}
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-sm font-bold text-slate-900" data-testid="tutorial-title">{step.title}</h3>
          <button onClick={() => setConfirmSkip(true)} aria-label="Close tour"
            className="text-slate-600 hover:text-slate-600 shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-slate-600 mt-2 leading-relaxed" data-testid="tutorial-body">{step.body}</p>

        <div className="flex items-center gap-1.5 mt-4">
          {steps.map((_, i) => (
            <span key={i} className={`h-1.5 rounded-full transition-all ${
              i === index ? 'w-5 bg-[#0b3b8c]' : i < index ? 'w-1.5 bg-[#0b3b8c]/40' : 'w-1.5 bg-slate-200'
            }`} />
          ))}
          <span className="ml-auto text-[10px] text-slate-500">{index + 1} of {steps.length}</span>
        </div>

        <div className="flex items-center justify-between gap-3 mt-4">
          <button
            data-testid="tutorial-skip"
            onClick={() => setConfirmSkip(true)}
            className="text-xs text-slate-500 hover:text-slate-800 font-medium"
          >
            Skip all
          </button>
          <button
            data-testid="tutorial-next"
            onClick={next}
            className="px-5 py-2 rounded-full bg-[#0b3b8c] text-white text-xs font-semibold flex items-center gap-1.5"
          >
            {isLast ? <>Finish <Check className="w-3.5 h-3.5" /></> : <>Next <ArrowRight className="w-3.5 h-3.5" /></>}
          </button>
        </div>
      </div>

      {confirmSkip && (
        <div className="absolute inset-0 bg-slate-900/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl p-5 max-w-sm" data-testid="tutorial-skip-confirm">
            <h3 className="text-sm font-bold text-slate-900">Skip the tour?</h3>
            <p className="text-xs text-slate-600 mt-2">
              You can restart it any time from your profile menu. Your place is saved either way.
            </p>
            <div className="flex items-center justify-end gap-2 mt-4">
              <button onClick={() => setConfirmSkip(false)} data-testid="tutorial-keep-going"
                className="px-4 py-2 rounded-md border border-slate-200 text-xs font-semibold text-slate-700">
                Keep going
              </button>
              <button onClick={() => finish(true)} data-testid="tutorial-confirm-skip"
                className="px-4 py-2 rounded-md bg-[#0b3b8c] text-white text-xs font-semibold">
                Skip the tour
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
