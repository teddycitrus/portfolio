import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ResolvedSky } from '@/data/skyPresets';
import { flight } from '@/state/runtime';
import { ARRIVAL_MS } from '@/state/timing';
import { shipSound } from '@/audio/drone';

/*
 * The ship that dropped the viewer off. It sits on the ground just behind the
 * spawn while the viewer steps out, then lifts off, passes low overhead into
 * view, climbs away and holds station high above: out of view at the resting
 * pitch, in view once you look up past about 40 degrees. Fog would erase it
 * at that range, so the hull is tinted toward the sky by distance instead.
 */

/** Takeoff starts this long after the hatch has opened, and lasts TAKEOFF_MS */
const TAKEOFF_DELAY_MS = 350;
const TAKEOFF_MS = 7000;
/** Flight path: parked behind the spawn, low over the viewer, out ahead, up to station */
const P1 = new THREE.Vector3(0, 52, -20);
const P2 = new THREE.Vector3(10, 45, -190);
/** Station: about 53 degrees above the horizon from the spawn */
const STATION = new THREE.Vector3(40, 245, -175);
/** Broadside to the landing spot, so looking up shows its full profile */
const STATION_YAW = -0.22;
/** Hull runs along x; it waits broadside behind the viewer, low enough that its ring clears the ground */
const PARK_Z = 30;
const PARK_LIFT = 21;
/** Share of the sky colour mixed into the hull at station range, standing in for aerial haze */
const HAZE = 0.42;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const _p = new THREE.Vector3();
const _base = new THREE.Color();

const noRaycast = () => null;

interface Props {
  sky: ResolvedSky;
  /** Ground height at (x, z) */
  ground: (x: number, z: number) => number;
  reducedMotion?: boolean;
}

