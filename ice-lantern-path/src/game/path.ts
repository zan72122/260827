import * as THREE from 'three';
import type { Engine } from '../core/engine';
import { Tweener, ease } from '../core/tween';
import { audio } from '../core/audio';
import { buildIceGeometry, IceLantern } from '../ice/lantern';
import { D } from '../ice/dims';
import { pathX } from '../world/shed';
import { finaleAxisX } from './shots';
import { berryMaterial, needleMaterial, tex, woodMaterial, fabricMaterial } from '../world/materials';
import { raycast } from '../core/input';

export interface Design {
  seed: number;
  items: Array<{ kind: string; r: number; theta: number; y: number }>;
}

const ROW = 15;
const WARM = new THREE.Color(0xffb066);

/** ground height of the packed path (matches the displacement in Shed) */
function pathY() {
  return -0.035;
}

function lanternSpot(i: number) {
  const z = -5.0 - i * 1.24;
  const side = i % 2 === 0 ? 1 : -1;
  // near lanterns hug the camera axis so a phone in portrait still frames them
  const off = Math.min(0.95, 0.3 + i * 0.08) * side;
  const base = i < 3 ? finaleAxisX(z) : pathX(z);
  return new THREE.Vector3(base + off, pathY(), z);
}

export class PathScene {
  group = new THREE.Group();
  private tween = new Tweener();
  private near: IceLantern[] = [];
  private nearLights: THREE.PointLight[] = [];
  private row: THREE.InstancedMesh;
  private glow: THREE.InstancedMesh;
  private lit: number[] = [];
  private target: number[] = [];
  private switchGroup = new THREE.Group();
  private switchLever!: THREE.Mesh;
  private sled = new THREE.Group();
  private armed = false;
  private progress = 0;
  private dragging = false;
  private startProgress = 0;
  private onFestive: ((v: number) => void) | null = null;
  private onComplete: (() => void) | null = null;
  private completed = false;
  private dummy = new THREE.Object3D();
  private colorTmp = new THREE.Color();

