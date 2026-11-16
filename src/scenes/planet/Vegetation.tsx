import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { Planet, PlanetStyle } from '@/types/content';
import { SURFACE_SPAWN } from '@/data/content';
import { useAppStore } from '@/state/useAppStore';
import { fbm2, heightFor, ISLAND_RADIUS, MESA_RADIUS } from './Terrain';
import { mulberry, seedOf } from './rng';
import { buildLayers, WIND, type Layer } from './floraEcology';
import type { FloraEnv } from './floraShader';

/* ---------- placement ---------- */

const segDist = (px: number, pz: number, ax: number, az: number, bx: number, bz: number) => {
  const dx = bx - ax;
  const dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
};

const BEACON_CLEAR = 2.2;
const PATH_CLEAR = 0.9;

interface Placed {
  x: number;
  z: number;
  k: number;
}

const UP = new THREE.Vector3(0, 1, 0);

const fillInstances = (
  mesh: THREE.InstancedMesh,
  layer: Layer,
  beacons: Array<[number, number]>,
  seed: number,
  style: PlanetStyle,
  anchors: Map<string, Placed[]>,
) => {
  const rnd = mulberry(seed);
  const H = heightFor(style);
  // islands and mesas: keep props on the land / platform
  const maxR =
    style === 'oceanic'
      ? Math.min(layer.maxR, ISLAND_RADIUS + (layer.wet ? 6 : 1))
      : style === 'gas-giant'
        ? Math.min(layer.maxR, MESA_RADIUS - 2)
        : layer.maxR;
  const minY = style === 'oceanic' ? (layer.wet ? -0.8 : 0.3) : style === 'gas-giant' ? -0.8 : -Infinity;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const qTilt = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const c = new THREE.Color();
  const [sx, , sz] = SURFACE_SPAWN;
  const [wx, wz] = WIND[style];
  const windAngle = Math.atan2(wz, wx);
  const hosts = layer.anchor ? anchors.get(layer.anchor) : undefined;
  const placedHere: Placed[] = [];
  const capacity = mesh.instanceMatrix.count;
  let placed = 0;
  const fgr = layer.foreground;
  for (let tries = 0; tries < capacity * 30 && placed < capacity; tries += 1) {
    let x: number;
    let z: number;
    let r: number;
    if (fgr) {
      // a fan in front of the spawn, biased to the left and right edges of the view
      const side = rnd() < 0.5 ? -1 : 1;
      const th = side * (0.3 + rnd() * 0.45);
      const d = 2.4 + rnd() * 3.2;
      x = sx + Math.sin(th) * d;
      z = sz - Math.cos(th) * d;
      r = Math.hypot(x, z);
    } else {
      if (hosts && hosts.length > 0 && rnd() < (layer.anchorShare ?? 0)) {
        // sheltering growth: a ring around a host, weighted to its downwind side
        const host = hosts[Math.floor(rnd() * hosts.length)];
        const [r0, r1] = layer.anchorRing ?? [1, 2];
        const a = rnd() < (layer.lee ?? 0) ? windAngle + (rnd() - 0.5) * 2.0 : rnd() * Math.PI * 2;
        const dist = (r0 + rnd() * (r1 - r0)) * (host.k + 0.25);
        x = host.x + Math.cos(a) * dist;
        z = host.z + Math.sin(a) * dist;
        r = Math.hypot(x, z);
        if (r > maxR || r < Math.min(layer.minR, maxR - 1)) continue;
      } else {
        r = Math.sqrt(Math.min(layer.minR, maxR - 1) ** 2 + rnd() * (maxR ** 2 - Math.min(layer.minR, maxR - 1) ** 2));
        const a = rnd() * Math.PI * 2;
        x = Math.cos(a) * r;
        z = Math.sin(a) * r;
        const patch = fbm2(x * 0.07 + seed * 0.01, z * 0.07, 3);
        if (rnd() > 1 - layer.clump + layer.clump * Math.pow(patch * 1.5, 3)) continue;
      }
      if (Math.hypot(x - sx, z - sz) < 1.6 + layer.clear) continue;
    }
    const pathClear = fgr ? 0.55 : PATH_CLEAR + layer.clear * 0.5;
    let blocked = false;
    for (const [bx, bz] of beacons) {
      if (Math.hypot(x - bx, z - bz) < BEACON_CLEAR + (fgr ? 0 : layer.clear)) blocked = true;
      else if (segDist(x, z, sx, sz, bx, bz) < pathClear) blocked = true;
      if (blocked) break;
    }
    if (blocked) continue;
    const gy = H(x, z);
    if (gy < minY || (style === 'oceanic' && layer.wet && gy > 1.4)) continue;
    const dx = (H(x + 0.25, z) - H(x - 0.25, z)) / 0.5;
    const dz = (H(x, z + 0.25) - H(x, z - 0.25)) / 0.5;
    if (layer.maxSlope !== undefined && Math.hypot(dx, dz) > layer.maxSlope) continue;
    let k = layer.scale[0] + Math.pow(rnd(), 1.8) * (layer.scale[1] - layer.scale[0]);
    // big props stay modest near the walkway so the monuments read first
    if (!fgr && layer.clear >= 1) k *= 0.45 + 0.55 * Math.min(1, Math.max(0, (r - 6) / 18));
    p.set(x, gy - layer.sink * k, z);
    e.set((rnd() - 0.5) * layer.tiltJitter, rnd() * Math.PI * 2, (rnd() - 0.5) * layer.tiltJitter);
    q.setFromEuler(e);
    const follow = layer.follow ?? 0;
    if (follow > 0) {
      nrm.set(-dx * follow, 1, -dz * follow).normalize();
      qTilt.setFromUnitVectors(UP, nrm);
      q.premultiply(qTilt);
    }
    s.set(k * (0.85 + rnd() * 0.3), k, k * (0.85 + rnd() * 0.3));
    m.compose(p, q, s);
    mesh.setMatrixAt(placed, m);
    c.copy(layer.colorA).lerp(layer.colorB, rnd());
    mesh.setColorAt(placed, c);
    placed += 1;
    if (layer.id) placedHere.push({ x, z, k });
  }
  if (layer.id) anchors.set(layer.id, placedHere);
  mesh.count = placed;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
};

