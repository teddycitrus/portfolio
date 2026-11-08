import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Planet } from '@/types/content';
import type { HeightFn } from '../Terrain';
import { MAST, PAD, SOLAR, campPoint, campfireAt, padTop } from './site';
import { addRim, Fire, noRaycast, Strut, type FireLevel } from './common';

/*
 * The about planet is a small base camp at dusk, where the beam sets you down
 * on its landing pad. A worn path leads out to the campfire, where I sit on a
 * log with my laptop (Camp.tsx). A comms mast and a solar array stand off to
 * the sides.
 */

const useKit = (planet: Planet, rimColor: THREE.Color | undefined, rim: number) =>
  useMemo(() => {
    const rc = rimColor ?? new THREE.Color(planet.accent);
    const shell = addRim(new THREE.MeshStandardMaterial({ color: '#d9d2c6', roughness: 0.55, metalness: 0.15, flatShading: true }), rc, rim * 0.14);
    const panel = addRim(new THREE.MeshStandardMaterial({ color: '#8d8478', roughness: 0.7, metalness: 0.25, flatShading: true }), rc, rim * 0.1);
    const dark = new THREE.MeshStandardMaterial({ color: '#2c2a2a', roughness: 0.8, metalness: 0.3 });
    const wood = new THREE.MeshStandardMaterial({ color: '#5a3b24', roughness: 0.9, flatShading: true });
    const solar = new THREE.MeshStandardMaterial({ color: '#1d2b4a', roughness: 0.25, metalness: 0.7, emissive: new THREE.Color('#0b1426') });
    return { shell, panel, dark, wood, solar };
  }, [planet, rimColor, rim]);

const useDispose = (mats: Record<string, THREE.Material>) =>
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);

/* ---------- the site ---------- */

