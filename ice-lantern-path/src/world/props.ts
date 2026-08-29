import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { D } from '../ice/dims';
import {
  berryMaterial,
  contactShadow,
  fabricMaterial,
  metalMaterial,
  needleMaterial,
  pickProxy,
  resinMaterial,
  plasticMaterial,
  tex,
  woodMaterial,
} from './materials';

function v2(x: number, y: number) {
  return new THREE.Vector2(x, y);
}

function lathe(points: THREE.Vector2[], segments = 64) {
  const g = new THREE.LatheGeometry(points, segments);
  g.computeVertexNormals();
  return g;
}

/** radius of the outer mould's inner wall at height y (it has a draft taper) */
export function moldInnerRadiusAt(y: number) {
  const t = THREE.MathUtils.clamp((y - D.outerFloor) / (D.outerH - D.outerFloor), 0, 1);
  return 0.15 + t * 0.01;
}

/** radius of the inner mould's outer wall at height y (world-local, mould base at 0) */
export function innerMoldRadiusAt(y: number) {
  const t = THREE.MathUtils.clamp((y - D.cavityFloor) / D.innerH, 0, 1);
  return 0.0925 + t * 0.004;
}

export interface OuterMold {
  group: THREE.Group;
  body: THREE.Mesh;
  handles: THREE.Object3D[];
  spacers: THREE.Group;
  shadow: THREE.Mesh;
}

export function buildOuterMold(): OuterMold {
  const group = new THREE.Group();
  const mat = resinMaterial();
  const steel = metalMaterial();

  // two shallow moulded ribs so the pail reads as a real product, not a tube
  const pts = [
    v2(0, 0),
    v2(0.166, 0),
    v2(0.1705, 0.008),
    v2(0.1735, 0.086),
    v2(0.1785, 0.094),
    v2(0.1755, 0.104),
    v2(0.1745, 0.176),
    v2(0.1795, 0.184),
    v2(0.1765, 0.194),
    v2(0.1785, D.outerH),
    v2(0.1755, D.outerH + 0.005),
    v2(0.1605, D.outerH + 0.003),
    v2(0.15, D.outerFloor),
    v2(0.144, D.outerFloor - 0.006),
    v2(0, D.outerFloor),
  ];
  const body = new THREE.Mesh(lathe(pts, 72), mat);
  body.castShadow = true;
  body.receiveShadow = true;
  body.renderOrder = 20;
  group.add(body);

  // two D handles, physically rooted in the rim
  const handles: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) {
    const h = new THREE.Group();
    const lug = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.048, 0.052), steel);
    lug.position.set(sx * 0.1785, D.outerH - 0.03, 0);
    h.add(lug);
    const bail = new THREE.Mesh(new THREE.TorusGeometry(0.042, 0.0075, 8, 20, Math.PI * 1.02), steel);
    bail.position.set(sx * 0.192, D.outerH - 0.03, 0);
    bail.rotation.y = Math.PI / 2;
    bail.rotation.z = sx > 0 ? -Math.PI / 2 : Math.PI / 2;
    h.add(bail);
    h.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
    });
    h.add(pickProxy(0.075, D.outerH - 0.03));
    h.children[h.children.length - 1].position.x = sx * 0.19;
    handles.push(h);
    group.add(h);
  }

  // three spacers: they carry the inner mould 3 cm off the floor and funnel
  // it to the centre. Slight funnel chamfer on top, small enough to release
  // once the outside of the mould has been warmed.
  const spacers = new THREE.Group();
  const spacerMat = plasticMaterial(0x8f9aa2, 0.55);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.35;
    const s = new THREE.Group();
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.062, D.spacerH, 0.05), spacerMat);
    pad.position.set(D.spacerR, D.outerFloor + D.spacerH / 2, 0);
    s.add(pad);
    // funnel fin: leans outward towards the top so the inner mould drops in
    const finShape = new THREE.Shape();
    finShape.moveTo(-0.008, 0);
    finShape.lineTo(0.006, 0);
    finShape.lineTo(0.024, D.spacerFin - D.spacerH);
    finShape.lineTo(0.008, D.spacerFin - D.spacerH);
    finShape.closePath();
    const fin = new THREE.Mesh(
      new THREE.ExtrudeGeometry(finShape, { depth: 0.044, bevelEnabled: false }),
      spacerMat
    );
    fin.rotation.y = Math.PI / 2;
    fin.position.set(D.spacerR + 0.026, D.outerFloor + D.spacerH, 0.022);
    s.add(fin);
    s.rotation.y = a;
    s.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        (o as THREE.Mesh).castShadow = true;
        (o as THREE.Mesh).receiveShadow = true;
      }
    });
    spacers.add(s);
  }
  group.add(spacers);

  const shadow = contactShadow(0.26, 0.26);
  shadow.position.y = 0.004;
  group.add(shadow);

  group.userData.shadowDecal = shadow;
  group.userData.grab = 'outer';
  return { group, body, handles, spacers, shadow };
}

