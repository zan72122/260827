import * as THREE from 'three';
import { damp } from '../util/math';

/**
 * One room, two ends: a bright pastry bench under a window, and the birthday
 * table under a warm pendant. The image based lighting is generated once from a
 * small proxy room, so white buttercream and bare steel are lit by something
 * with actual shape to it rather than a flat ambient term.
 */

export type LightingMode = 'bench' | 'table';
/** Extra rigs used only for checking that the materials hold up. */
export type DevLighting = 'default' | 'overcast' | 'evening';

function proxyRoom(): THREE.Scene {
  const scene = new THREE.Scene();

  const panel = (
    w: number, h: number, d: number,
    x: number, y: number, z: number,
    color: number, emissive: number,
  ) => {
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 1,
      metalness: 0,
      emissive: new THREE.Color(color),
      emissiveIntensity: emissive,
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    scene.add(mesh);
  };

  // The room itself, seen from the inside and lit, so that reflections in the
  // steel have somewhere to come from other than a black void.
  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(9, 5.2, 9),
    new THREE.MeshStandardMaterial({ color: 0xe9e2d7, roughness: 1, side: THREE.BackSide }),
  );
  shell.position.y = 1.5;
  scene.add(shell);

  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(8.6, 0.1, 8.6),
    new THREE.MeshStandardMaterial({ color: 0xcbb79d, roughness: 1 }),
  );
  floor.position.y = -0.95;
  scene.add(floor);

  // The bench top itself. Everything that matters in this game sits just above
  // a large, pale, horizontal surface, and steel spends most of its time
  // reflecting exactly that. Without it, a tool turned downwards has nothing
  // but a dim floor to mirror and reads as a black shape rather than as metal.
  panel(3.4, 0.12, 2.4, -0.35, -0.36, 0.05, 0xf3ece0, 0.12);

  const key = new THREE.PointLight(0xfff4e6, 34, 30, 2);
  key.position.set(-1.2, 2.6, 0.2);
  scene.add(key);
  const bounce = new THREE.PointLight(0xffe9d2, 12, 24, 2);
  bounce.position.set(2.0, 1.4, 1.4);
  scene.add(bounce);

  // Window: a tall cool panel with a mullion across it, the strongest thing in
  // the room and the shape you see reflected in a piping tip.
  panel(0.08, 2.5, 3.4, -3.36, 1.5, -0.6, 0xf4f8ff, 7.0);
  panel(0.11, 2.6, 0.07, -3.31, 1.5, -0.6, 0xcfc8bd, 0);
  panel(0.11, 0.07, 3.4, -3.31, 1.5, -0.6, 0xcfc8bd, 0);
  // sky bounce off the reveal above the window
  panel(1.6, 0.06, 3.0, -2.5, 3.0, -0.6, 0xeef3ff, 1.2);
  // A glazed door at the near end of the room. Without something bright on
  // this side, bare steel facing the camera has nothing to reflect and reads
  // as a black wedge rather than as a tool.
  panel(2.6, 2.1, 0.08, 0.2, 1.3, 3.3, 0xeef4ff, 3.2);

  // Warm pendant over the birthday table.
  panel(0.5, 0.08, 0.5, 1.9, 1.55, 1.4, 0xffdcb4, 4.2);
  // warm wall bounce beside the table
  panel(0.06, 1.4, 3.0, 3.28, 1.2, 1.4, 0xf0dcc4, 0.3);
  // a shelf line, so reflections keep a readable horizontal
  panel(2.6, 0.06, 0.4, 0.4, 1.9, -3.2, 0xd4c6ae, 0.05);

  return scene;
}

export function buildEnvMap(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const room = proxyRoom();
  const target = pmrem.fromScene(room, 0.02);
  room.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    if (m.material) (m.material as THREE.Material).dispose();
  });
  pmrem.dispose();
  return target.texture;
}

/**
 * Light levels.
 *
 * three.js works in physical units: a directional light's intensity *is* the
 * irradiance it delivers, while a point light's is candela, so what actually
 * lands on a surface is intensity divided by distance squared. The pendant
 * hangs about 310 mm above the table, which divides its value by roughly ten.
 * The numbers below are chosen so a white cloth under the pendant and white
 * buttercream under the window both come out just below one, instead of
 * clipping to paper white.
 */
interface RigTargets {
  windowIntensity: number;
  pendantIntensity: number;
  fillIntensity: number;
  nearIntensity: number;
  bounceIntensity: number;
  windowColor: number;
  pendantColor: number;
  envIntensity: number;
}

const MODES: Record<string, RigTargets> = {
  'bench/default': {
    windowIntensity: 2.2, pendantIntensity: 0.25, fillIntensity: 0.26,
    nearIntensity: 0.24, bounceIntensity: 0.05,
    windowColor: 0xf3f6ff, pendantColor: 0xffc98d, envIntensity: 0.9,
  },
  'table/default': {
    windowIntensity: 0.40, pendantIntensity: 2.2, fillIntensity: 0.22,
    nearIntensity: 0.22, bounceIntensity: 0.16,
    windowColor: 0xdfe7f7, pendantColor: 0xffe6cf, envIntensity: 0.8,
  },
  'bench/overcast': {
    windowIntensity: 1.7, pendantIntensity: 0.0, fillIntensity: 0.85,
    nearIntensity: 0.50, bounceIntensity: 0.10,
    windowColor: 0xeaeef6, pendantColor: 0xffffff, envIntensity: 1.2,
  },
  'table/overcast': {
    windowIntensity: 1.5, pendantIntensity: 0.0, fillIntensity: 0.80,
    nearIntensity: 0.45, bounceIntensity: 0.10,
    windowColor: 0xeaeef6, pendantColor: 0xffffff, envIntensity: 1.2,
  },
  'bench/evening': {
    windowIntensity: 0.15, pendantIntensity: 2.6, fillIntensity: 0.18,
    nearIntensity: 0.14, bounceIntensity: 0.20,
    windowColor: 0x9fb2d8, pendantColor: 0xffd2a6, envIntensity: 0.6,
  },
  'table/evening': {
    windowIntensity: 0.12, pendantIntensity: 2.9, fillIntensity: 0.16,
    nearIntensity: 0.13, bounceIntensity: 0.22,
    windowColor: 0x9fb2d8, pendantColor: 0xffd6ae, envIntensity: 0.6,
  },
};