/** A ribbon of trodden ground from a to b, following the terrain. */
const pathGeometry = (H: HeightFn, a: [number, number], b: [number, number], width: number) => {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(2, Math.ceil(len / 0.5));
  const nx = -(b[1] - a[1]) / len;
  const nz = (b[0] - a[0]) / len;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= n; i += 1) {
    const t = i / n;
    const x = a[0] + (b[0] - a[0]) * t;
    const z = a[1] + (b[1] - a[1]) * t;
    // a little wander so it reads as worn in, not drawn
    const w = width * (0.85 + 0.15 * Math.sin(t * 9 + a[0]));
    for (const s of [-1, 1]) {
      const px = x + nx * s * w * 0.5;
      const pz = z + nz * s * w * 0.5;
      pos.push(px, H(px, pz) + 0.03, pz);
    }
    if (i < n) {
      const k = i * 2;
      idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
};

export const OutpostGrounds = ({
  planet,
  ground,
  rim,
  rimColor,
  reducedMotion,
}: {
  planet: Planet;
  ground: HeightFn;
  rim: number;
  rimColor?: THREE.Color;
  reducedMotion?: boolean;
}) => {
  const kit = useKit(planet, rimColor, rim);
  useDispose(kit);
  const top = useMemo(() => padTop(ground), [ground]);
  const fire = useMemo(() => campfireAt(planet), [planet]);
  const path = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(planet.palette[0]).lerp(new THREE.Color('#c9a888'), 0.5).multiplyScalar(0.8),
      roughness: 1,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    // from the pad's edge to the ground in front of me
    const end = campPoint(planet, 0.3, 1.9);
    const ex = end[0] - PAD.x;
    const ez = end[1] - PAD.z;
    const e = Math.hypot(ex, ez) || 1;
    const geos = [pathGeometry(ground, [PAD.x + (ex / e) * PAD.r, PAD.z + (ez / e) * PAD.r], end, 1.0)];
    return { m, geos };
  }, [planet, ground]);
  useEffect(
    () => () => {
      path.m.dispose();
      path.geos.forEach((g) => g.dispose());
    },
    [path],
  );
  const padLights = useRef<THREE.MeshBasicMaterial>(null);
  const beacon = useRef<THREE.MeshBasicMaterial>(null);
  const fireLevel = useRef<FireLevel>({ v: 0.85 });

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (padLights.current) padLights.current.color.set('#ffb35c').multiplyScalar(reducedMotion ? 1.2 : 0.7 + 0.6 * (0.5 + 0.5 * Math.sin(t * 2.2)));
    if (beacon.current) beacon.current.color.set('#ff3b2f').multiplyScalar(t % 1.8 < 0.25 ? 2.5 : 0.15);
  });

  const mastY = ground(MAST.x, MAST.z);
  const solarY = ground(SOLAR.x, SOLAR.z);
  return (
    <group>
      {/* the landing pad the beam sets you down on */}
      <group position={[PAD.x, top, PAD.z]}>
        <mesh material={kit.panel} position={[0, -0.4, 0]} receiveShadow raycast={noRaycast}>
          <cylinderGeometry args={[PAD.r, PAD.r + 0.1, 0.8, 6]} />
        </mesh>
        <mesh material={kit.dark} position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={noRaycast}>
          <ringGeometry args={[PAD.r * 0.55, PAD.r * 0.62, 6]} />
        </mesh>
        {Array.from({ length: 6 }, (_, i) => {
          const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
          return (
            <mesh key={i} position={[Math.cos(a) * (PAD.r - 0.15), 0.03, Math.sin(a) * (PAD.r - 0.15)]} raycast={noRaycast}>
              <boxGeometry args={[0.1, 0.05, 0.1]} />
              <meshBasicMaterial ref={i === 0 ? padLights : undefined} color="#ffb35c" toneMapped={false} />
            </mesh>
          );
        })}
      </group>
      {path.geos.map((g, i) => (
        <mesh key={i} geometry={g} material={path.m} receiveShadow raycast={noRaycast} />
      ))}
      {/* the campfire beside me, in a ring of stones */}
      {(
        <group position={[fire[0], ground(fire[0], fire[1]), fire[1]]}>
          {[0, 1, 2, 3].map((i) => (
            <mesh key={i} material={kit.wood} position={[0, 0.07, 0]} rotation={[0, (i * Math.PI) / 4, Math.PI / 2 - 0.25]} castShadow raycast={noRaycast}>
              <cylinderGeometry args={[0.05, 0.06, 0.6, 6]} />
            </mesh>
          ))}
          {Array.from({ length: 8 }, (_, i) => {
            const a = (i / 8) * Math.PI * 2;
            return (
              <mesh key={i} material={kit.panel} position={[Math.cos(a) * 0.42, 0.05, Math.sin(a) * 0.42]} raycast={noRaycast}>
                <dodecahedronGeometry args={[0.09, 0]} />
              </mesh>
            );
          })}
          <group position={[0, 0.1, 0]}>
            <Fire level={fireLevel.current} size={0.55} ground={-0.1} pool={4.5} reducedMotion={reducedMotion} seed={3} />
          </group>
        </group>
      )}
      {/* comms mast */}
      <group position={[MAST.x, mastY, MAST.z]}>
        <mesh material={kit.panel} position={[0, 0.15, 0]} castShadow raycast={noRaycast}>
          <boxGeometry args={[1.0, 0.3, 1.0]} />
        </mesh>
        {[
          [-0.3, -0.3],
          [0.3, -0.3],
          [0.3, 0.3],
          [-0.3, 0.3],
        ].map(([x, z]) => (
          <Strut key={`${x}${z}`} a={[x, 0.3, z]} b={[x * 0.25, 6.2, z * 0.25]} r={0.035} material={kit.dark} />
        ))}
        <mesh material={kit.shell} position={[0.3, 4.6, 0]} rotation={[0, 0, -0.9]} castShadow raycast={noRaycast}>
          <sphereGeometry args={[0.55, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.32]} />
        </mesh>
        <mesh position={[0, 6.3, 0]} raycast={noRaycast}>
          <sphereGeometry args={[0.09, 8, 6]} />
          <meshBasicMaterial ref={beacon} color="#ff3b2f" toneMapped={false} />
        </mesh>
      </group>
      {/* solar array */}
      <group position={[SOLAR.x, solarY, SOLAR.z]} rotation={[0, SOLAR.yaw, 0]}>
        {[-1.3, 0, 1.3].map((x) => (
          <group key={x} position={[x, 0, 0]}>
            <Strut a={[0, 0, 0]} b={[0, 0.9, 0]} r={0.05} material={kit.dark} />
            <mesh material={kit.solar} position={[0, 1.0, 0]} rotation={[-0.75, 0, 0]} castShadow raycast={noRaycast}>
              <boxGeometry args={[1.15, 0.04, 1.6]} />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  );
};
