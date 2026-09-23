import React, { useRef, useState } from 'react';
import { Upload, FileText, X, RefreshCw, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../services/api';

// Accepted here as well as on the server. This is for the member's benefit — so a
// wrong file is caught before a slow upload — never as the actual guard.
const ACCEPTED = ['image/jpeg', 'image/png', 'application/pdf'];
const MAX_BYTES = 3 * 1024 * 1024;

const readAsDataUri = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(file);
});

// `upload` is how the same control serves two places: a member uploading their
// own file, and a teller building an applicant's file against an enquiry that
// has no member account behind it yet.
export default function DocumentUpload({ kind, label, hint, existing, onUploaded, upload: send = api.kycDocumentUpload }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  const choose = async (e) => {
    const picked = e.target.files?.[0];
    e.target.value = '';           // so choosing the same file twice still fires
    if (!picked) return;
    if (!ACCEPTED.includes(picked.type)) {
      return toast.error('Please choose a JPEG, PNG or PDF.');
    }
    if (picked.size > MAX_BYTES) {
      return toast.error(`${picked.name} is ${(picked.size / 1048576).toFixed(1)} MB. The limit is 3 MB.`);
    }
    try {
      const dataUri = await readAsDataUri(picked);
      setFile(picked);
      setPreview(dataUri);
    } catch {
      toast.error('That file could not be read. Please try another.');
    }
  };

  const upload = async () => {
    if (!file || !preview) return;
    setBusy(true);
    try {
      const r = await send({ kind, file_name: file.name, content: preview });
      toast.success(r.message);
      setFile(null);
      setPreview(null);
      onUploaded?.(r);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Upload failed. Please try again.');
    } finally { setBusy(false); }
  };

  const clear = () => { setFile(null); setPreview(null); };
  const isImage = file?.type?.startsWith('image/');

  return (
    <div>
      <label className="block text-slate-500 mb-1 text-xs">{label}</label>

      {existing && !file && (
        <div className="flex items-center gap-2 p-2 mb-2 rounded-lg bg-emerald-50 border border-emerald-200 text-[11px] text-emerald-800">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          <span className="flex-1 truncate">
            {existing.file_name || existing.kind} — {existing.status === 'pending_review' ? 'awaiting review' : existing.status}
          </span>
        </div>
      )}

      {!file ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          data-testid={`kyc-choose-${kind}`}
          className="w-full flex items-center justify-center gap-2 px-3 py-3 rounded-xl border border-dashed
            border-slate-300 bg-slate-50 text-[#0b3b8c] text-xs font-semibold
            hover:border-[#0b3b8c] hover:bg-blue-50 transition"
        >
          <Upload className="w-4 h-4" /> {existing ? 'Replace document' : 'Choose file'}
        </button>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white p-2.5 space-y-2.5">
          {/* The point of the preview: the member sees the file they picked
              before it is sent, and catches the wrong photo themselves. */}
          <div className="flex items-start gap-2.5">
            {isImage ? (
              <img src={preview} alt={file.name}
                data-testid={`kyc-preview-${kind}`}
                className="w-20 h-20 object-cover rounded-lg border border-slate-200 shrink-0" />
            ) : (
              <div data-testid={`kyc-preview-${kind}`}
                className="w-20 h-20 rounded-lg border border-slate-200 bg-slate-50 flex flex-col items-center justify-center gap-1 shrink-0">
                <FileText className="w-6 h-6 text-[#c8102e]" />
                <span className="text-[9px] font-semibold text-slate-500">PDF</span>
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-slate-900 truncate">{file.name}</p>
              <p className="text-[11px] text-slate-500">{(file.size / 1024).toFixed(0)} KB</p>
              <button type="button" onClick={clear} data-testid={`kyc-remove-${kind}`}
                className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-[#c8102e]">
                <X className="w-3 h-3" /> Remove
              </button>
            </div>
          </div>
          <button type="button" onClick={upload} disabled={busy}
            data-testid={`kyc-upload-${kind}`}
            className="w-full py-2 rounded-lg bg-[#0b3b8c] hover:bg-[#092e6f] text-white text-xs font-semibold
              flex items-center justify-center gap-1.5 disabled:opacity-50 transition">
            {busy ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Uploading…</> : <><Upload className="w-3.5 h-3.5" /> Upload for verification</>}
          </button>
        </div>
      )}

      <input ref={inputRef} type="file" className="hidden"
        accept="image/jpeg,image/png,application/pdf" onChange={choose} />
      {hint && <p className="text-[10px] text-slate-500 mt-1">{hint}</p>}
    </div>
  );
}
