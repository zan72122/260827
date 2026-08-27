// One-pointer, failure-free placement for the large parts of the satellite.
//
// SnapIntegration intentionally owns no DOM events. The game passes screen,
// normalized (0..1), or NDC (-1..1) points into gestureStart/Move/End. The
// active mesh may be positioned automatically, or a phase can take over the
// animation with updateAnimation().

import * as THREE from 'three';

const EPSILON = 1e-6;

const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));
const smoothstep = (value) => {
  const k = clamp01(value);
  return k * k * (3 - 2 * k);
};
const easeOutCubic = (value) => 1 - Math.pow(1 - clamp01(value), 3);

function vector3(value, fallback = null) {
  if (value == null) return fallback ? fallback.clone() : null;
  if (value.isVector3) return value.clone();
  if (Array.isArray(value)) return new THREE.Vector3(value[0] || 0, value[1] || 0, value[2] || 0);
  if (typeof value === 'object') return new THREE.Vector3(value.x || 0, value.y || 0, value.z || 0);
  return fallback ? fallback.clone() : null;
}

function quaternion(value, fallback = null) {
  if (value == null) return fallback ? fallback.clone() : null;
  if (value.isQuaternion) return value.clone();
  if (Array.isArray(value)) return new THREE.Quaternion(
    value[0] || 0,
    value[1] || 0,
    value[2] || 0,
    value[3] == null ? 1 : value[3],
  ).normalize();
  if (typeof value === 'object') return new THREE.Quaternion(
    value.x || 0,
    value.y || 0,
    value.z || 0,
    value.w == null ? 1 : value.w,
  ).normalize();
  return fallback ? fallback.clone() : null;
}

function point2(value, y) {
  if (typeof value === 'number') return { x: value, y: Number(y) || 0 };
  if (Array.isArray(value)) return { x: Number(value[0]) || 0, y: Number(value[1]) || 0 };
  return { x: Number(value?.x) || 0, y: Number(value?.y) || 0 };
}

function serialVector(value) {
  return value ? [value.x, value.y, value.z] : null;
}

/**
 * Reusable magnetic placement controller.
 *
 * Typical use:
 *
 *   const snap = new SnapIntegration({ camera, viewport: () => ({ width, height }) });
 *   snap.begin({
 *     id: 'payload-camera',
 *     object: payload,
 *     destination: socket.position,
 *     onComplete: nextPhase,
 *   });
 *   snap.gestureStart({ x: event.clientX, y: event.clientY });
 *   snap.gestureMove({ x: event.clientX, y: event.clientY });
 *   snap.gestureEnd({ x: event.clientX, y: event.clientY });
 *   snap.update(clock.elapsedTime);
 */
export class SnapIntegration {
  constructor({
    camera = null,
    viewport = { width: 1, height: 1 },
    inputSpace = 'screen',
    fingerOffsetPx = 48,
    idleAfter = 3.5,
    magneticThreshold = 0.72,
    releaseThreshold = 0.34,
    snapDuration = 0.34,
    minSwipePx = 84,
  } = {}) {
    this.camera = camera;
    this._viewportSource = viewport;
    this.inputSpace = inputSpace;

    this.defaults = {
      fingerOffsetPx,
      idleAfter,
      magneticThreshold,
      releaseThreshold,
      snapDuration,
      minSwipePx,
    };

    this._config = null;
    this._object = null;
    this._fromPosition = new THREE.Vector3();
    this._toPosition = new THREE.Vector3();
    this._fromQuaternion = new THREE.Quaternion();
    this._toQuaternion = new THREE.Quaternion();
    this._fromScale = new THREE.Vector3(1, 1, 1);
    this._toScale = new THREE.Vector3(1, 1, 1);
    this._workPosition = new THREE.Vector3();
    this._workQuaternion = new THREE.Quaternion();
    this._workScale = new THREE.Vector3();

    this._active = false;
    this._busy = false;
    this._complete = false;
    this._state = 'inactive';
    this._progress = 0;
    this._displayProgress = 0;
    this._gesture = null;
    this._snap = null;
    this._clock = 0;
    this._lastUpdateTime = null;
    this._lastInteraction = 0;
    this._timeAnchored = false;
    this._hintActive = false;
    this._lastReason = null;

    this._itemStats = this._freshItemStats();
    this._totals = this._freshTotals();
  }

