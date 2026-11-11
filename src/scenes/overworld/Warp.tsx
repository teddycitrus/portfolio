import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useAppStore } from '@/state/useAppStore';
import { dragLook, flight, warpFx } from '@/state/runtime';
import { departedAt, endBoot, onBootReveal, spoolBoot } from '@/ui/boot';
import { shipSound, warpHum } from '@/audio/drone';
import { responsiveFov } from './TelescopeCamera';

/*
 * The arrival from hyperspace. Hyperspace itself is the loader's (index.html):
 * it shows the moment the visitor departs and runs the whole jump, so nothing
 * that loads later can cut into it. This keeps the time: once the scene is
 * drawing under the loader the jump runs on, the drive spools up (the loader
 * stretches, shakes and goes white, the drop sound plays), and under the full
 * flash the loader is removed. The system renders under the loader all along,
 * so it is compiled and drawn by the time the flash clears. The system is there as the flash clears, the
 * lens snapping back and the deck shuddering, and the HUD fades up. A click,
 * tap or key in hyperspace drops out straight away.
 */

/** Hyperspace runs on this long once everything is loaded and drawing, before the drive spools */
const RUN_MS = 500;
/** A cached visit is up in no time: the whole jump lasts at least this long from the departure */
const MIN_TOTAL_MS = 2600;
/** Asked to drop out: this long for the roar to swell in first */
const SKIP_MS = 450;
/** The drive spooling up, ending in the flash (matches the loader's spool in index.html) */
const SPOOL_MS = 560;
/** The lens settling and the deck's shudder dying away after the drop */
const SETTLE_MS = 1100;
/** The HUD starts fading up this long after the flash, as it clears */
const HUD_AT = 450;
/** The lens lands this much narrower at the drop, then eases out */
const DROP_FOV = -4;
/** The deck's shudder at the drop, same scale as the cockpit's own */
const DROP_SHAKE = 0.007;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const ID = new THREE.Quaternion();

const Warp = () => {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const st = useRef({
    start: -1,
    runEnd: 0,
    phase: 0 as 0 | 1 | 2,
    flashAt: 0,
    hud: false,
    done: false,
    hum: null as ((fade: number) => void) | null,
  });

  useEffect(() => {
    const s = st.current;
    onBootReveal(() => {
      if (!useAppStore.getState().intro) return;
      const now = performance.now();
      s.start = now;
      s.runEnd = Math.max(RUN_MS, MIN_TOTAL_MS - (now - departedAt()));
    });
    // anyone in a hurry drops out now
    const skip = () => {
      if (s.start < 0 || s.phase !== 0) return;
      const ms = performance.now() - s.start;
      if (s.runEnd - ms <= SKIP_MS) return;
      s.runEnd = ms + SKIP_MS;
    };
    window.addEventListener('pointerdown', skip);
    window.addEventListener('keydown', skip);
    return () => {
      window.removeEventListener('pointerdown', skip);
      window.removeEventListener('keydown', skip);
      s.hum?.(0.3);
      s.hum = null;
      warpFx.shake = 0;
      warpFx.lens = 0;
    };
  }, []);

  useFrame(() => {
    const s = st.current;
    // nothing to do without an arrival, or once it has settled
    if (s.done || (s.phase < 2 && !useAppStore.getState().intro)) {
      warpFx.shake = 0;
      warpFx.lens = 0;
      return;
    }
    const base = responsiveFov(size.width / Math.max(1, size.height));
    const ms = s.start < 0 ? 0 : performance.now() - s.start;

    if (s.phase < 2) {
      // the deck faces the system it is arriving at, and stays put
      camera.position.set(0, 0, 0);
      camera.quaternion.copy(ID);
      dragLook.yaw = 0;
      dragLook.pitch = 0;
      // the departing key or tap unlocked audio: the roar runs through hyperspace
      if (!s.hum && departedAt() > 0) s.hum = warpHum();
    }

    let fov = base;
    let shake = 0;
    if (s.phase === 0 && s.start >= 0 && ms >= s.runEnd) {
      s.phase = 1;
      spoolBoot();
      shipSound('dropout', SPOOL_MS / 1000);
      s.hum?.(SPOOL_MS / 1000);
      s.hum = null;
    }
    if (s.phase === 1 && ms - s.runEnd >= SPOOL_MS) {
      // under the full flash: the loader goes and the system is there as it clears
      s.phase = 2;
      s.flashAt = performance.now();
      flight.heat = 0;
      endBoot();
    }
    if (s.phase === 2) {
      // out: the lens snaps narrow and eases back, the deck shudders and settles
      const since = performance.now() - s.flashAt;
      const k = clamp01(since / SETTLE_MS);
      fov = base + DROP_FOV * (1 - easeOut(k));
      shake = DROP_SHAKE * Math.pow(1 - k, 2);
      if (!s.hud && since >= HUD_AT) {
        s.hud = true;
        flight.speed = 0;
        useAppStore.getState().endIntro();
      }
      if (k >= 1) {
        s.done = true;
        shake = 0;
        fov = base;
      }
    }
    warpFx.shake = shake;
    warpFx.lens = fov - base;
    if (Math.abs(camera.fov - fov) > 1e-3) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }, 0.4);

  return null;
};

export default Warp;
