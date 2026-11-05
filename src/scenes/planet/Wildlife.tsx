import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { Planet, PlanetStyle } from '@/types/content';
import type { HeightFn } from './Terrain';
import { mulberry, seedOf } from './rng';

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

const Birds = ({ planet, cfg, reducedMotion }: { planet: Planet; cfg: NonNullable<Fauna['birds']>; reducedMotion?: boolean }) => {
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
    }));
  }, [planet.id, cfg]);
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
  useFrame(({ clock }) => {
    const m = mesh.current;
    if (!m) return;
    const t = reducedMotion ? 4 : clock.elapsedTime;
    time.value = t;
    flocks.forEach((f, i) => {
      const a = f.c.w * t + f.off;
      const r = f.c.r + f.dr;
      dummy.position.set(f.c.x + Math.cos(a) * r, f.c.alt + f.da + Math.sin(t * 0.4 + i) * 0.6, f.c.z + Math.sin(a) * r);
      // heading along the circle; the model's nose is -z
      const dir = Math.sign(f.c.w) || 1;
      const tx = -Math.sin(a) * dir;
      const tz = Math.cos(a) * dir;
      dummy.rotation.set(0, Math.atan2(-tx, -tz), 0);
      dummy.rotateZ(-0.35 * dir);
      dummy.scale.setScalar(f.scale);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  });

  return <instancedMesh ref={mesh} args={[geo, mat, cfg.count]} frustumCulled={false} />;
};

/* ---------- walkers: deer and alien hoppers that graze, wander and shy away ---------- */

interface Walker {
  x: number;
  z: number;
  yaw: number;
  tx: number;
  tz: number;
  moving: boolean;
  timer: number;
  phase: number;
  flee: boolean;
  head: number;
}

const WALK_MIN_R = 14;
const WALK_MAX_R = 26;
const SHY_DISTANCE = 4;

const Walkers = ({
  planet,
  kind,
  count,
  ground,
  reducedMotion,
}: {
  planet: Planet;
  kind: 'deer' | 'hopper';
  count: number;
  ground: HeightFn;
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
          flee: false,
          head: 0,
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

  useFrame(({ clock }, delta) => {
    const dt = reducedMotion ? 0 : Math.min(delta, 0.05);
    const t = clock.elapsedTime;
    walkers.forEach((w, i) => {
      const g = refs.current[i];
      if (!g) return;
      // shy: trot away from the viewer when they come close
      const cdx = w.x - camera.position.x;
      const cdz = w.z - camera.position.z;
      const cd = Math.hypot(cdx, cdz);
      if (!reducedMotion && cd < SHY_DISTANCE && !w.flee) {
        w.flee = true;
        w.moving = true;
        w.tx = w.x + (cdx / (cd || 1)) * 6;
        w.tz = w.z + (cdz / (cd || 1)) * 6;
        const tr = Math.hypot(w.tx, w.tz);
        if (tr > WALK_MAX_R + 4) {
          w.tx *= (WALK_MAX_R + 4) / tr;
          w.tz *= (WALK_MAX_R + 4) / tr;
        }
      }
      w.timer -= dt;
      if (!w.moving && w.timer <= 0) {
        pick(w);
        w.moving = true;
      }
      const dx = w.tx - w.x;
      const dz = w.tz - w.z;
      const d = Math.hypot(dx, dz);
      const speed = (kind === 'deer' ? 0.9 : 1.1) * (w.flee ? 2.4 : 1);
      if (w.moving) {
        if (d < 0.15) {
          w.moving = false;
          w.flee = false;
          w.timer = 3 + rnd() * 6;
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
      }
      const gy = ground(w.x, w.z);
      g.position.set(w.x, gy, w.z);
      g.rotation.y = w.yaw;

      if (kind === 'deer') {
        const swing = w.moving ? Math.sin(w.phase) * 0.55 : 0;
        legs.current[i]?.forEach((leg, k) => {
          if (leg) leg.rotation.x = (k === 0 || k === 3 ? 1 : -1) * swing;
        });
        // graze with the head down while idle, look up now and then
        const grazing = !w.moving && Math.sin(t * 0.5 + i * 2.3) > -0.3;
        w.head += ((grazing ? 1 : 0) - w.head) * damp(2.5, dt);
        const neck = necks.current[i];
        if (neck) neck.rotation.x = -0.35 + w.head * 1.35 + (grazing ? Math.sin(t * 3 + i) * 0.04 : 0);
      } else {
        // hoppers bounce along with a squash on landing
        const hop = w.moving ? Math.abs(Math.sin(w.phase)) : 0;
        const body = g.children[0];
        body.position.y = 0.24 + hop * 0.38;
        const squash = w.moving ? 1 - (1 - hop) * 0.25 : 1 + Math.sin(t * 2 + i) * 0.03;
        body.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
        const neck = necks.current[i];
        if (neck) neck.rotation.z = Math.sin(t * 1.3 + i * 1.7) * 0.25;
      }
    });
  });

  return (
    <>
      {walkers.map((_, i) => {
        if (!legs.current[i]) legs.current[i] = [];
        return kind === 'deer' ? (
          <group key={i} ref={(el) => (refs.current[i] = el)}>
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
          <group key={i} ref={(el) => (refs.current[i] = el)} scale={1.4}>
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

const Jellies = ({ planet, count, reducedMotion }: { planet: Planet; count: number; reducedMotion?: boolean }) => {
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

  useFrame(({ clock }) => {
    const t = reducedMotion ? 3 : clock.elapsedTime;
    jellies.forEach((j, i) => {
      const g = refs.current[i];
      if (!g) return;
      const a = j.a + t * j.w;
      // a pulse pushes it up, then it sinks slowly
      const beat = Math.sin(t * 1.4 + j.ph);
      g.position.set(Math.cos(a) * j.r, j.y + Math.sin(t * 0.25 + j.ph) * 1.2 + beat * 0.12, Math.sin(a) * j.r);
      const b = bells.current[i];
      if (b) b.scale.set(1 - beat * 0.08, 1 + beat * 0.12, 1 - beat * 0.08);
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
          <group key={i} ref={(el) => (refs.current[i] = el)} scale={j.size}>
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

/** Ambient creatures, chosen by planet style. Fewer on touch devices. */
const Wildlife = ({
  planet,
  ground,
  isTouch,
  reducedMotion,
}: {
  planet: Planet;
  ground: HeightFn;
  isTouch?: boolean;
  reducedMotion?: boolean;
}) => {
  const f = FAUNA[planet.style];
  const k = isTouch ? 0.6 : 1;
  const birds = useMemo(
    () => (f.birds ? { ...f.birds, count: Math.max(3, Math.round(f.birds.count * k)) } : null),
    [f, k],
  );
  return (
    <>
      {birds && <Birds planet={planet} cfg={birds} reducedMotion={reducedMotion} />}
      {f.walkers && (
        <Walkers
          planet={planet}
          kind={f.walkers.kind}
          count={Math.max(2, Math.round(f.walkers.count * k))}
          ground={ground}
          reducedMotion={reducedMotion}
        />
      )}
      {f.jellies > 0 && <Jellies planet={planet} count={Math.round(f.jellies * k)} reducedMotion={reducedMotion} />}
    </>
  );
};

export default Wildlife;