  get active() { return this._active; }
  get busy() { return this._busy; }
  get complete() { return this._complete; }
  get progress() { return this._progress; }
  get displayProgress() { return this._displayProgress; }
  get hintActive() { return this._hintActive; }
  get state() { return this._state; }

  setCamera(camera) {
    this.camera = camera;
    return this;
  }

  setViewport(viewportOrWidth, height) {
    this._viewportSource = typeof viewportOrWidth === 'number'
      ? { width: viewportOrWidth, height: Number(height) || 1 }
      : viewportOrWidth;
    return this;
  }

  /** Start one placement. Starting another safely retires the previous one. */
  begin(config = {}) {
    if (this._active || this._busy) this.cancel({ restore: false, reason: 'replaced' });

    const object = config.object || config.mesh || config.item || config.activeItem || null;
    const objectPosition = object?.position?.isVector3 ? object.position : new THREE.Vector3();
    const fromPosition = vector3(config.start ?? config.from, objectPosition);
    const toPosition = vector3(config.destination ?? config.to ?? config.targetPosition, null);
    const hasAnimationCallback = typeof config.updateAnimation === 'function'
      || typeof config.apply === 'function'
      || typeof config.onUpdate === 'function';

    if (!toPosition && !hasAnimationCallback) {
      throw new Error('SnapIntegration.begin requires destination/to or an update callback.');
    }

    this._config = config;
    this._object = object;
    this._fromPosition.copy(fromPosition || objectPosition);
    this._toPosition.copy(toPosition || this._fromPosition);

    const objectQuaternion = object?.quaternion?.isQuaternion ? object.quaternion : new THREE.Quaternion();
    this._fromQuaternion.copy(quaternion(config.startQuaternion, objectQuaternion));
    this._toQuaternion.copy(quaternion(config.destinationQuaternion ?? config.toQuaternion, this._fromQuaternion));

    const objectScale = object?.scale?.isVector3 ? object.scale : new THREE.Vector3(1, 1, 1);
    this._fromScale.copy(vector3(config.startScale, objectScale));
    this._toScale.copy(vector3(config.destinationScale ?? config.toScale, this._fromScale));

    this._active = true;
    this._busy = false;
    this._complete = false;
    this._state = 'ready';
    this._progress = clamp01(config.initialProgress || 0);
    this._displayProgress = this._progress;
    this._gesture = null;
    this._snap = null;
    this._hintActive = false;
    this._lastReason = 'begin';
    this._lastInteraction = this._clock;
    this._timeAnchored = this._lastUpdateTime !== null;
    this._itemStats = this._freshItemStats();
    this._totals.begun += 1;

    this._apply(this._displayProgress, 'begin');
    config.onBegin?.(this._payload('begin'));
    return this.target();
  }

  /**
   * Begin a broad one-finger gesture. By default the whole viewport is a valid
   * grab area; UI controls should be filtered by the caller before forwarding.
   */
  gestureStart(point, options = {}) {
    if (!this._active || this._busy) return false;
    const screen = this._toScreen(point, options.space);
    const route = this._screenRoute();
    const direction = this._dragDirection(route);
    const requiredDistance = this._requiredSwipeDistance(route);

    this._gesture = {
      start: screen,
      previous: screen,
      current: screen,
      baseProgress: this._progress,
      direction,
      requiredDistance,
      travelled: 0,
      peakAlong: 0,
    };
    this._state = 'dragging';
    this._itemStats.pointerStarts += 1;
    this._totals.pointerStarts += 1;
    this._noteInteraction(options.time);
    this._config.onGrab?.(this._payload('grab', { screen }));
    return true;
  }

