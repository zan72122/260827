import * as THREE from 'three';

export type Lighting = {
  sun: THREE.DirectionalLight;
  fill: THREE.HemisphereLight;
  bounce: THREE.DirectionalLight;
  group: THREE.Group;
};

/**
 * One big window on the left, plus the weak bounce a small room gives back.
 * No fog: a workshop a couple of metres deep has none.
 */
export function buildLighting(shadows: boolean, shadowSize: number): Lighting {
  const group = new THREE.Group();

  const sun = new THREE.DirectionalLight(0xfff1dc, 3.1);
  sun.position.set(-0.92, 0.78, -0.42);
  sun.target.position.set(0, 0.15, 0);
  sun.castShadow = shadows;
  if (shadows) {
    sun.shadow.mapSize.set(shadowSize, shadowSize);
    const c = sun.shadow.camera;
    c.left = -0.34;
    c.right = 0.34;
    c.top = 0.46;
    c.bottom = -0.14;
    c.near = 0.05;
    c.far = 2.4;
    sun.shadow.bias = -0.00035;
    sun.shadow.normalBias = 0.0016;
  }
  group.add(sun, sun.target);

  // light bouncing back off the near wall and the worktop
  const bounce = new THREE.DirectionalLight(0xc4d2e2, 0.62);
  bounce.position.set(0.7, 0.22, 0.95);
  bounce.target.position.set(0, 0.14, 0);
  group.add(bounce, bounce.target);

  const fill = new THREE.HemisphereLight(0xd2e0ee, 0x74604a, 0.55);
  group.add(fill);

  return { sun, fill, bounce, group };
}
