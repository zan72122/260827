import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  Points,
  PlaneGeometry,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three'
import { LAKE_BED } from '../world'
import { COMMON_GLSL, U, hookMaterial, srgb } from './shaderlib'

/** the lake itself: surface, water body, bed and the snow suspended in it */
export function buildWater(tier = 1): { group: Group; surface: Mesh; snowMat: ShaderMaterial } {
  const group = new Group()

  // --- the water body seen from the side: colour of the medium at each depth
  const bodyMat = new ShaderMaterial({
    uniforms: { ...U },
    side: BackSide,
    depthWrite: true,
    vertexShader: /* glsl */ `
      varying vec3 vWorldPos;
      void main() {
        vec4 wp = modelMatrix * vec4( position, 1.0 );
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec3 vWorldPos;
      ${COMMON_GLSL}
      void main() {
        // the far wall of the medium: how dark it looks depends on how far down
        // the eye is looking, not on where this triangle happens to sit
        gl_FragColor = vec4( inscatter( vWorldPos ), 1.0 );
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  })
  const body = new Mesh(new SphereGeometry(22, 24, 16), bodyMat)
  body.renderOrder = -2
  group.add(body)

  const bedMat = new ShaderMaterial({
    uniforms: { ...U },
    vertexShader: /* glsl */ `
      varying vec3 vWorldPos;
      void main() {
        vec3 p = position;
        float h = sin( p.x * 0.55 ) * 0.16 + sin( p.z * 0.41 + 1.7 ) * 0.13 + sin( p.x * 1.3 + p.z * 0.9 ) * 0.05;
        p.y += h;
        vec4 wp = modelMatrix * vec4( p, 1.0 );
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec3 vWorldPos;
      ${COMMON_GLSL}
      void main() {
        float m = 0.5 + 0.5 * sin( vWorldPos.x * 3.1 ) * sin( vWorldPos.z * 2.7 );
        vec3 c = mix( vec3( 0.075, 0.070, 0.058 ), vec3( 0.115, 0.105, 0.086 ), m );
        gl_FragColor = vec4( applyWater( c, vWorldPos ), 1.0 );
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  })
  const bedGeo = new PlaneGeometry(34, 34, 48, 48)
  bedGeo.rotateX(-Math.PI / 2)
  const bed = new Mesh(bedGeo, bedMat)
  bed.position.y = LAKE_BED
  bed.renderOrder = -1
  group.add(bed)

  // a few rocks and a sunken branch so the bottom is a place, not a plane
  const rockMat = hookMaterial(
    new MeshStandardMaterial({ color: srgb(0x4a463c), roughness: 0.95, metalness: 0 }),
    { underwater: true }
  )
  for (let i = 0; i < 7; i++) {
    const a = i * 2.399
    const r = 1.2 + (i % 3) * 1.4
    const s = 0.16 + (i % 4) * 0.09
    const rock = new Mesh(new SphereGeometry(s, 7, 5), rockMat)
    rock.position.set(Math.cos(a) * r, LAKE_BED + s * 0.35, Math.sin(a) * r)
    rock.scale.set(1, 0.55 + (i % 3) * 0.12, 0.8 + (i % 2) * 0.3)
    rock.rotation.y = a
    group.add(rock)
  }

  // suspended snow: only readable inside the clear pocket, gives the column scale
  const N = tier > 1 ? 900 : 480
  const pts = new Float32Array(N * 3)
  const size = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    const a = Math.random() * Math.PI * 2
    const r = 0.25 + Math.pow(Math.random(), 0.6) * 2.6
    pts[i * 3] = Math.cos(a) * r
    pts[i * 3 + 1] = -0.08 - Math.random() * 3.4
    pts[i * 3 + 2] = Math.sin(a) * r
    size[i] = 0.0032 + Math.random() * 0.0055
  }
  const snowGeo = new BufferGeometry()
  snowGeo.setAttribute('position', new BufferAttribute(pts, 3))
  snowGeo.setAttribute('psize', new BufferAttribute(size, 1))
  const snowMat = new ShaderMaterial({
    uniforms: { ...U, uPxScale: { value: 380 } },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float psize;
      uniform float uTime;
      uniform float uPxScale;
      varying vec3 vWorldPos;
      varying float vFade;
      void main() {
        vec3 p = position;
        p.y += sin( uTime * 0.23 + p.x * 3.0 ) * 0.012;
        p.x += sin( uTime * 0.17 + p.z * 2.0 ) * 0.016;
        vec4 wp = modelMatrix * vec4( p, 1.0 );
        vWorldPos = wp.xyz;
        vec4 mv = viewMatrix * wp;
        gl_PointSize = psize * uPxScale / max( -mv.z, 0.1 );
        vFade = 1.0;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec3 vWorldPos;
      varying float vFade;
      ${COMMON_GLSL}
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float a = smoothstep( 0.5, 0.12, length( d ) );
        float p = clamp( pocket( vWorldPos ), 0.0, 1.0 );
        float k = mix( uMurkOut, uMurkIn, p );
        float f = exp( -k * waterPath( vWorldPos ) );
        vec3 att = exp( -vec3( 0.60, 0.30, 0.18 ) * clamp( uWaterY - vWorldPos.y, 0.0, 8.0 ) );
        gl_FragColor = vec4( vec3( 0.44, 0.47, 0.42 ) * att * f * vFade, a * 0.5 * f );
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  })
  const snow = new Points(snowGeo, snowMat)
  snow.renderOrder = 4
  group.add(snow)

  // --- the surface itself
  const surfMat = new ShaderMaterial({
    uniforms: {
      ...U,
      uLampPos: { value: new Vector3(-0.35, 1.7, -1.05) },
      uSurfaceBreak: { value: 0 },
    },
    transparent: true,
    depthWrite: true,
    side: DoubleSide,
    vertexShader: /* glsl */ `
      varying vec3 vWorldPos;
      void main() {
        vec4 wp = modelMatrix * vec4( position, 1.0 );
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uTime;
      uniform vec2 uRipple;
      uniform vec3 uLampPos;
      uniform vec3 uSun;
      uniform float uSurfaceBreak;
      varying vec3 vWorldPos;
      ${COMMON_GLSL}

      // one ring system spreading from where the line enters, plus the slow
      // swell the hull makes; nothing here is decorative
      vec3 surfaceNormal( vec2 p ) {
        vec2 d = p - uAxis;
        float r = max( length( d ), 1e-4 );
        float t = uRipple.y;
        float decay = exp( -r * 4.0 ) * exp( -t * 1.5 );
        float phase = r * 62.0 - t * 9.5;
        float dh = uRipple.x * 0.0026 * 62.0 * cos( phase ) * decay;
        vec2 grad = ( d / r ) * dh;
        // the rig never hangs perfectly still, so a faint ring always lives
        // where the line pierces the surface
        float amb = exp( -r * 6.5 );
        grad += ( d / r ) * amb * 0.055 * cos( r * 52.0 - uTime * 4.6 );
        // breaking fish right at the hole
        float br = uSurfaceBreak * exp( -r * 9.0 );
        grad += ( d / r ) * br * 0.06 * cos( r * 60.0 - uTime * 22.0 );
        // the chop the hull and the wind make; small, but it breaks the mirror
        grad.x += 0.0125 * sin( p.x * 6.1 + uTime * 0.85 ) + 0.0072 * sin( p.y * 4.4 - uTime * 0.55 )
          + 0.0042 * sin( p.x * 17.0 - p.y * 9.0 + uTime * 1.9 );
        grad.y += 0.0118 * cos( p.y * 5.6 - uTime * 0.75 ) + 0.0068 * cos( p.x * 3.9 + uTime * 0.48 )
          + 0.0039 * cos( p.y * 15.0 + p.x * 8.0 - uTime * 1.7 );
        return normalize( vec3( -grad.x, 1.0, -grad.y ) );
      }

      void main() {
        float cut = surfaceCut( vWorldPos );
        if ( cut > 0.985 ) discard;
        vec3 n = surfaceNormal( vWorldPos.xz );
        vec3 v = normalize( uCamPos - vWorldPos );
        if ( uCamPos.y < uWaterY ) {
          // seen from underneath: mostly a mirror of the dark water, with the
          // bright cone of sky straight overhead
          float ang = clamp( v.y, 0.0, 1.0 );
          vec3 snell = mix( waterTint( -0.25 ) * 0.9, vec3( 0.20, 0.225, 0.24 ), smoothstep( 0.72, 0.96, ang ) );
          gl_FragColor = vec4( snell, 1.0 - cut );
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          return;
        }
        float f = pow( clamp( 1.0 - max( dot( n, v ), 0.0 ), 0.0, 1.0 ), 4.0 );
        float fres = 0.021 + 0.979 * f;

        vec3 refl = reflect( -v, n );
        // inside the hull the water can only mirror the dark underside of the
        // deck; open sky reaches it beyond the boat and through the opening
        vec2 fr = axisFrame( vWorldPos.xz );
        float r = length( vWorldPos.xz - uAxis );
        float underBoat = 1.0 - smoothstep( 1.45, 2.15, fr.x );
        float openHole = exp( -r * 2.6 );
        float up = clamp( refl.y, 0.0, 1.0 );
        // what is actually overhead: dim cabin ceiling and a low grey sky
        vec3 cold = mix( vec3( 0.014, 0.018, 0.021 ), vec3( 0.072, 0.084, 0.094 ), pow( up, 0.55 ) );
        vec3 toLamp = normalize( uLampPos - vWorldPos );
        float lamp = pow( clamp( dot( refl, toLamp ), 0.0, 1.0 ), 46.0 );
        float win = pow( clamp( dot( refl, normalize( uSun ) ), 0.0, 1.0 ), 24.0 );
        // light that falls straight down through the opening; the ripple slope
        // turns it into rings without any of it being drawn as a ring
        float sheen = pow( clamp( refl.y * 0.5 + 0.5, 0.0, 1.0 ), 3.0 );
        vec3 reflected = cold * mix( 1.0, 0.14, underBoat )
          + vec3( 0.66, 0.69, 0.70 ) * openHole * sheen * 1.35
          + vec3( 1.0, 0.70, 0.40 ) * lamp * 5.0 * openHole
          + vec3( 0.80, 0.87, 0.95 ) * win * 0.55 * ( 1.0 - underBoat );

        vec3 through = inscatter( vWorldPos ) * 0.5;
        vec3 c = mix( through, reflected, clamp( fres * 2.2, 0.0, 1.0 ) );

        float alpha = 1.0 - cut;
        gl_FragColor = vec4( c, alpha );
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  })
  const surfGeo = new PlaneGeometry(56, 56, 2, 2)
  surfGeo.rotateX(-Math.PI / 2)
  const surface = new Mesh(surfGeo, surfMat)
  surface.renderOrder = 6
  group.add(surface)

  return { group, surface, snowMat }
}
