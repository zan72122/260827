// ---------------------------------------------------------------------------
// 素材データ。数値は「体感の差」を作るためのもので、プレイヤーには一切見せない。
//
// sink    : 静かな液の中で沈む速さ(世界単位/秒)。マイナスなら浮く。
// follow  : 水流にどれだけ引きずられるか。軽いものほど大きい。
// flutter : 横にひらひら揺れる量。木の葉のような滑空を作る。
// spin    : 回転の速さ。
// sparkle : 面が光を返す強さ(0=まったく光らない)。
// lift    : 舞い上がるのに必要な揺れの強さ。重いものほど大きい。
// pileFlat: 積もり方。1に近いほど平らに広がり、0に近いほど山になる。
// ---------------------------------------------------------------------------

export const PARTICLES = [
  {
    id: 'powder', name: 'こなゆき', shape: 'dot',
    count: 260, size: [1.5, 2.9],
    colors: ['#ffffff', '#f4f8ff', '#e9f0fb'],
    sink: 10.5, follow: 6.2, flutter: 1.15, flutterFreq: [0.5, 1.3],
    spin: 0, sparkle: 0.10, lift: 0.10, pileFlat: 0.92, pack: 0.9,
    jar: { glass: '#dfe7ee', label: '#e8dcc4', cap: '#9aa3a8' },
    swatch: '#f4f8ff',
    // 見た目タグ(比較モードのアイコン用)
    tags: ['slow', 'soft'],
  },
  {
    id: 'flake', name: 'ぼたん雪', shape: 'flake',
    count: 95, size: [6.5, 11.5],
    colors: ['#ffffff', '#eef4fb', '#dfe9f5'],
    sink: 17, follow: 3.6, flutter: 2.6, flutterFreq: [0.35, 0.8],
    spin: 0.9, sparkle: 0.16, lift: 0.22, pileFlat: 0.55, pack: 1.6,
    jar: { glass: '#dce6ee', label: '#e6d9bd', cap: '#8f9aa0' },
    swatch: '#e9f1fa',
    tags: ['flutter', 'soft'],
  },
  {
    id: 'gold', name: '金ラメ', shape: 'shard',
    count: 205, size: [2.2, 4.4],
    colors: ['#d7a13c', '#eec368', '#b8842c'],
    sink: 27, follow: 2.3, flutter: 0.5, flutterFreq: [1.4, 3.0],
    spin: 3.4, sparkle: 1.0, lift: 0.42, pileFlat: 0.62, pack: 0.8,
    jar: { glass: '#d9cdb2', label: '#dccaa0', cap: '#a98d4e' },
    swatch: '#e3b355',
    tags: ['sparkle', 'fast'],
  },
  {
    id: 'star', name: '虹の星', shape: 'star',
    count: 72, size: [6.0, 10.5],
    colors: ['#e88fa8', '#8fbfe8', '#f0d089', '#9fd8b4', '#c3a2e0'],
    sink: 20, follow: 3.1, flutter: 1.5, flutterFreq: [0.5, 1.1],
    spin: 1.5, sparkle: 0.55, lift: 0.26, pileFlat: 0.6, pack: 1.5,
    jar: { glass: '#dee2ea', label: '#e4d3c6', cap: '#9b8fa3' },
    swatch: '#d8a7c4',
    tags: ['sparkle', 'flutter'],
  },
  {
    id: 'petal', name: 'はなびら', shape: 'petal',
    count: 58, size: [9.0, 15.0],
    colors: ['#f2c3cb', '#e7a6b2', '#f7e2d6'],
    sink: 11, follow: 5.4, flutter: 4.2, flutterFreq: [0.28, 0.6],
    spin: 0.6, sparkle: 0.08, lift: 0.13, pileFlat: 0.35, pack: 2.2,
    jar: { glass: '#e6dfe0', label: '#e9d5cf', cap: '#a8949a' },
    swatch: '#eeb2bd',
    tags: ['slow', 'flutter'],
  },
  {
    id: 'heart', name: 'ハート', shape: 'heart',
    count: 62, size: [7.0, 11.0],
    colors: ['#cf6070', '#e08b93', '#c04a5e'],
    sink: 25, follow: 2.5, flutter: 1.0, flutterFreq: [0.8, 1.6],
    spin: 2.0, sparkle: 0.12, lift: 0.33, pileFlat: 0.5, pack: 1.8,
    jar: { glass: '#e5d8da', label: '#e7cfd0', cap: '#a07d84' },
    swatch: '#d4707d',
    tags: ['fast', 'flutter'],
  },
  {
    id: 'bubble', name: 'あわつぶ', shape: 'bubble',
    count: 80, size: [4.0, 9.5],
    colors: ['#eaf4fb', '#d6e9f6', '#ffffff'],
    sink: -24, follow: 4.6, flutter: 1.7, flutterFreq: [0.7, 1.8],
    spin: 0.2, sparkle: 0.30, lift: 0.10, pileFlat: 1.0, pack: 0.4,
    jar: { glass: '#d6e4ee', label: '#dfe5e0', cap: '#8fa2ac' },
    swatch: '#dcecf7',
    tags: ['rise', 'soft'],
  },
  {
    id: 'sand', name: '星のすな', shape: 'grain',
    count: 245, size: [1.6, 3.0],
    colors: ['#c39a63', '#ab8149', '#dcbc86'],
    sink: 40, follow: 1.5, flutter: 0.25, flutterFreq: [1.6, 3.2],
    spin: 1.0, sparkle: 0.32, lift: 0.55, pileFlat: 0.18, pack: 1.0,
    jar: { glass: '#ddd2bc', label: '#dbc9a4', cap: '#967f57' },
    swatch: '#c8a06a',
    tags: ['fast', 'pile'],
  },
];

