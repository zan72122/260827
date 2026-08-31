import * as THREE from 'three';

export interface CreamMaterialOptions {
  /** micro-bubble normal detail amplitude */
  bubble: number;
  /** enable the post-piping settle morph (finished strokes only) */
  settle: boolean;
}

/**
 * Whipped cream, not plastic: a warm off-white dielectric with a broad sheen
 * lobe, a short forward-scatter term for the airy body, and high-frequency
 * bubble detail. No mirror reflection, no strong transmission.
 */
export class CreamMaterial extends THREE.MeshPhysicalMaterial {
  readonly uTime = { value: 0 };
  private uBubble: { value: number };
  private uSettle: { value: number };

  constructor(opts: CreamMaterialOptions) {
    super({
      color: new THREE.Color(0.947, 0.928, 0.893),
      roughness: 0.55,
      metalness: 0,
      sheen: 0.55,
      sheenRoughness: 0.85,
      sheenColor: new THREE.Color(1.0, 0.965, 0.925),
      clearcoat: 0.1,
      clearcoatRoughness: 0.72,
      specularIntensity: 0.35,
      vertexColors: true,
      side: THREE.FrontSide,
      flatShading: false,
    });
    this.uBubble = { value: opts.bubble };
    this.uSettle = { value: opts.settle ? 1 : 0 };

    this.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uTime;
      shader.uniforms.uBubble = this.uBubble;
      shader.uniforms.uSettleOn = this.uSettle;

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uTime;
          uniform float uSettleOn;
          #ifdef USE_SETTLE
            attribute vec3 aRelaxed;
            attribute float aSettle;
          #endif
          varying vec3 vCreamWorld;
          varying float vCreamUp;`,
        )
        .replace(
          '#include <begin_vertex>',
          `vec3 transformed = vec3( position );
          #ifdef USE_SETTLE
            float sK = smoothstep( 0.0, 3.4, uTime - aSettle ) * uSettleOn;
            transformed = mix( transformed, aRelaxed, sK );
          #endif`,
        )
        .replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
          vCreamWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
          vCreamUp = normalize( mat3( modelMatrix ) * objectNormal ).y;`,
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uBubble;
          varying vec3 vCreamWorld;
          varying float vCreamUp;
          float creamHash( vec3 p ) {
            return fract( sin( dot( p, vec3( 27.13, 61.7, 91.3 ) ) ) * 43758.5453 );
          }
          float creamNoise( vec3 p ) {
            vec3 i = floor( p );
            vec3 f = fract( p );
            f = f * f * ( 3.0 - 2.0 * f );
            float n000 = creamHash( i );
            float n100 = creamHash( i + vec3( 1.0, 0.0, 0.0 ) );
            float n010 = creamHash( i + vec3( 0.0, 1.0, 0.0 ) );
            float n110 = creamHash( i + vec3( 1.0, 1.0, 0.0 ) );
            float n001 = creamHash( i + vec3( 0.0, 0.0, 1.0 ) );
            float n101 = creamHash( i + vec3( 1.0, 0.0, 1.0 ) );
            float n011 = creamHash( i + vec3( 0.0, 1.0, 1.0 ) );
            float n111 = creamHash( i + vec3( 1.0, 1.0, 1.0 ) );
            return mix(
              mix( mix( n000, n100, f.x ), mix( n010, n110, f.x ), f.y ),
              mix( mix( n001, n101, f.x ), mix( n011, n111, f.x ), f.y ),
              f.z );
          }`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          {
            vec3 q = vCreamWorld * 1150.0;
            float e = 0.85;
            float nx = creamNoise( q + vec3( e, 0.0, 0.0 ) ) - creamNoise( q - vec3( e, 0.0, 0.0 ) );
            float ny = creamNoise( q + vec3( 0.0, e, 0.0 ) ) - creamNoise( q - vec3( 0.0, e, 0.0 ) );
            float nz = creamNoise( q + vec3( 0.0, 0.0, e ) ) - creamNoise( q - vec3( 0.0, 0.0, e ) );
            normal = normalize( normal + vec3( nx, ny, nz ) * uBubble );
            float pores = creamNoise( vCreamWorld * 420.0 );
            roughnessFactor = clamp( roughnessFactor + ( pores - 0.5 ) * 0.13, 0.24, 0.92 );
          }`,
        )
        .replace(
          '#include <aomap_fragment>',
          `#include <aomap_fragment>
          {
            // short forward scatter — cream is airy, it glows a little at grazing angles
            float fres = pow( clamp( 1.0 - abs( dot( normal, geometryViewDir ) ), 0.0, 1.0 ), 2.4 );
            vec3 warm = vec3( 1.0, 0.947, 0.876 );
            reflectedLight.indirectDiffuse += warm * fres * 0.16 * diffuseColor.rgb;
            // upward faces keep the window's soft key, undersides stay readable
            reflectedLight.indirectDiffuse *= mix( 0.93, 1.06, clamp( vCreamUp * 0.5 + 0.5, 0.0, 1.0 ) );
          }`,
        );
    };
  }

  /** Enable the settle attributes on a finalised geometry's material clone. */
  enableSettle(): void {
    const self = this as unknown as { defines?: Record<string, string> };
    self.defines = { ...(self.defines ?? {}), USE_SETTLE: '' };
    this.uSettle.value = 1;
    this.needsUpdate = true;
  }

  setBubble(v: number): void {
    this.uBubble.value = v;
  }
}