  gestureMove(point, options = {}) {
    if (!this._active || this._busy || !this._gesture) return false;
    const screen = this._toScreen(point, options.space);
    const gesture = this._gesture;
    const stepX = screen.x - gesture.previous.x;
    const stepY = screen.y - gesture.previous.y;
    gesture.travelled += Math.hypot(stepX, stepY);
    gesture.previous = screen;
    gesture.current = screen;

    // Cross-axis drift is deliberately ignored. Only helpful motion along the
    // large destination direction counts, and progress never moves backwards.
    const deltaX = screen.x - gesture.start.x;
    const deltaY = screen.y - gesture.start.y;
    const along = deltaX * gesture.direction.x + deltaY * gesture.direction.y;
    gesture.peakAlong = Math.max(gesture.peakAlong, along);
    const candidate = gesture.baseProgress + Math.max(0, gesture.peakAlong) / gesture.requiredDistance;
    this._setProgress(Math.max(this._progress, candidate), 'drag');
    this._noteInteraction(options.time);

    if (this._progress >= this._option('magneticThreshold')) {
      this._itemStats.drags += 1;
      this._totals.drags += 1;
      this._itemStats.magneticSnaps += 1;
      this._totals.magneticSnaps += 1;
      this._startSnap('magnet');
    }
    return true;
  }

  gestureEnd(point = null, options = {}) {
    if (!this._active || this._busy || !this._gesture) return false;
    if (point != null) this.gestureMove(point, options);
    if (!this._gesture || this._busy) return true; // gestureMove may magnet-snap

    const gesture = this._gesture;
    this._gesture = null;
    this._itemStats.drags += 1;
    this._totals.drags += 1;
    this._noteInteraction(options.time);

    const releaseThreshold = this._option('releaseThreshold');
    const helpfulFling = gesture.peakAlong >= Math.min(56, gesture.requiredDistance * 0.22);
    if (this._progress >= releaseThreshold || helpfulFling || options.forceSnap) {
      this._itemStats.releaseSnaps += 1;
      this._totals.releaseSnaps += 1;
      this._startSnap('release');
    } else {
      // No rejection and no return-to-start: a short swipe banks its progress.
      // The next swipe or the tap fallback continues from this point.
      this._state = 'ready';
      this._config.onRelease?.(this._payload('release', { retained: true }));
    }
    return true;
  }

  /** Any forwarded tap completes the current large-part placement. */
  handleTap(point = null, options = {}) {
    if (!this._active || this._busy || this._config.tapFallback === false) return false;
    const screen = point == null ? null : this._toScreen(point, options.space);
    this._itemStats.taps += 1;
    this._totals.taps += 1;
    this._noteInteraction(options.time);
    this._config.onTap?.(this._payload('tap', { screen }));
    this._itemStats.tapSnaps += 1;
    this._totals.tapSnaps += 1;
    this._startSnap('tap');
    return true;
  }

  // Friendly aliases for main loops that use pointer terminology.
  pointerDown(point, options) { return this.gestureStart(point, options); }
  pointerMove(point, options) { return this.gestureMove(point, options); }
  pointerUp(point, options) { return this.gestureEnd(point, options); }
  tap(point, options) { return this.handleTap(point, options); }

  /** Complete a whole synthetic swipe without making the caller manage state. */
  swipe(from, to, options = {}) {
    if (!this.gestureStart(from, options)) return false;
    this.gestureMove(to, options);
    if (this._gesture) this.gestureEnd(to, options);
    return true;
  }

  handleGesture(type, point, options = {}) {
    if (type === 'start' || type === 'down' || type === 'pointerdown') return this.gestureStart(point, options);
    if (type === 'move' || type === 'drag' || type === 'pointermove') return this.gestureMove(point, options);
    if (type === 'end' || type === 'up' || type === 'pointerup') return this.gestureEnd(point, options);
    if (type === 'tap') return this.handleTap(point, options);
    return false;
  }

