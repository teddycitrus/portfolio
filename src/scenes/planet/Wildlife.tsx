import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { Planet, PlanetStyle } from '@/types/content';
import { walkRadiusFor, type HeightFn } from './Terrain';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry, seedOf } from './rng';
import { critterCall, type CritterVoice } from '@/audio/drone';
import { dragLook, mouseLook } from '@/state/runtime';

/* ---------- which creatures live where ---------- */

type WalkerKind = 'deer' | 'hopper' | 'tortoise';

/** A herd of walkers: medium ones that follow and greet, or big ones that roam slower */
interface Herd {
  kind: WalkerKind;
  count: number;
  size?: number;
  speed?: number;
  /** Deer coat and leg colours */
  colors?: [string, string];
}

/**
 * Each planet has its own creatures, none shared with another: something very
 * small (a flier or a critter underfoot), something medium on the ground, and
 * one giant far off in the sky or on the horizon.
 */
interface Fauna {
  birds: { count: number; color: string; alt: [number, number]; radius: [number, number] } | null;
  walkers: Herd[];
  jellies: number;
  skitter: SkitterCfg | null;
  gliders: GliderCfg | null;
  colossus: boolean;
}

const FAUNA: Record<PlanetStyle, Fauna> = {
  // gulls wheeling over the island
  oceanic: {
    birds: { count: 9, color: '#f2f0ea', alt: [6, 10], radius: [12, 24] },
    walkers: [],
    jellies: 0,
    skitter: null,
    gliders: null,
    colossus: false,
  },
  // dark songbirds and grazing deer under the canopy
  forested: {
    birds: { count: 8, color: '#1a1714', alt: [6, 10], radius: [14, 26] },
    walkers: [{ kind: 'deer', count: 4 }],
    jellies: 0,
    skitter: null,
    gliders: null,
    colossus: false,
  },
  // About, dunes at dusk: dune lizards and birds; the bouncing hoppers; sky rays far overhead
  rocky: {
    birds: { count: 5, color: '#241a16', alt: [7, 11], radius: [14, 28] },
    walkers: [{ kind: 'hopper', count: 6 }],
    jellies: 0,
    skitter: { kind: 'lizard', count: 10, color: '#6b4a33' },
    gliders: { kind: 'manta', count: 2, color: '#3d2c3f', glow: '#ffb48a', glowK: 0.12, alt: [22, 30], radius: [30, 40] },
    colossus: false,
  },
  // Projects, night over the cloud deck: glowing crabs and drifters; long-legged grazers; sky whales
  'gas-giant': {
    birds: null,
    walkers: [{ kind: 'deer', count: 3, size: 1.15, speed: 0.8, colors: ['#9a8ac0', '#3e3456'] }],
    jellies: 7,
    skitter: { kind: 'crab', count: 9, color: '#2e2440', glow: '#b48cff' },
    gliders: { kind: 'whale', count: 2, color: '#8f7fc0', glow: '#c8b6ff', glowK: 0.3, alt: [18, 25], radius: [24, 32] },
    colossus: false,
  },
  // Awards, the molten world: ember salamanders; magma tortoises; a basalt colossus on the horizon
  molten: {
    birds: null,
    walkers: [{ kind: 'tortoise', count: 4 }],
    jellies: 0,
    skitter: { kind: 'ember', count: 10, color: '#2a140b', glow: '#ff6a1a' },
    gliders: null,
    colossus: true,
  },
};

const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const smooth01 = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/* ---------- the viewer, as the animals see them ---------- */

/** Smoothed walking speed (units/s) and how long the viewer has stood still (s). */
interface Viewer {
  x: number;
  z: number;
  speed: number;
  still: number;
}
type ViewerRef = { current: Viewer };

const _right = new THREE.Vector3();
/** Plays a call from a world point, levelled by distance and panned around the camera. */
const callFrom = (camera: THREE.Camera, kind: CritterVoice, x: number, y: number, z: number) => {
  const dx = x - camera.position.x;
  const dy = y - camera.position.y;
  const dz = z - camera.position.z;
  const d = Math.hypot(dx, dy, dz);
  _right.set(1, 0, 0).applyQuaternion(camera.quaternion);
  const pan = d > 1e-3 ? (dx * _right.x + dy * _right.y + dz * _right.z) / d : 0;
  critterCall(kind, d, pan * 0.85);
};

/** A real click on a creature (not the end of a drag, not a locked-cursor press). */
const isPoke = (e: ThreeEvent<MouseEvent>) => {
  e.stopPropagation();
  return dragLook.travel < 6 && !mouseLook.pressLocked;
};

/* ---------- birds: one instanced mesh, wings flap in the vertex shader ---------- */

