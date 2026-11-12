import * as THREE from 'three';
import manifest from '@/data/baked.json';

/*
 * The planet maps and the sky cube are the same for every visitor, but drawing
 * them takes Direct3D's shader compiler seconds on a first visit. So they ship
 * as images, made by the dev server (see vite.config.ts): whenever a live bake
 * in development finds no image for its inputs, it reads the result back and
 * saves it. Each image is named by a hash of everything that went into it
 * (shader source, uniforms, size, three's revision); a hash that no longer
 * matches the code falls back to baking live, so a stale image is never shown.
 *
 * WebP has no lossless way to carry data in the alpha channel through a canvas
 * (it is premultiplied, so colour under zero alpha is lost). Each layer is
 * stored opaque instead: its RGB, then its alpha as grey below it, unpacked in
 * a worker into the raw RGBA a render target would have held. Rows stay in
 * the order WebGL reads them, so the data uploads exactly as it was drawn.
 */

export interface BakedEntry {
  hash: string;
  file: string;
  w: number;
  h: number;
  layers: number;
  touch: boolean;
}

const entries = manifest as Record<string, BakedEntry>;
const BASE = `${import.meta.env.BASE_URL}baked/`;
/** WebP quality for colour and sky; normal maps go lossless (1), as lossy blurs their crater rims */
const LOSSY = 0.92;
export const LOSSLESS = 1;
/** The scene waits this long for the images before baking live instead */
const WAIT_MS = 8000;

const data = new Map<string, Uint8Array<ArrayBuffer>>();
let ready: Promise<void> | null = null;
let settled = false;

/** cyrb53: a short, stable hash of the bake inputs */
export const bakeHash = (s: string) => {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
};

const unpack = (entry: BakedEntry) =>
  new Promise<Uint8Array<ArrayBuffer> | null>((resolve) => {
    const worker = new Worker(new URL('./bakedWorker.ts', import.meta.url), { type: 'module' });
    const done = (v: Uint8Array<ArrayBuffer> | null) => {
      worker.terminate();
      resolve(v);
    };
    worker.onmessage = (e: MessageEvent<Uint8Array<ArrayBuffer> | null>) => done(e.data);
    worker.onerror = () => done(null);
    worker.postMessage({ url: new URL(BASE + entry.file, document.baseURI).href, w: entry.w, h: entry.h, layers: entry.layers });
  });

/** Starts fetching and unpacking this device's images (once); resolves when all are in or it gave up. */
export const startBaked = () => {
  if (ready) return ready;
  const touch = window.matchMedia?.('(pointer: coarse)').matches === true;
  const usable = typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined';
  const wanted = usable ? Object.entries(entries).filter(([, e]) => e.touch === touch) : [];
  const all = Promise.all(
    wanted.map(async ([name, e]) => {
      const px = await unpack(e).catch(() => null);
      if (px) data.set(name, px);
    }),
  );
  ready = Promise.race([all, new Promise((r) => window.setTimeout(r, WAIT_MS))]).then(() => {
    settled = true;
  });
  return ready;
};

/** Suspends the calling component until the images are in, so the scene mounts with them. */
export const useBakedReady = () => {
  if (!settled) throw startBaked();
};

/** The shipped pixels for a bake, or null when there are none for exactly these inputs. */
export const takeBaked = (name: string, hash: string): Uint8Array<ArrayBuffer> | null => {
  const e = entries[name];
  const px = data.get(name);
  if (!e || !px || e.hash !== hash) return null;
  data.delete(name);
  return px;
};

/** Whether an image matching these inputs is listed (whether or not it was loaded) */
export const isBaked = (name: string, hash: string) => entries[name]?.hash === hash;

/** Byte offset of one layer within unpacked pixels */
export const layerSlice = (px: Uint8Array<ArrayBuffer>, w: number, h: number, layer: number) =>
  px.subarray(layer * w * h * 4, (layer + 1) * w * h * 4);

/**
 * Development only: saves a live bake for the dev server to write out as an image. The layers are
 * read from the render target (each cube face, or the single 2D texture), packed opaque and encoded.
 */
export const saveBaked = async (
  gl: THREE.WebGLRenderer,
  name: string,
  hash: string,
  target: THREE.WebGLRenderTarget,
  w: number,
  h: number,
  layers: number,
  touch: boolean,
  quality = LOSSY,
) => {
  if (!import.meta.env.DEV || entries[name]?.hash === hash) return;
  const canvas = new OffscreenCanvas(w, h * 2 * layers);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const img = ctx.createImageData(w, h * 2 * layers);
  const out = img.data;
  const px = new Uint8Array(w * h * 4);
  for (let l = 0; l < layers; l += 1) {
    gl.readRenderTargetPixels(target, 0, 0, w, h, px, layers > 1 ? l : undefined);
    const rgb = l * 2 * w * h * 4;
    const alpha = rgb + w * h * 4;
    for (let i = 0; i < w * h; i += 1) {
      const s = i * 4;
      out[rgb + s] = px[s];
      out[rgb + s + 1] = px[s + 1];
      out[rgb + s + 2] = px[s + 2];
      out[rgb + s + 3] = 255;
      out[alpha + s] = px[s + 3];
      out[alpha + s + 1] = px[s + 3];
      out[alpha + s + 2] = px[s + 3];
      out[alpha + s + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/webp', quality });
  const q = new URLSearchParams({ name, hash, w: String(w), h: String(h), layers: String(layers), touch: String(touch) });
  await fetch(`/__baked?${q}`, { method: 'POST', body: blob }).catch(() => undefined);
};
