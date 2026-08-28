import * as THREE from 'three';
import { Rng } from '../core/rng';

function canvas(size: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  if (!g) throw new Error('2D canvas unavailable');
  return { c, g };
}

function texture(c: HTMLCanvasElement, repeat: number, aniso: number, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Wet, uneven granite setts with mortar joints, snow crust and puddle patches. */
function cobbleMaps(rng: Rng, aniso: number) {
  const S = 512;
  const col = canvas(S);
  const rough = canvas(S);
  col.g.fillStyle = '#5a5854';
  col.g.fillRect(0, 0, S, S);
  rough.g.fillStyle = '#c8c8c8';
  rough.g.fillRect(0, 0, S, S);

  const rows = 13;
  const cell = S / rows;
  for (let y = 0; y < rows; y++) {
    const off = (y % 2) * cell * 0.5;
    for (let x = -1; x <= rows; x++) {
      const cx = x * cell + off + cell * 0.5 + rng.jitter(cell * 0.06);
      const cy = y * cell + cell * 0.5 + rng.jitter(cell * 0.06);
      const w = cell * (0.78 + rng.next() * 0.14);
      const h = cell * (0.74 + rng.next() * 0.16);
      const v = 122 + rng.next() * 58;
      const warm = rng.next() * 12;
      col.g.save();
      col.g.translate(cx, cy);
      col.g.rotate(rng.jitter(0.09));
      col.g.fillStyle = `rgb(${v + warm | 0},${v + warm * 0.7 | 0},${v * 0.96 | 0})`;
      col.g.beginPath();
      col.g.roundRect(-w / 2, -h / 2, w, h, cell * 0.16);
      col.g.fill();
      // Worn crown: slightly lighter centre, darker at the joint.
      const grad = col.g.createRadialGradient(0, 0, 0, 0, 0, w * 0.6);
      grad.addColorStop(0, 'rgba(255,255,255,0.14)');
      grad.addColorStop(1, 'rgba(0,0,0,0.16)');
      col.g.fillStyle = grad;
      col.g.fill();
      col.g.restore();

      // Stone tops are polished by traffic, joints stay rough.
      rough.g.save();
      rough.g.translate(cx, cy);
      rough.g.fillStyle = `rgb(${140 + rng.next() * 70 | 0},0,0)`;
      rough.g.beginPath();
      rough.g.roundRect(-w / 2, -h / 2, w, h, cell * 0.16);
      rough.g.fill();
      rough.g.restore();
    }
  }

  // Damp patches: local, never the whole surface.
  for (let i = 0; i < 9; i++) {
    const x = rng.next() * S;
    const y = rng.next() * S;
    const r = 26 + rng.next() * 70;
    const g1 = col.g.createRadialGradient(x, y, 0, x, y, r);
    g1.addColorStop(0, 'rgba(46,52,60,0.34)');
    g1.addColorStop(1, 'rgba(46,52,60,0)');
    col.g.fillStyle = g1;
    col.g.beginPath();
    col.g.arc(x, y, r, 0, Math.PI * 2);
    col.g.fill();
    const g2 = rough.g.createRadialGradient(x, y, 0, x, y, r);
    // Damp, not mirrored: the wet patches stay well short of glossy.
    g2.addColorStop(0, 'rgba(118,0,0,0.8)');
    g2.addColorStop(1, 'rgba(118,0,0,0)');
    rough.g.fillStyle = g2;
    rough.g.beginPath();
    rough.g.arc(x, y, r, 0, Math.PI * 2);
    rough.g.fill();
  }

  // Trodden snow lodged in joints — asymmetric.
  for (let i = 0; i < 130; i++) {
    const x = rng.next() * S;
    const y = rng.next() * S;
    const r = 2 + rng.next() * 7;
    col.g.fillStyle = `rgba(226,232,240,${0.1 + rng.next() * 0.4})`;
    col.g.beginPath();
    col.g.ellipse(x, y, r, r * (0.5 + rng.next()), rng.next() * 3.14, 0, Math.PI * 2);
    col.g.fill();
  }

  return {
    map: texture(col.c, 16, aniso),
    roughnessMap: texture(rough.c, 16, aniso, false),
  };
}

/** Fissured conifer bark. */
function barkMaps(rng: Rng, aniso: number) {
  const S = 256;
  const col = canvas(S);
  col.g.fillStyle = '#4a3a2c';
  col.g.fillRect(0, 0, S, S);
  for (let i = 0; i < 850; i++) {
    const x = rng.next() * S;
    const y = rng.next() * S;
    const h = 8 + rng.next() * 46;
    const w = 1 + rng.next() * 5;
    const v = rng.next();
    col.g.fillStyle =
      v < 0.45
        ? `rgba(30,22,16,${0.25 + rng.next() * 0.5})`
        : `rgba(${120 + rng.next() * 60 | 0},${96 + rng.next() * 44 | 0},${74 + rng.next() * 34 | 0},${0.16 + rng.next() * 0.35})`;
    col.g.save();
    col.g.translate(x, y);
    col.g.rotate(rng.jitter(0.22));
    col.g.beginPath();
    col.g.roundRect(-w / 2, -h / 2, w, h, w * 0.5);
    col.g.fill();
    col.g.restore();
  }
  for (let i = 0; i < 40; i++) {
    const x = rng.next() * S;
    col.g.strokeStyle = `rgba(22,16,11,${0.2 + rng.next() * 0.4})`;
    col.g.lineWidth = 1 + rng.next() * 2.5;
    col.g.beginPath();
    col.g.moveTo(x, 0);
    let cx = x;
    for (let y = 0; y <= S; y += 16) {
      cx += rng.jitter(5);
      col.g.lineTo(cx, y);
    }
    col.g.stroke();
  }
  return { map: texture(col.c, 3, aniso) };
}

/** Polyester webbing: visible weave and stitched edge. */
function webbingMap(color: string, aniso: number) {
  const S = 128;
  const { c, g } = canvas(S);
  g.fillStyle = color;
  g.fillRect(0, 0, S, S);
  for (let y = 0; y < S; y += 3) {
    g.fillStyle = `rgba(0,0,0,${y % 6 === 0 ? 0.16 : 0.07})`;
    g.fillRect(0, y, S, 1.4);
  }
  for (let x = 0; x < S; x += 4) {
    g.fillStyle = 'rgba(255,255,255,0.07)';
    g.fillRect(x, 0, 1.6, S);
  }
  // Load-bearing stitch lines along both edges.
  g.strokeStyle = 'rgba(255,246,214,0.85)';
  g.lineWidth = 2;
  g.setLineDash([5, 4]);
  for (const x of [S * 0.16, S * 0.84]) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, S);
    g.stroke();
  }
  g.setLineDash([]);
  return texture(c, 1, aniso);
}

