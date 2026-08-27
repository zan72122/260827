// Santa: procedurally built, hierarchically rigged character.
// The rig is a plain Group hierarchy (each group = a bone); poses are authored
// rotation/position offsets blended by weight, with procedural overlays
// (walk cycle, breathing, peek sway, descent wobble) and — the heart of the
// game — a continuous "squash" deformation that compresses shoulders, belly,
// coat, fur trim and sack so the fat Santa can slide into a narrow flue.
import * as THREE from 'three';
import { clamp01, lerp, makeRng } from './util';
import { coatTexture, furTexture, sackTexture, skinTexture } from './textures';

export type PoseName =
  | 'carry' | 'peek' | 'rimSit' | 'tuck' | 'squat' | 'brushBeard'
  | 'kneel' | 'reach' | 'nose' | 'launch' | 'brushSnow' | 'sit' | 'wave'
  | 'faceCam';

type NodeName =
  | 'hips' | 'spine' | 'neck' | 'head'
  | 'shoulderL' | 'elbowL' | 'shoulderR' | 'elbowR'
  | 'hipL' | 'kneeL' | 'hipR' | 'kneeR' | 'bag';

interface NodeOffset {
  r?: [number, number, number];
  p?: [number, number, number];
}

type Pose = Partial<Record<NodeName, NodeOffset>>;

