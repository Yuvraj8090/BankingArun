import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronRight, ArrowRight } from 'lucide-react';
import { GROUP_LABEL, PRODUCTS } from '../data/products';

// The landing page for a product group, at /loans, /personal and so on. It gives
// the middle breadcrumb on every product page somewhere real to point.
export default function GroupPage() {
  const { group } = useParams();
  const label = GROUP_LABEL[group];
  const products = Object.entries(PRODUCTS)
    .filter(([path]) => path.startsWith(`${group}/`))
    .map(([path, product]) => ({ path, ...product }));

  if (!label || products.length === 0) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-20 text-center">
        <h1 className="text-2xl font-bold text-slate-900">We couldn't find that page</h1>
        <p className="text-sm text-slate-600 mt-2">The section you followed may have moved.</p>
        <Link to="/" className="inline-block mt-6 px-5 py-2.5 rounded-md bg-[#0b3b8c] text-white text-xs font-semibold">
          Back to home
        </Link>
      </div>
    );
  }

  return (
    <div className="bg-slate-50 min-h-screen">
      <section className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <nav className="flex items-center gap-1.5 text-[11px] text-slate-500" aria-label="Breadcrumb">
            <Link to="/" className="hover:text-[#0b3b8c]">Home</Link>
            <ChevronRight className="w-3 h-3 shrink-0" />
            <span className="text-slate-900 font-semibold">{label}</span>
          </nav>
          <h1 data-testid="group-title" className="text-3xl sm:text-4xl font-bold text-slate-900 mt-4 tracking-tight">
            {label}
          </h1>
          <p className="text-sm text-slate-600 mt-3 max-w-3xl leading-relaxed">
            {products.length} {products.length === 1 ? 'service' : 'services'} for members. Open any of them
            online with PAN and Aadhaar, and finish verification by video KYC.
          </p>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {products.map((product) => (
            <Link
              key={product.path}
              to={`/${product.path}`}
              data-testid={`group-product-${product.path.split('/')[1]}`}
              className="group bg-white border border-slate-200 rounded-lg p-5 hover:border-[#0b3b8c] hover:shadow-sm transition flex flex-col"
            >
              <h2 className="text-sm font-semibold text-slate-900">{product.title}</h2>
              <p className="text-xs text-[#0b3b8c] font-medium mt-1">{product.tagline}</p>
              <p className="text-xs text-slate-600 mt-3 leading-relaxed line-clamp-3 flex-1">{product.summary}</p>
              <span className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-[#0b3b8c]">
                Read more
                <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
