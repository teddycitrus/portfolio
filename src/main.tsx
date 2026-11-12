/*
 * The entry is kept tiny on purpose: the terminal and hyperspace in index.html
 * must be up and answering keys at once, so nothing of the app is evaluated
 * while the terminal runs. Its files only download in the background
 * (prefetch links added at build time, see vite.config.ts), and the app starts
 * on the launch, under hyperspace. A link to a planet or the reader, or reduced
 * motion, has no launch to wait for, so the app starts straight away.
 */

interface Nav {
  onDepart: (fn: () => void) => void;
}

const start = () => void import('./start');

/** Once the launch has painted (hyperspace running on the compositor), so evaluating the app cannot hold up its first frame. */
const afterPaint = (fn: () => void) => {
  let done = false;
  const once = () => {
    if (done) return;
    done = true;
    fn();
  };
  requestAnimationFrame(() => requestAnimationFrame(once));
  window.setTimeout(once, 120);
};

/** Browsers without prefetch (Safari) get module preloads instead, once the terminal has painted. */
const upgradePrefetch = () => {
  const probe = document.createElement('link');
  if (probe.relList?.supports?.('prefetch')) return;
  for (const l of document.querySelectorAll<HTMLLinkElement>('link[rel="prefetch"][data-app]')) {
    const href = l.getAttribute('href');
    if (!href) continue;
    const n = document.createElement('link');
    if (href.endsWith('.js')) n.rel = 'modulepreload';
    else {
      n.rel = 'preload';
      n.as = href.endsWith('.css') ? 'style' : href.endsWith('.webp') ? 'fetch' : 'font';
      if (n.as === 'font') n.type = 'font/woff2';
    }
    n.crossOrigin = '';
    n.href = href;
    document.head.appendChild(n);
  }
};

const boot = document.getElementById('boot');
const nav = (window as unknown as { __nav?: Nav }).__nav;
const direct = !boot || !nav || boot.classList.contains('boot-direct');

if (direct) start();
else {
  window.setTimeout(upgradePrefetch, 600);
  nav.onDepart(() => afterPaint(start));
}
