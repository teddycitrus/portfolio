/*
 * The loader lives in index.html so it shows before any script runs: the view
 * from the deck in hyperspace (a 2D canvas) with the ship's nav display
 * counting toward the destination. Once the scene has drawn its first frames
 * the canvas fades out over the real deck, which is in hyperspace too, and
 * the warp (src/scenes/overworld/Warp.tsx) takes over the display and drops
 * out into the system. Without the warp (the reader, a deep link, reduced
 * motion, no WebGL) the display reaches 100% and the whole loader fades.
 */

import { useAppStore } from '@/state/useAppStore';

interface Nav {
  floor: (p: number) => void;
  to: (p: number, ms: number) => void;
  status: (text: string) => void;
  stopDrawing: () => void;
}

/** Arrival line on the display without the warp, held before the fade */
const ARRIVE_MS = 700;
/** The loader's fade, matching the transition in index.html */
const FADE_MS = 500;
/** Never leave it up longer than this, whatever happens */
const GIVE_UP_MS = 15000;

const el = () => document.getElementById('boot');
const nav = (): Nav | null => (window as unknown as { __nav?: Nav }).__nav ?? null;

/** The nav display, for the warp to drive. Silently does nothing once the loader is gone. */
export const navDisplay = {
  to: (p: number, ms: number) => nav()?.to(p, ms),
  status: (text: string) => nav()?.status(text),
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
  window.setTimeout(() => b.remove(), 700);
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
  nav()?.to(1, 350);
  window.setTimeout(() => {
    b.classList.add('boot-arrived');
    nav()?.status('Arrived');
  }, 350);
  window.setTimeout(() => {
    fadeAll();
    reveal();
  }, 350 + ARRIVE_MS);
};

window.setTimeout(() => hideBoot(true), GIVE_UP_MS);
