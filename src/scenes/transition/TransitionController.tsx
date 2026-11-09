import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { Planet, Vec3 } from '@/types/content';
import { getOrbitalPosition, planetById } from '@/data/content';
import { useAppStore } from '@/state/useAppStore';
import { flight } from '@/state/runtime';
import {
  BEAM_LIFT_AT,
  BEAM_LOOK_MS,
  BEAM_OUT_AT,
  BEAM_OUT_MS,
  CHAIN_TOTAL,
  DIVE_TURN_MS,
  PULL_AT,
  ENTER_TOTAL,
  EXIT_CHAIN_TOTAL,
  EXIT_TOTAL,
  REDUCED_TOTAL,
} from '@/state/timing';
import { responsiveFov, surfaceFov } from '@/scenes/overworld/TelescopeCamera';
import { FRAME_DEPTH } from '@/scenes/ship/shape';
import { loadSurface, surfaceScene } from '@/scenes/planet/loadSurface';

/** The lock-on narrows the lens this much */
const LOCK_ZOOM = 4;
/** The pull stops this many planet radii from its centre, just outside the atmosphere */
const DIVE_STOP = 1.4;
/** The beam leaves the aperture at the bottom of the view (screen y, -1 = bottom edge), just past the wall */
const MOUTH_Y = -0.72;
const MOUTH_Z = FRAME_DEPTH + 0.08;
/** Turn about the beam by the end of the pull, radians */
const PULL_ROLL = 0.5;
/** How long the beam takes to swing up from the aperture onto the viewer once the pull starts */
const PULL_GATHER_MS = 320;
const LAUNCH_FOV = 78;
/** Eye height above the beam's foot */
const EYE = 1.6;

const UP = new THREE.Vector3(0, 1, 0);
const _orb: Vec3 = [0, 0, 0];
const _target = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _mouth = new THREE.Vector3();
const _roll = new THREE.Vector3(0, 0, 1);

const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeInOutSine = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * t);
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

interface Run {
  kind: 'in' | 'out' | null;
  /** Planet-to-planet travel: the beam up, then the switch fully under the veil */
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
  /** Where the launch beam left the aperture when the pull started */
  mouth: THREE.Vector3;
}

const setFov = (cam: THREE.PerspectiveCamera, fov: number) => {
  if (Math.abs(cam.fov - fov) < 1e-3) return;
  cam.fov = fov;
  cam.updateProjectionMatrix();
};

/**
 * Owns the camera while beaming down to or up from a planet, and fires the
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
    mouth: new THREE.Vector3(),
  });

  useEffect(() => {
    const r = run.current;
    if (mode !== 'transitioning-out') flight.beam = 0;
    if (mode !== 'transitioning-in') flight.launch = flight.launchBeam = flight.launchReach = 0;
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
      // look straight up the beam at the ship's belly
      const m = flight.mother;
      _m.lookAt(camera.position, _target.set(m.x, m.y, m.z), UP);
      r.endQuat.setFromRotationMatrix(_m);
      flight.beamFoot.x = camera.position.x;
      flight.beamFoot.y = camera.position.y - EYE;
      flight.beamFoot.z = camera.position.z;
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
      // the surface chunk is normally in long before this; if not, hold the covered last frame for it
      if (r.kind === 'in' && !surfaceScene()) {
        void loadSurface().catch(() => {});
        return;
      }
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
      // turn onto the planet while the aperture charges, fire the beam out to it, then get pulled
      // along it until the light takes the view (same timeline in TransitionVeil): the beam up
      // from a planet, run the other way
      const p = r.planet;
      if (!p) return finish();
      getOrbitalPosition(p, clock.elapsedTime, _orb);
      _target.set(_orb[0], _orb[1], _orb[2]);
      const turn = easeInOutSine(clamp01(elapsed / DIVE_TURN_MS));
      const pull = clamp01((elapsed - PULL_AT) / (r.total - PULL_AT));
      // accelerating the whole way, like the pull up the beam from the ground
      const travel = Math.pow(pull, 2.2);
      _dir.copy(_target).sub(r.pos);
      const reach = Math.max(0, _dir.length() - p.radius * DIVE_STOP);
      camera.position.copy(r.pos).addScaledVector(_dir.normalize(), reach * travel);
      _m.lookAt(camera.position, _target, UP);
      _q.setFromRotationMatrix(_m);
      camera.quaternion.copy(r.quat).slerp(_q, turn);
      // a slow turn about the beam as it takes hold
      camera.quaternion.multiply(_q.setFromAxisAngle(_roll, PULL_ROLL * travel));
      // the lens narrows as it locks on, then opens wide with the speed
      setFov(camera, r.fov - LOCK_ZOOM * turn + (LAUNCH_FOV - r.fov + LOCK_ZOOM) * pull * pull);

      flight.launch = smoothstep(0, BEAM_OUT_AT + 120, elapsed);
      flight.launchReach = easeInOutCubic(clamp01((elapsed - BEAM_OUT_AT) / BEAM_OUT_MS));
      flight.launchBeam = smoothstep(BEAM_OUT_AT, BEAM_OUT_AT + 160, elapsed);
      if (elapsed < PULL_AT) {
        // the mouth sits at the bottom of the aperture, which turns with the deck
        const tv = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
        _mouth.set(0, MOUTH_Y * tv * MOUTH_Z, -MOUTH_Z).applyQuaternion(camera.quaternion).add(camera.position);
        r.mouth.copy(_mouth);
      } else {
        // as the pull takes hold the beam swings up onto the viewer, who is carried along inside it
        const k = easeInOutSine(clamp01((elapsed - PULL_AT) / PULL_GATHER_MS));
        _mouth.copy(r.pos).addScaledVector(_dir, -0.4).lerp(r.mouth, 1 - k);
      }
      flight.launchFrom.x = _mouth.x;
      flight.launchFrom.y = _mouth.y;
      flight.launchFrom.z = _mouth.z;
      if (elapsed >= r.total) finish();
      return;
    }

    // Beam: look up at the ship, the beam comes down, the feet leave the ground, then the pull
    flight.beam = smoothstep(120, BEAM_LOOK_MS, elapsed);
    const m = flight.mother;
    _dir.set(m.x - r.pos.x, m.y - r.pos.y, m.z - r.pos.z).normalize();
    const ts = Math.max(0, elapsed - BEAM_LIFT_AT) / 1000;
    const float = 0.5 * smoothstep(250, BEAM_LIFT_AT + 300, elapsed);
    const pull = 0.8 * ts + 7 * ts * ts + 20 * ts * ts * ts;
    camera.position.copy(r.pos).addScaledVector(_dir, pull);
    camera.position.y += float;
    camera.quaternion.copy(r.quat).slerp(r.endQuat, easeInOutCubic(clamp01(elapsed / BEAM_LOOK_MS)));
    // a slow turn about the beam as it takes hold
    _q.setFromAxisAngle(_target.set(0, 0, 1), 0.35 * ts * ts);
    camera.quaternion.multiply(_q);
    const f = clamp01(elapsed / r.total);
    setFov(camera, r.fov + (LAUNCH_FOV - r.fov) * f * f);
    if (elapsed >= r.total) finish();
  });

  return null;
};

export default TransitionController;
