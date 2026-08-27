import * as THREE from 'three';
import {
  snowGroundTextures, skyTexture, treelineTexture, softParticleTexture, woodTextures, mulberry
} from './textures';

// ---------------------------------------------------------------------------
// 雪原・厩舎・柵・空・光。背景は統合し、描画予算は主役（トナカイ・装具）へ。
// 雪は「表面 / 圧雪(跡) / 掻き上げ / 付着」を別表現で持つ。
// ---------------------------------------------------------------------------

export class Environment {
  readonly group = new THREE.Group();
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly lantern: THREE.PointLight;
  /** 装具置き場のアンカー */
  readonly fenceHangs: THREE.Vector3[] = [];
  readonly rackAnchor = new THREE.Vector3(2.35, 0.86, -1.2);

  constructor() {
    // --- 光 -----------------------------------------------------------------
    // 低い冬の太陽（暖色）+ 青灰の空光。日陰は青く、雪は白飛びさせない。
    this.sun = new THREE.DirectionalLight('#ffe7c4', 2.6);
    this.sun.position.set(-14, 10, 9);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 2;
    this.sun.shadow.camera.far = 45;
    const sc = this.sun.shadow.camera;
    sc.left = -12; sc.right = 12; sc.top = 12; sc.bottom = -12;
    this.sun.shadow.bias = -0.0015;
    this.sun.shadow.normalBias = 0.02;
    this.group.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight('#c3d2e6', '#9aa8bc', 1.15);
    this.group.add(this.hemi);
    // 厩舎のランタン（局所的な暖色）
    this.lantern = new THREE.PointLight('#ffAA55', 14, 8, 2);
    this.lantern.position.set(5.8, 1.9, -8.4);
    this.group.add(this.lantern);

    // --- 雪面 ---------------------------------------------------------------
    const snow = snowGroundTextures();
    const groundGeo = new THREE.PlaneGeometry(240, 240, 64, 64);
    groundGeo.rotateX(-Math.PI / 2);
    // 遊び場から離れたところに緩い起伏
    const pos = groundGeo.attributes.position;
    const rnd = mulberry(3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const d = Math.hypot(x, z);
      const amp = THREE.MathUtils.smoothstep(d, 9, 40) * 0.9;
      pos.setY(i, (Math.sin(x * 0.15) + Math.cos(z * 0.11 + x * 0.07)) * 0.35 * amp + rnd() * 0.04 * amp);
    }
    groundGeo.computeVertexNormals();
    const groundMat = new THREE.MeshStandardMaterial({
      map: snow.map, bumpMap: snow.bump, bumpScale: 0.35, roughness: 0.93, metalness: 0
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.receiveShadow = true;
    this.group.add(ground);

    // --- 空 -----------------------------------------------------------------
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(160, 24, 12),
      new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false })
    );
    this.group.add(sky);
    // 太陽のにじみ
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: softParticleTexture(), color: '#ffdfae', transparent: true, opacity: 0.5, fog: false,
      depthWrite: false
    }));
    glow.position.set(-90, 34, 62);
    glow.scale.setScalar(60);
    this.group.add(glow);
    // 遠景の樹林帯（2枚の帯ビルボードで囲む）
    const treeTex = treelineTexture();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(95, 11),
        new THREE.MeshBasicMaterial({ map: treeTex, transparent: true, depthWrite: false, fog: true })
      );
      plane.position.set(Math.sin(a) * 110, 4.5, Math.cos(a) * 110);
      plane.lookAt(0, 4.5, 0);
      this.group.add(plane);
    }

    // --- 厩舎 ---------------------------------------------------------------
    const stable = this.buildStable();
    stable.position.set(6.8, 0, -10.2);
    stable.rotation.y = -0.55;
    this.group.add(stable);

    // --- 柵（装具を掛ける） --------------------------------------------------
    const fence = this.buildFence();
    fence.position.set(-0.9, 0, -5.3);
    fence.rotation.y = 0.06;
    this.group.add(fence);
  }

  private buildStable(): THREE.Group {
    const g = new THREE.Group();
    const wt = woodTextures('#6d5238', '#3f2d1c', 291);
    const wall = new THREE.MeshStandardMaterial({ map: wt.map, bumpMap: wt.bump, bumpScale: 0.5, roughness: 0.9 });
    const wt2 = woodTextures('#54402c', '#332413', 293);
    const roofM = new THREE.MeshStandardMaterial({ map: wt2.map, roughness: 0.95 });
    const snowM = new THREE.MeshStandardMaterial({ color: '#e7edf6', roughness: 0.95 });

    const body = new THREE.Mesh(new THREE.BoxGeometry(5.2, 2.6, 3.6), wall);
    body.position.y = 1.3;
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);
    // 切妻屋根
    const roofL = new THREE.Mesh(new THREE.BoxGeometry(5.7, 0.12, 2.35), roofM);
    roofL.position.set(0, 3.1, -0.95);
    roofL.rotation.x = 0.6;
    roofL.castShadow = true;
    const roofR = roofL.clone();
    roofR.position.z = 0.95;
    roofR.rotation.x = -0.6;
    g.add(roofL, roofR);
    // 屋根の雪
    const snowL = new THREE.Mesh(new THREE.BoxGeometry(5.75, 0.1, 2.2), snowM);
    snowL.position.set(0, 3.23, -1.0);
    snowL.rotation.x = 0.6;
    const snowR = snowL.clone();
    snowR.position.z = 1.0;
    snowR.rotation.x = -0.6;
    g.add(snowL, snowR);
    // 妻壁
    const gableShape = new THREE.Shape();
    gableShape.moveTo(-2.6, 0);
    gableShape.lineTo(2.6, 0);
    gableShape.lineTo(0, 1.5);
    gableShape.closePath();
    const gable = new THREE.Mesh(new THREE.ExtrudeGeometry(gableShape, { depth: 0.1, bevelEnabled: false }), wall);
    gable.position.set(0, 2.6, -1.75);
    g.add(gable);
    const gable2 = gable.clone();
    gable2.position.z = 1.65;
    g.add(gable2);
    // 戸口（開いた引き戸と暗がり）
    const dark = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.9),
      new THREE.MeshBasicMaterial({ color: '#241a10' }));
    dark.position.set(-1.2, 0.95, -1.81);
    g.add(dark);
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.0, 0.09), roofM);
    door.position.set(-2.35, 1.0, -1.84);
    g.add(door);
    // ランタン
    const lampPost = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 6), roofM);
    lampPost.position.set(-0.3, 2.2, -1.85);
    lampPost.rotation.x = 0.9;
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8),
      new THREE.MeshStandardMaterial({
        color: '#ffca7a', emissive: '#ff9c3f', emissiveIntensity: 2.2, roughness: 0.4
      }));
    lamp.position.set(-0.3, 2.05, -2.05);
    g.add(lampPost, lamp);
    return g;
  }

  private buildFence(): THREE.Group {
    const g = new THREE.Group();
    const wt = woodTextures('#7b5f42', '#4a3421', 391);
    const wood = new THREE.MeshStandardMaterial({ map: wt.map, bumpMap: wt.bump, bumpScale: 0.5, roughness: 0.9 });
    const snowM = new THREE.MeshStandardMaterial({ color: '#e9eef7', roughness: 0.95 });
    for (let i = 0; i < 4; i++) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 1.15, 8), wood);
      post.position.set(i * 1.15 - 0.6, 0.57, 0);
      post.castShadow = true;
      g.add(post);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), snowM);
      cap.scale.y = 0.5;
      cap.position.set(i * 1.15 - 0.6, 1.16, 0);
      g.add(cap);
    }
    for (const y of [0.52, 0.95]) {
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 3.6, 8), wood);
      rail.rotation.z = Math.PI / 2;
      rail.position.set(1.1, y, 0);
      rail.castShadow = true;
      g.add(rail);
      const railSnow = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.035, 0.05), snowM);
      railSnow.position.set(1.1, y + 0.055, 0);
      g.add(railSnow);
    }
    // 装具を掛ける位置（ワールドへ変換して記録）
    g.updateMatrixWorld(true);
    return g;
  }
}

