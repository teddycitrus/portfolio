/*
 * The loader lives in index.html so it shows before any script runs: the deck
 * window in hyperspace, painted where the 3D cockpit will put it. Once the
 * scene has drawn its first frames the painted deck fades off the real one,
 * which lines up under it, and the warp (src/scenes/overworld/Warp.tsx) takes
 * over and drops out into the system. Without the warp (the reader, a deep
 * link, reduced motion, no WebGL) the loader just fades.
 */

import { useAppStore } from '@/state/useAppStore';

interface Nav {
  stopDrawing: () => void;
}

/** The loader's fade, matching the transition in index.html */
const FADE_MS = 400;
/** Never leave it up longer than this, whatever happens */
const GIVE_UP_MS = 15000;

const el = () => document.getElementById('boot');
const nav = (): Nav | null => (window as unknown as { __nav?: Nav }).__nav ?? null;

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

/** The warp has dropped out: the loader (by now drawing nothing) goes. */
export const endBoot = () => el()?.remove();

/**
 * The scene is ready (or there is no scene to wait for). With the warp to
 * come, the 2D hyperspace hands over to the deck and the warp takes it from
 * here; otherwise the loader fades.
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
  fadeAll();
  reveal();
};

window.setTimeout(() => hideBoot(true), GIVE_UP_MS);
