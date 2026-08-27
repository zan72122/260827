import * as THREE from 'three';
import { Seabed, WORLD } from '../world/terrain';

// Result-screen nautical chart. Only HERE does the "signal" run along the
// route - the physical cable in the 3D world never glows. The chart is
// rendered in the same orientation as the world on screen (portrait keeps
// island A at the bottom), and the islands stay recognizable miniatures of
// the ones the child just visited.
export class Chart {
  private ctx: CanvasRenderingContext2D;
  private base: HTMLCanvasElement | null = null;
  private portrait = false;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  private toCanvas(x: number, z: number, w: number, h: number): [number, number] {
    const u = (x - WORLD.minX) / (WORLD.maxX - WORLD.minX);
    const v = (z - WORLD.minZ) / (WORLD.maxZ - WORLD.minZ);
    return this.portrait ? [v * w, (1 - u) * h] : [u * w, v * h];
  }

  private fromCanvas(cx: number, cy: number, w: number, h: number): [number, number] {
    let u: number, v: number;
    if (this.portrait) {
      v = cx / w;
      u = 1 - cy / h;
    } else {
      u = cx / w;
      v = cy / h;
    }
    return [
      WORLD.minX + u * (WORLD.maxX - WORLD.minX),
      WORLD.minZ + v * (WORLD.maxZ - WORLD.minZ)
    ];
  }