const birdGeometry = (count: number, phases: number[]) => {
  // body diamond plus two wing triangles; aWing is 0 at the root and 1 at the tip
  const span = 0.55;
  const pos: number[] = [];
  const wing: number[] = [];
  const tri = (a: number[], b: number[], c: number[], wa: number, wb: number, wc: number) => {
    pos.push(...a, ...b, ...c);
    wing.push(wa, wb, wc);
  };
  // body (nose at -z, flight direction)
  tri([0, 0.03, -0.22], [-0.05, 0, 0.05], [0.05, 0, 0.05], 0, 0, 0);
  tri([-0.05, 0, 0.05], [0, 0, 0.2], [0.05, 0, 0.05], 0, 0, 0);
  // wings: swept back, two segments each for a soft bend
  for (const sx of [-1, 1]) {
    tri([0, 0, -0.07], [sx * span * 0.5, 0, -0.02], [0, 0, 0.07], 0, 0.5, 0);
    tri([sx * span * 0.5, 0, -0.02], [sx * span, 0, 0.1], [0, 0, 0.07], 0.5, 1, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aWing', new THREE.Float32BufferAttribute(wing, 1));
  g.setAttribute('aPhase', new THREE.InstancedBufferAttribute(new Float32Array(phases.slice(0, count)), 1));
  return g;
};

const birdMaterial = (color: string, time: { value: number }) => {
  const m = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float aWing;\nattribute float aPhase;\nuniform float uTime;',
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        // flap in bursts, then glide
        float burst = smoothstep(-0.3, 0.5, sin(uTime * 0.35 + aPhase * 3.0));
        float flap = sin(uTime * 9.0 + aPhase * 6.2831) * (0.15 + 0.85 * burst);
        transformed.y += flap * aWing * 0.32;
        transformed.x *= 1.0 - abs(flap) * aWing * 0.18;`,
      );
  };
  m.customProgramCacheKey = () => 'bird-flap';
  return m;
};

/** Seconds of standing still before a couple of birds come down to circle the viewer */
const BIRD_VISIT_AFTER = 3;
const BIRD_VISIT_S = 16;

const Birds = ({
  planet,
  cfg,
  viewer,
  reducedMotion,
}: {
  planet: Planet;
  cfg: NonNullable<Fauna['birds']>;
  viewer: ViewerRef;
  reducedMotion?: boolean;
}) => {
  const camera = useThree((s) => s.camera);
  const mesh = useRef<THREE.InstancedMesh>(null);
  const time = useMemo(() => ({ value: 0 }), []);
  const flocks = useMemo(() => {
    const rnd = mulberry(seedOf(`${planet.id}:birds`));
    // two loose flocks circling different centres
    const centres = [0, 1].map(() => ({
      x: (rnd() - 0.5) * 20,
      z: -10 - rnd() * 14,
      r: cfg.radius[0] + rnd() * (cfg.radius[1] - cfg.radius[0]),
      alt: cfg.alt[0] + rnd() * (cfg.alt[1] - cfg.alt[0]),
      w: (0.12 + rnd() * 0.06) * (rnd() < 0.5 ? -1 : 1),
    }));
    return Array.from({ length: cfg.count }, (_, i) => ({
      c: centres[i % 2],
      off: (rnd() - 0.5) * 0.9,
      dr: (rnd() - 0.5) * 3,
      da: (rnd() - 0.5) * 2.5,
      phase: rnd(),
      scale: 1.3 + rnd() * 0.5,
      // visiting state
      k: 0,
      visit: false,
      until: 0,
      slot: 0,
      callIn: 0,
      last: new THREE.Vector3(NaN, 0, 0),
      yaw: 0,
      bank: 0,
    }));
  }, [planet.id, cfg]);
  const visits = useRef({ cool: 4 });
  const geo = useMemo(() => birdGeometry(cfg.count, flocks.map((f) => f.phase)), [cfg.count, flocks]);
  const mat = useMemo(() => birdMaterial(cfg.color, time), [cfg.color, time]);
  useEffect(
    () => () => {
      geo.dispose();
      mat.dispose();
    },
    [geo, mat],
  );

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const _p = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ clock }, delta) => {
    const m = mesh.current;
    if (!m) return;
    const t = reducedMotion ? 4 : clock.elapsedTime;
    const dt = reducedMotion ? 0 : Math.min(delta, 0.05);
    time.value = t;
    const v = viewer.current;
    const cam = camera.position;

    // a still viewer gets company; walking off sends the visitors home
    const vs = visits.current;
    vs.cool -= dt;
    if (!reducedMotion && !flocks.some((f) => f.visit) && vs.cool <= 0 && v.still > BIRD_VISIT_AFTER) {
      flocks
        .map((f, i) => ({ f, i }))
        .filter(({ i }) => i % 3 !== 2)
        .slice(0, 2)
        .forEach(({ f }, j) => {
          f.visit = true;
          f.until = t + BIRD_VISIT_S + j * 3;
          f.slot = j;
          f.callIn = 1.5 + j;
        });
      vs.cool = 14;
    }
    flocks.forEach((f, i) => {
      if (f.visit && (t > f.until || v.speed > 2.2)) {
        f.visit = false;
        vs.cool = Math.max(vs.cool, 10);
        callFrom(camera, 'chirp', f.last.x, f.last.y, f.last.z);
      }
      f.k += ((f.visit ? 1 : 0) - f.k) * damp(0.7, dt);

      const a = f.c.w * t + f.off;
      const r = f.c.r + f.dr;
      _p.set(f.c.x + Math.cos(a) * r, f.c.alt + f.da + Math.sin(t * 0.4 + i) * 0.6, f.c.z + Math.sin(a) * r);
      const k = smooth01(f.k);
      if (k > 0.001) {
        // circle low over the viewer's head, the pair on opposite sides
        const va = t * 0.85 + f.slot * Math.PI;
        const vr = 2.6 + f.slot * 0.8;
        _p.lerp(
          dummy.position.set(cam.x + Math.cos(va) * vr, cam.y + 1.4 + Math.sin(t * 1.2 + f.slot) * 0.3, cam.z + Math.sin(va) * vr),
          k,
        );
        f.callIn -= dt;
        if (f.callIn <= 0 && k > 0.6) {
          callFrom(camera, 'chirp', _p.x, _p.y, _p.z);
          f.callIn = 2.5 + Math.random() * 3;
        }
      }
      // heading from motion; the model's nose is -z
      if (!Number.isNaN(f.last.x) && dt > 0) {
        const vx = _p.x - f.last.x;
        const vz = _p.z - f.last.z;
        if (vx * vx + vz * vz > 1e-8) {
          const want = Math.atan2(-vx, -vz);
          const turn = wrapAngle(want - f.yaw);
          f.yaw += turn * damp(6, dt);
          f.bank += (Math.max(-0.6, Math.min(0.6, -turn * 8)) - f.bank) * damp(3, dt);
        }
      } else {
        const dir = Math.sign(f.c.w) || 1;
        f.yaw = Math.atan2(Math.sin(a) * dir, -Math.cos(a) * dir);
        f.bank = -0.35 * dir;
      }
      f.last.copy(_p);
      dummy.position.copy(_p);
      dummy.rotation.set(0, f.yaw, 0);
      dummy.rotateZ(f.bank);
      dummy.scale.setScalar(f.scale * (1 - k * 0.25));
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  });

  return <instancedMesh ref={mesh} args={[geo, mat, cfg.count]} frustumCulled={false} />;
};

/*
 * ---------- walkers: deer and alien hoppers ----------
 * They keep to their own routine: walk somewhere, then graze (deer lower their
 * heads, hoppers peck at the ground) or lie down to rest. One that notices the
 * viewer looks up and watches, and about half the time comes over; a resting
 * one only gets up for a viewer close by. Once over, they follow for a while,
 * greet a viewer who stands still, skip back when rushed, then lose interest
 * and go back to their routine. A click on one wakes it and makes it greet.
 */

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
  phase: number;
  head: number;
  mode: Mode;
  /** Seconds spent following; they get bored eventually */
  bond: number;
  /** Seconds before it can notice the viewer again */
  cool: number;
  shyT: number;
  callIn: number;
  /** Greeting animation time left, and the wait before the next one */
  greet: number;
  greetCool: number;
  /** 0..1 how much the head tracks the viewer */
  look: number;
  /** Angle and distance offset of its spot beside the viewer, so a group fans out */
  slot: number;
  slotD: number;
  act: Act;
  /** 0..1 how far it has lain down */
  rest: number;
  /** Seconds left watching the viewer from where it is, without coming over */
  watch: number;
  /** How long this one stays interested once it comes over */
  patience: number;
}

const WALK_MIN_R = 14;
const WALK_MAX_R = 26;
/** They notice the viewer inside this range and give up beyond LOSE */
const NOTICE = 13;
const LOSE = 24;
/** Following distance and how long before they lose interest */
const FOLLOW = 2.4;
/** A resting animal only gets up for a viewer this close */
const WAKE_NEAR = 3.5;
/** The chance that an animal that notices the viewer comes over, rather than just watching */
const COME_CHANCE = 0.45;
const GREET_S = 1.3;
const WORLD_R = 34;

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
  reducedMotion?: boolean;
}) => {
  const camera = useThree((s) => s.camera);
  const refs = useRef<(THREE.Group | null)[]>([]);
  const legs = useRef<(THREE.Object3D | null)[][]>([]);
  const necks = useRef<(THREE.Object3D | null)[]>([]);
  const rnd = useMemo(() => mulberry(seedOf(`${planet.id}:walkers:${kind}:${size}`)), [planet.id, kind, size]);
  const ringMin = Math.min(WALK_MIN_R, maxR * 0.5);
  const ringMax = Math.min(WALK_MAX_R, maxR - 2);
  const worldR = Math.min(WORLD_R, maxR - 0.5);

  const pick = (w: Walker) => {
    // stay in the ring behind the monuments; short hops in angle keep paths clear of them
    const a0 = Math.atan2(w.z, w.x);
    const a = a0 + (rnd() - 0.5) * 1.6;
    const r = ringMin + rnd() * (ringMax - ringMin);
    w.tx = Math.cos(a) * r;
    w.tz = Math.sin(a) * r;
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
          head: 0,
          mode: 'wander',
          bond: 0,
          cool: 2 + rnd() * 4,
          shyT: 0,
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
        };
        if (w.act === 'rest') w.rest = 1;
        w.tx = w.x;
        w.tz = w.z;
        return w;
      }),
    [count, rnd],
  );

  const mats = useMemo(() => {
    if (kind === 'deer') {
      return {
        body: new THREE.MeshStandardMaterial({ color: colors?.[0] ?? '#7a5636', roughness: 0.85, flatShading: true }),
        dark: new THREE.MeshStandardMaterial({ color: colors?.[1] ?? '#3b2a1c', roughness: 0.9, flatShading: true }),
        glow: null,
      };
    }
    if (kind === 'tortoise') {
      // a basalt shell with lava glowing through its seams
      return {
        body: new THREE.MeshStandardMaterial({ color: '#2b211c', roughness: 0.9, flatShading: true }),
        dark: new THREE.MeshStandardMaterial({ color: '#120c09', roughness: 0.95, flatShading: true }),
        glow: new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff6a1a').multiplyScalar(1.6) }),
      };
    }
    const accent = new THREE.Color(planet.accent);
    return {
      body: new THREE.MeshStandardMaterial({
        color: new THREE.Color('#8a6a9a').lerp(accent, 0.25),
        roughness: 0.55,
        flatShading: true,
      }),
      dark: new THREE.MeshStandardMaterial({ color: '#3a2c40', roughness: 0.8, flatShading: true }),
      glow: new THREE.MeshBasicMaterial({ color: accent.clone().multiplyScalar(1.4) }),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, planet.accent, colors?.[0], colors?.[1]]);
  useEffect(() => () => Object.values(mats).forEach((m) => m?.dispose()), [mats]);

  const speak = (w: Walker) =>
    callFrom(camera, kind === 'deer' ? 'mew' : kind === 'tortoise' ? 'boop' : 'squeak', w.x, ground(w.x, w.z) + 0.6, w.z);
  const greet = (w: Walker) => {
    w.greet = GREET_S;
    w.greetCool = 7 + rnd() * 6;
    speak(w);
  };

  useFrame(({ clock }, delta) => {
    const dt = reducedMotion ? 0 : Math.min(delta, 0.05);
    const t = clock.elapsedTime;
    const v = viewer.current;
    const px = camera.position.x;
    const pz = camera.position.z;
    walkers.forEach((w, i) => {
      const g = refs.current[i];
      if (!g) return;
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
        if (w.mode === 'wander' && w.cool <= 0 && cd < (resting ? WAKE_NEAR : NOTICE)) {
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
          if (w.shyT <= 0) w.mode = 'curious';
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
            // a spot beside the viewer on its own side; a group fans out around you
            const a = Math.atan2(cdz, cdx) + w.slot;
            const fd = FOLLOW + w.slotD;
            w.tx = px + Math.cos(a) * fd;
            w.tz = pz + Math.sin(a) * fd;
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
      if (w.mode === 'wander' && !w.moving && w.timer <= 0) {
        // done eating or resting: get up and go somewhere else
        w.act = 'roam';
        pick(w);
        w.moving = true;
      }
      const dx = w.tx - w.x;
      const dz = w.tz - w.z;
      const d = Math.hypot(dx, dz);
      const hurry = w.mode === 'shy' ? 2.6 : w.mode === 'curious' && d > 5 ? 2.3 : 1;
      const speed = (kind === 'deer' ? 0.9 : kind === 'tortoise' ? 0.45 : 1.1) * hurry * speedK;
      if (w.moving && w.greet <= 0 && w.rest < 0.15) {
        if (d < (w.mode === 'wander' ? 0.15 : 0.4)) {
          w.moving = false;
          if (w.mode === 'wander') {
            // arrived: settle down to eat, or now and then to lie down for a rest
            w.act = rnd() < 0.25 ? 'rest' : 'graze';
            w.timer = w.act === 'rest' ? 12 + rnd() * 14 : 4 + rnd() * 8;
          }
        } else {
          const want = Math.atan2(dx, dz);
          w.yaw += wrapAngle(want - w.yaw) * damp(3, dt);
          // move only once roughly facing the target
          const facing = Math.max(0, Math.cos(wrapAngle(want - w.yaw)));
          const step = Math.min(d, speed * dt * facing);
          w.x += Math.sin(w.yaw) * step;
          w.z += Math.cos(w.yaw) * step;
          w.phase += (step * (kind === 'deer' ? 5.5 : kind === 'tortoise' ? 7 : 4.2)) / size;
        }
      } else if (w.mode !== 'wander' && !w.moving) {
        // stopped near you: turn to face you
        w.yaw += wrapAngle(Math.atan2(px - w.x, pz - w.z) - w.yaw) * damp(2.5, dt);
      }

      // walk around monuments and each other, stay on the island
      for (const [ox, oz] of obstacles) {
        const ex = w.x - ox;
        const ez = w.z - oz;
        const e = Math.hypot(ex, ez);
        const keep = 1.35 * size;
        if (e < keep && e > 1e-4) {
          w.x = ox + (ex / e) * keep;
          w.z = oz + (ez / e) * keep;
        }
      }
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
      w.look += ((w.mode !== 'wander' || w.watch > 0 ? 1 : 0) - w.look) * damp(2, dt);
      w.rest += ((w.act === 'rest' && !w.moving && w.mode === 'wander' ? 1 : 0) - w.rest) * damp(w.act === 'rest' ? 0.9 : 2.2, dt);
      const lie = smooth01(w.rest);
      const lookYaw = Math.max(-0.8, Math.min(0.8, wrapAngle(Math.atan2(px - w.x, pz - w.z) - w.yaw))) * w.look;
      const gp = w.greet > 0 ? 1 - w.greet / GREET_S : 0;
      const gy = ground(w.x, w.z);
      g.position.set(w.x, gy, w.z);
      g.rotation.y = w.yaw;

      if (kind === 'deer') {
        const swing = w.moving ? Math.sin(w.phase) * 0.55 : 0;
        // lying down: the legs fold under (front back, hind forward) and the body sinks to the ground
        legs.current[i]?.forEach((leg, k) => {
          if (leg) leg.rotation.x = (k === 0 || k === 3 ? 1 : -1) * swing * (1 - lie) + (k < 2 ? -1.45 : 1.45) * lie;
        });
        g.position.y -= 0.46 * lie * size;
        // graze with the head down, look up now and then (or to watch you); lying down the head
        // stays up, nodding off and back
        const grazing = w.mode === 'wander' && !w.moving && w.act === 'graze' && w.watch <= 0 && Math.sin(t * 0.5 + i * 2.3) > -0.3;
        w.head += ((grazing ? 1 : 0) - w.head) * damp(2.5, dt);
        const neck = necks.current[i];
        if (neck) {
          neck.rotation.x =
            -0.35 + w.head * 1.35 + (grazing ? Math.sin(t * 3 + i) * 0.04 : 0) + Math.sin(gp * Math.PI * 4) * 0.3 * (gp > 0 ? 1 : 0) +
            lie * (0.25 + 0.12 * Math.max(0, Math.sin(t * 0.35 + i)) * (w.watch > 0 ? 0 : 1));
          neck.rotation.y = lookYaw;
        }
        // a hello is two little prancing hops
        if (gp > 0) g.position.y += Math.abs(Math.sin(gp * Math.PI * 2)) * 0.16;
      } else if (kind === 'tortoise') {
        // stubby legs paddle when it plods; resting, it pulls them and its head into the shell
        const swing = w.moving ? Math.sin(w.phase) * 0.55 : 0;
        legs.current[i]?.forEach((leg, k) => {
          if (!leg) return;
          leg.rotation.x = (k === 0 || k === 3 ? 1 : -1) * swing * (1 - lie);
          leg.scale.y = 1 - 0.75 * lie;
        });
        g.position.y -= 0.1 * lie * size;
        const grazing = w.mode === 'wander' && !w.moving && w.act === 'graze' && w.watch <= 0;
        w.head += ((grazing ? 1 : 0) - w.head) * damp(1.6, dt);
        const neck = necks.current[i];
        if (neck) {
          neck.position.z = 0.42 - 0.2 * lie;
          neck.rotation.x = w.head * (0.45 + Math.max(0, Math.sin(t * 1.4 + i)) * 0.12);
          neck.rotation.y = lookYaw;
        }
        // a hello is a slow happy rock from side to side
        g.rotation.z = gp > 0 ? Math.sin(gp * Math.PI * 3) * 0.16 * (1 - gp) : 0;
      } else {
        // hoppers bounce along with a squash on landing; near you they bounce in place
        const excited = w.mode === 'curious' && !w.moving && cd < 5;
        const hop = w.moving
          ? Math.abs(Math.sin(w.phase))
          : gp > 0
            ? Math.sin(gp * Math.PI) * 1.8
            : excited
              ? Math.abs(Math.sin(t * 5 + i)) * 0.3
              : 0;
        const body = g.children[0];
        // eating: little pecks at the ground; resting: settled flat, breathing slowly
        const pecking = w.mode === 'wander' && !w.moving && w.act === 'graze' && w.watch <= 0;
        const peck = pecking ? Math.max(0, Math.sin(t * 3.2 + i * 1.3)) ** 3 : 0;
        body.position.y = 0.24 + hop * 0.38 - lie * 0.1 - peck * 0.04;
        body.rotation.x = peck * 0.45;
        // a hello is a big hop with a full spin
        body.rotation.y = gp > 0 ? smooth01(gp) * Math.PI * 2 : 0;
        const squash =
          (w.moving || excited ? 1 - (1 - Math.min(1, hop)) * 0.25 : 1 + Math.sin(t * (lie > 0.5 ? 0.9 : 2) + i) * 0.03) * (1 - 0.28 * lie);
        body.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
        const neck = necks.current[i];
        if (neck) {
          neck.rotation.z = Math.sin(t * (w.mode === 'wander' ? 1.3 : 4.5) + i * 1.7) * (w.mode === 'wander' ? 0.25 : 0.35) * (1 - lie * 0.8);
          neck.rotation.y = lookYaw;
          // the eye stalks droop while it rests
          neck.rotation.x = lie * 0.9;
        }
      }
    });
  });

  const poke = (e: ThreeEvent<MouseEvent>, i: number) => {
    if (!isPoke(e)) return;
    const w = walkers[i];
    if (w.greet > 0) return;
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
      {walkers.map((_, i) => {
        if (!legs.current[i]) legs.current[i] = [];
        if (kind === 'tortoise')
          return (
            <group key={i} ref={(el) => (refs.current[i] = el)} scale={size} onClick={(e) => poke(e, i)}>
              {/* the domed shell, lava showing at its rim and through cracks on top */}
              <mesh material={mats.body} position={[0, 0.2, 0]} scale={[1, 0.62, 1.2]} castShadow>
                <sphereGeometry args={[0.45, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
              </mesh>
              <mesh material={mats.glow ?? mats.body} position={[0, 0.205, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 1.2, 1]}>
                <torusGeometry args={[0.44, 0.022, 6, 28]} />
              </mesh>
              {[
                [0, 0.39, 0.05, 0.3],
                [0.12, 0.36, -0.15, -0.9],
                [-0.14, 0.35, 0.18, 1.2],
              ].map(([x, y, z, ry], k) => (
                <mesh key={k} material={mats.glow ?? mats.body} position={[x, y, z]} rotation={[0, ry, 0]}>
                  <boxGeometry args={[0.36, 0.012, 0.025]} />
                </mesh>
              ))}
              <mesh material={mats.dark} position={[0, 0.17, 0]} scale={[1, 1, 1.2]}>
                <cylinderGeometry args={[0.43, 0.4, 0.06, 14]} />
              </mesh>
              {[
                [-0.3, 0.32],
                [0.3, 0.32],
                [-0.3, -0.32],
                [0.3, -0.32],
              ].map(([x, z], k) => (
                <group key={k} position={[x, 0.2, z]} ref={(el) => (legs.current[i][k] = el)}>
                  <mesh material={mats.dark} position={[0, -0.1, 0]} castShadow>
                    <cylinderGeometry args={[0.08, 0.09, 0.22, 7]} />
                  </mesh>
                </group>
              ))}
              <group position={[0, 0.22, 0.42]} ref={(el) => (necks.current[i] = el)}>
                <mesh material={mats.body} position={[0, 0, 0.08]} castShadow>
                  <boxGeometry args={[0.18, 0.14, 0.2]} />
                </mesh>
                {[-1, 1].map((sx) => (
                  <mesh key={sx} material={mats.glow ?? mats.body} position={[sx * 0.055, 0.03, 0.18]}>
                    <sphereGeometry args={[0.018, 6, 5]} />
                  </mesh>
                ))}
              </group>
            </group>
          );
        return kind === 'deer' ? (
          <group key={i} ref={(el) => (refs.current[i] = el)} scale={size} onClick={(e) => poke(e, i)}>
            {/* body and legs; the model faces +z */}
            <mesh material={mats.body} position={[0, 0.72, 0]} castShadow>
              <boxGeometry args={[0.32, 0.34, 0.78]} />
            </mesh>
            <mesh material={mats.body} position={[0, 0.82, -0.42]} rotation={[0.7, 0, 0]}>
              <boxGeometry args={[0.06, 0.06, 0.16]} />
            </mesh>
            {[
              [-0.11, 0.3],
              [0.11, 0.3],
              [-0.11, -0.3],
              [0.11, -0.3],
            ].map(([x, z], k) => (
              <group key={k} position={[x, 0.6, z]} ref={(el) => (legs.current[i][k] = el)}>
                <mesh material={mats.dark} position={[0, -0.3, 0]} castShadow>
                  <boxGeometry args={[0.07, 0.6, 0.07]} />
                </mesh>
              </group>
            ))}
            <group position={[0, 0.84, 0.34]} ref={(el) => (necks.current[i] = el)}>
              <mesh material={mats.body} position={[0, 0.2, 0.06]} rotation={[0.35, 0, 0]} castShadow>
                <boxGeometry args={[0.13, 0.42, 0.14]} />
              </mesh>
              <mesh material={mats.body} position={[0, 0.42, 0.2]} castShadow>
                <boxGeometry args={[0.15, 0.15, 0.3]} />
              </mesh>
              {[-1, 1].map((s) => (
                <mesh key={s} material={mats.dark} position={[s * 0.09, 0.52, 0.12]} rotation={[0, 0, s * 0.6]}>
                  <boxGeometry args={[0.05, 0.12, 0.03]} />
                </mesh>
              ))}
            </group>
          </group>
        ) : (
          <group key={i} ref={(el) => (refs.current[i] = el)} scale={1.4 * size} onClick={(e) => poke(e, i)}>
            <group>
              <mesh material={mats.body} castShadow>
                <icosahedronGeometry args={[0.24, 1]} />
              </mesh>
              <mesh material={mats.dark} position={[0, -0.04, 0.2]} scale={[1, 0.5, 0.6]}>
                <sphereGeometry args={[0.1, 10, 8]} />
              </mesh>
              {/* two eye stalks with glowing tips */}
              <group position={[0, 0.18, 0.06]} ref={(el) => (necks.current[i] = el)}>
                {[-1, 1].map((s) => (
                  <group key={s} position={[s * 0.08, 0, 0]} rotation={[0.25, 0, s * 0.35]}>
                    <mesh material={mats.dark} position={[0, 0.12, 0]}>
                      <cylinderGeometry args={[0.012, 0.018, 0.24, 5]} />
                    </mesh>
                    <mesh material={mats.glow ?? mats.body} position={[0, 0.26, 0]}>
                      <sphereGeometry args={[0.04, 10, 8]} />
                    </mesh>
                  </group>
                ))}
              </group>
            </group>
          </group>
        );
      })}
    </>
  );
};

/*
 * ---------- skitterers: small quick things on the ground ----------
 * Lizards, little crabs, ember salamanders. They dart about in short bursts
 * near a home spot and bolt when the viewer comes at them. The easter egg:
 * stand still near them for a few seconds and they creep up and run circles
 * round your feet, clicking; move and they scatter. A click on one makes it
 * jump and spin, and the others near it scatter.
 */

type SkitterKind = 'lizard' | 'crab' | 'ember';
interface SkitterCfg {
  kind: SkitterKind;
  count: number;
  color: string;
  /** Emissive glow (ember salamanders, glowing crabs) */
  glow?: string;
}

interface Skitter {
  x: number;
  z: number;
  yaw: number;
  tx: number;
  tz: number;
  hx: number;
  hz: number;
  state: 'idle' | 'dash' | 'flee' | 'gather';
  timer: number;
  /** Seconds before it will come round the viewer again */
  cool: number;
  phase: number;
  /** Jump time left after a click */
  jump: number;
  ring: number;
  callIn: number;
}

/** Standing still this long near them brings them round */
const GATHER_AFTER = 3.5;
const GATHER_NEAR = 8;
const BOLT_NEAR = 3.5;
const JUMP_S = 0.7;

const skitterGeometry = (kind: SkitterKind) => {
  const parts: THREE.BufferGeometry[] = [];
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, ry = 0, rx = 0) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.rotateX(rx);
    g.rotateY(ry);
    g.translate(x, y, z);
    parts.push(g);
  };
  if (kind === 'crab') {
    box(0.22, 0.07, 0.16, 0, 0.07, 0);
    for (const s of [-1, 1]) {
      for (let k = 0; k < 3; k += 1) box(0.14, 0.02, 0.02, s * 0.15, 0.04, -0.05 + k * 0.05, s * (0.25 - k * 0.25), 0);
      // claws held up in front
      box(0.05, 0.05, 0.08, s * 0.1, 0.09, 0.12, s * 0.4);
    }
  } else if (kind === 'ember') {
    // a long low salamander: a ridge of spines down its back, a frilled head, a long curled tail
    box(0.1, 0.05, 0.3, 0, 0.045, 0);
    box(0.08, 0.045, 0.1, 0, 0.05, 0.19);
    box(0.2, 0.012, 0.05, 0, 0.07, 0.15, 0, -0.5);
    for (let k = 0; k < 5; k += 1) box(0.015, 0.05 - k * 0.006, 0.025, 0, 0.085, 0.1 - k * 0.07);
    box(0.04, 0.025, 0.2, 0.03, 0.035, -0.24, 0.35);
    box(0.03, 0.02, 0.16, 0.1, 0.03, -0.4, 1.0);
    for (const s of [-1, 1]) for (const z of [0.08, -0.08]) box(0.1, 0.02, 0.025, s * 0.09, 0.02, z, s * (z > 0 ? -0.7 : 0.7));
  } else {
    const slim = 1;
    box(0.12 * slim, 0.055, 0.26, 0, 0.05, 0);
    box(0.09 * slim, 0.05, 0.1, 0, 0.055, 0.17);
    box(0.045 * slim, 0.03, 0.26, 0, 0.04, -0.24);
    for (const s of [-1, 1]) for (const z of [0.07, -0.07]) box(0.09, 0.025, 0.03, s * 0.09, 0.025, z, s * (z > 0 ? -0.5 : 0.5));
  }
  const g = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return g!;
};

const Skitterers = ({
  planet,
  cfg,
  ground,
  obstacles,
  viewer,
  maxR,
  reducedMotion,
}: {
  planet: Planet;
  cfg: SkitterCfg;
  ground: HeightFn;
  obstacles: [number, number][];
  viewer: ViewerRef;
  maxR: number;
  reducedMotion?: boolean;
}) => {
  const camera = useThree((s) => s.camera);
  const mesh = useRef<THREE.InstancedMesh>(null);
  const rnd = useMemo(() => mulberry(seedOf(`${planet.id}:skitter`)), [planet.id]);
  const geo = useMemo(() => skitterGeometry(cfg.kind), [cfg.kind]);
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: cfg.color,
        roughness: 0.7,
        flatShading: true,
        emissive: new THREE.Color(cfg.glow ?? '#000000'),
        emissiveIntensity: cfg.glow ? 1.6 : 0,
      }),
    [cfg.color, cfg.glow],
  );
  useEffect(
    () => () => {
      geo.dispose();
      mat.dispose();
    },
    [geo, mat],
  );

  const crits = useMemo<Skitter[]>(
    () =>
      Array.from({ length: cfg.count }, (_, i) => {
        // a few loose groups round the far side and the flanks
        const a = -Math.PI / 2 + ((i % 3) - 1) * 1.1 + (rnd() - 0.5) * 0.5;
        const r = 7 + rnd() * Math.max(2, Math.min(18, maxR - 9));
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        return { x, z, yaw: rnd() * 6.28, tx: x, tz: z, hx: x, hz: z, state: 'idle', timer: rnd() * 3, cool: 0, phase: rnd() * 10, jump: 0, ring: (i / cfg.count) * Math.PI * 2, callIn: 1 + rnd() * 3 };
      }),
    [cfg.count, rnd, maxR],
  );

  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame(({ clock }, delta) => {
    const m = mesh.current;
    if (!m) return;
    const dt = reducedMotion ? 0 : Math.min(delta, 0.05);
    const t = clock.elapsedTime;
    const v = viewer.current;
    const px = camera.position.x;
    const pz = camera.position.z;
    crits.forEach((c, i) => {
      const dx = c.x - px;
      const dz = c.z - pz;
      const d = Math.hypot(dx, dz);
      c.timer -= dt;
      c.cool -= dt;
      c.jump = Math.max(0, c.jump - dt);
      if (!reducedMotion) {
        if (c.state === 'gather') {
          if (v.speed > 0.6) {
            // you moved: scatter
            c.state = 'flee';
            c.tx = c.x + (dx / (d || 1)) * 5;
            c.tz = c.z + (dz / (d || 1)) * 5;
            c.cool = 8;
          }
        } else if (c.state !== 'flee' && d < BOLT_NEAR && v.speed > 0.5) {
          c.state = 'flee';
          c.tx = c.x + (dx / (d || 1)) * 5;
          c.tz = c.z + (dz / (d || 1)) * 5;
        } else if (c.state !== 'flee' && c.cool <= 0 && v.still > GATHER_AFTER && d < GATHER_NEAR) {
          c.state = 'gather';
        }
      }
      if (c.state === 'gather') {
        // round the viewer's feet, each in its own place on the ring
        const a = c.ring + t * 0.7;
        c.tx = px + Math.cos(a) * 1.7;
        c.tz = pz + Math.sin(a) * 1.7;
        c.callIn -= dt;
        if (c.callIn <= 0) {
          callFrom(camera, 'trill', c.x, ground(c.x, c.z), c.z);
          c.callIn = 2.5 + rnd() * 3;
        }
      } else if (c.state === 'idle' && c.timer <= 0) {
        c.state = 'dash';
        const a = rnd() * Math.PI * 2;
        const r = 1 + rnd() * 3.5;
        c.tx = c.hx + Math.cos(a) * r;
        c.tz = c.hz + Math.sin(a) * r;
      }
      const ex = c.tx - c.x;
      const ez = c.tz - c.z;
      const e = Math.hypot(ex, ez);
      const speed = c.state === 'flee' ? 5.5 : c.state === 'gather' ? 2.4 : 3.2;
      let moving = false;
      if (c.state !== 'idle' && c.jump <= 0) {
        if (e < 0.08 && c.state !== 'gather') {
          if (c.state === 'flee') {
            // settle where it ran to
            c.hx = c.x;
            c.hz = c.z;
          }
          c.state = 'idle';
          c.timer = 0.6 + rnd() * 2.8;
        } else if (e > 0.02) {
          moving = true;
          const want = Math.atan2(ex, ez);
          c.yaw += wrapAngle(want - c.yaw) * damp(14, dt);
          const step = Math.min(e, speed * dt);
          c.x += Math.sin(c.yaw) * step;
          c.z += Math.cos(c.yaw) * step;
          c.phase += step * 40;
        }
      }
      for (const [ox, oz] of obstacles) {
        const ox2 = c.x - ox;
        const oz2 = c.z - oz;
        const o = Math.hypot(ox2, oz2);
        if (o < 1.2 && o > 1e-4) {
          c.x = ox + (ox2 / o) * 1.2;
          c.z = oz + (oz2 / o) * 1.2;
        }
      }
      const wr = Math.hypot(c.x, c.z);
      if (wr > maxR) {
        c.x *= maxR / wr;
        c.z *= maxR / wr;
      }
      const jp = c.jump > 0 ? 1 - c.jump / JUMP_S : 0;
      dummy.position.set(c.x, ground(c.x, c.z) + (jp > 0 ? Math.sin(jp * Math.PI) * 0.45 : 0), c.z);
      // a body wiggle while running, a spin in the jump
      dummy.rotation.set(0, c.yaw + (moving ? Math.sin(c.phase) * 0.28 : 0) + jp * Math.PI * 2, 0);
      dummy.scale.setScalar(1.25);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  });

  const poke = (e: ThreeEvent<MouseEvent>) => {
    if (!isPoke(e) || e.instanceId === undefined) return;
    const c = crits[e.instanceId];
    if (!c || c.jump > 0) return;
    c.jump = JUMP_S;
    callFrom(camera, 'trill', c.x, ground(c.x, c.z), c.z);
    // the others near it scatter
    for (const o of crits) {
      if (o === c) continue;
      const dx = o.x - c.x;
      const dz = o.z - c.z;
      const d = Math.hypot(dx, dz);
      if (d < 2.5) {
        o.state = 'flee';
        o.tx = o.x + (dx / (d || 1)) * 4;
        o.tz = o.z + (dz / (d || 1)) * 4;
        o.cool = 6;
      }
    }
  };

  return <instancedMesh ref={mesh} args={[geo, mat, cfg.count]} castShadow frustumCulled={false} onClick={poke} />;
};

/*
 * ---------- gliders: big slow creatures of the sky ----------
 * Sky rays and sky whales wheeling in wide, slow loops high overhead, their
 * wings or flukes rippling. The easter egg: stand still and look up at one for
 * a couple of seconds (or click it) and it answers with a long low call and
 * swoops down in a broad circle over you, then climbs back up.
 */

type GliderKind = 'manta' | 'whale';
interface GliderCfg {
  kind: GliderKind;
  count: number;
  color: string;
  glow: string;
  /** How strongly the glow shows (bioluminescent spots, lava-lit edges) */
  glowK: number;
  alt: [number, number];
  radius: [number, number];
}

const GAZE_S = 2.2;
const SWOOP_S = 16;
const SWOOP_COOL_S = 40;
const GAZE_COS = Math.cos(0.14);

/** A wide ray (manta) or a long whale: a body with wings or fins; aWing rises toward the tips. */
const gliderGeometry = (kind: GliderKind) => {
  const manta = kind === 'manta';
  const span = manta ? 4.2 : 2.2;
  const len = manta ? 2.0 : 6.5;
  const g = new THREE.PlaneGeometry(span * 2, len, 28, 14);
  g.rotateX(-Math.PI / 2);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const wing = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const u = Math.abs(x) / span; // 0 at the spine, 1 at the tip
    const w = z / (len / 2); // -1 tail .. 1 nose
    let chord: number;
    let thick: number;
    if (manta) {
      // a ray's outline: the leading edge runs from a blunt head out to tips swept well back,
      // the trailing edge curves in behind; a thick body ridge down the middle
      const lead = (1 - u) ** 0.55 - 0.85 * u;
      const trail = -0.6 * (1 - u) ** 1.5 - 0.85 * u;
      pos.setZ(i, (len / 2) * (trail + ((w + 1) / 2) * (lead - trail)));
      chord = 1;
      thick = 0.34 * Math.max(0, 1 - u / 0.32) ** 2 * Math.sqrt(Math.max(0, 1 - w * w));
      pos.setY(i, thick);
      wing[i] = THREE.MathUtils.clamp((u - 0.12) / 0.8, 0, 1);
      continue;
    } else {
      // a long round body, small rounded pectoral fins a third back, and a fluke at the tail
      const body = Math.sqrt(Math.max(0, 1 - w * w)) * (0.42 + 0.08 * w);
      const fin = Math.sqrt(Math.max(0, 1 - ((w - 0.28) / 0.22) ** 2)) * 0.95;
      const fluke = Math.sqrt(Math.max(0, 1 - ((w + 0.9) / 0.1) ** 2)) * 0.85;
      chord = 1;
      // points outside the outline are pulled in onto it
      const r = Math.min(1, Math.max(body, fin, fluke));
      if (u > r) pos.setX(i, Math.sign(x) * r * span);
      thick = body * 0.9 * Math.max(0, 1 - u * 2.2);
    }
    pos.setZ(i, z * Math.max(0.05, chord));
    pos.setY(i, thick);
    wing[i] = THREE.MathUtils.clamp((Math.abs(pos.getX(i)) / span - (manta ? 0.12 : 0.2)) / 0.8, 0, 1);
  }
  g.setAttribute('aWing', new THREE.BufferAttribute(wing, 1));
  g.computeVertexNormals();
  if (!manta) return g;
  // and a long thin tail trailing behind
  const tail = new THREE.ConeGeometry(0.06, 2.4, 6);
  tail.rotateX(-Math.PI / 2);
  tail.translate(0, 0.05, -(len / 2) * 0.6 - 1.2);
  tail.setAttribute('aWing', new THREE.BufferAttribute(new Float32Array(tail.getAttribute('position').count), 1));
  const merged = mergeGeometries([g, tail]);
  g.dispose();
  tail.dispose();
  return merged!;
};

const gliderMaterial = (cfg: GliderCfg, time: { value: number }, phase: number) => {
  const m = new THREE.MeshStandardMaterial({
    color: cfg.color,
    roughness: 0.75,
    side: THREE.DoubleSide,
    emissive: new THREE.Color(cfg.glow),
    emissiveIntensity: cfg.glowK,
  });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.uniforms.uPhase = { value: phase };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aWing;\nuniform float uTime;\nuniform float uPhase;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        // slow strokes rolling out along the wings, and a wave down the body from nose to tail
        float stroke = sin(uTime * 0.9 + uPhase - aWing * 1.6);
        transformed.y += stroke * aWing * aWing * ${cfg.kind === 'manta' ? '0.65' : '0.45'};
        transformed.y += sin(uTime * 0.8 + uPhase + position.z * 0.7) * ${cfg.kind === 'manta' ? '0.08' : '0.28'} * (1.0 - aWing);`,
      );
  };
  m.customProgramCacheKey = () => `glider-${cfg.kind}`;
  return m;
};

