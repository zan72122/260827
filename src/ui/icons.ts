/**
 * Every control is a picture. Nothing in the game asks a four year old to read,
 * so the buttons carry the object they act on: a flower, a bigger flower, a
 * colour, a place card, an arrow onwards.
 */

const wrap = (inner: string, extra = ''): string =>
  `<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false" ${extra}>${inner}</svg>`;

export const ICONS: Record<string, string> = {
  flowerSmall: wrap(`
    <g fill="none" stroke="#b76c7e" stroke-width="2.4" stroke-linejoin="round">
      <circle cx="24" cy="24" r="4.4" fill="#f6dbe1"/>
      <path d="M24 19.6c0-4 2.2-6.6 5.4-6.6 2.6 0 4.2 2 4.2 4.4 0 3.2-3.4 5.2-6.2 5.6" fill="#f4c3ce"/>
      <path d="M28.4 24c3.8-1.2 7 .2 7.9 3.2.8 2.5-.7 4.6-3 5.3-3 .9-6.1-1.6-7.1-4.3" fill="#f4c3ce"/>
      <path d="M24 28.4c2.4 3.2 2 6.6-.6 8.4-2.1 1.5-4.6.6-5.9-1.3-1.8-2.6-.4-6.2 1.8-7.9" fill="#f4c3ce"/>
      <path d="M19.6 24c-3.8 1.2-7-.2-7.9-3.2-.8-2.5.7-4.6 3-5.3 3-.9 6.1 1.6 7.1 4.3" fill="#f4c3ce"/>
    </g>`),
  flowerLarge: wrap(`
    <g fill="none" stroke="#b76c7e" stroke-width="2.2" stroke-linejoin="round">
      <g opacity="0.95">
        <ellipse cx="24" cy="9.5" rx="6" ry="7.5" fill="#efb1c0"/>
        <ellipse cx="38.5" cy="19" rx="6" ry="7.5" fill="#efb1c0" transform="rotate(72 38.5 19)"/>
        <ellipse cx="33" cy="36" rx="6" ry="7.5" fill="#efb1c0" transform="rotate(144 33 36)"/>
        <ellipse cx="15" cy="36" rx="6" ry="7.5" fill="#efb1c0" transform="rotate(216 15 36)"/>
        <ellipse cx="9.5" cy="19" rx="6" ry="7.5" fill="#efb1c0" transform="rotate(288 9.5 19)"/>
      </g>
      <circle cx="24" cy="24" r="8.6" fill="#f6dbe1"/>
      <path d="M24 18.4c3.4-.6 5.6 1.2 5.6 3.8 0 2.8-2.8 4.6-5.6 4.6" fill="#f4c3ce"/>
    </g>`),
  cardPetal: wrap(`
    <g>
      <rect x="7" y="12" width="34" height="24" rx="3" fill="#fbf5ea" stroke="#c3ab8b" stroke-width="2"/>
      <g fill="#dc93a3">
        <ellipse cx="24" cy="18.6" rx="3.2" ry="4.4"/>
        <ellipse cx="30.2" cy="23.2" rx="3.2" ry="4.4" transform="rotate(72 30.2 23.2)"/>
        <ellipse cx="27.8" cy="30.4" rx="3.2" ry="4.4" transform="rotate(144 27.8 30.4)"/>
        <ellipse cx="20.2" cy="30.4" rx="3.2" ry="4.4" transform="rotate(216 20.2 30.4)"/>
        <ellipse cx="17.8" cy="23.2" rx="3.2" ry="4.4" transform="rotate(288 17.8 23.2)"/>
      </g>
      <circle cx="24" cy="24.6" r="2.6" fill="#f7e3c4"/>
    </g>`),
  cardLeaf: wrap(`
    <g>
      <rect x="7" y="12" width="34" height="24" rx="3" fill="#fbf5ea" stroke="#c3ab8b" stroke-width="2"/>
      <path d="M24 33c-6-2-8-7-7-12 5-1 10 1 12 6 1 4-1 6-5 6z" fill="#8fae74" stroke="#6f8d59" stroke-width="1.6"/>
      <path d="M17.6 21.4C21 24 23.6 27.6 24.6 32" fill="none" stroke="#6f8d59" stroke-width="1.5"/>
    </g>`),
  next: wrap(`
    <g fill="none" stroke="#7a6550" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M18 12l12 12-12 12"/>
    </g>`),
  cakeGo: wrap(`
    <g>
      <path d="M10 30h28v7a3 3 0 0 1-3 3H13a3 3 0 0 1-3-3z" fill="#f3e3cd" stroke="#b79a76" stroke-width="2"/>
      <path d="M10 30c0-4 6-6 14-6s14 2 14 6" fill="#fbf1e2" stroke="#b79a76" stroke-width="2"/>
      <circle cx="24" cy="19.5" r="4" fill="#e8a3b3"/>
      <path d="M24 12v3.4" stroke="#b79a76" stroke-width="2" stroke-linecap="round"/>
    </g>`),
  candleBlow: wrap(`
    <g>
      <rect x="21.4" y="20" width="5.2" height="18" rx="2" fill="#f2e2d6" stroke="#b79a76" stroke-width="1.8"/>
      <path d="M24 8c3 4 4.6 6.2 4.6 8.6A4.6 4.6 0 0 1 24 21a4.6 4.6 0 0 1-4.6-4.4C19.4 14.2 21 12 24 8z" fill="#ffcd7a"/>
      <path d="M6 26c3-2 6-2 8 0" fill="none" stroke="#9fb4c9" stroke-width="2.4" stroke-linecap="round"/>
      <path d="M5 32c4-2.6 8-2.6 11 0" fill="none" stroke="#9fb4c9" stroke-width="2.4" stroke-linecap="round"/>
    </g>`),
  knife: wrap(`
    <g fill="none" stroke="#7a6550" stroke-width="2.2" stroke-linejoin="round">
      <path d="M8 32l22-20 4 4-18 22-8 2z" fill="#dfe3e6"/>
      <path d="M30 12l4 4" />
    </g>`),
  seatSwap: wrap(`
    <g fill="none" stroke="#7a6550" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
      <rect x="9" y="14" width="14" height="10" rx="2" fill="#fbf5ea"/>
      <rect x="25" y="24" width="14" height="10" rx="2" fill="#fbf5ea"/>
      <path d="M23 19h7a4 4 0 0 1 4 4v1"/>
      <path d="M31 27l3-3 3 3" />
    </g>`),
  soundOn: wrap(`
    <g fill="none" stroke="#7a6550" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 20h6l8-6v20l-8-6h-6z" fill="#f0e6d6"/>
      <path d="M31 18c2 2 2 10 0 12"/>
      <path d="M35.5 14.5c4 4 4 15 0 19"/>
    </g>`),
  soundOff: wrap(`
    <g fill="none" stroke="#7a6550" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 20h6l8-6v20l-8-6h-6z" fill="#f0e6d6"/>
      <path d="M31 19l9 10M40 19l-9 10"/>
    </g>`),
};

export function colorSwatchIcon(fill: string): string {
  return `<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">
    <circle cx="24" cy="24" r="15" fill="${fill}" stroke="rgba(0,0,0,0.16)" stroke-width="2"/>
    <path d="M17 19a9 9 0 0 1 8-4" fill="none" stroke="rgba(255,255,255,0.75)" stroke-width="3" stroke-linecap="round"/>
  </svg>`;
}
