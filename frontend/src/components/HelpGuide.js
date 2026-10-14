import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { HelpCircle, X, ChevronDown } from 'lucide-react';
import { guideFor, faqFor, PUBLIC_FAQ } from '../data/help';
import { navFor } from '../navigation';

// One page's guide: what it is for, how to do the job, what each field wants.
function GuideBody({ guide }) {
  return (
    <div className="space-y-4 text-xs text-slate-700">
      <p className="leading-relaxed">{guide.what}</p>
      {guide.steps.length > 0 && (
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">How to</h3>
          <ol className="list-decimal pl-4 space-y-1">{guide.steps.map((s) => <li key={s}>{s}</li>)}</ol>
        </div>
      )}
      {guide.fields.length > 0 && (
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">The form</h3>
          <dl className="space-y-1.5">
            {guide.fields.map(([label, help]) => (
              <div key={label}>
                <dt className="font-semibold text-slate-900">{label}</dt>
                <dd className="text-slate-600">{help}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {guide.tips.length > 0 && (
        <ul className="rounded-md bg-amber-50 border border-amber-200 p-3 space-y-1 list-disc pl-6">
          {guide.tips.map((t) => <li key={t}>{t}</li>)}
        </ul>
      )}
    </div>
  );
}

function Faq({ items }) {
  return (
    <div className="divide-y divide-slate-100">
      {items.map(([q, a]) => (
        <details key={q} className="group py-3">
          <summary className="flex items-center justify-between cursor-pointer text-sm font-semibold text-slate-900 list-none">
            {q}
            <ChevronDown className="w-4 h-4 text-slate-500 group-open:rotate-180 transition" />
          </summary>
          <p className="mt-2 text-xs text-slate-600 leading-relaxed">{a}</p>
        </details>
      ))}
    </div>
  );
}

// The "Guide" button in the top bar. Opens the guide for the page you are on.
export function GuideButton({ tab, role, onOpenHelp }) {
  const [open, setOpen] = useState(false);
  const guide = guideFor(tab, role);
  return (
    <>
      <button type="button" data-testid="page-guide-btn" onClick={() => setOpen(true)}
        aria-label="Guide for this page"
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-slate-700 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-[#0b3b8c]/25 transition">
        <HelpCircle className="w-4 h-4 text-[#0b3b8c]" /> <span className="hidden sm:inline">Guide</span>
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40" onClick={() => setOpen(false)}>
          <aside role="dialog" aria-modal="true" aria-labelledby="guide-title" data-testid="page-guide"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md h-full bg-white shadow-xl overflow-y-auto p-5">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-slate-500">Guide</p>
                <h2 id="guide-title" className="text-lg font-bold text-slate-900">{guide?.title || 'This page'}</h2>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close guide"
                className="p-1.5 rounded hover:bg-slate-100 text-slate-500"><X className="w-4 h-4" /></button>
            </div>
            {guide ? <GuideBody guide={guide} />
              : <p className="text-xs text-slate-600">There is no guide for this page yet.</p>}
            <button type="button" onClick={() => { setOpen(false); onOpenHelp(); }}
              className="mt-6 w-full px-3 py-2 rounded-md border border-slate-200 hover:border-[#0b3b8c] text-xs font-semibold text-[#0b3b8c]">
              Open the Help Centre
            </button>
          </aside>
        </div>
      )}
    </>
  );
}

// /app/help: a guide for every page this role can open, then the FAQ.
export function HelpCentre({ role, features }) {
  const pages = navFor(role, features).map((item) => [item, guideFor(item.id, role)]).filter(([, g]) => g);
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto space-y-6">
      <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm">
        <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
          <HelpCircle className="w-5 h-5 text-[#0b3b8c]" /> Help Centre
        </h1>
        <p className="text-xs text-slate-500 mt-1">
          How every page you can open works. On any page, the Guide button in the top bar opens just that page's guide.
          For a walk-through, choose "Restart the tour" in your profile menu.
        </p>
      </div>
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm divide-y divide-slate-100" data-testid="help-guides">
        {pages.map(([item, guide]) => (
          <details key={item.id} className="group p-4">
            <summary className="flex items-center justify-between cursor-pointer list-none">
              <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <item.icon className="w-4 h-4 text-slate-500" /> {item.label}
              </span>
              <ChevronDown className="w-4 h-4 text-slate-500 group-open:rotate-180 transition" />
            </summary>
            <div className="mt-3"><GuideBody guide={guide} /></div>
          </details>
        ))}
      </div>
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-5">
        <h2 className="text-sm font-semibold text-slate-900 mb-1">Questions people ask</h2>
        <Faq items={faqFor(role)} />
      </div>
    </div>
  );
}

// /help on the public site, before anyone signs in.
export function PublicHelpPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-10 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Help</h1>
        <p className="text-sm text-slate-600 mt-1">
          Answers about membership, deposits, loans and your account. Already a member?{' '}
          <Link to="/login" className="text-[#0b3b8c] font-semibold">Sign in</Link> for the full Help Centre.
        </p>
      </div>
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-5">
        <Faq items={PUBLIC_FAQ} />
      </div>
    </div>
  );
}
