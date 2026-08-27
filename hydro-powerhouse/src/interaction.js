import * as THREE from '../vendor/three.module.min.js';

const RAYCAST_LAYER = 30;
const MIN_TARGET_PX = 64;
const DEFAULT_RADIUS = 0.3;
const IDLE_HINT_SECONDS = 3;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = (value) => Math.round(value * 100) / 100;

function viewportSize() {
  if (typeof window === 'undefined') return { width: 1, height: 1 };
  return {
    width: Math.max(1, window.innerWidth || document.documentElement?.clientWidth || 1),
    height: Math.max(1, window.innerHeight || document.documentElement?.clientHeight || 1),
  };
}

function stableJsonValue(value, depth = 0) {
  if (value == null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value.isVector2) return { x: round(value.x), y: round(value.y) };
  if (value.isVector3) return { x: round(value.x), y: round(value.y), z: round(value.z) };
  if (Array.isArray(value)) {
    if (depth > 3) return null;
    return value.map((item) => stableJsonValue(item, depth + 1));
  }
  if (typeof value === 'object' && depth <= 3) {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      const item = value[key];
      if (typeof item !== 'function' && typeof item !== 'undefined') {
        out[key] = stableJsonValue(item, depth + 1);
      }
    }
    return out;
  }
  return String(value);
}

function hintColor(action, destination = false) {
  if (destination) return 0x8fffd5;
  if (action === 'hold') return 0xffd36a;
  if (action === 'drag') return 0x6ee8ff;
  return 0xa8efff;
}

/**
 * Shared one-finger target manager for assembly and control phases.
 *
 * Proxies are real sphere meshes so Raycaster receives a forgiving volume,
 * but are never rendered.  The visible sprites are separate, cheap hints.
 */
