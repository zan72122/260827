import * as THREE from 'three';
import {
  blobShadowTexture,
  concreteSurface,
  groundSurface,
  paintedSteelSurface,
  rubberSurface,
  scuffedSteelSurface,
  type SurfaceSet,
} from './textures';
import type { QualitySettings } from './renderer';

const cache = new Map<string, THREE.Material>();

function build(key: string, make: () => THREE.Material): THREE.Material {
  const hit = cache.get(key);
  if (hit) return hit;
  const m = make();
  cache.set(key, m);
  return m;
}

function fromSurface(s: SurfaceSet, opts: Partial<THREE.MeshStandardMaterialParameters>, repeat: number) {
  const map = s.map.clone();
  const nrm = s.normalMap.clone();
  const rgh = s.roughnessMap.clone();
  for (const t of [map, nrm, rgh]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.needsUpdate = true;
  }
  return new THREE.MeshStandardMaterial({
    map,
    normalMap: nrm,
    roughnessMap: rgh,
    metalness: 0,
    roughness: 1,
    ...opts,
  });
}

export interface WorldMaterials {
  paintGreen: THREE.Material;
  paintYellow: THREE.Material;
  paintRed: THREE.Material;
  paintPale: THREE.Material;
  steel: THREE.Material;
  steelDark: THREE.Material;
  rubber: THREE.Material;
  ground: THREE.Material;
  concrete: THREE.Material;
  glass: THREE.Material;
  cloth: THREE.Material;
  shadowBlob: THREE.Material;
}

export function worldMaterials(q: QualitySettings): WorldMaterials {
  const size = q.textureSize;
  return {
    paintGreen: build('pg' + size, () =>
      fromSurface(paintedSteelSurface(0x5c8064, size, 0.42), { metalness: 0.12, roughness: 0.52 }, 2),
    ),
    paintYellow: build('py' + size, () =>
      fromSurface(paintedSteelSurface(0xd6a52c, size, 0.5), { metalness: 0.1, roughness: 0.5 }, 2),
    ),
    paintRed: build('pr' + size, () =>
      fromSurface(paintedSteelSurface(0x9c4b38, size, 0.55), { metalness: 0.1, roughness: 0.58 }, 2),
    ),
    paintPale: build('pp' + size, () =>
      fromSurface(paintedSteelSurface(0x9aa39b, size, 0.6), { metalness: 0.08, roughness: 0.72 }, 3),
    ),
    steel: build('st' + size, () =>
      fromSurface(scuffedSteelSurface(Math.min(256, size)), { metalness: 0.78, roughness: 0.42 }, 2),
    ),
    steelDark: build('sd' + size, () =>
      fromSurface(scuffedSteelSurface(Math.min(256, size)), { metalness: 0.55, roughness: 0.72, color: 0x8d9095 }, 3),
    ),
    rubber: build('ru' + size, () =>
      fromSurface(rubberSurface(Math.min(256, size)), { metalness: 0.02, roughness: 0.95 }, 3),
    ),
    ground: build('gr' + size, () => fromSurface(groundSurface(size), { metalness: 0, roughness: 1 }, 44)),
    concrete: build('cc' + size, () => fromSurface(concreteSurface(size), { metalness: 0, roughness: 0.92 }, 9)),
    glass: build('gl', () =>
      new THREE.MeshStandardMaterial({
        color: 0xa8bcc4,
        metalness: 0.1,
        roughness: 0.12,
        transparent: true,
        opacity: 0.32,
      }),
    ),
    cloth: build('cl', () => new THREE.MeshStandardMaterial({ color: 0x2b3138, roughness: 0.95, metalness: 0 })),
    shadowBlob: build('sb', () =>
      new THREE.MeshBasicMaterial({
        map: blobShadowTexture(128),
        transparent: true,
        depthWrite: false,
        opacity: 0.7,
      }),
    ),
  };
}

/** Cheap contact shadow that grounds an object without another shadow map pass. */
export function makeBlobShadow(mat: THREE.Material, radius: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.012;
  m.renderOrder = 1;
  return m;
}

export function disposeMaterialCache(): void {
  for (const m of cache.values()) m.dispose();
  cache.clear();
}
