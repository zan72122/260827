/**
 * Pictograms. Everything a four-year-old must understand is carried by the
 * drawing; the short hiragana line beside it is a bonus for a reading adult.
 */

const S = (body: string, extra = '') =>
  `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.4"
    stroke-linecap="round" stroke-linejoin="round" ${extra}>${body}</svg>`

export const ICONS: Record<string, string> = {
  house: S(`
    <path d="M10 24 24 12l14 12" stroke="#e6b168"/>
    <path d="M13 23v13h22V23" stroke="#efe7d8"/>
    <rect x="20" y="27" width="8" height="9" rx="1" stroke="#c98c4a"/>
    <path d="M31 15v-3h3v6" stroke="#b9a48a"/>`),

  fir: S(`
    <path d="M24 9 16 22h16z" stroke="#6fbf8a"/>
    <path d="M24 17 14 31h20z" stroke="#6fbf8a"/>
    <path d="M21 31h6v7h-6z" stroke="#a97c4d"/>`),

  lamp: S(`
    <path d="M24 41V19" stroke="#cfd6dc"/>
    <path d="M18 41h12" stroke="#cfd6dc"/>
    <path d="M19 19h10l-2-8h-6z" stroke="#ffd28a" fill="rgba(255,205,130,0.28)"/>
    <path d="M24 7v3" stroke="#ffd28a"/>`),

  bridge: S(`
    <path d="M7 32c6-13 28-13 34 0" stroke="#d59a63"/>
    <path d="M7 32v6M17 27v9M31 27v9M41 32v6" stroke="#b9835a"/>
    <path d="M5 38h38" stroke="#8f6a4c"/>`),

  snowman: S(`
    <circle cx="24" cy="33" r="8" stroke="#eef4fa"/>
    <circle cx="24" cy="20" r="5.5" stroke="#eef4fa"/>
    <path d="M18 14h12" stroke="#d76a5c"/>
    <path d="M20 12h8v-3h-8z" stroke="#4b535c"/>
    <path d="M24 20l4 1.5" stroke="#e08a3c"/>`),

  deer: S(`
    <path d="M14 32V22c0-3 3-5 7-5h6c4 0 7 2 7 5v10" stroke="#c99a66"/>
    <path d="M16 32v6M22 32v6M30 32v6M34 32v6" stroke="#a87b52"/>
    <path d="M34 20l3-6M34 20l-2-6" stroke="#8a6440"/>`),

  centerTree: S(`
    <path d="M24 6 15 20h18z" stroke="#6fbf8a"/>
    <path d="M24 14 12 30h24z" stroke="#6fbf8a"/>
    <path d="M21 30h6v8h-6z" stroke="#a97c4d"/>
    <circle cx="24" cy="6" r="2.4" stroke="#ffd98a" fill="rgba(255,217,138,0.35)"/>`),

  ok: S(`<path d="M10 25l9 9 19-20" stroke="#8fd6a0" stroke-width="4"/>`),

  undo: S(`
    <path d="M14 18h16a9 9 0 1 1 0 18H19" stroke="#e0d7c6"/>
    <path d="M20 12l-7 6 7 6" stroke="#e0d7c6"/>`),

  scoop: S(`
    <path d="M10 20a10 8 0 0 0 20 0z" stroke="#dcb26a"/>
    <path d="M30 18l9-6" stroke="#a98a5e"/>
    <path d="M16 30l1 5M22 32l1 5M28 30l1 5" stroke="#eaf3fb"/>`),

  pump: S(`
    <rect x="16" y="18" width="16" height="22" rx="3" stroke="#a9c8d6"/>
    <path d="M20 26h8" stroke="#88b2c4"/>
    <rect x="20" y="9" width="8" height="6" rx="2" stroke="#cfd6dc"/>
    <path d="M24 15v3" stroke="#cfd6dc"/>
    <path d="M24 4v3" stroke="#8fd6ff"/>`),

  gasket: S(`
    <ellipse cx="24" cy="26" rx="14" ry="7" stroke="#9aa3ad"/>
    <ellipse cx="24" cy="26" rx="7" ry="3.4" stroke="#6f7780"/>
    <path d="M24 8v10" stroke="#8fd6a0"/>
    <path d="M20 14l4 4 4-4" stroke="#8fd6a0"/>`),

  collar: S(`
    <circle cx="24" cy="26" r="11" stroke="#dcb26a"/>
    <path d="M24 15v-5" stroke="#dcb26a"/>
    <path d="M33 9a17 17 0 0 1 5 12" stroke="#8fd6a0"/>
    <path d="M39 15l-1 6-6-1" stroke="#8fd6a0"/>`),

  flip: S(`
    <circle cx="24" cy="28" r="10" stroke="#a9c8d6"/>
    <path d="M8 20A18 18 0 0 1 40 20" stroke="#8fd6a0"/>
    <path d="M40 13v8h-8" stroke="#8fd6a0"/>`),

  mount: S(`
    <circle cx="24" cy="18" r="9" stroke="#a9c8d6"/>
    <path d="M12 34h24l-3-6H15z" stroke="#c08b52"/>
    <path d="M10 40h28" stroke="#8a5f39"/>`),

  shake: S(`
    <circle cx="24" cy="24" r="11" stroke="#a9c8d6"/>
    <path d="M8 24H2M2 24l4-4M2 24l4 4" stroke="#8fd6a0"/>
    <path d="M40 24h6M46 24l-4-4M46 24l-4 4" stroke="#8fd6a0"/>
    <path d="M20 20l1 3M27 17l1 3M24 27l1 3" stroke="#ffffff"/>`),

  tap: S(`
    <circle cx="24" cy="22" r="11" stroke="#a9c8d6"/>
    <path d="M24 30v10" stroke="#efe7d8"/>
    <circle cx="24" cy="22" r="3.6" fill="#8fd6a0" stroke="#8fd6a0"/>`),

  enter: S(`
    <circle cx="26" cy="24" r="13" stroke="#a9c8d6"/>
    <path d="M4 24h20" stroke="#8fd6a0"/>
    <path d="M18 18l6 6-6 6" stroke="#8fd6a0"/>`),

  again: S(`
    <path d="M38 24a14 14 0 1 1-4-9.8" stroke="#8fd6a0"/>
    <path d="M38 6v9h-9" stroke="#8fd6a0"/>
    <path d="M20 22l1 3M27 20l1 3" stroke="#ffffff"/>`),

  rearrange: S(`
    <rect x="8" y="8" width="13" height="13" rx="3" stroke="#e6b168"/>
    <rect x="27" y="27" width="13" height="13" rx="3" stroke="#e6b168"/>
    <path d="M26 14h9v9" stroke="#8fd6a0"/>
    <path d="M22 34h-9v-9" stroke="#8fd6a0"/>`),

  newGlobe: S(`
    <circle cx="24" cy="20" r="11" stroke="#a9c8d6"/>
    <path d="M13 34h22l-3 6H16z" stroke="#c08b52"/>
    <path d="M24 14v12M18 20h12" stroke="#8fd6a0"/>`),

  shelf: S(`
    <path d="M6 16h36M6 32h36" stroke="#a97c4d"/>
    <circle cx="15" cy="11" r="4" stroke="#a9c8d6"/>
    <circle cx="26" cy="11" r="4" stroke="#a9c8d6"/>
    <circle cx="37" cy="11" r="4" stroke="#a9c8d6"/>
    <circle cx="17" cy="27" r="4" stroke="#a9c8d6"/>
    <circle cx="30" cy="27" r="4" stroke="#a9c8d6"/>`),

  gear: S(`
    <circle cx="24" cy="24" r="6.5" stroke="#e0d7c6"/>
    <path d="M24 6v5M24 37v5M6 24h5M37 24h5M11 11l3.6 3.6M33.4 33.4L37 37M37 11l-3.6 3.6M14.6 33.4L11 37"
      stroke="#e0d7c6"/>`),

  close: S(`<path d="M13 13l22 22M35 13L13 35" stroke="#e0d7c6" stroke-width="3.2"/>`),

  save: S(`
    <path d="M10 24l9 9 19-20" stroke="#8fd6a0" stroke-width="3.4"/>
    <path d="M6 40h36" stroke="#a97c4d"/>`),


}

export function icon(name: string): string {
  return ICONS[name] ?? ICONS.tap
}