/* ---------- rising embers (molten): GPU-animated points, no per-frame CPU work ---------- */

const EMBER_COUNT = 260;

const buildEmbers = (color: THREE.Color, time: { value: number }) => {
  const rnd = mulberry(4242);
  const pos = new Float32Array(EMBER_COUNT * 3);
  const seed = new Float32Array(EMBER_COUNT * 2);
  for (let i = 0; i < EMBER_COUNT; i += 1) {
    const r = 3 + Math.sqrt(rnd()) * 34;
    const a = rnd() * Math.PI * 2;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    pos.set([x, heightFor('molten')(x, z), z], i * 3);
    seed.set([rnd(), 0.5 + rnd()], i * 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 2));
  geo.computeBoundingSphere();
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    uniforms: { uTime: time, uColor: { value: color } },
    vertexShader: /* glsl */ `
      uniform float uTime;
      attribute vec2 aSeed;
      varying float vA;
      void main() {
        float life = fract(aSeed.x + uTime * 0.07 * aSeed.y);
        vec3 p = position;
        p.y += life * 7.0;
        p.x += sin(uTime * 0.6 + aSeed.x * 40.0) * 0.5 * life;
        p.z += cos(uTime * 0.5 + aSeed.x * 31.0) * 0.5 * life;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vA = smoothstep(0.0, 0.1, life) * (1.0 - smoothstep(0.55, 1.0, life));
        gl_PointSize = clamp(90.0 / -mv.z, 1.0, 6.0) * aSeed.y;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = (1.0 - smoothstep(0.2, 1.0, d)) * vA;
        gl_FragColor = vec4(uColor * a, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const pts = new THREE.Points(geo, mat);
  pts.raycast = () => undefined;
  return pts;
};

interface VegetationProps {
  planet: Planet;
  /** Beacon XZ positions to keep clear */
  beacons: Array<[number, number]>;
  reducedMotion?: boolean;
}

/** Thinner understory on phones; the shelter layers others grow around keep their count */
const TOUCH_DENSITY = 0.6;
/** Plants kept on the low tier (see gpuTier), shelter layers included */
const LOW_DENSITY = 0.5;

const Vegetation = ({ planet, beacons, reducedMotion }: VegetationProps) => {
  const isTouch = useAppStore((s) => s.isTouch);
  const low = useAppStore((s) => s.quality === 'low');
  const camera = useThree((s) => s.camera);
  const env = useMemo<FloraEnv>(
    () => ({
      time: { value: 0 },
      viewer: { value: new THREE.Vector3(0, 1000, 0) },
      wind: { value: new THREE.Vector2(...WIND[planet.style]) },
    }),
    [planet.style],
  );

  const meshes = useMemo(() => {
    const seed = seedOf(planet.id);
    const anchors = new Map<string, Placed[]>();
    return buildLayers(planet, env).map((layer, i) => {
      const density = low ? LOW_DENSITY : isTouch && !layer.keep ? TOUCH_DENSITY : 1;
      const count = Math.round(layer.count * density);
      const mesh = new THREE.InstancedMesh(layer.geo, layer.mat, count);
      fillInstances(mesh, layer, beacons, seed + i * 101, planet.style, anchors);
      mesh.castShadow = layer.shadow;
      mesh.receiveShadow = true;
      mesh.raycast = () => undefined;
      return mesh;
    });
  }, [planet, beacons, env, isTouch, low]);

  const embers = useMemo(
    () =>
      planet.style === 'molten'
        ? buildEmbers(new THREE.Color('#ff8a3a').lerp(new THREE.Color(planet.accent), 0.25).multiplyScalar(2.2), env.time)
        : null,
    [planet, env],
  );
  useEffect(
    () => () => {
      embers?.geometry.dispose();
      (embers?.material as THREE.Material | undefined)?.dispose();
    },
    [embers],
  );

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
    // reduced motion: wind, pulses and the reaction to the viewer all hold still
    if (reducedMotion) return;
    env.time.value += dt;
    env.viewer.value.copy(camera.position);
  });

  return (
    <group>
      {meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
      {embers && <primitive object={embers} />}
    </group>
  );
};

export default Vegetation;
