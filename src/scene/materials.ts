import * as THREE from 'three';
import {
  beltTexture,
  canvasWeaveTexture,
  metalRoughnessTexture,
  rubberTexture,
  woodTexture,
} from '../core/textures';

/**
 * One shared material library so brass, rubber, canvas, wood and paper read as
 * different substances rather than tinted plastic.
 */
export class MaterialLibrary {
  readonly wood: THREE.MeshStandardMaterial;
  readonly woodDark: THREE.MeshStandardMaterial;
  readonly brass: THREE.MeshStandardMaterial;
  readonly steelPainted: THREE.MeshStandardMaterial;
  readonly steelRaw: THREE.MeshStandardMaterial;
  readonly rubberDie: THREE.MeshStandardMaterial;
  readonly belt: THREE.MeshStandardMaterial;
  readonly bagCanvas: THREE.MeshStandardMaterial;
  readonly bagCanvasDark: THREE.MeshStandardMaterial;
  readonly rope: THREE.MeshStandardMaterial;
  readonly inkPad: THREE.MeshStandardMaterial;
  readonly concrete: THREE.MeshStandardMaterial;
  readonly wallPlaster: THREE.MeshStandardMaterial;
  readonly snow: THREE.MeshStandardMaterial;
  readonly glass: THREE.MeshStandardMaterial;
  readonly lampOff: THREE.MeshStandardMaterial;
  readonly lampOn: THREE.MeshStandardMaterial;
  readonly paintedGreen: THREE.MeshStandardMaterial;
  readonly paintedRed: THREE.MeshStandardMaterial;
  readonly paintedBlue: THREE.MeshStandardMaterial;
  readonly paintedCream: THREE.MeshStandardMaterial;
  readonly cloth: THREE.MeshStandardMaterial;
  readonly skin: THREE.MeshStandardMaterial;

  private disposables: THREE.Texture[] = [];

  constructor() {
    const w = woodTexture(512, 11);
    w.map.repeat.set(3, 1);
    w.bump.repeat.set(3, 1);
    this.disposables.push(w.map, w.bump);

    this.wood = new THREE.MeshStandardMaterial({
      map: w.map,
      bumpMap: w.bump,
      bumpScale: 0.06,
      color: 0xb2a48d,
      roughness: 0.58,
      metalness: 0.0,
    });
    this.woodDark = new THREE.MeshStandardMaterial({
      map: w.map,
      bumpMap: w.bump,
      bumpScale: 0.05,
      color: 0x8c6a48,
      roughness: 0.72,
    });

    const brassRough = metalRoughnessTexture(256, 23, 0.36);
    this.disposables.push(brassRough);
    this.brass = new THREE.MeshStandardMaterial({
      color: 0xb08a45,
      metalness: 1.0,
      roughness: 0.38,
      roughnessMap: brassRough,
    });

    const steelRough = metalRoughnessTexture(256, 31, 0.55);
    this.disposables.push(steelRough);
    this.steelPainted = new THREE.MeshStandardMaterial({
      color: 0x3d4a4e,
      metalness: 0.45,
      roughness: 0.6,
      roughnessMap: steelRough,
    });
    this.steelRaw = new THREE.MeshStandardMaterial({
      color: 0x8a8f92,
      metalness: 0.95,
      roughness: 0.45,
      roughnessMap: steelRough,
    });

    const rub = rubberTexture(256, 19);
    this.disposables.push(rub);
    this.rubberDie = new THREE.MeshStandardMaterial({
      map: rub,
      roughness: 0.86,
      metalness: 0.0,
    });

    const b = beltTexture(256, 29);
    b.map.repeat.set(6, 1);
    b.rough.repeat.set(6, 1);
    this.disposables.push(b.map, b.rough);
    this.belt = new THREE.MeshStandardMaterial({
      map: b.map,
      roughnessMap: b.rough,
      roughness: 0.9,
      metalness: 0.02,
    });

    const weave = canvasWeaveTexture(512, 3, [178, 162, 130]);
    weave.repeat.set(2, 1);
    this.disposables.push(weave);
    this.bagCanvas = new THREE.MeshStandardMaterial({
      map: weave,
      bumpMap: weave,
      bumpScale: 0.05,
      roughness: 0.95,
      metalness: 0.0,
    });
    this.bagCanvasDark = this.bagCanvas.clone();
    this.bagCanvasDark.color = new THREE.Color(0x9a8f76);

    this.rope = new THREE.MeshStandardMaterial({ color: 0xa89468, roughness: 0.95 });
    this.inkPad = new THREE.MeshStandardMaterial({ color: 0x1c2436, roughness: 0.62, metalness: 0.05 });
    this.concrete = new THREE.MeshStandardMaterial({ color: 0x565049, roughness: 0.95 });
    this.wallPlaster = new THREE.MeshStandardMaterial({ color: 0x8a7e6d, roughness: 0.92 });
    this.snow = new THREE.MeshStandardMaterial({ color: 0xcfdcec, roughness: 0.72 });
    // plain transparent glass: a transmission pass would re-render the whole hall
    this.glass = new THREE.MeshStandardMaterial({
      color: 0xcfe2f4,
      roughness: 0.14,
      metalness: 0.0,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    });
    this.lampOff = new THREE.MeshStandardMaterial({ color: 0x4b4436, roughness: 0.6 });
    this.lampOn = new THREE.MeshStandardMaterial({
      color: 0xffd79a,
      emissive: 0xffb055,
      emissiveIntensity: 1.6,
      roughness: 0.4,
    });
    this.paintedGreen = new THREE.MeshStandardMaterial({ color: 0x4a6350, roughness: 0.66, metalness: 0.12 });
    this.paintedRed = new THREE.MeshStandardMaterial({ color: 0x8e3d33, roughness: 0.62, metalness: 0.12 });
    this.paintedBlue = new THREE.MeshStandardMaterial({ color: 0x3b5570, roughness: 0.64, metalness: 0.12 });
    this.paintedCream = new THREE.MeshStandardMaterial({ color: 0xcfc0a0, roughness: 0.7 });
    this.cloth = new THREE.MeshStandardMaterial({ color: 0x6d7d88, roughness: 0.94 });
    this.skin = new THREE.MeshStandardMaterial({ color: 0xd9a982, roughness: 0.75 });
  }

  setEnvironment(env: THREE.Texture): void {
    for (const m of [
      this.brass,
      this.steelPainted,
      this.steelRaw,
      this.wood,
      this.woodDark,
      this.belt,
      this.glass,
    ]) {
      (m as THREE.MeshStandardMaterial).envMap = env;
      (m as THREE.MeshStandardMaterial).envMapIntensity = 0.55;
      m.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const t of this.disposables) t.dispose();
  }
}
