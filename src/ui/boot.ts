/*
 * The "Mannully Space Co." loader lives in index.html so it shows before any
 * script runs. It goes once the scene has drawn its first frames, held for a
 * moment at least so the animation reads instead of flashing past.
 */

/** Shortest time the loader stays up, from navigation start */
const MIN_MS = 1400;
/** Never leave it up longer than this, whatever happens */
const GIVE_UP_MS = 15000;

export const hideBoot = () => {
  const el = document.getElementById('boot');
  if (!el || el.dataset.done) return;
  el.dataset.done = '1';
  window.setTimeout(
    () => {
      el.classList.add('boot-done');
      window.setTimeout(() => el.remove(), 600);
    },
    Math.max(0, MIN_MS - performance.now()),
  );
};

window.setTimeout(hideBoot, GIVE_UP_MS);
