import * as THREE from 'three';
import {
  makeBrass, makeEndGrain, makeFrost, makePaint, makePlaster, makeSteel,
  makeTurnedWood, makeWood,
} from './textures';

/* ------------------------------------------------------------------ *
 * The material library.  Built once, shared everywhere.
 * Wood is never one flat brown: boards, turnings and end grain are three
 * different bakes, and the paint sits on top of the wood it was brushed on.
 * ------------------------------------------------------------------ */

export class Materials {
  benchTop!: THREE.MeshStandardMaterial;
  benchFrame!: THREE.MeshStandardMaterial;
  floor!: THREE.MeshStandardMaterial;
  wall!: THREE.MeshStandardMaterial;
  beam!: THREE.MeshStandardMaterial;
  shelf!: THREE.MeshStandardMaterial;

  maple!: THREE.MeshStandardMaterial;        // sawn light wood
  mapleTurned!: THREE.MeshStandardMaterial;  // lathe-turned light wood
  walnutTurned!: THREE.MeshStandardMaterial; // lathe-turned dark wood
  walnut!: THREE.MeshStandardMaterial;
  endGrain!: THREE.MeshStandardMaterial;
  vaneWood!: THREE.MeshStandardMaterial;     // thin, near-translucent blades

  paintRed!: THREE.MeshStandardMaterial;
  paintTeal!: THREE.MeshStandardMaterial;
  paintCream!: THREE.MeshStandardMaterial;
  paintOchre!: THREE.MeshStandardMaterial;
  paintBrown!: THREE.MeshStandardMaterial;
  skinPaint!: THREE.MeshStandardMaterial;

  brass!: THREE.MeshStandardMaterial;
  brassDark!: THREE.MeshStandardMaterial;
  brassBell!: THREE.MeshStandardMaterial;
  steel!: THREE.MeshStandardMaterial;
  steelDark!: THREE.MeshStandardMaterial;

  wax!: THREE.MeshStandardMaterial;
  wick!: THREE.MeshStandardMaterial;
  wickLit!: THREE.MeshStandardMaterial;
  incense!: THREE.MeshStandardMaterial;
  incenseLit!: THREE.MeshStandardMaterial;
  charBlack!: THREE.MeshStandardMaterial;

  glass!: THREE.MeshPhysicalMaterial;
  frost!: THREE.MeshStandardMaterial;
  apron!: THREE.MeshStandardMaterial;
  cloth!: THREE.MeshStandardMaterial;
  interiorDark!: THREE.MeshStandardMaterial;

  env: THREE.Texture | null = null;

  constructor(renderer: THREE.WebGLRenderer) {
    this.buildEnvironment(renderer);
    this.build();
  }