export class LightRig {
  readonly group = new THREE.Group();
  readonly windowLight: THREE.DirectionalLight;
  readonly pendant: THREE.PointLight;
  readonly fill: THREE.HemisphereLight;
  readonly bounce: THREE.DirectionalLight;
  /**
   * A soft light from roughly where the camera is. Bare steel has no diffuse
   * term, so without something on this side of the room a tip turned away from
   * the window reads as a black wedge instead of as a tool.
   */
  readonly nearFill: THREE.DirectionalLight;

  private mode: LightingMode = 'bench';
  private dev: DevLighting = 'default';
  envIntensity = 1;

  constructor() {
    this.windowLight = new THREE.DirectionalLight(0xf3f6ff, 3.1);
    this.windowLight.position.set(-2.3, 2.1, -0.9);
    this.windowLight.castShadow = true;
    const s = this.windowLight.shadow;
    s.mapSize.set(1024, 1024);
    s.camera.near = 0.4;
    s.camera.far = 7;
    s.camera.left = -0.9;
    s.camera.right = 0.9;
    s.camera.top = 0.9;
    s.camera.bottom = -0.9;
    s.bias = -0.0006;
    s.normalBias = 0.006;
    this.group.add(this.windowLight);
    this.group.add(this.windowLight.target);

    // 780 mm above the table, which is where a pendant actually hangs. Sitting
    // it 300 mm up, as it was, put the bulb inside the cake's airspace and blew
    // out everything directly under it.
    this.pendant = new THREE.PointLight(0xffc07a, 2.2, 7, 2);
    this.pendant.position.set(1.9, 1.52, 1.4);
    this.pendant.castShadow = true;
    this.pendant.shadow.mapSize.set(1024, 1024);
    this.pendant.shadow.camera.near = 0.08;
    this.pendant.shadow.camera.far = 4;
    this.pendant.shadow.bias = -0.0012;
    this.pendant.shadow.normalBias = 0.008;
    this.group.add(this.pendant);

    this.bounce = new THREE.DirectionalLight(0xfff0e2, 0.16);
    this.bounce.position.set(1.6, 0.6, 1.8);
    this.group.add(this.bounce);

    this.nearFill = new THREE.DirectionalLight(0xf4f6fb, 0.55);
    this.nearFill.position.set(0.6, 0.7, 1.6);
    this.group.add(this.nearFill);
    this.group.add(this.nearFill.target);

    this.fill = new THREE.HemisphereLight(0xdfe7f7, 0xa88e72, 0.42);
    this.group.add(this.fill);
  }

  setMode(mode: LightingMode): void {
    this.mode = mode;
    // Only ever one shadow-casting light: two shadow maps a frame is a cost
    // the subject would end up paying for.
    this.windowLight.castShadow = mode === 'bench';
    this.pendant.castShadow = mode === 'table' && this.allowPendantShadow;
  }

  allowPendantShadow = true;

  setDev(dev: DevLighting): void {
    this.dev = dev;
  }

  devMode(): DevLighting {
    return this.dev;
  }

  /** Aim the shadow-casting lights at whatever is currently the subject. */
  focus(point: THREE.Vector3): void {
    this.windowLight.target.position.copy(point);
    this.windowLight.target.updateMatrixWorld();
    this.windowLight.position.set(point.x - 1.05, point.y + 1.15, point.z - 0.75);
    this.windowLight.shadow.camera.updateProjectionMatrix();
    this.nearFill.target.position.copy(point);
    this.nearFill.target.updateMatrixWorld();
    this.nearFill.position.set(point.x + 0.5, point.y + 0.55, point.z + 1.3);
  }

  update(dt: number, instant = false): void {
    const t = MODES[`${this.mode}/${this.dev}`] ?? MODES['bench/default'];
    const k = instant ? 1 : undefined;
    const ap = (cur: number, tgt: number) => (k === 1 ? tgt : damp(cur, tgt, 3.2, dt));
    this.windowLight.intensity = ap(this.windowLight.intensity, t.windowIntensity);
    this.pendant.intensity = ap(this.pendant.intensity, t.pendantIntensity);
    this.fill.intensity = ap(this.fill.intensity, t.fillIntensity);
    this.bounce.intensity = ap(this.bounce.intensity, t.bounceIntensity);
    this.nearFill.intensity = ap(this.nearFill.intensity, t.nearIntensity);
    this.windowLight.color.lerp(new THREE.Color(t.windowColor), instant ? 1 : 1 - Math.exp(-3.2 * dt));
    this.pendant.color.lerp(new THREE.Color(t.pendantColor), instant ? 1 : 1 - Math.exp(-3.2 * dt));
    this.envIntensity = ap(this.envIntensity, t.envIntensity);
  }
}
