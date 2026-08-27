import * as THREE from 'three';

// ---------------------------------------------------------------------------
// 革の牽引線。重いロープ物理ではなく、少数の制御点の簡易 Verlet と
// 「たるみ⇔張り」のオーサリング形状への補間で表現する。
// 端A は常にどこか（ハーネス/そりフック）へピン留め。
// 端B は free（雪上に落ちる）/ drag（指に追従・持ち上がる）/ pinned。
// ---------------------------------------------------------------------------

const N_POINTS = 9;
const TUBULAR = 26;
const RADIAL = 8;

export type EndMode = 'free' | 'drag' | 'pinned';

export class LeatherLine {
  readonly group: THREE.Group;
  private mesh: THREE.Mesh;
  private geo: THREE.BufferGeometry;
  private posAttr: THREE.BufferAttribute;
  private pts: THREE.Vector3[] = [];
  private prev: THREE.Vector3[] = [];
  private radius: number;
  restLength: number;
  private endA: THREE.Object3D | null = null;
  endBMode: EndMode = 'free';
  private endBTarget: THREE.Object3D | null = null;
  readonly dragPos = new THREE.Vector3();
  /** 端Bの金具 */
  readonly hardware: THREE.Group;
  tension = 0;            // 0..1+（1超で引張）
  pullStraight = 0;       // 0..1 張りブレンド（牽引中に上げる）
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();
  private curve: THREE.CatmullRomCurve3;
  visibleLine = true;
  onTaut?: () => void;
  private wasTaut = false;

