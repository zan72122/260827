import * as THREE from 'three';
import { Seabed, WORLD } from '../world/terrain';

// Result-screen nautical chart. Only HERE does the "signal" run along the
// route - the physical cable in the 3D world never glows.
export class Chart {
  private ctx: CanvasRenderingContext2D;
  private base: HTMLCanvasElement | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  private toCanvas(p: THREE.Vector3, w: number, h: number): [number, number] {
    const u = (p.x - WORLD.minX) / (WORLD.maxX - WORLD.minX);
    const v = (p.z - WORLD.minZ) / (WORLD.maxZ - WORLD.minZ);
    return [u * w, v * h];
  }

  /** Pre-render the static chart background for this seabed. */
  prepare(seabed: Seabed): void {
    const w = 640, h = 428;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d')!;

    // Depth-tinted cells.
    const nx = 96, nz = 64;
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const x = WORLD.minX + ((i + 0.5) / nx) * (WORLD.maxX - WORLD.minX);
        const z = WORLD.minZ + ((j + 0.5) / nz) * (WORLD.maxZ - WORLD.minZ);
        const hgt = seabed.height(x, z);
        let col: string;
        if (hgt > 0.5) col = '#c8bb8f';
        else if (hgt > -6) col = '#bfe0dd';
        else if (hgt > -20) col = '#9dcbd4';
        else if (hgt > -34) col = '#7cb2c6';
        else if (hgt > -44) col = '#5e97b4';
        else col = '#47799c';
        ctx.fillStyle = col;
        ctx.fillRect((i / nx) * w, (j / nz) * h, w / nx + 1, h / nz + 1);
      }
    }
    // Rock hatch + coral marks (classic chart symbols, no text).
    ctx.strokeStyle = 'rgba(70,60,50,0.55)';
    ctx.lineWidth = 1;
    for (let j = 0; j < nz; j += 2) {
      for (let i = 0; i < nx; i += 2) {
        const x = WORLD.minX + ((i + 0.5) / nx) * (WORLD.maxX - WORLD.minX);
        const z = WORLD.minZ + ((j + 0.5) / nz) * (WORLD.maxZ - WORLD.minZ);
        const cx = (i / nx) * w, cy = (j / nz) * h;
        if (seabed.rockMask(x, z) > 0.4) {
          ctx.beginPath();
          ctx.moveTo(cx - 3, cy + 3);
          ctx.lineTo(cx + 3, cy - 3);
          ctx.stroke();
        } else if (seabed.coralMask(x, z) > 0.45) {
          ctx.strokeStyle = 'rgba(40,110,60,0.6)';
          ctx.beginPath();
          ctx.moveTo(cx, cy - 3);
          ctx.lineTo(cx, cy + 3);
          ctx.moveTo(cx - 3, cy);
          ctx.lineTo(cx + 3, cy);
          ctx.stroke();
          ctx.strokeStyle = 'rgba(70,60,50,0.55)';
        }
      }
    }
    // Station squares.
    for (const a of [seabed.anchorA, seabed.anchorB]) {
      const [sx, sy] = this.toCanvas(a, w, h);
      ctx.fillStyle = '#2f3b46';
      ctx.fillRect(sx - 5, sy - 5, 10, 10);
      ctx.strokeStyle = '#f3f0e6';
      ctx.lineWidth = 2;
      ctx.strokeRect(sx - 5, sy - 5, 10, 10);
    }
    // Chart border.
    ctx.strokeStyle = '#4a4336';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, w - 4, h - 4);
    this.base = c;
  }

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
        const [x, y] = this.toCanvas(p, cw, ch);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
    };

    // Alternative route: thin dashed gray - "another way that also works".
    if (alt.length > 1) {
      ctx.save();
      ctx.setLineDash([7, 6]);
      ctx.strokeStyle = 'rgba(245,245,240,0.85)';
      ctx.lineWidth = 2.5;
      path(alt);
      ctx.stroke();
      ctx.restore();
    }

    // The child's route: solid, chart-cable crimson.
    if (player.length > 1) {
      ctx.strokeStyle = '#a8322a';
      ctx.lineWidth = 4;
      ctx.lineJoin = 'round';
      path(player);
      ctx.stroke();
    }

    if (signalOn && player.length > 1) {
      // Travelling light pulse along the child's route (map-only!).
      const period = 3.2;
      const ph = (t % period) / period;
      const idxF = ph * (player.length - 1);
      const idx = Math.floor(idxF);
      const p = player[Math.min(idx, player.length - 1)].clone()
        .lerp(player[Math.min(idx + 1, player.length - 1)], idxF - idx);
      const [x, y] = this.toCanvas(p, cw, ch);
      const g = ctx.createRadialGradient(x, y, 0, x, y, 14);
      g.addColorStop(0, 'rgba(255,250,200,0.95)');
      g.addColorStop(0.5, 'rgba(255,220,120,0.5)');
      g.addColorStop(1, 'rgba(255,220,120,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, 14, 0, Math.PI * 2);
      ctx.fill();
      // Ring ripple at the receiving station when the pulse arrives.
      if (ph > 0.93 || ph < 0.07) {
        const stn = ph > 0.5 ? player[player.length - 1] : player[0];
        const [sx, sy] = this.toCanvas(stn, cw, ch);
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
