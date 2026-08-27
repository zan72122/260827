// Procedural ship models.
//
// The icebreaker is a fictional mid-size design informed by real coastal
// icebreakers: wide spoon bow with a low stem angle that lets the hull ride
// up onto level ice, a reinforced (darker) ice belt at the waterline,
// moderate draft, working deck aft with crane/winch/bollards, mast with
// radar. Livery is invented: oxide-red hull, off-white upperworks, buff
// funnel — no real operator's marks.

import * as THREE from 'three';
import { IB_LENGTH, IB_BEAM, IB_DRAFT, SUPPLY_LENGTH, SUPPLY_BEAM, mulberry32 } from './const';

interface HullParams {
  length: number;
  beam: number;
  draft: number;
  freeboard: number;   // deck edge above waterline amidships
  bowSheer: number;    // extra deck height at the stem
  bowStart: number;    // t where the bow taper begins (0..1, bow at t=1)
  spoon: number;       // how far the keel sweeps up at the bow (0..1 of draft)
  sternTaper: number;
}

function hullSection(q: number, hb: number, yDeck: number, yKeel: number, fullness: number): [number, number] {
  const x = hb * Math.pow(Math.cos(q * Math.PI / 2), fullness);
  const y = yDeck + (yKeel - yDeck) * Math.pow(Math.sin(q * Math.PI / 2), 1.5);
  return [x, y];
}

