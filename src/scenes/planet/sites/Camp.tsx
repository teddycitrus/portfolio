import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { Planet } from '@/types/content';
import { useAppStore } from '@/state/useAppStore';
import { addRim, noRaycast } from './common';
import { faceZ, frameGeometry, hairGeometry, headGeometry, headHalfWidth, hoodieGeometry, lensGeometry } from './figure';

/** Warm medium brown, from the photos */
const SKIN = '#9e6b4f';
/** Rectangular lenses */
const LENS_W = 0.037;
const LENS_H = 0.024;
/** Face landmarks, head-local height */
const EYE_Y = 0.006;
const EYE_X = 0.03;
/** Half-angle of the open zip down the front of the hoodie */
const HOOD_GAP = 0.34;

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

/** A tapered rod from a (radius r0) to b (radius r1). */
const Taper = ({ a, b, r0, r1, material }: { a: V3; b: V3; r0: number; r1: number; material: THREE.Material }) => {
  const t = useMemo(() => {
    _a.set(...a);
    _b.set(...b);
    const dir = _b.clone().sub(_a);
    const len = dir.length();
    return { len, q: new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize()), mid: _a.clone().add(_b).multiplyScalar(0.5) };
  }, [a, b]);
  return (
    <mesh material={material} position={t.mid} quaternion={t.q} raycast={noRaycast}>
      <cylinderGeometry args={[r1, r0, t.len, 12]} />
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
    const face = std(SKIN, 0.62, 0, 0.12);
    face.vertexColors = true;
    return {
      skin: std(SKIN, 0.62, 0, 0.12),
      face,
      lip: std('#9a5a4c', 0.5, 0, 0.08),
      hair: Object.assign(std('#0c0a0a', 0.62, 0, 0.14), { side: THREE.DoubleSide }),
      brow: std('#0e0b0a', 0.8),
      hoodie: Object.assign(std('#3a281d', 0.95, 0, 0.16), { side: THREE.DoubleSide }),
      shirt: std('#e6dfd0', 0.92, 0, 0.12),
      pants: std('#17171a', 0.9, 0, 0.1),
      flap: std('#222226', 0.9),
      zip: new THREE.MeshStandardMaterial({ color: '#2a2019', roughness: 0.4, metalness: 0.5 }),
      cord: std('#d9d0bf', 0.8),
      shoe: std('#e8e6e1', 0.6),
      sole: std('#2a2a2a', 0.8),
      // matte dark navy acetate
      frame: new THREE.MeshStandardMaterial({ color: '#161c2a', roughness: 0.55, metalness: 0.05 }),
      lens: new THREE.MeshStandardMaterial({
        color: '#a9c6ff',
        roughness: 0.05,
        metalness: 0.2,
        transparent: true,
        opacity: 0.1,
        depthWrite: false,
        emissive: new THREE.Color('#5f86c8'),
        emissiveIntensity: 0.06,
      }),
      white: new THREE.MeshStandardMaterial({ color: '#c2b4a6', roughness: 0.35 }),
      eye: new THREE.MeshStandardMaterial({ color: '#1a110b', roughness: 0.25 }),
      wood: new THREE.MeshStandardMaterial({ color: '#5a3b24', roughness: 0.9, flatShading: true }),
      bark: new THREE.MeshStandardMaterial({ color: '#3d2716', roughness: 1, flatShading: true }),
      laptop: new THREE.MeshStandardMaterial({ color: '#b7bac0', roughness: 0.35, metalness: 0.75 }),
      keys: new THREE.MeshStandardMaterial({ color: '#2a2c30', roughness: 0.6 }),
      screen: new THREE.MeshBasicMaterial({ color: new THREE.Color('#9cc3ff').multiplyScalar(1.1), toneMapped: false }),
    };
  }, [planet, rim, rimColor]);
  useEffect(() => () => Object.values(m).forEach((x) => x.dispose()), [m]);
  const geo = useMemo(
    () => ({
      head: headGeometry(),
      hair: hairGeometry(),
      frame: frameGeometry(LENS_W, LENS_H, 0.0042, 0.004),
      lens: lensGeometry(LENS_W, LENS_H),
      hoodie: hoodieGeometry(HOOD_GAP),
    }),
    [],
  );
  useEffect(() => () => Object.values(geo).forEach((g) => g.dispose()), [geo]);

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
        {/* hips and legs in baggy black cargo track pants, knees up a little, feet on the ground */}
        <mesh material={m.pants} position={[0, 0.5, -0.02]} rotation={[0, 0, Math.PI / 2]} scale={[0.84, 1, 1.08]} castShadow raycast={noRaycast}>
          <capsuleGeometry args={[0.105, 0.16, 4, 12]} />
        </mesh>
        <Mirror>
          {(s) => (
            <group key={s}>
              <Limb a={[s * 0.1, 0.5, 0]} b={[s * 0.125, 0.54, 0.47]} r={0.08} material={m.pants} />
              {/* a cargo pocket on the outer thigh, its flap a shade lighter */}
              <mesh material={m.pants} position={[s * 0.195, 0.53, 0.25]} rotation={[0.08, s * 0.05, 0]} castShadow raycast={noRaycast}>
                <boxGeometry args={[0.03, 0.085, 0.13]} />
              </mesh>
              <mesh material={m.flap} position={[s * 0.205, 0.575, 0.25]} rotation={[0.08, s * 0.05, 0]} raycast={noRaycast}>
                <boxGeometry args={[0.024, 0.016, 0.132]} />
              </mesh>
              <Limb a={[s * 0.125, 0.53, 0.48]} b={[s * 0.14, 0.2, 0.525]} r={0.07} material={m.pants} />
              {/* elastic ankle cuffs */}
              <Limb a={[s * 0.14, 0.2, 0.525]} b={[s * 0.142, 0.13, 0.53]} r={0.052} material={m.pants} />
              <mesh material={m.shoe} position={[s * 0.14, 0.058, 0.6]} rotation={[Math.PI / 2, 0, 0]} scale={[1.05, 1, 0.72]} castShadow raycast={noRaycast}>
                <capsuleGeometry args={[0.052, 0.16, 4, 12]} />
              </mesh>
              <mesh material={m.sole} position={[s * 0.14, 0.014, 0.6]} raycast={noRaycast}>
                <boxGeometry args={[0.112, 0.024, 0.262]} />
              </mesh>
            </group>
          )}
        </Mirror>

        {/* torso, leaning a little toward the laptop: a baggy off-white tee under an open dark brown zip-up hoodie */}
        <group ref={chest} position={[0, 0.58, 0]} rotation={[0.16, 0, 0]}>
          <mesh material={m.shirt} position={[0, 0.255, 0]} scale={[1.06, 1, 0.7]} castShadow raycast={noRaycast}>
            <capsuleGeometry args={[0.145, 0.28, 6, 16]} />
          </mesh>
          <mesh material={m.shirt} position={[0, 0.49, 0.012]} rotation={[Math.PI / 2 - 0.16, 0, 0]} scale={[1.1, 1, 1]} raycast={noRaycast}>
            <torusGeometry args={[0.052, 0.009, 8, 24]} />
          </mesh>
          <mesh geometry={geo.hoodie} material={m.hoodie} scale={[1.12, 1, 0.74]} castShadow raycast={noRaycast} />
          {/* the zip tapes down both open edges, the pull hanging off one, the drawcords */}
          <Mirror>
            {(s) => {
              const edge = (r: number, y: number): V3 => [s * r * 1.12 * Math.sin(HOOD_GAP), y, r * 0.74 * Math.cos(HOOD_GAP)];
              return (
                <group key={s}>
                  <Limb a={edge(0.163, 0.03)} b={edge(0.162, 0.42)} r={0.0055} material={m.zip} />
                  <Limb a={edge(0.12, 0.47)} b={[s * 0.03, 0.3, 0.13]} r={0.0028} material={m.cord} />
                </group>
              );
            }}
          </Mirror>
          <mesh material={m.zip} position={[1.12 * 0.165 * Math.sin(HOOD_GAP), 0.33, 0.74 * 0.165 * Math.cos(HOOD_GAP) + 0.006]} raycast={noRaycast}>
            <boxGeometry args={[0.008, 0.022, 0.004]} />
          </mesh>
          {/* the hood bunched behind the neck, its edges coming round to the front */}
          <mesh material={m.hoodie} position={[0, 0.5, -0.06]} rotation={[0.25, 0, 0]} scale={[1.3, 0.62, 1.05]} castShadow raycast={noRaycast}>
            <torusGeometry args={[0.092, 0.04, 8, 18]} />
          </mesh>
          <mesh material={m.skin} position={[0, 0.555, 0.02]} castShadow raycast={noRaycast}>
            <cylinderGeometry args={[0.036, 0.043, 0.14, 14]} />
          </mesh>

          {/* arms in the hoodie's sleeves down to ribbed cuffs, the hands out on the keyboard */}
          <Mirror>
            {(s) => (
              <group key={s}>
                <mesh material={m.hoodie} position={[s * 0.182, 0.425, 0]} castShadow raycast={noRaycast}>
                  <sphereGeometry args={[0.058, 14, 12]} />
                </mesh>
                <Limb a={[s * 0.2, 0.42, 0]} b={[s * 0.24, 0.17, 0.15]} r={0.05} material={m.hoodie} />
                <Limb a={[s * 0.24, 0.17, 0.15]} b={[s * 0.125, 0.128, 0.31]} r={0.044} material={m.hoodie} />
                <Limb a={[s * 0.125, 0.128, 0.31]} b={[s * 0.108, 0.123, 0.345]} r={0.036} material={m.hoodie} />
              </group>
            )}
          </Mirror>

          {/* the head: turns on the neck */}
          <group ref={head} position={[0, 0.6, 0.04]} rotation={[REST_PITCH, 0, 0]}>
            <group position={[0, 0.12, 0.01]}>
              <mesh geometry={geo.head} material={m.face} castShadow raycast={noRaycast} />
              <mesh geometry={geo.hair} material={m.hair} castShadow raycast={noRaycast} />
              {/* ears, the tops under the hair */}
              <Mirror>
                {(s) => (
                  <mesh key={s} material={m.skin} position={[s * (headHalfWidth(-0.006) - 0.001), -0.006, -0.012]} rotation={[0, s * 0.2, 0]} scale={[0.28, 1, 0.6]} raycast={noRaycast}>
                    <sphereGeometry args={[0.026, 12, 10]} />
                  </mesh>
                )}
              </Mirror>
              {/* eyes: whites, dark irises, a heavy upper lid; thick straight brows over them */}
              <Mirror>
                {(s) => {
                  const ez = faceZ(EYE_X, EYE_Y) - 0.0085;
                  const bz = faceZ(0.031, EYE_Y + 0.0245) + 0.002;
                  return (
                    <group key={s}>
                      <mesh material={m.white} position={[s * EYE_X, EYE_Y, ez]} raycast={noRaycast}>
                        <sphereGeometry args={[0.0115, 14, 12]} />
                      </mesh>
                      <mesh material={m.eye} position={[s * EYE_X, EYE_Y + 0.0006, ez + 0.0105]} scale={[1, 1, 0.35]} raycast={noRaycast}>
                        <sphereGeometry args={[0.0076, 12, 10]} />
                      </mesh>
                      <mesh material={m.skin} position={[s * EYE_X, EYE_Y + 0.0006, ez]} rotation={[0.26, 0, 0]} raycast={noRaycast}>
                        <sphereGeometry args={[0.0125, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
                      </mesh>
                      <mesh material={m.skin} position={[s * EYE_X, EYE_Y - 0.0004, ez]} rotation={[-0.1, 0, 0]} raycast={noRaycast}>
                        <sphereGeometry args={[0.0122, 14, 6, 0, Math.PI * 2, Math.PI * 0.66, Math.PI * 0.34]} />
                      </mesh>
                      <mesh material={m.brow} position={[s * 0.031, EYE_Y + 0.0245, bz]} rotation={[0.1, s * 0.28, Math.PI / 2 + s * -0.06]} scale={[1, 1, 0.55]} raycast={noRaycast}>
                        <capsuleGeometry args={[0.0046, 0.029, 4, 8]} />
                      </mesh>
                    </group>
                  );
                }}
              </Mirror>
              {/* a straight, prominent nose */}
              <Taper a={[0, EYE_Y - 0.002, faceZ(0, EYE_Y) - 0.004]} b={[0, -0.034, faceZ(0, -0.034) + 0.0105]} r0={0.0042} r1={0.0086} material={m.skin} />
              <mesh material={m.skin} position={[0, -0.037, faceZ(0, -0.037) + 0.011]} raycast={noRaycast}>
                <sphereGeometry args={[0.0096, 14, 12]} />
              </mesh>
              <Mirror>
                {(s) => (
                  <mesh key={s} material={m.skin} position={[s * 0.0102, -0.038, faceZ(0.0102, -0.038) - 0.0002]} raycast={noRaycast}>
                    <sphereGeometry args={[0.0058, 10, 8]} />
                  </mesh>
                )}
              </Mirror>
              {/* full lips, the line between them in shadow */}
              <mesh material={m.eye} position={[0, -0.0693, faceZ(0, -0.0693) + 0.0004]} raycast={noRaycast}>
                <boxGeometry args={[0.03, 0.0014, 0.002]} />
              </mesh>
              <mesh material={m.lip} position={[0, -0.0655, faceZ(0, -0.0655) + 0.001]} rotation={[0, 0, Math.PI / 2]} scale={[0.62, 1, 0.5]} raycast={noRaycast}>
                <capsuleGeometry args={[0.0042, 0.028, 4, 10]} />
              </mesh>
              <mesh material={m.lip} position={[0, -0.0732, faceZ(0, -0.0732) - 0.0022]} scale={[1.6, 0.48, 0.55]} raycast={noRaycast}>
                <sphereGeometry args={[0.012, 16, 10]} />
              </mesh>
              {/* rectangular dark navy frames */}
              <Mirror>
                {(s) => {
                  const fx = s * 0.031;
                  const fz = faceZ(0.031, EYE_Y) + 0.012;
                  const edge = s * (0.031 + LENS_W / 2 + 0.004);
                  return (
                    <group key={s}>
                      <group position={[fx, EYE_Y + 0.001, fz]} rotation={[0, s * 0.12, 0]}>
                        <mesh geometry={geo.frame} material={m.frame} raycast={noRaycast} />
                        <mesh geometry={geo.lens} material={m.lens} raycast={noRaycast} />
                      </group>
                      <Limb a={[edge, EYE_Y + 0.009, fz - 0.004]} b={[s * (headHalfWidth(EYE_Y) + 0.004), EYE_Y + 0.006, -0.014]} r={0.0021} material={m.frame} />
                    </group>
                  );
                }}
              </Mirror>
              <mesh material={m.frame} position={[0, EYE_Y + 0.008, faceZ(0, EYE_Y) + 0.012]} raycast={noRaycast}>
                <boxGeometry args={[0.016, 0.0042, 0.0045]} />
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
                // hands over the keys: a flat palm, the fingers curled down onto them, a thumb under
                <group key={s} position={[s * 0.07, 0.026, -0.02]} rotation={[0, s * -0.25, 0]}>
                  <mesh material={m.skin} scale={[1, 0.36, 1]} castShadow raycast={noRaycast}>
                    <capsuleGeometry args={[0.03, 0.03, 4, 10]} />
                  </mesh>
                  <mesh material={m.skin} position={[0, -0.006, 0.042]} rotation={[0, 0, Math.PI / 2]} scale={[0.55, 1, 0.8]} raycast={noRaycast}>
                    <capsuleGeometry args={[0.014, 0.034, 4, 8]} />
                  </mesh>
                  <mesh material={m.skin} position={[s * -0.03, -0.006, 0.012]} rotation={[0.3, s * 0.7, 0]} scale={[0.7, 0.7, 1]} raycast={noRaycast}>
                    <capsuleGeometry args={[0.009, 0.026, 4, 8]} />
                  </mesh>
                </group>
              )}
            </Mirror>
          </group>
        </group>
      </group>
    </group>
  );
};
