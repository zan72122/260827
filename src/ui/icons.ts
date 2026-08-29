/** Small inline glyphs. Every control is legible without reading a word. */

const wrap = (inner: string): string =>
  `<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">${inner}</svg>`;

export const ICONS: Record<string, string> = {
  hook: wrap(
    '<path d="M24 4v16" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round"/>' +
      '<path d="M24 20a8 8 0 1 0 8 8" stroke="currentColor" stroke-width="4" fill="none" stroke-linecap="round"/>' +
      '<rect x="18" y="16" width="12" height="6" rx="2" fill="currentColor"/>',
  ),
  lever: wrap(
    '<rect x="18" y="30" width="12" height="12" rx="3" fill="currentColor"/>' +
      '<path d="M24 30V12" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>' +
      '<circle cx="24" cy="10" r="6" fill="currentColor"/>',
  ),
  drum: wrap(
    '<circle cx="24" cy="24" r="14" fill="none" stroke="currentColor" stroke-width="4"/>' +
      '<path d="M24 10v8M24 30v8M10 24h8M30 24h8" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>',
  ),
  strap: wrap(
    '<rect x="6" y="18" width="36" height="12" rx="3" fill="none" stroke="currentColor" stroke-width="4"/>' +
      '<path d="M18 18v12M30 18v12" stroke="currentColor" stroke-width="3"/>',
  ),
  reel: wrap(
    '<circle cx="24" cy="24" r="13" fill="none" stroke="currentColor" stroke-width="4"/>' +
      '<circle cx="24" cy="24" r="4" fill="currentColor"/>' +
      '<path d="M24 11v6M37 24h-6" stroke="currentColor" stroke-width="3"/>',
  ),
  winch: wrap(
    '<rect x="10" y="26" width="28" height="12" rx="3" fill="none" stroke="currentColor" stroke-width="4"/>' +
      '<path d="M24 26V8" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>' +
      '<path d="M17 15l7-7 7 7" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
  ),
  plug: wrap(
    '<rect x="4" y="18" width="16" height="12" rx="3" fill="currentColor"/>' +
      '<rect x="28" y="18" width="16" height="12" rx="3" fill="none" stroke="currentColor" stroke-width="4"/>' +
      '<path d="M20 24h8" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>',
  ),
  star: wrap(
    '<path d="M24 6l5.3 11.4L42 19l-9 8.6L35.2 40 24 33.8 12.8 40 15 27.6 6 19l12.7-1.6z" ' +
      'fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/>',
  ),
  handle: wrap(
    '<rect x="8" y="28" width="32" height="12" rx="4" fill="none" stroke="currentColor" stroke-width="4"/>' +
      '<rect x="20" y="8" width="8" height="20" rx="4" fill="currentColor"/>',
  ),
  tagline: wrap(
    '<path d="M8 40C16 20 32 28 40 8" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>' +
      '<circle cx="8" cy="40" r="5" fill="currentColor"/>',
  ),
  replay: wrap(
    '<path d="M38 24a14 14 0 1 1-4.1-9.9" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>' +
      '<path d="M38 8v10H28" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
  ),
};