  /**
   * A tiny hand-built environment: cold sky from the window side, warm
   * bounce from the candles and the lamp, dark timber above.  This is the
   * "baked" indirect light - no probe rendering per frame.
   */
  private buildEnvironment(renderer: THREE.WebGLRenderer) {
    const scene = new THREE.Scene();
    const add = (color: number, intensity: number, w: number, h: number, pos: THREE.Vector3) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }),
      );
      m.material.color.multiplyScalar(intensity);
      m.position.copy(pos);
      m.lookAt(0, 0, 0);
      scene.add(m);
    };
    scene.background = new THREE.Color(0x0b0a0c);
    add(0x8fb6da, 1.70, 5, 4, new THREE.Vector3(0.3, 1.1, -3.4));   // window, cold
    add(0xffb066, 2.10, 2.2, 1.2, new THREE.Vector3(0, -0.5, 1.2));  // candle bounce off bench
    add(0xffcf9a, 1.25, 3.2, 1.4, new THREE.Vector3(0, 2.6, 0.4));   // ceiling lamp
    add(0x5a3a24, 0.85, 6, 3, new THREE.Vector3(-3.0, 0.2, 0.6));    // warm timber wall
    add(0x48342a, 0.72, 6, 3, new THREE.Vector3(3.0, 0.2, 0.6));
    add(0x30231a, 0.55, 6, 6, new THREE.Vector3(0, -2.4, 0));        // floor

    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    this.env = pmrem.fromScene(scene, 0.04).texture;
    pmrem.dispose();
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
    });
  }

  private std(p: THREE.MeshStandardMaterialParameters) {
    const m = new THREE.MeshStandardMaterial(p);
    m.envMap = this.env;
    m.envMapIntensity = p.envMapIntensity ?? 0.65;
    return m;
  }

  private build() {
    /* ---- boards and room ---- */
    const bench = makeWood({
      light: [136, 102, 70], dark: [70, 48, 30],
      grainScaleX: 1.3, grainScaleY: 4.0, ringDensity: 5.6, knots: 2, seed: 11, size: 768,
    });
    bench.map.repeat.set(1.0, 4.0); bench.rough.repeat.copy(bench.map.repeat);
    bench.normal.repeat.copy(bench.map.repeat);
    this.benchTop = this.std({
      map: bench.map, roughnessMap: bench.rough, normalMap: bench.normal,
      normalScale: new THREE.Vector2(0.75, 0.75), roughness: 1, metalness: 0, envMapIntensity: 0.5,
    });

    const frame = makeWood({
      light: [126, 92, 58], dark: [58, 38, 22],
      grainScaleX: 1.1, grainScaleY: 6, ringDensity: 4.4, knots: 4, seed: 29,
    });
    this.benchFrame = this.std({
      map: frame.map, roughnessMap: frame.rough, normalMap: frame.normal,
      roughness: 1, metalness: 0, envMapIntensity: 0.35,
    });

    const floor = makeWood({
      light: [118, 84, 54], dark: [52, 34, 20],
      grainScaleX: 0.8, grainScaleY: 9, ringDensity: 6.5, knots: 6, seed: 47, size: 768,
    });
    floor.map.repeat.set(3, 8); floor.rough.repeat.copy(floor.map.repeat);
    floor.normal.repeat.copy(floor.map.repeat);
    this.floor = this.std({
      map: floor.map, roughnessMap: floor.rough, normalMap: floor.normal,
      normalScale: new THREE.Vector2(0.6, 0.6), roughness: 1, metalness: 0, envMapIntensity: 0.28,
    });

    const plaster = makePlaster([120, 117, 114]);
    plaster.map.repeat.set(4, 3); plaster.normal.repeat.set(4, 3);
    this.wall = this.std({
      map: plaster.map, normalMap: plaster.normal,
      normalScale: new THREE.Vector2(1.0, 1.0), roughness: 0.98, metalness: 0, envMapIntensity: 0.26,
    });

    const beam = makeWood({
      light: [92, 64, 40], dark: [38, 25, 15],
      grainScaleX: 0.9, grainScaleY: 7, ringDensity: 3.8, knots: 5, seed: 53,
    });
    beam.map.repeat.set(4, 1); beam.rough.repeat.set(4, 1); beam.normal.repeat.set(4, 1);
    this.beam = this.std({
      map: beam.map, roughnessMap: beam.rough, normalMap: beam.normal,
      roughness: 1, metalness: 0, envMapIntensity: 0.22,
    });
    this.shelf = this.std({
      map: frame.map, roughnessMap: frame.rough, normalMap: frame.normal,
      roughness: 1, metalness: 0, envMapIntensity: 0.3,
    });

    /* ---- workpiece woods ---- */
    const maple = makeWood({
      light: [214, 178, 130], dark: [150, 111, 68],
      grainScaleX: 1.6, grainScaleY: 5, ringDensity: 6, knots: 1, seed: 71,
    });
    this.maple = this.std({
      map: maple.map, roughnessMap: maple.rough, normalMap: maple.normal,
      normalScale: new THREE.Vector2(0.55, 0.55), roughness: 1, metalness: 0, envMapIntensity: 0.55,
    });

    const mapleT = makeTurnedWood({
      light: [219, 183, 136], dark: [151, 110, 66],
      grainScaleX: 2.4, grainScaleY: 4.2, ringDensity: 4.6, knots: 0, seed: 83, toolMarks: 130,
    });
    this.mapleTurned = this.std({
      map: mapleT.map, roughnessMap: mapleT.rough, normalMap: mapleT.normal,
      normalScale: new THREE.Vector2(0.42, 0.42), roughness: 1, metalness: 0, envMapIntensity: 0.6,
    });

    const walnutT = makeTurnedWood({
      light: [128, 88, 56], dark: [62, 39, 24],
      grainScaleX: 2.2, grainScaleY: 4, ringDensity: 4.2, knots: 0, seed: 97, toolMarks: 118,
    });
    this.walnutTurned = this.std({
      map: walnutT.map, roughnessMap: walnutT.rough, normalMap: walnutT.normal,
      normalScale: new THREE.Vector2(0.42, 0.42), roughness: 1, metalness: 0, envMapIntensity: 0.5,
    });

    const walnut = makeWood({
      light: [124, 86, 55], dark: [56, 35, 21],
      grainScaleX: 1.5, grainScaleY: 5, ringDensity: 5, knots: 1, seed: 101,
    });
    this.walnut = this.std({
      map: walnut.map, roughnessMap: walnut.rough, normalMap: walnut.normal,
      roughness: 1, metalness: 0, envMapIntensity: 0.45,
    });

    const eg = makeEndGrain({
      light: [206, 172, 128], dark: [138, 100, 62],
      grainScaleX: 1, grainScaleY: 1, ringDensity: 2.2, knots: 0, seed: 5,
    });
    this.endGrain = this.std({
      map: eg.map, roughnessMap: eg.rough, normalMap: eg.normal,
      roughness: 1, metalness: 0, envMapIntensity: 0.4,
    });

    // thin blades: a warmer, slightly darker stock so they do not read as paper
    const vane = makeWood({
      light: [166, 124, 78], dark: [98, 66, 38],
      grainScaleX: 2.2, grainScaleY: 6, ringDensity: 7, knots: 0, seed: 131, size: 256,
    });
    this.vaneWood = this.std({
      map: vane.map, roughnessMap: vane.rough, normalMap: vane.normal,
      normalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.97, metalness: 0,
      side: THREE.DoubleSide, envMapIntensity: 0.4,
    });

    /* ---- hand paint ---- */
    const mk = (rgb: [number, number, number], band: [number, number], seed: number,
                rough = 0.88) => {
      const p = makePaint(rgb, [168, 128, 84], band, seed);
      return this.std({
        map: p.map, roughnessMap: p.rough, roughness: rough, metalness: 0,
        normalMap: mapleT.normal, normalScale: new THREE.Vector2(0.16, 0.16),
        envMapIntensity: 0.4,
      });
    };
    this.paintRed = mk([150, 52, 42], [0.28, 0.62], 3);
    this.paintTeal = mk([58, 92, 88], [0.3, 0.7], 13);
    this.paintCream = mk([222, 204, 172], [0.35, 0.75], 23);
    this.paintOchre = mk([190, 142, 62], [0.2, 0.6], 33);
    this.paintBrown = mk([96, 66, 44], [0.25, 0.7], 43);
    this.skinPaint = mk([224, 178, 146], [0.4, 0.9], 53, 0.8);

    /* ---- metals ---- */
    const br = makeBrass(5, 0.42);
    this.brass = this.std({
      map: br.map, roughnessMap: br.rough, metalness: 0.92, roughness: 0.36,
      color: 0xffe8c4, envMapIntensity: 1.5,
    });
    const brD = makeBrass(19, 0.92);
    this.brassDark = this.std({
      map: brD.map, roughnessMap: brD.rough, metalness: 0.9, roughness: 0.55,
      envMapIntensity: 1.15,
    });
    // bells are wiped by the striker, so their skin is brighter than fittings
    const brB = makeBrass(31, 0.3);
    this.brassBell = this.std({
      map: brB.map, roughnessMap: brB.rough, metalness: 0.93, roughness: 0.26,
      color: 0xffeccc, envMapIntensity: 1.9, side: THREE.DoubleSide,
    });

    const st = makeSteel(9);
    this.steel = this.std({
      roughnessMap: st.rough, metalness: 0.93, roughness: 0.40, color: 0xb9bcc0,
      envMapIntensity: 1.25,
    });
    this.steelDark = this.std({
      roughnessMap: st.rough, metalness: 0.9, roughness: 0.58, color: 0x6a6d72,
      envMapIntensity: 0.95,
    });

    /* ---- consumables ---- */
    this.wax = this.std({
      color: 0xe7d5b0, roughness: 0.58, metalness: 0,
      envMapIntensity: 0.35,
    });
    this.wax.onBeforeCompile = (s) => {
      // a cheap wax-translucency cue: warm the grazing angles slightly
      s.fragmentShader = s.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         float _rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 2.5);
         totalEmissiveRadiance += vec3(0.22, 0.13, 0.06) * _rim;`,
      );
    };
    this.wick = this.std({ color: 0x2b241d, roughness: 0.95, metalness: 0, envMapIntensity: 0.2 });
    this.wickLit = this.std({
      color: 0x14100d, roughness: 0.95, metalness: 0,
      emissive: 0xff6a1e, emissiveIntensity: 1.6, envMapIntensity: 0.2,
    });
    this.incense = this.std({ color: 0x30251e, roughness: 0.92, metalness: 0, envMapIntensity: 0.25 });
    this.incenseLit = this.std({
      color: 0x1a120d, roughness: 0.9, metalness: 0,
      emissive: 0xff4a12, emissiveIntensity: 1.0, envMapIntensity: 0.2,
    });
    this.charBlack = this.std({ color: 0x171310, roughness: 0.98, metalness: 0, envMapIntensity: 0.15 });
    this.interiorDark = this.std({
      color: 0x3a2c22, roughness: 0.95, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.2,
    });

    /* ---- window ---- */
    this.glass = new THREE.MeshPhysicalMaterial({
      color: 0xb8ccdd, roughness: 0.10, metalness: 0, transmission: 0,
      transparent: true, opacity: 0.055, envMapIntensity: 0.9, side: THREE.DoubleSide,
    });
    this.glass.envMap = this.env;
    const fr = makeFrost();
    // one frost pattern per pane: three columns, two rows
    fr.alpha.repeat.set(3, 2);
    fr.normal.repeat.set(3, 2);
    this.frost = this.std({
      color: 0xc6d6e6, alphaMap: fr.alpha, normalMap: fr.normal,
      normalScale: new THREE.Vector2(0.8, 0.8),
      transparent: true, roughness: 0.55, metalness: 0, envMapIntensity: 0.45,
      side: THREE.DoubleSide, depthWrite: false,
    });

    this.apron = this.std({ color: 0x6d5a45, roughness: 0.95, metalness: 0, envMapIntensity: 0.25 });
    this.cloth = this.std({ color: 0x4a4038, roughness: 0.97, metalness: 0, envMapIntensity: 0.2 });
  }
}

let instance: Materials | null = null;
export function initMaterials(renderer: THREE.WebGLRenderer) {
  instance = new Materials(renderer);
  return instance;
}
export function M(): Materials {
  if (!instance) throw new Error('materials not initialised');
  return instance;
}
