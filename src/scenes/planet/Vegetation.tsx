import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Planet, PlanetStyle } from '@/types/content';
import { SURFACE_SPAWN } from '@/data/content';
import { fbm2, noise2, terrainHeight, terrainPalette } from './Terrain';

/* ---------- deterministic rng ---------- */

const seedOf = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};
const mulberry = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/* ---------- geometry builders ---------- */

const paint = (g: THREE.BufferGeometry, color: THREE.ColorRepresentation) => {
  const c = new THREE.Color(color);
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 1) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
};

/** Crossed tapering blades with up-facing normals so tufts light softly. */
const bladeTuft = (blades: number, height: number, width: number, lean: number, seed: number) => {
  const rnd = mulberry(seed);
  const pos: number[] = [];
  const col: number[] = [];
  for (let b = 0; b < blades; b += 1) {
    const a = (b / blades) * Math.PI * 2 + rnd() * 0.8;
    const h = height * (0.65 + rnd() * 0.35);
    const r = 0.06 + rnd() * 0.08;
    const cx = Math.cos(a) * r;
    const cz = Math.sin(a) * r;
    const px = -Math.sin(a) * width;
    const pz = Math.cos(a) * width;
    const tx = cx + Math.cos(a) * lean * h;
    const tz = cz + Math.sin(a) * lean * h;
    // both windings so FrontSide renders each blade without flipping the up normal
    pos.push(cx - px, 0, cz - pz, cx + px, 0, cz + pz, tx, h, tz);
    pos.push(cx + px, 0, cz + pz, cx - px, 0, cz - pz, tx, h, tz);
    // darker root, lighter tip
    for (let k = 0; k < 2; k += 1) col.push(0.55, 0.55, 0.55, 0.55, 0.55, 0.55, 1.1, 1.1, 1.1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const nrm = new Float32Array(pos.length);
  for (let i = 0; i < nrm.length; i += 3) nrm[i + 1] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return g;
};

/** Faceted rock: icosahedron jittered by position-hash so shared corners stay welded. */
const rock = (detail: number, squash: number, seed: number) => {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i += 1) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const k = 0.75 + noise2(x * 2.1 + seed, z * 2.1 + y * 1.7) * 0.5;
    p.setXYZ(i, x * k, Math.max(y * k * squash, -0.15), z * k);
  }
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return paint(g, '#ffffff');
};

const conifer = () => {
  const trunk = paint(new THREE.CylinderGeometry(0.07, 0.11, 0.9, 5).translate(0, 0.45, 0), '#5a4636');
  const low = paint(new THREE.ConeGeometry(0.85, 1.9, 7).translate(0, 1.55, 0), '#ffffff');
  const high = paint(new THREE.ConeGeometry(0.6, 1.5, 7).translate(0, 2.55, 0), '#f0f0f0');
  [trunk, low, high].forEach((g) => g.deleteAttribute('uv'));
  return mergeGeometries([trunk, low, high])!;
};

const crystalCluster = () => {
  const parts: THREE.BufferGeometry[] = [];
  const spec: Array<[number, number, number, number, number]> = [
    // height, x, z, tiltX, tiltZ
    [1.6, 0, 0, 0, 0.05],
    [1.0, 0.25, 0.1, 0.25, -0.35],
    [0.75, -0.22, 0.15, -0.2, 0.4],
    [0.55, 0.05, -0.25, -0.45, 0.1],
  ];
  for (const [h, x, z, rx, rz] of spec) {
    const g = new THREE.OctahedronGeometry(1, 0);
    g.scale(0.13 * h + 0.05, h * 0.5, 0.13 * h + 0.05).translate(0, h * 0.5, 0);
    g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, 0, rz)));
    g.translate(x, 0, z);
    g.deleteAttribute('uv');
    parts.push(paint(g, '#ffffff'));
  }
  const m = mergeGeometries(parts)!;
  m.computeVertexNormals();
  return m;
};

const basaltCluster = () => {
  const parts: THREE.BufferGeometry[] = [];
  const rnd = mulberry(77);
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2;
    const r = i === 0 ? 0 : 0.55;
    const h = 0.6 + rnd() * 1.6 + (i === 0 ? 0.8 : 0);
    const g = new THREE.CylinderGeometry(0.3, 0.32, h, 6).translate(Math.cos(a) * r, h / 2, Math.sin(a) * r);
    g.deleteAttribute('uv');
    parts.push(paint(g, i % 2 ? '#e8e8e8' : '#ffffff'));
  }
  return mergeGeometries(parts)!;
};

/* ---------- wind / glow shader patch ---------- */

