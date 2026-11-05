import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { Planet, Vec3 } from '@/types/content';
import { getOrbitalPosition, planetById } from '@/data/content';
import { useAppStore } from '@/state/useAppStore';
import { CHAIN_TOTAL, ENTER_DIVE, ENTER_TOTAL, EXIT_CHAIN_TOTAL, EXIT_TOTAL, REDUCED_TOTAL } from '@/state/timing';
import { responsiveFov, surfaceFov } from '@/scenes/overworld/TelescopeCamera';

/** The dive narrows the lens by this factor. */
const DIVE_ZOOM = 0.85;
/** Dive stops this many radii from the centre so baked detail is never magnified into texels. */
const DIVE_END = 1.85;
const LAUNCH_FOV = 80;
const LAUNCH_PITCH = 1.2;
const LOOK_SETTLE = 700;
const TILT_TIME = 900;

const UP = new THREE.Vector3(0, 1, 0);
const _orb: Vec3 = [0, 0, 0];
const _target = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _end = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');

const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

interface Run {
  kind: 'in' | 'out' | null;
  /** Planet-to-planet travel: short launch, then a dive fully under the veil */
  chain: boolean;
  total: number;
  prevKind: 'in' | 'out' | null;
  prevChain: boolean;
  lockId: string | null;
  start: number;
  done: boolean;
  reduced: boolean;
  planet: Planet | undefined;
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  endQuat: THREE.Quaternion;
  fov: number;
}

const setFov = (cam: THREE.PerspectiveCamera, fov: number) => {
  if (Math.abs(cam.fov - fov) < 1e-3) return;
  cam.fov = fov;
  cam.updateProjectionMatrix();
};

/**
 * Owns the camera while diving into or launching off a planet, and fires the
 * matching arrival exactly once per transition.
 */
const TransitionController = () => {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const get = useThree((s) => s.get);
  const mode = useAppStore((s) => s.mode);
  const lockedId = useAppStore((s) => s.lockedPlanetId);
  const run = useRef<Run>({
    kind: null,
    chain: false,
    total: 0,
    prevKind: null,
    prevChain: false,
    lockId: null,
    start: 0,
    done: true,
    reduced: false,
    planet: undefined,
    pos: new THREE.Vector3(),
    quat: new THREE.Quaternion(),
    endQuat: new THREE.Quaternion(),
    fov: 60,
  });

  useEffect(() => {
    const r = run.current;
    if (mode !== 'transitioning-in' && mode !== 'transitioning-out') {
      r.kind = null;
      r.chain = false;
      return;
    }
    const again = r.kind === (mode === 'transitioning-in' ? 'in' : 'out') && !r.done && r.lockId === lockedId;
    const prevKind = again ? r.prevKind : r.kind;
    const prevChain = again ? r.prevChain : r.chain;
    r.prevKind = prevKind;
    r.prevChain = prevChain;
    r.lockId = lockedId;
    r.kind = mode === 'transitioning-in' ? 'in' : 'out';
    // An exit with a pending destination, and the dive that follows it, are both chained
    r.chain = r.kind === 'out' ? useAppStore.getState().pendingPlanetId != null : prevKind === 'out' && prevChain;
    r.total = r.kind === 'in' ? (r.chain ? CHAIN_TOTAL : ENTER_TOTAL) : r.chain ? EXIT_CHAIN_TOTAL : EXIT_TOTAL;
    r.start = performance.now();
    r.done = false;
    r.reduced = useAppStore.getState().reducedMotion;
    r.planet = planetById(lockedId);
    const { size, clock } = get();
    const aspect = size.width / Math.max(size.height, 1);

    if (r.kind === 'in' && r.planet && camera.position.lengthSq() > 0.25) {
      // Chained travel right after a launch: start from the eyepiece, already facing the target
      camera.position.set(0, 0, 0);
      getOrbitalPosition(r.planet, clock.elapsedTime, _orb);
      _m.lookAt(camera.position, _target.set(_orb[0], _orb[1], _orb[2]), UP);
      camera.quaternion.setFromRotationMatrix(_m);
      setFov(camera, responsiveFov(aspect));
    }
    if (r.kind === 'out') {
      _euler.setFromQuaternion(camera.quaternion, 'YXZ');
      _euler.set(LAUNCH_PITCH, _euler.y, 0, 'YXZ');
      r.endQuat.setFromEuler(_euler);
    }
    r.pos.copy(camera.position);
    r.quat.copy(camera.quaternion);
    r.fov = camera.fov;
  }, [mode, lockedId, camera, get]);

  useFrame(({ clock, size }) => {
    const r = run.current;
    if (!r.kind || r.done) return;
    const elapsed = performance.now() - r.start;
    const store = useAppStore.getState();

    const finish = () => {
      r.done = true;
      if (r.kind === 'in') {
        store.arriveAtPlanet();
        setFov(camera, surfaceFov(size.width / Math.max(size.height, 1)));
      } else {
        store.arriveAtOverworld();
      }
    };

    if (r.reduced) {
      if (elapsed >= REDUCED_TOTAL) finish();
      return;
    }

    if (r.kind === 'in' && r.chain) {
      // Fully covered: hold the eyepiece pose facing the target, then cut
      if (elapsed >= r.total) finish();
      return;
    }

    if (r.kind === 'in') {
      const p = r.planet;
      if (!p) return finish();
      getOrbitalPosition(p, clock.elapsedTime, _orb);
      _target.set(_orb[0], _orb[1], _orb[2]);
      const e = easeInOutCubic(clamp01(elapsed / ENTER_DIVE));
      _dir.copy(_target).sub(r.pos).normalize();
      _end.copy(_target).addScaledVector(_dir, -p.radius * DIVE_END);
      camera.position.lerpVectors(r.pos, _end, e);
      _m.lookAt(camera.position, _target, UP);
      _q.setFromRotationMatrix(_m);
      camera.quaternion.copy(r.quat).slerp(_q, easeOutCubic(clamp01(elapsed / LOOK_SETTLE)));
      setFov(camera, r.fov * (1 - (1 - DIVE_ZOOM) * e));
      if (elapsed >= r.total) finish();
      return;
    }

    // Launch: accelerating climb, tilting up toward the sky
    const ts = elapsed / 1000;
    camera.position.set(r.pos.x, r.pos.y + 2 * ts + 18 * ts * ts + 14 * ts * ts * ts, r.pos.z - 1.5 * ts);
    camera.quaternion.copy(r.quat).slerp(r.endQuat, easeInOutCubic(clamp01(elapsed / TILT_TIME)));
    const f = clamp01(elapsed / r.total);
    setFov(camera, r.fov + (LAUNCH_FOV - r.fov) * f * f);
    if (elapsed >= r.total) finish();
  });

  return null;
};

export default TransitionController;
