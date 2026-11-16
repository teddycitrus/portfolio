import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { Planet } from '@/types/content';
import { mulberry, seedOf } from './rng';
import { callFrom, cameraYaw, damp, isPoke, reading, smooth01, wrapAngle, type EcoRef } from './faunaCommon';
import { jellyBell, jellyContract, jellyTentacles } from './faunaGeo';

/*
 * ---------- jellies: translucent drifters that pulse and rise over the clouds ----------
 * The bell squeezes quickly and lets go slowly, the margin arriving a beat
 * after the crown; each squeeze is a small push upward followed by a long
 * sink. Tentacles take the wave later still. A sky whale's song brings them
 * all into step. Near a viewer they drift over, keeping to the edges of view.
 */

/** Jellies drift over to hover around a viewer inside this range */
const JELLY_NEAR = 15;
const CYCLE_S = 2.6;

/** GLSL for the contraction, matching jellyContract */
const CONTRACT_GLSL = `
float jellyC(float c) {
  float f = fract(c);
  if (f < 0.28) { float u = f / 0.28; return u * u * (3.0 - 2.0 * u); }
  float u = (f - 0.28) / 0.72;
  return 1.0 - u * u * (3.0 - 2.0 * u);
}`;

const bellMaterial = (accent: THREE.Color, time: { value: number }) => {
  const m = new THREE.MeshBasicMaterial({
    color: accent.clone().multiplyScalar(0.72),
    vertexColors: true,
    transparent: true,
    opacity: 0.5,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec3 aRig;
        attribute vec3 aJelly;
        uniform float uTime;
        varying float vFresnel;
        ${CONTRACT_GLSL}`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        // aJelly: cycle position, swell from a poke, cycle rate
        float margin = aRig.x;
        float squeeze = jellyC(aJelly.x + uTime * aJelly.z - margin * 0.07);
        float close = squeeze * (0.1 + 0.34 * margin) + aJelly.y * 0.12 * margin;
        transformed.xz *= 1.0 - close;
        transformed.y += squeeze * (0.1 - margin * 0.2);`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec3 jn = normalize(mat3(modelViewMatrix) * mat3(instanceMatrix) * normal);
        vec3 jv = -mvPosition.xyz;
        float jd = max(length(jv), 1e-4);
        float jf = 1.0 - clamp(abs(dot(jn, jv / jd)), 0.0, 1.0);
        vFresnel = 0.28 + 0.72 * jf * jf;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vFresnel;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vFresnel;');
  };
  m.customProgramCacheKey = () => 'fauna-jelly-bell';
  return m;
};

const tendrilMaterial = (accent: THREE.Color, time: { value: number }) => {
  const m = new THREE.MeshBasicMaterial({
    color: accent.clone().multiplyScalar(0.72),
    vertexColors: true,
    transparent: true,
    opacity: 0.42,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec3 aRig;
        attribute vec3 aJelly;
        uniform float uTime;
        ${CONTRACT_GLSL}`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        // the wave reaches the tips late; they stream and then draw in
        float along = aRig.x;
        float seed = aRig.y;
        float beat = jellyC(aJelly.x + uTime * aJelly.z - along * 0.45);
        float drawn = beat * along * (aRig.z > 0.5 ? 0.3 : 0.42);
        transformed.xz *= 1.0 - drawn;
        transformed.x += sin(uTime * 0.9 + seed + along * 5.0) * along * along * 0.28;
        transformed.z += cos(uTime * 0.7 + seed * 1.3 + along * 4.0) * along * along * 0.28;
        transformed.y += beat * along * 0.14;`,
      );
  };
  m.customProgramCacheKey = () => 'fauna-jelly-tendril';
  return m;
};

interface Jelly {
  a: number;
  r: number;
  y: number;
  w: number;
  ph: number;
  phase: number;
  rate: number;
  size: number;
  k: number;
  met: boolean;
  callIn: number;
  pulse: number;
  /** Drift bearing round the viewer, eased so a turning head doesn't drag them */
  gaze: number;
  lift: number;
}

const Jellies = ({ planet, count, eco, reducedMotion }: { planet: Planet; count: number; eco: EcoRef; reducedMotion?: boolean }) => {
  const camera = useThree((s) => s.camera);
  const bells = useRef<THREE.InstancedMesh>(null);
  const tendrils = useRef<THREE.InstancedMesh>(null);
  const time = useMemo(() => ({ value: 0 }), []);
  const jellies = useMemo<Jelly[]>(() => {
    const rnd = mulberry(seedOf(`${planet.id}:jellies`));
    return Array.from({ length: count }, (_, i) => ({
      a: -Math.PI / 2 + (i / count - 0.5) * 3.4 + (rnd() - 0.5) * 0.5,
      r: 17 + rnd() * 16,
      y: 2 + rnd() * 6,
      w: (0.008 + rnd() * 0.01) * (rnd() < 0.5 ? -1 : 1),
      ph: rnd() * 10,
      phase: rnd(),
      rate: (1 + (rnd() - 0.5) * 0.25) / CYCLE_S,
      size: 0.45 + rnd() * 0.45,
      k: 0,
      met: false,
      callIn: 4 + rnd() * 6,
      pulse: 0,
      gaze: 0,
      lift: 0,
    }));
  }, [planet.id, count]);

  const geos = useMemo(() => {
    const make = (g: THREE.BufferGeometry) => {
      const attr = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
      attr.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('aJelly', attr);
      return g;
    };
    return { bell: make(jellyBell()), tend: make(jellyTentacles()) };
  }, [count]);
  const mats = useMemo(() => {
    const accent = new THREE.Color(planet.accent);
    return { bell: bellMaterial(accent, time), tend: tendrilMaterial(accent, time) };
  }, [planet.accent, time]);
  useEffect(
    () => () => {
      geos.bell.dispose();
      geos.tend.dispose();
      mats.bell.dispose();
      mats.tend.dispose();
    },
    [geos, mats],
  );

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const _base = useMemo(() => new THREE.Vector3(), []);
  const _near = useMemo(() => new THREE.Vector3(), []);
  const boop = (j: Jelly, x: number, y: number, z: number) => {
    j.pulse = 1;
    callFrom(camera, 'boop', x, y, z);
  };

  useFrame(({ clock }, delta) => {
    const bm = bells.current;
    const tm = tendrils.current;
    if (!bm || !tm) return;
    const t = reducedMotion ? 3 : clock.elapsedTime;
    const dt = reducedMotion ? 0 : Math.min(delta, 0.05);
    time.value = t;
    const cam = camera.position;
    const yaw = cameraYaw(camera);
    const read = reading();
    const song = eco.current.song;
    const aB = geos.bell.getAttribute('aJelly') as THREE.InstancedBufferAttribute;
    const aT = geos.tend.getAttribute('aJelly') as THREE.InstancedBufferAttribute;
    for (let i = 0; i < jellies.length; i += 1) {
      const j = jellies[i];
      const a = j.a + t * j.w;
      // the song pulls every bell onto one beat
      if (song > 0.05) {
        const target = -t / CYCLE_S;
        j.phase += wrapAngle((target - j.phase) * Math.PI * 2) * 0.5 / Math.PI * damp(1.2, dt) * Math.min(1, song * 1.6);
        j.rate += (1 / CYCLE_S - j.rate) * damp(1.2, dt);
      }
      const beat = jellyContract(j.phase + t * j.rate);
      // a squeeze pushes up over the first part of the cycle, then the bell sinks; integrating keeps it in step
      j.lift += ((beat - 0.42) * 0.42 - j.lift) * damp(5, dt);
      _base.set(Math.cos(a) * j.r, j.y + Math.sin(t * 0.25 + j.ph) * 1.1 + j.lift * 0.9, Math.sin(a) * j.r);
      // curious drifters come over and hover around you, each on its own slow ring, off to the sides
      const near = !reducedMotion && !read && Math.hypot(_base.x - cam.x, _base.z - cam.z) < JELLY_NEAR;
      j.k += ((near ? 1 : 0) - j.k) * damp(0.45, dt);
      const k = smooth01(j.k) * 0.92;
      if (k > 0.001) {
        j.gaze += wrapAngle(yaw - j.gaze) * damp(0.6, dt);
        // bands left and right of where the viewer looks, never across the middle
        const side = i % 2 ? 1 : -1;
        const va = j.gaze + side * (1.15 + (i % 3) * 0.32 + Math.sin(t * 0.13 + j.ph) * 0.25);
        const vr = 3.4 + (i % 3) * 0.8;
        _near.set(cam.x + Math.sin(va) * vr, cam.y + 0.9 + (i % 2) * 1.1 + j.lift * 0.5, cam.z + Math.cos(va) * vr);
        _base.lerp(_near, k);
      } else {
        j.gaze = yaw;
      }
      if (j.k > 0.55 && !j.met) {
        j.met = true;
        boop(j, _base.x, _base.y, _base.z);
      } else if (j.k < 0.2) j.met = false;
      j.callIn -= dt;
      if (j.k > 0.8 && j.callIn <= 0) {
        boop(j, _base.x, _base.y, _base.z);
        j.callIn = 8 + Math.random() * 10;
      }
      j.pulse = Math.max(0, j.pulse - dt * 1.4);
      dummy.position.copy(_base);
      dummy.rotation.set(Math.sin(t * 0.3 + j.ph) * 0.1, 0, Math.cos(t * 0.24 + j.ph) * 0.1);
      dummy.scale.setScalar(j.size * (1 + j.pulse * 0.2));
      dummy.updateMatrix();
      bm.setMatrixAt(i, dummy.matrix);
      tm.setMatrixAt(i, dummy.matrix);
      aB.setXYZ(i, j.phase, j.pulse, j.rate);
      aT.setXYZ(i, j.phase, j.pulse, j.rate);
    }
    bm.instanceMatrix.needsUpdate = true;
    tm.instanceMatrix.needsUpdate = true;
    aB.needsUpdate = true;
    aT.needsUpdate = true;
  });

  const poke = (e: ThreeEvent<MouseEvent>) => {
    if (!isPoke(e) || e.instanceId === undefined) return;
    const j = jellies[e.instanceId];
    if (j) boop(j, e.point.x, e.point.y, e.point.z);
  };

  return (
    <>
      <instancedMesh ref={bells} args={[geos.bell, mats.bell, count]} frustumCulled={false} onClick={poke} name="fauna-jelly" />
      <instancedMesh ref={tendrils} args={[geos.tend, mats.tend, count]} frustumCulled={false} />
    </>
  );
};

export default Jellies;