interface GliderState {
  cx: number;
  cz: number;
  r: number;
  w: number;
  th: number;
  alt: number;
  ph: number;
  gaze: number;
  swoop: number;
  /** 0..1 how far into the swoop it has blended */
  k: number;
  cool: number;
  sang: boolean;
  last: THREE.Vector3;
}

const Gliders = ({ planet, cfg, reducedMotion }: { planet: Planet; cfg: GliderCfg; reducedMotion?: boolean }) => {
  const camera = useThree((s) => s.camera);
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  const time = useMemo(() => ({ value: 0 }), []);
  const rnd = useMemo(() => mulberry(seedOf(`${planet.id}:gliders`)), [planet.id]);
  const geo = useMemo(() => gliderGeometry(cfg.kind), [cfg.kind]);
  const states = useMemo<GliderState[]>(
    () =>
      Array.from({ length: cfg.count }, (_, i) => ({
        cx: (rnd() - 0.5) * 20,
        cz: -12 - rnd() * 20,
        r: cfg.radius[0] + rnd() * (cfg.radius[1] - cfg.radius[0]),
        w: (0.035 + rnd() * 0.02) * (i % 2 ? -1 : 1),
        th: rnd() * Math.PI * 2,
        alt: cfg.alt[0] + rnd() * (cfg.alt[1] - cfg.alt[0]),
        ph: rnd() * 6.28,
        gaze: 0,
        swoop: 0,
        k: 0,
        cool: 8,
        sang: false,
        last: new THREE.Vector3(NaN, 0, 0),
      })),
    [cfg, rnd],
  );
  const mats = useMemo(() => states.map((s) => gliderMaterial(cfg, time, s.ph)), [states, cfg, time]);
  useEffect(
    () => () => {
      geo.dispose();
      mats.forEach((m) => m.dispose());
    },
    [geo, mats],
  );

  const _fwd = useMemo(() => new THREE.Vector3(), []);
  const _to = useMemo(() => new THREE.Vector3(), []);
  const _p = useMemo(() => new THREE.Vector3(), []);
  const _look = useMemo(() => new THREE.Matrix4(), []);
  const _q = useMemo(() => new THREE.Quaternion(), []);
  const _bank = useMemo(() => new THREE.Quaternion(), []);
  const Z = useMemo(() => new THREE.Vector3(0, 0, 1), []);

  const call = (s: GliderState) => {
    s.swoop = SWOOP_S;
    s.cool = SWOOP_COOL_S;
    s.sang = false;
    callFrom(camera, 'song', s.last.x, s.last.y, s.last.z);
  };

  useFrame(({ clock }, delta) => {
    const dt = reducedMotion ? 0 : Math.min(delta, 0.05);
    const t = clock.elapsedTime;
    time.value = reducedMotion ? 5 : t;
    const cam = camera.position;
    _fwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
    states.forEach((s, i) => {
      const g = refs.current[i];
      if (!g) return;
      s.cool -= dt;
      s.swoop = Math.max(0, s.swoop - dt);
      s.k += ((s.swoop > 1.5 ? 1 : 0) - s.k) * damp(0.35, dt);
      s.th += s.w * dt * (1 + s.k * 0.6);
      // its loop eases over to a broad circle low over the viewer during a swoop
      const k = smooth01(s.k);
      const cx = s.cx + (cam.x - s.cx) * k;
      const cz = s.cz + (cam.z - s.cz) * k;
      const r = s.r + (11 - s.r) * k;
      const alt = s.alt + (cam.y + 8 - s.alt) * k;
      _p.set(cx + Math.cos(s.th) * r, alt + Math.sin(t * 0.13 + s.ph) * 1.8, cz + Math.sin(s.th) * r);
      // heading from motion; banked into the turn
      if (!Number.isNaN(s.last.x) && dt > 0) {
        _to.copy(_p).sub(s.last);
        if (_to.lengthSq() > 1e-8) {
          // Matrix4.lookAt points +z from the target to the eye: the eye one step ahead puts the nose (+z) forward
          _look.lookAt(_to.add(_p), _p, THREE.Object3D.DEFAULT_UP);
          _q.setFromRotationMatrix(_look);
          _bank.setFromAxisAngle(Z, Math.sign(s.w) * (0.22 + 0.15 * k));
          _q.multiply(_bank);
          g.quaternion.slerp(_q, damp(1.5, dt));
        }
      }
      s.last.copy(_p);
      g.position.copy(_p);
      if (s.swoop > 0 && !s.sang && s.swoop < SWOOP_S * 0.55) {
        s.sang = true;
        callFrom(camera, 'song', _p.x, _p.y, _p.z);
      }

      // look up at one and hold still: it answers
      _to.copy(_p).sub(cam);
      const dist = _to.length();
      const looking = _to.dot(_fwd) / Math.max(dist, 1e-3) > GAZE_COS;
      s.gaze = looking && s.swoop <= 0 ? s.gaze + dt : 0;
      if (!reducedMotion && s.gaze > GAZE_S && s.cool <= 0) call(s);
    });
  });

  const poke = (e: ThreeEvent<MouseEvent>, i: number) => {
    if (!isPoke(e)) return;
    const s = states[i];
    if (s.swoop <= 0) call(s);
    else callFrom(camera, 'song', s.last.x, s.last.y, s.last.z);
  };

  return (
    <>
      {states.map((_, i) => (
        <mesh
          key={i}
          ref={(el) => (refs.current[i] = el)}
          geometry={geo}
          material={mats[i]}
          scale={cfg.kind === 'manta' ? 1.1 : 1}
          frustumCulled={false}
          onClick={(e) => poke(e, i)}
        />
      ))}
    </>
  );
};

