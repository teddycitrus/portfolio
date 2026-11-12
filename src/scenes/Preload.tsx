import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { planets } from '@/data/content';
import { useAppStore } from '@/state/useAppStore';
import { hideBoot } from '@/ui/boot';
import { preloadAssets } from '@/ui/preloadAssets';
import { loadSurface, surfaceScene } from '@/scenes/planet/loadSurface';
import { surfaceMounted } from '@/scenes/planet/surfaceState';
import { rememberLow } from '@/scenes/gpuTier';

/*
 * Everything is made ready under the loader, so the site is whole and smooth
 * the moment it shows:
 *   1. the system is compiled (in parallel where the browser can) and drawn;
 *   2. on a plain visit to the lobby, the planet chunk is fetched and every
 *      planet's surface is mounted out of sight in turn, compiled, drawn a few
 *      frames (shadows, textures, anything built on the first frame) and taken
 *      down again, with the system put back after;
 *   3. fonts and video posters are in;
 * Between 1 and 2 real frames of the system are timed: a device that cannot hold
 * its frame rate steps down to the low tier, and one that cannot hold even that
 * gets the reader instead of the 3D (see gpuTier). The low tier skips step 2, so
 * a weak GPU is not handed every planet's shaders at once.
 * and only then is the loader let go (the warp spools it out, see Warp.tsx).
 * Every shader program compiled on the way is kept for the life of the page,
 * so a landing or a return to orbit never compiles again. Nothing here shows:
 * the loader covers the canvas the whole time, and while a surface is drawn
 * the mode stays 'overworld' (no music, address, camera or HUD change).
 */

/** Any single wait gives up after this long and the load carries on */
const STEP_TIMEOUT_MS = 12000;
/** Frames drawn of each surface once its shaders are in */
const SURFACE_FRAMES = 4;
/** Frames timed to judge the device */
const TIMED_FRAMES = 24;
/** Median frame time (ms) above which the full scene steps down to the low tier (under 25 fps) */
const SLOW_HIGH_MS = 40;
/** Median frame time (ms) above which even the low tier gives way to the reader (under 12 fps) */
const SLOW_LOW_MS = 85;

const within = <T,>(p: Promise<T>, ms = STEP_TIMEOUT_MS) =>
  Promise.race([p.then(() => undefined, () => undefined), new Promise<void>((r) => window.setTimeout(r, ms))]);

/** The loader still covers the canvas (and has not been let go: the reader or a give-up lets it go early) */
const covered = () => {
  const b = document.getElementById('boot');
  return !!b && !b.dataset.done;
};

interface Waiter {
  left: number;
  test?: () => boolean;
  done: () => void;
}