  /** Deterministic helpers for callers that already store UV or NDC input. */
  normalizedStart(x, y, options = {}) { return this.gestureStart({ x, y }, { ...options, space: 'normalized' }); }
  normalizedMove(x, y, options = {}) { return this.gestureMove({ x, y }, { ...options, space: 'normalized' }); }
  normalizedEnd(x, y, options = {}) { return this.gestureEnd({ x, y }, { ...options, space: 'normalized' }); }
  ndcStart(x, y, options = {}) { return this.gestureStart({ x, y }, { ...options, space: 'ndc' }); }
  ndcMove(x, y, options = {}) { return this.gestureMove({ x, y }, { ...options, space: 'ndc' }); }
  ndcEnd(x, y, options = {}) { return this.gestureEnd({ x, y }, { ...options, space: 'ndc' }); }

  /** Debug/autoplay hook. It still uses the normal magnetic completion path. */
  setProgress(progress, { snap = false, reason = 'external' } = {}) {
    if (!this._active || this._busy) return false;
    this._setProgress(progress, reason);
    if (snap || this._progress >= this._option('magneticThreshold')) this._startSnap(reason);
    return true;
  }

  /**
   * Advance with an absolute clock in seconds (the same convention as the old
   * The game loop may pass elapsed seconds; performance.now() milliseconds are
   * accepted as well.
   */
  update(timeSeconds) {
    let time = Number(timeSeconds);
    if (!Number.isFinite(time)) return;
    if (time > 10000) time /= 1000;

    let dt = 0;
    if (this._lastUpdateTime !== null && time >= this._lastUpdateTime) {
      dt = Math.min(0.1, time - this._lastUpdateTime);
    }
    this._lastUpdateTime = time;
    this._clock = time;
    if (!this._timeAnchored) {
      this._lastInteraction = time;
      this._timeAnchored = true;
    }
    this._advance(dt);
  }

  /** Delta-time alternative for isolated tests and fixed-step animation. */
  tick(deltaSeconds) {
    const dt = Math.max(0, Math.min(0.1, Number(deltaSeconds) || 0));
    this._clock += dt;
    this._lastUpdateTime = this._clock;
    this._timeAnchored = true;
    this._advance(dt);
  }

  /** Finish immediately, useful when a phase is skipped by a debug tool. */
  completeNow(reason = 'debug') {
    if (!this._active && !this._busy) return false;
    this._progress = 1;
    this._displayProgress = 1;
    this._finish(reason);
    return true;
  }

  cancel({ restore = false, reason = 'cancelled' } = {}) {
    if (!this._config) return false;
    if (restore) {
      this._progress = 0;
      this._displayProgress = 0;
      this._apply(0, reason);
    }
    const payload = this._payload(reason);
    this._config.onCancel?.(payload);
    this._active = false;
    this._busy = false;
    this._gesture = null;
    this._snap = null;
    this._state = 'inactive';
    this._hintActive = false;
    this._config = null;
    this._object = null;
    return true;
  }

  end(options) { return this.cancel(options); }
  dispose() { this.cancel({ restore: false, reason: 'dispose' }); }

