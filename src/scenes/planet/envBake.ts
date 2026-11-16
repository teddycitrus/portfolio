import * as THREE from 'three';
import type { PlanetStyle } from '@/types/content';

/*
 * Tiling noise baked on the CPU once and sampled by the sky and ground shaders,
 * so full-screen fragments pay for a few texture reads instead of noise octaves.
 */

const SIZE = 256;

const wrap = (i: number, p: number) => ((i % p) + p) % p;

const hash = (x: number, y: number, seed: number): number => {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

const tnoise = (x: number, y: number, px: number, py: number, seed: number): number => {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const x0 = wrap(ix, px);
  const x1 = wrap(ix + 1, px);
  const y0 = wrap(iy, py);
  const y1 = wrap(iy + 1, py);
  const a = hash(x0, y0, seed);
  const b = hash(x1, y0, seed);
  const c = hash(x0, y1, seed);
  const d = hash(x1, y1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
};

/** Tiling fractal noise over the unit square, roughly 0..1 */
const tfbm = (u: number, v: number, px: number, py: number, octaves: number, seed: number): number => {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let i = 0; i < octaves; i += 1) {
    const qx = px << i;
    const qy = py << i;
    sum += tnoise(u * qx, v * qy, qx, qy, seed + i * 17) * amp;
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
};

/** Tiling cell noise: distance to the nearest cell edge, and a random value per cell */
const cells = (u: number, v: number, p: number, seed: number, out: { edge: number; id: number }) => {
  const x = u * p;
  const y = v * p;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let f1 = 9;
  let f2 = 9;
  let id = 0;
  for (let j = -1; j <= 1; j += 1) {
    for (let i = -1; i <= 1; i += 1) {
      const cx = wrap(ix + i, p);
      const cy = wrap(iy + j, p);
      const dx = ix + i + 0.1 + hash(cx, cy, seed) * 0.8 - x;
      const dy = iy + j + 0.1 + hash(cx, cy, seed + 5) * 0.8 - y;
      const d = dx * dx + dy * dy;
      if (d < f1) {
        f2 = f1;
        f1 = d;
        id = hash(cx, cy, seed + 9);
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  out.edge = Math.sqrt(f2) - Math.sqrt(f1);
  out.id = id;
};

const toTexture = (data: Uint8Array<ArrayBuffer>) => {
  const t = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
};

const byte = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));

/* ---------- sky ---------- */

let skyTexture: THREE.DataTexture | null = null;

/**
 * Shared cloud noise. R billows, G long streaks, B slow warp, A fine detail.
 * A disposed texture uploads again on next use, so owners may dispose on unmount.
 */
export const skyNoiseTexture = (): THREE.DataTexture => {
  if (skyTexture) return skyTexture;
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const u = x / SIZE;
      const v = y / SIZE;
      const o = (y * SIZE + x) * 4;
      data[o] = byte(tfbm(u, v, 4, 4, 5, 11));
      data[o + 1] = byte(tfbm(u, v, 2, 16, 3, 29));
      data[o + 2] = byte(tfbm(u, v, 3, 3, 3, 47));
      data[o + 3] = byte(tfbm(u, v, 16, 16, 3, 71));
    }
  }
  skyTexture = toTexture(data);
  return skyTexture;
};

/* ---------- ground ---------- */

const groundData = new Map<PlanetStyle, Uint8Array<ArrayBuffer>>();

/**
 * Per-style ground detail. RG surface slope (0.5 is flat), B the style's feature
 * field (crack distance, ripple crest or leaf specks), A surface tone.
 */
const bakeGround = (style: PlanetStyle): Uint8Array<ArrayBuffer> => {
  const hit = groundData.get(style);
  if (hit) return hit;
  const height = new Float32Array(SIZE * SIZE);
  const feature = new Float32Array(SIZE * SIZE);
  const tone = new Float32Array(SIZE * SIZE);
  const c = { edge: 0, id: 0 };
  const tau = Math.PI * 2;
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const u = x / SIZE;
      const v = y / SIZE;
      const i = y * SIZE + x;
      const grain = tfbm(u, v, 16, 16, 3, 3);
      const wx = (tfbm(u, v, 4, 4, 2, 13) - 0.5) * 0.08;
      const wy = (tfbm(u, v, 4, 4, 2, 23) - 0.5) * 0.08;
      if (style === 'molten') {
        // ropy flow skin over cracked plates
        const rope = Math.sin(tau * (7 * v + 2.4 * tfbm(u, v, 3, 3, 2, 31))) * 0.5 + 0.5;
        cells(u + wx, v + wy, 7, 37, c);
        height[i] = rope * 0.7 + grain * 0.3;
        feature[i] = Math.min(1, c.edge * 2.2);
        tone[i] = rope * 0.65 + grain * 0.35;
      } else if (style === 'gas-giant') {
        // faceted fracture plates
        cells(u + wx, v + wy, 9, 41, c);
        height[i] = c.id * 0.55 + grain * 0.45;
        feature[i] = Math.min(1, c.edge * 2.2);
        tone[i] = c.id * 0.5 + grain * 0.5;
      } else if (style === 'oceanic') {
        // wind ripples
        const crest = Math.sin(tau * (11 * v + 2 * u + 1.8 * tfbm(u, v, 3, 3, 2, 31))) * 0.5 + 0.5;
        height[i] = crest * 0.75 + grain * 0.25;
        feature[i] = crest;
        tone[i] = grain;
      } else if (style === 'forested') {
        // clumped moss with fallen specks
        const moss = tfbm(u, v, 8, 8, 4, 53);
        cells(u, v, 18, 59, c);
        height[i] = moss * 0.8 + grain * 0.2;
        feature[i] = Math.min(1, c.edge * 2.2);
        tone[i] = moss;
      } else {
        // weathered grain, with a craze of drying cracks
        cells(u + wx, v + wy, 10, 67, c);
        height[i] = grain * 0.7 + tfbm(u, v, 32, 32, 2, 7) * 0.3;
        feature[i] = Math.min(1, c.edge * 2.2);
        tone[i] = grain;
      }
    }
  }
  const data = new Uint8Array(SIZE * SIZE * 4);
  const k = style === 'oceanic' ? 5 : 9;
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const i = y * SIZE + x;
      const o = i * 4;
      const dx = height[y * SIZE + wrap(x + 1, SIZE)] - height[y * SIZE + wrap(x - 1, SIZE)];
      const dy = height[wrap(y + 1, SIZE) * SIZE + x] - height[wrap(y - 1, SIZE) * SIZE + x];
      data[o] = byte(dx * k * 0.5 + 0.5);
      data[o + 1] = byte(dy * k * 0.5 + 0.5);
      data[o + 2] = byte(feature[i]);
      data[o + 3] = byte(tone[i]);
    }
  }
  groundData.set(style, data);
  return data;
};

export const groundDetailTexture = (style: PlanetStyle): THREE.DataTexture => toTexture(bakeGround(style));