  /** Pre-render the static chart background for this seabed. */
  prepare(seabed: Seabed, portrait: boolean): void {
    this.portrait = portrait;
    const w = this.canvas.width, h = this.canvas.height;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d')!;

    // Depth-tinted cells (iterate canvas cells, invert to world coords so the
    // same code serves both orientations).
    const nx = portrait ? 64 : 96, nz = portrait ? 96 : 64;
    const cw = w / nx, ch = h / nz;
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const [x, z] = this.fromCanvas((i + 0.5) * cw, (j + 0.5) * ch, w, h);
        const hgt = seabed.height(x, z);
        let col: string;
        if (hgt > 0.5) col = '#c8bb8f';
        else if (hgt > -6) col = '#bfe0dd';
        else if (hgt > -20) col = '#9dcbd4';
        else if (hgt > -34) col = '#7cb2c6';
        else if (hgt > -44) col = '#5e97b4';
        else col = '#47799c';
        ctx.fillStyle = col;
        ctx.fillRect(i * cw, j * ch, cw + 1, ch + 1);
      }
    }
    // Rock hatch + coral marks (classic chart symbols, no text).
    for (let j = 0; j < nz; j += 2) {
      for (let i = 0; i < nx; i += 2) {
        const [x, z] = this.fromCanvas((i + 0.5) * cw, (j + 0.5) * ch, w, h);
        const cx = i * cw, cy = j * ch;
        if (seabed.rockMask(x, z) > 0.4) {
          ctx.strokeStyle = 'rgba(70,60,50,0.55)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(cx - 3, cy + 3);
          ctx.lineTo(cx + 3, cy - 3);
          ctx.stroke();
        } else if (seabed.coralMask(x, z) > 0.45) {
          ctx.strokeStyle = 'rgba(40,110,60,0.6)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(cx, cy - 3);
          ctx.lineTo(cx, cy + 3);
          ctx.moveTo(cx - 3, cy);
          ctx.lineTo(cx + 3, cy);
          ctx.stroke();
        }
      }
    }

    // Miniature islands: green with a beach rim, tiny houses and the station
    // lamp - recognizably "the places I just connected".
    const pxPerM = (portrait ? h : w) / (WORLD.maxX - WORLD.minX);
    for (const ix of [WORLD.islandAX, WORLD.islandBX]) {
      const [cx, cy] = this.toCanvas(ix, 0, w, h);
      const rBeach = 13 * pxPerM, rGreen = 9.5 * pxPerM;
      ctx.fillStyle = '#d9c9a2';
      ctx.beginPath();
      ctx.arc(cx, cy, rBeach, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#5d9448';
      ctx.beginPath();
      ctx.arc(cx, cy, rGreen, 0, Math.PI * 2);
      ctx.fill();
      // Tiny houses.
      for (const [hx, hy] of [[-0.35, -0.2], [0.25, 0.15], [-0.05, 0.4]]) {
        const px = cx + hx * rGreen, py = cy + hy * rGreen;
        ctx.fillStyle = '#e8dcc4';
        ctx.fillRect(px - 2.5, py - 2, 5, 4);
        ctx.beginPath();
        ctx.moveTo(px - 3, py - 2);
        ctx.lineTo(px, py - 5);
        ctx.lineTo(px + 3, py - 2);
        ctx.closePath();
        ctx.fillStyle = '#a5533a';
        ctx.fill();
      }
    }
    // Shore stations at the cable anchors with their (green-when-connected)
    // lamp dot - drawn in draw() so it can animate.
    for (const a of [seabed.anchorA, seabed.anchorB]) {
      const [sx, sy] = this.toCanvas(a.x, a.z, w, h);
      ctx.fillStyle = '#3a4650';
      ctx.fillRect(sx - 5, sy - 5, 10, 10);
      ctx.strokeStyle = '#f3f0e6';
      ctx.lineWidth = 2;
      ctx.strokeRect(sx - 5, sy - 5, 10, 10);
    }
    ctx.strokeStyle = '#4a4336';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, w - 4, h - 4);
    this.base = c;
    this.anchors = [
      [seabed.anchorA.x, seabed.anchorA.z],
      [seabed.anchorB.x, seabed.anchorB.z]
    ];
  }

  private anchors: [number, number][] = [];

  /**
   * Draw one frame. `t` in seconds animates the signal pulse; `signalOn`
   * starts the pulse only after the connection moment.
   */
  draw(
    player: THREE.Vector3[],
    alt: THREE.Vector3[],
    t: number,
    signalOn: boolean
  ): void {
    const cw = this.canvas.width, ch = this.canvas.height;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, cw, ch);
    if (this.base) ctx.drawImage(this.base, 0, 0, cw, ch);

    const path = (pts: THREE.Vector3[]) => {
      ctx.beginPath();
      pts.forEach((p, i) => {
        const [x, y] = this.toCanvas(p.x, p.z, cw, ch);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
    };

    // Alternative valid route: deliberately quiet - reference, not "the
    // answer you missed".
    if (alt.length > 1) {
      ctx.save();
      ctx.setLineDash([5, 7]);
      ctx.strokeStyle = 'rgba(245,245,240,0.5)';
      ctx.lineWidth = 1.8;
      path(alt);
      ctx.stroke();
      ctx.restore();
    }

    // The child's route: same cable-dark identity as the physical cable.
    if (player.length > 1) {
      ctx.strokeStyle = '#23272d';
      ctx.lineWidth = 4.5;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      path(player);
      ctx.stroke();
    }

    // Station lamps: green once the signal is up.
    for (const [ax, az] of this.anchors) {
      const [sx, sy] = this.toCanvas(ax, az, cw, ch);
      ctx.fillStyle = signalOn ? '#3fd45f' : '#c8483a';
      ctx.beginPath();
      ctx.arc(sx, sy - 9, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }

    if (signalOn && player.length > 1) {
      // Travelling light pulse along the child's route (map-only!).
      const period = 3.2;
      const ph = (t % period) / period;
      const idxF = ph * (player.length - 1);
      const idx = Math.floor(idxF);
      const p = player[Math.min(idx, player.length - 1)].clone()
        .lerp(player[Math.min(idx + 1, player.length - 1)], idxF - idx);
      const [x, y] = this.toCanvas(p.x, p.z, cw, ch);
      const g = ctx.createRadialGradient(x, y, 0, x, y, 14);
      g.addColorStop(0, 'rgba(255,250,200,0.95)');
      g.addColorStop(0.5, 'rgba(255,190,90,0.55)');
      g.addColorStop(1, 'rgba(255,190,90,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, 14, 0, Math.PI * 2);
      ctx.fill();
      // Ring ripple at the receiving station when the pulse arrives.
      if (ph > 0.93 || ph < 0.07) {
        const stn = ph > 0.5 ? player[player.length - 1] : player[0];
        const [sx, sy] = this.toCanvas(stn.x, stn.z, cw, ch);
        const rr = (ph > 0.5 ? (ph - 0.93) / 0.07 : ph / 0.07) * 18 + 6;
        ctx.strokeStyle = 'rgba(255,240,170,0.7)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sx, sy, rr, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }
}