  /**
   * Current screen-space automation target. `x/y -> toX/toY` is a complete
   * playable drag, while tapX/tapY is the failure-free tap fallback.
   */
  target() {
    if (!this._active || !this._config) return null;
    const route = this._screenRoute();
    const offset = this._fingerOffset();
    const currentVisual = {
      x: route.start.x + (route.end.x - route.start.x) * this._displayProgress,
      y: route.start.y + (route.end.y - route.start.y) * this._displayProgress,
    };
    // visual = finger + offset, so the reported touch point is below the part.
    const from = { x: currentVisual.x - offset.x, y: currentVisual.y - offset.y };
    const to = { x: route.end.x - offset.x, y: route.end.y - offset.y };
    const viewport = this._viewport();
    const radius = Number(this._config.activationRadiusPx)
      || Math.max(52, Math.min(viewport.width, viewport.height) * 0.11);

    return {
      id: this._config.id || this._object?.name || 'satellite-part',
      type: 'snapIntegration',
      action: 'drag-or-tap',
      x: from.x,
      y: from.y,
      fromX: from.x,
      fromY: from.y,
      toX: to.x,
      toY: to.y,
      tapX: from.x,
      tapY: from.y,
      normalized: {
        x: from.x / viewport.width,
        y: from.y / viewport.height,
        toX: to.x / viewport.width,
        toY: to.y / viewport.height,
      },
      drag: { from, to, space: 'screen', durationMs: this._config.autoplayDurationMs || 620 },
      fingerOffset: offset,
      radius,
      progress: this._progress,
      displayProgress: this._displayProgress,
      magneticThreshold: this._option('magneticThreshold'),
      hint: this._hintActive,
      tapFallback: this._config.tapFallback !== false,
    };
  }

  targets() {
    const current = this.target();
    return current ? [current] : [];
  }

  stats() {
    const idleSeconds = this._active ? Math.max(0, this._clock - this._lastInteraction) : 0;
    return {
      id: this._config?.id || this._object?.name || null,
      active: this._active,
      busy: this._busy,
      complete: this._complete,
      state: this._state,
      progress: this._progress,
      displayProgress: this._displayProgress,
      gestureActive: Boolean(this._gesture),
      hintActive: this._hintActive,
      idleSeconds,
      lastReason: this._lastReason,
      start: serialVector(this._config ? this._fromPosition : null),
      destination: serialVector(this._config ? this._toPosition : null),
      item: { ...this._itemStats },
      totals: { ...this._totals },
    };
  }

  _freshItemStats() {
    return {
      pointerStarts: 0,
      drags: 0,
      taps: 0,
      snaps: 0,
      magneticSnaps: 0,
      releaseSnaps: 0,
      tapSnaps: 0,
      idleHints: 0,
    };
  }

  _freshTotals() {
    return {
      begun: 0,
      completed: 0,
      pointerStarts: 0,
      drags: 0,
      taps: 0,
      snaps: 0,
      magneticSnaps: 0,
      releaseSnaps: 0,
      tapSnaps: 0,
      idleHints: 0,
    };
  }

  _option(name) {
    return this._config?.[name] ?? this.defaults[name];
  }

  _viewport() {
    const raw = typeof this._viewportSource === 'function'
      ? this._viewportSource()
      : this._viewportSource;
    return {
      width: Math.max(1, Number(raw?.width) || 1),
      height: Math.max(1, Number(raw?.height) || 1),
    };
  }

  _toScreen(value, explicitSpace) {
    const point = point2(value);
    const viewport = this._viewport();
    const space = explicitSpace || value?.space || this.inputSpace;
    if (space === 'normalized' || space === 'uv') {
      return { x: point.x * viewport.width, y: point.y * viewport.height };
    }
    if (space === 'ndc') {
      return {
        x: (point.x * 0.5 + 0.5) * viewport.width,
        y: (-point.y * 0.5 + 0.5) * viewport.height,
      };
    }
    return point;
  }

  _fingerOffset() {
    let raw = this._config?.fingerOffsetPx ?? this.defaults.fingerOffsetPx;
    if (typeof raw === 'function') raw = raw(this._viewport(), this.stats());
    if (typeof raw === 'number') return { x: 0, y: -Math.abs(raw) };
    return {
      x: Number.isFinite(Number(raw?.x)) ? Number(raw.x) : 0,
      y: Number.isFinite(Number(raw?.y)) ? Number(raw.y) : -48,
    };
  }

  _project(position) {
    const viewport = this._viewport();
    if (!this.camera) return { x: viewport.width * 0.5, y: viewport.height * 0.5 };
    const ndc = position.clone().project(this.camera);
    return {
      x: (ndc.x * 0.5 + 0.5) * viewport.width,
      y: (-ndc.y * 0.5 + 0.5) * viewport.height,
    };
  }