export interface InnerMold {
  group: THREE.Group;
  body: THREE.Mesh;
  handle: THREE.Group;
}

export function buildInnerMold(): InnerMold {
  const group = new THREE.Group();
  const mat = plasticMaterial(0xa2b3bf, 0.34);
  const pts = [
    v2(0, 0),
    v2(0.086, 0),
    v2(0.0925, 0.007),
    v2(0.0965, D.innerH),
    v2(0.0945, D.innerH + 0.004),
    v2(0.0835, D.innerH + 0.002),
    v2(0.0795, D.innerFloor),
    v2(0.074, D.innerFloor - 0.005),
    v2(0, D.innerFloor),
  ];
  const body = new THREE.Mesh(lathe(pts, 56), mat);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const handle = new THREE.Group();
  const barMat = plasticMaterial(0x6f8496, 0.45);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.196, 0.014, 0.022), barMat);
  bar.position.y = D.innerH + 0.028;
  handle.add(bar);
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.036, 0.02), barMat);
    post.position.set(sx * 0.089, D.innerH + 0.012, 0);
    handle.add(post);
  }
  const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.02, 0.026, 16), barMat);
  knob.position.y = D.innerH + 0.045;
  handle.add(knob);
  handle.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
  });
  group.add(handle);
  group.add(pickProxy(0.12, D.innerH * 0.6));
  group.userData.grab = 'inner';
  return { group, body, handle };
}

export interface Pitcher {
  group: THREE.Group;
  spoutTip: THREE.Object3D;
  water: THREE.Mesh;
  setLevel(v: number): void;
}

export function buildPitcher(waterMat: THREE.Material): Pitcher {
  const group = new THREE.Group();
  const mat = metalMaterial();
  mat.color.setHex(0x9fa8ac);
  const pts = [
    v2(0, 0),
    v2(0.05, 0),
    v2(0.056, 0.009),
    v2(0.072, 0.07),
    v2(0.07, 0.132),
    v2(0.058, 0.184),
    v2(0.0605, 0.192),
    v2(0.0535, 0.1945),
    v2(0.0515, 0.187),
    v2(0.0625, 0.132),
    v2(0.064, 0.07),
    v2(0.046, 0.014),
    v2(0, 0.011),
  ];
  const body = new THREE.Mesh(lathe(pts, 48), mat);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.045, 0.166, 0),
    new THREE.Vector3(0.082, 0.196, 0),
    new THREE.Vector3(0.116, 0.201, 0),
    new THREE.Vector3(0.138, 0.19, 0),
  ]);
  const spout = new THREE.Mesh(new THREE.TubeGeometry(curve, 20, 0.0145, 10, false), mat);
  spout.castShadow = true;
  group.add(spout);
  const spoutTip = new THREE.Object3D();
  spoutTip.position.set(0.142, 0.186, 0);
  group.add(spoutTip);

  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.0085, 8, 22, Math.PI * 1.15), mat);
  handle.position.set(-0.066, 0.125, 0);
  handle.rotation.y = Math.PI / 2;
  handle.rotation.z = -0.35;
  handle.castShadow = true;
  group.add(handle);

  const water = new THREE.Mesh(new THREE.CircleGeometry(0.062, 32), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.155;
  water.renderOrder = 9;
  group.add(water);

  const shadow = contactShadow(0.1, 0.24);
  shadow.position.y = 0.003;
  group.add(shadow);
  group.add(pickProxy(0.1, 0.1));

  group.userData.shadowDecal = shadow;
  group.userData.grab = 'pitcher';
  return {
    group,
    spoutTip,
    water,
    setLevel(v: number) {
      const y = THREE.MathUtils.lerp(0.02, 0.155, THREE.MathUtils.clamp(v, 0, 1));
      water.position.y = y;
      const r = THREE.MathUtils.lerp(0.048, 0.062, THREE.MathUtils.clamp(v, 0, 1));
      water.scale.setScalar(r / 0.062);
      water.visible = v > 0.02;
    },
  };
}

