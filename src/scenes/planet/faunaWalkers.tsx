import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { Planet } from '@/types/content';
import type { HeightFn } from './Terrain';
import { mulberry, seedOf } from './rng';
import { callFrom, cameraYaw, CLEAR_R, clearOf, damp, isPoke, nearObstacle, offGaze, reading, smooth01, wrapAngle, type EcoRef, type ViewerRef } from './faunaCommon';
import {
  deerParts,
  DEER,
  foot,
  hideMaterial,
  hopperParts,
  joint,
  leg,
  shellMaterial,
  solveLeg,
  stride,
  tortoiseParts,
  TORTOISE,
  type PartDef,
} from './faunaGeo';

/*
 * ---------- walkers: deer, alien hoppers, magma tortoises ----------
 * Each herd is a handful of instanced parts posed by hand every frame, so a
 * herd costs a few draw calls whatever its size. They keep to their own
 * routine: walk somewhere, then graze or lie down. One that notices the viewer
 * looks up and watches, and about half the time comes over; once over, they
 * follow for a while, greet a viewer who stands still, skip back when rushed,
 * then lose interest. Deer that are rushed from further off startle, and the
 * alarm runs through the herd one animal at a time. A click wakes one and
 * makes it greet.
 */

export type WalkerKind = 'deer' | 'hopper' | 'tortoise';
type Mode = 'wander' | 'curious' | 'shy';
/** What a wandering animal is up to: walking somewhere, eating, or lying down */
type Act = 'roam' | 'graze' | 'rest';

interface Walker {
  x: number;
  z: number;
  yaw: number;
  tx: number;
  tz: number;
  moving: boolean;
  timer: number;
  /** Radians of walk cycle (deer, tortoise) or 0..1 of a hop (hopper) */
  phase: number;
  /** 0..1 eased: how much of a stride is showing */
  gait: number;
  /** 0..1 eased: from walking to running */
  fast: number;
  head: number;
  /** Eating: seconds until the head next comes up or goes down */
  grazeIn: number;
  grazeUp: boolean;
  scan: number;
  mode: Mode;
  /** Seconds spent following; they get bored eventually */
  bond: number;
  /** Seconds before it can notice the viewer again */
  cool: number;
  shyT: number;
  /** Bolted in alarm: goes back to wandering afterwards, not to the viewer */
  spooked: boolean;
  /** Seconds left frozen, head high, before bolting */
  alert: number;
  /** Seconds until the herd's alarm reaches this one; negative when none is coming */
  alertIn: number;
  callIn: number;
  /** Greeting animation time left, and the wait before the next one */
  greet: number;
  greetCool: number;
  /** 0..1 how much the head tracks the viewer */
  look: number;
  /** Bearing offset and distance offset of its spot beside the viewer */
  slot: number;
  slotD: number;
  act: Act;
  /** 0..1 how far it has lain down */
  rest: number;
  /** Seconds left watching the viewer from where it is, without coming over */
  watch: number;
  /** How long this one stays interested once it comes over */
  patience: number;
  /** Ear flicks and the wait before the next */
  earL: number;
  earR: number;
  earIn: number;
  tail: number;
  tailIn: number;
  /** Idle weight shift: which leg and how far through */
  shift: number;
  shiftLeg: number;
  shiftIn: number;
  /** 0..1 pulled into its shell (tortoise) */
  tuck: number;
  tuckT: number;
}

const WALK_MIN_R = 14;
const WALK_MAX_R = 26;
/** They notice the viewer inside this range and give up beyond LOSE */
const NOTICE = 13;
const LOSE = 24;
/** Following distance */
const FOLLOW = 2.4;
/** A resting animal only gets up for a viewer this close */
const WAKE_NEAR = 3.5;
/** The chance that an animal that notices the viewer comes over, rather than just watching */
const COME_CHANCE = 0.45;
const GREET_S = 1.3;
const WORLD_R = 34;
/** Rushed at this fast and this close, a wandering deer starts */
const STARTLE_SPEED = 3.4;
const STARTLE_R = 9;
/** Followers keep out of this half-angle (radians) of the viewer's gaze */
const GAZE_HALF = 0.85;

const _root = new THREE.Matrix4();
const _a = new THREE.Matrix4();
const _b = new THREE.Matrix4();
const _c = new THREE.Matrix4();
const _s = new THREE.Vector3();
const IDENT = new THREE.Matrix4();

const WALK_OFF = [0.25, 0.75, 0, 0.5];
const RUN_OFF = [0.42, 0.52, 0, 0.08];

