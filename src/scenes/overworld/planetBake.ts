import * as THREE from 'three';
import type { Planet, PlanetStyle } from '@/types/content';

/**
 * Bakes each planet's procedural surface once into two equirect maps laid
 * out like SphereGeometry uvs, so runtime shading is a couple of texture
 * fetches instead of domain-warped fbm, craters and cells per pixel.
 *   surface (full res): sqrt(albedo).rgb, ocean specular mask or lava crack
 *   detail (half res):  object-space bumped normal (0..1), cloud density
 * Lighting stays fully dynamic. Maps are cached per renderer for the app lifetime.
 */

export const STYLE_INDEX: Record<PlanetStyle, number> = {
  oceanic: 0,
  rocky: 1,
  'gas-giant': 2,
  forested: 3,
  molten: 4,
};
const BUMP: Record<PlanetStyle, number> = { oceanic: 0.03, rocky: 0.07, 'gas-giant': 0, forested: 0.03, molten: 0.05 };

export const NOISE_GLSL = /* glsl */ `
  // Loop bounds go through uLoop (always 1) so Direct3D's shader compiler, which Chrome uses on
  // Windows, cannot unroll them: unrolled and inlined, these shaders take it most of a minute.
  uniform int uLoop;
  float sq(float x) { return x * x; }
  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }
  vec3 hash33(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.xxy + p.yxx) * p.zyx);
  }
  float noise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x),
          mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x),
          mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 6 * uLoop; i++) { v += a * noise(p); p = p * 2.02 + 11.7; a *= 0.5; }
    return v / 0.984;
  }
  float fbm3(vec3 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 3 * uLoop; i++) { v += a * noise(p); p = p * 2.03 + 5.3; a *= 0.5; }
    return v / 0.875;
  }
  vec3 warp(vec3 p) {
    return p + 1.4 * vec3(fbm3(p), fbm3(p + 5.2), fbm3(p + 9.7)) - 0.7;
  }
`;

