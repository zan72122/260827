/** Shared GLSL helpers injected into several materials. */
export const NOISE_GLSL = /* glsl */ `
float hash11(float p){ p = fract(p*0.1031); p *= p+33.33; p *= p+p; return fract(p); }
float hash13(vec3 p3){
  p3 = fract(p3*0.1031);
  p3 += dot(p3, p3.zyx+31.32);
  return fract((p3.x+p3.y)*p3.z);
}
float vnoise(vec3 x){
  vec3 i = floor(x); vec3 f = fract(x);
  f = f*f*(3.0-2.0*f);
  float n000 = hash13(i+vec3(0,0,0));
  float n100 = hash13(i+vec3(1,0,0));
  float n010 = hash13(i+vec3(0,1,0));
  float n110 = hash13(i+vec3(1,1,0));
  float n001 = hash13(i+vec3(0,0,1));
  float n101 = hash13(i+vec3(1,0,1));
  float n011 = hash13(i+vec3(0,1,1));
  float n111 = hash13(i+vec3(1,1,1));
  return mix(mix(mix(n000,n100,f.x), mix(n010,n110,f.x), f.y),
             mix(mix(n001,n101,f.x), mix(n011,n111,f.x), f.y), f.z);
}
float fbm3(vec3 p){
  float a = 0.5, s = 0.0;
  for(int i=0;i<4;i++){ s += a*vnoise(p); p *= 2.03; a *= 0.5; }
  return s;
}
`;