export class SnapInteractionController {
  constructor({ scene, camera, glowTexture }) {
    if (!scene || !camera) {
      throw new TypeError('SnapInteractionController requires a scene and camera');
    }

    this.scene = scene;
    this.camera = camera;
    this.glowTexture = glowTexture || null;

    this._raycaster = new THREE.Raycaster();
    this._raycaster.layers.set(RAYCAST_LAYER);
    this._entries = [];
    this._proxies = [];

    this._proxyGeometry = new THREE.SphereGeometry(1, 12, 8);
    this._proxyMaterial = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      colorWrite: false,
    });

    this._proxyRoot = new THREE.Group();
    this._proxyRoot.name = 'interaction-raycast-proxies';
    this._proxyRoot.layers.set(RAYCAST_LAYER);
    this._hintRoot = new THREE.Group();
    this._hintRoot.name = 'interaction-hints';
    this.scene.add(this._proxyRoot, this._hintRoot);

    this._cameraPosition = new THREE.Vector3();
    this._cameraForward = new THREE.Vector3();
    this._cameraRight = new THREE.Vector3();
    this._cameraUp = new THREE.Vector3();
    this._offsetPoint = new THREE.Vector3();
    this._projected = new THREE.Vector3();
  }

  get size() {
    return this._entries.length;
  }

  setTargets(specs) {
    this.clear();
    if (!Array.isArray(specs)) return;

    for (let index = 0; index < specs.length; index += 1) {
      const spec = specs[index];
      if (!spec || !spec.position?.isVector3) {
        throw new TypeError(`Interaction target ${index} requires a THREE.Vector3 position`);
      }
      if (!['tap', 'drag', 'hold'].includes(spec.action)) {
        throw new TypeError(`Interaction target ${String(spec.id)} has an unsupported action`);
      }
      if (spec.action === 'drag' && !spec.dropPosition?.isVector3) {
        throw new TypeError(`Drag target ${String(spec.id)} requires a THREE.Vector3 dropPosition`);
      }

      const proxy = new THREE.Mesh(this._proxyGeometry, this._proxyMaterial);
      proxy.name = `interaction-proxy-${String(spec.id)}`;
      proxy.visible = false;
      proxy.frustumCulled = false;
      proxy.layers.set(RAYCAST_LAYER);

      const hint = this._makeHint(spec.action, false);
      const dropHint = spec.dropPosition ? this._makeHint(spec.action, true) : null;
      const entry = {
        spec,
        proxy,
        hint,
        dropHint,
        hitRadius: Math.max(DEFAULT_RADIUS, Number(spec.radius) || 0),
        phaseOffset: this._phaseOffset(spec.id, index),
      };
      proxy.userData.interactionEntry = entry;

      this._entries.push(entry);
      this._proxies.push(proxy);
      this._proxyRoot.add(proxy);
      this._hintRoot.add(hint);
      if (dropHint) this._hintRoot.add(dropHint);
      this._syncEntry(entry);
    }
  }

  clear() {
    for (const entry of this._entries) {
      this._proxyRoot.remove(entry.proxy);
      this._hintRoot.remove(entry.hint);
      entry.hint.material.dispose();
      if (entry.dropHint) {
        this._hintRoot.remove(entry.dropHint);
        entry.dropHint.material.dispose();
      }
      delete entry.proxy.userData.interactionEntry;
    }
    this._entries.length = 0;
    this._proxies.length = 0;
  }

  pick(ndc) {
    if (!this._entries.length) return null;
    this.camera.updateWorldMatrix(true, false);
    for (const entry of this._entries) this._syncEntry(entry);
    this._proxyRoot.updateMatrixWorld(true);
    this._raycaster.setFromCamera(ndc, this.camera);
    const hits = this._raycaster.intersectObjects(this._proxies, false);
    return hits.length ? hits[0].object.userData.interactionEntry.spec : null;
  }

  update(time, idleSeconds = 0) {
    const seconds = Number.isFinite(time) ? time : 0;
    const idle = Number.isFinite(idleSeconds) ? Math.max(0, idleSeconds) : 0;
    const idleAmount = clamp((idle - IDLE_HINT_SECONDS) / 2, 0, 1);

    for (const entry of this._entries) {
      this._syncEntry(entry);
      const wave = 0.5 + 0.5 * Math.sin(seconds * (3.1 + idleAmount) + entry.phaseOffset);
      const strength = 1 + idleAmount * 0.62;
      const baseScale = clamp(entry.hitRadius * 2.25, 0.34, 1.45);
      const scale = baseScale * (1 + wave * (0.12 + idleAmount * 0.16)) * strength;
      entry.hint.scale.setScalar(scale);
      entry.hint.material.opacity = clamp(0.24 + wave * 0.24 + idleAmount * 0.3, 0, 0.92);

      if (entry.dropHint) {
        const destinationWave = 0.5 + 0.5 * Math.sin(seconds * 3.35 + entry.phaseOffset + 1.2);
        entry.dropHint.scale.setScalar(scale * (0.82 + destinationWave * 0.12));
        entry.dropHint.material.opacity = clamp(
          0.2 + destinationWave * 0.22 + idleAmount * 0.28,
          0,
          0.86,
        );
      }
    }
  }

  screenTargets() {
    if (!this._entries.length) return [];
    this.camera.updateWorldMatrix(true, false);
    const viewport = viewportSize();

    return this._entries.map((entry) => {
      this._syncEntry(entry);
      const center = this._screenPoint(entry.spec.position, viewport);
      const rect = this._screenRect(entry.spec.position, entry.hitRadius, center, viewport);
      const drag = entry.spec.action === 'drag';
      const out = {
        id: String(entry.spec.id),
        phase: String(entry.spec.phase ?? ''),
        action: entry.spec.action,
        x: round(center.x),
        y: round(center.y),
        rect,
        drag,
        dropX: null,
        dropY: null,
        dropRect: null,
        holdMs: Math.max(0, Number(entry.spec.holdMs) || 0),
        direction: stableJsonValue(entry.spec.direction),
        destination: stableJsonValue(entry.spec.destination),
      };

      if (drag && entry.spec.dropPosition) {
        const dropCenter = this._screenPoint(entry.spec.dropPosition, viewport);
        out.dropX = round(dropCenter.x);
        out.dropY = round(dropCenter.y);
        out.dropRect = this._screenRect(
          entry.spec.dropPosition,
          entry.hitRadius,
          dropCenter,
          viewport,
        );
      }
      return out;
    });
  }

  _makeHint(action, destination) {
    const material = new THREE.SpriteMaterial({
      map: this.glowTexture,
      color: hintColor(action, destination),
      transparent: true,
      opacity: destination ? 0.24 : 0.3,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.name = destination ? 'interaction-drop-hint' : 'interaction-action-hint';
    sprite.renderOrder = 900;
    sprite.frustumCulled = false;
    return sprite;
  }

  _phaseOffset(id, index) {
    const text = `${String(id)}:${index}`;
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return ((hash >>> 0) % 6283) / 1000;
  }

  _syncEntry(entry) {
    const worldRadius = Math.max(
      DEFAULT_RADIUS,
      Number(entry.spec.radius) || 0,
      this._worldRadiusForPixels(entry.spec.position, MIN_TARGET_PX * 0.5),
    );
    entry.hitRadius = worldRadius;
    entry.proxy.position.copy(entry.spec.position);
    entry.proxy.scale.setScalar(worldRadius);
    entry.proxy.updateMatrix();
    entry.hint.position.copy(entry.spec.position);
    if (entry.dropHint && entry.spec.dropPosition) {
      entry.dropHint.position.copy(entry.spec.dropPosition);
    }
  }

  _worldRadiusForPixels(position, pixels) {
    const viewport = viewportSize();
    if (this.camera.isOrthographicCamera) {
      const visibleHeight = Math.abs(this.camera.top - this.camera.bottom) / this.camera.zoom;
      return (visibleHeight / viewport.height) * pixels;
    }
    if (!this.camera.isPerspectiveCamera) return 0;

    this.camera.getWorldPosition(this._cameraPosition);
    this.camera.getWorldDirection(this._cameraForward);
    const depth = Math.max(
      this.camera.near || 0.01,
      this._offsetPoint.copy(position).sub(this._cameraPosition).dot(this._cameraForward),
    );
    const visibleHeight = (
      2 * depth * Math.tan(THREE.MathUtils.degToRad(this.camera.fov * 0.5)) / this.camera.zoom
    );
    return (visibleHeight / viewport.height) * pixels;
  }

  _screenPoint(position, viewport) {
    this._projected.copy(position).project(this.camera);
    return {
      x: (this._projected.x * 0.5 + 0.5) * viewport.width,
      y: (-this._projected.y * 0.5 + 0.5) * viewport.height,
    };
  }

  _screenRect(position, radius, center, viewport) {
    this._cameraRight.setFromMatrixColumn(this.camera.matrixWorld, 0).normalize();
    this._cameraUp.setFromMatrixColumn(this.camera.matrixWorld, 1).normalize();

    const rightPoint = this._screenPoint(
      this._offsetPoint.copy(position).addScaledVector(this._cameraRight, radius),
      viewport,
    );
    const upPoint = this._screenPoint(
      this._offsetPoint.copy(position).addScaledVector(this._cameraUp, radius),
      viewport,
    );
    const halfWidth = Math.max(MIN_TARGET_PX * 0.5, Math.abs(rightPoint.x - center.x));
    const halfHeight = Math.max(MIN_TARGET_PX * 0.5, Math.abs(upPoint.y - center.y));
    const width = Math.ceil(halfWidth * 2);
    const height = Math.ceil(halfHeight * 2);
    const left = center.x - width * 0.5;
    const top = center.y - height * 0.5;

    return {
      x: round(left),
      y: round(top),
      left: round(left),
      top: round(top),
      right: round(left + width),
      bottom: round(top + height),
      width,
      height,
    };
  }
}