const BAKE_VERTEX = /* glsl */ `
  out vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const BAKE_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform vec3 uA;
  uniform vec3 uB;
  uniform vec3 uC;
  // style and pass are compiled in (one small program each, see getBakeMaterial), not uniforms
  #define uStyle STYLE
  #define uPass PASS
  uniform float uSeed;
  uniform float uBump;
  uniform float uTexel;
  in vec2 vUv;
  layout(location = 0) out vec4 outColor;

  ${NOISE_GLSL}

  // Sum of crater profiles in a jittered 3D grid: bowl, raised rim
  float craters(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    float h = 0.0;
    for (int x = -uLoop; x <= uLoop; x++)
    for (int y = -uLoop; y <= uLoop; y++)
    for (int z = -uLoop; z <= uLoop; z++) {
      vec3 g = vec3(float(x), float(y), float(z));
      vec3 o = hash33(i + g);
      float r = 0.18 + 0.27 * o.z * o.z;
      float d = length(g + o - f) / r;
      float keep = step(0.45, hash13(i + g + 19.1));
      float bowl = d < 1.0 ? (d * d - 1.0) * 0.7 : 0.0;
      float rim = 0.3 * exp(-sq((d - 1.0) * 4.5));
      h += keep * (bowl + rim) * r * 2.0;
    }
    return h;
  }

  vec2 cells(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    float f1 = 8.0, f2 = 8.0;
    for (int x = -uLoop; x <= uLoop; x++)
    for (int y = -uLoop; y <= uLoop; y++)
    for (int z = -uLoop; z <= uLoop; z++) {
      vec3 g = vec3(float(x), float(y), float(z));
      float d = length(g + hash33(i + g) - f);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
    }
    return vec2(f1, f2);
  }

  // Wispy cloud density: sheared, stretched along latitude, thin streaks
  float cloudDensity(vec3 dir) {
    vec3 p = dir * vec3(2.0, 4.2, 2.0) + uSeed * 1.7;
    vec3 q = warp(p * 0.8) * vec3(1.0, 1.6, 1.0);
    float d = fbm(q * 1.3);
    float cover = uStyle == 3 ? 0.6 : 0.58;
    float c = smoothstep(cover, cover + 0.24, d);
    float streak = fbm3(vec3(dir.x * 10.0, dir.y * 36.0, dir.z * 10.0) + q * 0.8);
    c *= smoothstep(0.3, 0.8, streak);
    return c * 0.75;
  }

  // albedo, height, spec, extra
  void evalStyle(vec3 dir, out vec3 albedo, out float h, out float spec, out float extra) {
    vec3 sp = dir + vec3(uSeed, uSeed * 0.71, -uSeed * 1.3);
    h = 0.0; spec = 0.0; extra = 0.0;

    if (uStyle == 0 || uStyle == 3) {
      bool forest = uStyle == 3;
      float sea = forest ? 0.5 : 0.56;
      vec3 q = warp(sp * 1.5);
      float n = fbm(q * 1.2);
      float land = smoothstep(sea, sea + 0.015, n);
      float shallow = smoothstep(sea - 0.12, sea, n);
      vec3 deep = forest ? mix(uC, vec3(0.006, 0.02, 0.03), 0.5) : uC;
      vec3 ocean = mix(deep, mix(uA, uC, 0.35) * 0.8, shallow * 0.6);
      float alt = clamp((n - sea) / 0.25, 0.0, 1.0);
      float detail = fbm3(sp * 9.0);
      vec3 low = forest ? uA * 0.32 : mix(vec3(0.16, 0.13, 0.09), uA * 0.3, 0.3);
      vec3 mid = forest ? mix(uA * 0.5, vec3(0.2, 0.18, 0.11), 0.45) : vec3(0.27, 0.23, 0.17);
      vec3 high = vec3(0.24, 0.22, 0.2);
      vec3 ground = mix(low, mid, smoothstep(0.1, 0.5, alt + (detail - 0.5) * 0.3));
      ground = mix(ground, high, smoothstep(0.55, 0.9, alt));
      albedo = mix(ocean, ground, land);
      float ice = smoothstep(0.84, 0.9, abs(dir.y) + (fbm3(sp * 4.0) - 0.5) * 0.18);
      ice = max(ice, smoothstep(0.82, 0.95, alt) * land);
      albedo = mix(albedo, mix(vec3(0.56, 0.6, 0.64), uB, 0.12), ice);
      spec = (1.0 - land) * (1.0 - ice);
      h = land * (alt * 0.6 + detail * 0.15);
      extra = cloudDensity(dir);
    } else if (uStyle == 1) {
      vec3 q = warp(sp * 1.4);
      float n = fbm(q * 1.5);
      float cr = craters(dir * 3.5 + uSeed) * 0.55 + craters(dir * 8.0 + uSeed * 2.0) * 0.3;
      float fine = fbm3(sp * 14.0);
      albedo = mix(uC * 1.4, uA * 0.85, smoothstep(0.3, 0.7, n));
      albedo = mix(albedo, uB * 0.6, smoothstep(0.62, 0.85, n + (fine - 0.5) * 0.25) * 0.55);
      albedo *= 0.82 + 0.35 * smoothstep(-0.3, 0.15, cr) + (fine - 0.5) * 0.15;
      h = n * 0.5 + cr + fine * 0.04;
    } else if (uStyle == 2) {
      vec3 lp = dir;
      float flow = fbm(vec3(lp.x * 2.0, lp.y * 9.0, lp.z * 2.0) + uSeed);
      float y = lp.y + (flow - 0.5) * 0.09;
      y += (fbm3(vec3(lp.x * 5.0, lp.y * 26.0, lp.z * 5.0) + uSeed) - 0.5) * 0.025;
      vec3 sc = normalize(vec3(0.75, -0.32, 0.58));
      vec3 dv = (lp - sc) * vec3(1.0, 2.4, 1.0);
      float storm = exp(-dot(dv, dv) * 40.0);
      y += storm * 0.04 * sin(atan(dv.y, dv.x + dv.z) * 2.0);
      float b1 = 0.5 + 0.5 * sin(y * 21.0 + 0.6);
      float b2 = 0.5 + 0.5 * sin(y * 9.0 + 1.9);
      float zone = smoothstep(0.55, 0.95, 0.5 + 0.5 * sin(y * 13.0 + 0.4));
      albedo = mix(uC * 1.3, uA * 0.85, b1 * 0.7 + b2 * 0.3);
      albedo = mix(albedo, uB * 0.7, zone * 0.5);
      albedo *= 0.88 + 0.24 * fbm3(vec3(lp.x * 7.0, y * 60.0, lp.z * 7.0));
      albedo = mix(albedo, mix(uB * 0.85, vec3(0.75, 0.62, 0.58), 0.4), storm * 0.75);
    } else {
      vec3 q = warp(sp * 1.8);
      vec2 c1 = cells(q * 2.2);
      vec2 c2 = cells(q * 5.5 + 3.0);
      float plate = fbm(q * 2.0);
      float w1 = 0.035 + 0.045 * fbm3(sp * 6.0);
      float crack = 1.0 - smoothstep(0.0, w1, c1.y - c1.x);
      crack = max(crack, (1.0 - smoothstep(0.0, 0.03, c2.y - c2.x)) * 0.35);
      albedo = mix(vec3(0.035, 0.03, 0.028), uC * 0.9, plate);
      albedo = mix(albedo, uA * 0.32, smoothstep(0.6, 0.8, plate) * 0.5);
      albedo *= 1.0 - crack * 0.8;
      h = plate * 0.4 - crack * 0.35;
      extra = crack;
    }
    float l = dot(albedo, vec3(0.2126, 0.7152, 0.0722));
    albedo = mix(vec3(l), albedo, 0.84);
  }

  void main() {
    // Same parameterisation as THREE.SphereGeometry
    float phi = vUv.x * 6.28318530718;
    float theta = (1.0 - vUv.y) * 3.14159265359;
    vec3 dir = vec3(-cos(phi) * sin(theta), cos(theta), sin(phi) * sin(theta));

    vec3 albedo; float h, spec, extra;
    evalStyle(dir, albedo, h, spec, extra);

    // Pass 0: sqrt(albedo) + (ocean spec mask, or lava crack on molten). Fine lines stay at full res.
    if (uPass == 0) {
      outColor = vec4(sqrt(max(albedo, 0.0)), uStyle == 4 ? extra : spec);
      return;
    }

    // Pass 1 (half res): bumped object-space normal + cloud density
    vec3 n = dir;
    if (uBump > 0.0) {
      vec3 t = normalize(cross(abs(dir.y) > 0.995 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0), dir));
      vec3 b = cross(dir, t);
      float e = uTexel;
      vec3 a2; float s2, x2, hT, hB;
      evalStyle(normalize(dir + t * e), a2, hT, s2, x2);
      evalStyle(normalize(dir + b * e), a2, hB, s2, x2);
      vec3 grad = ((hT - h) * t + (hB - h) * b) / e;
      n = normalize(dir - grad * uBump);
    }
    outColor = vec4(n * 0.5 + 0.5, uStyle == 4 ? 0.0 : extra);
  }
`;