function buildHullGeometry(p: HullParams): THREE.BufferGeometry {
  const NS = 30;  // stations along length
  const M = 9;    // points per side of a section
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const ringSize = M * 2 + 1;
  for (let si = 0; si <= NS; si++) {
    const t = si / NS;
    const z = -p.length / 2 + t * p.length;
    // plan form
    let hb: number;
    if (t > p.bowStart) {
      const s = (t - p.bowStart) / (1 - p.bowStart);
      hb = (p.beam / 2) * Math.pow(Math.max(0, 1 - s * s), 0.62);
    } else if (t < 0.12) {
      const s = (0.12 - t) / 0.12;
      hb = (p.beam / 2) * (1 - p.sternTaper * s * s);
    } else {
      hb = p.beam / 2;
    }
    hb = Math.max(hb, 0.02);
    // keel line: flat amidships, spoon sweep at the bow, cut-up at the stern
    let yKeel = -p.draft;
    if (t > p.bowStart + 0.04) {
      const s = (t - p.bowStart - 0.04) / (1 - p.bowStart - 0.04);
      yKeel = -p.draft + (p.draft * p.spoon + 0.6) * Math.pow(s, 1.6);
    } else if (t < 0.10) {
      const s = (0.10 - t) / 0.10;
      yKeel = -p.draft + p.draft * 0.5 * Math.pow(s, 1.4);
    }
    // sheer line
    const sBow = Math.max(0, (t - 0.55) / 0.45);
    const sSt = Math.max(0, (0.25 - t) / 0.25);
    const yDeck = p.freeboard + p.bowSheer * sBow * sBow + 0.35 * sSt * sSt;
    // section fullness: boxy amidships, rounder toward bow
    const fullness = 0.42 + 0.5 * Math.max(0, (t - 0.5) / 0.5) + 0.2 * sSt;

    for (let k = -M; k <= M; k++) {
      const q = Math.abs(k) / M;
      const side = k < 0 ? -1 : 1;
      const [sx, sy] = hullSection(1 - q, hb, yDeck, yKeel, fullness);
      // 1-q: k=±M is deck edge, k=0 is keel
      positions.push(sx * side, sy, z);
      uvs.push(t, 1 - q);
    }
  }
  for (let si = 0; si < NS; si++) {
    for (let k = 0; k < ringSize - 1; k++) {
      const a = si * ringSize + k;
      const b = a + ringSize;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  // transom cap (stern ring fan)
  const base = 0;
  for (let k = 0; k < ringSize - 1; k++) {
    indices.push(base + k, base + k + 1, base + Math.floor(ringSize / 2));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Paint zones + weathering baked into vertex colours (multiplied by a streak map). */
function paintHull(geo: THREE.BufferGeometry, opts: {
  topsides: THREE.Color; iceBelt: THREE.Color; bottom: THREE.Color;
  beltTop: number; beltBottom: number; scuffBow?: boolean; length: number;
}): void {
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const rng = mulberry32(4242);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (y > opts.beltTop) c.copy(opts.topsides);
    else if (y > opts.beltBottom) c.copy(opts.iceBelt);
    else c.copy(opts.bottom);
    if (opts.scuffBow && z > opts.length * 0.18 && y < opts.beltTop + 0.6 && y > opts.beltBottom - 0.5) {
      // abraded paint where the bow grinds ice — mottled bare steel
      const w = Math.min(1, (z - opts.length * 0.18) / (opts.length * 0.3)) * (0.35 + rng() * 0.45);
      c.lerp(new THREE.Color(0.42, 0.40, 0.38), w * 0.55);
    }
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

/** Rust streaks + plate seams, multiplied over the paint. */
function makeStreakTexture(seed: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 512, 128);
  const rng = mulberry32(seed);
  // faint plate seams
  ctx.strokeStyle = 'rgba(120,120,125,0.18)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 9; i++) {
    const x = 30 + rng() * 460;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 128); ctx.stroke();
  }
  for (let i = 0; i < 3; i++) {
    const y = 20 + rng() * 60;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(512, y); ctx.stroke();
  }
  // asymmetric rust runs from scuppers/fittings near the deck edge (v=1 is keel; deck edge v=0)
  for (let i = 0; i < 14; i++) {
    const x = rng() * 512;
    const len = 12 + rng() * 46;
    const w = 1.5 + rng() * 3.5;
    const g = ctx.createLinearGradient(0, 0, 0, len);
    const strength = 0.12 + rng() * 0.3;
    g.addColorStop(0, `rgba(120,62,30,${strength})`);
    g.addColorStop(1, 'rgba(120,62,30,0)');
    ctx.save();
    ctx.translate(x, rng() * 14);
    ctx.fillStyle = g;
    ctx.fillRect(-w / 2, 0, w, len);
    ctx.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

function makeWindowTexture(cols: number, warm: boolean): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#e7e5de';
  ctx.fillRect(0, 0, 256, 64);
  const w = 256 / cols;
  for (let i = 0; i < cols; i++) {
    ctx.fillStyle = warm && i % 3 === 1 ? '#4a4438' : '#20262c';
    ctx.fillRect(i * w + w * 0.22, 18, w * 0.56, 26);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function box(w: number, h: number, d: number, mat: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
}

function cyl(r1: number, r2: number, h: number, mat: THREE.Material, seg = 12): THREE.Mesh {
  return new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), mat);
}

export interface ShipModel {
  group: THREE.Group;
  radar?: THREE.Mesh;
  length: number;
  beam: number;
}

export function buildIcebreaker(): ShipModel {
  const g = new THREE.Group();
  const L = IB_LENGTH, B = IB_BEAM, D = IB_DRAFT;
  const F = 3.0; // freeboard

  const hullGeo = buildHullGeometry({
    length: L, beam: B, draft: D, freeboard: F,
    bowSheer: 1.5, bowStart: 0.63, spoon: 0.92, sternTaper: 0.22,
  });
  paintHull(hullGeo, {
    topsides: new THREE.Color('#7d2a1e'),
    iceBelt: new THREE.Color('#54201a'),
    bottom: new THREE.Color('#3a2320'),
    beltTop: 0.9, beltBottom: -1.5, scuffBow: true, length: L,
  });
  const hullMat = new THREE.MeshStandardMaterial({
    vertexColors: true, map: makeStreakTexture(11),
    roughness: 0.68, metalness: 0.08, side: THREE.DoubleSide,
  });
  const hull = new THREE.Mesh(hullGeo, hullMat);
  g.add(hull);
  const topsideMat = new THREE.MeshStandardMaterial({ color: '#7d2a1e', roughness: 0.7 });

  const steel = new THREE.MeshStandardMaterial({ color: '#dfdcd2', roughness: 0.8, metalness: 0.05 });
  const steelDark = new THREE.MeshStandardMaterial({ color: '#3c4146', roughness: 0.7, metalness: 0.2 });
  const deckMat = new THREE.MeshStandardMaterial({ color: '#5a5f58', roughness: 0.92 });
  const buff = new THREE.MeshStandardMaterial({ color: '#c8a45e', roughness: 0.75 });
  const rimed = new THREE.MeshStandardMaterial({ color: '#cfd6da', roughness: 0.95 }); // iced-up rails

  // deck
  const deck = box(B * 0.86, 0.24, L * 0.86, deckMat);
  deck.position.set(0, F + 0.02, -L * 0.03);
  g.add(deck);
  // bulwark along the foredeck
  const bwL = box(0.14, 0.9, L * 0.26, topsideMat);
  bwL.position.set(-B * 0.40, F + 0.55, L * 0.13);
  const bwR = bwL.clone(); bwR.position.x = B * 0.40;
  g.add(bwL, bwR);

  // superstructure (forward of midships, as on many working icebreakers)
  const houseMat = new THREE.MeshStandardMaterial({ color: '#e7e5de', roughness: 0.8 });
  const house = box(B * 0.62, 2.5, 9.5, houseMat);
  house.position.set(0, F + 1.35, 1.5);
  g.add(house);
  const bridgeMat = new THREE.MeshStandardMaterial({ map: makeWindowTexture(9, true), roughness: 0.65 });
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(B * 0.56, 2.2, 7.2), bridgeMat);
  bridge.position.set(0, F + 3.65, 1.9);
  g.add(bridge);
  // bridge wings
  const wingL = box(1.6, 1.1, 2.2, houseMat);
  wingL.position.set(-B * 0.36, F + 3.3, 3.6);
  const wingR = wingL.clone(); wingR.position.x = B * 0.36;
  g.add(wingL, wingR);

  // funnel, slightly raked aft
  const funnel = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.15, 3.6, 14), buff);
  funnel.scale.z = 1.7;
  funnel.rotation.x = -0.12;
  funnel.position.set(0, F + 4.4, -4.0);
  g.add(funnel);
  const funnelCap = new THREE.Mesh(new THREE.CylinderGeometry(1.02, 1.02, 0.55, 14), steelDark);
  funnelCap.scale.z = 1.7;
  funnelCap.rotation.x = -0.12;
  funnelCap.position.set(0, F + 6.1, -4.22);
  g.add(funnelCap);

  // main mast with rotating radar + crow's nest
  const mast = cyl(0.12, 0.2, 5.2, steel, 8);
  mast.position.set(0, F + 7.2, 0.6);
  g.add(mast);
  const nest = cyl(0.5, 0.55, 0.8, steel, 10);
  nest.position.set(0, F + 8.6, 0.6);
  g.add(nest);
  const radar = box(2.0, 0.16, 0.28, steelDark);
  radar.position.set(0, F + 9.6, 0.6);
  g.add(radar);
  const yard = box(2.6, 0.09, 0.09, steel);
  yard.position.set(0, F + 8.0, 0.6);
  g.add(yard);

  // foremast
  const fmast = cyl(0.08, 0.13, 3.2, steel, 8);
  fmast.position.set(0, F + 2.2, L * 0.33);
  g.add(fmast);

  // aft working deck: knuckle-boom crane, winch, bollards, liferafts
  const boomMat = new THREE.MeshStandardMaterial({ color: '#8f7a4c', roughness: 0.8 });
  const craneBase = cyl(0.55, 0.65, 1.4, boomMat, 12);
  craneBase.position.set(0, F + 0.8, -L * 0.27);
  g.add(craneBase);
  const boom = box(0.42, 0.42, 7.5, boomMat);
  boom.position.set(0, F + 3.0, -L * 0.27 - 2.6);
  boom.rotation.x = -0.62;
  g.add(boom);
  const winch = cyl(0.55, 0.55, 1.8, steelDark, 12);
  winch.rotation.z = Math.PI / 2;
  winch.position.set(0, F + 0.55, -L * 0.38);
  g.add(winch);
  for (const [bx, bz] of [[-1, 0.3], [1, 0.3], [-1, -0.42], [1, -0.42]] as const) {
    const bol = cyl(0.16, 0.16, 0.55, steelDark, 8);
    bol.position.set(bx * B * 0.36, F + 0.42, bz * L);
    g.add(bol);
  }
  for (const side of [-1, 1]) {
    const raft = cyl(0.42, 0.42, 1.1, steel, 10);
    raft.rotation.z = Math.PI / 2;
    raft.position.set(side * B * 0.30, F + 0.75, -L * 0.16);
    g.add(raft);
  }
  // lifeboat (muted orange) on the boat deck
  const boat = new THREE.Mesh(new THREE.CapsuleGeometry(0.55, 2.4, 4, 8),
    new THREE.MeshStandardMaterial({ color: '#b4562e', roughness: 0.8 }));
  boat.rotation.z = Math.PI / 2;
  boat.rotation.y = Math.PI / 2;
  boat.position.set(B * 0.32, F + 3.1, -1.8);
  g.add(boat);

  // iced-up railings (thin strips) along the aft deck edges
  for (const side of [-1, 1]) {
    const rail = box(0.05, 0.05, L * 0.42, rimed);
    rail.position.set(side * B * 0.41, F + 1.05, -L * 0.24);
    g.add(rail);
    const rail2 = rail.clone(); rail2.position.y = F + 0.65;
    g.add(rail2);
    for (let i = 0; i < 6; i++) {
      const st = box(0.05, 1.05, 0.05, rimed);
      st.position.set(side * B * 0.41, F + 0.55, -L * 0.05 - i * L * 0.076);
      g.add(st);
    }
  }

  g.traverse((o) => { o.castShadow = false; o.receiveShadow = false; });
  return { group: g, radar, length: L, beam: B };
}