/*
 * ---------- the colossus: a thin basalt giant on the horizon ----------
 * It strides slowly round the far edge of the molten world, lava glowing in
 * its seams and its eye slit. The easter egg: look at it and hold still for a
 * few seconds (or click it) and it stops, turns its head to you, raises an arm
 * and waves with a deep rumble, then walks on.
 */
const COLOSSUS_R = 62;
/** Built 10 units tall, scaled to this */
const COLOSSUS_H = 30;
const COLOSSUS_SPEED = 1.1;
const COLOSSUS_GAZE_S = 2.5;
const COLOSSUS_WAVE_S = 7;
const COLOSSUS_COOL_S = 35;
const COLOSSUS_GLOW = new THREE.Color('#ff6a1a').multiplyScalar(2.2);
const COLOSSUS_GAZE_COS = Math.cos(0.2);

const Colossus = ({ planet, ground, reducedMotion }: { planet: Planet; ground: HeightFn; reducedMotion?: boolean }) => {
  const camera = useThree((s) => s.camera);
  const root = useRef<THREE.Group>(null);
  const legs = useRef<(THREE.Group | null)[]>([]);
  const shins = useRef<(THREE.Group | null)[]>([]);
  const arms = useRef<(THREE.Group | null)[]>([]);
  const fores = useRef<(THREE.Group | null)[]>([]);
  const head = useRef<THREE.Group>(null);
  const mats = useMemo(
    () => ({
      stone: new THREE.MeshStandardMaterial({ color: '#2a2220', roughness: 0.95, flatShading: true }),
      // the glow shows through the haze, so the giant reads as a silhouette with burning seams
      glow: new THREE.MeshBasicMaterial({ color: COLOSSUS_GLOW.clone(), fog: false }),
    }),
    [],
  );
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);
  const rnd = useMemo(() => mulberry(seedOf(`${planet.id}:colossus`)), [planet.id]);
  const st = useRef({ a: -Math.PI / 2 - 0.55, gaze: 0, wave: 0, cool: 6, k: 0, stride: rnd() * 10 });
  const _fwd = useMemo(() => new THREE.Vector3(), []);
  const _to = useMemo(() => new THREE.Vector3(), []);

  const hail = () => {
    const s = st.current;
    s.wave = COLOSSUS_WAVE_S;
    s.cool = COLOSSUS_COOL_S;
    const g = root.current;
    if (g) callFrom(camera, 'rumble', g.position.x, g.position.y + COLOSSUS_H * 0.8, g.position.z);
  };

  useFrame(({ clock }, delta) => {
    const g = root.current;
    if (!g) return;
    const dt = reducedMotion ? 0 : Math.min(delta, 0.05);
    const t = clock.elapsedTime;
    const s = st.current;
    s.cool -= dt;
    s.wave = Math.max(0, s.wave - dt);
    s.k += ((s.wave > 0.8 ? 1 : 0) - s.k) * damp(1.1, dt);
    const k = smooth01(s.k);
    const walk = 1 - k;
    s.a += (COLOSSUS_SPEED / COLOSSUS_R) * dt * walk;
    s.stride += COLOSSUS_SPEED * dt * walk;
    const x = Math.cos(s.a) * COLOSSUS_R;
    const z = Math.sin(s.a) * COLOSSUS_R;
    // a long slow stride: one full cycle every 7 units walked
    const ph = (s.stride / 7) * Math.PI * 2;
    const yaw = Math.atan2(-Math.sin(s.a), Math.cos(s.a));
    g.position.set(x, ground(x, z) - 0.4 + Math.abs(Math.sin(ph)) * 0.35 * walk, z);
    // turning a little toward the viewer while it waves
    const toYaw = Math.atan2(camera.position.x - x, camera.position.z - z);
    g.rotation.y = yaw + wrapAngle(toYaw - yaw) * 0.35 * k;
    for (let i = 0; i < 2; i += 1) {
      const sgn = i ? -1 : 1;
      const leg = legs.current[i];
      const shin = shins.current[i];
      if (leg) leg.rotation.x = Math.sin(ph) * 0.32 * sgn * walk;
      if (shin) shin.rotation.x = Math.max(0, Math.sin(ph + (i ? Math.PI : 0) + 0.6)) * 0.45 * walk;
      const arm = arms.current[i];
      if (arm) arm.rotation.x = -Math.sin(ph) * 0.18 * sgn * walk;
    }
    // the wave: the right arm swings up and out, the forearm waving overhead
    const armR = arms.current[1];
    const foreR = fores.current[1];
    if (armR) armR.rotation.z = 2.6 * k;
    if (foreR) foreR.rotation.z = (0.35 + Math.sin(t * 2.2) * 0.4) * k;
    const h = head.current;
    if (h) {
      h.rotation.y = THREE.MathUtils.clamp(wrapAngle(toYaw - g.rotation.y), -1, 1) * k;
      h.rotation.x = 0.18 * k;
    }
    mats.glow.color.copy(COLOSSUS_GLOW).multiplyScalar(1 + 0.9 * k + 0.12 * Math.sin(t * 1.3));

    // look at it and hold still: it answers
    _fwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
    _to.set(x, g.position.y + COLOSSUS_H * 0.6, z).sub(camera.position);
    const looking = _to.normalize().dot(_fwd) > COLOSSUS_GAZE_COS;
    s.gaze = looking && s.wave <= 0 ? s.gaze + dt : 0;
    if (!reducedMotion && s.gaze > COLOSSUS_GAZE_S && s.cool <= 0) hail();
  });

  const poke = (e: ThreeEvent<MouseEvent>) => {
    if (!isPoke(e)) return;
    if (st.current.wave <= 0) hail();
  };

  const S = COLOSSUS_H / 10;
  return (
    <group ref={root} scale={S}>
      {/* hips and long thin legs */}
      <mesh material={mats.stone} position={[0, 4.6, 0]}>
        <boxGeometry args={[1.4, 0.6, 0.8]} />
      </mesh>
      {[-1, 1].map((sx, i) => (
        <group key={sx} position={[sx * 0.45, 4.5, 0]} ref={(el) => (legs.current[i] = el)}>
          <mesh material={mats.stone} position={[0, -1.2, 0]}>
            <boxGeometry args={[0.45, 2.4, 0.5]} />
          </mesh>
          <mesh material={mats.glow} position={[sx * 0.05, -1.2, 0.26]}>
            <boxGeometry args={[0.04, 1.6, 0.02]} />
          </mesh>
          <group position={[0, -2.4, 0]} ref={(el) => (shins.current[i] = el)}>
            <mesh material={mats.stone} position={[0, -1.05, 0]}>
              <boxGeometry args={[0.36, 2.1, 0.4]} />
            </mesh>
            <mesh material={mats.stone} position={[0, -2.15, 0.2]}>
              <boxGeometry args={[0.6, 0.25, 1]} />
            </mesh>
          </group>
        </group>
      ))}
      {/* a tall tapered torso with a burning seam down the chest */}
      <mesh material={mats.stone} position={[0, 6.55, 0]} rotation={[0, Math.PI / 4, 0]}>
        <cylinderGeometry args={[0.95, 0.55, 3.4, 4]} />
      </mesh>
      <mesh material={mats.glow} position={[0, 6.6, 0.47]} rotation={[-0.12, 0, 0]}>
        <boxGeometry args={[0.05, 2.6, 0.03]} />
      </mesh>
      {/* arms hanging long, almost to the knees */}
      {[-1, 1].map((sx, i) => (
        <group key={sx} position={[sx * 1.05, 8.1, 0]} ref={(el) => (arms.current[i] = el)}>
          <mesh material={mats.stone} position={[0, -1.3, 0]}>
            <boxGeometry args={[0.3, 2.6, 0.3]} />
          </mesh>
          <group position={[0, -2.6, 0]} ref={(el) => (fores.current[i] = el)}>
            <mesh material={mats.stone} position={[0, -1.2, 0]}>
              <boxGeometry args={[0.26, 2.4, 0.26]} />
            </mesh>
            <mesh material={mats.stone} position={[0, -2.55, 0]}>
              <boxGeometry args={[0.42, 0.5, 0.26]} />
            </mesh>
          </group>
        </group>
      ))}
      {/* a small head with a glowing eye slit */}
      <mesh material={mats.stone} position={[0, 8.45, 0]}>
        <cylinderGeometry args={[0.2, 0.28, 0.5, 6]} />
      </mesh>
      <group position={[0, 8.7, 0]} ref={head}>
        <mesh material={mats.stone} position={[0, 0.4, 0]}>
          <boxGeometry args={[0.7, 0.8, 0.62]} />
        </mesh>
        <mesh material={mats.glow} position={[0, 0.48, 0.32]}>
          <boxGeometry args={[0.46, 0.07, 0.04]} />
        </mesh>
      </group>
      {/* a generous invisible target for the click */}
      <mesh position={[0, 5, 0]} visible={false} onClick={poke}>
        <boxGeometry args={[3, 10, 2]} />
      </mesh>
    </group>
  );
};