interface PatchOptions {
  sway: number;
  /** emissive tip colour (standard materials only) */
  tip?: THREE.Color;
  tipStart?: number;
  tipEnd?: number;
  flicker?: boolean;
}

const patchMaterial = (
  m: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial,
  time: { value: number },
  o: PatchOptions,
) => {
  const flags = `${o.tip ? 'T' : ''}${o.flicker ? 'F' : ''}`;
  m.customProgramCacheKey = () => `veg-${flags}`;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.uniforms.uSway = { value: o.sway };
    shader.uniforms.uTip = { value: o.tip ?? new THREE.Color(0) };
    shader.uniforms.uTipRange = { value: new THREE.Vector2(o.tipStart ?? 0.6, o.tipEnd ?? 1.2) };
    const defs = `${o.tip ? '#define VEG_TIP\n' : ''}${o.flicker ? '#define VEG_FLICKER\n' : ''}`;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `${defs}#include <common>\nuniform float uTime;\nuniform float uSway;\nuniform vec2 uTipRange;\nvarying float vTip;\nvarying float vPh;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 iPos = instanceMatrix[3].xyz;
        #else
          vec3 iPos = vec3(0.0);
        #endif
        vPh = iPos.x * 0.21 + iPos.z * 0.17;
        float hy = max(position.y, 0.0);
        float gust = 0.65 + 0.35 * sin(uTime * 0.31 + iPos.x * 0.03 + iPos.z * 0.02);
        float bend = hy * hy * uSway * gust;
        transformed.x += sin(uTime * 1.35 + vPh) * bend;
        transformed.z += cos(uTime * 1.05 + vPh * 1.3) * bend * 0.6;
        vTip = smoothstep(uTipRange.x, uTipRange.y, position.y);
        #ifdef VEG_FLICKER
          transformed *= 0.55 + 0.45 * sin(uTime * 2.3 + vPh * 7.0);
        #endif`,
      );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `${defs}#include <common>\nuniform float uTime;\nuniform vec3 uTip;\nvarying float vTip;\nvarying float vPh;`,
    );
    if (o.tip) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>\ntotalEmissiveRadiance += uTip * vTip * (0.75 + 0.25 * sin(uTime * 1.2 + vPh * 3.0));`,
      );
    }
  };
  return m;
};

/* ---------- layers per style ---------- */

interface Layer {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
  count: number;
  minR: number;
  maxR: number;
  scale: [number, number];
  /** extra clearance from beacons beyond the base 2.2 */
  clear: number;
  colorA: THREE.Color;
  colorB: THREE.Color;
  /** 0 = uniform, 1 = strongly clumped */
  clump: number;
  shadow: boolean;
  /** sink into the ground by this fraction of scale (for rocks on slopes) */
  sink: number;
  tiltJitter: number;
}

const C = (hex: string | THREE.Color, mix?: string, t = 0) => {
  const c = new THREE.Color(hex);
  return mix ? c.lerp(new THREE.Color(mix), t) : c;
};

const std = (p: THREE.MeshStandardMaterialParameters) =>
  new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, ...p });

const buildLayers = (planet: Planet, time: { value: number }): Layer[] => {
  const pal = terrainPalette(planet);
  const accent = new THREE.Color(planet.accent);
  const [p0, p1, p2] = planet.palette;
  const base = { clear: 0, clump: 0.5, shadow: false, sink: 0, tiltJitter: 0.15 };
  const grassMat = (sway = 0.14) => patchMaterial(std({ roughness: 1 }), time, { sway });
  const rockMat = () => patchMaterial(std({ flatShading: true, roughness: 0.88 }), time, { sway: 0 });

  const byStyle: Record<PlanetStyle, () => Layer[]> = {
    forested: () => [
      {
        ...base,
        geo: bladeTuft(7, 0.55, 0.035, 0.25, 1),
        mat: grassMat(),
        count: 1700,
        minR: 2,
        maxR: 55,
        scale: [0.7, 1.3],
        colorA: C(pal.low, '#6f8a4e', 0.55),
        colorB: C(p1, '#4f6a3c', 0.7),
        clump: 0.7,
      },
      {
        ...base,
        geo: conifer(),
        mat: patchMaterial(std({ flatShading: true, roughness: 0.85 }), time, { sway: 0.004 }),
        count: 170,
        minR: 17,
        maxR: 75,
        scale: [0.8, 1.9],
        clear: 2,
        colorA: C('#2c4a34', p0, 0.2),
        colorB: C('#1e3428', p2, 0.3),
        clump: 0.8,
        shadow: true,
        tiltJitter: 0.05,
      },
      {
        ...base,
        geo: rock(0, 0.6, 3),
        mat: rockMat(),
        count: 90,
        minR: 5,
        maxR: 50,
        scale: [0.15, 0.6],
        colorA: C(pal.rock, '#7a8070', 0.4),
        colorB: C(pal.rock),
        shadow: true,
        sink: 0.25,
      },
    ],
    oceanic: () => [
      {
        ...base,
        geo: bladeTuft(4, 1.1, 0.025, 0.18, 2),
        mat: grassMat(0.09),
        count: 1100,
        minR: 3,
        maxR: 55,
        scale: [0.6, 1.25],
        colorA: C('#b8b49a', p1, 0.2),
        colorB: C('#8a9a7c', p0, 0.2),
        clump: 0.85,
      },
      {
        ...base,
        geo: rock(0, 0.45, 9),
        mat: rockMat(),
        count: 600,
        minR: 1.5,
        maxR: 40,
        scale: [0.05, 0.16],
        colorA: C('#c8c4b8', p1, 0.15),
        colorB: C('#6c7478', p2, 0.2),
        clump: 0.4,
        sink: 0.2,
      },
      {
        ...base,
        geo: rock(1, 0.7, 5),
        mat: rockMat(),
        count: 60,
        minR: 14,
        maxR: 70,
        scale: [0.6, 2.4],
        clear: 1.5,
        colorA: C(pal.rock, '#8a9498', 0.4),
        colorB: C(pal.rock),
        shadow: true,
        sink: 0.3,
      },
    ],
    rocky: () => [
      {
        ...base,
        geo: rock(1, 0.65, 7),
        mat: rockMat(),
        count: 280,
        minR: 5,
        maxR: 80,
        scale: [0.25, 2.2],
        clear: 1,
        colorA: C(pal.rock, p1, 0.12),
        colorB: C(pal.low, p2, 0.3),
        clump: 0.75,
        shadow: true,
        sink: 0.3,
      },
      {
        ...base,
        geo: bladeTuft(9, 0.32, 0.03, 0.45, 4),
        mat: grassMat(0.18),
        count: 700,
        minR: 2,
        maxR: 50,
        scale: [0.6, 1.4],
        colorA: C('#8a7656', p1, 0.15),
        colorB: C('#5c4a34', p0, 0.2),
        clump: 0.8,
      },
      {
        ...base,
        geo: rock(0, 0.5, 13),
        mat: rockMat(),
        count: 450,
        minR: 1.5,
        maxR: 40,
        scale: [0.05, 0.18],
        colorA: C(pal.high),
        colorB: C(pal.rock),
        sink: 0.2,
      },
    ],
    'gas-giant': () => [
      {
        ...base,
        geo: crystalCluster(),
        mat: patchMaterial(
          std({ flatShading: true, roughness: 0.25, metalness: 0.1, transparent: false }),
          time,
          { sway: 0, tip: accent.clone().multiplyScalar(1.4), tipStart: 0.5, tipEnd: 1.6 },
        ),
        count: 210,
        minR: 6,
        maxR: 70,
        scale: [0.4, 1.6],
        clear: 1,
        colorA: C(p2, p0, 0.45),
        colorB: C(p2, '#2a2440', 0.4),
        clump: 0.85,
        shadow: true,
        sink: 0.05,
      },
      {
        ...base,
        geo: bladeTuft(6, 0.3, 0.03, 0.35, 6),
        mat: grassMat(0.12),
        count: 900,
        minR: 2,
        maxR: 45,
        scale: [0.6, 1.3],
        colorA: C(pal.low, p1, 0.25),
        colorB: C(pal.low, p0, 0.3),
        clump: 0.7,
      },
      {
        ...base,
        geo: rock(0, 0.55, 17),
        mat: rockMat(),
        count: 260,
        minR: 3,
        maxR: 55,
        scale: [0.08, 0.5],
        colorA: C(pal.rock),
        colorB: C(pal.low),
        sink: 0.25,
      },
    ],
    molten: () => [
      {
        ...base,
        geo: basaltCluster(),
        mat: patchMaterial(std({ flatShading: true, roughness: 0.8 }), time, { sway: 0 }),
        count: 130,
        minR: 16,
        maxR: 80,
        scale: [0.35, 1.1],
        clear: 1.5,
        colorA: C('#2a2624', p2, 0.25),
        colorB: C('#3c342e', p0, 0.1),
        clump: 0.85,
        shadow: true,
        sink: 0.1,
        tiltJitter: 0.12,
      },
      {
        ...base,
        geo: new THREE.OctahedronGeometry(0.05, 0),
        mat: patchMaterial(
          new THREE.MeshBasicMaterial({
            color: accent.clone().lerp(new THREE.Color('#ff6a28'), 0.55).multiplyScalar(3.2),
          }),
          time,
          { sway: 0, flicker: true },
        ),
        count: 220,
        minR: 4,
        maxR: 45,
        scale: [0.6, 1.4],
        colorA: C('#ffffff'),
        colorB: C('#ffd0a0'),
        clump: 0.9,
        sink: -0.1,
      },
      {
        ...base,
        geo: rock(0, 0.5, 21),
        mat: rockMat(),
        count: 420,
        minR: 1.5,
        maxR: 45,
        scale: [0.06, 0.3],
        colorA: C(pal.rock),
        colorB: C(pal.low, p1, 0.08),
        sink: 0.2,
      },
      {
        ...base,
        geo: bladeTuft(5, 0.28, 0.025, 0.4, 8),
        mat: grassMat(0.1),
        count: 350,
        minR: 3,
        maxR: 40,
        scale: [0.6, 1.2],
        colorA: C('#5a4c40', p1, 0.1),
        colorB: C('#3a302a'),
        clump: 0.8,
      },
    ],
  };
  return byStyle[planet.style]();
};

/* ---------- placement ---------- */

const segDist = (px: number, pz: number, ax: number, az: number, bx: number, bz: number) => {
  const dx = bx - ax;
  const dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
};

const BEACON_CLEAR = 2.2;
const PATH_CLEAR = 0.9;

const fillInstances = (
  mesh: THREE.InstancedMesh,
  layer: Layer,
  beacons: Array<[number, number]>,
  seed: number,
) => {
  const rnd = mulberry(seed);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const c = new THREE.Color();
  const [sx, , sz] = SURFACE_SPAWN;
  let placed = 0;
  for (let tries = 0; tries < layer.count * 8 && placed < layer.count; tries += 1) {
    const r = Math.sqrt(layer.minR ** 2 + rnd() * (layer.maxR ** 2 - layer.minR ** 2));
    const a = rnd() * Math.PI * 2;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const patch = fbm2(x * 0.07 + seed * 0.01, z * 0.07, 3);
    if (rnd() > 1 - layer.clump + layer.clump * Math.pow(patch * 1.5, 3)) continue;
    if (Math.hypot(x - sx, z - sz) < 1.6 + layer.clear) continue;
    let blocked = false;
    for (const [bx, bz] of beacons) {
      if (Math.hypot(x - bx, z - bz) < BEACON_CLEAR + layer.clear) blocked = true;
      else if (segDist(x, z, sx, sz, bx, bz) < PATH_CLEAR + layer.clear * 0.5) blocked = true;
      if (blocked) break;
    }
    if (blocked) continue;
    let k = layer.scale[0] + Math.pow(rnd(), 1.8) * (layer.scale[1] - layer.scale[0]);
    // big props stay modest near the walkway so the monuments read first
    if (layer.clear >= 1) k *= 0.45 + 0.55 * Math.min(1, Math.max(0, (r - 6) / 18));
    p.set(x, terrainHeight(x, z) - layer.sink * k, z);
    e.set((rnd() - 0.5) * layer.tiltJitter, rnd() * Math.PI * 2, (rnd() - 0.5) * layer.tiltJitter);
    q.setFromEuler(e);
    s.set(k * (0.85 + rnd() * 0.3), k, k * (0.85 + rnd() * 0.3));
    m.compose(p, q, s);
    mesh.setMatrixAt(placed, m);
    c.copy(layer.colorA).lerp(layer.colorB, rnd());
    mesh.setColorAt(placed, c);
    placed += 1;
  }
  mesh.count = placed;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
};

interface VegetationProps {
  planet: Planet;
  /** Beacon XZ positions to keep clear */
  beacons: Array<[number, number]>;
  reducedMotion?: boolean;
}

const Vegetation = ({ planet, beacons, reducedMotion }: VegetationProps) => {
  const time = useMemo(() => ({ value: 0 }), []);

  const meshes = useMemo(() => {
    const seed = seedOf(planet.id);
    return buildLayers(planet, time).map((layer, i) => {
      const mesh = new THREE.InstancedMesh(layer.geo, layer.mat, layer.count);
      fillInstances(mesh, layer, beacons, seed + i * 101);
      mesh.castShadow = layer.shadow;
      mesh.receiveShadow = true;
      mesh.raycast = () => undefined;
      return mesh;
    });
  }, [planet, beacons, time]);

  useEffect(
    () => () =>
      meshes.forEach((m) => {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
        m.dispose();
      }),
    [meshes],
  );

  useFrame((_, dt) => {
    time.value += reducedMotion ? dt * 0.25 : dt;
  });

  return (
    <group>
      {meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
    </group>
  );
};

export default Vegetation;