export interface PlanetMaps {
  surface: THREE.Texture;
  detail: THREE.Texture;
}

const cache = new WeakMap<THREE.WebGLRenderer, Map<string, PlanetMaps>>();
const bakeUniforms = {
  uA: { value: new THREE.Color() },
  uB: { value: new THREE.Color() },
  uC: { value: new THREE.Color() },
  uSeed: { value: 0 },
  uBump: { value: 0 },
  uTexel: { value: 0.004 },
  uLoop: { value: 1 },
};
const bakeMats = new Map<string, THREE.ShaderMaterial>();
const bakeQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
bakeQuad.frustumCulled = false;
const bakeScene = new THREE.Scene().add(bakeQuad);
const bakeCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

/**
 * One program per style and pass, with the others' code compiled out: a single program holding
 * all five styles, with the normal pass evaluating the surface three times, is several times
 * larger and takes Direct3D's compiler seconds on its own.
 */
const getBakeMaterial = (style: number, pass: number) => {
  const key = `${style}-${pass}`;
  let mat = bakeMats.get(key);
  if (!mat) {
    mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      defines: { STYLE: style, PASS: pass },
      uniforms: bakeUniforms,
      vertexShader: BAKE_VERTEX,
      fragmentShader: BAKE_FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });
    bakeMats.set(key, mat);
  }
  bakeQuad.material = mat;
  return bakeScene;
};

export const planetSeed = (id: string) => {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) * 0.0731;
};

/** Returns the baked maps for a planet, baking on first use. */
export const getPlanetMaps = (gl: THREE.WebGLRenderer, planet: Planet, lowRes: boolean): PlanetMaps => {
  let perGl = cache.get(gl);
  if (!perGl) cache.set(gl, (perGl = new Map()));
  const hit = perGl.get(planet.id);
  if (hit) return hit;

  // Full-res colour, half-res normals/clouds: about 8MB per planet on desktop with mips
  const w = lowRes ? 1024 : 1536;
  const target = (tw: number) =>
    new THREE.WebGLRenderTarget(tw, tw / 2, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      anisotropy: Math.min(8, gl.capabilities.getMaxAnisotropy()),
    });
  const rtSurface = target(w);
  const rtDetail = target(w / 2);

  const u = bakeUniforms;
  const style = STYLE_INDEX[planet.style];
  (u.uA.value as THREE.Color).set(planet.palette[0]);
  (u.uB.value as THREE.Color).set(planet.palette[1]);
  (u.uC.value as THREE.Color).set(planet.palette[2]);
  u.uSeed.value = planetSeed(planet.id);
  u.uBump.value = BUMP[planet.style];

  const prevTarget = gl.getRenderTarget();
  const prevAutoClear = gl.autoClear;
  gl.autoClear = true;
  u.uTexel.value = (Math.PI * 2) / w;
  gl.setRenderTarget(rtSurface);
  gl.render(getBakeMaterial(style, 0), bakeCam);
  u.uTexel.value = (Math.PI * 2) / (w / 2);
  gl.setRenderTarget(rtDetail);
  gl.render(getBakeMaterial(style, 1), bakeCam);
  gl.setRenderTarget(prevTarget);
  gl.autoClear = prevAutoClear;

  const maps = { surface: rtSurface.texture, detail: rtDetail.texture };
  perGl.set(planet.id, maps);
  return maps;
};