export type DecorKind = 'berry' | 'sprig' | 'petal';

export function buildBerry() {
  const g = new THREE.Group();
  const b = new THREE.Mesh(new THREE.SphereGeometry(0.0115, 16, 12), berryMaterial());
  b.scale.set(1, 0.92, 1);
  b.castShadow = true;
  g.add(b);
  const calyx = new THREE.Mesh(
    new THREE.SphereGeometry(0.0035, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0x3a2a20, roughness: 0.8 })
  );
  calyx.position.y = 0.0105;
  g.add(calyx);
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0011, 0.0013, 0.012, 5),
    new THREE.MeshStandardMaterial({ color: 0x4b3a2a, roughness: 0.85 })
  );
  stem.position.y = 0.016;
  stem.rotation.z = 0.3;
  g.add(stem);
  g.add(pickProxy(0.05, 0.008));
  g.userData.grab = 'decor';
  g.userData.kind = 'berry';
  g.userData.radius = 0.014;
  return g;
}

export function buildSprig(seed = 1) {
  const g = new THREE.Group();
  const parts: THREE.BufferGeometry[] = [];
  const len = 0.072;
  const stem = new THREE.CylinderGeometry(0.0016, 0.0022, len, 6);
  stem.rotateZ(Math.PI / 2);
  stem.translate(len / 2 - 0.03, 0, 0);
  parts.push(stem);
  let s = seed * 7.13;
  const rnd = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  for (let i = 0; i < 22; i++) {
    const t = 0.1 + (i / 22) * 0.86;
    const x = -0.03 + t * len;
    const up = i % 2 === 0 ? 1 : -1;
    const nl = 0.02 * (1 - t * 0.45) * (0.8 + rnd() * 0.4);
    const n = new THREE.ConeGeometry(0.0013, nl, 4);
    n.translate(0, nl / 2, 0);
    n.rotateZ(up * (0.75 + rnd() * 0.35) * -1 + (up > 0 ? 0 : Math.PI));
    n.rotateX((rnd() - 0.5) * 1.5);
    n.translate(x, 0, 0);
    parts.push(n);
  }
  const mesh = new THREE.Mesh(mergeGeometries(parts)!, needleMaterial());
  mesh.castShadow = true;
  g.add(mesh);
  g.add(pickProxy(0.055, 0.006));
  g.userData.grab = 'decor';
  g.userData.kind = 'sprig';
  g.userData.radius = 0.04;
  return g;
}

export function buildPetal() {
  const geo = new THREE.PlaneGeometry(0.017, 0.026, 4, 5);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    pos.setZ(i, (x * x) * 9 + Math.cos(y * 40) * 0.0004);
    pos.setX(i, x * (1 - Math.abs(y) * 12));
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      color: 0xf0e3e6,
      roughness: 0.72,
      side: THREE.DoubleSide,
      metalness: 0,
    })
  );
  m.castShadow = true;
  const g = new THREE.Group();
  g.add(m);
  g.add(pickProxy(0.05, 0.006));
  g.userData.grab = 'decor';
  g.userData.kind = 'petal';
  g.userData.radius = 0.016;
  return g;
}

export interface Led {
  group: THREE.Group;
  diffuser: THREE.MeshStandardMaterial;
  light: THREE.PointLight;
  setOn(v: number): void;
}

