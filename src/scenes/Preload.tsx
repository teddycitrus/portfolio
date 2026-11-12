import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useAppStore } from '@/state/useAppStore';
import { hideBoot } from '@/ui/boot';
import { preloadAssets } from '@/ui/preloadAssets';
import { rememberLow } from '@/scenes/gpuTier';
import { keepPrograms, precompile } from '@/scenes/precompile';

/*
 * The system is made ready under the loader, so it is whole and smooth the
 * moment it shows:
 *   1. it is compiled (in parallel where the browser can) and drawn;
 *   2. real frames of it are timed: a device that cannot hold its frame rate
 *      steps down to the low tier, and one that cannot hold even that gets the
 *      reader instead of the 3D (see gpuTier);
 *   3. fonts and video posters are in;
 * and only then is the loader let go (the warp spools it out, see Warp.tsx).
 * Every program compiled on the way is kept for the life of the page, so a
 * return to orbit never compiles again. Planet surfaces are not compiled here:
 * each is compiled out of sight once the pointer heads for its planet or a
 * trip to it starts (see LazySurface), so the loader never waits on a planet
 * nobody visits.
 */

/** Any single wait gives up after this long and the load carries on */
const STEP_TIMEOUT_MS = 12000;
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
      if ((w.left -= 1) < 0) {
        list.splice(i, 1);
        w.done();
      }
    }
  });

  useEffect(() => {
    let live = true;
    const frames = (n: number) => within(new Promise<void>((done) => waiters.current.push({ left: n, done })));

    const compile = () => precompile(gl, scene, camera, () => live);
    const keep = () => keepPrograms(gl);

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

      useAppStore.getState().endWarm();

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
      for (const w of waiters.current.splice(0)) w.done();
    };
  }, [gl, scene, camera]);

  return null;
};

export default Preload;
