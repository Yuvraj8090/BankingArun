import React, { useEffect, useState } from 'react';
import { FileText, RefreshCw, Plus, Save, Trash2, Pencil, Info, ExternalLink, X } from 'lucide-react';
import { api } from '../services/api';
import Modal from '../components/Modal';
import { useAuth } from '../context/AuthContext';
import { GROUP_LABEL } from '../data/products';
import { toast } from 'sonner';

const BLANK = {
  group: 'personal', slug: '', title: '', tagline: '', summary: '',
  highlights: [], facts: [], documents: [], note: '', requires: '', sort_order: 0, status: 'active'
};

const input = 'w-full border border-slate-200 rounded-md px-3 py-2 text-xs outline-none focus:border-[#0b3b8c]';

// A list of plain strings — highlights, or the documents a member must bring.
function StringList({ label, hint, values, onChange, placeholder }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-slate-500 text-xs">{label}</span>
        <button type="button" onClick={() => onChange([...values, ''])}
          className="text-[11px] font-semibold text-[#0b3b8c] flex items-center gap-1">
          <Plus className="w-3 h-3" /> Add
        </button>
      </div>
      <div className="space-y-1.5">
        {values.map((value, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input className={input} value={value} placeholder={placeholder}
              onChange={(e) => onChange(values.map((v, j) => (j === i ? e.target.value : v)))} />
            <button type="button" onClick={() => onChange(values.filter((_, j) => j !== i))}
              className="p-2 rounded-md border border-slate-200 text-slate-500 hover:text-[#c8102e] hover:border-[#c8102e] shrink-0">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        {!values.length && <p className="text-[11px] text-slate-500">None yet.</p>}
      </div>
      {hint && <p className="text-[10px] text-slate-500 mt-1">{hint}</p>}
    </div>
  );
}

// The key-figures table: each row is a label and its value.
function FactList({ values, onChange }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-slate-500 text-xs">Key details table</span>
        <button type="button" onClick={() => onChange([...values, ['', '']])}
          className="text-[11px] font-semibold text-[#0b3b8c] flex items-center gap-1">
          <Plus className="w-3 h-3" /> Add row
        </button>
      </div>
      <div className="space-y-1.5">
        {values.map((pair, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input className={`${input} max-w-[40%]`} value={pair[0]} placeholder="Interest rate"
              onChange={(e) => onChange(values.map((p, j) => (j === i ? [e.target.value, p[1]] : p)))} />
            <input className={input} value={pair[1]} placeholder="4.00% p.a."
              onChange={(e) => onChange(values.map((p, j) => (j === i ? [p[0], e.target.value] : p)))} />
            <button type="button" onClick={() => onChange(values.filter((_, j) => j !== i))}
              className="p-2 rounded-md border border-slate-200 text-slate-500 hover:text-[#c8102e] hover:border-[#c8102e] shrink-0">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        {!values.length && <p className="text-[11px] text-slate-500">No rows yet.</p>}
      </div>
    </div>
  );
}

// Every public product page, editable. A change here is live on the public site
// as soon as it is saved.
// Three sections instead of one long column: Basics is what most edits touch,
// the other two grow without bound (a highlight/fact/document row at a time)
// and would otherwise push Save further down every time a page picks up
// another bullet point.
const SECTIONS = [
  { key: 'basics', label: 'Basics' },
  { key: 'content', label: 'Highlights & Details' },
  { key: 'documents', label: 'Documents & Settings' },
];

export default function ProductAdminPage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'bank_owner';
  const [products, setProducts] = useState(null);
  const [groups, setGroups] = useState(Object.keys(GROUP_LABEL));
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [section, setSection] = useState('basics');

  const load = async () => {
    try {
      const r = await api.productsList();
      setProducts(r.products);
      if (r.groups?.length) setGroups(r.groups);
    } catch (e) { toast.error(e.response?.data?.detail || 'Could not load pages'); }
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    try {
      const r = form.id ? await api.productUpdate(form.id, form) : await api.productCreate(form);
      toast.success(r.message);
      setForm(null);
      load();
    } catch (e) { toast.error(e.response?.data?.detail || 'Save failed'); }
    finally { setSaving(false); }
  };

  const remove = async (product) => {
    if (!window.confirm(`Remove /${product.path}? The public page stops existing.`)) return;
    try { toast.success((await api.productDelete(product.id)).message); load(); }
    catch (e) { toast.error(e.response?.data?.detail || 'Delete failed'); }
  };

  if (!products) {
    return <div className="p-10 flex items-center gap-2 text-slate-600"><RefreshCw className="w-4 h-4 animate-spin" /> Loading pages…</div>;
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-md bg-[#0b3b8c] text-white flex items-center justify-center"><FileText className="w-5 h-5" /></div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Public Pages</h1>
            <p className="text-xs text-slate-500">{products.length} product page{products.length === 1 ? '' : 's'} on the public site</p>
          </div>
        </div>
        {canEdit && (
          <button data-testid="product-new-btn" onClick={() => { setForm({ ...BLANK }); setSection('basics'); }}
            className="px-4 py-2 rounded-md bg-[#0b3b8c] text-white text-xs font-semibold flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" /> New page
          </button>
        )}
      </div>

      <div className="flex items-start gap-2 p-3 rounded-md bg-slate-50 border border-slate-200 text-[11px] text-slate-700">
        <Info className="w-4 h-4 shrink-0 mt-0.5 text-[#0b3b8c]" />
        <p>
          These are the pages visitors read before they join. A page set to <strong>draft</strong> disappears from the
          public site and from search without being deleted. A page whose service the institution is not authorised to
          offer still shows a notice to that effect, whatever is written here.
        </p>
      </div>

      {groups.map((group) => {
        const inGroup = products.filter((p) => p.group === group);
        if (!inGroup.length) return null;
        return (
          <div key={group} className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">{GROUP_LABEL[group] || group}</h2>
              <span className="text-[11px] text-slate-500 font-mono">/{group}</span>
            </div>
            <div className="divide-y divide-slate-100">
              {inGroup.map((p) => (
                <div key={p.id} data-testid={`product-row-${p.slug}`} className="p-4 flex items-start justify-between gap-4 hover:bg-slate-50">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-slate-900 text-xs">{p.title}</span>
                      {p.status !== 'active' && (
                        <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">draft</span>
                      )}
                      {p.requires && (
                        <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                          needs {p.requires}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono mt-0.5">/{p.path}</div>
                    <p className="text-[11px] text-slate-600 mt-1 line-clamp-2">{p.tagline}</p>
                    <p className="text-[10px] text-slate-500 mt-1">
                      {p.highlights.length} highlights · {p.facts.length} detail rows · {p.documents.length} documents
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <a href={`/${p.path}`} target="_blank" rel="noreferrer" title="Open the public page"
                      className="p-1.5 rounded-md border border-slate-200 text-slate-600 hover:border-[#0b3b8c] hover:text-[#0b3b8c]">
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                    {canEdit && <>
                      <button data-testid={`product-edit-${p.slug}`} onClick={() => { setForm({ ...BLANK, ...p }); setSection('basics'); }} title="Edit"
                        className="p-1.5 rounded-md border border-slate-200 text-slate-600 hover:border-[#0b3b8c] hover:text-[#0b3b8c]">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button data-testid={`product-delete-${p.slug}`} onClick={() => remove(p)} title="Remove"
                        className="p-1.5 rounded-md border border-slate-200 text-slate-600 hover:border-[#c8102e] hover:text-[#c8102e]">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {form && (
        <Modal
          testId="product-modal"
          wide
          title={form.id ? `Edit ${form.title}` : 'New public page'}
          subtitle={form.group && form.slug ? `Lives at /${form.group}/${form.slug}` : 'Choose a section and an address for the page.'}
          onClose={() => setForm(null)}
          footer={<>
            <button onClick={() => setForm(null)}
              className="px-4 py-2 rounded-md border border-slate-200 text-xs font-semibold text-slate-700">Cancel</button>
            <button data-testid="product-save-btn" disabled={saving} onClick={save}
              className="px-5 py-2 rounded-md bg-[#0b3b8c] text-white text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50">
              {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save page
            </button>
          </>}
        >
          <div className="text-xs">
            <div className="flex gap-1 border-b border-slate-200 mb-4">
              {SECTIONS.map((s) => (
                <button key={s.key} type="button" data-testid={`product-section-${s.key}`}
                  onClick={() => setSection(s.key)}
                  className={`px-3 py-2 text-[11px] font-semibold border-b-2 -mb-px transition ${
                    section === s.key ? 'border-[#0b3b8c] text-[#0b3b8c]' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
                  {s.label}
                </button>
              ))}
            </div>

            {section === 'basics' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <label className="block">
                    <span className="block text-slate-500 mb-1">Section</span>
                    <select className={input} value={form.group} data-testid="product-group"
                      onChange={(e) => setForm({ ...form, group: e.target.value })}>
                      {groups.map((g) => <option key={g} value={g}>{GROUP_LABEL[g] || g}</option>)}
                    </select>
                  </label>
                  <label className="block">
                    <span className="block text-slate-500 mb-1">Address</span>
                    <input className={`${input} font-mono`} value={form.slug} data-testid="product-slug" placeholder="savings-account"
                      onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })} />
                  </label>
                  <label className="block">
                    <span className="block text-slate-500 mb-1">Visibility</span>
                    <select className={input} value={form.status}
                      onChange={(e) => setForm({ ...form, status: e.target.value })}>
                      <option value="active">Live on the public site</option>
                      <option value="draft">Draft — hidden</option>
                    </select>
                  </label>
                </div>

                <label className="block">
                  <span className="block text-slate-500 mb-1">Title</span>
                  <input className={input} value={form.title} data-testid="product-title-input"
                    onChange={(e) => setForm({ ...form, title: e.target.value })} />
                </label>
                <label className="block">
                  <span className="block text-slate-500 mb-1">Tagline</span>
                  <input className={input} value={form.tagline} placeholder="Everyday banking with interest paid quarterly."
                    onChange={(e) => setForm({ ...form, tagline: e.target.value })} />
                </label>
                <label className="block">
                  <span className="block text-slate-500 mb-1">Summary</span>
                  <textarea rows={4} className={input} value={form.summary}
                    onChange={(e) => setForm({ ...form, summary: e.target.value })} />
                </label>
              </div>
            )}

            {section === 'content' && (
              <div className="space-y-4">
                <StringList label="Highlights" placeholder="Interest credited every quarter"
                  values={form.highlights} onChange={(highlights) => setForm({ ...form, highlights })} />
                <FactList values={form.facts} onChange={(facts) => setForm({ ...form, facts })} />
              </div>
            )}

            {section === 'documents' && (
              <div className="space-y-4">
                <StringList label="Documents to bring" placeholder="PAN card"
                  values={form.documents} onChange={(documents) => setForm({ ...form, documents })} />

                <label className="block">
                  <span className="block text-slate-500 mb-1">Footnote <span className="text-slate-500">(optional)</span></span>
                  <textarea rows={2} className={input} value={form.note || ''}
                    onChange={(e) => setForm({ ...form, note: e.target.value })} />
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="block">
                    <span className="block text-slate-500 mb-1">Requires authorisation <span className="text-slate-500">(optional)</span></span>
                    <input className={`${input} font-mono`} value={form.requires || ''} placeholder="debit_cards"
                      onChange={(e) => setForm({ ...form, requires: e.target.value })} />
                    <span className="block text-[10px] text-slate-500 mt-1">
                      Shows a "not currently offered" notice unless the institution holds this authorisation.
                    </span>
                  </label>
                  <label className="block">
                    <span className="block text-slate-500 mb-1">Order within the section</span>
                    <input className={input} type="number" value={form.sort_order}
                      onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} />
                  </label>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