/** Aged lime render for the town's façades. */
function stuccoMap(rng: Rng, base: string, aniso: number) {
  const S = 256;
  const { c, g } = canvas(S);
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 2600; i++) {
    const x = rng.next() * S;
    const y = rng.next() * S;
    const r = 0.6 + rng.next() * 2.4;
    g.fillStyle = rng.bool(0.5) ? `rgba(255,255,255,${rng.next() * 0.14})` : `rgba(60,52,44,${rng.next() * 0.12})`;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  // Damp staining rises from the base only — asymmetric weathering.
  const grad = g.createLinearGradient(0, S, 0, S * 0.55);
  grad.addColorStop(0, 'rgba(70,66,58,0.42)');
  grad.addColorStop(1, 'rgba(70,66,58,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 5; i++) {
    const x = rng.next() * S;
    g.fillStyle = `rgba(92,86,76,${0.06 + rng.next() * 0.12})`;
    g.fillRect(x, rng.next() * S * 0.5, 8 + rng.next() * 40, S);
  }
  return texture(c, 1, aniso);
}

/** Clay pantiles with snow lying in the flutes. */
function roofMap(rng: Rng, aniso: number) {
  const S = 256;
  const { c, g } = canvas(S);
  g.fillStyle = '#6b3b30';
  g.fillRect(0, 0, S, S);
  const rows = 10;
  const rh = S / rows;
  for (let r = 0; r < rows; r++) {
    for (let x = -1; x < 14; x++) {
      const w = S / 13;
      const cx = x * w + (r % 2) * w * 0.5;
      const v = rng.next();
      g.fillStyle = `rgb(${(96 + v * 52) | 0},${(52 + v * 26) | 0},${(42 + v * 18) | 0})`;
      g.beginPath();
      g.roundRect(cx + 1, r * rh + 1, w - 2, rh - 2, 3);
      g.fill();
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(cx + 1, r * rh + rh - 4, w - 2, 3);
      if (rng.bool(0.34)) {
        g.fillStyle = `rgba(236,242,248,${0.25 + rng.next() * 0.5})`;
        g.fillRect(cx + 1, r * rh + 1, w - 2, 2 + rng.next() * 4);
      }
    }
  }
  return texture(c, 1, aniso);
}

