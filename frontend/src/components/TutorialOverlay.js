import React, { useCallback, useEffect, useState } from 'react';
import { ArrowRight, ArrowLeft, Check } from 'lucide-react';
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

// A step points at its target one of three ways: `anchor`, a data-testid; `label`,
// the visible text of a form label (the field around it is highlighted); or
// `button`, the visible text of a button. Page guides (components/HelpGuide.js)
// use the last two so no page needs ids added. Several alternatives can be given
// as "A / B". Hidden elements are ignored, and a step whose target is not on
// screen centres its card instead of pointing at nothing.
const norm = (t) => (t || '').toLowerCase().replace(/\s+/g, ' ').trim();
// Never the guide's own card, whose title repeats the text being searched for.
const visible = (el) => el && el.offsetParent !== null && !el.closest('[data-testid="tutorial-overlay"]');
export function findTarget(step) {
  if (step?.anchor) return document.querySelector(`[data-testid="${step.anchor}"]`);
  const options = norm(step?.label || step?.button).split(' / ').filter(Boolean);
  if (!options.length) return null;
  // Real form labels first; table headings and section titles only if no label matches.
  const pool = step.label
    ? [...document.querySelectorAll('label'), ...document.querySelectorAll('legend, dt, th, h3')]
    : [...document.querySelectorAll('button, a[role="button"]')];
  for (const want of options) {
    const hit = pool.find((el) => visible(el) && norm(el.textContent).startsWith(want))
      || pool.find((el) => visible(el) && norm(el.textContent).includes(want));
    if (hit) return step.label ? (hit.closest('div') || hit) : hit;
  }
  return null;
}

// `local`: a page guide. Nothing is saved to the server, Skip closes at once, and
// `title` names the page in the card's header.
export default function TutorialOverlay({ state, onClose, local = false, title }) {
  const [index, setIndex] = useState(state.step || 0);
  const [rect, setRect] = useState(null);
  const [confirmSkip, setConfirmSkip] = useState(false);

  const steps = state.steps || [];
  const step = steps[index];
  const isLast = index >= steps.length - 1;

  // Re-measure on scroll and resize, so the card tracks its target.
  const measure = useCallback(() => {
    const el = findTarget(step);
    if (!el) { setRect(null); return; }
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [step]);

  useEffect(() => {
    findTarget(step)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    // The smooth scroll moves the target; measure again once it has settled.
    const t = setTimeout(() => measure(), 400);
    return () => clearTimeout(t);
  }, [step, measure]);

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
      if (e.key === 'Escape') skip();
      if (e.key === 'ArrowRight' || e.key === 'Enter') next();
      if (e.key === 'ArrowLeft') back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const next = async () => {
    if (isLast) return finish(false);
    const to = index + 1;
    setIndex(to);
    // Fire and forget: a lost progress save must not interrupt the tour.
    if (!local) api.tutorialProgress(to).catch(() => {});
  };
  const back = () => setIndex((i) => Math.max(0, i - 1));
  // A page guide is a quick look, so Skip just closes it; the first-login tour asks first.
  const skip = () => (local ? onClose() : setConfirmSkip(true));

  const finish = async (skipped) => {
    if (local) return onClose();
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
        onClick={skip} />
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
        className="absolute bg-white rounded-2xl shadow-2xl p-5 transition-all duration-300 max-w-[calc(100vw-28px)]"
        style={{ ...cardStyle, width: CARD_W }}
        data-testid="tutorial-card"
      >
        <div className="flex items-center justify-between gap-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            {title ? `${title} · ` : ''}Step {index + 1} of {steps.length}
          </p>
          <button data-testid="tutorial-skip" onClick={skip}
            className="text-xs font-semibold text-amber-700 hover:text-amber-800">
            Skip
          </button>
        </div>
        <h3 className="text-sm font-bold text-slate-900 mt-2" data-testid="tutorial-title">{step.title}</h3>
        <p className="text-xs text-slate-600 mt-1.5 leading-relaxed whitespace-pre-line" data-testid="tutorial-body">{step.body}</p>
        {!rect && (step.label || step.button) && (
          <p className="text-[10px] text-slate-500 italic mt-1.5">
            Not on screen right now: it is in a form that opens from a button on this page.
          </p>
        )}

        <div className="flex items-center gap-1.5 mt-4" aria-hidden="true">
          {steps.map((_, i) => (
            <span key={i} className={`h-1.5 rounded-full transition-all ${
              i === index ? 'w-5 bg-amber-500' : i < index ? 'w-1.5 bg-amber-300' : 'w-1.5 bg-slate-200'
            }`} />
          ))}
        </div>

        <div className="flex items-center justify-between gap-3 mt-4">
          {index > 0 ? (
            <button data-testid="tutorial-back" onClick={back}
              className="px-3 py-2 rounded-full text-xs font-semibold text-slate-600 hover:bg-slate-100 flex items-center gap-1.5">
              <ArrowLeft className="w-3.5 h-3.5" /> Back
            </button>
          ) : <span />}
          <button
            data-testid="tutorial-next"
            onClick={next}
            autoFocus
            className="px-5 py-2 rounded-full bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold flex items-center gap-1.5 shadow"
          >
            {isLast ? <>Done <Check className="w-3.5 h-3.5" /></> : <>Next <ArrowRight className="w-3.5 h-3.5" /></>}
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
