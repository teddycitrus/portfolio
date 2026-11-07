import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Beacon as BeaconData, Planet } from '@/types/content';
import { getBeaconFacing, getBeaconPosition } from '@/data/content';
import type { HeightFn } from '../Terrain';
import { MAST, PAD, SOLAR, campfireAt, outpostKind, padTop, type OutpostKind } from './site';
import { addRim, Fire, glowMaterial, noRaycast, Strut, type FireLevel } from './common';

/*
 * The about planet is a small base camp at dusk, where the beam sets you down
 * on its landing pad. Paths lead out to three buildings: the hab, lit up with
 * a campfire out front (hello), an observatory with its telescope out (where
 * the studying happens), and an open workshop with something half built on
 * the bench and a welder sparking (what I'm working toward). A comms mast and
 * a solar array stand off to the sides.
 */

export const OUTPOST_HEIGHT: Record<OutpostKind, number> = { hab: 3.1, observatory: 3.2, workshop: 2.75 };

const useKit = (planet: Planet, rimColor: THREE.Color | undefined, rim: number) =>
  useMemo(() => {
    const rc = rimColor ?? new THREE.Color(planet.accent);
    const shell = addRim(new THREE.MeshStandardMaterial({ color: '#d9d2c6', roughness: 0.55, metalness: 0.15, flatShading: true }), rc, rim * 0.14);
    const panel = addRim(new THREE.MeshStandardMaterial({ color: '#8d8478', roughness: 0.7, metalness: 0.25, flatShading: true }), rc, rim * 0.1);
    const dark = new THREE.MeshStandardMaterial({ color: '#2c2a2a', roughness: 0.8, metalness: 0.3 });
    const accent = new THREE.MeshStandardMaterial({ color: '#d9692c', roughness: 0.5, metalness: 0.2 });
    const wood = new THREE.MeshStandardMaterial({ color: '#5a3b24', roughness: 0.9, flatShading: true });
    const warm = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffc98a'), toneMapped: false });
    const cool = new THREE.MeshBasicMaterial({ color: new THREE.Color('#9fd8ff'), toneMapped: false });
    const red = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff3b2f'), toneMapped: false });
    const solar = new THREE.MeshStandardMaterial({ color: '#1d2b4a', roughness: 0.25, metalness: 0.7, emissive: new THREE.Color('#0b1426') });
    return { shell, panel, dark, accent, wood, warm, cool, red, solar };
  }, [planet, rimColor, rim]);

