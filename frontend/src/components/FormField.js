import React from 'react';
import { Eye, EyeOff } from 'lucide-react';

// A labelled input that owns its value/onChange, unlike Modal.js's Field
// (which just wraps whatever input you hand it as children). Several admin
// pages had each defined their own copy of this; kept here so a fix to one
// reaches all of them.
export function ValueField({ label, value, onChange, type = 'text', testId, disabled }) {
  return (
    <div>
      <label className="block text-[11px] text-slate-600 mb-1">{label}</label>
      <input type={type} value={value} disabled={disabled} data-testid={testId}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm text-slate-900 disabled:bg-slate-50 disabled:text-slate-500" />
    </div>
  );
}

// options as [value, label] pairs, not a flat list -- CrmPage's own Select
// (flat strings, value === label) is a different shape and stays local there.
export function PairSelect({ label, value, options, onChange, testId, disabled }) {
  return (
    <div>
      <label className="block text-[11px] text-slate-600 mb-1">{label}</label>
      <select value={value} disabled={disabled} data-testid={testId} onChange={(e) => onChange(e.target.value)}
        className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm text-slate-900 bg-white disabled:bg-slate-50 disabled:text-slate-500">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}

export function PlainInput({ label, value, onChange, type = 'text', placeholder, testId }) {
  return (
    <div>
      <label className="block text-[11px] text-slate-600 mb-1">{label}</label>
      <input type={type} value={value ?? ''} placeholder={placeholder} data-testid={testId}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm text-slate-900" />
    </div>
  );
}

// A password/secret field with a show/hide toggle -- the value is masked by
// default so it isn't left readable on screen (e.g. during a screen share).
export function SecretInput({ label, value, onChange, show, onToggle, placeholder, testId }) {
  return (
    <div>
      <label className="block text-[11px] text-slate-600 mb-1">{label}</label>
      <div className="relative">
        <input type={show ? 'text' : 'password'} value={value} placeholder={placeholder} data-testid={testId}
          onChange={(e) => onChange(e.target.value)}
          className="w-full border border-slate-200 rounded-md px-3 py-2 pr-10 text-sm text-slate-900 font-mono" />
        <button type="button" onClick={onToggle}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-500 hover:text-slate-700">
          {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );
}
