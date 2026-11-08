/*
 * The loader lives in index.html so it shows before any script runs: the name
 * over a planet's night side, and "Press any key to launch". A key or tap
 * launches: hyperspace fills the screen and runs the whole jump. Once the scene has drawn its first frames the warp
 * (src/scenes/overworld/Warp.tsx) keeps the time: it spools the loader into a
 * white flash and removes it underneath, onto the 3D deck and the system.
 * Without the warp (the reader, a deep link, reduced motion, no WebGL) the
 * loader just fades once the app is up.
 */

import { useAppStore } from '@/state/useAppStore';

interface Nav {
  /** When a key or tap departed (performance.now), 0 until then */
  departedAt: number;
  /** Runs `fn` on the departure (straight away if it has happened) */
  onDepart: (fn: () => void) => void;
}

/** The loader's fade, matching the transition in index.html */
const FADE_MS = 400;
/** The flash clearing after the drop, matching index.html */
const OUT_MS = 520;
/** Once departed, never leave it up longer than this, whatever happens */
const GIVE_UP_MS = 15000;

const el = () => document.getElementById('boot');
const nav = (): Nav | null => (window as unknown as { __nav?: Nav }).__nav ?? null;

/** When the visitor departed (performance.now), or 0 while the ship still waits over Earth */
export const departedAt = () => nav()?.departedAt ?? 1;

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

/** The drive spools: hyperspace surges, the deck shakes and the light goes white. */
export const spoolBoot = () => el()?.classList.add('boot-spool');

/** Dropped out, under the full flash: the painted deck goes and the flash clears, then the loader is removed. */
export const endBoot = () => {
  const b = el();
  if (!b) return;
  b.classList.add('boot-out');
  window.setTimeout(() => b.remove(), OUT_MS + 80);
};

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
    // the ship waits over Earth for the departure; after the gesture's own handlers have run
    const go = () => window.setTimeout(reveal, 0);
    const n = nav();
    if (n) n.onDepart(go);
    else go();
    return;
  }
  if (store.intro) store.endIntro();
  fadeAll();
  reveal();
};

const giveUp = () => window.setTimeout(() => hideBoot(true), GIVE_UP_MS);
// counted from the departure, or from now when there is none to wait for (a deep link, reduced motion)
if (nav() && useAppStore.getState().intro) nav()!.onDepart(giveUp);
else giveUp();