const Walkers = ({
  planet,
  kind,
  count,
  size = 1,
  speedK = 1,
  colors,
  maxR = WORLD_R,
  ground,
  obstacles,
  viewer,
  eco,
  reducedMotion,
}: {
  planet: Planet;
  kind: WalkerKind;
  count: number;
  /** Big walkers are scaled up and move slower */
  size?: number;
  speedK?: number;
  colors?: [string, string];
  /** How far from the centre they may go (the mesa and the island are smaller) */
  maxR?: number;
  ground: HeightFn;
  /** Monument footprints (x, z) to walk around */
  obstacles: [number, number][];
  viewer: ViewerRef;
  eco: EcoRef;
  reducedMotion?: boolean;
}) => {
  const camera = useThree((s) => s.camera);
  const meshes = useRef<Record<string, THREE.InstancedMesh | null>>({});
  const time = useMemo(() => ({ value: 0 }), []);
  const rnd = useMemo(() => mulberry(seedOf(`${planet.id}:walkers:${kind}:${size}`)), [planet.id, kind, size]);
  const ringMin = Math.min(WALK_MIN_R, maxR * 0.5);
  const ringMax = Math.min(WALK_MAX_R, maxR - 2);
  const worldR = Math.min(WORLD_R, maxR - 0.5);

  const pick = (w: Walker) => {
    // stay in the ring behind the monuments; short hops in angle, and never ending on one
    const a0 = Math.atan2(w.z, w.x);
    for (let tries = 0; tries < 6; tries += 1) {
      const a = a0 + (rnd() - 0.5) * 1.6;
      const r = ringMin + rnd() * (ringMax - ringMin);
      w.tx = Math.cos(a) * r;
      w.tz = Math.sin(a) * r;
      if (!nearObstacle(obstacles, w.tx, w.tz, CLEAR_R + 1)) return;
    }
  };

  const walkers = useMemo<Walker[]>(
    () =>
      Array.from({ length: count }, (_, i) => {
        // spread around the far side first, where they are seen from the spawn
        const a = -Math.PI / 2 + (i / count - 0.5) * 2.6 + (rnd() - 0.5) * 0.4;
        const r = ringMin + rnd() * (ringMax - ringMin);
        const w: Walker = {
          x: Math.cos(a) * r,
          z: Math.sin(a) * r,
          yaw: rnd() * Math.PI * 2,
          tx: 0,
          tz: 0,
          moving: false,
          timer: 1 + rnd() * 5,
          phase: rnd() * 10,
          gait: 0,
          fast: 0,
          head: 0,
          grazeIn: rnd() * 5,
          grazeUp: false,
          scan: 0,
          mode: 'wander',
          bond: 0,
          cool: 2 + rnd() * 4,
          shyT: 0,
          spooked: false,
          alert: 0,
          alertIn: -1,
          callIn: 0,
          greet: 0,
          greetCool: 0,
          look: 0,
          slot: (i % 2 ? 1 : -1) * (0.35 + Math.floor(i / 2) * 0.45),
          slotD: (i % 3) * 0.6,
          act: rnd() < 0.3 ? 'rest' : 'graze',
          rest: 0,
          watch: 0,
          patience: 14 + rnd() * 10,
          earL: 0,
          earR: 0,
          earIn: rnd() * 5,
          tail: 0,
          tailIn: rnd() * 6,
          shift: 0,
          shiftLeg: 0,
          shiftIn: 4 + rnd() * 10,
          tuck: 0,
          tuckT: 0,
        };
        if (w.act === 'rest') w.rest = 1;
        w.tx = w.x;
        w.tz = w.z;
        return w;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [count, rnd],
  );

  const { parts, mats } = useMemo(() => {
    if (kind === 'deer') {
      const body = hideMaterial(null);
      return { parts: deerParts(colors?.[0] ?? '#7a5636', colors?.[1] ?? '#3b2a1c'), mats: { body, shell: body } };
    }
    if (kind === 'tortoise') {
      const glow = new THREE.Color('#ff6a1a').multiplyScalar(1.5);
      return { parts: tortoiseParts(), mats: { body: hideMaterial(glow, 0.9), shell: shellMaterial(glow, time) } };
    }
    const accent = new THREE.Color(planet.accent);
    const body = hideMaterial(accent.clone().multiplyScalar(1.4), 0.6);
    return { parts: hopperParts(new THREE.Color('#8a6a9a').lerp(accent, 0.25), new THREE.Color('#3a2c40')), mats: { body, shell: body } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, planet.accent, colors?.[0], colors?.[1], time]);
  useEffect(
    () => () => {
      parts.forEach((p) => p.geo.dispose());
      mats.body.dispose();
      if (mats.shell !== mats.body) mats.shell.dispose();
    },
    [parts, mats],
  );

  const speak = (w: Walker) =>
    callFrom(camera, kind === 'deer' ? 'mew' : kind === 'tortoise' ? 'boop' : 'squeak', w.x, ground(w.x, w.z) + 0.6, w.z);
  const greet = (w: Walker) => {
    w.greet = GREET_S;
    w.greetCool = 7 + rnd() * 6;
    speak(w);
  };
  const _clear = useMemo(() => ({ x: 0, z: 0 }), []);

  const put = (part: PartDef['name'], slot: number, m: THREE.Matrix4) => {
    const mesh = meshes.current[part];
    if (mesh) mesh.setMatrixAt(slot, m);
  };

  useFrame(({ clock }, delta) => {
    const dt = reducedMotion ? 0 : Math.min(delta, 0.05);
    const t = reducedMotion ? 0 : clock.elapsedTime;
    time.value = t;
    const v = viewer.current;
    const px = camera.position.x;
    const pz = camera.position.z;
    const gazeYaw = cameraYaw(camera);
    const read = reading();
    const ec = eco.current;

    for (let i = 0; i < walkers.length; i += 1) {
      const w = walkers[i];
      const cdx = w.x - px;
      const cdz = w.z - pz;
      const cd = Math.hypot(cdx, cdz);
      w.cool -= dt;
      w.greetCool -= dt;
      w.callIn -= dt;
      w.greet = Math.max(0, w.greet - dt);

      if (!reducedMotion) {
        w.watch = Math.max(0, w.watch - dt);
        const resting = w.act === 'rest' && !w.moving;

        // the visitor is reading something: anyone following leaves them to it
        if (read && w.mode === 'curious') {
          w.mode = 'wander';
          w.cool = 30;
          w.moving = false;
          w.act = 'graze';
          w.timer = 4 + rnd() * 6;
        }

        // the alarm: frozen stiff with the head up for a moment, then away
        if (w.alertIn >= 0) {
          w.alertIn -= dt;
          if (w.alertIn < 0) {
            w.alert = 0.55 + rnd() * 0.3;
            w.moving = false;
            w.act = 'graze';
            w.mode = 'wander';
            w.rest = Math.min(w.rest, 0.2);
            w.tail = 1;
          }
        }
        if (w.alert > 0) {
          w.alert -= dt;
          if (w.alert <= 0 && cd < LOSE) {
            w.mode = 'shy';
            w.shyT = 2.2 + rnd() * 0.8;
            w.spooked = true;
            const dx = cdx / (cd || 1);
            const dz = cdz / (cd || 1);
            // away from the viewer, breaking a little to one side
            const sx = (i % 2 ? 1 : -1) * 2.5;
            w.tx = w.x + dx * 6 - dz * sx;
            w.tz = w.z + dz * 6 + dx * sx;
            w.moving = true;
          }
        }
        if (
          kind === 'deer' &&
          w.mode === 'wander' &&
          w.alertIn < 0 &&
          w.alert <= 0 &&
          cd < STARTLE_R &&
          cd > 3 &&
          v.speed > STARTLE_SPEED &&
          w.cool <= 0
        ) {
          // the first to startle; the others catch it from whoever is nearest
          w.alertIn = 0;
          w.cool = 14 + rnd() * 10;
          speak(w);
          for (let j = 0; j < walkers.length; j += 1) {
            const o = walkers[j];
            if (o === w || o.alertIn >= 0 || o.alert > 0 || o.mode !== 'wander') continue;
            const dd = Math.hypot(o.x - w.x, o.z - w.z);
            if (dd < 12) {
              o.alertIn = 0.18 + dd * 0.09 + rnd() * 0.25;
              o.cool = 14 + rnd() * 10;
            }
          }
        }

        if (w.mode === 'wander' && w.cool <= 0 && !read && cd < (resting ? WAKE_NEAR : NOTICE)) {
          if (resting || rnd() < COME_CHANCE) {
            // noticed you: perk up (or get up) and come over
            w.mode = 'curious';
            w.act = 'roam';
            w.bond = 0;
            w.callIn = 0.4 + rnd() * 1.2;
          } else {
            // only curious enough to look up and watch you for a while
            w.watch = 4 + rnd() * 4;
            w.cool = 10 + rnd() * 12;
          }
        }
        if (w.mode === 'shy') {
          w.shyT -= dt;
          if (w.shyT <= 0) {
            if (w.spooked) {
              w.spooked = false;
              w.mode = 'wander';
              w.moving = false;
              w.act = 'graze';
              w.timer = 5 + rnd() * 6;
            } else {
              w.mode = 'curious';
            }
          }
        } else if (w.mode === 'curious') {
          w.bond += dt;
          if (cd > LOSE || w.bond > w.patience) {
            // lost you, or lost interest: back to its own business for a good while
            w.mode = 'wander';
            w.cool = cd > LOSE ? 6 : 25 + rnd() * 20;
            w.patience = 14 + rnd() * 10;
            w.moving = false;
            w.act = rnd() < 0.35 ? 'rest' : 'graze';
            w.timer = w.act === 'rest' ? 12 + rnd() * 14 : 4 + rnd() * 8;
          } else if (v.speed > 3.4 && cd < 3.2) {
            // rushed at: skip back a few steps, then come again
            w.mode = 'shy';
            w.shyT = 1.6;
            w.tx = w.x + (cdx / (cd || 1)) * 3;
            w.tz = w.z + (cdz / (cd || 1)) * 3;
            w.moving = true;
            speak(w);
          } else {
            // a spot beside the viewer on its own side, kept out of the line of sight
            const bearing = offGaze(Math.atan2(cdx, cdz) + w.slot, gazeYaw, GAZE_HALF);
            const fd = FOLLOW + w.slotD;
            w.tx = px + Math.sin(bearing) * fd;
            w.tz = pz + Math.cos(bearing) * fd;
            const dd = Math.hypot(w.tx - w.x, w.tz - w.z);
            if (!w.moving && dd > 1.2) w.moving = true;
            if (w.callIn <= 0) {
              speak(w);
              w.callIn = 7 + rnd() * 9;
            }
            // standing beside a still viewer: say hello
            if (!w.moving && cd < fd + 1.4 && v.still > 1.1 && w.greetCool <= 0) greet(w);
          }
        }
      }

      w.timer -= dt;
      if (w.mode === 'wander' && !w.moving && w.timer <= 0 && w.alert <= 0) {
        // done eating or resting: get up and go somewhere else
        w.act = 'roam';
        pick(w);
        w.moving = true;
      }
      const dx = w.tx - w.x;
      const dz = w.tz - w.z;
      const d = Math.hypot(dx, dz);
      const hurry = w.mode === 'shy' ? (kind === 'deer' ? 3.4 : 2.6) : w.mode === 'curious' && d > 5 ? 2.3 : 1;
      const speed = (kind === 'deer' ? 0.9 : kind === 'tortoise' ? 0.4 : 1.1) * hurry * speedK;
      // a hopper covers ground only in the air: everything else in the cycle is crouch and recovery
      if (kind === 'hopper' && w.moving && w.greet <= 0 && w.rest < 0.15) {
        w.phase = (w.phase + dt * (1.15 + (hurry - 1) * 0.35)) % 1;
      }
      const airborne = kind !== 'hopper' || (w.phase > 0.3 && w.phase < 0.72);
      if (w.moving && w.greet <= 0 && w.rest < 0.15 && w.alert <= 0) {
        if (d < (w.mode === 'wander' ? 0.15 : 0.4)) {
          w.moving = false;
          if (w.mode === 'wander') {
            // arrived: settle down to eat, or now and then to lie down for a rest
            w.act = rnd() < 0.25 ? 'rest' : 'graze';
            w.timer = w.act === 'rest' ? 12 + rnd() * 14 : 4 + rnd() * 8;
          }
        } else {
          const want = Math.atan2(dx, dz);
          w.yaw += wrapAngle(want - w.yaw) * damp(kind === 'tortoise' ? 1.2 : 3, dt);
          // move only once roughly facing the target
          const facing = Math.max(0, Math.cos(wrapAngle(want - w.yaw)));
          const step = airborne ? Math.min(d, speed * dt * facing * (kind === 'hopper' ? 2.2 : 1)) : 0;
          w.x += Math.sin(w.yaw) * step;
          w.z += Math.cos(w.yaw) * step;
          if (kind !== 'hopper') w.phase += (step * (kind === 'deer' ? 6.2 : 5)) / size;
        }
      } else if (w.mode !== 'wander' && !w.moving) {
        // stopped near you: turn to face you
        w.yaw += wrapAngle(Math.atan2(px - w.x, pz - w.z) - w.yaw) * damp(kind === 'tortoise' ? 0.8 : 2.5, dt);
      }
      w.gait += ((w.moving && w.greet <= 0 && w.alert <= 0 ? 1 : 0) - w.gait) * damp(kind === 'tortoise' ? 3 : 7, dt);
      w.fast += ((hurry > 2 ? 1 : 0) - w.fast) * damp(5, dt);

      // walk around monuments and each other, stay in bounds
      clearOf(obstacles, w.x, w.z, Math.max(CLEAR_R, 1.35 * size), _clear);
      w.x = _clear.x;
      w.z = _clear.z;
      for (let j = 0; j < i; j += 1) {
        const o = walkers[j];
        const ex = w.x - o.x;
        const ez = w.z - o.z;
        const e = Math.hypot(ex, ez);
        if (e < 0.9 * size && e > 1e-4) {
          const push = (0.9 * size - e) / 2;
          w.x += (ex / e) * push;
          w.z += (ez / e) * push;
          o.x -= (ex / e) * push;
          o.z -= (ez / e) * push;
        }
      }
      const wr = Math.hypot(w.x, w.z);
      if (wr > worldR) {
        w.x *= worldR / wr;
        w.z *= worldR / wr;
      }

      const songUp = ec.song > 0.2 && w.mode === 'wander';
      w.look += ((w.mode !== 'wander' || w.watch > 0 || w.alert > 0 ? 1 : 0) - w.look) * damp(kind === 'tortoise' ? 0.6 : 2, dt);
      w.rest += ((w.act === 'rest' && !w.moving && w.mode === 'wander' ? 1 : 0) - w.rest) * damp(w.act === 'rest' ? 0.9 : 2.2, dt);
      const lie = smooth01(w.rest);
      const lookYaw = Math.max(-0.8, Math.min(0.8, wrapAngle(Math.atan2(px - w.x, pz - w.z) - w.yaw))) * w.look;
      const gp = w.greet > 0 ? 1 - w.greet / GREET_S : 0;

      // lean to the ground underfoot; tortoises sit square on it
      const cy = Math.cos(w.yaw);
      const sy = Math.sin(w.yaw);
      const gc = ground(w.x, w.z);
      const span = 0.4 * size;
      const gf = ground(w.x + sy * span, w.z + cy * span);
      const gb = ground(w.x - sy * span, w.z - cy * span);
      const slope = Math.atan2(gb - gf, span * 2);
      const gy = gc + (gf + gb - 2 * gc) * 0.25;

      // small idle habits, shared by all
      w.earIn -= dt;
      if (w.earIn <= 0) {
        if (rnd() < 0.5) w.earL = 1;
        else w.earR = 1;
        w.earIn = 1.5 + rnd() * 5.5;
      }
      w.earL = Math.max(0, w.earL - dt * 8);
      w.earR = Math.max(0, w.earR - dt * 8);
      w.tailIn -= dt;
      if (w.tailIn <= 0) {
        w.tail = Math.max(w.tail, 0.6);
        w.tailIn = 3 + rnd() * 7;
      }
      w.tail = Math.max(0, w.tail - dt * 3);
      w.shiftIn -= dt;
      if (w.shiftIn <= 0 && !w.moving) {
        w.shift = 1;
        w.shiftLeg = Math.floor(rnd() * 4);
        w.shiftIn = 5 + rnd() * 10;
      }
      w.shift = Math.max(0, w.shift - dt * 2.2);

      if (kind === 'deer') {
        poseDeer(w, i, t, dt, gy, slope, lie, lookYaw, gp, ec.song, songUp, size, put, rnd);
      } else if (kind === 'tortoise') {
        // the shell tucks when rested, rumbled at or rushed
        if (v.speed > 3.2 && cd < 3.8) w.tuckT = 1.4;
        if (ec.quake > 0.3) w.tuckT = 0.8;
        w.tuckT = Math.max(0, w.tuckT - dt);
        w.tuck += ((w.tuckT > 0 || lie > 0.5 ? 1 : 0) - w.tuck) * damp(w.tuckT > 0 ? 7 : 1.3, dt);
        poseTortoise(w, i, t, dt, gy, slope, lie, lookYaw, gp, size, put);
        if (i < 8) {
          ec.warm[i * 2] = w.x;
          ec.warm[i * 2 + 1] = w.z;
          ec.warmN = Math.max(ec.warmN, i + 1);
        }
      } else {
        const birdNear = ec.bird.on && Math.hypot(ec.bird.x - w.x, ec.bird.z - w.z) < 4;
        poseHopper(w, i, t, gy, slope, lie, lookYaw, gp, cd, birdNear, size, put);
      }
    }
    for (const p of parts) {
      const mesh = meshes.current[p.name];
      if (mesh) mesh.instanceMatrix.needsUpdate = true;
    }
  });

  const poke = (e: ThreeEvent<MouseEvent>) => {
    if (!isPoke(e) || e.instanceId === undefined) return;
    const w = walkers[e.instanceId];
    if (!w || w.greet > 0) return;
    // a resting one gets up first; any of them then comes over to say hello
    w.mode = 'curious';
    w.act = 'roam';
    w.bond = 0;
    w.moving = false;
    w.watch = 0;
    greet(w);
  };

  return (
    <>
      {parts.map((p) => (
        <instancedMesh
          key={p.name}
          ref={(el) => {
            meshes.current[p.name] = el;
            if (el) el.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          }}
          args={[p.geo, p.name === 'shell' ? mats.shell : mats.body, count * p.n]}
          castShadow={p.cast}
          frustumCulled={false}
          name={`fauna-${kind}-${p.name}`}
          onClick={p.hit ? poke : undefined}
        />
      ))}
    </>
  );
};

type Put = (part: string, slot: number, m: THREE.Matrix4) => void;

const poseDeer = (
  w: Walker,
  i: number,
  t: number,
  dt: number,
  gy: number,
  slope: number,
  lie: number,
  lookYaw: number,
  gp: number,
  song: number,
  songUp: boolean,
  size: number,
  put: Put,
  rnd: () => number,
) => {
  // a walk moves the feet one at a time; a run brings them round in pairs
  const cycle = w.phase / (Math.PI * 2);
  const run = w.fast;
  const bob = Math.sin(w.phase * 2) * 0.012 * w.gait * (1 - run) + Math.abs(Math.sin(w.phase * 1)) * 0.1 * run * w.gait;
  const rock = Math.sin(w.phase) * 0.13 * run * w.gait;
  const sink = 0.46 * lie + 0.025 * (w.head * (1 - lie));
  const greetHop = gp > 0 ? Math.abs(Math.sin(gp * Math.PI * 2)) * 0.16 : 0;
  joint(_root, IDENT, w.x, gy + bob + greetHop - sink * size, w.z, slope + rock * w.gait, w.yaw, Math.sin(t * 0.21 + i * 2.1) * 0.012);
  _root.scale(_s.setScalar(size));
  put('torso', i, _root);

  // what the head is doing: grazing with pauses to look round, or held high in alarm
  const grazing = w.mode === 'wander' && !w.moving && w.act === 'graze' && w.watch <= 0 && w.alert <= 0 && !songUp;
  if (grazing) {
    w.grazeIn -= dt;
    if (w.grazeIn <= 0) {
      w.grazeUp = !w.grazeUp;
      w.grazeIn = w.grazeUp ? 1.6 + rnd() * 2.4 : 3 + rnd() * 6;
      w.scan = (rnd() - 0.5) * 1.2;
    }
  } else if (w.grazeUp) {
    w.grazeUp = false;
    w.grazeIn = 1 + rnd() * 3;
  }
  const down = grazing && !w.grazeUp ? 1 : 0;
  w.head += (down - w.head) * damp(down ? 2.2 : 3.4, dt);
  const chew = down * Math.max(0, Math.sin(t * 3.4 + i)) * 0.05;
  const alert = w.alert > 0 || w.alertIn >= 0 ? 1 : 0;

  // legs
  for (let k = 0; k < 4; k += 1) {
    const front = k < 2;
    const hip = front ? DEER.frontHip : DEER.hindHip;
    const off = WALK_OFF[k] * (1 - run) + RUN_OFF[k] * run;
    stride(cycle + off, 0.6 - run * 0.15, (0.52 + run * 0.5) * w.gait, (0.16 + run * 0.1) * w.gait);
    let fz = foot.z;
    let fy = foot.y;
    if (w.shift > 0 && w.shiftLeg === k && w.gait < 0.1) {
      const s = Math.sin(w.shift * Math.PI);
      fz += 0.05 * s;
      fy += 0.06 * s;
    }
    const hx = (k === 0 || k === 2 ? -1 : 1) * hip[0];
    const hh = hip[1] - sink - w.head * (front ? 0.04 : 0);
    // lying down the feet come in under the body
    solveLeg(fz + (front ? 0.14 : -0.2) * lie, -hh + fy + 0.012, DEER.thigh, DEER.shin, front ? 1 : -1);
    // lying down, each leg folds flat under the belly rather than following the solve
    const hipA = leg.hip + ((front ? -1.35 : -1.15) - leg.hip) * lie;
    const kneeA = leg.knee + ((front ? 2.7 : 2.45) - leg.knee) * lie;
    joint(_a, _root, hx, hip[1], hip[2], hipA);
    put('thigh', i * 4 + k, _a);
    joint(_b, _a, 0, -DEER.thigh, 0, kneeA);
    put('shin', i * 4 + k, _b);
  }

  // neck and head; a whale's song or a noise brings the head up, and the walk nods it
  const nod = Math.sin(w.phase * 2 + 0.5) * 0.05 * w.gait;
  const hi = alert * 0.34 + (songUp ? 0.22 : 0);
  const neckX = -0.12 - hi + w.head * 1.92 + nod + chew * 0.5 + lie * 0.28 + Math.sin(gp * Math.PI * 4) * 0.3 * (gp > 0 ? 1 : 0);
  const scanYaw = !down && w.look < 0.05 ? w.scan * (1 - w.head) : 0;
  joint(_a, _root, DEER.neck[0], DEER.neck[1], DEER.neck[2], neckX, lookYaw * 0.55 + scanYaw * 0.5, Math.sin(t * 0.5 + i) * 0.03);
  put('neck', i, _a);
  const headX = -neckX * 0.9 + 0.35 * w.head + chew - hi * 0.4 + (songUp ? -song * 0.5 : 0);
  joint(_b, _a, DEER.head[0], DEER.head[1], DEER.head[2], headX, lookYaw * 0.45 + scanYaw * 0.5, 0);
  put('head', i, _b);
  put('antler', i, i % 3 === 0 ? _b : _c.makeScale(0, 0, 0));

  // ears fall out to the side, come forward in alarm, and flick at nothing
  for (let s = 0; s < 2; s += 1) {
    const sx = s ? 1 : -1;
    const flick = (s ? w.earR : w.earL) * 0.5;
    joint(_c, _b, sx * DEER.ear[0], DEER.ear[1], DEER.ear[2], -0.18 - alert * 0.35 + flick, sx * 0.35, -sx * (0.85 - alert * 0.4 + flick));
    put('ear', i * 2 + s, _c);
  }

  // the tail hangs, flicks, and goes up as a flag when it runs
  const flag = Math.max(run * w.gait, alert);
  joint(_a, _root, DEER.tail[0], DEER.tail[1], DEER.tail[2], -0.2 - flag * 1.5, 0, Math.sin(t * 16) * w.tail * 0.5);
  put('tail', i, _a);
};

const poseTortoise = (
  w: Walker,
  i: number,
  t: number,
  dt: number,
  gy: number,
  slope: number,
  lie: number,
  lookYaw: number,
  gp: number,
  size: number,
  put: Put,
) => {
  // a slow lurch: the shell rolls onto the planted diagonal and tips with each step
  const cycle = w.phase / (Math.PI * 2);
  const roll = Math.sin(cycle * Math.PI * 2) * 0.05 * w.gait + (gp > 0 ? Math.sin(gp * Math.PI * 3) * 0.16 * (1 - gp) : 0);
  const heave = Math.abs(Math.sin(cycle * Math.PI * 2)) * 0.02 * w.gait;
  const settle = 0.11 * lie + 0.07 * w.tuck * (1 - lie);
  joint(_root, IDENT, w.x, gy + heave - settle * size, w.z, slope + Math.cos(cycle * Math.PI * 4) * 0.012 * w.gait, w.yaw, roll);
  _root.scale(_s.setScalar(size));
  put('shell', i, _root);
  put('skirt', i, _root);
  const pull = Math.max(lie, w.tuck);
  for (let k = 0; k < 4; k += 1) {
    const h = TORTOISE.hip[k];
    stride(cycle + (k === 0 || k === 3 ? 0 : 0.5), 0.72, 0.26 * w.gait, 0.11 * w.gait);
    const swing = Math.atan2(foot.z, 0.14);
    joint(_a, _root, h[0], h[1] + foot.y, h[2], -swing * (1 - pull), 0, 0);
    _a.scale(_s.set(1, 1 - 0.72 * pull, 1));
    put('leg', i * 4 + k, _a);
  }
  // the head moves slowly and pulls back into the shell when alarmed
  const grazing = w.mode === 'wander' && !w.moving && w.act === 'graze' && w.watch <= 0;
  w.head += ((grazing ? 1 : 0) - w.head) * damp(0.9, dt);
  const reach = 1 - pull;
  const nz = TORTOISE.neck[2] - 0.32 * pull;
  const sway = Math.sin(t * 0.33 + i * 1.7) * 0.32 * (1 - w.look);
  joint(_a, _root, 0, TORTOISE.neck[1] + 0.02 * w.head, nz, w.head * (0.42 + Math.max(0, Math.sin(t * 0.9 + i)) * 0.14) - 0.12 * reach, (lookYaw + sway) * reach, 0);
  _a.scale(_s.set(1, 1, Math.max(0.2, 0.55 + 0.45 * reach)));
  put('head', i, _a);
};

const poseHopper = (
  w: Walker,
  i: number,
  t: number,
  gy: number,
  slope: number,
  lie: number,
  lookYaw: number,
  gp: number,
  cd: number,
  birdNear: boolean,
  size: number,
  put: Put,
) => {
  // one hop: crouch, spring, flight, a hard landing, then recover
  let hop = 0;
  let squash = 1;
  const f = w.phase;
  if (w.gait > 0.05 && w.moving) {
    if (f < 0.22) squash = 1 - 0.3 * smooth01(f / 0.22);
    else if (f < 0.3) squash = 0.7 + 0.62 * smooth01((f - 0.22) / 0.08);
    else if (f < 0.72) {
      const u = (f - 0.3) / 0.42;
      hop = 4 * u * (1 - u);
      squash = 1.32 - 0.26 * u;
    } else if (f < 0.84) squash = 1.06 - 0.5 * smooth01((f - 0.72) / 0.12);
    else squash = 0.56 + 0.44 * smooth01((f - 0.84) / 0.16);
  }
  const excited = w.mode === 'curious' && !w.moving && cd < 5;
  if (!w.moving) {
    if (gp > 0) hop = Math.sin(gp * Math.PI) * 1.8;
    else if (excited) hop = Math.abs(Math.sin(t * 4 + i)) * 0.3;
    squash = 1 + Math.sin(t * (lie > 0.5 ? 0.9 : 1.8) + i) * 0.03;
    if (excited) squash = 1 - (1 - Math.min(1, hop)) * 0.18;
  }
  squash *= 1 - 0.28 * lie - (birdNear && !w.moving ? 0.1 : 0);

  const pecking = w.mode === 'wander' && !w.moving && w.act === 'graze' && w.watch <= 0 && !birdNear;
  const peck = pecking ? Math.max(0, Math.sin(t * 2.6 + i * 1.3)) ** 3 : 0;
  const lean = w.moving && w.gait > 0.05 ? (w.phase > 0.3 && w.phase < 0.72 ? -0.2 : 0.14) : 0;

  const scale = 1.4 * size;
  joint(_root, IDENT, w.x, gy, w.z, slope, w.yaw, 0);
  _root.scale(_s.setScalar(scale));
  const by = 0.24 + hop * 0.38 - lie * 0.1 - peck * 0.04 + (squash - 1) * 0.12;
  joint(_a, _root, 0, by, 0, peck * 0.45 + lean, gp > 0 ? smooth01(gp) * Math.PI * 2 : 0, 0);
  _b.copy(_a).scale(_s.set(1 / Math.sqrt(Math.max(squash, 0.4)), squash, 1 / Math.sqrt(Math.max(squash, 0.4))));
  put('body', i, _b);

  for (let s = 0; s < 2; s += 1) {
    const sx = s ? 1 : -1;
    const wander = w.mode === 'wander';
    const sway = Math.sin(t * (wander ? 1.3 : 3.6) + i * 1.7 + s * 2.1) * (wander ? 0.22 : 0.3) * (1 - lie * 0.8);
    joint(_c, _a, sx * 0.085, 0.15, 0.07, 0.25 + lie * 0.9 - hop * 0.3, lookYaw, sx * 0.3 + sway);
    put('stalk', i * 2 + s, _c);
    // big hind feet stay down through the crouch, trail in the air, and take the landing
    const air = Math.min(1, hop);
    joint(_c, _root, sx * 0.14, 0.01 + hop * 0.28, -0.08 - air * 0.06, air * -0.55, sx * 0.15, 0);
    put('foot', i * 2 + s, _c);
  }
};

export default Walkers;
