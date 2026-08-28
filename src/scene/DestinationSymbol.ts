import * as THREE from 'three';
import type { DestinationId } from '../types';
import type { Rng } from '../core/rng';
import type { MaterialLibrary } from './materials';

export interface DestinationModule {
  id: DestinationId;
  /** where its lamp sits on the physical wall map, in 0..1 board space */
  mapUv: [number, number];
  /** muted paint accent used on the shelf placard, never a glow */
  accent: number;
  /** the small hand drawing that replaces a written address */
  drawPictogram(ctx: CanvasRenderingContext2D, w: number, h: number, rng: Rng, ink: string): void;
  /** the large solid symbol standing over the sorting chute */
  buildSymbol(mats: MaterialLibrary): THREE.Group;
}

const loaders = import.meta.glob('./destinations/*.ts') as Record<
  string,
  () => Promise<{ destination: DestinationModule }>
>;

const cache = new Map<DestinationId, DestinationModule>();
const inflight = new Map<DestinationId, Promise<DestinationModule>>();

/** Additional destinations are fetched only when a round actually needs them. */
export function loadDestination(id: DestinationId): Promise<DestinationModule> {
  const hit = cache.get(id);
  if (hit) return Promise.resolve(hit);
  const running = inflight.get(id);
  if (running) return running;

  const key = `./destinations/${id}.ts`;
  const loader = loaders[key];
  if (!loader) return Promise.reject(new Error(`unknown destination: ${id}`));

  const p = loader().then((mod) => {
    cache.set(id, mod.destination);
    inflight.delete(id);
    return mod.destination;
  });
  inflight.set(id, p);
  return p;
}

export function loadDestinations(ids: readonly DestinationId[]): Promise<DestinationModule[]> {
  return Promise.all(ids.map(loadDestination));
}

export function getLoadedDestination(id: DestinationId): DestinationModule {
  const hit = cache.get(id);
  if (!hit) throw new Error(`destination not loaded yet: ${id}`);
  return hit;
}

export function isDestinationLoaded(id: DestinationId): boolean {
  return cache.has(id);
}
