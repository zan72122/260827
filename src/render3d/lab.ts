import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { BATHS, STATIONS, bathById, type StationId } from '../sim/protocol';
import { createMaterials, type MaterialSet, type QualityTier } from './materials';
import { JarObject, jarLayout } from './jar';
import { RackObject } from './rack';
import { MountStage } from './mountStage';

/**
 * カメラの画。縦画面では横方向の視野が足りなくなるため、
 * 「見せたい横幅(mm)」を基準に画角を決める。
 */
export interface CameraShot {
  look: THREE.Vector3;
  /** 注視点までの距離(mm) */
  dist: number;
  /** 見下ろす角度(度) */
  pitch: number;
  /** 画面の横幅に収めたいワールド幅(mm) */
  widthMm: number;
  /** 画面の高さに収めたいワールド高さ(mm)。横長画面でも主役が切れないようにする。 */
  heightMm: number;
}

/** 検査室の作業台。触れる主役（ラック・スライド・槽）に描画予算を寄せる。 */
export class LabScene {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  jars = new Map<string, JarObject>();
  jarPos = new Map<string, THREE.Vector3>();
  rack: RackObject;
  mountStage: MountStage;
  mats: MaterialSet;
  private key: THREE.DirectionalLight;
  private envRT: THREE.WebGLRenderTarget | null = null;

  constructor(renderer: THREE.WebGLRenderer, tier: QualityTier) {
    this.mats = createMaterials(tier);
    this.scene.background = new THREE.Color(0x6d757b);

    this.camera = new THREE.PerspectiveCamera(38, 1, 1, 6000);
    this.camera.position.set(0, 300, 330);

    // --- 環境反射（ガラス・ステンレスの写り込み）
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.03);
    this.scene.environment = env.texture;
    this.envRT = env;
    pmrem.dispose();