  _screenRoute() {
    const startSource = typeof this._config.screenStart === 'function'
      ? this._config.screenStart(this._viewport())
      : this._config.screenStart;
    const endSource = typeof this._config.screenDestination === 'function'
      ? this._config.screenDestination(this._viewport())
      : (this._config.screenDestination ?? this._config.screenEnd);
    const space = this._config.screenSpace || 'screen';
    const start = startSource != null
      ? this._toScreen(startSource, startSource.space || space)
      : this._project(this._fromPosition);
    const end = endSource != null
      ? this._toScreen(endSource, endSource.space || space)
      : this._project(this._toPosition);
    return { start, end };
  }

  _dragDirection(route) {
    let raw = this._config.swipeDirection ?? this._config.dragDirection;
    if (typeof raw === 'function') raw = raw(route, this._viewport());
    if (typeof raw === 'string') {
      const named = {
        left: { x: -1, y: 0 },
        right: { x: 1, y: 0 },
        up: { x: 0, y: -1 },
        down: { x: 0, y: 1 },
      };
      raw = named[raw];
    }
    const candidate = raw ? point2(raw) : {
      x: route.end.x - route.start.x,
      y: route.end.y - route.start.y,
    };
    const length = Math.hypot(candidate.x, candidate.y);
    return length > EPSILON
      ? { x: candidate.x / length, y: candidate.y / length }
      : { x: 0, y: -1 };
  }

  _requiredSwipeDistance(route) {
    const configured = Number(this._config.swipeDistancePx);
    if (configured > 0) return configured;
    const viewport = this._viewport();
    const routeLength = Math.hypot(route.end.x - route.start.x, route.end.y - route.start.y);
    const shortSide = Math.min(viewport.width, viewport.height);
    return Math.max(
      Number(this._option('minSwipePx')) || 84,
      Math.min(Math.max(routeLength * 0.62, shortSide * 0.24), shortSide * 0.62),
    );
  }

  _setProgress(progress, reason) {
    const next = clamp01(progress);
    if (next <= this._progress && reason === 'drag') return;
    this._progress = next;
    this._displayProgress = next;
    this._lastReason = reason;
    this._apply(next, reason);
    this._config.onProgress?.(this._payload(reason));
  }

  _startSnap(reason) {
    if (!this._active || this._busy) return;
    this._gesture = null;
    this._busy = true;
    this._state = 'snapping';
    this._lastReason = reason;
    this._progress = 1;
    const remaining = 1 - this._displayProgress;
    const duration = Math.max(0.12, Number(this._option('snapDuration')) * Math.max(0.45, remaining));
    this._snap = { from: this._displayProgress, elapsed: 0, duration, reason };
    this._itemStats.snaps += 1;
    this._totals.snaps += 1;
    this._setHint(false);
    this._config.onSnapStart?.(this._payload(reason));

    if (this._config.reducedMotion || duration <= EPSILON) this.completeNow(reason);
  }

  _advance(dt) {
    if (this._snap) {
      this._snap.elapsed += dt;
      const k = clamp01(this._snap.elapsed / this._snap.duration);
      this._displayProgress = this._snap.from + (1 - this._snap.from) * easeOutCubic(k);
      this._apply(this._displayProgress, this._snap.reason);
      if (k >= 1) this._finish(this._snap.reason);
      return;
    }

    if (!this._active) return;
    const idleSeconds = Math.max(0, this._clock - this._lastInteraction);
    const shouldHint = !this._gesture && idleSeconds >= Number(this._option('idleAfter'));
    this._setHint(shouldHint);
    if (shouldHint && this._config.onHint) {
      const strength = 0.55 + 0.45 * Math.sin(this._clock * 4.2);
      this._config.onHint(this._payload('hint', {
        active: true,
        strength,
        idleSeconds,
        target: this.target(),
      }));
    }
  }

