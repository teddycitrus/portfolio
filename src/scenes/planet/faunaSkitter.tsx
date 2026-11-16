import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { Planet } from '@/types/content';
import type { HeightFn } from './Terrain';
import { mulberry, seedOf } from './rng';
import { callFrom, CLEAR_R, clearOf, damp, isPoke, nearObstacle, reading, wrapAngle, type EcoRef, type ViewerRef } from './faunaCommon';
import { skitterMesh, type SkitterKind } from './faunaGeo';

/*
 * ---------- skitterers: small quick things on the ground ----------
 * Lizards dart then freeze and do push-ups, crabs sidle with their claws up,
 * ember salamanders saunter in S-curves and stay near the warm tortoises.
 * They bolt when the viewer comes at them and go still when a bird drops low.
 * The easter egg: stand still near them for a few seconds and they creep up
 * and run circles round your feet, clicking; move and they scatter. A click on
 * one makes it jump and spin, and the others near it scatter.
 */

export interface SkitterCfg {
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
  /** 0..1 eased: how much of a stride is showing */
  gait: number;
  /** Seconds left held still by something overhead */
  freeze: number;
  /** Push-up clock (lizards) or claw gesture clock (crabs); <= 0 when not displaying */
  display: number;
  displayIn: number;
  raised: number;
}

/** Standing still this long near them brings them round */
const GATHER_AFTER = 3.5;
const GATHER_NEAR = 8;
const BOLT_NEAR = 3.5;
const JUMP_S = 0.7;
const DISPLAY_S = 1.5;

const skitterMaterial = (kind: SkitterKind, cfg: SkitterCfg, time: { value: number }) => {
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.7, flatShading: true, side: THREE.DoubleSide });
  const glow = new THREE.Color(cfg.glow ?? '#000000');
  const crab = kind === 'crab';
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uGlow = { value: glow };
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec3 aRig;
        attribute float aGlow;
        attribute vec4 aState;
        uniform float uTime;
        varying float vGlow;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        // aState: stride phase, gait 0..1, raise (push-up or claws), glow
        vGlow = aGlow * aState.w;
        float phase = aState.x;
        float gait = aState.y;
        float raise = aState.z;
        float limb = aRig.y;
        float spine = aRig.z;
        if (spine > 1.5) {
          // a claw: lifted about the shoulder
          transformed.y += raise * 0.09 * (1.0 + sin(uTime * 2.0 + aRig.x));
          transformed.z += raise * 0.02;
        } else {
          float swing = sin(phase + aRig.x);
          float lift = max(0.0, cos(phase + aRig.x));
          ${
            crab
              ? `// legs step sideways, alternate ones together
          transformed.x += swing * gait * limb * 0.06;
          transformed.y += lift * gait * limb * 0.05;`
              : `// the spine snakes, more toward the tail; legs swing with their diagonal
          float bend = sin(phase * 0.5 - spine * 2.6) * gait;
          float bendK = 0.012 + 0.1 * max(spine, 0.0) * max(spine, 0.0);
          transformed.x += bend * (limb > 0.0 ? 0.012 : bendK);
          transformed.z += swing * gait * limb * 0.06;
          transformed.y += lift * gait * limb * 0.05;
          // a push-up raises the chest on straightened forelegs; the feet stay planted
          transformed.y += raise * (1.0 - limb) * smoothstep(0.25, -0.7, spine) * 0.06;`
          }
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow;\nuniform vec3 uGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uGlow * vGlow;');
  };
  m.customProgramCacheKey = () => `fauna-skitter-${kind}`;
  return m;
};