/** Trodden snow: crusty, with grey where it has been walked on. */
function snowMap(rng: Rng, aniso: number) {
  const S = 256;
  const { c, g } = canvas(S);
  g.fillStyle = '#eef3f8';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 1800; i++) {
    const x = rng.next() * S;
    const y = rng.next() * S;
    const r = 1 + rng.next() * 5;
    g.fillStyle = rng.bool(0.55) ? `rgba(255,255,255,${rng.next() * 0.5})` : `rgba(176,190,206,${rng.next() * 0.35})`;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  for (let i = 0; i < 14; i++) {
    const x = rng.next() * S;
    const y = rng.next() * S;
    g.fillStyle = `rgba(150,164,180,${0.1 + rng.next() * 0.22})`;
    g.beginPath();
    g.ellipse(x, y, 12 + rng.next() * 40, 8 + rng.next() * 20, rng.next() * 3.14, 0, Math.PI * 2);
    g.fill();
  }
  return texture(c, 9, aniso);
}

export class Materials {
  readonly cobble: THREE.MeshStandardMaterial;
  readonly snow: THREE.MeshStandardMaterial;
  readonly bark: THREE.MeshStandardMaterial;
  readonly slingRed: THREE.MeshStandardMaterial;
  readonly slingBlue: THREE.MeshStandardMaterial;
  readonly steel: THREE.MeshStandardMaterial;
  readonly steelDark: THREE.MeshStandardMaterial;
  readonly chrome: THREE.MeshStandardMaterial;
  readonly craneBody: THREE.MeshStandardMaterial;
  readonly craneAccent: THREE.MeshStandardMaterial;
  readonly rubber: THREE.MeshStandardMaterial;
  readonly timber: THREE.MeshStandardMaterial;
  readonly wireRope: THREE.MeshStandardMaterial;
  readonly stuccoA: THREE.MeshStandardMaterial;
  readonly stuccoB: THREE.MeshStandardMaterial;
  readonly stuccoC: THREE.MeshStandardMaterial;
  readonly roof: THREE.MeshStandardMaterial;
  readonly windowGlass: THREE.MeshStandardMaterial;
  readonly windowLit: THREE.MeshStandardMaterial;
  readonly woodTrim: THREE.MeshStandardMaterial;
  readonly hiVis: THREE.MeshStandardMaterial;
  readonly helmet: THREE.MeshStandardMaterial;
  readonly skin: THREE.MeshStandardMaterial;
  readonly coat: THREE.MeshStandardMaterial[];
  readonly bulbOff: THREE.MeshStandardMaterial;
  readonly cord: THREE.MeshStandardMaterial;
  readonly starMetal: THREE.MeshStandardMaterial;
  readonly fence: THREE.MeshStandardMaterial;
  readonly fenceFoot: THREE.MeshStandardMaterial;
  readonly paintYellow: THREE.MeshStandardMaterial;

  private disposables: (THREE.Texture | THREE.Material)[] = [];

