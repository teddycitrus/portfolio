import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { Planet } from '@/types/content';
import { useAppStore } from '@/state/useAppStore';
import { addRim, noRaycast } from './common';

/*
 * The about planet's camp, where I sit: a log by the fire, me on it with a
 * laptop on my lap, and my head coming up from the screen to look at whoever
 * walks over. Built from simple shapes in the camp's frame, facing the landing
 * pad (+z); the fire is out to the right (site.ts CAMP_FIRE).
 */

/** Height the orbs and screens are laid out against: me, seated */
export const CAMP_HEIGHT = 1.7;
/** Within this distance (XZ) I look up at the visitor */
const LOOK_NEAR = 7;
/** How far the head may turn and tilt toward the visitor */
const MAX_YAW = 1.1;
const MAX_PITCH = 0.55;
/** Looking down at the laptop at rest */
const REST_PITCH = 0.42;
/** I sit turned this far toward the fire */
const BODY_YAW = 0.45;

type V3 = [number, number, number];

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

/** A capsule from a to b (arms, legs). */
const Limb = ({ a, b, r, material }: { a: V3; b: V3; r: number; material: THREE.Material }) => {
  const t = useMemo(() => {
    _a.set(...a);
    _b.set(...b);
    const len = _a.distanceTo(_b);
    const dir = _b.clone().sub(_a).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(UP, dir);
    const mid = _a.clone().add(_b).multiplyScalar(0.5);
    return { len, q, mid };
  }, [a, b]);
  return (
    <mesh material={material} position={t.mid} quaternion={t.q} castShadow raycast={noRaycast}>
      <capsuleGeometry args={[r, Math.max(0.01, t.len), 4, 10]} />
    </mesh>
  );
};

const Mirror = ({ children }: { children: (s: 1 | -1) => JSX.Element }) => (
  <>
    {children(1)}
    {children(-1)}
  </>
);