const Mothership = ({ sky, ground, reducedMotion }: Props) => {
  const root = useRef<THREE.Group>(null);
  const roared = useRef(false);
  const park = useMemo(() => new THREE.Vector3(0, ground(0, PARK_Z) + PARK_LIFT, PARK_Z), [ground]);
  const strobe = useRef<THREE.MeshBasicMaterial>(null);
  const beacon = useRef<THREE.MeshBasicMaterial>(null);

  const parts = useMemo(() => {
    const haze = sky.fogColor.clone();
    const hull = new THREE.MeshStandardMaterial({ color: '#5d6573', metalness: 0.4, roughness: 0.6, fog: false });
    const dark = new THREE.MeshStandardMaterial({ color: '#2b3039', metalness: 0.3, roughness: 0.7, fog: false });
    const glow = (c: string, k = 1) =>
      new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), fog: false, toneMapped: false });
    const engine = glow('#9cc8ff', 2.2);
    const windows = glow('#ffd59a', 1.3);

    // window rows along both flanks
    const winGeo = new THREE.BoxGeometry(0.9, 0.35, 0.2);
    const winMats: THREE.Matrix4[] = [];
    const o = new THREE.Object3D();
    for (const side of [-1, 1])
      for (const row of [0.6, -0.9])
        for (let x = -24; x <= 22; x += 1.7) {
          if (Math.sin(x * 3.1 + row * 7 + side) > 0.55) continue;
          // on the flattened hull surface: radius tapers from 4.6 at the prow to 6.4 aft
          const r = 5.5 + (x / 54) * 1.8;
          o.position.set(x, row, side * (0.62 * Math.sqrt(r * r - row * row) + 0.05));
          o.rotation.set(0, 0, 0);
          o.updateMatrix();
          winMats.push(o.matrix.clone());
        }
    return { haze, hull, dark, engine, windows, winGeo, winMats, red: glow('#ff3b30', 2), green: glow('#2bff88', 2) };
  }, [sky]);

  useEffect(
    () => () => {
      for (const m of [parts.hull, parts.dark, parts.engine, parts.windows, parts.red, parts.green]) m.dispose();
      parts.winGeo.dispose();
    },
    [parts],
  );

  const winRef = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const m = winRef.current;
    if (!m) return;
    parts.winMats.forEach((mx, i) => m.setMatrixAt(i, mx));
    m.instanceMatrix.needsUpdate = true;
  }, [parts]);

  useFrame(({ clock, camera }) => {
    const g = root.current;
    if (!g) return;
    const t = clock.elapsedTime;
    const ms = flight.arrivalMs;
    // before the first planet frame the arrival clock is -1: sit on the pad
    const k = reducedMotion ? 1 : ms < 0 ? 0 : Math.min(1, Math.max(0, (ms - ARRIVAL_MS - TAKEOFF_DELAY_MS) / TAKEOFF_MS));
    if (k > 0 && k < 1 && !roared.current) {
      roared.current = true;
      shipSound('takeoff');
    }
    if (k <= 0) roared.current = false;

    // one cubic curve from the pad to station; the easing gives a slow lift and a long glide in
    const u = easeInOut(k);
    const a = 1 - u;
    _p.copy(park)
      .multiplyScalar(a * a * a)
      .addScaledVector(P1, 3 * a * a * u)
      .addScaledVector(P2, 3 * a * u * u)
      .addScaledVector(STATION, u * u * u);
    // holding station: a slow heave and drift, fading in as it arrives
    const hold = reducedMotion ? 0 : smooth(0.85, 1, k);
    _p.x += Math.sin(t * 0.05) * 3 * hold;
    _p.y += Math.sin(t * 0.13) * 1.4 * hold;
    g.position.copy(_p);
    // prow onto the flight path, nose up through the climb, then onto the station heading
    const yaw = (-Math.PI / 2) * smooth(0.02, 0.3, k) + (STATION_YAW + Math.PI / 2) * smooth(0.6, 1, k);
    const pitch = 0.22 * Math.sin(Math.PI * smooth(0.05, 0.8, k));
    const bank = 0.14 * Math.sin(Math.PI * smooth(0.55, 1, k));
    g.rotation.set(bank + Math.sin(t * 0.09) * 0.012 * hold, yaw + Math.sin(t * 0.04) * 0.03 * hold, -pitch, 'YZX');

    // aerial haze by distance; the engines open up for the climb
    const d = camera.position.distanceTo(g.position);
    const hz = HAZE * smooth(40, 320, d);
    parts.hull.color.copy(_base.set('#5d6573')).lerp(parts.haze, hz);
    parts.hull.emissive.copy(parts.haze).multiplyScalar(0.66 * hz);
    parts.dark.color.copy(_base.set('#2b3039')).lerp(parts.haze, hz);
    parts.dark.emissive.copy(parts.haze).multiplyScalar(0.52 * hz);
    const burn = k > 0 && k < 1 ? 1 + 2.2 * Math.sin(Math.PI * Math.min(1, k * 1.6)) : 1;
    parts.engine.color.set('#9cc8ff').multiplyScalar(2.2 * burn);
    const s = strobe.current;
    if (s) s.color.setScalar(t % 1.6 < 0.07 ? 4 : 0.05);
    const b = beacon.current;
    if (b) b.color.setRGB(1, 0.22, 0.18).multiplyScalar(0.25 + 2.2 * Math.max(0, Math.sin(t * 2.4)));
  });

  return (
    <group ref={root} scale={1.5} raycast={noRaycast}>
      {/* main hull: a long tapered body, flattened, running along x */}
      <mesh material={parts.hull} rotation={[0, 0, Math.PI / 2]} scale={[1, 1, 0.62]} raycast={noRaycast}>
        <cylinderGeometry args={[4.6, 6.4, 54, 10, 1]} />
      </mesh>
      {/* prow */}
      <mesh material={parts.hull} position={[-33, 0, 0]} rotation={[0, 0, Math.PI / 2]} scale={[1, 1, 0.62]} raycast={noRaycast}>
        <coneGeometry args={[4.6, 12, 10]} />
      </mesh>
      {/* dorsal spine and bridge */}
      <mesh material={parts.dark} position={[2, 4.2, 0]} raycast={noRaycast}>
        <boxGeometry args={[34, 2.4, 4.2]} />
      </mesh>
      <mesh material={parts.hull} position={[-8, 6.2, 0]} raycast={noRaycast}>
        <boxGeometry args={[7, 2.2, 3.2]} />
      </mesh>
      {/* ventral keel */}
      <mesh material={parts.dark} position={[4, -3.8, 0]} raycast={noRaycast}>
        <boxGeometry args={[40, 1.6, 3]} />
      </mesh>
      {/* habitat ring on its spokes */}
      <group position={[6, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
        <mesh material={parts.hull} raycast={noRaycast}>
          <torusGeometry args={[13, 1.3, 8, 40]} />
        </mesh>
        {[0, 1, 2, 3].map((k) => (
          <mesh key={k} material={parts.dark} rotation={[0, 0, (k * Math.PI) / 4]} raycast={noRaycast}>
            <boxGeometry args={[26, 0.7, 0.7]} />
          </mesh>
        ))}
      </group>
      {/* engine block and three nozzles burning low */}
      <mesh material={parts.dark} position={[29, 0, 0]} raycast={noRaycast}>
        <boxGeometry args={[6, 9, 12]} />
      </mesh>
      {[
        [0, 2.4],
        [-2.4, -2.4],
        [2.4, -2.4],
      ].map(([z, y]) => (
        <group key={`${z}:${y}`} position={[32.5, y, z]} rotation={[0, 0, Math.PI / 2]}>
          <mesh material={parts.hull} raycast={noRaycast}>
            <cylinderGeometry args={[1.9, 1.4, 3, 12]} />
          </mesh>
          <mesh material={parts.engine} position={[0, -1.55, 0]} rotation={[Math.PI, 0, 0]} raycast={noRaycast}>
            <circleGeometry args={[1.7, 16]} />
          </mesh>
        </group>
      ))}
      <instancedMesh ref={winRef} args={[parts.winGeo, parts.windows, parts.winMats.length]} raycast={noRaycast} />
      {/* navigation lights: red to port, green to starboard, a white strobe, a red beacon underneath */}
      <mesh material={parts.red} position={[4, 0, -14.4]} raycast={noRaycast}>
        <sphereGeometry args={[0.6, 8, 6]} />
      </mesh>
      <mesh material={parts.green} position={[4, 0, 14.4]} raycast={noRaycast}>
        <sphereGeometry args={[0.6, 8, 6]} />
      </mesh>
      <mesh position={[-38.5, 0, 0]} raycast={noRaycast}>
        <sphereGeometry args={[0.55, 8, 6]} />
        <meshBasicMaterial ref={strobe} color="#ffffff" fog={false} toneMapped={false} />
      </mesh>
      <mesh position={[0, -4.8, 0]} raycast={noRaycast}>
        <sphereGeometry args={[0.6, 8, 6]} />
        <meshBasicMaterial ref={beacon} color="#ff3b30" fog={false} toneMapped={false} />
      </mesh>
    </group>
  );
};

export default Mothership;