  constructor(rng: Rng, anisotropy: number) {
    const keep = <T extends THREE.Texture>(t: T): T => {
      this.disposables.push(t);
      return t;
    };

    const cob = cobbleMaps(rng, anisotropy);
    keep(cob.map);
    keep(cob.roughnessMap);
    this.cobble = new THREE.MeshStandardMaterial({
      map: cob.map,
      roughnessMap: cob.roughnessMap,
      roughness: 0.84,
      metalness: 0.02,
      color: 0xffffff,
    });

    const sn = snowMap(rng, anisotropy);
    keep(sn);
    this.snow = new THREE.MeshStandardMaterial({ map: sn, roughness: 0.94, metalness: 0, color: 0xffffff });

    const bk = barkMaps(rng, anisotropy);
    keep(bk.map);
    this.bark = new THREE.MeshStandardMaterial({ map: bk.map, roughness: 0.95, metalness: 0, color: 0xa89880 });

    const wr = webbingMap('#a22a24', anisotropy);
    const wb = webbingMap('#1f4f8f', anisotropy);
    keep(wr);
    keep(wb);
    this.slingRed = new THREE.MeshStandardMaterial({ map: wr, roughness: 0.88, metalness: 0, side: THREE.DoubleSide });
    this.slingBlue = new THREE.MeshStandardMaterial({ map: wb, roughness: 0.88, metalness: 0, side: THREE.DoubleSide });

    this.steel = new THREE.MeshStandardMaterial({ color: 0x9aa1a8, roughness: 0.52, metalness: 0.85 });
    this.steelDark = new THREE.MeshStandardMaterial({ color: 0x4c5157, roughness: 0.66, metalness: 0.8 });
    this.chrome = new THREE.MeshStandardMaterial({ color: 0xd8dde2, roughness: 0.18, metalness: 1 });
    this.craneBody = new THREE.MeshStandardMaterial({ color: 0xd8531f, roughness: 0.44, metalness: 0.32 });
    this.craneAccent = new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.58, metalness: 0.4 });
    this.rubber = new THREE.MeshStandardMaterial({ color: 0x17191b, roughness: 0.95, metalness: 0 });
    this.timber = new THREE.MeshStandardMaterial({ color: 0x8a6a44, roughness: 0.92, metalness: 0 });
    this.wireRope = new THREE.MeshStandardMaterial({ color: 0x6f757b, roughness: 0.44, metalness: 0.9 });

    const sa = stuccoMap(rng, '#e6dcc8', anisotropy);
    const sb = stuccoMap(rng, '#d8c6ac', anisotropy);
    const sc = stuccoMap(rng, '#cfd6d2', anisotropy);
    keep(sa);
    keep(sb);
    keep(sc);
    this.stuccoA = new THREE.MeshStandardMaterial({ map: sa, roughness: 0.94, metalness: 0 });
    this.stuccoB = new THREE.MeshStandardMaterial({ map: sb, roughness: 0.94, metalness: 0 });
    this.stuccoC = new THREE.MeshStandardMaterial({ map: sc, roughness: 0.94, metalness: 0 });

    const rf = roofMap(rng, anisotropy);
    keep(rf);
    this.roof = new THREE.MeshStandardMaterial({ map: rf, roughness: 0.82, metalness: 0 });

    this.windowGlass = new THREE.MeshStandardMaterial({
      color: 0x51616f,
      roughness: 0.17,
      metalness: 0.1,
      emissive: 0x000000,
    });
    this.windowLit = new THREE.MeshStandardMaterial({
      color: 0x120e08,
      roughness: 0.4,
      metalness: 0,
      emissive: 0xffc271,
      emissiveIntensity: 0,
    });
    this.woodTrim = new THREE.MeshStandardMaterial({ color: 0x54402e, roughness: 0.8, metalness: 0 });

    this.hiVis = new THREE.MeshStandardMaterial({ color: 0xd4e84a, roughness: 0.7, metalness: 0 });
    this.helmet = new THREE.MeshStandardMaterial({ color: 0xf0f2f4, roughness: 0.35, metalness: 0.05 });
    this.skin = new THREE.MeshStandardMaterial({ color: 0xc79a78, roughness: 0.78, metalness: 0 });
    this.coat = [0x2f4858, 0x6a3d3a, 0x3c5a45, 0x574064, 0x8a5a2b, 0x2c3550].map(
      (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.86, metalness: 0 }),
    );

    this.bulbOff = new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.35, metalness: 0.1 });
    this.cord = new THREE.MeshStandardMaterial({ color: 0x14181c, roughness: 0.72, metalness: 0.05 });
    this.starMetal = new THREE.MeshStandardMaterial({
      color: 0xd9a63c,
      roughness: 0.3,
      metalness: 0.9,
      emissive: 0x120c00,
    });
    this.fence = new THREE.MeshStandardMaterial({ color: 0xb9bec4, roughness: 0.48, metalness: 0.75 });
    this.fenceFoot = new THREE.MeshStandardMaterial({ color: 0xd8c22a, roughness: 0.66, metalness: 0.1 });
    this.paintYellow = new THREE.MeshStandardMaterial({ color: 0xe2b524, roughness: 0.5, metalness: 0.3 });
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }
}
