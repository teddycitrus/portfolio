import { startTransition, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { createPortal, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { Vec3 } from '@/types/content';
import { getOrbitalPosition, planets } from '@/data/content';
import { useAppStore } from '@/state/useAppStore';
import { keepPrograms, precompileSliced } from '@/scenes/precompile';
import { loadSurface, onSurfaceLoaded, scheduleSurfaceLoad, surfaceScene } from './loadSurface';
import { surfaceMounted } from './surfaceState';

/*
 * A planet's surface is compiled before anyone lands on it, without holding up
 * the first load for planets nobody visits. Once the mouse heads for a planet
 * in orbit (over it, or near it for a moment), or a trip to it starts (a
 * click, a key, a tap, a link), its surface is mounted into a scene that is
 * never drawn, compiled in the background (see precompile), and taken down
 * again with its programs kept. The landing then builds the surface once more
 * but compiles nothing. React builds the hidden copy in slices between frames
 * and its programs are set up a few per frame, so the system keeps moving;
 * the same work at the landing froze it for half a second or more.
 */

/** The pointer within this many of a planet's on-screen radii counts as near it */
const NEAR_RADII = 3;
/** ...plus this many pixels, so a far, small planet still has room to aim at */
const NEAR_PX = 48;
/** ...and held there this long, so a sweep across the system compiles nothing */
const DWELL_MS = 150;
/** A surface not in its scene after this long is given up (the landing compiles it instead) */
const MOUNT_WAIT_MS = 5000;

/** Planets already compiled, per tier (shadows and the composer change the programs) */
const compiled = new Set<string>();
const _pos: Vec3 = [0, 0, 0];
const _v = new THREE.Vector3();

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/** Renders the planet surface scene once its chunk is in; nothing before (it would show nothing yet anyway). */
const LazySurface = () => {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const [, loaded] = useReducer((n: number) => n + 1, 0);
  // no shadows on the low tier (see gpuTier): the extra pass draws the whole surface again
  const shadows = useAppStore((s) => s.quality === 'high');
  const mode = useAppStore((s) => s.mode);
  const canStage = mode === 'overworld' || mode === 'transitioning-in';
  const [stage, setStage] = useState<string | null>(null);
  const stageScene = useMemo(() => new THREE.Scene(), []);
  const near = useRef<{ id: string | null; since: number }>({ id: null, since: 0 });
  const mouse = useRef(false);
  /** A stage asked for and not yet rendered (a transition can take a few frames) */
  const asked = useRef(false);

  // set before any material compiles: switching later recompiles them all (only a step down
  // to the low tier does, under the loader)
  useLayoutEffect(() => {
    if (gl.shadowMap.enabled !== shadows || gl.shadowMap.type !== THREE.PCFSoftShadowMap) {
      gl.shadowMap.enabled = shadows;
      gl.shadowMap.type = THREE.PCFSoftShadowMap;
      gl.shadowMap.needsUpdate = true;
    }
  }, [gl, shadows]);

  useEffect(() => {
    if (surfaceScene()) return;
    const off = onSurfaceLoaded(loaded);
    scheduleSurfaceLoad();
    return () => {
      off();
    };
  }, []);

  // the pointer only counts once a mouse has moved: a touch leaves it wherever it tapped
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      mouse.current = e.pointerType === 'mouse' || e.pointerType === 'pen';
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, []);

  useEffect(() => {
    if (!canStage) setStage(null);
  }, [canStage]);

  // picks the planet to compile next
  useFrame(({ pointer, size, clock }) => {
    if (stage || asked.current) return;
    const s = useAppStore.getState();
    if (s.intro || s.warming || s.quality === 'none' || s.readerOpen) return;
    const done = (id: string) => compiled.has(`${s.quality}:${id}`);
    let want: string | null = null;
    if (s.mode === 'transitioning-in') want = s.lockedPlanetId;
    else if (s.mode === 'overworld' && mouse.current) {
      let id = s.hoveredPlanetId;
      if (!id) {
        const cam = camera as THREE.PerspectiveCamera;
        const scale = size.height / 2 / Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
        let best = Infinity;
        for (const p of planets) {
          if (done(p.id)) continue;
          getOrbitalPosition(p, clock.elapsedTime, _pos);
          _v.set(_pos[0], _pos[1], _pos[2]);
          const dist = _v.distanceTo(cam.position);
          _v.project(cam);
          if (_v.z > 1) continue;
          const px = Math.hypot(((_v.x - pointer.x) * size.width) / 2, ((_v.y - pointer.y) * size.height) / 2);
          const reach = (p.radius / Math.max(dist, 1e-3)) * scale * NEAR_RADII + NEAR_PX;
          if (px < reach && px < best) {
            best = px;
            id = p.id;
          }
        }
      }
      const now = performance.now();
      if (id !== near.current.id) near.current = { id, since: now };
      if (id && (id === s.hoveredPlanetId || now - near.current.since >= DWELL_MS)) want = id;
    }
    if (!want || done(want)) return;
    if (!surfaceScene()) {
      void loadSurface().catch(() => {});
      return;
    }
    // built in slices between frames, so the system keeps moving while it mounts
    const id = want;
    startTransition(() => setStage(id));
  });

  // mounts the chosen surface out of sight, compiles it, keeps its programs and takes it down
  useEffect(() => {
    asked.current = false;
    if (!stage || !canStage) return;
    let alive = true;
    const key = `${useAppStore.getState().quality}:${stage}`;
    void (async () => {
      const t0 = performance.now();
      while (alive && surfaceMounted.id !== stage && performance.now() - t0 < MOUNT_WAIT_MS) await nextFrame();
      if (alive && surfaceMounted.id === stage) {
        await precompileSliced(gl, stageScene, camera, () => alive);
        // parts some surfaces build on their first frames
        for (let i = 0; i < 3 && alive; i += 1) await nextFrame();
        if (alive) await precompileSliced(gl, stageScene, camera, () => alive);
        if (alive) keepPrograms(gl);
      }
      if (!alive) return;
      compiled.add(key);
      setStage(null);
    })();
    return () => {
      alive = false;
    };
  }, [stage, canStage, gl, camera, stageScene]);

  const Scene = surfaceScene();
  if (!Scene) return null;
  return (
    <>
      <Scene />
      {/* never drawn: the renderer only draws the main scene. Its pointer events are off too */}
      {stage && canStage && createPortal(<Scene stageId={stage} />, stageScene, { events: { enabled: false } })}
    </>
  );
};

export default LazySurface;
