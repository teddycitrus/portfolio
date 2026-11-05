import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Planet, PlanetStyle } from '@/types/content';
import type { ResolvedSky } from '@/data/skyPresets';

export const TERRAIN_RADIUS = 120;
/** Radius around the origin that stays nearly flat (the beacon arc lives inside it) */
export const FLAT_RADIUS = 14;

/* ---------- deterministic value noise (pure, shared with vegetation) ---------- */

const hash2 = (x: number, z: number): number => {
  const h = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
  return h - Math.floor(h);
};

export const noise2 = (x: number, z: number): number => {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
};

/** Fractal noise in roughly 0..1 */
export const fbm2 = (x: number, z: number, octaves = 4): number => {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let i = 0; i < octaves; i += 1) {
    sum += noise2(x, z) * amp;
    norm += amp;
    amp *= 0.5;
    // rotate + scale each octave to hide grid alignment
    const nx = x * 1.6 + z * 1.2 + 17.3;
    z = -x * 1.2 + z * 1.6 + 9.1;
    x = nx;
  }
  return sum / norm;
};

const smoothstep = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/* ---------- height profiles ---------- */

export type HeightFn = (x: number, z: number) => number;

/** Island (oceanic) and floating mesa (gas-giant) radii, measured from the origin */
export const ISLAND_RADIUS = 27;
export const MESA_RADIUS = 27;
export const WATER_LEVEL = 0;
export const CLOUD_DECK_Y = -4.5;

const ripple = (x: number, z: number, amp = 0.35) => (fbm2(x * 0.11, z * 0.11, 2) - 0.5) * amp;

/** Default ground: gentle ripples near the origin, rolling dunes beyond, rising to the horizon. */
const rolling = (x: number, z: number, dune = 9, crag = 0): number => {
  const r = Math.sqrt(x * x + z * z);
  const open = smoothstep(FLAT_RADIUS - 2, FLAT_RADIUS + 22, r);
  const dunes = (fbm2(x * 0.028 + 3.1, z * 0.028 - 7.4, 4) - 0.42) * dune;
  const swell = Math.sin(x * 0.045 + Math.sin(z * 0.03) * 2) * 1.2 * (dune / 9);
  // ridged noise for broken lava fields
  const ridged = crag > 0 ? Math.pow(1 - Math.abs(fbm2(x * 0.05 - 4, z * 0.05 + 6, 3) * 2 - 1), 3) * crag : 0;
  const rise = Math.pow(smoothstep(30, TERRAIN_RADIUS, r), 1.4) * (6 + fbm2(x * 0.02, z * 0.02, 2) * 8);
  return ripple(x, z) + (dunes + swell + ridged) * open + rise;
};

/** Distant islets on the ocean world: [x, z, radius, height] */
const ISLES: Array<[number, number, number, number]> = [
  [-62, -78, 18, 4.5],
  [48, -96, 24, 7],
  [96, -34, 14, 3],
  [-104, -22, 20, 5],
  [22, 96, 16, 3],
  [-72, 70, 15, 4],
  [84, 62, 12, 2.5],
];

const island = (x: number, z: number): number => {
  const r = Math.sqrt(x * x + z * z);
  const rn = r * (1 + (fbm2(x * 0.045 + 9, z * 0.045 - 4, 3) - 0.5) * 0.4);
  const land = 1 - smoothstep(ISLAND_RADIUS - 7, ISLAND_RADIUS + 3, rn);
  const hills = Math.max(0, fbm2(x * 0.06, z * 0.06, 3) - 0.45) * 2.2 * smoothstep(12, 20, r);
  const sea = 1.4 + 4 * smoothstep(ISLAND_RADIUS + 3, 70, r);
  let h = ripple(x, z, 0.25) + land * (0.85 + hills) - (1 - land) * sea;
  for (const [cx, cz, rad, hgt] of ISLES) {
    const d = Math.hypot(x - cx, z - cz) / rad;
    if (d < 1.4) h = Math.max(h, hgt * (1 - d * d) * (0.75 + 0.5 * fbm2(x * 0.08, z * 0.08, 2)) - 1.2 * d);
  }
  return h;
};