type Kit = ReturnType<typeof useKit>;

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
    const geos = planet.beacons.map((_, i) => {
      const p = getBeaconPosition(planet, i);
      const [fx, fz] = getBeaconFacing(planet, p);
      const dx = fx - p[0];
      const dz = fz - p[2];
      const d = Math.hypot(dx, dz) || 1;
      // from the pad's edge to the building's door
      const door: [number, number] = [p[0] + (dx / d) * 1.6, p[2] + (dz / d) * 1.6];
      const ex = door[0] - PAD.x;
      const ez = door[1] - PAD.z;
      const e = Math.hypot(ex, ez) || 1;
      return pathGeometry(ground, [PAD.x + (ex / e) * PAD.r, PAD.z + (ez / e) * PAD.r], door, 1.0);
    });
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
      {/* the campfire in front of the hab, with a couple of log seats */}
      {fire && (
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
          {[-1, 1].map((s) => (
            <mesh key={s} material={kit.wood} position={[s * 1.15, 0.2, 0.3]} rotation={[0, s * 0.5, Math.PI / 2]} castShadow raycast={noRaycast}>
              <cylinderGeometry args={[0.18, 0.2, 0.9, 7]} />
            </mesh>
          ))}
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

/* ---------- the buildings ---------- */

const Hab = ({ kit, glow }: { kit: Kit; glow: THREE.Material }) => (
  <group>
    {/* footing, so the module sits level on uneven ground */}
    <mesh material={kit.panel} position={[0, -0.25, 0]} receiveShadow raycast={noRaycast}>
      <boxGeometry args={[3.2, 0.7, 1.6]} />
    </mesh>
    {[-1.1, 1.1].map((x) => (
      <mesh key={x} material={kit.dark} position={[x, 0.3, 0]} castShadow raycast={noRaycast}>
        <boxGeometry args={[0.25, 0.5, 1.4]} />
      </mesh>
    ))}
    <group position={[0, 1.45, 0]} rotation={[0, 0, Math.PI / 2]}>
      <mesh material={kit.shell} castShadow receiveShadow raycast={noRaycast}>
        <capsuleGeometry args={[0.95, 1.9, 6, 14]} />
      </mesh>
      {[-0.55, 0.55].map((y) => (
        <mesh key={y} material={kit.accent} position={[0, y, 0]} raycast={noRaycast}>
          <cylinderGeometry args={[0.965, 0.965, 0.14, 14]} />
        </mesh>
      ))}
    </group>
    {/* lit portholes and the door, facing the camp */}
    {[-1.15, -0.6, 0.6].map((x) => (
      <group key={x} position={[x, 1.6, 0.955]}>
        <mesh material={kit.dark} rotation={[Math.PI / 2, 0, 0]} raycast={noRaycast}>
          <torusGeometry args={[0.17, 0.035, 6, 16]} />
        </mesh>
        <mesh material={glow} raycast={noRaycast}>
          <circleGeometry args={[0.15, 16]} />
        </mesh>
      </group>
    ))}
    <group position={[0.05, 1.12, 0.97]}>
      <mesh material={kit.dark} raycast={noRaycast}>
        <boxGeometry args={[0.62, 1.05, 0.06]} />
      </mesh>
      <mesh material={glow} position={[0, 0.1, 0.035]} raycast={noRaycast}>
        <planeGeometry args={[0.4, 0.62]} />
      </mesh>
    </group>
    {[0, 1].map((k) => (
      <mesh key={k} material={kit.panel} position={[0.05, 0.12 + k * 0.2, 1.3 - k * 0.25]} castShadow receiveShadow raycast={noRaycast}>
        <boxGeometry args={[0.8, 0.2 + k * 0.2, 0.3]} />
      </mesh>
    ))}
    {/* a dish on the roof */}
    <Strut a={[1.0, 2.3, 0]} b={[1.0, 2.75, 0]} r={0.035} material={kit.dark} />
    <mesh material={kit.shell} position={[1.0, 2.85, 0]} rotation={[0.9, 0.4, 0]} castShadow raycast={noRaycast}>
      <sphereGeometry args={[0.3, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.35]} />
    </mesh>
  </group>
);

const Observatory = ({ kit, glow, dome }: { kit: Kit; glow: THREE.Material; dome: MutableRefObject<THREE.Group | null> }) => (
  <group>
    <mesh material={kit.panel} position={[0, 0.2, 0]} castShadow receiveShadow raycast={noRaycast}>
      <cylinderGeometry args={[1.25, 1.35, 1.6, 12]} />
    </mesh>
    <mesh material={kit.dark} position={[0, 1.02, 0]} raycast={noRaycast}>
      <cylinderGeometry args={[1.3, 1.3, 0.1, 12]} />
    </mesh>
    <group position={[0, 0.65, 1.22]}>
      <mesh material={kit.dark} raycast={noRaycast}>
        <boxGeometry args={[0.55, 0.9, 0.12]} />
      </mesh>
      <mesh material={glow} position={[0, 0.25, 0.065]} raycast={noRaycast}>
        <planeGeometry args={[0.3, 0.2]} />
      </mesh>
    </group>
    <group ref={dome} position={[0, 1.07, 0]}>
      <mesh material={kit.shell} castShadow raycast={noRaycast}>
        <sphereGeometry args={[1.22, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </mesh>
      {/* the slit, lit from inside, and the telescope through it */}
      <mesh material={glow} position={[0, 0.8, 0.94]} rotation={[-0.88, 0, 0]} raycast={noRaycast}>
        <boxGeometry args={[0.36, 1.0, 0.05]} />
      </mesh>
      <group position={[0, 0.35, 0.2]} rotation={[0.75, 0, 0]}>
        <mesh material={kit.dark} position={[0, 0.85, 0]} castShadow raycast={noRaycast}>
          <cylinderGeometry args={[0.13, 0.17, 1.5, 10]} />
        </mesh>
        <mesh material={kit.accent} position={[0, 1.55, 0]} raycast={noRaycast}>
          <cylinderGeometry args={[0.16, 0.16, 0.12, 10]} />
        </mesh>
      </group>
    </group>
  </group>
);

const Workshop = ({
  kit,
  glow,
  spark,
  sparkGlow,
}: {
  kit: Kit;
  glow: THREE.Material;
  spark: THREE.Material;
  sparkGlow: THREE.Material;
}) => (
  <group>
    <mesh material={kit.panel} position={[0, -0.2, 0]} receiveShadow raycast={noRaycast}>
      <boxGeometry args={[3.0, 0.6, 2.4]} />
    </mesh>
    {/* back and side walls, open to the camp */}
    <mesh material={kit.shell} position={[0, 1.2, -1.1]} castShadow receiveShadow raycast={noRaycast}>
      <boxGeometry args={[3.0, 2.2, 0.12]} />
    </mesh>
    {[-1.44, 1.44].map((x) => (
      <mesh key={x} material={kit.shell} position={[x, 1.2, -0.15]} castShadow receiveShadow raycast={noRaycast}>
        <boxGeometry args={[0.12, 2.2, 1.95]} />
      </mesh>
    ))}
    <mesh material={kit.accent} position={[0, 2.42, -0.05]} rotation={[0.18, 0, 0]} castShadow raycast={noRaycast}>
      <boxGeometry args={[3.3, 0.1, 2.6]} />
    </mesh>
    {/* tool board */}
    {[-0.9, -0.55, -0.2, 0.5, 0.85].map((x, i) => (
      <mesh key={x} material={kit.dark} position={[x, 1.55 + (i % 2) * 0.12, -1.02]} raycast={noRaycast}>
        <boxGeometry args={[0.08 + (i % 3) * 0.04, 0.35, 0.04]} />
      </mesh>
    ))}
    {/* the bench, with a drone half built on it */}
    <mesh material={kit.wood} position={[0, 0.92, -0.55]} castShadow receiveShadow raycast={noRaycast}>
      <boxGeometry args={[2.1, 0.08, 0.75]} />
    </mesh>
    {[
      [-0.95, -0.85],
      [0.95, -0.85],
      [-0.95, -0.25],
      [0.95, -0.25],
    ].map(([x, z]) => (
      <mesh key={`${x}${z}`} material={kit.dark} position={[x, 0.46, z]} raycast={noRaycast}>
        <boxGeometry args={[0.07, 0.92, 0.07]} />
      </mesh>
    ))}
    <group position={[-0.2, 1.02, -0.55]}>
      <mesh material={kit.panel} castShadow raycast={noRaycast}>
        <boxGeometry args={[0.32, 0.09, 0.32]} />
      </mesh>
      {[0, 1, 2, 3].map((i) => {
        const a = Math.PI / 4 + (i * Math.PI) / 2;
        const x = Math.cos(a) * 0.32;
        const z = Math.sin(a) * 0.32;
        return (
          <group key={i}>
            <Strut a={[0, 0.02, 0]} b={[x, 0.02, z]} r={0.018} material={kit.dark} />
            {/* one rotor still to fit */}
            {i !== 2 && (
              <mesh material={kit.accent} position={[x, 0.07, z]} raycast={noRaycast}>
                <cylinderGeometry args={[0.13, 0.13, 0.012, 14]} />
              </mesh>
            )}
          </group>
        );
      })}
    </group>
    {/* the welder sparking at the missing rotor */}
    <group position={[-0.2 + Math.cos((5 * Math.PI) / 4) * 0.32, 1.06, -0.55 + Math.sin((5 * Math.PI) / 4) * 0.32]}>
      <mesh material={spark} raycast={noRaycast}>
        <sphereGeometry args={[0.035, 8, 6]} />
      </mesh>
      <mesh material={sparkGlow} position={[0, -0.13, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={noRaycast}>
        <planeGeometry args={[2.2, 2.2]} />
      </mesh>
    </group>
    {/* a lamp over the bench */}
    <Strut a={[0.6, 2.36, -0.55]} b={[0.6, 1.85, -0.55]} r={0.012} material={kit.dark} />
    <mesh material={kit.dark} position={[0.6, 1.8, -0.55]} raycast={noRaycast}>
      <coneGeometry args={[0.16, 0.14, 10, 1, true]} />
    </mesh>
    <mesh material={glow} position={[0.6, 1.76, -0.55]} raycast={noRaycast}>
      <sphereGeometry args={[0.05, 8, 6]} />
    </mesh>
    {/* crates */}
    <mesh material={kit.wood} position={[1.05, 0.28, 0.75]} rotation={[0, 0.3, 0]} castShadow raycast={noRaycast}>
      <boxGeometry args={[0.5, 0.5, 0.5]} />
    </mesh>
    <mesh material={kit.wood} position={[1.1, 0.68, 0.7]} rotation={[0, -0.2, 0]} castShadow raycast={noRaycast}>
      <boxGeometry args={[0.35, 0.3, 0.35]} />
    </mesh>
  </group>
);

export const OutpostBuilding = ({
  beacon,
  planet,
  index,
  focus,
  rim,
  rimColor,
  reducedMotion,
}: {
  beacon: BeaconData;
  planet: Planet;
  index: number;
  focus: MutableRefObject<{ focus: number }>;
  rim: number;
  rimColor?: THREE.Color;
  reducedMotion?: boolean;
}) => {
  const kit = useKit(planet, rimColor, rim);
  useDispose(kit);
  const kind = outpostKind(beacon.id, index);
  const extra = useMemo(
    () => ({
      spark: new THREE.MeshBasicMaterial({ color: new THREE.Color('#cfe8ff'), toneMapped: false }),
      sparkGlow: glowMaterial('#8fc4ff'),
    }),
    [],
  );
  useEffect(
    () => () => {
      extra.spark.dispose();
      extra.sparkGlow.dispose();
    },
    [extra],
  );
  const dome = useRef<THREE.Group>(null);
  const glow = kind === 'observatory' ? kit.cool : kit.warm;

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const f = focus.current.focus;
    glow.color.set(kind === 'observatory' ? '#9fd8ff' : '#ffc98a').multiplyScalar(1 + f * 1.2);
    if (dome.current && !reducedMotion) dome.current.rotation.y = Math.sin(t * 0.12) * 0.5;
    if (kind === 'workshop') {
      // the welder works in bursts
      const burst = reducedMotion ? 0.6 : Math.sin(t * 1.3) > 0.1 ? 0.5 + 0.5 * Math.abs(Math.sin(t * 37) * Math.sin(t * 23)) : 0;
      extra.spark.color.set('#cfe8ff').multiplyScalar(burst * 3);
      extra.sparkGlow.uniforms.uIntensity.value = burst * 0.5;
    }
  });

  return kind === 'hab' ? (
    <Hab kit={kit} glow={glow} />
  ) : kind === 'observatory' ? (
    <Observatory kit={kit} glow={glow} dome={dome} />
  ) : (
    <Workshop kit={kit} glow={glow} spark={extra.spark} sparkGlow={extra.sparkGlow} />
  );
};

