/*
 * The loader lives in index.html so it shows before any script runs: the deck
 * window in hyperspace, painted where the 3D cockpit will put it, with the
 * ship's nav display projected on the glass. Once the scene has drawn its
 * first frames the painted deck fades off the real one, which lines up under
 * it, and the warp (src/scenes/overworld/Warp.tsx) takes over the display and
 * drops out into the system. Without the warp (the reader, a deep link,
 * reduced motion, no WebGL) the display reaches 100% and the loader fades.
 */

import { useAppStore } from '@/state/useAppStore';

interface Nav {
  floor: (p: number) => void;
  to: (p: number, ms: number) => void;
  status: (text: string) => void;
  drift: (x: number, y: number) => void;
  stopDrawing: () => void;
}

/** The display's run to 100% without the warp */
const ARRIVE_MS = 320;
/** The loader's fade, matching the transition in index.html */
const FADE_MS = 400;
/** The display switching off, matching index.html */
const OFF_MS = 220;
/** Never leave it up longer than this, whatever happens */
const GIVE_UP_MS = 15000;

const el = () => document.getElementById('boot');
const nav = (): Nav | null => (window as unknown as { __nav?: Nav }).__nav ?? null;

/** The nav display, for the warp to drive. Silently does nothing once the loader is gone. */
export const navDisplay = {
  to: (p: number, ms: number) => nav()?.to(p, ms),
  status: (text: string) => nav()?.status(text),
  /** Moves the display with the glass, in px from where it was painted */
  drift: (x: number, y: number) => nav()?.drift(x, y),
  spool: () => {
    el()?.classList.remove('boot-ready');
    el()?.classList.add('boot-spool');
  },
  /** Waiting at the destination for a click, so the drop can be heard */
  ready: () => el()?.classList.add('boot-ready'),
  arrived: () => el()?.classList.add('boot-arrived'),
};

// the bundle is here: that much of the way already
nav()?.floor(0.55);

let revealed = false;
const waiting: (() => void)[] = [];

/** Runs `fn` once the scene is drawing under the loader (straight away if it already is). */
export const onBootReveal = (fn: () => void) => {
  if (revealed) fn();
  else waiting.push(fn);
};

const reveal = () => {
  if (revealed) return;
  revealed = true;
  for (const fn of waiting.splice(0)) fn();
};

/** Fades the loader out entirely and removes it. */
const fadeAll = () => {
  const b = el();
  if (!b) return;
  b.classList.add('boot-done');
  window.setTimeout(() => b.remove(), FADE_MS + 100);
};

/** The warp is done with the nav display: it fades, and the loader goes with it. */
export const endBoot = () => {
  const b = el();
  if (!b) return;
  b.classList.add('boot-nav-off');
  window.setTimeout(() => b.remove(), OFF_MS + 80);
};

/**
 * The scene is ready (or there is no scene to wait for). With the warp to
 * come, the 2D hyperspace hands over to the deck and the warp drives the
 * display from here; otherwise the display arrives and the loader fades.
 */
export const hideBoot = (giveUp = false) => {
  const b = el();
  if (!b) {
    reveal();
    return;
  }
  if (b.dataset.done) return;
  b.dataset.done = '1';
  const store = useAppStore.getState();
  if (store.intro && !giveUp) {
    b.classList.add('boot-handoff');
    window.setTimeout(() => nav()?.stopDrawing(), 500);
    reveal();
    return;
  }
  if (store.intro) store.endIntro();
  nav()?.to(1, ARRIVE_MS);
  window.setTimeout(() => {
    fadeAll();
    reveal();
  }, ARRIVE_MS + 60);
};

window.setTimeout(() => hideBoot(true), GIVE_UP_MS);