const Skitterers = ({
  planet,
  cfg,
  ground,
  obstacles,
  viewer,
  eco,
  maxR,
  reducedMotion,
}: {
  planet: Planet;
  cfg: SkitterCfg;
  ground: HeightFn;
  obstacles: [number, number][];
  viewer: ViewerRef;
  eco: EcoRef;
  maxR: number;
  reducedMotion?: boolean;
}) => {
  const camera = useThree((s) => s.camera);
  const mesh = useRef<THREE.InstancedMesh>(null);
  const time = useMemo(() => ({ value: 0 }), []);
  const rnd = useMemo(() => mulberry(seedOf(`${planet.id}:skitter`)), [planet.id]);
  const geo = useMemo(() => {
    const g = skitterMesh(cfg.kind, cfg.color);
    const state = new THREE.InstancedBufferAttribute(new Float32Array(cfg.count * 4), 4);
    state.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aState', state);
    return g;
  }, [cfg]);
  const mat = useMemo(() => skitterMaterial(cfg.kind, cfg, time), [cfg, time]);
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
        let x = 0;
        let z = 0;
        for (let tries = 0; tries < 6; tries += 1) {
          const a = -Math.PI / 2 + ((i % 3) - 1) * 1.1 + (rnd() - 0.5) * 0.5;
          const r = 7 + rnd() * Math.max(2, Math.min(18, maxR - 9));
          x = Math.cos(a) * r;
          z = Math.sin(a) * r;
          if (!nearObstacle(obstacles, x, z, CLEAR_R)) break;
        }
        return {
          x,
          z,
          yaw: rnd() * 6.28,
          tx: x,
          tz: z,
          hx: x,
          hz: z,
          state: 'idle' as const,
          timer: rnd() * 3,
          cool: 0,
          phase: rnd() * 10,
          jump: 0,
          ring: (i / cfg.count) * Math.PI * 2,
          callIn: 1 + rnd() * 3,
          gait: 0,
          freeze: 0,
          display: 0,
          displayIn: 1 + rnd() * 8,
          raised: 0,
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cfg.count, rnd, maxR],
  );

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const _clear = useMemo(() => ({ x: 0, z: 0 }), []);

  useFrame(({ clock }, delta) => {
    const m = mesh.current;
    if (!m) return;
    const dt = reducedMotion ? 0 : Math.min(delta, 0.05);
    const t = reducedMotion ? 0 : clock.elapsedTime;
    time.value = t;
    const v = viewer.current;
    const px = camera.position.x;
    const pz = camera.position.z;
    const ec = eco.current;
    const read = reading();
    const state = geo.getAttribute('aState') as THREE.InstancedBufferAttribute;
    const kind = cfg.kind;
    for (let i = 0; i < crits.length; i += 1) {
      const c = crits[i];
      const dx = c.x - px;
      const dz = c.z - pz;
      const d = Math.hypot(dx, dz);
      c.timer -= dt;
      c.cool -= dt;
      c.jump = Math.max(0, c.jump - dt);
      c.freeze = Math.max(0, c.freeze - dt);
      if (!reducedMotion) {
        if (c.state === 'gather') {
          if (v.speed > 0.6 || read) {
            // you moved, or turned to read: scatter
            c.state = 'flee';
            c.tx = c.x + (dx / (d || 1)) * 5;
            c.tz = c.z + (dz / (d || 1)) * 5;
            c.cool = 8;
          }
        } else if (c.state !== 'flee' && d < BOLT_NEAR && v.speed > 0.5) {
          c.state = 'flee';
          c.tx = c.x + (dx / (d || 1)) * 5;
          c.tz = c.z + (dz / (d || 1)) * 5;
        } else if (c.state !== 'flee' && c.cool <= 0 && !read && v.still > GATHER_AFTER && d < GATHER_NEAR) {
          c.state = 'gather';
        }
        // a shadow overhead or the ground shaking: everything small holds still
        if (c.state !== 'flee' && c.state !== 'gather') {
          if (ec.bird.on && Math.hypot(ec.bird.x - c.x, ec.bird.z - c.z) < 3.5) c.freeze = 1.2;
          if (ec.quake > 0.3 || ec.song > 0.4) c.freeze = Math.max(c.freeze, 0.6);
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
      } else if (c.state === 'idle' && c.timer <= 0 && c.freeze <= 0 && c.display <= 0) {
        c.state = 'dash';
        // embers wander toward whichever tortoise is nearest, for the warmth
        let hx = c.hx;
        let hz = c.hz;
        if (kind === 'ember' && ec.warmN > 0 && rnd() < 0.55) {
          let best = Infinity;
          for (let k = 0; k < ec.warmN; k += 1) {
            const e = Math.hypot(ec.warm[k * 2] - c.x, ec.warm[k * 2 + 1] - c.z);
            if (e < best) {
              best = e;
              hx = ec.warm[k * 2];
              hz = ec.warm[k * 2 + 1];
            }
          }
          c.hx = hx;
          c.hz = hz;
        }
        const a = rnd() * Math.PI * 2;
        const r = (kind === 'ember' ? 1.1 : 1) + rnd() * (kind === 'lizard' ? 4 : 2.8);
        c.tx = hx + Math.cos(a) * r;
        c.tz = hz + Math.sin(a) * r;
      }

      const ex = c.tx - c.x;
      const ez = c.tz - c.z;
      const e = Math.hypot(ex, ez);
      const base = kind === 'lizard' ? 3.6 : kind === 'crab' ? 1.9 : 1.6;
      const speed = c.state === 'flee' ? base * 1.45 : c.state === 'gather' ? 2.2 : base;
      let moving = false;
      if (c.state !== 'idle' && c.jump <= 0 && c.freeze <= 0) {
        if (e < 0.08 && c.state !== 'gather') {
          if (c.state === 'flee') {
            // settle where it ran to
            c.hx = c.x;
            c.hz = c.z;
          }
          c.state = 'idle';
          c.timer = kind === 'lizard' ? 1.2 + rnd() * 4.5 : 0.8 + rnd() * 3.5;
        } else if (e > 0.02) {
          moving = true;
          const want = Math.atan2(ex, ez);
          // crabs carry themselves sideways, body square to the travel; the others turn into it
          const face = kind === 'crab' ? want + (wrapAngle(want - c.yaw) > 0 ? -Math.PI / 2 : Math.PI / 2) : want;
          c.yaw += wrapAngle(face - c.yaw) * damp(kind === 'crab' ? 6 : 14, dt);
          const step = Math.min(e, speed * dt);
          c.x += (ex / e) * step;
          c.z += (ez / e) * step;
          c.phase += step * (kind === 'lizard' ? 38 : 30);
        }
      }
      c.gait += ((moving ? 1 : 0) - c.gait) * damp(moving ? 18 : 12, dt);

      // displays: a lizard's push-ups, a crab lifting its claws to feed
      c.displayIn -= dt;
      if (c.state === 'idle' && c.freeze <= 0 && c.displayIn <= 0 && c.display <= 0 && d > 4) {
        c.display = DISPLAY_S;
        c.displayIn = 4 + rnd() * 10;
        c.timer = Math.max(c.timer, DISPLAY_S + 0.3);
      }
      c.display = Math.max(0, c.display - dt);
      let raise = 0;
      if (kind === 'lizard') {
        const dp = c.display > 0 ? 1 - c.display / DISPLAY_S : 0;
        raise = dp > 0 ? Math.max(0, Math.sin(dp * Math.PI * 3)) * 1 : 0.18;
      } else if (kind === 'crab') {
        const dp = c.display > 0 ? 1 - c.display / DISPLAY_S : 0;
        const song = ec.song > 0.3 && c.state !== 'flee' ? 0.9 : 0;
        raise = Math.max(dp > 0 ? Math.sin(dp * Math.PI) * 0.8 : 0.12 * (1 + Math.sin(t * 1.5 + i)), song);
      } else {
        raise = 0.1 + Math.sin(t * 0.8 + i * 1.3) * 0.05;
      }
      c.raised += (raise - c.raised) * damp(kind === 'lizard' ? 22 : 7, dt);

      clearOf(obstacles, c.x, c.z, CLEAR_R * 0.6, _clear);
      c.x = _clear.x;
      c.z = _clear.z;
      const wr = Math.hypot(c.x, c.z);
      if (wr > maxR) {
        c.x *= maxR / wr;
        c.z *= maxR / wr;
      }

      const jp = c.jump > 0 ? 1 - c.jump / JUMP_S : 0;
      dummy.position.set(c.x, ground(c.x, c.z) + (jp > 0 ? Math.sin(jp * Math.PI) * 0.45 : 0), c.z);
      dummy.rotation.set(0, c.yaw + jp * Math.PI * 2, 0);
      dummy.scale.setScalar(kind === 'crab' ? 1.1 : 1.25);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);

      let glow = 1;
      if (kind === 'ember') glow = 0.8 + 0.35 * Math.sin(t * 1.6 + i * 2.2);
      else if (kind === 'crab') glow = Math.max(0.35, 1 - 0.14 * Math.max(0, 7 - d) * (v.speed > 0.8 ? 1 : 0));
      state.setXYZW(i, c.phase, c.gait, c.raised, glow);
    }
    m.instanceMatrix.needsUpdate = true;
    state.needsUpdate = true;
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

  return <instancedMesh ref={mesh} args={[geo, mat, cfg.count]} castShadow frustumCulled={false} onClick={poke} name={`fauna-${cfg.kind}`} />;
};

export default Skitterers;