export const Camp = ({
  planet,
  ids,
  rim,
  rimColor,
  reducedMotion,
}: {
  planet: Planet;
  /** The beacons this camp stands for: any of them focused counts as being visited */
  ids: string[];
  rim: number;
  rimColor?: THREE.Color;
  reducedMotion?: boolean;
}) => {
  const camera = useThree((s) => s.camera);
  const head = useRef<THREE.Group>(null);
  const chest = useRef<THREE.Group>(null);
  const hands = useRef<THREE.Group>(null);
  const look = useRef({ w: 0, yaw: 0, pitch: 0 });

  const m = useMemo(() => {
    const rc = rimColor ?? new THREE.Color(planet.accent);
    const std = (color: string, roughness: number, metalness = 0, edge = 0.1) =>
      addRim(new THREE.MeshStandardMaterial({ color, roughness, metalness }), rc, rim * edge);
    return {
      skin: std('#8a5638', 0.55, 0, 0.14),
      hair: std('#121010', 0.7),
      hoodie: std('#2b3245', 0.85, 0, 0.16),
      jeans: std('#34445e', 0.9),
      shoe: std('#e8e6e1', 0.6),
      sole: std('#2a2a2a', 0.8),
      frame: new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.35, metalness: 0.4 }),
      lens: new THREE.MeshStandardMaterial({
        color: '#a9c6ff',
        roughness: 0.05,
        metalness: 0.2,
        transparent: true,
        opacity: 0.12,
        emissive: new THREE.Color('#5f86c8'),
        emissiveIntensity: 0.08,
      }),
      eye: new THREE.MeshStandardMaterial({ color: '#1a110b', roughness: 0.3 }),
      wood: new THREE.MeshStandardMaterial({ color: '#5a3b24', roughness: 0.9, flatShading: true }),
      bark: new THREE.MeshStandardMaterial({ color: '#3d2716', roughness: 1, flatShading: true }),
      laptop: new THREE.MeshStandardMaterial({ color: '#b7bac0', roughness: 0.35, metalness: 0.75 }),
      keys: new THREE.MeshStandardMaterial({ color: '#2a2c30', roughness: 0.6 }),
      screen: new THREE.MeshBasicMaterial({ color: new THREE.Color('#9cc3ff').multiplyScalar(1.1), toneMapped: false }),
    };
  }, [planet, rim, rimColor]);
  useEffect(() => () => Object.values(m).forEach((x) => x.dispose()), [m]);

  useFrame(({ clock }, delta) => {
    const dt = Math.min(delta, 0.05);
    const t = clock.elapsedTime;
    const h = head.current;
    if (!h) return;
    const store = useAppStore.getState();
    const s = look.current;

    // where the visitor is, as seen from my neck
    const pivot = h.getWorldPosition(_a);
    const to = _b.copy(camera.position).sub(pivot);
    const near = Math.hypot(to.x, to.z) < LOOK_NEAR || (!!store.focusedBeaconId && ids.includes(store.focusedBeaconId));
    const engaged = near && store.mode === 'planet';
    h.parent!.getWorldQuaternion(_q).invert();
    to.applyQuaternion(_q);
    const yaw = THREE.MathUtils.clamp(Math.atan2(to.x, to.z), -MAX_YAW, MAX_YAW);
    const pitch = THREE.MathUtils.clamp(Math.atan2(to.y, Math.hypot(to.x, to.z)), -MAX_PITCH, MAX_PITCH);

    const k = 1 - Math.exp(-(reducedMotion ? 30 : 3.2) * dt);
    s.w += ((engaged ? 1 : 0) - s.w) * k;
    s.yaw += (yaw - s.yaw) * k;
    s.pitch += (pitch - s.pitch) * k;
    // glancing over the laptop, a small idle drift while working
    const idle = reducedMotion ? 0 : Math.sin(t * 0.37) * 0.08;
    h.rotation.y = idle * (1 - s.w) + s.yaw * s.w;
    h.rotation.x = REST_PITCH * (1 - s.w) - s.pitch * s.w;

    if (!reducedMotion) {
      // breathing, and typing while nobody is around
      chest.current?.scale.set(1, 1 + Math.sin(t * 1.6) * 0.012, 1 + Math.sin(t * 1.6) * 0.02);
      if (hands.current) hands.current.position.y = (1 - s.w) * Math.abs(Math.sin(t * 9)) * 0.008;
    }
  });

  return (
    <group>
      {/* the log I sit on */}
      <mesh material={m.bark} position={[0, 0.2, -0.02]} rotation={[0, 0, Math.PI / 2]} castShadow receiveShadow raycast={noRaycast}>
        <cylinderGeometry args={[0.2, 0.22, 1.8, 9]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} material={m.wood} position={[s * 0.9, 0.2, -0.02]} rotation={[0, 0, Math.PI / 2]} raycast={noRaycast}>
          <cylinderGeometry args={[0.17, 0.17, 0.02, 9]} />
        </mesh>
      ))}

      <group rotation={[0, BODY_YAW, 0]}>
        {/* hips and legs, knees up a little, feet on the ground */}
        <mesh material={m.jeans} position={[0, 0.5, -0.02]} rotation={[0, 0, Math.PI / 2]} scale={[0.8, 1, 1.05]} castShadow raycast={noRaycast}>
          <capsuleGeometry args={[0.1, 0.16, 4, 12]} />
        </mesh>
        <Mirror>
          {(s) => (
            <group key={s}>
              <Limb a={[s * 0.1, 0.5, 0]} b={[s * 0.12, 0.54, 0.47]} r={0.078} material={m.jeans} />
              <Limb a={[s * 0.12, 0.53, 0.48]} b={[s * 0.14, 0.11, 0.53]} r={0.063} material={m.jeans} />
              <mesh material={m.shoe} position={[s * 0.14, 0.06, 0.6]} castShadow raycast={noRaycast}>
                <boxGeometry args={[0.11, 0.08, 0.27]} />
              </mesh>
              <mesh material={m.sole} position={[s * 0.14, 0.012, 0.6]} raycast={noRaycast}>
                <boxGeometry args={[0.115, 0.025, 0.28]} />
              </mesh>
            </group>
          )}
        </Mirror>

        {/* torso in a hoodie, leaning a little toward the laptop */}
        <group ref={chest} position={[0, 0.58, 0]} rotation={[0.16, 0, 0]}>
          <mesh material={m.hoodie} position={[0, 0.27, 0]} scale={[1.28, 1, 0.82]} castShadow raycast={noRaycast}>
            <capsuleGeometry args={[0.17, 0.3, 6, 14]} />
          </mesh>
          {/* hood bunched behind the neck */}
          <mesh material={m.hoodie} position={[0, 0.5, -0.1]} scale={[1.2, 0.6, 0.9]} castShadow raycast={noRaycast}>
            <torusGeometry args={[0.1, 0.045, 8, 16]} />
          </mesh>
          <mesh material={m.skin} position={[0, 0.56, 0.03]} castShadow raycast={noRaycast}>
            <cylinderGeometry args={[0.052, 0.058, 0.12, 12]} />
          </mesh>

          {/* arms down to the keyboard */}
          <Mirror>
            {(s) => (
              <group key={s}>
                <mesh material={m.hoodie} position={[s * 0.22, 0.44, 0]} castShadow raycast={noRaycast}>
                  <sphereGeometry args={[0.075, 12, 10]} />
                </mesh>
                <Limb a={[s * 0.23, 0.43, 0]} b={[s * 0.25, 0.17, 0.15]} r={0.056} material={m.hoodie} />
                <Limb a={[s * 0.25, 0.17, 0.15]} b={[s * 0.1, 0.12, 0.36]} r={0.048} material={m.hoodie} />
              </group>
            )}
          </Mirror>

          {/* the head: turns on the neck, glasses on */}
          <group ref={head} position={[0, 0.6, 0.04]} rotation={[REST_PITCH, 0, 0]}>
            <group position={[0, 0.12, 0.01]}>
              <mesh material={m.skin} scale={[0.88, 1.1, 0.98]} castShadow raycast={noRaycast}>
                <sphereGeometry args={[0.112, 24, 18]} />
              </mesh>
              {/* jaw */}
              <mesh material={m.skin} position={[0, -0.06, 0.03]} scale={[0.85, 0.6, 0.85]} raycast={noRaycast}>
                <sphereGeometry args={[0.09, 18, 12]} />
              </mesh>
              {/* short black hair, fuller on top */}
              <mesh material={m.hair} position={[0, 0.035, -0.012]} scale={[0.93, 0.95, 1.02]} castShadow raycast={noRaycast}>
                <sphereGeometry args={[0.118, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
              </mesh>
              <mesh material={m.hair} position={[0, 0.085, 0.02]} scale={[1, 0.45, 1]} raycast={noRaycast}>
                <sphereGeometry args={[0.1, 18, 10]} />
              </mesh>
              {/* ears and nose */}
              <Mirror>
                {(s) => (
                  <mesh key={s} material={m.skin} position={[s * 0.1, 0, -0.005]} scale={[0.4, 1, 0.7]} raycast={noRaycast}>
                    <sphereGeometry args={[0.03, 10, 8]} />
                  </mesh>
                )}
              </Mirror>
              <mesh material={m.skin} position={[0, -0.015, 0.11]} rotation={[Math.PI / 2 - 0.25, 0, 0]} raycast={noRaycast}>
                <coneGeometry args={[0.018, 0.05, 10]} />
              </mesh>
              {/* eyes, brows, and the glasses over them */}
              <Mirror>
                {(s) => (
                  <group key={s}>
                    <mesh material={m.eye} position={[s * 0.038, 0.02, 0.094]} raycast={noRaycast}>
                      <sphereGeometry args={[0.012, 10, 8]} />
                    </mesh>
                    <mesh material={m.hair} position={[s * 0.04, 0.052, 0.098]} rotation={[0, 0, s * -0.12]} raycast={noRaycast}>
                      <boxGeometry args={[0.04, 0.008, 0.01]} />
                    </mesh>
                    <mesh material={m.frame} position={[s * 0.039, 0.018, 0.112]} scale={[1.15, 0.85, 1]} raycast={noRaycast}>
                      <torusGeometry args={[0.027, 0.0045, 6, 20]} />
                    </mesh>
                    <mesh material={m.lens} position={[s * 0.039, 0.018, 0.111]} scale={[1.15, 0.85, 1]} raycast={noRaycast}>
                      <circleGeometry args={[0.026, 18]} />
                    </mesh>
                    <mesh material={m.frame} position={[s * 0.084, 0.022, 0.06]} rotation={[0, s * 0.12, 0]} raycast={noRaycast}>
                      <boxGeometry args={[0.005, 0.006, 0.1]} />
                    </mesh>
                  </group>
                )}
              </Mirror>
              <mesh material={m.frame} position={[0, 0.024, 0.114]} raycast={noRaycast}>
                <boxGeometry args={[0.022, 0.005, 0.005]} />
              </mesh>
              {/* mouth */}
              <mesh material={m.eye} position={[0, -0.058, 0.098]} raycast={noRaycast}>
                <boxGeometry args={[0.032, 0.004, 0.004]} />
              </mesh>
            </group>
          </group>
        </group>

        {/* the laptop on my lap, its screen lighting my face */}
        <group position={[0, 0.63, 0.36]}>
          <mesh material={m.laptop} castShadow raycast={noRaycast}>
            <boxGeometry args={[0.34, 0.016, 0.23]} />
          </mesh>
          <mesh material={m.keys} position={[0, 0.0085, 0.01]} raycast={noRaycast}>
            <boxGeometry args={[0.29, 0.002, 0.12]} />
          </mesh>
          <group position={[0, 0.008, 0.115]} rotation={[-0.28, 0, 0]}>
            <mesh material={m.laptop} position={[0, 0.115, 0]} castShadow raycast={noRaycast}>
              <boxGeometry args={[0.34, 0.23, 0.01]} />
            </mesh>
            <mesh material={m.screen} position={[0, 0.115, -0.0055]} rotation={[0, Math.PI, 0]} raycast={noRaycast}>
              <planeGeometry args={[0.31, 0.2]} />
            </mesh>
            <pointLight position={[0, 0.12, -0.12]} color="#8fb6ff" intensity={0.35} distance={1.4} decay={2} />
          </group>
          <group ref={hands}>
            <Mirror>
              {(s) => (
                <mesh key={s} material={m.skin} position={[s * 0.07, 0.03, -0.02]} scale={[0.8, 0.45, 1.1]} castShadow raycast={noRaycast}>
                  <sphereGeometry args={[0.045, 12, 10]} />
                </mesh>
              )}
            </Mirror>
          </group>
        </group>
      </group>
    </group>
  );
};