export const LIQUIDS = [
  {
    id: 'thin', name: 'さらさら',
    sinkScale: 1.45, followScale: 0.85, decay: 1.7, fizz: 0,
    tint: 'rgba(196,220,232,0.12)', deep: 'rgba(112,150,172,0.26)',
    bottle: '#bcd6e0', cork: '#b79a6a', pourRate: 1.5, trail: 0,
    swirlGain: 1.0,
    icon: 'thin',
  },
  {
    id: 'normal', name: 'ふつう',
    sinkScale: 1.0, followScale: 1.0, decay: 1.0, fizz: 0,
    tint: 'rgba(206,222,224,0.15)', deep: 'rgba(104,140,146,0.28)',
    bottle: '#c9d8cf', cork: '#a98a5e', pourRate: 1.0, trail: 0.12,
    swirlGain: 1.0,
    icon: 'normal',
  },
  {
    id: 'thick', name: 'とろり',
    sinkScale: 0.62, followScale: 1.45, decay: 0.34, fizz: 0,
    tint: 'rgba(226,198,146,0.22)', deep: 'rgba(146,110,54,0.30)',
    bottle: '#d9bd83', cork: '#8f6f45', pourRate: 0.45, trail: 0.55,
    swirlGain: 0.8,
    icon: 'thick',
  },
  {
    id: 'fizz', name: 'しゅわしゅわ',
    sinkScale: 0.86, followScale: 1.10, decay: 1.05, fizz: 1,
    tint: 'rgba(206,226,214,0.14)', deep: 'rgba(102,146,134,0.26)',
    bottle: '#c2ddd2', cork: '#a08a62', pourRate: 1.2, trail: 0.05,
    swirlGain: 1.15,
    icon: 'fizz',
  },
];

export const byId = (list, id) => list.find((m) => m.id === id) || list[0];

// 比較モードの「見た目のことば」。文字ではなく絵で出すためのタグ。
export function describe(particle, liquid) {
  const out = [];
  // 速さは必ずひとつ出す。「こっちはゆっくり」が伝わらないと比べる意味がない。
  const speed = particle.sink * liquid.sinkScale;
  if (particle.sink < 0) out.push('rise');
  else if (speed < 13) out.push('slow');
  else if (speed > 22) out.push('fast');
  else out.push(particle.flutter >= 1.4 ? 'flutter' : 'soft');
  const s = particle.sparkle * (liquid.id === 'thick' ? 0.85 : 1);
  if (s >= 0.28) out.push('sparkle');
  if (liquid.id === 'fizz') out.push('fizz');
  if (out.length < 3 && particle.flutter >= 2.4 && !out.includes('flutter')) out.push('flutter');
  if (out.length < 3 && particle.pileFlat < 0.4) out.push('pile');
  if (out.length < 2) out.push('soft');
  return out.slice(0, 3);
}