/* ---------- jellies: translucent drifters that pulse and rise over the clouds ---------- */

/** Jellies drift over to hover around a viewer inside this range */
const JELLY_NEAR = 15;

const Jellies = ({ planet, count, reducedMotion }: { planet: Planet; count: number; reducedMotion?: boolean }) => {
  const camera = useThree((s) => s.camera);
  const refs = useRef<(THREE.Group | null)[]>([]);
  const bells = useRef<(THREE.Object3D | null)[]>([]);
  const tentacles = useRef<(THREE.Object3D | null)[][]>([]);
  const jellies = useMemo(() => {
    const rnd = mulberry(seedOf(`${planet.id}:jellies`));
    return Array.from({ length: count }, (_, i) => ({
      a: -Math.PI / 2 + (i / count - 0.5) * 3.4 + (rnd() - 0.5) * 0.5,
      r: 17 + rnd() * 16,
      y: 2 + rnd() * 6,
      w: (0.008 + rnd() * 0.01) * (rnd() < 0.5 ? -1 : 1),
      ph: rnd() * 10,
      size: 0.45 + rnd() * 0.45,
      k: 0,
      met: false,
      callIn: 4 + rnd() * 6,
      pulse: 0,
    }));
  }, [planet.id, count]);

  const mats = useMemo(() => {
    const accent = new THREE.Color(planet.accent);
    const bell = new THREE.MeshBasicMaterial({
      color: accent.clone().multiplyScalar(0.7),
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const core = new THREE.MeshBasicMaterial({ color: accent.clone().multiplyScalar(1.3) });
    const tendril = new THREE.MeshBasicMaterial({
      color: accent.clone().multiplyScalar(0.8),
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    return { bell, core, tendril };
  }, [planet.accent]);
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);

  const _base = useMemo(() => new THREE.Vector3(), []);
  const _near = useMemo(() => new THREE.Vector3(), []);
  const boop = (j: (typeof jellies)[number], g: THREE.Object3D) => {
    j.pulse = 1;
    callFrom(camera, 'boop', g.position.x, g.position.y, g.position.z);
  };
  useFrame(({ clock }, delta) => {
    const t = reducedMotion ? 3 : clock.elapsedTime;
    const dt = reducedMotion ? 0 : Math.min(delta, 0.05);
    const cam = camera.position;
    jellies.forEach((j, i) => {
      const g = refs.current[i];
      if (!g) return;
      const a = j.a + t * j.w;
      // a pulse pushes it up, then it sinks slowly
      const beat = Math.sin(t * 1.4 + j.ph);
      _base.set(Math.cos(a) * j.r, j.y + Math.sin(t * 0.25 + j.ph) * 1.2 + beat * 0.12, Math.sin(a) * j.r);
      // curious drifters come over and hover around you, each on its own slow ring
      const near = !reducedMotion && Math.hypot(_base.x - cam.x, _base.z - cam.z) < JELLY_NEAR;
      j.k += ((near ? 1 : 0) - j.k) * damp(0.45, dt);
      const k = smooth01(j.k) * 0.92;
      if (k > 0.001) {
        const va = j.a * 3 + t * 0.16 * (i % 2 ? 1 : -1);
        const vr = 3.1 + (i % 3) * 0.8;
        _near.set(cam.x + Math.cos(va) * vr, cam.y + 0.7 + (i % 2) * 1.1 + beat * 0.15, cam.z + Math.sin(va) * vr);
        _base.lerp(_near, k);
      }
      g.position.copy(_base);
      if (j.k > 0.55 && !j.met) {
        j.met = true;
        boop(j, g);
      } else if (j.k < 0.2) j.met = false;
      j.callIn -= dt;
      if (j.k > 0.8 && j.callIn <= 0) {
        boop(j, g);
        j.callIn = 8 + Math.random() * 10;
      }
      j.pulse = Math.max(0, j.pulse - dt * 1.4);
      const b = bells.current[i];
      const swell = 1 + j.pulse * 0.35;
      if (b) b.scale.set((1 - beat * 0.08) * swell, (1 + beat * 0.12) * swell, (1 - beat * 0.08) * swell);
      tentacles.current[i]?.forEach((tn, k) => {
        if (tn) {
          tn.rotation.x = Math.sin(t * 1.1 + j.ph + k) * 0.18;
          tn.rotation.z = Math.cos(t * 0.9 + j.ph + k * 1.7) * 0.18;
        }
      });
    });
  });

  return (
    <>
      {jellies.map((j, i) => {
        if (!tentacles.current[i]) tentacles.current[i] = [];
        return (
          <group
            key={i}
            ref={(el) => (refs.current[i] = el)}
            scale={j.size}
            onClick={(e) => {
              const g = refs.current[i];
              if (isPoke(e) && g) boop(j, g);
            }}
          >
            <group ref={(el) => (bells.current[i] = el)}>
              <mesh material={mats.bell}>
                <sphereGeometry args={[0.6, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
              </mesh>
              <mesh material={mats.core} position={[0, 0.18, 0]}>
                <sphereGeometry args={[0.14, 12, 8]} />
              </mesh>
            </group>
            {Array.from({ length: 5 }, (_, k) => {
              const a = (k / 5) * Math.PI * 2;
              return (
                <group
                  key={k}
                  position={[Math.cos(a) * 0.32, 0, Math.sin(a) * 0.32]}
                  ref={(el) => (tentacles.current[i][k] = el)}
                >
                  <mesh material={mats.tendril} position={[0, -0.7, 0]} rotation={[Math.PI, 0, 0]}>
                    <coneGeometry args={[0.035, 1.4, 5, 1, true]} />
                  </mesh>
                </group>
              );
            })}
          </group>
        );
      })}
    </>
  );
};

/**
 * Creatures chosen by planet style, fewer on touch devices. They notice the
 * viewer: walkers come over, follow and greet, birds circle a still viewer,
 * jellies drift close; each has its own call (see critterCall).
 */
const Wildlife = ({
  planet,
  ground,
  obstacles,
  isTouch,
  reducedMotion,
}: {
  planet: Planet;
  ground: HeightFn;
  /** Monument footprints (x, z) */
  obstacles: [number, number][];
  isTouch?: boolean;
  reducedMotion?: boolean;
}) => {
  const camera = useThree((s) => s.camera);
  const viewer = useRef<Viewer>({ x: NaN, z: NaN, speed: 0, still: 0 });
  useFrame((_, delta) => {
    const v = viewer.current;
    const dt = Math.min(delta, 0.05);
    const c = camera.position;
    if (Number.isNaN(v.x) || dt <= 0) {
      v.x = c.x;
      v.z = c.z;
      return;
    }
    const sp = Math.hypot(c.x - v.x, c.z - v.z) / dt;
    v.speed += (Math.min(sp, 20) - v.speed) * damp(5, dt);
    v.still = v.speed < 0.3 ? v.still + dt : 0;
    v.x = c.x;
    v.z = c.z;
  });
  const f = FAUNA[planet.style];
  const k = isTouch ? 0.6 : 1;
  const walkR = walkRadiusFor(planet.style);
  const skitter = useMemo(() => (f.skitter ? { ...f.skitter, count: Math.max(4, Math.round(f.skitter.count * k)) } : null), [f, k]);
  const birds = useMemo(
    () => (f.birds ? { ...f.birds, count: Math.max(3, Math.round(f.birds.count * k)) } : null),
    [f, k],
  );
  return (
    <>
      {birds && <Birds planet={planet} cfg={birds} viewer={viewer} reducedMotion={reducedMotion} />}
      {f.walkers.map((h) => (
        <Walkers
          key={`${h.kind}:${h.size ?? 1}`}
          planet={planet}
          kind={h.kind}
          count={Math.max(1, Math.round(h.count * k))}
          size={h.size}
          speedK={h.speed}
          colors={h.colors}
          maxR={walkR}
          ground={ground}
          obstacles={obstacles}
          viewer={viewer}
          reducedMotion={reducedMotion}
        />
      ))}
      {f.skitter && (
        <Skitterers
          planet={planet}
          cfg={skitter!}
          ground={ground}
          obstacles={obstacles}
          viewer={viewer}
          maxR={walkR - 1}
          reducedMotion={reducedMotion}
        />
      )}
      {f.gliders && <Gliders planet={planet} cfg={f.gliders} reducedMotion={reducedMotion} />}
      {f.colossus && <Colossus planet={planet} ground={ground} reducedMotion={reducedMotion} />}
      {f.jellies > 0 && <Jellies planet={planet} count={Math.round(f.jellies * k)} reducedMotion={reducedMotion} />}
    </>
  );
};

export default Wildlife;
