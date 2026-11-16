import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { Planet } from '@/types/content';
import { getBeaconPosition } from '@/data/content';
import { heightFor, noise2, terrainPalette } from './Terrain';
import { siteFor } from './sites/site';
import { mulberry, seedOf } from './rng';

/** Keeps pebbles off plinths, paths and built ground */
const CLEAR = 1.8;
const SCATTER_RADIUS = 46;

const pebble = () => {
  const geo = new THREE.IcosahedronGeometry(1, 0);
  const p = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i += 1) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const k = 0.7 + noise2(x * 2.1 + 3, z * 2.1 + y * 1.7) * 0.6;
    p.setXYZ(i, x * k, y * k, z * k);
  }
  geo.computeVertexNormals();
  return geo;
};

const shard = () => new THREE.ConeGeometry(0.5, 1, 4, 1).translate(0, 0.5, 0);

interface Kind {
  geo: () => THREE.BufferGeometry;
  count: number;
  /** Largest instance */
  size: number;
  /** Height over width */
  squash: [number, number];
  tint: (pal: ReturnType<typeof terrainPalette>, rnd: () => number, out: THREE.Color) => void;
}

const stones = (count: number, size: number, squash: [number, number]): Kind => ({
  geo: pebble,
  count,
  size,
  squash,
  tint: (pal, rnd, out) => {
    out.copy(pal.rock).lerp(pal.high, rnd() * 0.5).multiplyScalar(0.75 + rnd() * 0.45);
  },
});

const KINDS: Record<Planet['style'], Kind[]> = {
  rocky: [stones(620, 0.17, [0.35, 0.8])],
  forested: [stones(420, 0.13, [0.5, 0.9])],
  oceanic: [stones(360, 0.1, [0.35, 0.7])],
  molten: [stones(700, 0.16, [0.55, 1.0])],
  'gas-giant': [
    stones(420, 0.12, [0.4, 0.8]),
    {
      geo: shard,
      count: 150,
      size: 0.15,
      squash: [1.4, 2.8],
      tint: (pal, rnd, out) => {
        out.copy(pal.high).lerp(pal.rock, rnd() * 0.5);
      },
    },
  ],
};

interface EnvScatterProps {
  planet: Planet;
  isTouch: boolean;
}

/** Small loose stones over the walkable ground. No shadows, instanced, one draw per kind. */
const EnvScatter = ({ planet, isTouch }: EnvScatterProps) => {
  const meshes = useMemo(() => {
    const H = heightFor(planet.style);
    const site = siteFor(planet, H);
    const keep: [number, number][] = [...site.clearings];
    planet.beacons.forEach((_, i) => {
      const [x, , z] = getBeaconPosition(planet, i);
      keep.push([x, z]);
    });
    const pal = terrainPalette(planet);
    const rnd = mulberry(seedOf(`${planet.id}-scatter`));
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const col = new THREE.Color();
    return KINDS[planet.style].map((kind) => {
      const target = Math.round(kind.count * (isTouch ? 0.55 : 1));
      const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, flatShading: true });
      const mesh = new THREE.InstancedMesh(kind.geo(), mat, target);
      let placed = 0;
      for (let tries = 0; tries < target * 8 && placed < target; tries += 1) {
        const r = 2 + Math.pow(rnd(), 0.7) * SCATTER_RADIUS;
        const a = rnd() * Math.PI * 2;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const y = H(x, z);
        if (planet.style === 'oceanic' && y < 0.12) continue;
        if (planet.style === 'gas-giant' && y < -1.8) continue;
        // built ground sits above the terrain here: stones would be buried or float
        if (Math.abs(site.ground(x, z) - y) > 0.02) continue;
        if (keep.some(([kx, kz]) => (kx - x) * (kx - x) + (kz - z) * (kz - z) < CLEAR * CLEAR)) continue;
        const slope = Math.abs(H(x + 0.5, z) - y) + Math.abs(H(x, z + 0.5) - y);
        if (slope > 0.55) continue;
        // clusters: mostly gravel, occasionally a larger stone among it
        const cluster = noise2(x * 0.32 + 8, z * 0.32 - 3);
        if (rnd() > 0.25 + cluster * 1.1) continue;
        const k = kind.size * (0.22 + rnd() * rnd() * 0.78);
        const sq = kind.squash[0] + rnd() * (kind.squash[1] - kind.squash[0]);
        s.set(k * (0.8 + rnd() * 0.5), k * sq, k * (0.8 + rnd() * 0.5));
        p.set(x, y - s.y * 0.25, z);
        e.set((rnd() - 0.5) * 0.5, rnd() * 6.28, (rnd() - 0.5) * 0.5);
        mesh.setMatrixAt(placed, m.compose(p, q.setFromEuler(e), s));
        kind.tint(pal, rnd, col);
        mesh.setColorAt(placed, col);
        placed += 1;
      }
      mesh.count = placed;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.raycast = () => undefined;
      return mesh;
    });
  }, [planet, isTouch]);

  useEffect(
    () => () => {
      meshes.forEach((m) => {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
        m.dispose();
      });
    },
    [meshes],
  );

  return (
    <>
      {meshes.map((m) => (
        <primitive key={m.uuid} object={m} />
      ))}
    </>
  );
};

export default EnvScatter;
