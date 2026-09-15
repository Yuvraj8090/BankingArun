import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CheckCircle2, ChevronRight, FileText, Lock, UserPlus, Info } from 'lucide-react';
import { GROUP_LABEL, productAt } from '../data/products';
import { api } from '../services/api';

// One public page per navbar/footer link, at its own URL (e.g. /loans/home-loan).
export default function ProductPage() {
  const { group, slug } = useParams();
  const product = productAt(group, slug);
  // A product that depends on an authorisation this institution does not hold
  // must not be advertised as available. The public features list says which.
  const [features, setFeatures] = useState(null);
  useEffect(() => {
    api.publicFeatures().then((d) => setFeatures(d.features)).catch(() => setFeatures([]));
  }, []);
  const unavailable = product?.requires && Array.isArray(features) && !features.includes(product.requires);

  if (!product) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-20 text-center">
        <h1 className="text-2xl font-bold text-slate-900">We couldn't find that page</h1>
        <p className="text-sm text-slate-600 mt-2">The product you followed may have moved.</p>
        <Link to="/" className="inline-block mt-6 px-5 py-2.5 rounded-md bg-[#0b3b8c] text-white text-xs font-semibold">
          Back to home
        </Link>
      </div>
    );
  }

  return (
    <div className="bg-slate-50">
      {unavailable && (
        <div className="bg-amber-50 border-b border-amber-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-start gap-2.5">
            <Info className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-900 leading-relaxed">
              <strong>Not currently offered.</strong> This service needs an authorisation that Aadhunik Jeewan
              Sanchay Nidhi Limited does not presently hold, so it is not available to members. The description
              below is kept for reference only. Please speak to your branch about what is available today.
            </p>
          </div>
        </div>
      )}
      <section className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <nav className="flex items-center gap-1.5 text-[11px] text-slate-500" aria-label="Breadcrumb">
            <Link to="/" className="hover:text-[#0b3b8c]">Home</Link>
            <ChevronRight className="w-3 h-3" />
            <span className="text-slate-700">{GROUP_LABEL[group] || 'Products'}</span>
            <ChevronRight className="w-3 h-3" />
            <span className="text-slate-900 font-semibold">{product.title}</span>
          </nav>

          <h1 data-testid="product-title" className="text-3xl sm:text-4xl font-bold text-slate-900 mt-4 tracking-tight">
            {product.title}
          </h1>
          <p className="text-base text-[#0b3b8c] font-semibold mt-2">{product.tagline}</p>
          <p className="text-sm text-slate-600 mt-4 max-w-3xl leading-relaxed">{product.summary}</p>

          <div className="flex flex-wrap gap-3 mt-6">
            <Link
              to="/open-account"
              data-testid="product-open-account"
              className="px-5 py-2.5 rounded-md bg-[#0b3b8c] hover:bg-[#092e6f] text-white text-xs font-semibold flex items-center gap-2"
            >
              <UserPlus className="w-3.5 h-3.5" /> Open an account
            </Link>
            <Link
              to="/login"
              className="px-5 py-2.5 rounded-md border border-slate-300 bg-white hover:border-[#0b3b8c] text-slate-800 text-xs font-semibold flex items-center gap-2"
            >
              <Lock className="w-3.5 h-3.5" /> member portal login
            </Link>
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white border border-slate-200 rounded-lg p-6">
            <h2 className="text-sm font-semibold text-slate-900">What you get</h2>
            <ul className="mt-4 grid sm:grid-cols-2 gap-3">
              {product.highlights.map((item) => (
                <li key={item} className="flex items-start gap-2 text-xs text-slate-700">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" /> {item}
                </li>
              ))}
            </ul>
          </div>

          {product.documents && (
            <div className="bg-white border border-slate-200 rounded-lg p-6">
              <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <FileText className="w-4 h-4 text-[#0b3b8c]" /> What to keep ready
              </h2>
              <ul className="mt-3 space-y-1.5 text-xs text-slate-700 list-disc list-inside">
                {product.documents.map((doc) => <li key={doc}>{doc}</li>)}
              </ul>
            </div>
          )}
        </div>

        <aside className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-5 py-3 bg-[#0b3b8c] text-white text-xs font-semibold">Key details</div>
            <table className="w-full text-xs">
              <tbody className="divide-y divide-slate-100">
                {product.facts.map(([label, value]) => (
                  <tr key={label}>
                    <td className="px-5 py-3 text-slate-600">{label}</td>
                    <td className="px-5 py-3 text-right font-semibold text-slate-900">{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Rates and charges shown are indicative and can change. See{' '}
            <Link to="/rates" className="text-[#0b3b8c] font-semibold hover:underline">Rates &amp; Charges</Link> for the
            current schedule.
          </p>
          {product.note && <p className="text-[11px] text-slate-600 bg-amber-50 border border-amber-200 rounded-md p-3">{product.note}</p>}
        </aside>
      </section>
    </div>
  );
}
