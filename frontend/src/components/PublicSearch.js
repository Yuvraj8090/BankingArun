import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { PRODUCTS, GROUP_LABEL } from '../data/products';
import SearchBox from './SearchBox';

// The public site searches the product catalogue itself, so a visitor who types
// "home lone" or "fixed deposite" reaches the right product page.
export default function PublicSearch() {
  const navigate = useNavigate();
  const items = useMemo(
    () => Object.entries(PRODUCTS).map(([path, product]) => ({
      key: path,
      label: product.title,
      hint: GROUP_LABEL[path.split('/')[0]],
      keywords: [product.tagline, GROUP_LABEL[path.split('/')[0]], path.split('/')[1].replace(/-/g, ' ')]
    })),
    []
  );

  return (
    <SearchBox
      items={items}
      onPick={(item) => navigate(`/${item.key}`)}
      placeholder="Search products, services, FAQs…"
      testId="public-search-input"
    />
  );
}
