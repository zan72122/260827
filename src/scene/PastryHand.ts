import * as THREE from 'three';
import { clamp, damp, lerp } from '../util/math';

interface Section {
  x: number;
  rz: number;
  ry: number;
}

interface FingerSpec {
  z: number;
  y: number;
  spread: number;
  phalanx: { len: number; r: number }[];
  rest: number[];
  curl: number[];
}

const SEG = 14;

/**
 * The adult pâtissier's hand on the bag, built as one continuous lofted surface
 * — forearm, wrist, palm — with tapered fingers grown from the knuckle line, so
 * it reads as a hand rather than a pile of capsules. It only squeezes; the
 * child never holds the professional tool.
 */
export class PastryHand {
  readonly group = new THREE.Group();
  private geo = new THREE.BufferGeometry();
  private squeeze = 0;
  private built = -1;

  private arm: Section[] = [
    { x: -0.250, rz: 0.0420, ry: 0.0395 },
    { x: -0.190, rz: 0.0392, ry: 0.0362 },
    { x: -0.130, rz: 0.0345, ry: 0.0310 },
    { x: -0.088, rz: 0.0288, ry: 0.0232 },
    { x: -0.062, rz: 0.0270, ry: 0.0196 },
    { x: -0.030, rz: 0.0330, ry: 0.0202 },
    { x: 0.004, rz: 0.0392, ry: 0.0198 },
    { x: 0.030, rz: 0.0405, ry: 0.0184 },
    { x: 0.046, rz: 0.0372, ry: 0.0158 },
    { x: 0.054, rz: 0.0300, ry: 0.0120 },
  ];

  private fingers: FingerSpec[] = [
    {
      z: 0.0300, y: -0.0018, spread: 0.16,
      phalanx: [{ len: 0.0440, r: 0.0098 }, { len: 0.0282, r: 0.0086 }, { len: 0.0224, r: 0.0074 }],
      rest: [-0.30, -0.66, -0.60], curl: [0.30, 0.26, 0.20],
    },
    {
      z: 0.0100, y: -0.0006, spread: 0.05,
      phalanx: [{ len: 0.0482, r: 0.0102 }, { len: 0.0308, r: 0.0090 }, { len: 0.0232, r: 0.0076 }],
      rest: [-0.28, -0.64, -0.58], curl: [0.31, 0.27, 0.21],
    },
    {
      z: -0.0104, y: -0.0010, spread: -0.05,
      phalanx: [{ len: 0.0452, r: 0.0098 }, { len: 0.0292, r: 0.0086 }, { len: 0.0222, r: 0.0072 }],
      rest: [-0.30, -0.66, -0.60], curl: [0.30, 0.26, 0.20],
    },
    {
      z: -0.0290, y: -0.0026, spread: -0.17,
      phalanx: [{ len: 0.0372, r: 0.0086 }, { len: 0.0246, r: 0.0076 }, { len: 0.0196, r: 0.0064 }],
      rest: [-0.34, -0.70, -0.62], curl: [0.29, 0.25, 0.20],
    },
  ];

  private thumb: FingerSpec = {
    z: 0.0345, y: -0.0090, spread: 0.95,
    phalanx: [{ len: 0.0362, r: 0.0118 }, { len: 0.0300, r: 0.0100 }],
    rest: [-0.40, -0.34], curl: [0.24, 0.20],
  };

