import * as THREE from 'three';
import type { World } from './World';
import type { CakeState, Stage } from '../core/CakeState';
import type { Materials } from '../render/materials';
import type { CameraDirector } from '../camera/CameraDirector';
import type { Overlay, ChoiceButton } from '../ui/Overlay';
import type { AudioKit } from '../audio/AudioKit';
import type { PointerFrame } from '../input/PointerInput';
import type { LightRig } from '../render/Environment';
import type { FlowerBuilder } from '../flower/FlowerBuilder';

export interface Viewport {
  width: number;
  height: number;
  portrait: boolean;
}

export interface StageContext {
  world: World;
  state: CakeState;
  materials: Materials;
  camera: CameraDirector;
  overlay: Overlay;
  audio: AudioKit;
  lights: LightRig;
  viewport: Viewport;
  /** Project a world point into CSS pixels. */
  screenOf(p: THREE.Vector3, out: THREE.Vector2): THREE.Vector2;
  /** Cast a screen point onto a horizontal plane at the given height. */
  pickOnPlane(x: number, y: number, planeY: number, out: THREE.Vector3): boolean;
  goTo(stage: Stage): void;
  /** The flower currently on the nail, if there is one. */
  activeFlower(): FlowerBuilder | null;
  setActiveFlower(f: FlowerBuilder | null): void;
  /** Flowers already resting on the cake. */
  placedFlowers(): FlowerBuilder[];
  addPlacedFlower(f: FlowerBuilder): void;
  restart(seat?: 'petal' | 'leaf'): void;
}

export interface StageBehaviour {
  enter(): void;
  exit(): void;
  update(dt: number): void;
  onDown?(f: PointerFrame): void;
  onMove?(f: PointerFrame): void;
  onUp?(f: PointerFrame, cancelled: boolean): void;
  onChoice?(id: string): void;
  choices(): ChoiceButton[];
}
