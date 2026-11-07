import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/*
 * The ship's hull, shared by the mothership over a planet and the intro in
 * orbit: a long tapered body running along x with the prow at -x, a dorsal
 * spine and bridge, a habitat ring, an engine block, window rows and
 * navigation lights. The caller owns placement and scale (1.5 in both uses).
 */

const noRaycast = () => null;

export const HULL_COLOR = '#5d6573';
export const DARK_COLOR = '#2b3039';

export type HullParts = ReturnType<typeof useHullParts>;

export const useHullParts = () => {
  const parts = useMemo(() => {
    const hull = new THREE.MeshStandardMaterial({ color: HULL_COLOR, metalness: 0.4, roughness: 0.6, fog: false });
    const dark = new THREE.MeshStandardMaterial({ color: DARK_COLOR, metalness: 0.3, roughness: 0.7, fog: false });
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
    return { hull, dark, engine, windows, winGeo, winMats, red: glow('#ff3b30', 2), green: glow('#2bff88', 2) };
  }, []);

  useEffect(
    () => () => {
      for (const m of [parts.hull, parts.dark, parts.engine, parts.windows, parts.red, parts.green]) m.dispose();
      parts.winGeo.dispose();
    },
    [parts],
  );
  return parts;
};

const ShipHull = ({ parts }: { parts: HullParts }) => {
  const strobe = useRef<THREE.MeshBasicMaterial>(null);
  const beacon = useRef<THREE.MeshBasicMaterial>(null);
  const winRef = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const m = winRef.current;
    if (!m) return;
    parts.winMats.forEach((mx, i) => m.setMatrixAt(i, mx));
    m.instanceMatrix.needsUpdate = true;
  }, [parts]);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const s = strobe.current;
    if (s) s.color.setScalar(t % 1.6 < 0.07 ? 4 : 0.05);
    const b = beacon.current;
    if (b) b.color.setRGB(1, 0.22, 0.18).multiplyScalar(0.25 + 2.2 * Math.max(0, Math.sin(t * 2.4)));
  });

  return (
    <>
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
    </>
  );
};

export default ShipHull;