  constructor() {
    const skin = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0.716, 0.545, 0.456),
      roughness: 0.66,
      metalness: 0,
      clearcoat: 0.07,
      clearcoatRoughness: 0.72,
      sheen: 0.2,
      sheenRoughness: 0.85,
      sheenColor: new THREE.Color(0.82, 0.5, 0.44),
      vertexColors: true,
      flatShading: false,
    });
    const mesh = new THREE.Mesh(this.geo, skin);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);

    const sleeve = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0455, 0.0505, 0.135, 20, 1, true),
      new THREE.MeshStandardMaterial({
        color: 0xeae7df,
        roughness: 0.88,
        metalness: 0,
        side: THREE.DoubleSide,
      }),
    );
    sleeve.rotation.z = Math.PI / 2;
    sleeve.position.set(-0.212, 0.0, 0.0);
    sleeve.castShadow = true;
    this.group.add(sleeve);

    this.rebuild(0);
  }

  setSqueeze(v: number, dt: number): void {
    this.squeeze = damp(this.squeeze, clamp(v, 0, 1), 0.08, dt);
    if (Math.abs(this.squeeze - this.built) > 0.02) this.rebuild(this.squeeze);
  }

  private rebuild(sq: number): void {
    this.built = sq;
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];

    const pushLoft = (
      sections: { c: THREE.Vector3; rz: number; ry: number; up: THREE.Vector3; side: THREE.Vector3; tint: number }[],
      capStart: boolean,
      capEnd: boolean,
    ): void => {
      const base = pos.length / 3;
      for (const s of sections) {
        for (let i = 0; i <= SEG; i++) {
          const th = (i / SEG) * Math.PI * 2;
          const a = Math.cos(th) * s.rz;
          const b = Math.sin(th) * s.ry;
          pos.push(
            s.c.x + s.side.x * a + s.up.x * b,
            s.c.y + s.side.y * a + s.up.y * b,
            s.c.z + s.side.z * a + s.up.z * b,
          );
          // knuckles and fingertips run a touch warmer
          const warm = s.tint;
          col.push(1 + warm * 0.10, 1 - warm * 0.05, 1 - warm * 0.08);
        }
      }
      for (let j = 0; j < sections.length - 1; j++) {
        for (let i = 0; i < SEG; i++) {
          const a = base + j * (SEG + 1) + i;
          const b = a + 1;
          const c = base + (j + 1) * (SEG + 1) + i + 1;
          const d = base + (j + 1) * (SEG + 1) + i;
          idx.push(a, b, c, a, c, d);
        }
      }
      const capOne = (row: number, flip: boolean) => {
        const s = sections[row];
        const ci = pos.length / 3;
        pos.push(s.c.x, s.c.y, s.c.z);
        col.push(1 + s.tint * 0.10, 1 - s.tint * 0.05, 1 - s.tint * 0.08);
        for (let i = 0; i < SEG; i++) {
          const a = base + row * (SEG + 1) + i;
          const b = a + 1;
          if (flip) idx.push(ci, b, a);
          else idx.push(ci, a, b);
        }
      };
      if (capStart) capOne(0, true);
      if (capEnd) capOne(sections.length - 1, false);
    };

    const up = new THREE.Vector3(0, 1, 0);
    const side = new THREE.Vector3(0, 0, 1);

    // forearm + palm as one surface
    pushLoft(
      this.arm.map((s, i) => ({
        c: new THREE.Vector3(s.x, 0, 0),
        rz: s.rz,
        ry: s.ry,
        up,
        side,
        tint: i >= 7 ? 0.5 : 0,
      })),
      true,
      true,
    );

    const buildFinger = (f: FingerSpec, root: THREE.Vector3): void => {
      const sections: {
        c: THREE.Vector3;
        rz: number;
        ry: number;
        up: THREE.Vector3;
        side: THREE.Vector3;
        tint: number;
      }[] = [];
      let ang = 0;
      const p = root.clone();
      const yaw = f.spread;
      const dir = new THREE.Vector3();
      let prevR = f.phalanx[0].r * 1.12;
      sections.push({
        c: p.clone(),
        rz: prevR,
        ry: prevR * 0.94,
        up,
        side: new THREE.Vector3(-Math.sin(yaw), 0, Math.cos(yaw)),
        tint: 0.45,
      });
      for (let k = 0; k < f.phalanx.length; k++) {
        ang += lerp(f.rest[k], f.rest[k] - f.curl[k], sq);
        const steps = 3;
        for (let s = 1; s <= steps; s++) {
          const t = s / steps;
          dir.set(Math.cos(ang) * Math.cos(yaw), Math.sin(ang), Math.cos(ang) * Math.sin(yaw));
          p.addScaledVector(dir, f.phalanx[k].len / steps);
          // knuckle bulge, then taper toward the tip
          const bulge = 1 + 0.10 * Math.sin(Math.PI * t);
          const r = f.phalanx[k].r * bulge * (k === f.phalanx.length - 1 ? 1 - 0.30 * t * t : 1);
          sections.push({
            c: p.clone(),
            rz: r,
            ry: r * 0.92,
            up: new THREE.Vector3(-Math.sin(ang), Math.cos(ang), 0),
            side: new THREE.Vector3(-Math.sin(yaw), 0, Math.cos(yaw)),
            tint: 0.35 + 0.45 * (k / f.phalanx.length),
          });
        }
      }
      pushLoft(sections, true, true);
    };

    for (const f of this.fingers) buildFinger(f, new THREE.Vector3(0.044, f.y, f.z));
    buildFinger(this.thumb, new THREE.Vector3(-0.006, this.thumb.y, this.thumb.z));

    this.geo.dispose();
    this.geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    this.geo.setIndex(idx);
    this.geo.computeVertexNormals();
    this.geo.computeBoundingSphere();
  }
}