  constructor(
    length: number,
    radius: number,
    leatherMat: THREE.MeshStandardMaterial,
    hardwareMat: THREE.MeshStandardMaterial,
    hardwareKind: 'ring' | 'clip' | null
  ) {
    this.restLength = length;
    this.radius = radius;
    this.group = new THREE.Group();

    for (let i = 0; i < N_POINTS; i++) {
      this.pts.push(new THREE.Vector3(0, 0.02, i * (length / (N_POINTS - 1))));
      this.prev.push(this.pts[i].clone());
    }
    this.curve = new THREE.CatmullRomCurve3(this.pts, false, 'catmullrom', 0.5);

    // チューブジオメトリを一度だけ確保し、以後は頂点を書き換える
    const count = (TUBULAR + 1) * (RADIAL + 1);
    const pos = new Float32Array(count * 3);
    const uv = new Float32Array(count * 2);
    const idx: number[] = [];
    for (let i = 0; i <= TUBULAR; i++) {
      for (let j = 0; j <= RADIAL; j++) {
        const p = (i * (RADIAL + 1) + j) * 2;
        uv[p] = i / TUBULAR * (length / 1.2); // 長手方向に革テクスチャを流す
        uv[p + 1] = j / RADIAL;
      }
    }
    for (let i = 0; i < TUBULAR; i++) {
      for (let j = 0; j < RADIAL; j++) {
        const a = i * (RADIAL + 1) + j;
        const b = a + RADIAL + 1;
        idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
    this.geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(pos, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.posAttr);
    this.geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geo, leatherMat);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);

    // 端Bの金具
    this.hardware = new THREE.Group();
    if (hardwareKind === 'ring') {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.011, 8, 18), hardwareMat);
      this.hardware.add(ring);
    } else if (hardwareKind === 'clip') {
      // 板状の受け金具（スナップフック受け）
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.016, 0.09), hardwareMat);
      const hook = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.009, 8, 14, Math.PI * 1.5), hardwareMat);
      hook.position.z = 0.055;
      hook.rotation.y = Math.PI / 2;
      this.hardware.add(plate, hook);
    }
    this.hardware.traverse((o) => { o.castShadow = true; });
    this.group.add(this.hardware);
  }

  setEndA(obj: THREE.Object3D): void {
    this.endA = obj;
  }

  /** 端Bを自由落下状態に */
  releaseB(): void {
    this.endBMode = 'free';
    this.endBTarget = null;
  }

  beginDrag(world: THREE.Vector3): void {
    this.endBMode = 'drag';
    this.dragPos.copy(world);
  }

  moveDrag(world: THREE.Vector3): void {
    this.dragPos.copy(world);
  }

  pinB(target: THREE.Object3D): void {
    this.endBMode = 'pinned';
    this.endBTarget = target;
  }

  get endB(): THREE.Vector3 {
    return this.pts[N_POINTS - 1];
  }

  /** 直近の実効長に対する余long */
  get slack(): number {
    if (!this.endA) return 0;
    const d = this.tmpA.distanceTo(this.pts[N_POINTS - 1]);
    return Math.max(0, this.restLength - d);
  }

  /**
   * @param groundY 雪面高さ
   * @param liftHeight ドラッグ中の持ち上げ高さ
   */
  update(dt: number, groundY: number, liftHeight = 0.4): void {
    if (!this.endA) return;
    this.endA.getWorldPosition(this.tmpA);
    const A = this.tmpA;
    const B = this.tmpB;
    const end = this.pts[N_POINTS - 1];

    // 端点の決定
    if (this.endBMode === 'pinned' && this.endBTarget) {
      this.endBTarget.getWorldPosition(B);
    } else if (this.endBMode === 'drag') {
      B.copy(this.dragPos);
      B.y = Math.max(B.y, groundY + liftHeight);
    } else {
      B.copy(end); // free: verlet に任せる
    }

    this.pts[0].copy(A);
    if (this.endBMode !== 'free') {
      // 引っ張られすぎたら端側へ拘束（革は伸びない）
      const d = A.distanceTo(B);
      this.tension = Math.max(0, (d - this.restLength) / this.restLength);
      end.copy(B);
      if (this.tension > 0.02 && this.endBMode === 'drag') {
        // ドラッグ中: 届く範囲の端で止める
        const dir = B.clone().sub(A).normalize();
        end.copy(A).addScaledVector(dir, this.restLength);
        end.y = Math.max(end.y, groundY + 0.05);
      }
    } else {
      this.tension = 0;
    }

    // --- 内部点の簡易 Verlet ------------------------------------------------
    const segLen = this.restLength / (N_POINTS - 1);
    const damp = 0.94;
    const grav = -9.8 * dt * dt * 0.5;
    for (let i = 1; i < N_POINTS - 1; i++) {
      const p = this.pts[i];
      const pv = this.prev[i];
      const vx = (p.x - pv.x) * damp;
      const vy = (p.y - pv.y) * damp;
      const vz = (p.z - pv.z) * damp;
      pv.copy(p);
      p.x += vx; p.y += vy + grav; p.z += vz;
      // 雪面: 沈み込み+摩擦
      if (p.y < groundY + this.radius) {
        p.y = groundY + this.radius;
        p.x = pv.x + (p.x - pv.x) * 0.4;
        p.z = pv.z + (p.z - pv.z) * 0.4;
      }
    }
    // free 端も物理
    if (this.endBMode === 'free') {
      const p = end, pv = this.prev[N_POINTS - 1];
      const vx = (p.x - pv.x) * damp, vy = (p.y - pv.y) * damp, vz = (p.z - pv.z) * damp;
      pv.copy(p);
      p.x += vx; p.y += vy + grav; p.z += vz;
      if (p.y < groundY + 0.05) {
        p.y = groundY + 0.05;
        p.x = pv.x + (p.x - pv.x) * 0.3;
        p.z = pv.z + (p.z - pv.z) * 0.3;
      }
    }
    // 距離拘束
    const iters = 3;
    for (let it = 0; it < iters; it++) {
      for (let i = 0; i < N_POINTS - 1; i++) {
        const p0 = this.pts[i], p1 = this.pts[i + 1];
        const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
        const d = Math.hypot(dx, dy, dz) || 1e-5;
        const diff = (d - segLen) / d;
        const w0 = i === 0 ? 0 : 0.5;
        const w1 = (i + 1 === N_POINTS - 1 && this.endBMode !== 'free') ? 0 : 0.5;
        const tot = w0 + w1 || 1;
        p0.x += dx * diff * (w0 / tot); p0.y += dy * diff * (w0 / tot); p0.z += dz * diff * (w0 / tot);
        p1.x -= dx * diff * (w1 / tot); p1.y -= dy * diff * (w1 / tot); p1.z -= dz * diff * (w1 / tot);
      }
    }

    // --- 張りのオーサリング形状へ補間 --------------------------------------
    if (this.pullStraight > 0 && this.endBMode === 'pinned') {
      const sagBase = Math.min(0.35, this.slack * 0.55);
      const sag = sagBase * (1 - this.pullStraight);
      for (let i = 1; i < N_POINTS - 1; i++) {
        const t = i / (N_POINTS - 1);
        const lx = A.x + (end.x - A.x) * t;
        const ly = A.y + (end.y - A.y) * t - sag * 4 * t * (1 - t);
        const lz = A.z + (end.z - A.z) * t;
        // 張ったときの微振動
        const vib = this.tension > 0.01 ? Math.sin(performance.now() * 0.04 + i * 2.2) * 0.006 * Math.min(1, this.tension * 10) : 0;
        const p = this.pts[i];
        const bl = this.pullStraight;
        p.x += (lx - p.x) * bl;
        p.y += (ly + vib - p.y) * bl;
        p.z += (lz - p.z) * bl;
        this.prev[i].copy(p);
      }
    }

    const tautNow = this.tension > 0.005 && this.endBMode === 'pinned';
    if (tautNow && !this.wasTaut && this.onTaut) this.onTaut();
    this.wasTaut = tautNow;

    this.rebuildTube();

    // 金具を端Bへ
    const dir = this.pts[N_POINTS - 1].clone().sub(this.pts[N_POINTS - 2]);
    this.hardware.position.copy(this.pts[N_POINTS - 1]);
    if (dir.lengthSq() > 1e-6) {
      this.hardware.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.normalize());
    }
  }

  private static _up = new THREE.Vector3(0, 1, 0);
  private static _t = new THREE.Vector3();
  private static _n = new THREE.Vector3();
  private static _b = new THREE.Vector3();
  private static _p = new THREE.Vector3();

  private rebuildTube(): void {
    const pos = this.posAttr.array as Float32Array;
    const T = LeatherLine._t, Nv = LeatherLine._n, Bv = LeatherLine._b, P = LeatherLine._p;
    // 張力で断面がわずかに扁平になる（革が伸びて締まる）
    const squash = 1 - Math.min(0.25, this.tension * 2);
    const r = this.radius;
    for (let i = 0; i <= TUBULAR; i++) {
      const t = i / TUBULAR;
      this.curve.getPoint(t, P);
      this.curve.getTangent(t, T);
      // 平行移動フレームの簡略: up との直交基底（線は主に水平なので安定）
      Nv.crossVectors(LeatherLine._up, T);
      if (Nv.lengthSq() < 1e-5) Nv.set(1, 0, 0);
      Nv.normalize();
      Bv.crossVectors(T, Nv).normalize();
      for (let j = 0; j <= RADIAL; j++) {
        const a = (j / RADIAL) * Math.PI * 2;
        const cx = Math.cos(a) * r;
        const cy = Math.sin(a) * r * squash;
        const k = (i * (RADIAL + 1) + j) * 3;
        pos[k] = P.x + Nv.x * cx + Bv.x * cy;
        pos[k + 1] = P.y + Nv.y * cx + Bv.y * cy;
        pos[k + 2] = P.z + Nv.z * cx + Bv.z * cy;
      }
    }
    this.posAttr.needsUpdate = true;
    this.geo.computeVertexNormals();
  }

  /** 端Bを指定位置へ瞬間配置（初期化・リセット用） */
  layout(a: THREE.Vector3, b: THREE.Vector3, groundY: number): void {
    for (let i = 0; i < N_POINTS; i++) {
      const t = i / (N_POINTS - 1);
      const p = this.pts[i];
      p.lerpVectors(a, b, t);
      // 余った分は横に波打たせて雪上へ
      const slackHere = Math.max(0, this.restLength - a.distanceTo(b));
      p.x += Math.sin(t * Math.PI * 1.3) * slackHere * 0.18;
      p.y = Math.max(groundY + 0.03, p.y - t * (a.y - groundY));
      this.prev[i].copy(p);
    }
    this.rebuildTube();
  }

  setVisible(v: boolean): void {
    this.group.visible = v;
  }
}