const Preload = () => {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const waiters = useRef<Waiter[]>([]);
  const stamps = useRef<number[] | null>(null);

  // counted before the frame is drawn, so `frames(n)` resolves once n frames have been drawn
  useFrame(() => {
    stamps.current?.push(performance.now());
    const list = waiters.current;
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const w = list[i];
      if (w.test ? w.test() : (w.left -= 1) < 0) {
        list.splice(i, 1);
        w.done();
      }
    }
  });

  useEffect(() => {
    let live = true;
    const frames = (n: number) => within(new Promise<void>((done) => waiters.current.push({ left: n, done })));
    const until = (test: () => boolean) =>
      within(new Promise<void>((done) => waiters.current.push({ left: 0, test, done })));

    // three picks a program by whether it draws to the screen or to a target; the composer draws the
    // scene to a target, so compile against one too or the programs would not be the ones used
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    const kept = new Set<THREE.WebGLProgram>();

    /**
     * Compiles every material in the scene, visible or not, with the scene's lights; resolves when
     * the GPU is done with them. Like three's compileAsync, but a material disposed while waiting
     * (a part rebuilt) is dropped instead of stalling the wait.
     */
    const compile = async () => {
      if (!live) return;
      const prevTarget = gl.getRenderTarget();
      const shown = scene.visible;
      let pending = new Set<THREE.Material>();
      try {
        scene.visible = true;
        gl.setRenderTarget(target);
        pending = gl.compile(scene, camera) as Set<THREE.Material>;
      } catch {
        /* a bad material: the frames that follow compile what they can */
      } finally {
        scene.visible = shown;
        gl.setRenderTarget(prevTarget);
      }
      await within(
        new Promise<void>((done) => {
          const check = () => {
            if (!live) return done();
            for (const m of pending) {
              const program = (gl.properties.get(m) as { currentProgram?: { isReady: () => boolean } } | undefined)?.currentProgram;
              // without the parallel-compile extension a program reports ready straight away
              if (!program || program.isReady()) pending.delete(m);
            }
            if (pending.size === 0) done();
            else window.setTimeout(check, 16);
          };
          check();
        }),
      );
    };

    /** Holds on to every program made so far: unmounting a surface would otherwise delete its shaders. */
    const keep = () => {
      for (const p of gl.info.programs ?? []) {
        if (kept.has(p)) continue;
        kept.add(p);
        p.usedTimes += 1;
      }
    };

    /**
     * Draws nothing while new parts mount and compile in the background, so no frame
     * stalls compiling on the spot; then draws them for a few frames.
     */
    const hide = () => {
      if (covered()) scene.visible = false;
    };
    const settle = async (n: number) => {
      if (!live) return;
      hide();
      await frames(1);
      await compile();
      scene.visible = true;
      await frames(n);
      // anything made on those frames (lazily built parts, shadow casters)
      await compile();
      keep();
    };

    // marks for timing the load in the browser's performance panel
    const mark = (name: string) => performance.mark?.(`preload:${name}`);

    /** Median time between drawn frames over a short run, or null if too few were drawn to tell */
    const timeFrames = async () => {
      stamps.current = [];
      await frames(TIMED_FRAMES);
      const t = stamps.current;
      stamps.current = null;
      const gaps = t.slice(1).map((v, i) => v - t[i]).sort((a, b) => a - b);
      return gaps.length >= 8 ? gaps[Math.floor(gaps.length / 2)] : null;
    };

    /** Steps the tier down while the frame rate is too low; false once the 3D is given up */
    const judge = async () => {
      // the first frames after a compile are never typical
      await frames(4);
      const ms = await timeFrames();
      mark(`frame-${ms?.toFixed(1)}`);
      if (ms === null || !live || !covered()) return true;
      const { quality, setQuality } = useAppStore.getState();
      if (quality === 'high' && ms > SLOW_HIGH_MS) {
        setQuality('low');
        rememberLow();
        // the tier change rebuilds the composer and drops the shadow map: compile and time again
        await settle(3);
        return judge();
      }
      if (quality === 'low' && ms > SLOW_LOW_MS) {
        setQuality('none');
        return false;
      }
      return true;
    };

    const run = async () => {
      mark('start');
      const assets = preloadAssets();
      await settle(3);
      if (!live) return;
      mark('system');
      if (!(await judge()) || !live) return;

      const s = useAppStore.getState();
      if (s.warming && s.quality === 'low') s.endWarm();
      else if (s.warming && covered() && !s.noWebGL) {
        try {
          await within(loadSurface(), STEP_TIMEOUT_MS * 2);
          for (const p of surfaceScene() ? planets : []) {
            if (!live || !covered() || !useAppStore.getState().warming) break;
            hide();
            useAppStore.getState().setWarmPlanet(p.id);
            await until(() => surfaceMounted.id === p.id);
            mark(`${p.id}-mounted`);
            await settle(SURFACE_FRAMES);
            mark(p.id);
          }
        } catch {
          /* the planet chunk would not load: a landing fetches it again */
        }
        if (!live) return;
        // the system back in place, drawn and settled before anyone sees it
        hide();
        useAppStore.getState().setWarmPlanet(null);
        await until(() => surfaceMounted.id === null);
        await settle(3);
        mark('system-again');
        useAppStore.getState().endWarm();
      } else if (s.warming) useAppStore.getState().endWarm();

      await within(assets);
      mark('assets');
      if (!live) return;
      scene.visible = true;
      hideBoot();
    };
    void run();

    return () => {
      live = false;
      scene.visible = true;
      target.dispose();
      for (const w of waiters.current.splice(0)) w.done();
    };
  }, [gl, scene, camera]);

  return null;
};

export default Preload;
