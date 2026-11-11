import { planets } from '@/data/content';

/*
 * Everything the page shows that is not part of the 3D scene: every font face
 * in use and the poster of every project video. Fetched under the loader so
 * nothing swaps in or pops up after it clears. Each part gives up after a
 * while, so a slow image host never holds the loader.
 */

const LATIN = 'AaBbZz09.,';
/** [font shorthand, sample text]: the sample picks which unicode-range files are fetched */
const FONTS: [string, string][] = [
  ['400 16px "Archivo Variable"', LATIN],
  ['400 16px "JetBrains Mono Variable"', LATIN],
  ['600 16px "Cinzel"', LATIN],
  ['400 16px "Noto Sans Runic"', 'ᚠᚢᚦᚱ'],
  ['400 16px "Inter Variable"', LATIN],
  ['400 16px "Commit Mono"', LATIN],
];
const FONT_TIMEOUT_MS = 8000;
const IMAGE_TIMEOUT_MS = 8000;

const within = (p: Promise<unknown>, ms: number) =>
  Promise.race([p.catch(() => undefined), new Promise((r) => window.setTimeout(r, ms))]);

const loadImage = (src: string) =>
  new Promise<void>((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      img.decode().then(resolve, resolve);
    };
    img.onerror = () => resolve();
    img.src = src;
  });

/** The first poster each video embed shows (see VideoEmbed in BeaconContent.tsx). */
const posters = () => {
  const out: string[] = [];
  for (const p of planets)
    for (const b of p.beacons)
      if (b.kind === 'project' && b.content.videoId)
        out.push(b.content.poster ?? `https://i.ytimg.com/vi/${b.content.videoId}/maxresdefault.jpg`);
  return out;
};

let pending: Promise<void> | null = null;

/** Starts loading fonts and posters (once); resolves when all are in or have timed out. */
export const preloadAssets = () =>
  (pending ??= Promise.all([
    ...FONTS.map(([font, text]) => within(document.fonts?.load(font, text) ?? Promise.resolve(), FONT_TIMEOUT_MS)),
    ...posters().map((src) => within(loadImage(src), IMAGE_TIMEOUT_MS)),
  ]).then(() => undefined));
