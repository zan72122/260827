// バラエティ＋株分けプランの純ロジックモジュール。
// シーン操作・flowers.add 呼び出しは一切行わず、プランオブジェクトの配列を返すだけ。
import * as THREE from 'three';
import { FLOWER_TYPE_LIST } from './flowers.js';

// 別種・白ミックス時のベース色（うっすらクリームがかった白）
export const WHITE_MIX = 0xfff2ef;

// chosen.type 以外の花種2つを返す
function otherTypes(type) {
  return FLOWER_TYPE_LIST.filter(t => t !== type);
}

// 0〜1 の範囲を [min, max] へ線形マップ
function lerp(min, max, u) {
  return min + (max - min) * u;
}

// chosen.colorHex を HSL でゆらす（main.js の jitterColor 相当）
// hAmount: 色相の振れ幅（±hAmount/2）、lAmount: 明度の振れ幅（±lAmount/2）
function jitterHex(colorHex, hAmount, lAmount, random = Math.random) {
  return new THREE.Color(colorHex)
    .offsetHSL((random() - 0.5) * hAmount, 0, (random() - 0.5) * lAmount)
    .getHex();
}

function contrastHex(colorHex, lightness = 0.04) {
  const hsl = {};
  new THREE.Color(colorHex).getHSL(hsl);
  return new THREE.Color().setHSL(
    (hsl.h + 0.42) % 1,
    Math.max(0.34, Math.min(0.68, hsl.s * 0.72)),
    Math.max(0.36, Math.min(0.70, hsl.l + lightness)),
  ).getHex();
}

function hashSeed(value) {
  const text = String(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function exactPaletteRoles(total, random) {
  const neutral = Math.round(total * 0.20);
  const accent = Math.round(total * 0.10);
  const roles = [
    ...Array(total - neutral - accent).fill('primary'),
    ...Array(neutral).fill('neutral'),
    ...Array(accent).fill('accent'),
  ];
  for (let index = roles.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(random() * (index + 1));
    [roles[index], roles[swapIndex]] = [roles[swapIndex], roles[index]];
  }
  return roles;
}

// role に応じて種・色・スケールを決定する
export function pickVariety(chosen, role, options = {}) {
  const random = typeof options === 'function' ? options : (options.random || Math.random);
  if (role === 'player') {
    return {
      type: chosen.type,
      colorHex: jitterHex(chosen.colorHex, 0.06, 0.16, random),
      scale: lerp(0.9, 1.4, random()),
      role,
      paletteRole: 'primary',
    };
  }
  // child / accent 共通。色は主色70%、白〜クリーム20%、対比色10%。
  const others = otherTypes(chosen.type);
  let type;
  const rt = random();
  if (rt < 0.7) {
    type = chosen.type;
  } else if (rt < 0.85) {
    type = others[0];
  } else {
    type = others[1];
  }

  const paletteRole = options.paletteRole || (() => {
    const value = random();
    if (value < 0.70) return 'primary';
    if (value < 0.90) return 'neutral';
    return 'accent';
  })();
  const colorHex = paletteRole === 'neutral'
    ? WHITE_MIX
    : paletteRole === 'accent'
      ? contrastHex(chosen.colorHex)
      : jitterHex(chosen.colorHex, 0.06, 0.16, random);

  const scale = role === 'accent'
    ? lerp(1.0, 1.5, random())
    : lerp(0.6, 1.7, random());

  return { type, colorHex, scale, role, paletteRole };
}

// アーチの株分け増幅プラン：親の t 値配列からラウンドロビンで子株を生成
export function amplifyArchPlan(ts, chosen, targetTotal = 55) {
  const plan = [];
  if (!ts || ts.length === 0) return plan;
  const total = Math.min(targetTotal, ts.length * 6);
  const random = mulberry32(hashSeed(`arch|${chosen.type}|${chosen.colorHex}|${targetTotal}|${ts.join(',')}`));
  const paletteRoles = exactPaletteRoles(total, random);
  for (let i = 0; i < total; i++) {
    const parentT = ts[i % ts.length];
    let t = parentT + (random() - 0.5) * 0.12; // ±0.06
    t = Math.min(0.98, Math.max(0.02, t));
    const v = pickVariety(chosen, 'child', { random, paletteRole: paletteRoles[i] });
    plan.push({ t, type: v.type, colorHex: v.colorHex, scale: v.scale, role: v.role, paletteRole: v.paletteRole });
  }
  return plan;
}

// テーブルの株分け増幅プラン：既存の花の周囲へ極座標オフセットで子株を散らす
export function amplifyTablePlan(locals, chosen, targetPerTable = 12) {
  const plan = [];
  const localsLen = locals ? locals.length : 0;
  const total = Math.max(0, targetPerTable - localsLen);
  if (total <= 0 || localsLen === 0) return plan;
  const random = mulberry32(hashSeed(`table|${chosen.type}|${chosen.colorHex}|${targetPerTable}|${locals.map(({ x, z }) => `${x},${z}`).join('|')}`));
  const paletteRoles = exactPaletteRoles(total, random);
  // 正式セッティングのチャージャーと給仕域を守る中央28cm以内だけを装花に使う。
  const floralRadius = 0.28;
  for (let i = 0; i < total; i++) {
    const parent = locals[i % localsLen];
    const angle = random() * Math.PI * 2;
    const r = lerp(0.025, 0.075, random());
    let x = parent.x + Math.cos(angle) * r;
    let z = parent.z + Math.sin(angle) * r;
    const d = Math.hypot(x, z);
    if (d > floralRadius) {
      const k = floralRadius / d;
      x *= k; z *= k;
    }
    const v = pickVariety(chosen, 'child', { random, paletteRole: paletteRoles[i] });
    plan.push({ x, z, type: v.type, colorHex: v.colorHex, scale: v.scale, role: v.role, paletteRole: v.paletteRole });
  }
  return plan;
}

// 吊りボールの追加株プラン：正規化済みのランダム方向（やや下半球寄り）
let ballPlanSequence = 0;
export function ballExtraPlan(chosen, n = 4) {
  const plan = [];
  const random = mulberry32(hashSeed(`ball|${chosen.type}|${chosen.colorHex}|${n}|${ballPlanSequence++}`));
  const paletteRoles = exactPaletteRoles(n, random);
  for (let i = 0; i < n; i++) {
    const yaw = random() * Math.PI * 2;
    // y は -1〜0.4 の範囲に偏らせ、下半球寄りにする
    const y = lerp(-1, 0.4, random());
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const dir = new THREE.Vector3(Math.cos(yaw) * radius, y, Math.sin(yaw) * radius).normalize();
    const v = pickVariety(chosen, 'child', { random, paletteRole: paletteRoles[i] });
    plan.push({ dir, type: v.type, colorHex: v.colorHex, scale: v.scale, role: v.role, paletteRole: v.paletteRole });
  }
  return plan;
}