// ---------------------------------------------------------------------------
// 粒子: 降雪（常時・薄く）と、接地・ブラシで局所的に立つ雪煙、呼気。
// すべてプールを使い回し、リプレイで増殖しない。
// ---------------------------------------------------------------------------
export class Particles {
  readonly group = new THREE.Group();
  private fall: THREE.Points;
  private fallPos: Float32Array;
  private fallSpeed: Float32Array;
  private burst: THREE.Points;
  private burstPos: Float32Array;
  private burstVel: Float32Array;
  private burstLife: Float32Array;
  private burstHead = 0;
  private readonly FALL_N = 320;
  private readonly BURST_N = 260;
  private breaths: { sprite: THREE.Sprite; life: number }[] = [];
  private breathHead = 0;

  constructor() {
    const tex = softParticleTexture();
    // 降雪
    this.fallPos = new Float32Array(this.FALL_N * 3);
    this.fallSpeed = new Float32Array(this.FALL_N);
    for (let i = 0; i < this.FALL_N; i++) {
      this.fallPos[i * 3] = (Math.random() - 0.5) * 34;
      this.fallPos[i * 3 + 1] = Math.random() * 10;
      this.fallPos[i * 3 + 2] = (Math.random() - 0.5) * 34;
      this.fallSpeed[i] = 0.35 + Math.random() * 0.5;
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(this.fallPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.fall = new THREE.Points(fg, new THREE.PointsMaterial({
      map: tex, size: 0.055, transparent: true, opacity: 0.75, depthWrite: false,
      color: '#ffffff', sizeAttenuation: true
    }));
    this.fall.frustumCulled = false;
    this.group.add(this.fall);

    // 雪煙（バースト）
    this.burstPos = new Float32Array(this.BURST_N * 3);
    this.burstVel = new Float32Array(this.BURST_N * 3);
    this.burstLife = new Float32Array(this.BURST_N);
    this.burstLife.fill(-1);
    for (let i = 0; i < this.BURST_N; i++) this.burstPos[i * 3 + 1] = -10;
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(this.burstPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.burst = new THREE.Points(bg, new THREE.PointsMaterial({
      map: tex, size: 0.09, transparent: true, opacity: 0.85, depthWrite: false,
      color: '#f4f7fc', sizeAttenuation: true
    }));
    this.burst.frustumCulled = false;
    this.group.add(this.burst);

    // 呼気（白い息）
    for (let i = 0; i < 10; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, transparent: true, opacity: 0, depthWrite: false, color: '#eef2f8'
      }));
      s.scale.setScalar(0.001);
      this.group.add(s);
      this.breaths.push({ sprite: s, life: -1 });
    }
  }