    // --- 照明: 主光源 1 灯 + 補助。多重シャドウは使わない。
    this.key = new THREE.DirectionalLight(0xffffff, 2.6);
    this.key.position.set(-380, 760, 420);
    this.key.castShadow = tier !== 'low';
    if (this.key.castShadow) {
      const s = tier === 'high' ? 1024 : 512;
      this.key.shadow.mapSize.set(s, s);
      this.key.shadow.camera.left = -420;
      this.key.shadow.camera.right = 420;
      this.key.shadow.camera.top = 420;
      this.key.shadow.camera.bottom = -420;
      this.key.shadow.camera.near = 100;
      this.key.shadow.camera.far = 1800;
      this.key.shadow.bias = -0.0016;
      this.key.shadow.normalBias = 0.7;
    }
    this.scene.add(this.key);
    this.scene.add(this.key.target);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.22));

    this.buildRoom();

    // --- 槽を配置
    for (const st of STATIONS) {
      if (st.id === 'mount') continue;
      for (const p of jarLayout(st.id)) {
        const jar = new JarObject(bathById(p.id), this.mats);
        jar.group.position.set(st.benchX + p.x, 0, p.z);
        this.scene.add(jar.group);
        this.jars.set(p.id, jar);
        this.jarPos.set(p.id, jar.group.position.clone());
      }
    }

    this.rack = new RackObject(this.mats);
    this.scene.add(this.rack.group);

    this.mountStage = new MountStage(this.mats);
    this.mountStage.group.position.set(STATIONS[STATIONS.length - 1].benchX, 0, 0);
    this.scene.add(this.mountStage.group);
  }

  private buildRoom(): void {
    const m = this.mats;
    // 天板
    const top = new THREE.Mesh(new THREE.BoxGeometry(3400, 40, 760), m.bench);
    top.position.set(320, -20, -60);
    top.receiveShadow = true;
    this.scene.add(top);

    // 前面の幕板と脚
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(3400, 300, 30), m.plastic);
    skirt.position.set(320, -190, 305);
    this.scene.add(skirt);

    // 背面の壁と立ち上がり
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(4600, 2400), m.wall);
    wall.position.set(320, 700, -460);
    wall.receiveShadow = true;
    this.scene.add(wall);
    const splashMat = new THREE.MeshStandardMaterial({ color: 0x767c80, roughness: 0.7, metalness: 0 });
    const splash = new THREE.Mesh(new THREE.BoxGeometry(3400, 96, 24), splashMat);
    splash.position.set(320, 48, -448);
    this.scene.add(splash);

    // 溶剤を扱う位置の局所排気（換気設備は整っている前提）
    const hoodMat = new THREE.MeshStandardMaterial({ color: 0xe3e6e8, roughness: 0.5, metalness: 0.1 });
    for (const sx of [-620, 1060]) {
      const hood = new THREE.Mesh(new THREE.BoxGeometry(560, 30, 320), hoodMat);
      hood.position.set(sx, 780, -200);
      this.scene.add(hood);
      const duct = new THREE.Mesh(new THREE.CylinderGeometry(52, 52, 300, 16), hoodMat);
      duct.position.set(sx, 940, -200);
      this.scene.add(duct);
      const skirt2 = new THREE.Mesh(new THREE.BoxGeometry(560, 90, 12), hoodMat);
      skirt2.position.set(sx, 730, -46);
      this.scene.add(skirt2);
    }

    // 流し（水洗の位置）
    const sinkX = STATIONS.find((s) => s.id === 'wash')!.benchX;
    const sink = new THREE.Mesh(new THREE.BoxGeometry(320, 8, 260), m.steelDark);
    sink.position.set(sinkX, -1, -230);
    this.scene.add(sink);
    for (const [w, h, d, x, y, z] of [
      [320, 60, 8, sinkX, 28, -358],
      [8, 60, 260, sinkX - 156, 28, -230],
      [8, 60, 260, sinkX + 156, 28, -230],
    ] as const) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m.steelDark);
      p.position.set(x, y, z);
      this.scene.add(p);
    }
    const spout = new THREE.Group();
    const col = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 200, 12), m.steel);
    col.position.set(0, 100, 0);
    spout.add(col);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 150, 12), m.steel);
    arm.rotation.z = Math.PI / 2;
    arm.position.set(60, 196, 0);
    spout.add(arm);
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 34, 12), m.steel);
    tip.position.set(130, 180, 0);
    spout.add(tip);
    spout.position.set(sinkX - 60, 0, -350);
    this.scene.add(spout);

    // 背面の棚と試薬ボトル（検査室の用途を説明する範囲にとどめる）
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(3200, 18, 200), m.plastic);
    shelf.position.set(320, 214, -404);
    shelf.receiveShadow = true;
    this.scene.add(shelf);
    const shelf2 = shelf.clone();
    shelf2.position.y = 392;
    this.scene.add(shelf2);
    const bottleMats = [
      new THREE.MeshStandardMaterial({ color: 0xdfe3e0, roughness: 0.35, metalness: 0, transparent: true, opacity: 0.92 }),
      new THREE.MeshStandardMaterial({ color: 0xc2a978, roughness: 0.3, metalness: 0, transparent: true, opacity: 0.85 }),
    ];
    for (let i = 0; i < 26; i++) {
      const h = 96 + ((i * 37) % 56);
      const r2 = 34 + ((i * 13) % 16);
      const b2 = new THREE.Mesh(new THREE.CylinderGeometry(r2, r2, h, 14), bottleMats[i % 2]);
      b2.position.set(-1180 + i * 96, (i % 2 ? 392 : 214) + h / 2 + 9, -404 + ((i * 29) % 40) - 20);
      this.scene.add(b2);
      const cap2 = new THREE.Mesh(new THREE.CylinderGeometry(r2 * 0.55, r2 * 0.55, 22, 12), m.plastic);
      cap2.position.set(b2.position.x, b2.position.y + h / 2 + 11, b2.position.z);
      this.scene.add(cap2);
    }

    // 廃液容器（用途の分かる設備だけを置く）
    for (let i = 0; i < 2; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(150, 220, 150), new THREE.MeshStandardMaterial({ color: 0xf1efe6, roughness: 0.55, metalness: 0 }));
      b.position.set(1620 + i * 170, 110, -230);
      b.castShadow = true;
      this.scene.add(b);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(30, 30, 26, 12), new THREE.MeshStandardMaterial({ color: 0xc03a2b, roughness: 0.5 }));
      cap.position.set(1620 + i * 170, 233, -230);
      this.scene.add(cap);
    }
  }

  /** ステーション全体を見る画（作業位置に寄ったカメラ）。 */
  stationShot(id: StationId): CameraShot {
    const st = STATIONS.find((s) => s.id === id)!;
    if (id === 'mount') {
      return { look: new THREE.Vector3(st.benchX, 6, -4), dist: 235, pitch: 52, widthMm: 74, heightMm: 108 };
    }
    return { look: new THREE.Vector3(st.benchX, 52, -30), dist: 600, pitch: 34, widthMm: 380, heightMm: 330 };
  }

  /** 個々の槽へ寄る画（細かい操作用）。 */
  jarShot(jarId: string): CameraShot {
    const p = this.jarPos.get(jarId)!;
    return { look: new THREE.Vector3(p.x, 60, p.z - 34), dist: 330, pitch: 28, widthMm: 198, heightMm: 168 };
  }

  update(dt: number): void {
    for (const j of this.jars.values()) j.update(dt);
    this.rack.update(dt, 0);
    this.mountStage.update(dt);
  }

  /** 現在のステーション以外の槽は描画から外す（描画予算を主役へ寄せる）。 */
  setVisibleStations(active: StationId): void {
    for (const b of BATHS) {
      const jar = this.jars.get(b.id);
      if (!jar) continue;
      jar.group.visible = b.station === active;
    }
    this.mountStage.group.visible = active === 'mount';
  }

  dispose(): void {
    for (const j of this.jars.values()) j.dispose();
    this.rack.dispose();
    this.mountStage.dispose();
    this.mats.dispose();
    this.envRT?.dispose();
  }
}