const mesa = (x: number, z: number): number => {
  const r = Math.sqrt(x * x + z * z);
  const rn = r * (1 + (fbm2(x * 0.05 + 2, z * 0.05 + 7, 3) - 0.5) * 0.35);
  // the platform crowns slightly so the cloud deck shows beyond its edge
  const top = ripple(x, z) + (fbm2(x * 0.05, z * 0.05, 3) - 0.5) * 0.9 * smoothstep(12, 22, r) - 1.3 * smoothstep(14, MESA_RADIUS, r);
  // low rocky lip just before the edge, then a sheer drop through the clouds
  const lip = 0.35 * smoothstep(MESA_RADIUS - 7, MESA_RADIUS - 2, rn) * (1 - smoothstep(MESA_RADIUS - 1.5, MESA_RADIUS, rn));
  const drop = smoothstep(MESA_RADIUS - 1.5, MESA_RADIUS + 7, rn);
  return top + lip - Math.pow(drop, 0.6) * 70;
};

const PROFILES: Record<PlanetStyle, HeightFn> = {
  rocky: (x, z) => rolling(x, z),
  forested: (x, z) => rolling(x, z),
  molten: (x, z) => rolling(x, z, 5, 2.6),
  oceanic: island,
  'gas-giant': mesa,
};

/** Pure height function for a planet style. Beacons, camera and vegetation all sit on it. */
export const heightFor = (style: PlanetStyle): HeightFn => PROFILES[style];

/** Default profile (rocky / forested), kept for callers without a planet. */
export const terrainHeight: HeightFn = PROFILES.rocky;

/** How far the walker may roam on each style (islands and mesas are smaller) */
export const walkRadiusFor = (style: PlanetStyle): number =>
  style === 'oceanic' ? ISLAND_RADIUS - 4 : style === 'gas-giant' ? MESA_RADIUS - 3.5 : 30;

/* ---------- colouring ---------- */

const STYLE_NEUTRAL: Record<PlanetStyle, [string, string, string]> = {
  // low ground, high ground, exposed rock
  rocky: ['#6e5444', '#9a7a62', '#54443a'],
  oceanic: ['#9a8f74', '#5f7a6c', '#56605e'],
  'gas-giant': ['#4a4058', '#625878', '#3a3248'],
  forested: ['#34452e', '#4c5e3c', '#3a4036'],
  // basalt: near-black with a warm brown cast
  molten: ['#151110', '#1d1715', '#0e0b0a'],
};

/** How strongly the planet palette tints the neutral ground */
const STYLE_TINT: Record<PlanetStyle, number> = {
  rocky: 0.3,
  oceanic: 0.1,
  'gas-giant': 0.3,
  forested: 0.25,
  molten: 0.05,
};

export interface TerrainPalette {
  low: THREE.Color;
  high: THREE.Color;
  rock: THREE.Color;
  /** Secondary hue for large soft patches */
  alt: THREE.Color;
}

export const terrainPalette = (planet: Planet): TerrainPalette => {
  const [n0, n1, n2] = STYLE_NEUTRAL[planet.style];
  const ground = new THREE.Color(planet.surface.ground);
  return {
    low: new THREE.Color(n0).lerp(new THREE.Color(planet.palette[0]), STYLE_TINT[planet.style]).lerp(ground, 0.12),
    high: new THREE.Color(n1).lerp(new THREE.Color(planet.palette[1]), 0.16),
    rock: new THREE.Color(n2).lerp(new THREE.Color(planet.palette[2]), 0.3),
    alt:
      planet.style === 'molten'
        ? new THREE.Color('#241a16')
        : new THREE.Color(n1).lerp(new THREE.Color(planet.palette[0]), 0.35).lerp(new THREE.Color(n0), 0.3),
  };
};

/* ---------- geometry ---------- */

const RINGS = 96;
const SEGMENTS = 168;