// ----- authored poses (radians / meters) -----
const POSES: Record<PoseName, Pose> = {
  carry: {
    spine: { r: [0.14, 0, 0.06] },
    hips: { r: [0, 0, -0.04] },
    shoulderR: { r: [-2.5, 0, -0.5] },   // arm up gripping sack strap
    elbowR: { r: [-0.9, 0, 0] },
    shoulderL: { r: [0.25, 0, 0.35] },
    elbowL: { r: [-0.4, 0, 0] },
    head: { r: [-0.08, 0, -0.05] },
    bag: { r: [0.12, 0, -0.1] }
  },
  peek: {
    spine: { r: [0.48, 0, 0.14] },       // lean over the flue mouth
    hips: { r: [0.1, 0, 0], p: [0, -0.05, 0] },
    neck: { r: [0.22, 0, 0] },
    head: { r: [0.18, 0.18, 0.08] },
    shoulderL: { r: [0.5, 0, 0.5] },     // hands braced wide on the rim
    elbowL: { r: [-0.5, 0, 0] },
    shoulderR: { r: [-2.2, 0, -0.55] },
    elbowR: { r: [-0.8, 0, 0] },
    hipL: { r: [-0.12, 0, 0] },
    kneeL: { r: [0.2, 0, 0] },
    bag: { r: [0.05, 0, -0.12], p: [0, -0.06, -0.08] } // sack sways toward the opening
  },
  rimSit: {
    hips: { p: [0, -0.1, 0] },
    spine: { r: [0.18, 0, 0] },
    hipL: { r: [-1.5, 0, -0.12] },
    kneeL: { r: [0.5, 0, 0] },
    hipR: { r: [-1.5, 0, 0.12] },
    kneeR: { r: [0.5, 0, 0] },
    shoulderL: { r: [-2.9, 0, -0.25] },  // both arms up, sack overhead
    elbowL: { r: [-0.35, 0, 0] },
    shoulderR: { r: [-2.9, 0, 0.25] },
    elbowR: { r: [-0.35, 0, 0] },
    head: { r: [0.16, 0, 0] },
    bag: { p: [0, 1.05, 0.34], r: [0, 0, 0] }
  },
  tuck: {
    spine: { r: [0.04, 0, 0] },
    hipL: { r: [-0.18, 0, -0.06] },
    kneeL: { r: [0.3, 0, 0] },
    hipR: { r: [-0.18, 0, 0.06] },
    kneeR: { r: [0.3, 0, 0] },
    shoulderL: { r: [-2.98, 0, -0.14] }, // arms fully overhead
    elbowL: { r: [-0.2, 0, 0] },
    shoulderR: { r: [-2.98, 0, 0.14] },
    elbowR: { r: [-0.2, 0, 0] },
    neck: { r: [-0.05, 0, 0] },
    head: { r: [0.1, 0, 0] },
    bag: { p: [0, 1.12, 0.3], r: [0, 0, 0] }
  },
  squat: {
    hips: { p: [0, -0.3, 0], r: [0.18, 0, 0] },
    spine: { r: [0.3, 0, 0] },
    hipL: { r: [-1.15, 0, -0.2] },
    kneeL: { r: [1.5, 0, 0] },
    hipR: { r: [-1.15, 0, 0.2] },
    kneeR: { r: [1.5, 0, 0] },
    shoulderL: { r: [0.6, 0, 0.6] },
    shoulderR: { r: [0.6, 0, -0.6] },
    elbowL: { r: [-0.5, 0, 0] },
    elbowR: { r: [-0.5, 0, 0] },
    head: { r: [-0.12, 0, 0] },
    bag: { r: [0.35, 0, 0], p: [0, -0.12, 0.05] }
  },
  brushBeard: {
    spine: { r: [0.06, 0, 0] },
    shoulderR: { r: [-1.9, -0.5, -0.9] },
    elbowR: { r: [-1.9, 0, 0] },
    shoulderL: { r: [0.15, 0, 0.25] },
    head: { r: [-0.14, -0.1, 0.06] },
    bag: { r: [0.1, 0, 0] }
  },
  kneel: {
    hips: { p: [0, -0.42, 0.0], r: [0.05, 0, 0] },
    spine: { r: [0.22, 0, 0] },
    hipL: { r: [-1.6, 0, -0.15] },
    kneeL: { r: [1.9, 0, 0] },
    hipR: { r: [-0.3, 0, 0.15] },
    kneeR: { r: [1.9, 0, 0] },
    shoulderL: { r: [0.3, 0, 0.4] },
    elbowL: { r: [-0.7, 0, 0] },
    shoulderR: { r: [0.2, 0, -0.3] },
    elbowR: { r: [-0.5, 0, 0] },
    head: { r: [0.14, 0, 0] },
    bag: { r: [0.3, 0, 0.3], p: [-0.1, -0.3, 0.15] }
  },
  reach: {
    spine: { r: [0.24, -0.3, 0] },
    shoulderR: { r: [-1.5, -0.6, -0.35] },
    elbowR: { r: [-0.35, 0, 0] },
    head: { r: [0.15, -0.35, 0] }
  },
  nose: {
    spine: { r: [-0.04, 0.1, 0] },
    shoulderR: { r: [-2.05, -0.75, -0.6] }, // finger rises beside the nose
    elbowR: { r: [-2.25, 0.25, 0] },
    shoulderL: { r: [0.12, 0, 0.2] },
    head: { r: [-0.05, -0.14, 0.08] },
    bag: { r: [0.08, 0, 0] }
  },
  launch: {
    spine: { r: [-0.1, 0, 0] },
    shoulderL: { r: [-3.0, 0, -0.1] },
    elbowL: { r: [-0.1, 0, 0] },
    shoulderR: { r: [-3.0, 0, 0.1] },
    elbowR: { r: [-0.1, 0, 0] },
    hipL: { r: [0.1, 0, -0.04] },
    hipR: { r: [0.1, 0, 0.04] },
    kneeL: { r: [0.15, 0, 0] },
    kneeR: { r: [0.15, 0, 0] },
    neck: { r: [-0.15, 0, 0] },
    bag: { p: [0, 1.1, 0.3] }
  },
  brushSnow: {
    spine: { r: [0.18, 0, -0.08] },
    shoulderL: { r: [-0.6, 0.3, 0.7] },
    elbowL: { r: [-1.2, 0, 0] },
    shoulderR: { r: [0.3, 0, -0.3] },
    head: { r: [0.25, 0.15, 0] }
  },
  sit: {
    hips: { p: [0, -0.16, 0] },
    spine: { r: [0.1, 0, 0] },
    hipL: { r: [-1.35, 0, -0.1] },
    kneeL: { r: [1.15, 0, 0] },
    hipR: { r: [-1.35, 0, 0.1] },
    kneeR: { r: [1.15, 0, 0] },
    shoulderL: { r: [0.35, 0, 0.3] },
    elbowL: { r: [-0.6, 0, 0] },
    shoulderR: { r: [0.35, 0, -0.3] },
    elbowR: { r: [-0.6, 0, 0] },
    bag: { r: [0.2, 0, 0], p: [0, -0.1, 0.08] }
  },
  wave: {
    shoulderR: { r: [-2.9, 0, 0.5] },
    elbowR: { r: [-0.5, 0, 0] },
    head: { r: [-0.06, 0.2, 0.08] }
  },
  faceCam: {
    neck: { r: [-0.06, 0, 0] },
    head: { r: [-0.08, 0, 0] }
  }
};