  /** 局所の雪煙を上げる */
  puff(at: THREE.Vector3, count: number, spread: number, up: number, drift?: THREE.Vector3): void {
    for (let i = 0; i < count; i++) {
      const k = this.burstHead;
      this.burstHead = (this.burstHead + 1) % this.BURST_N;
      this.burstPos[k * 3] = at.x + (Math.random() - 0.5) * spread;
      this.burstPos[k * 3 + 1] = at.y + Math.random() * 0.05;
      this.burstPos[k * 3 + 2] = at.z + (Math.random() - 0.5) * spread;
      this.burstVel[k * 3] = (Math.random() - 0.5) * 0.8 + (drift?.x ?? 0);
      this.burstVel[k * 3 + 1] = up * (0.5 + Math.random() * 0.9);
      this.burstVel[k * 3 + 2] = (Math.random() - 0.5) * 0.8 + (drift?.z ?? 0);
      this.burstLife[k] = 0.55 + Math.random() * 0.4;
    }
  }

  breath(at: THREE.Vector3): void {
    const b = this.breaths[this.breathHead];
    this.breathHead = (this.breathHead + 1) % this.breaths.length;
    b.sprite.position.copy(at);
    b.life = 1;
  }

  update(dt: number, focus: THREE.Vector3): void {
    // 降雪はフォーカス周辺に巻き付ける
    for (let i = 0; i < this.FALL_N; i++) {
      let y = this.fallPos[i * 3 + 1] - this.fallSpeed[i] * dt;
      this.fallPos[i * 3] += Math.sin(performance.now() * 0.0004 + i) * dt * 0.35;
      if (y < 0) {
        y = 8 + Math.random() * 2;
        this.fallPos[i * 3] = focus.x + (Math.random() - 0.5) * 30;
        this.fallPos[i * 3 + 2] = focus.z + (Math.random() - 0.5) * 30;
      }
      this.fallPos[i * 3 + 1] = y;
    }
    (this.fall.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;

    for (let i = 0; i < this.BURST_N; i++) {
      if (this.burstLife[i] < 0) continue;
      this.burstLife[i] -= dt;
      if (this.burstLife[i] < 0) {
        this.burstPos[i * 3 + 1] = -10;
        continue;
      }
      this.burstVel[i * 3 + 1] -= 2.6 * dt;
      this.burstPos[i * 3] += this.burstVel[i * 3] * dt;
      this.burstPos[i * 3 + 1] += this.burstVel[i * 3 + 1] * dt;
      this.burstPos[i * 3 + 2] += this.burstVel[i * 3 + 2] * dt;
      if (this.burstPos[i * 3 + 1] < 0.02) this.burstPos[i * 3 + 1] = 0.02;
    }
    (this.burst.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;

    for (const b of this.breaths) {
      if (b.life < 0) continue;
      b.life -= dt * 0.7;
      if (b.life < 0) {
        b.sprite.material.opacity = 0;
        b.sprite.scale.setScalar(0.001);
        continue;
      }
      const t = 1 - b.life;
      b.sprite.position.y += dt * 0.22;
      b.sprite.position.x -= dt * 0.1;
      b.sprite.scale.setScalar(0.08 + t * 0.3);
      b.sprite.material.opacity = 0.32 * Math.sin(Math.min(1, t * 1.4) * Math.PI);
    }
  }
}

// ---------------------------------------------------------------------------
// そり跡と蹄跡: リングバッファのリボン/インスタンス。圧雪はやや青く沈む。
// ---------------------------------------------------------------------------
export class SnowMarks {
  readonly group = new THREE.Group();
  private trail: THREE.Mesh;
  private trailPos: Float32Array;
  private trailCount = 0;
  private readonly TRAIL_MAX = 240; // セグメント数（左右ペア）
  private lastLeft = new THREE.Vector3();
  private lastRight = new THREE.Vector3();
  private hasLast = false;
  private prints: THREE.InstancedMesh;
  private printHead = 0;
  private readonly PRINT_MAX = 160;
  private dummy = new THREE.Object3D();

  constructor() {
    // そり跡: 左右2本のリボンを1ジオメトリに
    this.trailPos = new Float32Array(this.TRAIL_MAX * 2 * 2 * 3);
    const idx: number[] = [];
    for (let s = 0; s < 2; s++) {
      const base = s * this.TRAIL_MAX * 2;
      for (let i = 0; i < this.TRAIL_MAX - 1; i++) {
        const a = base + i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(idx);
    g.setDrawRange(0, 0);
    const m = new THREE.MeshBasicMaterial({
      color: '#b9c6dd', transparent: true, opacity: 0.55, depthWrite: false
    });
    this.trail = new THREE.Mesh(g, m);
    this.trail.frustumCulled = false;
    this.trail.renderOrder = 1;
    this.group.add(this.trail);

    // 蹄跡: 楕円の押し跡
    const pg = new THREE.CircleGeometry(0.09, 10);
    pg.rotateX(-Math.PI / 2);
    pg.scale(0.75, 1, 1.15);
    const pm = new THREE.MeshBasicMaterial({
      color: '#c3cede', transparent: true, opacity: 0.5, depthWrite: false
    });
    this.prints = new THREE.InstancedMesh(pg, pm, this.PRINT_MAX);
    this.prints.renderOrder = 1;
    // 初期は地下へ
    for (let i = 0; i < this.PRINT_MAX; i++) {
      this.dummy.position.set(0, -5, 0);
      this.dummy.updateMatrix();
      this.prints.setMatrixAt(i, this.dummy.matrix);
    }
    this.prints.instanceMatrix.needsUpdate = true;
    this.group.add(this.prints);
  }

  /** そりランナー位置を通知（十分進んだらセグメント追加） */
  sledAt(left: THREE.Vector3, right: THREE.Vector3): void {
    if (!this.hasLast) {
      this.lastLeft.copy(left);
      this.lastRight.copy(right);
      this.hasLast = true;
      return;
    }
    if (left.distanceToSquared(this.lastLeft) < 0.05 * 0.05) return;
    const i = this.trailCount % this.TRAIL_MAX;
    const W = 0.07;
    const put = (side: number, c: THREE.Vector3, prev: THREE.Vector3) => {
      const dir = c.clone().sub(prev).normalize();
      const perp = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(W);
      const base = (side * this.TRAIL_MAX + i) * 2 * 3;
      this.trailPos[base] = c.x - perp.x;
      this.trailPos[base + 1] = 0.015;
      this.trailPos[base + 2] = c.z - perp.z;
      this.trailPos[base + 3] = c.x + perp.x;
      this.trailPos[base + 4] = 0.015;
      this.trailPos[base + 5] = c.z + perp.z;
    };
    put(0, left, this.lastLeft);
    put(1, right, this.lastRight);
    this.lastLeft.copy(left);
    this.lastRight.copy(right);
    this.trailCount++;
    const seg = Math.min(this.trailCount, this.TRAIL_MAX - 1);
    this.trail.geometry.setDrawRange(0, seg * 6 * 2);
    (this.trail.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  hoofPrint(at: THREE.Vector3, heading: number): void {
    this.dummy.position.set(at.x, 0.012, at.z);
    this.dummy.rotation.set(0, heading, 0);
    this.dummy.scale.setScalar(0.8 + Math.random() * 0.3);
    this.dummy.updateMatrix();
    this.prints.setMatrixAt(this.printHead, this.dummy.matrix);
    this.printHead = (this.printHead + 1) % this.PRINT_MAX;
    this.prints.instanceMatrix.needsUpdate = true;
  }

  reset(): void {
    this.trailCount = 0;
    this.hasLast = false;
    this.trail.geometry.setDrawRange(0, 0);
  }
}