const OCEAN = {
  grass: new THREE.Color('#6c8460'),
  dryGrass: new THREE.Color('#99966e'),
  sand: new THREE.Color('#cdbb94'),
  wet: new THREE.Color('#988766'),
  shoal: new THREE.Color('#7c8a76'),
  deep: new THREE.Color('#2c4650'),
};

const buildTerrain = (planet: Planet, pal: TerrainPalette): THREE.BufferGeometry => {
  const count = 1 + RINGS * SEGMENTS;
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const tmp = new THREE.Color();
  const style = planet.style;
  const H = heightFor(style);
  const strata = new THREE.Color(planet.palette[2]).lerp(pal.rock, 0.5);

  const put = (i: number, x: number, z: number) => {
    const y = H(x, z);
    pos[i * 3] = x;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = z;
    // slope from central differences
    const e = 0.6;
    const dx = H(x + e, z) - H(x - e, z);
    const dz = H(x, z + e) - H(x, z - e);
    const slope = Math.min(1, Math.sqrt(dx * dx + dz * dz) / (2 * e) / 0.9);
    const patch = fbm2(x * 0.08 + 40, z * 0.08 - 12, 3);
    const broad = fbm2(x * 0.035 - 21, z * 0.035 + 8, 3);
    if (style === 'oceanic') {
      // grass inland, a sand rim, wet sand at the waterline, then shoals and deep seabed
      if (y > 0.55) tmp.copy(OCEAN.grass).lerp(OCEAN.dryGrass, smoothstep(0.4, 0.75, patch) * 0.6);
      else tmp.copy(OCEAN.sand).lerp(OCEAN.grass, smoothstep(0.42, 0.62, y) * 0.8);
      tmp.lerp(OCEAN.sand, smoothstep(0.55, 0.75, broad) * 0.35 * smoothstep(0.3, 1.2, y));
      if (y < 0.2) tmp.copy(OCEAN.wet).lerp(OCEAN.sand, smoothstep(-0.1, 0.2, y));
      if (y < -0.2) tmp.copy(OCEAN.shoal).lerp(OCEAN.deep, smoothstep(-0.4, -4, y));
    } else {
      const hT = smoothstep(-1, 9, y);
      tmp.copy(pal.low).lerp(pal.high, hT * 0.8 + (patch - 0.5) * 0.5);
      // broad patches of a second hue plus fine mottling, so open ground is never flat
      tmp.lerp(pal.alt, smoothstep(0.42, 0.68, broad) * 0.55);
      tmp.lerp(pal.rock, smoothstep(0.25, 0.75, slope) * 0.85);
      // banded strata down the mesa cliffs
      if (style === 'gas-giant' && slope > 0.6) {
        tmp.lerp(strata, (Math.sin(y * 1.3 + noise2(x * 0.2, z * 0.2) * 2) * 0.5 + 0.5) * 0.6);
        tmp.multiplyScalar(0.75 + 0.25 * smoothstep(-40, 0, y));
      }
    }
    const v = 0.84 + noise2(x * 0.9, z * 0.9) * 0.2 + noise2(x * 0.25 + 3, z * 0.25) * 0.12;
    col[i * 3] = tmp.r * v;
    col[i * 3 + 1] = tmp.g * v;
    col[i * 3 + 2] = tmp.b * v;
  };

  put(0, 0, 0);
  for (let r = 0; r < RINGS; r += 1) {
    // dense near the player, sparse toward the horizon
    const rad = TERRAIN_RADIUS * Math.pow((r + 1) / RINGS, 1.65);
    for (let s = 0; s < SEGMENTS; s += 1) {
      const a = (s / SEGMENTS) * Math.PI * 2 + (r % 2) * (Math.PI / SEGMENTS);
      put(1 + r * SEGMENTS + s, Math.cos(a) * rad, Math.sin(a) * rad);
    }
  }

  const idx: number[] = [];
  for (let s = 0; s < SEGMENTS; s += 1) idx.push(0, 1 + ((s + 1) % SEGMENTS), 1 + s);
  for (let r = 0; r < RINGS - 1; r += 1) {
    const a0 = 1 + r * SEGMENTS;
    const b0 = a0 + SEGMENTS;
    for (let s = 0; s < SEGMENTS; s += 1) {
      const s1 = (s + 1) % SEGMENTS;
      idx.push(a0 + s, a0 + s1, b0 + s);
      idx.push(a0 + s1, b0 + s1, b0 + s);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
};

/* ---------- distant mountain silhouettes (unfogged, hazed in shader) ---------- */

const mountainVert = /* glsl */ `
  varying float vH;
  varying vec3 vDir;
  void main() {
    vH = uv.y;
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const mountainFrag = /* glsl */ `
  uniform vec3 uFog;
  uniform vec3 uTone;
  uniform vec3 uRim;
  uniform vec3 uSun;
  uniform float uHaze;
  varying float vH;
  varying vec3 vDir;
  void main() {
    // denser haze near the base (height fog), clearer toward the ridge
    float haze = mix(1.0, uHaze, smoothstep(0.0, 1.0, vH));
    vec3 col = mix(uTone, uFog, haze);
    // thin rim light on ridges facing the sun
    float facing = pow(max(dot(normalize(vDir.xz), normalize(uSun.xz)), 0.0), 6.0);
    col += uRim * facing * smoothstep(0.75, 1.0, vH) * 0.35;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const buildRidge = (radius: number, base: number, amp: number, seed: number, sun: THREE.Vector3) => {
  const N = 256;
  const pos = new Float32Array((N + 1) * 2 * 3);
  const uv = new Float32Array((N + 1) * 2 * 2);
  const sunAz = Math.atan2(sun.z, sun.x);
  for (let i = 0; i <= N; i += 1) {
    const a = (i / N) * Math.PI * 2;
    const x = Math.cos(a);
    const z = Math.sin(a);
    const n = fbm2(x * 2.2 + seed, z * 2.2 - seed, 5);
    const peaks = Math.pow(n, 1.6) * 1.6;
    // open a low saddle under the sun so the disc is never hidden
    const d = Math.abs(Math.atan2(Math.sin(a - sunAz), Math.cos(a - sunAz)));
    const saddle = 1 - 0.65 * Math.exp(-d * d * 18) * (sun.y < 0.35 ? 1 : 0);
    const h = (base + amp * peaks) * saddle;
    const o = i * 6;
    pos.set([x * radius, -12, z * radius, x * radius, h, z * radius], o);
    uv.set([i / N, 0, i / N, 1], i * 4);
  }
  const idx: number[] = [];
  for (let i = 0; i < N; i += 1) {
    const a = i * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return geo;
};

/* ---------- lava fissures (molten): voronoi cell edges, emissive > 1 so they bloom ---------- */

const LAVA_PARS = /* glsl */ `
  uniform float uTime;
  uniform vec3 uLava;
  uniform vec3 uLavaCore;
  varying vec3 vWPos;
  vec2 lavaHash(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
  }
  float lavaNoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    float a = lavaHash(i).x, b = lavaHash(i + vec2(1.0, 0.0)).x;
    float c = lavaHash(i + vec2(0.0, 1.0)).x, d = lavaHash(i + vec2(1.0, 1.0)).x;
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  // distance to the nearest cell edge (F2 - F1)
  float lavaEdge(vec2 p) {
    vec2 n = floor(p); vec2 f = fract(p);
    float f1 = 8.0; float f2 = 8.0;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 r = g + lavaHash(n + g) * 0.9 + 0.05 - f;
      float d = dot(r, r);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
    }
    return sqrt(f2) - sqrt(f1);
  }
`;

const LAVA_FRAG = /* glsl */ `
  {
    vec2 lp = vWPos.xz * 0.28;
    lp += vec2(lavaNoise(lp * 1.7), lavaNoise(lp * 1.7 + 7.3)) * 0.45;
    float edge = lavaEdge(lp);
    float dist = length(vWPos.xz - cameraPosition.xz);
    float width = 0.028 + 0.025 * lavaNoise(lp * 3.0);
    float crack = (1.0 - smoothstep(width * 0.4, width, edge)) * (1.0 - smoothstep(60.0, 110.0, dist));
    float pulse = 0.7 + 0.3 * sin(uTime * 0.9 + lavaNoise(lp * 0.6) * 6.28);
    float halo = (1.0 - smoothstep(0.0, 0.25, edge)) * 0.07;
    // crust darkens toward the fissures, which glow from orange to a yellow core
    diffuseColor.rgb *= 1.0 - crack * 0.85;
    vec3 lava = mix(uLava, uLavaCore, crack * crack);
    totalEmissiveRadiance += lava * (crack * 2.4 * pulse + halo);
  }
`;

const lavaMaterial = (planet: Planet, time: { value: number }) => {
  // fully rough: a low sun in front would otherwise put a pale sheen on the basalt
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  const lava = new THREE.Color('#ff5a14').lerp(new THREE.Color(planet.accent), 0.15);
  const core = new THREE.Color('#ffc46a').lerp(new THREE.Color(planet.accent), 0.3);
  m.customProgramCacheKey = () => 'terrain-lava';
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.uniforms.uLava = { value: lava };
    shader.uniforms.uLavaCore = { value: core };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
${LAVA_PARS}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
${LAVA_FRAG}`);
  };
  return m;
};

interface TerrainProps {
  planet: Planet;
  sky: ResolvedSky;
  reducedMotion?: boolean;
}

const RIDGES: Record<PlanetStyle, Array<[number, number, number, number, number]>> = {
  // radius, base, amplitude, seed, haze at the ridge
  rocky: [[330, 26, 70, 11.7, 0.72], [210, 10, 34, 3.3, 0.5]],
  forested: [[330, 26, 70, 11.7, 0.72], [210, 10, 34, 3.3, 0.5]],
  molten: [[330, 30, 80, 5.1, 0.7], [210, 8, 30, 8.8, 0.45]],
  // distant islands: mostly below the waterline, a few peaks break the surface
  oceanic: [[330, -8, 40, 2.2, 0.7], [220, -10, 26, 6.6, 0.55]],
  // nothing but cloud to the horizon
  'gas-giant': [],
};

const Terrain = ({ planet, sky, reducedMotion }: TerrainProps) => {
  const pal = useMemo(() => terrainPalette(planet), [planet]);
  const geo = useMemo(() => buildTerrain(planet, pal), [planet, pal]);
  const time = useMemo(() => ({ value: 0 }), []);

  const material = useMemo(
    () =>
      planet.style === 'molten'
        ? lavaMaterial(planet, time)
        : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0 }),
    [planet, time],
  );

  const ridges = useMemo(() => {
    const tone =
      planet.style === 'oceanic'
        ? new THREE.Color('#4a5e58').lerp(sky.zenith, 0.3)
        : pal.rock.clone().lerp(sky.zenith, planet.style === 'molten' ? 0.15 : 0.35);
    return RIDGES[planet.style].map(([r, base, amp, seed, haze]) => ({
      geo: buildRidge(r, base, amp, seed, sky.sunDir),
      mat: new THREE.ShaderMaterial({
        vertexShader: mountainVert,
        fragmentShader: mountainFrag,
        uniforms: {
          uFog: { value: sky.fogColor },
          uTone: { value: tone },
          uRim: { value: sky.lightColor },
          uSun: { value: sky.sunDir },
          uHaze: { value: haze },
        },
        fog: false,
        depthWrite: true,
      }),
    }));
  }, [pal, sky, planet.style]);

  useEffect(() => () => geo.dispose(), [geo]);
  useEffect(() => () => material.dispose(), [material]);
  useEffect(
    () => () => ridges.forEach((r) => (r.geo.dispose(), r.mat.dispose())),
    [ridges],
  );

  useFrame((_, dt) => {
    time.value += reducedMotion ? dt * 0.2 : dt;
  });

  return (
    <group>
      <mesh geometry={geo} material={material} receiveShadow />
      {ridges.map((r, i) => (
        <mesh key={i} geometry={r.geo} material={r.mat} renderOrder={-5} frustumCulled={false} />
      ))}
    </group>
  );
};

export default Terrain;
