import React from 'react';

// The one approved logo, in its three official lockups.
const SOURCES = {
  full: '/brand/ajs-logo-horizontal.png',        // wordmark + tagline
  compact: '/brand/ajs-logo-horizontal-compact.png', // wordmark, no tagline (small sizes)
  stacked: '/brand/ajs-logo-stacked.png',
  mark: '/brand/ajs-mark-512.png'
};

export default function Brand({ variant = 'compact', className = '', height = 40, onDark = false }) {
  const logo = (
    <img
      src={SOURCES[variant] || SOURCES.compact}
      alt="Aadhunik Jeewan Sanchay Nidhi Limited"
      style={{ height }}
      className={`w-auto ${onDark ? '' : className}`}
      draggable="false"
    />
  );
  // The artwork is navy and gold, so on dark surfaces it sits on a white plate.
  return onDark
    ? <span className={`inline-flex items-center bg-white rounded-md px-3 py-2 ${className}`}>{logo}</span>
    : logo;
}
