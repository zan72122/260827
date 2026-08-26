// Canvas による手続きテクスチャ群。外部アセットなしで
// コンクリート汚れ・土・縞・フェンス網などを生成する。

import * as THREE from 'three';
import { mulberry32 } from '../util/math2d';

function canvasTex(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  draw(ctx);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

function speckle(ctx: CanvasRenderingContext2D, rnd: () => number, count: number, size: number, alpha: number, tone: () => string) {
  for (let i = 0; i < count; i++) {
    ctx.globalAlpha = alpha * (0.3 + rnd() * 0.7);
    ctx.fillStyle = tone();
    const s = size * (0.4 + rnd() * 1.2);
    ctx.fillRect(rnd() * ctx.canvas.width, rnd() * ctx.canvas.height, s, s);
  }
  ctx.globalAlpha = 1;
}

/** 基礎スラブ: 打設ムラ + こて跡 + 目地 + 雨染み */
export function slabTexture(): THREE.CanvasTexture {
  return canvasTex(1024, 1024, (ctx) => {
    const rnd = mulberry32(101);
    ctx.fillStyle = '#b7b2a8';
    ctx.fillRect(0, 0, 1024, 1024);
    // 大きな打設ムラ
    for (let i = 0; i < 40; i++) {
      const g = ctx.createRadialGradient(rnd() * 1024, rnd() * 1024, 10, rnd() * 1024, rnd() * 1024, 120 + rnd() * 260);
      const d = rnd() > 0.5;
      g.addColorStop(0, d ? 'rgba(140,135,125,0.16)' : 'rgba(220,216,205,0.13)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 1024, 1024);
    }
    speckle(ctx, rnd, 5200, 2.4, 0.24, () => (rnd() > 0.5 ? '#8f8a80' : '#cdc8bc'));
    // こて跡（緩い弧）
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    for (let i = 0; i < 26; i++) {
      ctx.lineWidth = 6 + rnd() * 14;
      ctx.beginPath();
      const cx = rnd() * 1024, cy = rnd() * 1024;
      ctx.arc(cx, cy, 90 + rnd() * 220, rnd() * 6.28, rnd() * 6.28 + 1.2);
      ctx.stroke();
    }
    // 雨染み（角付近・非対称）
    for (let i = 0; i < 7; i++) {
      const g = ctx.createRadialGradient(150 + rnd() * 240, 700 + rnd() * 300, 4, 150 + rnd() * 240, 700 + rnd() * 300, 60 + rnd() * 120);
      g.addColorStop(0, 'rgba(90,86,78,0.13)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 1024, 1024);
    }
  });
}

/** 地面: 土 + 轍 + 砕石 */
export function groundTexture(): THREE.CanvasTexture {
  return canvasTex(1024, 1024, (ctx) => {
    const rnd = mulberry32(202);
    ctx.fillStyle = '#8d7c64';
    ctx.fillRect(0, 0, 1024, 1024);
    for (let i = 0; i < 60; i++) {
      const g = ctx.createRadialGradient(rnd() * 1024, rnd() * 1024, 8, rnd() * 1024, rnd() * 1024, 100 + rnd() * 240);
      g.addColorStop(0, rnd() > 0.45 ? 'rgba(120,102,78,0.28)' : 'rgba(160,148,124,0.25)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 1024, 1024);
    }
    speckle(ctx, rnd, 7000, 3, 0.3, () => (rnd() > 0.6 ? '#6e6250' : '#a99b80'));
    // 轍（タイヤ跡の暗い帯・二本組）
    ctx.strokeStyle = 'rgba(70,60,45,0.30)';
    for (let i = 0; i < 5; i++) {
      const y0 = rnd() * 1024, amp = 60 + rnd() * 120, off = 26 + rnd() * 8;
      for (const o of [-off, off]) {
        ctx.lineWidth = 14 + rnd() * 6;
        ctx.beginPath();
        for (let x = 0; x <= 1024; x += 32) {
          const y = y0 + Math.sin(x / 260 + i * 2.2) * amp + o;
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }
  });
}

/** 鋼材の縦だれ汚れ（非対称）。alphaMapとして脚部などへ */
export function grimeTexture(seed: number): THREE.CanvasTexture {
  return canvasTex(256, 512, (ctx) => {
    const rnd = mulberry32(seed);
    ctx.clearRect(0, 0, 256, 512);
    // 縦の雨だれ
    for (let i = 0; i < 22; i++) {
      const x = rnd() * 256;
      const topY = rnd() * 160;
      const length = 80 + rnd() * 330;
      const w = 3 + rnd() * 10;
      const g = ctx.createLinearGradient(0, topY, 0, topY + length);
      g.addColorStop(0, `rgba(35,30,25,${0.24 + rnd() * 0.3})`);
      g.addColorStop(1, 'rgba(35,30,25,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, topY, w, length);
    }
    // 下端の泥はね
    for (let i = 0; i < 250; i++) {
      const y = 512 - Math.pow(rnd(), 2.2) * 190;
      ctx.globalAlpha = 0.25 + rnd() * 0.4;
      ctx.fillStyle = '#4a3d2c';
      ctx.beginPath();
      ctx.arc(rnd() * 256, y, 1.5 + rnd() * 4.5, 0, 7);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  });
}

/** 警告縞（黄黒） */
export function hazardTexture(): THREE.CanvasTexture {
  const t = canvasTex(256, 64, (ctx) => {
    ctx.fillStyle = '#d9a521';
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = '#26241f';
    for (let x = -64; x < 300; x += 64) {
      ctx.beginPath();
      ctx.moveTo(x, 64); ctx.lineTo(x + 32, 0); ctx.lineTo(x + 64, 0); ctx.lineTo(x + 32, 64);
      ctx.closePath(); ctx.fill();
    }
    // 摩耗
    const rnd = mulberry32(77);
    for (let i = 0; i < 300; i++) {
      ctx.globalAlpha = 0.10 + rnd() * 0.14;
      ctx.fillStyle = rnd() > 0.5 ? '#9c9c94' : '#5c5140';
      ctx.fillRect(rnd() * 256, rnd() * 64, 2 + rnd() * 6, 1 + rnd() * 3);
    }
    ctx.globalAlpha = 1;
  });
  return t;
}

/** 仮設フェンスの網 (alpha) */
export function fenceTexture(): THREE.CanvasTexture {
  const t = canvasTex(256, 256, (ctx) => {
    ctx.clearRect(0, 0, 256, 256);
    ctx.strokeStyle = 'rgba(225,228,230,0.98)';
    ctx.lineWidth = 3;
    for (let i = -256; i <= 512; i += 26) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + 256, 256); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(i + 256, 0); ctx.lineTo(i, 256); ctx.stroke();
    }
  });
  return t;
}

/** チョーク線 (子どもの生ストローク用・かすれた白) */
export function chalkTexture(): THREE.CanvasTexture {
  return canvasTex(128, 32, (ctx) => {
    const rnd = mulberry32(55);
    ctx.clearRect(0, 0, 128, 32);
    // 芯のある帯 + 粉のかすれ
    const grad = ctx.createLinearGradient(0, 0, 0, 32);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.3, 'rgba(255,255,255,0.85)');
    grad.addColorStop(0.7, 'rgba(255,255,255,0.85)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 32);
    for (let i = 0; i < 700; i++) {
      const y = 16 + (rnd() + rnd() - 1) * 14;
      ctx.globalAlpha = 0.3 + rnd() * 0.7;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(rnd() * 128, y, 1 + rnd() * 3, 1 + rnd() * 2.5);
    }
    // ところどころ欠け
    for (let i = 0; i < 60; i++) {
      ctx.globalAlpha = 0.5 + rnd() * 0.5;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillRect(rnd() * 128, rnd() * 32, 2 + rnd() * 4, 1 + rnd() * 3);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = 1;
  });
}

/** 鋼材のラフネスむらとして共用するノイズ */
export function roughNoiseTexture(seed: number): THREE.CanvasTexture {
  return canvasTex(256, 256, (ctx) => {
    const rnd = mulberry32(seed);
    ctx.fillStyle = '#888888';
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2600; i++) {
      const v = 90 + Math.floor(rnd() * 130);
      ctx.fillStyle = `rgba(${v},${v},${v},${0.25 + rnd() * 0.4})`;
      ctx.fillRect(rnd() * 256, rnd() * 256, 2 + rnd() * 8, 2 + rnd() * 8);
    }
  });
}
