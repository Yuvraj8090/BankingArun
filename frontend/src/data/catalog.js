import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { PRODUCTS as BUNDLED } from './products';

// The product pages are editable from the admin panel, so their content comes
// from the server. The copy bundled at build time stays as the fallback: if the
// request fails the public site shows what it always showed rather than nothing.
let cache = null;

const byPath = (products) =>
  products.reduce((acc, product) => ({ ...acc, [product.path]: product }), {});

export async function loadCatalog() {
  if (cache) return cache;
  try {
    const { products } = await api.publicProducts();
    // An empty table would blank every public page; treat that as a failure too.
    cache = products && products.length ? byPath(products) : BUNDLED;
  } catch {
    cache = BUNDLED;
  }
  return cache;
}

// Synchronous view for first paint, replaced once the request lands.
export function useCatalog() {
  const [catalog, setCatalog] = useState(cache || BUNDLED);
  useEffect(() => {
    let live = true;
    loadCatalog().then((loaded) => { if (live) setCatalog(loaded); });
    return () => { live = false; };
  }, []);
  return catalog;
}