const POSE_NAMES = Object.keys(POSES) as PoseName[];

function displaceVertices(geo: THREE.BufferGeometry, amp: number, freq: number, seed: number): void {
  const rng = makeRng(seed);
  const jitter: number[] = [];
  for (let i = 0; i < 64; i++) jitter.push(rng() * 2 - 1);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n =
      Math.sin(v.x * freq + jitter[0] * 5) * Math.cos(v.y * freq * 1.3 + jitter[1] * 5) +
      Math.sin(v.z * freq * 0.8 + jitter[2] * 5) * 0.7;
    const k = 1 + n * amp;
    pos.setXYZ(i, v.x * k, v.y * k, v.z * k);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

export class Santa {
  root = new THREE.Group();
  nodes = new Map<NodeName, THREE.Group>();
  private rest = new Map<NodeName, { p: THREE.Vector3; q: THREE.Quaternion }>();

  // pose weights (damped toward targets set by the game)
  private weights: Record<PoseName, number> = Object.fromEntries(POSE_NAMES.map((n) => [n, 0])) as Record<PoseName, number>;
  private targets: Record<PoseName, number> = Object.fromEntries(POSE_NAMES.map((n) => [n, 0])) as Record<PoseName, number>;
  poseLambda = 8;

  // continuous deformation drivers, written by the game every frame
  squash = 0;        // 0 = natural, 1 = fully compressed for the flue
  bagSquash = 0;
  lean = 0;          // -1..1, pressing against flue walls (x)
  wobble = 0;        // dangling feet / bag sway amplitude while paused in flue
  descentSpeed = 0;  // -1..1 current scrub velocity (for rocking / flutter)
  walkSpeed = 0;     // >0 → walk cycle
  peekPhase = 0;     // procedural invitation loop strength
  bagBaseScale = 1;  // slimmer after the gifts are delivered

  private walkPhase = 0;
  private blinkT = 2.5;
  private blinkState = 0;
  private time = 0;

  head!: THREE.Group;
  faceTarget = new THREE.Object3D();  // camera aim point on the face
  noseHit!: THREE.Mesh;               // oversized invisible tap target
  noseMesh!: THREE.Mesh;
  private eyeL!: THREE.Mesh;
  private eyeR!: THREE.Mesh;
  private headCounter!: THREE.Group;  // undoes parent squash on the head
  private bagMesh!: THREE.Mesh;
  private torso!: THREE.Group;
  bagNode!: THREE.Group;
  private hatTip!: THREE.Group;
  private mittenR!: THREE.Mesh;

  constructor(seed = 1) {
    this.build(seed);
  }

  private reg(name: NodeName, g: THREE.Group): THREE.Group {
    this.nodes.set(name, g);
    return g;
  }

  private build(seed: number): void {
    const coatTex = coatTexture(seed + 100);
    coatTex.repeat.set(2, 1.4);
    const furTex = furTexture(seed + 200);
    const sackTex = sackTexture(seed + 300);
    const skinTex = skinTexture(seed + 400);

    const coatMat = new THREE.MeshStandardMaterial({ map: coatTex, roughness: 0.88, metalness: 0 });
    const pantsMat = new THREE.MeshStandardMaterial({ color: 0x7c1a1e, roughness: 0.9 });
    const furMat = new THREE.MeshStandardMaterial({ map: furTex, roughness: 0.97, metalness: 0 });
    const bootMat = new THREE.MeshStandardMaterial({ color: 0x241a16, roughness: 0.55, metalness: 0.05 });
    const beltMat = new THREE.MeshStandardMaterial({ color: 0x2b201a, roughness: 0.5, metalness: 0.1 });
    const buckleMat = new THREE.MeshStandardMaterial({ color: 0x8a7440, roughness: 0.35, metalness: 0.6 });
    const skinMat = new THREE.MeshStandardMaterial({ map: skinTex, roughness: 0.62 });
    const beardMat = new THREE.MeshStandardMaterial({ map: furTex, roughness: 0.95, color: 0xf4efe6 });
    const sackMat = new THREE.MeshStandardMaterial({ map: sackTex, roughness: 0.92 });
    const mittenMat = new THREE.MeshStandardMaterial({ color: 0x27351f, roughness: 0.85 });

    const cast = (m: THREE.Mesh) => {
      m.castShadow = true;
      m.receiveShadow = false;
      return m;
    };

    // ---------- hips & legs ----------
    const hips = this.reg('hips', new THREE.Group());
    hips.position.set(0, 0.88, 0);
    this.root.add(hips);

    const mkLeg = (side: 1 | -1, hipName: NodeName, kneeName: NodeName) => {
      const hip = this.reg(hipName, new THREE.Group());
      hip.position.set(0.15 * side, -0.02, 0);
      hips.add(hip);
      const thigh = cast(new THREE.Mesh(new THREE.CapsuleGeometry(0.125, 0.3, 6, 14), pantsMat));
      thigh.position.set(0, -0.19, 0);
      hip.add(thigh);
      const knee = this.reg(kneeName, new THREE.Group());
      knee.position.set(0, -0.4, 0);
      hip.add(knee);
      const shin = cast(new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.24, 6, 12), pantsMat));
      shin.position.set(0, -0.14, 0);
      knee.add(shin);
      // boot
      const bootTop = cast(new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.125, 0.2, 14), bootMat));
      bootTop.position.set(0, -0.33, 0);
      knee.add(bootTop);
      const bootFur = cast(new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.035, 8, 16), furMat));
      bootFur.rotation.x = Math.PI / 2;
      bootFur.position.set(0, -0.25, 0);
      knee.add(bootFur);
      const foot = cast(new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 10), bootMat));
      foot.scale.set(1, 0.62, 1.7);
      foot.position.set(0, -0.44, 0.06);
      knee.add(foot);
      return hip;
    };
    mkLeg(1, 'hipR', 'kneeR');
    mkLeg(-1, 'hipL', 'kneeL');

    // ---------- torso ----------
    const spine = this.reg('spine', new THREE.Group());
    spine.position.set(0, 0.06, 0);
    hips.add(spine);
    this.torso = spine;

    // coat: lathe profile — hem, big belly, chest, shoulders
    const prof: THREE.Vector2[] = [];
    const P = (r: number, y: number) => prof.push(new THREE.Vector2(r, y));
    P(0.30, 0.0); P(0.36, 0.05); P(0.415, 0.16); P(0.435, 0.26); P(0.42, 0.36);
    P(0.385, 0.46); P(0.345, 0.55); P(0.30, 0.62); P(0.22, 0.68); P(0.13, 0.71);
    const coatGeo = new THREE.LatheGeometry(prof, 26);
    displaceVertices(coatGeo, 0.016, 9, seed + 1);
    const coat = cast(new THREE.Mesh(coatGeo, coatMat));
    coat.position.y = -0.06;
    spine.add(coat);

    // fur hem ring (compressible tufts, slightly grimy — from furTexture)
    const hem = cast(new THREE.Mesh(new THREE.TorusGeometry(0.315, 0.05, 10, 24), furMat));
    hem.rotation.x = Math.PI / 2;
    hem.position.y = -0.05;
    displaceVertices(hem.geometry, 0.06, 14, seed + 2);
    spine.add(hem);

    // front fur strip: stacked small spheres down the coat front
    for (let i = 0; i < 6; i++) {
      const t = i / 5;
      const fy = lerp(0.6, 0.0, t) - 0.06;
      const fr = lerp(0.13, 0.435, Math.sin(t * Math.PI * 0.82) + 0.12);
      const fz = Math.min(0.44, fr) * 0.99;
      const b = cast(new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), furMat));
      b.scale.set(1.15, 1, 0.55);
      b.position.set(0, fy, fz);
      spine.add(b);
    }

    // belt + buckle
    const belt = cast(new THREE.Mesh(new THREE.CylinderGeometry(0.445, 0.45, 0.09, 26, 1, true), beltMat));
    belt.position.y = 0.2;
    spine.add(belt);
    const buckle = cast(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.03), buckleMat));
    buckle.position.set(0, 0.2, 0.435);
    spine.add(buckle);

    // ---------- arms ----------
    const mkArm = (side: 1 | -1, shName: NodeName, elName: NodeName) => {
      const sh = this.reg(shName, new THREE.Group());
      sh.position.set(0.3 * side, 0.56, 0);
      spine.add(sh);
      const upper = cast(new THREE.Mesh(new THREE.CapsuleGeometry(0.095, 0.2, 6, 12), coatMat));
      upper.position.set(0.03 * side, -0.13, 0);
      upper.rotation.z = -0.12 * side;
      sh.add(upper);
      const elbow = this.reg(elName, new THREE.Group());
      elbow.position.set(0.05 * side, -0.28, 0);
      sh.add(elbow);
      const fore = cast(new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.16, 6, 12), coatMat));
      fore.position.set(0, -0.1, 0);
      elbow.add(fore);
      const cuff = cast(new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.035, 8, 14), furMat));
      cuff.rotation.x = Math.PI / 2;
      cuff.position.set(0, -0.2, 0);
      elbow.add(cuff);
      const mitten = cast(new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 10), mittenMat));
      mitten.scale.set(0.9, 1.15, 0.95);
      mitten.position.set(0, -0.29, 0);
      elbow.add(mitten);
      if (side === -1) this.mittenR = mitten; // note: -1 is Santa's right (screen naming kept simple)
      return sh;
    };
    mkArm(1, 'shoulderL', 'elbowL');
    mkArm(-1, 'shoulderR', 'elbowR');

    // ---------- head ----------
    const neck = this.reg('neck', new THREE.Group());
    neck.position.set(0, 0.68, 0);
    spine.add(neck);
    this.headCounter = new THREE.Group();
    neck.add(this.headCounter);
    const head = this.reg('head', new THREE.Group());
    head.position.set(0, 0.1, 0.02);
    this.headCounter.add(head);
    this.head = head;

    const skull = cast(new THREE.Mesh(new THREE.SphereGeometry(0.148, 20, 16), skinMat));
    skull.scale.set(1, 1.05, 0.98);
    head.add(skull);

    // rosy cheeks
    for (const s of [1, -1]) {
      const cheek = new THREE.Mesh(
        new THREE.SphereGeometry(0.045, 10, 8),
        new THREE.MeshStandardMaterial({ color: 0xe09a84, roughness: 0.7, transparent: true, opacity: 0.38 })
      );
      cheek.position.set(0.075 * s, -0.02, 0.105);
      cheek.scale.set(1, 0.8, 0.5);
      head.add(cheek);
    }

    // nose — reads clearly, gets its own big invisible hit sphere
    this.noseMesh = cast(new THREE.Mesh(
      new THREE.SphereGeometry(0.042, 14, 12),
      new THREE.MeshStandardMaterial({ color: 0xdb9077, roughness: 0.55 })
    ));
    this.noseMesh.position.set(0, 0.0, 0.142);
    this.noseMesh.scale.set(1, 0.9, 1.05);
    head.add(this.noseMesh);
    this.noseHit = new THREE.Mesh(
      new THREE.SphereGeometry(0.4, 8, 6),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    this.noseHit.position.copy(this.noseMesh.position);
    head.add(this.noseHit);

    // eyes
    const eyeGeo = new THREE.SphereGeometry(0.018, 10, 8);
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x2a2016, roughness: 0.25 });
    this.eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    this.eyeL.position.set(0.056, 0.048, 0.147);
    head.add(this.eyeL);
    this.eyeR = new THREE.Mesh(eyeGeo, eyeMat);
    this.eyeR.position.set(-0.056, 0.048, 0.147);
    head.add(this.eyeR);

    // brows
    for (const s of [1, -1]) {
      const brow = new THREE.Mesh(new THREE.CapsuleGeometry(0.014, 0.045, 4, 8), beardMat);
      brow.rotation.z = Math.PI / 2 + 0.22 * s;
      brow.position.set(0.058 * s, 0.085, 0.126);
      head.add(brow);
    }

    // beard: displaced, flattened sphere hanging below the chin
    const beardGeo = new THREE.SphereGeometry(0.15, 18, 14);
    displaceVertices(beardGeo, 0.09, 11, seed + 3);
    const beard = cast(new THREE.Mesh(beardGeo, beardMat));
    beard.scale.set(1.02, 1.3, 0.72);
    beard.position.set(0, -0.115, 0.05);
    head.add(beard);
    // moustache
    for (const s of [1, -1]) {
      const mo = cast(new THREE.Mesh(new THREE.CapsuleGeometry(0.022, 0.05, 4, 8), beardMat));
      mo.rotation.z = Math.PI / 2 - 0.55 * s;
      mo.rotation.y = 0.25 * s;
      mo.position.set(0.04 * s, -0.058, 0.118);
      head.add(mo);
    }

    // hat: fur brim + bent cone + pompom
    const brim = cast(new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.045, 10, 22), furMat));
    displaceVertices(brim.geometry, 0.05, 13, seed + 4);
    brim.rotation.x = Math.PI / 2 + 0.05;
    brim.position.set(0, 0.122, 0.0);
    head.add(brim);
    // red crown filling the space above the brim so no scalp peeks out
    const crown = cast(new THREE.Mesh(new THREE.SphereGeometry(0.142, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), coatMat));
    crown.position.set(0, 0.055, 0);
    head.add(crown);
    const hatMat = coatMat;
    let prev = new THREE.Vector3(0, 0.1, 0);
    const hatRoot = new THREE.Group();
    head.add(hatRoot);
    let node: THREE.Group = hatRoot;
    const segs = 4;
    for (let i = 0; i < segs; i++) {
      const t0 = i / segs, t1 = (i + 1) / segs;
      const r0 = lerp(0.14, 0.02, t0);
      const r1 = lerp(0.14, 0.02, t1);
      const len = 0.09;
      const seg = cast(new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, len, 14), hatMat));
      const g = new THREE.Group();
      g.position.copy(i === 0 ? new THREE.Vector3(0, 0.14, 0) : new THREE.Vector3(0, len, 0));
      g.rotation.set(0.28 * (i > 0 ? 1 : 0.3), 0, 0.22 * (i > 0 ? 1 : 0));
      seg.position.set(0, len / 2, 0);
      g.add(seg);
      node.add(g);
      node = g;
    }
    this.hatTip = node;
    const pompom = cast(new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), furMat));
    displaceVertices(pompom.geometry, 0.08, 16, seed + 5);
    pompom.position.set(0, 0.11, 0);
    node.add(pompom);

    this.faceTarget.position.set(0, 0.0, 0.15);
    head.add(this.faceTarget);

    // ---------- sack ----------
    const bag = this.reg('bag', new THREE.Group());
    bag.position.set(-0.12, 0.42, -0.42);
    bag.rotation.set(-0.25, 0, 0.18);
    spine.add(bag);
    this.bagNode = bag;
    const bp: THREE.Vector2[] = [];
    const B = (r: number, y: number) => bp.push(new THREE.Vector2(r, y));
    B(0.06, 0); B(0.24, 0.03); B(0.36, 0.14); B(0.40, 0.3); B(0.375, 0.46);
    B(0.32, 0.6); B(0.24, 0.72); B(0.13, 0.8); B(0.10, 0.86); B(0.145, 0.92);
    const bagGeo = new THREE.LatheGeometry(bp, 22);
    displaceVertices(bagGeo, 0.05, 6, seed + 6);
    this.bagMesh = cast(new THREE.Mesh(bagGeo, sackMat));
    this.bagMesh.position.y = -0.42;
    bag.add(this.bagMesh);
    // rope tie
    const rope = cast(new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.02, 8, 16), new THREE.MeshStandardMaterial({ color: 0x9a7b4f, roughness: 0.8 })));
    rope.rotation.x = Math.PI / 2;
    rope.position.y = 0.44;
    bag.add(rope);

    // store rest transforms
    for (const [name, g] of this.nodes) {
      this.rest.set(name, { p: g.position.clone(), q: g.quaternion.clone() });
    }
  }

  // Declarative pose targeting: everything not mentioned decays to 0 (rest).
  setPose(target: Partial<Record<PoseName, number>>, immediate = false): void {
    for (const n of POSE_NAMES) this.targets[n] = target[n] ?? 0;
    if (immediate) for (const n of POSE_NAMES) this.weights[n] = this.targets[n];
  }

  update(dt: number, _elapsed: number): void {
    this.time += dt;
    const t = this.time;

    // damp pose weights
    const k = 1 - Math.exp(-this.poseLambda * dt);
    for (const n of POSE_NAMES) {
      this.weights[n] = lerp(this.weights[n], this.targets[n], k);
    }

    // accumulate pose offsets
    const euler = new Map<NodeName, THREE.Vector3>();
    const posOff = new Map<NodeName, THREE.Vector3>();
    for (const n of POSE_NAMES) {
      const w = this.weights[n];
      if (w < 0.004) continue;
      const pose = POSES[n];
      for (const key of Object.keys(pose) as NodeName[]) {
        const off = pose[key]!;
        if (off.r) {
          let e = euler.get(key);
          if (!e) euler.set(key, (e = new THREE.Vector3()));
          e.x += off.r[0] * w; e.y += off.r[1] * w; e.z += off.r[2] * w;
        }
        if (off.p) {
          let p = posOff.get(key);
          if (!p) posOff.set(key, (p = new THREE.Vector3()));
          p.x += off.p[0] * w; p.y += off.p[1] * w; p.z += off.p[2] * w;
        }
      }
    }

    // ---- procedural overlays ----
    const add = (name: NodeName, rx: number, ry: number, rz: number) => {
      let e = euler.get(name);
      if (!e) euler.set(name, (e = new THREE.Vector3()));
      e.x += rx; e.y += ry; e.z += rz;
    };
    const addP = (name: NodeName, x: number, y: number, z: number) => {
      let p = posOff.get(name);
      if (!p) posOff.set(name, (p = new THREE.Vector3()));
      p.x += x; p.y += y; p.z += z;
    };

    // breathing
    add('spine', Math.sin(t * 1.4) * 0.012, 0, 0);

    // walk cycle (waddle: heavy man carrying weight)
    if (this.walkSpeed > 0.01) {
      this.walkPhase += dt * this.walkSpeed * 7.5;
      const ph = this.walkPhase;
      const s = Math.min(1, this.walkSpeed);
      add('hipL', Math.sin(ph) * 0.55 * s, 0, 0);
      add('hipR', Math.sin(ph + Math.PI) * 0.55 * s, 0, 0);
      add('kneeL', (Math.max(0, Math.sin(ph + Math.PI * 0.75)) * 0.7) * s, 0, 0);
      add('kneeR', (Math.max(0, Math.sin(ph + Math.PI * 1.75)) * 0.7) * s, 0, 0);
      add('hips', 0, 0, Math.sin(ph) * 0.075 * s);
      add('spine', 0.04 * s, Math.sin(ph) * 0.05 * s, -Math.sin(ph) * 0.05 * s);
      add('shoulderL', Math.sin(ph + Math.PI) * 0.25 * s, 0, 0);
      addP('hips', 0, Math.abs(Math.sin(ph)) * 0.035 * s, 0);
      add('head', 0, 0, Math.sin(ph + 0.5) * 0.03 * s);
    }

    // peek invitation: slow lean cycle + shoulder dip + sack sway toward the mouth.
    if (this.peekPhase > 0.01) {
      const p = this.peekPhase;
      const cyc = Math.sin(t * 1.15);
      const cyc2 = Math.sin(t * 0.6 + 1.3);
      add('spine', cyc * 0.05 * p + 0.04 * p, 0, cyc2 * 0.055 * p + 0.05 * p);
      add('head', cyc * 0.09 * p, Math.sin(t * 0.45) * 0.14 * p, cyc2 * 0.05 * p);
      add('bag', Math.sin(t * 1.15 + 0.7) * 0.10 * p, 0, Math.sin(t * 0.8 + 0.3) * 0.085 * p);
      addP('bag', Math.sin(t * 0.8) * 0.02 * p, Math.abs(Math.sin(t * 1.15)) * 0.012 * p, Math.sin(t * 1.15 + 1) * 0.03 * p);
    }

    // in-flue wobble: dangling boots and pendulum sack when the finger pauses
    if (this.wobble > 0.005) {
      const w = this.wobble;
      add('hipL', Math.sin(t * 4.2) * 0.16 * w, 0, 0);
      add('hipR', Math.sin(t * 4.2 + 1.5) * 0.16 * w, 0, 0);
      add('kneeL', Math.sin(t * 5.1 + 0.4) * 0.12 * w, 0, 0);
      add('kneeR', Math.sin(t * 5.1 + 2.1) * 0.12 * w, 0, 0);
      add('bag', Math.sin(t * 3.4) * 0.1 * w, 0, Math.sin(t * 2.9 + 0.8) * 0.09 * w);
      add('spine', 0, 0, Math.sin(t * 3.1) * 0.035 * w);
    }

    // descent rocking: slow scrub = koro-koro rolling contact, fast = flutter
    const spd = Math.abs(this.descentSpeed);
    if (spd > 0.01) {
      const slowRock = clamp01(1 - spd * 2.2);
      add('spine', 0, 0, Math.sin(t * 9) * 0.05 * slowRock * Math.min(1, spd * 6));
      add('hips', 0, Math.sin(t * 7) * 0.05 * slowRock * Math.min(1, spd * 6), 0);
      const flutter = clamp01(spd * 1.4 - 0.3);
      add('bag', Math.sin(t * 16) * 0.03 * flutter, 0, 0);
      add('head', Math.sin(t * 13) * 0.016 * flutter, 0, 0);
    }

    // apply accumulated offsets over rest transforms
    const tmpQ = new THREE.Quaternion();
    const tmpE = new THREE.Euler();
    for (const [name, g] of this.nodes) {
      if (name === 'bag' && this.bagDetached) continue;
      const rest = this.rest.get(name)!;
      const e = euler.get(name);
      const p = posOff.get(name);
      if (e) {
        tmpE.set(e.x, e.y, e.z, 'XYZ');
        tmpQ.setFromEuler(tmpE);
        g.quaternion.copy(rest.q).multiply(tmpQ);
      } else {
        g.quaternion.copy(rest.q);
      }
      if (p) {
        g.position.copy(rest.p).add(p);
      } else {
        g.position.copy(rest.p);
      }
    }

    // ---- squash deformation (after posing) ----
    // 0.28: squashed belly (~0.63m) just kisses the 0.62m flue — the walls
    // must read as touching the coat, not floating beside it
    const s = this.squash;
    const lateral = 1 - 0.28 * s;
    const vertical = 1 + 0.24 * s;
    this.torso.scale.set(lateral, vertical, lateral);
    // hips narrow slightly too so pants/boots read as squeezed
    const hips = this.nodes.get('hips')!;
    hips.scale.set(1 - 0.22 * s, 1 + 0.06 * s, 1 - 0.22 * s);
    // head: undo most of the parent narrowing, keep a soft cheek squeeze
    const inv = 1 / lateral;
    const headSq = 1 - 0.12 * s;
    this.headCounter.scale.set(inv * headSq, (1 / vertical) * (1 + 0.06 * s), inv * headSq);
    // lean into the wall
    this.torso.rotation.z += this.lean * -0.18;
    hips.rotation.z += this.lean * 0.1;
    if (!this.bagDetached) {
      const bag = this.nodes.get('bag')!;
      bag.rotation.z += this.lean * -0.22;
      // sack compression: long thin sausage when squeezed
      const bs = this.bagSquash;
      bag.scale.set(
        (1 - 0.22 * bs) * this.bagBaseScale,
        (1 + 0.55 * bs) * this.bagBaseScale,
        (1 - 0.28 * bs) * this.bagBaseScale
      );
    }

    // hat tip flops with motion
    this.hatTip.rotation.z = Math.sin(t * 2.1) * 0.1 + this.descentSpeed * 0.4;

    // blinking
    this.blinkT -= dt;
    if (this.blinkT <= 0) {
      this.blinkState = 0.12;
      this.blinkT = 1.8 + Math.random() * 3.2;
    }
    if (this.blinkState > 0) {
      this.blinkState -= dt;
      this.eyeL.scale.y = 0.12;
      this.eyeR.scale.y = 0.12;
    } else {
      this.eyeL.scale.y = 1;
      this.eyeR.scale.y = 1;
    }
  }

  // wink for the finger-beside-nose beat
  wink(): void {
    this.blinkState = 0.5;
    this.blinkT = 2;
  }

  // ---- sack handoff: set down by the hearth, picked back up before ascent ----
  bagDetached = false;

  detachBag(newParent: THREE.Object3D): void {
    newParent.attach(this.bagNode);
    this.bagDetached = true;
  }

  reattachBag(scale = 1): void {
    this.torso.attach(this.bagNode);
    const rest = this.rest.get('bag')!;
    this.bagNode.position.copy(rest.p);
    this.bagNode.quaternion.copy(rest.q);
    this.bagNode.scale.setScalar(scale);
    this.bagDetached = false;
  }
}