  _setHint(active) {
    if (this._hintActive === active) return;
    this._hintActive = active;
    if (active) {
      this._itemStats.idleHints += 1;
      this._totals.idleHints += 1;
    }
    this._config?.onHintChange?.(this._payload('hint-change', { active }));
  }

  _apply(progress, reason) {
    if (!this._config) return;
    const pathProgress = this._config.pathEasing === 'smoothstep' ? smoothstep(progress) : progress;
    this._workPosition.lerpVectors(this._fromPosition, this._toPosition, pathProgress);

    const arc = this._config.arc ?? this._config.arcHeight ?? 0;
    if (typeof arc === 'number' && arc !== 0) {
      this._workPosition.y += Math.sin(Math.PI * pathProgress) * arc;
    } else if (arc && typeof arc === 'object') {
      const arcVector = vector3(arc, null);
      if (arcVector) this._workPosition.addScaledVector(arcVector, Math.sin(Math.PI * pathProgress));
    }

    this._workQuaternion.copy(this._fromQuaternion).slerp(this._toQuaternion, pathProgress);
    this._workScale.lerpVectors(this._fromScale, this._toScale, pathProgress);

    let pathResult = null;
    if (typeof this._config.path === 'function') {
      pathResult = this._config.path(pathProgress, {
        position: this._workPosition,
        quaternion: this._workQuaternion,
        scale: this._workScale,
        from: this._fromPosition,
        destination: this._toPosition,
      });
      if (pathResult?.isVector3) this._workPosition.copy(pathResult);
      else if (pathResult) {
        const pathPosition = vector3(pathResult.position, null);
        const pathQuaternion = quaternion(pathResult.quaternion, null);
        const pathScale = vector3(pathResult.scale, null);
        if (pathPosition) this._workPosition.copy(pathPosition);
        if (pathQuaternion) this._workQuaternion.copy(pathQuaternion);
        if (pathScale) this._workScale.copy(pathScale);
      }
    }

    if (this._object && this._config.autoPosition !== false) {
      this._object.position?.copy?.(this._workPosition);
      this._object.quaternion?.copy?.(this._workQuaternion);
      this._object.scale?.copy?.(this._workScale);
      this._object.updateMatrixWorld?.();
    }

    const payload = this._payload(reason, {
      pathProgress,
      position: this._workPosition,
      quaternion: this._workQuaternion,
      scale: this._workScale,
      pathResult,
    });
    this._config.updateAnimation?.(payload);
    this._config.apply?.(payload);
    this._config.onUpdate?.(payload);
  }

  _finish(reason) {
    if (!this._config) return;
    const config = this._config;
    this._snap = null;
    this._gesture = null;
    this._progress = 1;
    this._displayProgress = 1;
    this._apply(1, reason);
    this._active = false;
    this._busy = false;
    this._complete = true;
    this._state = 'complete';
    this._hintActive = false;
    this._lastReason = reason;
    this._totals.completed += 1;
    const payload = this._payload(reason);
    config.onSnap?.(payload);
    config.onComplete?.(payload);
    if (config.onDone && config.onDone !== config.onComplete) config.onDone(payload);
  }

  _noteInteraction(timeValue) {
    let time = Number(timeValue);
    if (Number.isFinite(time)) {
      if (time > 10000) time /= 1000;
      this._clock = Math.max(this._clock, time);
      this._lastUpdateTime = this._lastUpdateTime === null ? time : Math.max(this._lastUpdateTime, time);
      this._timeAnchored = true;
    }
    this._lastInteraction = this._clock;
    this._setHint(false);
  }

  _payload(reason, extra = {}) {
    return {
      controller: this,
      id: this._config?.id || this._object?.name || 'satellite-part',
      object: this._object,
      state: this._state,
      reason,
      progress: this._progress,
      displayProgress: this._displayProgress,
      ...extra,
    };
  }
}

export default SnapIntegration;
