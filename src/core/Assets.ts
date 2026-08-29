import { LoadingManager, type Group, type WebGLRenderer } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

/**
 * Optional GLB pipeline.
 *
 * The shipped plaza is generated procedurally, so the build carries no
 * placeholder art. When a compressed authored asset is dropped into
 * `public/assets` (GLB with KTX2 textures and Meshopt-packed geometry) this
 * loader picks it up and the corresponding procedural build is skipped.
 */
export class AssetLibrary {
  private readonly gltf: GLTFLoader;
  private readonly cache = new Map<string, Promise<Group | null>>();

  constructor(renderer: WebGLRenderer) {
    const manager = new LoadingManager();
    const ktx2 = new KTX2Loader(manager)
      .setTranscoderPath('https://cdn.jsdelivr.net/npm/three/examples/jsm/libs/basis/')
      .detectSupport(renderer);
    this.gltf = new GLTFLoader(manager);
    this.gltf.setKTX2Loader(ktx2);
    this.gltf.setMeshoptDecoder(MeshoptDecoder);
  }

  /** Resolves to null when the asset is absent — the caller then builds it. */
  optional(url: string): Promise<Group | null> {
    let hit = this.cache.get(url);
    if (!hit) {
      hit = fetch(url, { method: 'HEAD' })
        .then((res) => (res.ok ? this.gltf.loadAsync(url).then((g) => g.scene) : null))
        .catch(() => null);
      this.cache.set(url, hit);
    }
    return hit;
  }
}