export function buildLed(): Led {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: 0x33383d,
    roughness: 0.62,
    metalness: 0.15,
    bumpMap: tex.fine,
    bumpScale: 0.15,
  });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.041, 0.043, 0.022, 28), bodyMat);
  body.position.y = 0.011;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);
  const gasket = new THREE.Mesh(new THREE.TorusGeometry(0.0405, 0.0035, 8, 28), bodyMat);
  gasket.rotation.x = Math.PI / 2;
  gasket.position.y = 0.022;
  group.add(gasket);

  const diffuser = new THREE.MeshStandardMaterial({
    color: 0xf3f1ea,
    roughness: 0.85,
    metalness: 0,
    emissive: new THREE.Color(0xffb765),
    emissiveIntensity: 0,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.036, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.42), diffuser);
  dome.position.y = 0.0225;
  dome.scale.y = 0.7;
  group.add(dome);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.012, 24), diffuser);
  collar.position.y = 0.028;
  group.add(collar);

  const sw = new THREE.Mesh(
    new THREE.CylinderGeometry(0.008, 0.008, 0.006, 12),
    new THREE.MeshStandardMaterial({ color: 0xd8683c, roughness: 0.5 })
  );
  sw.rotation.z = Math.PI / 2;
  sw.position.set(0.042, 0.011, 0);
  group.add(sw);
  group.userData.switchMesh = sw;

  const light = new THREE.PointLight(0xffb469, 0, 1.6, 2);
  light.position.y = 0.05;
  group.add(light);

  const shadow = contactShadow(0.07, 0.24);
  shadow.position.y = 0.002;
  group.add(shadow);
  group.add(pickProxy(0.075, 0.03));

  group.userData.shadowDecal = shadow;
  group.userData.grab = 'led';
  return {
    group,
    diffuser,
    light,
    setOn(v: number) {
      diffuser.emissiveIntensity = v * 2.6;
      light.intensity = v * 0.55;
    },
  };
}

export function buildGloves() {
  const g = new THREE.Group();
  const mat = fabricMaterial(0xa8443a);
  const cuff = new THREE.MeshStandardMaterial({ color: 0xe8e2d8, roughness: 0.95 });
  for (let i = 0; i < 2; i++) {
    const m = new THREE.Group();
    const palm = new THREE.Mesh(new THREE.SphereGeometry(0.05, 18, 14), mat);
    palm.scale.set(1, 0.5, 1.35);
    palm.position.y = 0.024;
    palm.castShadow = true;
    m.add(palm);
    const thumb = new THREE.Mesh(new THREE.SphereGeometry(0.021, 12, 10), mat);
    thumb.scale.set(1, 0.62, 1.5);
    thumb.position.set(0.042, 0.02, 0.012);
    thumb.rotation.y = 0.5;
    thumb.castShadow = true;
    m.add(thumb);
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.04, 0.05, 16), cuff);
    c.rotation.x = Math.PI / 2 - 0.15;
    c.position.set(0, 0.026, -0.075);
    c.castShadow = true;
    m.add(c);
    m.position.set(i * 0.115, 0, i * 0.02);
    m.rotation.y = (i === 0 ? 1 : -1) * 0.35 + 0.2;
    if (i === 1) m.scale.x = -1;
    g.add(m);
  }
  const shadow = contactShadow(0.16, 0.2);
  shadow.position.set(0.06, 0.002, -0.01);
  g.add(shadow);
  return g;
}

export function buildTray() {
  const g = new THREE.Group();
  const mat = woodMaterial(0x7d6349, 0.88);
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.016, 0.2), mat);
  base.position.y = 0.008;
  base.receiveShadow = true;
  base.castShadow = true;
  g.add(base);
  const rim = [
    new THREE.BoxGeometry(0.3, 0.026, 0.014),
    new THREE.BoxGeometry(0.3, 0.026, 0.014),
    new THREE.BoxGeometry(0.014, 0.026, 0.2),
    new THREE.BoxGeometry(0.014, 0.026, 0.2),
  ];
  const offs = [
    [0, 0.019, 0.093],
    [0, 0.019, -0.093],
    [0.143, 0.019, 0],
    [-0.143, 0.019, 0],
  ];
  rim.forEach((r, i) => {
    const m = new THREE.Mesh(r, mat);
    m.position.set(offs[i][0], offs[i][1], offs[i][2]);
    m.castShadow = true;
    g.add(m);
  });
  const divider = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.02, 0.19), mat);
  divider.position.set(-0.04, 0.016, 0);
  g.add(divider);
  const shadow = contactShadow(0.19, 0.22);
  shadow.position.y = 0.002;
  g.add(shadow);
  return g;
}

/** A folded warm cloth used to loosen the mould before demoulding. */
export function buildCloth() {
  const g = new THREE.Group();
  const mat = fabricMaterial(0xd8cfc0);
  for (let i = 0; i < 3; i++) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.13 - i * 0.012, 0.011, 0.09 - i * 0.008), mat);
    f.position.y = 0.006 + i * 0.011;
    f.rotation.y = (i - 1) * 0.09;
    f.castShadow = true;
    g.add(f);
  }
  g.userData.grab = 'cloth';
  return g;
}
