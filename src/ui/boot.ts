/*
 * The "Mannully Space Co." loader lives in index.html so it shows before any
 * script runs. Once the scene has drawn its first frames it goes to a ready
 * beat (the bar fills, the astronaut hops, "Ready"), then fades and reveals
 * whatever is waiting under it: the intro shot, or the site itself.
 */

/** Shortest time the loader stays up before the ready beat, from navigation start */
const MIN_MS = 1200;
/** How long the ready beat holds before the fade */
const READY_MS = 850;
/** The fade out, matching the transition in index.html */
const FADE_MS = 500;
/** Never leave it up longer than this, whatever happens */
const GIVE_UP_MS = 15000;

let revealed = false;
const waiting: (() => void)[] = [];

/** Runs `fn` when the loader starts fading out (straight away if it already has). */
export const onBootReveal = (fn: () => void) => {
  if (revealed) fn();
  else waiting.push(fn);
};

const reveal = () => {
  if (revealed) return;
  revealed = true;
  for (const fn of waiting.splice(0)) fn();
};

export const hideBoot = () => {
  const el = document.getElementById('boot');
  if (!el) {
    reveal();
    return;
  }
  if (el.dataset.done) return;
  el.dataset.done = '1';
  window.setTimeout(
    () => {
      el.classList.add('boot-ready');
      window.setTimeout(() => {
        el.classList.add('boot-done');
        reveal();
        window.setTimeout(() => el.remove(), FADE_MS + 100);
      }, READY_MS);
    },
    Math.max(0, MIN_MS - performance.now()),
  );
};

window.setTimeout(hideBoot, GIVE_UP_MS);
