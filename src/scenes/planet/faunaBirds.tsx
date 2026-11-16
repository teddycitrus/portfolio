import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { Planet } from '@/types/content';
import type { HeightFn } from './Terrain';
import { mulberry, seedOf } from './rng';
import { callFrom, CLEAR_R, damp, nearObstacle, reading, smooth01, wrapAngle, type EcoRef, type ViewerRef } from './faunaCommon';
import { birdMesh, type BirdStyle } from './faunaGeo';

/*
 * ---------- birds: a loose flock in one instanced mesh ----------
 * Gulls soar with long glides, the small birds bound along, flapping then
 * shutting their wings. Each keeps its own space in the flock; now and then
 * one drops out and perches on open ground, looks about and pecks, until a
 * viewer comes close and it flies, taking its neighbours with it.
 */

export interface BirdCfg {
  count: number;
  color: string;
  tip: string;
  belly: string;
  style: BirdStyle;
  alt: [number, number];
  radius: [number, number];
  /** Share of the flock that may be down at once (more at dusk, when they settle) */
  perch: number;
}

const birdMaterial = (time: { value: number }) => {
  const m = new THREE.MeshBasicMaterial({ color: '#ffffff', vertexColors: true, side: THREE.DoubleSide });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec3 aRig;
        attribute float aGlow;
        attribute vec4 aPose;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        // aPose: stroke (-1..1), spread (0 folded..1 open), head yaw, perch (0..1)
        float span = aRig.x;
        float isWing = step(0.001, abs(aRig.y));
        float open = aPose.y;
        // the arm lifts, the hand follows it, and held out the wings keep a shallow dihedral
        transformed.y += isWing * (aPose.x * 0.34 * span + aPose.x * aPose.x * 0.1 * span * span + 0.05 * span);
        // folding draws the hand in along the body
        transformed.x *= mix(1.0, mix(0.2, 1.0, open), isWing);
        transformed.z += isWing * (1.0 - open) * span * 0.34;
        transformed.y -= isWing * (1.0 - open) * span * 0.03;
        // legs tuck up in flight
        transformed.y = mix(transformed.y, mix(-0.03, transformed.y, aPose.w), aRig.z);
        // the head turns about the base of the skull
        vec2 hd = transformed.xz - vec2(0.0, -0.12);
        float hs = sin(aPose.z * aGlow);
        float hc = cos(aPose.z * aGlow);
        transformed.xz = vec2(hc * hd.x - hs * hd.y, hs * hd.x + hc * hd.y) + vec2(0.0, -0.12);`,
      );
  };
  m.customProgramCacheKey = () => 'fauna-bird';
  return m;
};

/** Seconds of standing still before a couple of birds come down to circle the viewer */
const BIRD_VISIT_AFTER = 3;
const BIRD_VISIT_S = 16;
const PERCH_FEET = 0.16;

interface Bird {
  c: { x: number; z: number; r: number; alt: number; w: number };
  off: number;
  dr: number;
  da: number;
  phase: number;
  scale: number;
  sx: number;
  sz: number;
  fl: number;
  /** visiting the viewer */
  k: number;
  visit: boolean;
  until: number;
  slot: number;
  callIn: number;
  /** perching */
  pk: number;
  landing: boolean;
  down: boolean;
  px: number;
  pz: number;
  py: number;
  perchIn: number;
  perchUntil: number;
  idle: number;
  headYaw: number;
  headTo: number;
  peck: number;
  last: THREE.Vector3;
  yaw: number;
  bank: number;
  pitch: number;
  open: number;
}

const Birds = ({
  planet,
  cfg,
  ground,
  obstacles,
  maxR,
  viewer,
  eco,
  reducedMotion,
}: {
  planet: Planet;
  cfg: BirdCfg;
  ground: HeightFn;
  obstacles: [number, number][];
  maxR: number;
  viewer: ViewerRef;
  eco: EcoRef;
  reducedMotion?: boolean;
}) => {
  const camera = useThree((s) => s.camera);
  const mesh = useRef<THREE.InstancedMesh>(null);
  const time = useMemo(() => ({ value: 0 }), []);
  const rnd = useMemo(() => mulberry(seedOf(`${planet.id}:birds`)), [planet.id]);
  const flock = useMemo<Bird[]>(() => {
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
      scale: (cfg.style === 'soar' ? 1.3 : 1.1) + rnd() * 0.4,
      sx: 0,
      sz: 0,
      fl: rnd() * 6,
      k: 0,
      visit: false,
      until: 0,
      slot: 0,
      callIn: 0,
      pk: 0,
      landing: false,
      down: false,
      px: 0,
      pz: 0,
      py: 0,
      perchIn: 6 + rnd() * 30,
      perchUntil: 0,
      idle: rnd() * 2,
      headYaw: 0,
      headTo: 0,
      peck: 0,
      last: new THREE.Vector3(NaN, 0, 0),
      yaw: 0,
      bank: 0,
      pitch: 0,
      open: 1,
    }));
  }, [cfg, rnd]);
  const visits = useRef({ cool: 4 });
  const geo = useMemo(() => {
    const g = birdMesh(cfg.style, cfg.color, cfg.tip, cfg.belly);
    const pose = new THREE.InstancedBufferAttribute(new Float32Array(cfg.count * 4), 4);
    pose.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aPose', pose);
    return g;
  }, [cfg]);
  const mat = useMemo(() => birdMaterial(time), [time]);
  useEffect(
    () => () => {
      geo.dispose();
      mat.dispose();
    },
    [geo, mat],
  );

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const _p = useMemo(() => new THREE.Vector3(), []);

  /** Lifts a perched bird and any neighbours around it */
  const flush = (b: Bird) => {
    for (let i = 0; i < flock.length; i += 1) {
      const o = flock[i];
      if (o.landing && Math.hypot(o.px - b.px, o.pz - b.pz) < 7) {
        o.landing = false;
        o.down = false;
        o.perchIn = 24 + rnd() * 30;
      }
    }
    callFrom(camera, 'chirp', b.px, b.py + 0.3, b.pz);
  };

  useFrame(({ clock }, delta) => {
    const m = mesh.current;
    if (!m) return;
    const t = reducedMotion ? 4 : clock.elapsedTime;
    const dt = reducedMotion ? 0 : Math.min(delta, 0.05);
    time.value = t;
    const v = viewer.current;
    const cam = camera.position;
    const pose = geo.getAttribute('aPose') as THREE.InstancedBufferAttribute;
    const read = reading();
    let downNow = 0;
    for (let i = 0; i < flock.length; i += 1) if (flock[i].landing) downNow += 1;

    // a still viewer gets company; walking off sends the visitors home
    const vs = visits.current;
    vs.cool -= dt;
    let visiting = false;
    for (let i = 0; i < flock.length; i += 1) visiting = visiting || flock[i].visit;
    if (!reducedMotion && !read && !visiting && vs.cool <= 0 && v.still > BIRD_VISIT_AFTER) {
      let picked = 0;
      for (let i = 0; i < flock.length && picked < 2; i += 1) {
        const b = flock[i];
        if (i % 3 === 2 || b.landing) continue;
        b.visit = true;
        b.until = t + BIRD_VISIT_S + picked * 3;
        b.slot = picked;
        b.callIn = 1.5 + picked;
        picked += 1;
      }
      vs.cool = 14;
    }

    eco.current.bird.on = false;
    for (let i = 0; i < flock.length; i += 1) {
      const b = flock[i];
      if (b.visit && (t > b.until || v.speed > 2.2 || read)) {
        b.visit = false;
        vs.cool = Math.max(vs.cool, 10);
        callFrom(camera, 'chirp', b.last.x, b.last.y, b.last.z);
      }
      b.k += ((b.visit ? 1 : 0) - b.k) * damp(0.7, dt);

      // perching: choose an open spot away from monuments and the viewer
      b.perchIn -= dt;
      if (!reducedMotion && !b.landing && !b.visit && b.perchIn <= 0 && downNow < cfg.count * cfg.perch) {
        for (let tries = 0; tries < 6; tries += 1) {
          const a = rnd() * Math.PI * 2;
          const r = 6 + rnd() * Math.max(2, maxR - 9);
          const x = Math.cos(a) * r;
          const z = Math.sin(a) * r;
          if (nearObstacle(obstacles, x, z, CLEAR_R + 1) || Math.hypot(x - cam.x, z - cam.z) < 9) continue;
          b.px = x;
          b.pz = z;
          b.py = ground(x, z);
          b.landing = true;
          b.perchUntil = t + 22 + rnd() * 40;
          downNow += 1;
          break;
        }
        if (!b.landing) b.perchIn = 6;
      }
      if (b.landing) {
        const cd = Math.hypot(b.px - cam.x, b.pz - cam.z);
        const nervous = cd < 5 || (cd < 9 && v.speed > 1.6);
        if (nervous && b.pk > 0.4) flush(b);
        else if (t > b.perchUntil) {
          b.landing = false;
          b.down = false;
          b.perchIn = 16 + rnd() * 34;
        }
      }
      b.pk += ((b.landing ? 1 : 0) - b.pk) * damp(b.landing ? 0.55 : 0.9, dt);
      if (b.landing && b.pk > 0.985) b.down = true;

      // the flock path, loose and wandering, with personal space
      const a = b.c.w * t + b.off;
      const r = b.c.r + b.dr + Math.sin(t * 0.18 + b.phase * 20) * 1.4;
      const dip = cfg.style === 'bound' ? Math.sin(t * 1.8 + b.phase * 6) * 0.3 : 0;
      for (let j = 0; j < i; j += 1) {
        const o = flock[j];
        if (o.c !== b.c || Number.isNaN(o.last.x) || Number.isNaN(b.last.x)) continue;
        const ex = b.last.x - o.last.x;
        const ez = b.last.z - o.last.z;
        const e = Math.hypot(ex, ez);
        if (e < 2.4 && e > 1e-3) {
          const push = ((2.4 - e) / e) * dt * 1.2;
          b.sx += ex * push;
          b.sz += ez * push;
          o.sx -= ex * push;
          o.sz -= ez * push;
        }
      }
      b.sx *= 1 - damp(0.25, dt);
      b.sz *= 1 - damp(0.25, dt);
      _p.set(
        b.c.x + Math.cos(a) * r + b.sx,
        b.c.alt + b.da + Math.sin(t * 0.4 + i) * 0.6 + dip,
        b.c.z + Math.sin(a) * r + b.sz,
      );

      const k = smooth01(b.k);
      if (k > 0.001) {
        // circle low over the viewer's head, the pair on opposite sides
        const va = t * 0.85 + b.slot * Math.PI;
        const vr = 2.6 + b.slot * 0.8;
        _p.lerp(dummy.position.set(cam.x + Math.cos(va) * vr, cam.y + 1.4 + Math.sin(t * 1.2 + b.slot) * 0.3, cam.z + Math.sin(va) * vr), k);
        b.callIn -= dt;
        if (b.callIn <= 0 && k > 0.6) {
          callFrom(camera, 'chirp', _p.x, _p.y, _p.z);
          b.callIn = 2.5 + Math.random() * 3;
        }
      }

      // gliding down to the spot, arriving feet first
      const pk = smooth01(b.pk);
      if (pk > 0.001) {
        _p.lerp(dummy.position.set(b.px, b.py + PERCH_FEET * b.scale, b.pz), pk);
        if (pk > 0.1 && pk < 0.98) {
          eco.current.bird.on = true;
          eco.current.bird.x = _p.x;
          eco.current.bird.z = _p.z;
        }
      }

      // heading from motion; the model's nose is -z
      let climb = 0;
      if (!Number.isNaN(b.last.x) && dt > 0) {
        const vx = _p.x - b.last.x;
        const vz = _p.z - b.last.z;
        if (!b.down && vx * vx + vz * vz > 1e-8) {
          const want = Math.atan2(-vx, -vz);
          const turn = wrapAngle(want - b.yaw);
          b.yaw += turn * damp(6, dt);
          b.bank += (Math.max(-0.6, Math.min(0.6, -turn * 8)) - b.bank) * damp(3, dt);
        }
        climb = (_p.y - b.last.y) / Math.max(dt, 1e-3);
      } else if (Number.isNaN(b.last.x)) {
        const dir = Math.sign(b.c.w) || 1;
        b.yaw = Math.atan2(Math.sin(a) * dir, -Math.cos(a) * dir);
        b.bank = -0.35 * dir;
      }
      b.last.copy(_p);

      // the wings
      let amp: number;
      let rate: number;
      let open = 1;
      if (b.down) {
        open = 0;
        amp = 0;
        rate = 0;
      } else if (pk > 0.8) {
        // flaring to land: a few hard beats, wings wide
        open = 1;
        amp = 0.8;
        rate = 15;
      } else if (cfg.style === 'soar') {
        // long glides, a few slow beats now and then, more on the climb
        const burst = Math.sin(t * 0.22 + b.phase * 6.28) > 0.55 || climb > 0.6 || k > 0.4;
        open = burst ? 1 : 0.92;
        amp = burst ? 0.75 : 0.07 * Math.sin(t * 1.3 + b.phase * 6);
        rate = 8;
      } else {
        // bounding flight: a flurry, then wings shut and a dip
        const burst = Math.sin(t * 1.8 + b.phase * 6.28) > -0.25 || k > 0.4;
        open = burst ? 1 : 0.42;
        amp = burst ? 0.95 : 0;
        rate = 15;
      }
      b.open += (open - b.open) * damp(9, dt);
      b.fl += dt * rate;

      // perched: a few quick glances round, a peck at the ground, the odd step
      if (b.down) {
        b.idle -= dt;
        if (b.idle <= 0) {
          b.idle = 0.5 + rnd() * 2.2;
          b.headTo = (rnd() - 0.5) * 1.5;
          if (rnd() < 0.35) b.peck = 1;
          if (rnd() < 0.25) b.yaw += (rnd() - 0.5) * 1.4;
        }
      } else {
        b.headTo = 0;
        b.peck = 0;
      }
      b.headYaw += (b.headTo - b.headYaw) * damp(16, dt);
      b.peck = Math.max(0, b.peck - dt * 2.2);
      const pe = b.peck > 0 ? Math.sin(b.peck * Math.PI) : 0;

      b.pitch += (Math.max(-0.5, Math.min(0.5, climb * 0.12)) * (b.down ? 0 : 1) + (pk > 0.8 && !b.down ? 0.55 : 0) - b.pitch) * damp(4, dt);
      dummy.position.copy(_p);
      dummy.rotation.set(0, b.yaw, 0);
      dummy.rotateX(b.down ? pe * 0.6 : b.pitch);
      dummy.rotateZ(b.bank * (1 - pk));
      dummy.scale.setScalar(b.scale * (1 - k * 0.25));
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
      pose.setXYZW(i, Math.sin(b.fl) * amp, b.open, b.headYaw, smooth01((b.pk - 0.7) / 0.3));
    }
    m.instanceMatrix.needsUpdate = true;
    pose.needsUpdate = true;
  });

  return <instancedMesh ref={mesh} args={[geo, mat, cfg.count]} frustumCulled={false} name="fauna-bird" />;
};

export default Birds;
