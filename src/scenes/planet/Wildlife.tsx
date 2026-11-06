import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { Planet, PlanetStyle } from '@/types/content';
import type { HeightFn } from './Terrain';
import { mulberry, seedOf } from './rng';
import { critterCall, type CritterVoice } from '@/audio/drone';
import { dragLook, mouseLook } from '@/state/runtime';

/* ---------- which creatures live where ---------- */

interface Fauna {
  birds: { count: number; color: string; alt: [number, number]; radius: [number, number] } | null;
  walkers: { kind: 'deer' | 'hopper'; count: number } | null;
  jellies: number;
}

const FAUNA: Record<PlanetStyle, Fauna> = {
  // gulls wheeling over the island
  oceanic: { birds: { count: 9, color: '#f2f0ea', alt: [6, 10], radius: [12, 24] }, walkers: null, jellies: 0 },
  // dark songbirds and grazing deer under the canopy
  forested: {
    birds: { count: 8, color: '#1a1714', alt: [6, 10], radius: [14, 26] },
    walkers: { kind: 'deer', count: 4 },
    jellies: 0,
  },
  // alien hoppers on the dunes, a few birds at dusk
  rocky: {
    birds: { count: 5, color: '#241a16', alt: [7, 11], radius: [14, 28] },
    walkers: { kind: 'hopper', count: 6 },
    jellies: 0,
  },
  // glowing drifters over the cloud deck
  'gas-giant': { birds: null, walkers: null, jellies: 7 },
  molten: { birds: null, walkers: null, jellies: 0 },
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
    const visiting = flocks.filter((f) => f.visit);
    if (!reducedMotion && visiting.length === 0 && vs.cool <= 0 && v.still > BIRD_VISIT_AFTER) {
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

/* ---------- walkers: deer and alien hoppers that graze, wander and shy away ---------- */

type Mode = 'wander' | 'curious' | 'shy';

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
}

const WALK_MIN_R = 14;
const WALK_MAX_R = 26;
/** They notice the viewer inside this range and give up beyond LOSE */
const NOTICE = 13;
const LOSE = 24;
/** Following distance and how long before they lose interest */
const FOLLOW = 2.4;
const BORED_S = 60;
const GREET_S = 1.3;
const WORLD_R = 34;

const Walkers = ({
  planet,
  kind,
  count,
  ground,
  obstacles,
  viewer,
  reducedMotion,
}: {
  planet: Planet;
  kind: 'deer' | 'hopper';
  count: number;
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
  const rnd = useMemo(() => mulberry(seedOf(`${planet.id}:walkers`)), [planet.id]);

  const pick = (w: Walker) => {
    // stay in the ring behind the monuments; short hops in angle keep paths clear of them
    const a0 = Math.atan2(w.z, w.x);
    const a = a0 + (rnd() - 0.5) * 1.6;
    const r = WALK_MIN_R + rnd() * (WALK_MAX_R - WALK_MIN_R);
    w.tx = Math.cos(a) * r;
    w.tz = Math.sin(a) * r;
  };

  const walkers = useMemo<Walker[]>(
    () =>
      Array.from({ length: count }, (_, i) => {
        // spread around the far side first, where they are seen from the spawn
        const a = -Math.PI / 2 + (i / count - 0.5) * 2.6 + (rnd() - 0.5) * 0.4;
        const r = WALK_MIN_R + rnd() * (WALK_MAX_R - WALK_MIN_R);
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
        };
        w.tx = w.x;
        w.tz = w.z;
        return w;
      }),
    [count, rnd],
  );

  const mats = useMemo(() => {
    if (kind === 'deer') {
      return {
        body: new THREE.MeshStandardMaterial({ color: '#7a5636', roughness: 0.85, flatShading: true }),
        dark: new THREE.MeshStandardMaterial({ color: '#3b2a1c', roughness: 0.9, flatShading: true }),
        glow: null,
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
  }, [kind, planet.accent]);
  useEffect(() => () => Object.values(mats).forEach((m) => m?.dispose()), [mats]);

  const speak = (w: Walker) => callFrom(camera, kind === 'deer' ? 'mew' : 'squeak', w.x, ground(w.x, w.z) + 0.6, w.z);
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
        if (w.mode === 'wander' && cd < NOTICE && w.cool <= 0) {
          // noticed you: perk up and come over
          w.mode = 'curious';
          w.bond = 0;
          w.callIn = 0.4 + rnd() * 1.2;
        }
        if (w.mode === 'shy') {
          w.shyT -= dt;
          if (w.shyT <= 0) w.mode = 'curious';
        } else if (w.mode === 'curious') {
          w.bond += dt;
          if (cd > LOSE || w.bond > BORED_S) {
            // lost you, or lost interest: back to grazing for a while
            w.mode = 'wander';
            w.cool = cd > LOSE ? 6 : 20 + rnd() * 15;
            w.moving = false;
            w.timer = 0.5 + rnd();
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
        pick(w);
        w.moving = true;
      }
      const dx = w.tx - w.x;
      const dz = w.tz - w.z;
      const d = Math.hypot(dx, dz);
      const hurry = w.mode === 'shy' ? 2.6 : w.mode === 'curious' && d > 5 ? 2.3 : 1;
      const speed = (kind === 'deer' ? 0.9 : 1.1) * hurry;
      if (w.moving && w.greet <= 0) {
        if (d < (w.mode === 'wander' ? 0.15 : 0.4)) {
          w.moving = false;
          if (w.mode === 'wander') w.timer = 3 + rnd() * 6;
        } else {
          const want = Math.atan2(dx, dz);
          w.yaw += wrapAngle(want - w.yaw) * damp(3, dt);
          // move only once roughly facing the target
          const facing = Math.max(0, Math.cos(wrapAngle(want - w.yaw)));
          const step = Math.min(d, speed * dt * facing);
          w.x += Math.sin(w.yaw) * step;
          w.z += Math.cos(w.yaw) * step;
          w.phase += step * (kind === 'deer' ? 5.5 : 4.2);
        }
      } else if (w.mode !== 'wander') {
        // stopped near you: turn to face you
        w.yaw += wrapAngle(Math.atan2(px - w.x, pz - w.z) - w.yaw) * damp(2.5, dt);
      }

      // walk around monuments and each other, stay on the island
      for (const [ox, oz] of obstacles) {
        const ex = w.x - ox;
        const ez = w.z - oz;
        const e = Math.hypot(ex, ez);
        if (e < 1.35 && e > 1e-4) {
          w.x = ox + (ex / e) * 1.35;
          w.z = oz + (ez / e) * 1.35;
        }
      }
      for (let j = 0; j < i; j += 1) {
        const o = walkers[j];
        const ex = w.x - o.x;
        const ez = w.z - o.z;
        const e = Math.hypot(ex, ez);
        if (e < 0.9 && e > 1e-4) {
          const push = (0.9 - e) / 2;
          w.x += (ex / e) * push;
          w.z += (ez / e) * push;
          o.x -= (ex / e) * push;
          o.z -= (ez / e) * push;
        }
      }
      const wr = Math.hypot(w.x, w.z);
      if (wr > WORLD_R) {
        w.x *= WORLD_R / wr;
        w.z *= WORLD_R / wr;
      }
      w.look += ((w.mode !== 'wander' ? 1 : 0) - w.look) * damp(2, dt);
      const lookYaw = Math.max(-0.8, Math.min(0.8, wrapAngle(Math.atan2(px - w.x, pz - w.z) - w.yaw))) * w.look;
      const gp = w.greet > 0 ? 1 - w.greet / GREET_S : 0;
      const gy = ground(w.x, w.z);
      g.position.set(w.x, gy, w.z);
      g.rotation.y = w.yaw;

      if (kind === 'deer') {
        const swing = w.moving ? Math.sin(w.phase) * 0.55 : 0;
        legs.current[i]?.forEach((leg, k) => {
          if (leg) leg.rotation.x = (k === 0 || k === 3 ? 1 : -1) * swing;
        });
        // graze with the head down while idle, look up now and then; head up and watching when curious
        const grazing = w.mode === 'wander' && !w.moving && Math.sin(t * 0.5 + i * 2.3) > -0.3;
        w.head += ((grazing ? 1 : 0) - w.head) * damp(2.5, dt);
        const neck = necks.current[i];
        if (neck) {
          neck.rotation.x =
            -0.35 + w.head * 1.35 + (grazing ? Math.sin(t * 3 + i) * 0.04 : 0) + Math.sin(gp * Math.PI * 4) * 0.3 * (gp > 0 ? 1 : 0);
          neck.rotation.y = lookYaw;
        }
        // a hello is two little prancing hops
        if (gp > 0) g.position.y += Math.abs(Math.sin(gp * Math.PI * 2)) * 0.16;
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
        body.position.y = 0.24 + hop * 0.38;
        // a hello is a big hop with a full spin
        body.rotation.y = gp > 0 ? smooth01(gp) * Math.PI * 2 : 0;
        const squash = w.moving || excited ? 1 - (1 - Math.min(1, hop)) * 0.25 : 1 + Math.sin(t * 2 + i) * 0.03;
        body.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
        const neck = necks.current[i];
        if (neck) {
          neck.rotation.z = Math.sin(t * (w.mode === 'wander' ? 1.3 : 4.5) + i * 1.7) * (w.mode === 'wander' ? 0.25 : 0.35);
          neck.rotation.y = lookYaw;
        }
      }
    });
  });

  const poke = (e: ThreeEvent<MouseEvent>, i: number) => {
    if (!isPoke(e)) return;
    const w = walkers[i];
    if (w.greet > 0) return;
    w.mode = 'curious';
    w.bond = 0;
    w.moving = false;
    greet(w);
  };

  return (
    <>
      {walkers.map((_, i) => {
        if (!legs.current[i]) legs.current[i] = [];
        return kind === 'deer' ? (
          <group key={i} ref={(el) => (refs.current[i] = el)} onClick={(e) => poke(e, i)}>
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
          <group key={i} ref={(el) => (refs.current[i] = el)} scale={1.4} onClick={(e) => poke(e, i)}>
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
  const birds = useMemo(
    () => (f.birds ? { ...f.birds, count: Math.max(3, Math.round(f.birds.count * k)) } : null),
    [f, k],
  );
  return (
    <>
      {birds && <Birds planet={planet} cfg={birds} viewer={viewer} reducedMotion={reducedMotion} />}
      {f.walkers && (
        <Walkers
          planet={planet}
          kind={f.walkers.kind}
          count={Math.max(2, Math.round(f.walkers.count * k))}
          ground={ground}
          obstacles={obstacles}
          viewer={viewer}
          reducedMotion={reducedMotion}
        />
      )}
      {f.jellies > 0 && <Jellies planet={planet} count={Math.round(f.jellies * k)} reducedMotion={reducedMotion} />}
    </>
  );
};

export default Wildlife;
