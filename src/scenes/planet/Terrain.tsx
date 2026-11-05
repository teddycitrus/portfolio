import { useEffect, useMemo } from 'react';
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

/**
 * Ground height at a world XZ position. Gentle ripples near the origin, long
 * rolling dunes beyond the flat radius, rising toward the horizon.
 */
export const terrainHeight = (x: number, z: number): number => {
  const r = Math.sqrt(x * x + z * z);
  const ripple = (fbm2(x * 0.11, z * 0.11, 2) - 0.5) * 0.35;
  const open = smoothstep(FLAT_RADIUS - 2, FLAT_RADIUS + 22, r);
  const dunes = (fbm2(x * 0.028 + 3.1, z * 0.028 - 7.4, 4) - 0.42) * 9;
  const swell = Math.sin(x * 0.045 + Math.sin(z * 0.03) * 2) * 1.2;
  const rise = Math.pow(smoothstep(30, TERRAIN_RADIUS, r), 1.4) * (6 + fbm2(x * 0.02, z * 0.02, 2) * 8);
  return ripple + (dunes + swell) * open + rise;
};

/* ---------- colouring ---------- */

const STYLE_NEUTRAL: Record<PlanetStyle, [string, string, string]> = {
  // low ground, high ground, exposed rock
  rocky: ['#6e5444', '#9a7a62', '#54443a'],
  oceanic: ['#76807a', '#5c7472', '#4c585a'],
  'gas-giant': ['#3e3650', '#5a5070', '#322c40'],
  forested: ['#34452e', '#4c5e3c', '#3a4036'],
  molten: ['#2e2624', '#4a3a30', '#26201c'],
};

export interface TerrainPalette {
  low: THREE.Color;
  high: THREE.Color;
  rock: THREE.Color;
}

export const terrainPalette = (planet: Planet): TerrainPalette => {
  const [n0, n1, n2] = STYLE_NEUTRAL[planet.style];
  const ground = new THREE.Color(planet.surface.ground);
  return {
    low: new THREE.Color(n0).lerp(new THREE.Color(planet.palette[0]), 0.3).lerp(ground, 0.2),
    high: new THREE.Color(n1).lerp(new THREE.Color(planet.palette[1]), 0.16),
    rock: new THREE.Color(n2).lerp(new THREE.Color(planet.palette[2]), 0.3),
  };
};

/* ---------- geometry ---------- */

const RINGS = 96;
const SEGMENTS = 168;

const buildTerrain = (planet: Planet, pal: TerrainPalette): THREE.BufferGeometry => {
  const count = 1 + RINGS * SEGMENTS;
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const glow = new Float32Array(count);
  const tmp = new THREE.Color();
  const molten = planet.style === 'molten';

  const put = (i: number, x: number, z: number) => {
    const y = terrainHeight(x, z);
    pos[i * 3] = x;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = z;
    // slope from central differences
    const e = 0.6;
    const dx = terrainHeight(x + e, z) - terrainHeight(x - e, z);
    const dz = terrainHeight(x, z + e) - terrainHeight(x, z - e);
    const slope = Math.min(1, Math.sqrt(dx * dx + dz * dz) / (2 * e) / 0.9);
    const patch = fbm2(x * 0.08 + 40, z * 0.08 - 12, 3);
    const hT = smoothstep(-1, 9, y);
    tmp.copy(pal.low).lerp(pal.high, hT * 0.8 + (patch - 0.5) * 0.35);
    tmp.lerp(pal.rock, smoothstep(0.25, 0.75, slope) * 0.85);
    const v = 0.88 + noise2(x * 0.9, z * 0.9) * 0.22;
    col[i * 3] = tmp.r * v;
    col[i * 3 + 1] = tmp.g * v;
    col[i * 3 + 2] = tmp.b * v;
    // molten worlds: faint ember seams in the low hollows, outside the walkway
    if (molten) {
      const crack = 1 - Math.abs(fbm2(x * 0.06 + 5, z * 0.06 + 2, 3) - 0.5) * 2;
      glow[i] = smoothstep(0.9, 0.98, crack) * smoothstep(FLAT_RADIUS, FLAT_RADIUS + 10, Math.hypot(x, z));
    }
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
  geo.setAttribute('aGlow', new THREE.BufferAttribute(glow, 1));
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

interface TerrainProps {
  planet: Planet;
  sky: ResolvedSky;
}

const Terrain = ({ planet, sky }: TerrainProps) => {
  const pal = useMemo(() => terrainPalette(planet), [planet]);
  const geo = useMemo(() => buildTerrain(planet, pal), [planet, pal]);

  const material = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0 });
    if (planet.style === 'molten') {
      const ember = new THREE.Color(planet.accent).lerp(new THREE.Color('#ff5a1e'), 0.6).multiplyScalar(1.6);
      m.onBeforeCompile = (shader) => {
        shader.uniforms.uEmber = { value: ember };
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform vec3 uEmber;\nvarying float vGlow;')
          .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uEmber * vGlow;');
      };
    }
    return m;
  }, [planet]);

  const ridges = useMemo(() => {
    const tone = pal.rock.clone().lerp(sky.zenith, 0.35);
    const make = (r: number, base: number, amp: number, seed: number, haze: number) => ({
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
    });
    return [make(330, 26, 70, 11.7, 0.72), make(210, 10, 34, 3.3, 0.5)];
  }, [pal, sky]);

  useEffect(() => () => geo.dispose(), [geo]);
  useEffect(() => () => material.dispose(), [material]);
  useEffect(
    () => () => ridges.forEach((r) => (r.geo.dispose(), r.mat.dispose())),
    [ridges],
  );

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