  constructor(engine: Engine, designs: Design[]) {
    const q = engine.quality.settings;

    // ---- near: the player's own lanterns, real ice, real light ---------
    // 2-3 real lanterns up front; everything beyond is emissive only
    const nearCount = Math.max(1, Math.min(q.finaleLights, 3));
    for (let i = 0; i < nearCount; i++) {
      const d = designs.length ? designs[i % designs.length] : { seed: 1037, items: [] };
      const l = new IceLantern(d.seed + i * 91, q.transmission, 72);
      const spot = lanternSpot(i);
      l.group.position.copy(spot);
      l.group.position.y = pathY() - 0.022; // settled into the snow, not floating
      l.group.rotation.y = i * 1.3;
      this.group.add(l.group);
      this.addInclusions(l, d);
      this.addPuck(l);
      const light = new THREE.PointLight(WARM, 0, 3.2, 2);
      light.position.copy(l.group.position).add(new THREE.Vector3(0, D.spacerH + 0.06, 0));
      this.group.add(light);
      this.near.push(l);
      this.nearLights.push(light);
      this.lit.push(0);
      this.target.push(0);
    }

    // ---- mid and far: one instanced mesh, emissive only ----------------
    const geo = buildIceGeometry(4242, 34);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xc9dee4,
      roughness: 0.36,
      metalness: 0,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 1,
    });
    mat.onBeforeCompile = (sh) => {
      // vColor carries "how lit is this lantern"; it must not tint the base
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <color_fragment>', '')
        .replace(
          '#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\n#ifdef USE_INSTANCING_COLOR\n totalEmissiveRadiance *= vColor;\n#endif'
        );
    };
    mat.customProgramCacheKey = () => 'row-lantern';
    this.row = new THREE.InstancedMesh(geo, mat, ROW);
    this.row.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(ROW * 3), 3);
    this.row.castShadow = false;
    this.group.add(this.row);

    const glowMat = new THREE.MeshBasicMaterial({
      map: tex.glow,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      opacity: 0.85,
    });
    const glowGeo = new THREE.PlaneGeometry(1, 1);
    glowGeo.rotateX(-Math.PI / 2);
    this.glow = new THREE.InstancedMesh(glowGeo, glowMat, ROW + nearCount);
    this.glow.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array((ROW + nearCount) * 3), 3);
    this.glow.renderOrder = 6;
    this.group.add(this.glow);

    for (let i = 0; i < ROW; i++) {
      const spot = lanternSpot(i + nearCount);
      this.dummy.position.copy(spot);
      this.dummy.position.y -= 0.02;
      this.dummy.rotation.set(0, i * 0.9, 0);
      this.dummy.scale.setScalar(0.94 + ((i * 37) % 13) * 0.012);
      this.dummy.updateMatrix();
      this.row.setMatrixAt(i, this.dummy.matrix);
      this.lit.push(0);
      this.target.push(0);
    }
    this.row.instanceMatrix.needsUpdate = true;
    this.updateGlow();

    // ---- big waterproof switch in the foreground ----------------------
    this.buildSwitch();
    this.buildSled();
  }

  private addInclusions(l: IceLantern, d: Design) {
    for (const it of d.items) {
      let m: THREE.Mesh | null = null;
      if (it.kind === 'berry') {
        m = new THREE.Mesh(new THREE.SphereGeometry(0.0115, 12, 8), berryMaterial());
      } else if (it.kind === 'sprig') {
        m = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0022, 0.06, 5), needleMaterial());
        m.rotation.z = Math.PI / 2;
        m.rotation.y = -it.theta + Math.PI / 2;
      } else {
        m = new THREE.Mesh(
          new THREE.PlaneGeometry(0.016, 0.024),
          new THREE.MeshStandardMaterial({ color: 0xf0e3e6, roughness: 0.7, side: THREE.DoubleSide })
        );
        m.rotation.x = -Math.PI / 2 + 0.1;
      }
      const r = THREE.MathUtils.clamp(it.r, 0.112, 0.132);
      m.position.set(Math.cos(it.theta) * r, THREE.MathUtils.clamp(it.y, 0.035, D.waterTop - 0.03), Math.sin(it.theta) * r);
      l.inclusions.add(m);
    }
  }

  private addPuck(l: IceLantern) {
    const puck = new THREE.Mesh(
      new THREE.CylinderGeometry(0.041, 0.043, 0.03, 18),
      new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.6 })
    );
    puck.position.y = D.spacerH + 0.015;
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(0.036, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.45),
      new THREE.MeshStandardMaterial({
        color: 0xf2efe8,
        roughness: 0.85,
        emissive: new THREE.Color(WARM),
        emissiveIntensity: 0,
      })
    );
    dome.position.y = D.spacerH + 0.03;
    dome.scale.y = 0.7;
    l.group.add(puck, dome);
    l.group.userData.dome = dome;
  }

  private buildSwitch() {
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.1, 0.15),
      new THREE.MeshStandardMaterial({ color: 0x7d8890, roughness: 0.5, bumpMap: tex.fine, bumpScale: 0.3 })
    );
    base.position.y = 0.06;
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.026, 0.06),
      new THREE.MeshStandardMaterial({ color: 0x1b2229, roughness: 0.7 })
    );
    rail.position.set(0, 0.12, 0);
    this.switchLever = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.034, 0.05, 6, 12),
      new THREE.MeshStandardMaterial({
        color: 0xe09a48,
        roughness: 0.5,
        metalness: 0.05,
        emissive: new THREE.Color(0x4a2a0c),
        emissiveIntensity: 1,
      })
    );
    this.switchLever.rotation.z = Math.PI / 2;
    this.switchLever.position.set(-0.13, 0.16, 0);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.34, 10), woodMaterial(0x55483c, 0.9));
    post.position.y = -0.14;
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.01, 0.06),
      new THREE.MeshStandardMaterial({ color: 0xd6e0e6, roughness: 0.45, metalness: 0.1 })
    );
    plate.position.set(0, 0.115, -0.055);
    plate.rotation.x = -0.45;
    this.switchGroup.add(base, rail, this.switchLever, post, plate);
    const sz = -5.35;
    this.switchGroup.position.set(finaleAxisX(sz) - 0.36, 0.0, sz);
    this.switchGroup.rotation.y = 0.16;
    this.switchGroup.rotation.x = -0.22;
    this.switchGroup.visible = false;
    this.group.add(this.switchGroup);
  }

  private buildSled() {
    const wood = woodMaterial(0x6a4f39, 0.85);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.32), wood);
    deck.position.y = 0.1;
    const runnerL = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.03, 0.035), wood);
    runnerL.position.set(0, 0.04, -0.13);
    const runnerR = runnerL.clone();
    runnerR.position.z = 0.13;
    this.sled.add(deck, runnerL, runnerR);
    for (let i = 0; i < 3; i++) {
      const geo = buildIceGeometry(9000 + i * 13, 20);
      const m = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({ color: 0xcfe2e8, roughness: 0.35, metalness: 0 })
      );
      m.position.set(-0.14 + i * 0.14, 0.12, (i % 2) * 0.06 - 0.03);
      m.scale.setScalar(0.8);
      this.sled.add(m);
    }
    // a worker, read as a silhouette against the snow
    const coat = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.34, 6, 12), fabricMaterial(0x3a4a5c));
    coat.position.set(0.55, 0.42, 0);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.085, 14, 10), fabricMaterial(0x2a3542));
    head.position.set(0.55, 0.72, 0);
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.42, 5), fabricMaterial(0x6b5a48));
    rope.position.set(0.34, 0.22, 0);
    rope.rotation.z = 0.9;
    this.sled.add(coat, head, rope);
    this.sled.visible = false;
    this.group.add(this.sled);
  }

  // ------------------------------------------------------------ cutscene

  playSledCutscene(done: () => void) {
    this.sled.visible = true;
    this.row.count = 0;
    const from = new THREE.Vector3(pathX(-1.6) - 0.6, pathY(), -1.6);
    const to = new THREE.Vector3(pathX(-12) - 0.2, pathY(), -12);
    audio.slide();
    this.tween.add(5.2, (k) => {
      const z = THREE.MathUtils.lerp(from.z, to.z, k);
      this.sled.position.set(pathX(z) - 0.55, pathY(), z);
      this.sled.rotation.y = -0.25;
      // lanterns appear behind the sled as it passes
      let n = 0;
      for (let i = 0; i < ROW; i++) if (lanternSpot(i + this.near.length).z > z + 0.4) n = i + 1;
      this.row.count = n;
    }, {
      ease: ease.inOut,
      done: () => {
        this.row.count = ROW;
        this.tween.add(0.8, (k) => {
          this.sled.position.z = -12 - k * 6;
        }, { done: () => (this.sled.visible = false) });
        done();
      },
    });
  }

  arm() {
    this.armed = true;
    this.switchGroup.visible = true;
    this.switchGroup.scale.setScalar(0.01);
    this.tween.add(0.6, (k) => this.switchGroup.scale.setScalar(k), { ease: ease.back });
  }

  setFestiveCallback(fn: (v: number) => void) {
    this.onFestive = fn;
  }

  setCompleteCallback(fn: () => void) {
    this.onComplete = fn;
  }

  devProgress(v: number) {
    this.armed = true;
    this.switchGroup.visible = true;
    this.switchGroup.scale.setScalar(1);
    this.progress = THREE.MathUtils.clamp(v, 0, 1);
    this.applyProgress();
    for (let i = 0; i < this.lit.length; i++) this.lit[i] = this.target[i] * 0.999;
    this.update(0.001, 0);
  }

  switchWorld(out: THREE.Vector3) {
    this.switchGroup.getWorldPosition(out);
    out.y += 0.12;
    return out;
  }

  // --------------------------------------------------------------- input

  onDown(nx: number, ny: number, camera: THREE.Camera) {
    if (!this.armed) return;
    const hits = raycast(camera, nx, ny, [this.switchGroup]);
    this.dragging = true;
    this.startProgress = this.progress;
    void hits;
  }

  onMove(dx: number, _dy: number) {
    if (!this.armed || !this.dragging) return;
    const span = Math.max(180, window.innerWidth * 0.5);
    this.progress = THREE.MathUtils.clamp(this.startProgress + dx / span, 0, 1);
    this.applyProgress();
  }

  onUp() {
    this.dragging = false;
    if (this.progress > 0.82 && !this.completed) {
      this.tween.add(0.9, (k) => {
        this.progress = THREE.MathUtils.lerp(this.progress, 1, k);
        this.applyProgress();
      });
    }
  }

  private applyProgress() {
    this.switchLever.position.x = -0.13 + this.progress * 0.26;
    const total = this.lit.length;
    const n = this.progress * total;
    for (let i = 0; i < total; i++) {
      const want = THREE.MathUtils.clamp(n - i, 0, 1);
      if (want > 0.02 && this.target[i] < 0.02) audio.chime(i);
      this.target[i] = want;
    }
    if (this.progress >= 0.995 && !this.completed) {
      this.completed = true;
      this.tween.add(2.2, (k) => this.onFestive?.(k), { ease: ease.out, done: () => this.onComplete?.() });
    }
  }

  private updateGlow() {
    const near = this.near.length;
    for (let i = 0; i < this.lit.length; i++) {
      const spot = lanternSpot(i);
      const v = this.lit[i];
      const s = 0.75 + v * 0.5 + (i < near ? 0.25 : 0);
      this.dummy.position.set(spot.x, pathY() + 0.012, spot.z);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.set(s, 1, s);
      this.dummy.updateMatrix();
      this.glow.setMatrixAt(i, this.dummy.matrix);
      this.colorTmp.copy(WARM).multiplyScalar(v * 0.55);
      this.glow.setColorAt(i, this.colorTmp);
    }
    this.glow.instanceMatrix.needsUpdate = true;
    if (this.glow.instanceColor) this.glow.instanceColor.needsUpdate = true;
  }

  update(dt: number, _elapsed: number) {
    this.tween.update(dt);
    let changed = false;
    const near = this.near.length;
    for (let i = 0; i < this.lit.length; i++) {
      const t = this.target[i];
      if (Math.abs(this.lit[i] - t) > 0.001) {
        this.lit[i] = THREE.MathUtils.damp(this.lit[i], t, 4.5, dt);
        changed = true;
      }
    }
    if (!changed) return;

    for (let i = 0; i < near; i++) {
      const v = this.lit[i];
      this.near[i].setLit(v);
      this.nearLights[i].intensity = v * 1.1;
      const dome = this.near[i].group.userData.dome as THREE.Mesh | undefined;
      if (dome) (dome.material as THREE.MeshStandardMaterial).emissiveIntensity = v * 2.4;
    }
    for (let i = 0; i < ROW; i++) {
      const v = this.lit[i + near];
      // emissive only for everything past the foreground
      this.colorTmp.copy(WARM).multiplyScalar(v * (1.6 + i * 0.09));
      this.row.setColorAt(i, this.colorTmp);
    }
    if (this.row.instanceColor) this.row.instanceColor.needsUpdate = true;
    this.updateGlow();
  }
}
