/**
 * Materials, all generated in-process -- nothing is fetched at run time.
 *
 * The hero surfaces are the red paint film, the white ground and paper inner
 * wall, the wooden jigs, the thread and the lead weight. The red is treated as
 * thin paint over paper: a quiet sheen, visible hand-brushed variation, and the
 * white ground showing through at the cut and the rim. It is not ceramic, not
 * metal, not plush.
 */
import {
  CanvasTexture,
  Color,
  LinearFilter,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
} from 'three';
import { Rng } from '../core/rng';

function canvas(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): Texture {
  const el = document.createElement('canvas');
  el.width = w;
  el.height = h;
  const ctx = el.getContext('2d')!;
  draw(ctx);
  const t = new CanvasTexture(el);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  t.minFilter = LinearFilter;
  t.magFilter = LinearFilter;
  return t;
}

/** Brushed unevenness, reused by the red paint and the white ground. */
function mottle(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number, amt: number): void {
  const r = new Rng(seed);
  ctx.globalAlpha = amt;
  for (let i = 0; i < 260; i++) {
    const x = r.range(0, w);
    const y = r.range(0, h);
    const rw = r.range(w * 0.02, w * 0.16);
    const rh = r.range(h * 0.01, h * 0.05);
    ctx.fillStyle = r.next() > 0.5 ? '#ffffff' : '#000000';
    ctx.beginPath();
    ctx.ellipse(x, y, rw, rh, r.range(-0.4, 0.4), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** Paint of the body: red film, the doll's markings, and a little Christmas. */
function bodyPaint(): Texture {
  return canvas(1024, 512, (c) => {
    const w = 1024;
    const h = 512;
    c.fillStyle = '#b7291f';
    c.fillRect(0, 0, w, h);
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(150,26,20,0.35)');
    g.addColorStop(0.45, 'rgba(214,66,48,0.18)');
    g.addColorStop(1, 'rgba(126,22,17,0.4)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    mottle(c, w, h, 0x9a11, 0.05);

    // Texture space: x runs around the barrel, with x = 0 and x = w meeting on
    // the doll's left flank and x = w/2 on its right, so a marking meant for a
    // flank is drawn at those three places to survive the seam. y runs along
    // the spine, and the sampling is flipped, so the top of this canvas is the
    // collar and the bottom is the tail.
    const flank = (cx: number, cy: number, s: number): void => {
      c.save();
      c.translate(cx, cy);
      c.scale(s, s);
      c.fillStyle = '#f2e6d2';
      c.beginPath();
      c.ellipse(0, 0, 62, 44, 0.2, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = '#241a16';
      c.lineWidth = 5;
      c.stroke();
      c.fillStyle = '#241a16';
      c.beginPath();
      c.ellipse(-16, -6, 12, 9, 0.4, 0, Math.PI * 2);
      c.fill();
      c.beginPath();
      c.ellipse(20, 10, 9, 7, -0.3, 0, Math.PI * 2);
      c.fill();
      c.restore();
    };
    for (const fx of [0, 512, 1024]) flank(fx, 250, 1);

    // a spine band of white dots -- winter, kept to the body
    c.fillStyle = '#f6efe2';
    for (let i = 0; i < 22; i++) {
      const y = 90 + i * 18.5;
      const x = 256 + Math.sin(i * 1.1) * 26;
      c.beginPath();
      c.arc(x, y, i % 3 === 0 ? 7 : 4.4, 0, Math.PI * 2);
      c.fill();
    }
    // holly on the shoulder: two leaves and three berries
    const holly = (hx: number, hy: number): void => {
      c.save();
      c.translate(hx, hy);
      c.fillStyle = '#1f5f3a';
      for (const rot of [-0.5, 0.6]) {
        c.save();
        c.rotate(rot);
        c.beginPath();
        c.moveTo(0, 0);
        for (let i = 0; i <= 10; i++) {
          const t = i / 10;
          const yy = -34 * t;
          const xx = Math.sin(t * Math.PI) * 15 * (i % 2 ? 1 : 0.62);
          c.lineTo(xx, yy);
        }
        for (let i = 10; i >= 0; i--) {
          const t = i / 10;
          const yy = -34 * t;
          const xx = -Math.sin(t * Math.PI) * 15 * (i % 2 ? 1 : 0.62);
          c.lineTo(xx, yy);
        }
        c.fill();
        c.restore();
      }
      c.fillStyle = '#d8342a';
      for (const [bx, by] of [
        [-8, 6],
        [7, 5],
        [0, 15],
      ] as const) {
        c.beginPath();
        c.arc(bx, by, 6.5, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = '#e8564a';
        c.beginPath();
        c.arc(bx - 2, by - 2, 2.2, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = '#d8342a';
      }
      c.restore();
    };
    holly(180, 150);
    holly(844, 150);
    // a thin green and white cord painted round the barrel
    c.strokeStyle = '#2b6b45';
    c.lineWidth = 7;
    c.beginPath();
    c.moveTo(0, 122);
    c.lineTo(w, 122);
    c.stroke();
    c.strokeStyle = '#f4ead9';
    c.setLineDash([16, 16]);
    c.lineWidth = 5;
    c.beginPath();
    c.moveTo(0, 122);
    c.lineTo(w, 122);
    c.stroke();
    c.setLineDash([]);
  });
}

/** Paint of the head: the face is already on it when the child arrives. */
function headPaint(): Texture {
  return canvas(768, 512, (c) => {
    const w = 768;
    const h = 512;
    c.fillStyle = '#bb2c21';
    c.fillRect(0, 0, w, h);
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(226,86,64,0.16)');
    g.addColorStop(1, 'rgba(124,22,17,0.34)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    mottle(c, w, h, 0x77aa, 0.045);

    // Same layout as the body: x wraps round the head with the two cheeks at
    // x = 0/w and x = w/2, and the top of this canvas is the muzzle.
    const eye = (cx: number): void => {
      c.save();
      c.translate(cx, 300);
      c.fillStyle = '#f4ead8';
      c.beginPath();
      c.ellipse(0, 0, 33, 24, 0, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = '#22160f';
      c.lineWidth = 5;
      c.stroke();
      c.fillStyle = '#1d1410';
      c.beginPath();
      c.ellipse(3, 2, 15, 14, 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#f4ead8';
      c.beginPath();
      c.arc(-3, -4, 4, 0, Math.PI * 2);
      c.fill();
      c.restore();
    };
    for (const ex of [0, 384, 768]) eye(ex);
    // pale muzzle, at the top of the canvas because that is the front
    c.fillStyle = 'rgba(236,222,200,0.92)';
    c.fillRect(0, 0, w, 58);
    const fade = c.createLinearGradient(0, 58, 0, 104);
    fade.addColorStop(0, 'rgba(236,222,200,0.9)');
    fade.addColorStop(1, 'rgba(236,222,200,0)');
    c.fillStyle = fade;
    c.fillRect(0, 58, w, 46);
    c.fillStyle = '#48221a';
    for (const nx of [0, 384, 768]) {
      c.beginPath();
      c.ellipse(nx, 30, 15, 10, 0.25, 0, Math.PI * 2);
      c.fill();
    }
    // the black muzzle line and a soft brow, both painted before the child came
    c.strokeStyle = 'rgba(40,26,20,0.75)';
    c.lineWidth = 5;
    c.beginPath();
    c.moveTo(0, 122);
    c.lineTo(w, 122);
    c.stroke();
  });
}

function woodTex(seed: number, base: string): Texture {
  return canvas(512, 512, (c) => {
    const r = new Rng(seed);
    c.fillStyle = base;
    c.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 150; i++) {
      const y = r.range(0, 512);
      c.strokeStyle = `rgba(${r.next() > 0.5 ? '60,42,26' : '190,160,120'},${r.range(0.03, 0.13)})`;
      c.lineWidth = r.range(0.6, 3.4);
      c.beginPath();
      c.moveTo(0, y);
      for (let x = 0; x <= 512; x += 32) {
        c.lineTo(x, y + Math.sin(x * 0.02 + i) * r.range(1, 5));
      }
      c.stroke();
    }
    for (let i = 0; i < 5; i++) {
      const x = r.range(0, 512);
      const y = r.range(0, 512);
      c.strokeStyle = 'rgba(70,48,30,0.16)';
      for (let k = 1; k < 7; k++) {
        c.lineWidth = 1.4;
        c.beginPath();
        c.ellipse(x, y, k * 4.5, k * 2.6, r.range(0, 3), 0, Math.PI * 2);
        c.stroke();
      }
    }
  });
}

/** The paper the shell is made of, seen from the inside. */
function liningTex(): Texture {
  return canvas(512, 512, (c) => {
    const r = new Rng(0x3311);
    c.fillStyle = '#cdbfa2';
    c.fillRect(0, 0, 512, 512);
    // torn edges of the pasted strips, and the fibre in them
    for (let i = 0; i < 26; i++) {
      c.save();
      c.globalAlpha = r.range(0.06, 0.16);
      c.fillStyle = r.next() > 0.5 ? '#efe4cc' : '#a8916d';
      c.translate(r.range(0, 512), r.range(0, 512));
      c.rotate(r.range(-0.5, 0.5));
      c.fillRect(-r.range(40, 150), -r.range(14, 46), r.range(80, 300), r.range(28, 92));
      c.restore();
    }
    c.globalAlpha = 0.14;
    for (let i = 0; i < 400; i++) {
      c.strokeStyle = r.next() > 0.5 ? '#8d8068' : '#f2e8d2';
      c.lineWidth = r.range(0.4, 1.2);
      const x = r.range(0, 512);
      const y = r.range(0, 512);
      const a = r.range(0, Math.PI);
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + Math.cos(a) * r.range(6, 30), y + Math.sin(a) * r.range(6, 30));
      c.stroke();
    }
    c.globalAlpha = 1;
  });
}

/** Cut faces and the rim: white ground and paper layers under a red skin. */
function edgeTex(): Texture {
  return canvas(64, 128, (c) => {
    const g = c.createLinearGradient(0, 128, 0, 0);
    g.addColorStop(0.0, '#efe6d4');
    g.addColorStop(0.5, '#e6dac3');
    g.addColorStop(0.78, '#dcccb0');
    g.addColorStop(0.92, '#c26a52');
    g.addColorStop(1.0, '#b52a20');
    c.fillStyle = g;
    c.fillRect(0, 0, 64, 128);
    const r = new Rng(0x9911);
    for (let i = 0; i < 90; i++) {
      c.strokeStyle = `rgba(150,130,100,${r.range(0.05, 0.2)})`;
      c.lineWidth = r.range(0.5, 1.4);
      const y = r.range(0, 100);
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(64, y + r.sym(2));
      c.stroke();
    }
  });
}

export interface Materials {
  red: MeshPhysicalMaterial;
  redHead: MeshPhysicalMaterial;
  redPlain: MeshPhysicalMaterial;
  lining: MeshStandardMaterial;
  edge: MeshStandardMaterial;
  wood: MeshStandardMaterial;
  woodDark: MeshStandardMaterial;
  bench: MeshStandardMaterial;
  cloth: MeshStandardMaterial;
  thread: MeshStandardMaterial;
  lead: MeshStandardMaterial;
  paper: MeshStandardMaterial;
  wall: MeshStandardMaterial;
  windowPane: MeshStandardMaterial;
  dispose(): void;
}

export function buildMaterials(): Materials {
  const bodyTex = bodyPaint();
  const headTex = headPaint();
  const wood = woodTex(0x4411, '#9a7548');
  const woodD = woodTex(0x8822, '#6d5232');
  const bench = woodTex(0x2255, '#7d5f3c');
  bench.wrapS = bench.wrapT = RepeatWrapping;
  bench.repeat.set(3, 3);
  const edge = edgeTex();
  const lining = liningTex();

  const paint = (map: Texture): MeshPhysicalMaterial =>
    new MeshPhysicalMaterial({
      map,
      color: new Color(1, 1, 1),
      // Thin paint over paper: a low, broad sheen rather than a lacquer
      // highlight, and enough roughness that it never reads as ceramic.
      roughness: 0.58,
      metalness: 0,
      clearcoat: 0.16,
      clearcoatRoughness: 0.66,
      sheen: 0.1,
      sheenColor: new Color('#ffd9c4'),
    });

  // The legs are formed with the body but carry none of its markings, so they
  // take the paint without the pattern rather than an arbitrary slice of it.
  const plain = new MeshPhysicalMaterial({
    color: new Color('#b7291f'),
    roughness: 0.6,
    metalness: 0,
    clearcoat: 0.14,
    clearcoatRoughness: 0.7,
  });

  const mats: Materials = {
    red: paint(bodyTex),
    redHead: paint(headTex),
    redPlain: plain,
    lining: new MeshStandardMaterial({ map: lining, roughness: 0.97, metalness: 0 }),
    edge: new MeshStandardMaterial({ map: edge, roughness: 0.9, metalness: 0 }),
    wood: new MeshStandardMaterial({ map: wood, roughness: 0.72, metalness: 0 }),
    woodDark: new MeshStandardMaterial({ map: woodD, roughness: 0.78, metalness: 0 }),
    bench: new MeshStandardMaterial({ map: bench, roughness: 0.8, metalness: 0 }),
    cloth: new MeshStandardMaterial({ color: '#6e1a18', roughness: 0.99, metalness: 0 }),
    // Darker than the paper it runs against, so the support reads as a thread
    // holding something up rather than a highlight on the shell.
    thread: new MeshStandardMaterial({ color: '#9c8659', roughness: 0.88, metalness: 0 }),
    lead: new MeshStandardMaterial({ color: '#6b655f', roughness: 0.52, metalness: 0.3 }),
    paper: new MeshStandardMaterial({ color: '#a2957c', roughness: 0.96, metalness: 0 }),
    wall: new MeshStandardMaterial({ color: '#7d6a56', roughness: 0.95, metalness: 0 }),
    windowPane: new MeshStandardMaterial({
      color: '#cfe0ea',
      roughness: 1,
      metalness: 0,
      emissive: new Color('#dfeaf2'),
      emissiveIntensity: 1.35,
    }),
    dispose() {
      for (const t of [bodyTex, headTex, wood, woodD, bench, edge, lining]) t.dispose();
    },
  };
  return mats;
}