export function buildSupplyShip(): ShipModel {
  const g = new THREE.Group();
  const L = SUPPLY_LENGTH, B = SUPPLY_BEAM;
  const F = 1.9;
  const hullGeo = buildHullGeometry({
    length: L, beam: B, draft: 2.4, freeboard: F,
    bowSheer: 0.9, bowStart: 0.7, spoon: 0.45, sternTaper: 0.1,
  });
  paintHull(hullGeo, {
    topsides: new THREE.Color('#2d4257'),
    iceBelt: new THREE.Color('#22303d'),
    bottom: new THREE.Color('#5e3b2e'),
    beltTop: 0.55, beltBottom: -0.9, length: L,
  });
  const hullMat = new THREE.MeshStandardMaterial({
    vertexColors: true, map: makeStreakTexture(77), roughness: 0.7, metalness: 0.08,
    side: THREE.DoubleSide,
  });
  g.add(new THREE.Mesh(hullGeo, hullMat));

  const deckMat = new THREE.MeshStandardMaterial({ color: '#66655c', roughness: 0.92 });
  const deck = box(B * 0.85, 0.2, L * 0.85, deckMat);
  deck.position.set(0, F, 0);
  g.add(deck);

  // wheelhouse aft
  const houseMat = new THREE.MeshStandardMaterial({ color: '#e3e0d6', roughness: 0.8 });
  const house = box(B * 0.6, 1.7, 3.4, houseMat);
  house.position.set(0, F + 0.95, -L * 0.3);
  g.add(house);
  const cabMat = new THREE.MeshStandardMaterial({ map: makeWindowTexture(5, true), roughness: 0.65 });
  const cab = new THREE.Mesh(new THREE.BoxGeometry(B * 0.52, 1.5, 2.6), cabMat);
  cab.position.set(0, F + 2.5, -L * 0.3);
  g.add(cab);
  const steel = new THREE.MeshStandardMaterial({ color: '#d8d5cb', roughness: 0.8 });
  const mast = cyl(0.07, 0.1, 2.4, steel, 8);
  mast.position.set(0, F + 4.2, -L * 0.32);
  g.add(mast);

  // cargo: crates + a tarped stack (this is what the crane unloads)
  const crateA = box(2.6, 1.9, 3.4, new THREE.MeshStandardMaterial({ color: '#7a6a4a', roughness: 0.85 }));
  crateA.position.set(-0.8, F + 1.05, L * 0.1);
  const crateB = box(2.2, 1.5, 2.6, new THREE.MeshStandardMaterial({ color: '#5d6b5d', roughness: 0.85 }));
  crateB.position.set(1.1, F + 0.85, L * 0.02);
  const tarp = box(3.4, 1.1, 2.8, new THREE.MeshStandardMaterial({ color: '#8d8574', roughness: 0.95 }));
  tarp.position.set(0, F + 0.65, L * 0.24);
  g.add(crateA, crateB, tarp);

  return { group: g, length: L, beam: B };
}
