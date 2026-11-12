/// <reference lib="webworker" />
/*
 * Unpacks one baked image (see bakedMaps.ts): each layer's RGB, then its alpha
 * as grey below it, back into raw RGBA. Off the main thread so decoding never
 * holds up a frame.
 */

interface Job {
  url: string;
  w: number;
  h: number;
  layers: number;
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = async (e: MessageEvent<Job>) => {
  const { url, w, h, layers } = e.data;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const height = h * 2 * layers;
    if (bmp.width !== w || bmp.height !== height) throw new Error('size');
    const canvas = new OffscreenCanvas(w, height);
    const c = canvas.getContext('2d', { willReadFrequently: true });
    if (!c) throw new Error('2d');
    c.drawImage(bmp, 0, 0);
    bmp.close();
    const src = c.getImageData(0, 0, w, height).data;
    const n = w * h;
    const out = new Uint8Array(n * 4 * layers);
    for (let l = 0; l < layers; l += 1) {
      const rgb = l * 2 * n * 4;
      const alpha = rgb + n * 4;
      const o = l * n * 4;
      for (let i = 0; i < n * 4; i += 4) {
        out[o + i] = src[rgb + i];
        out[o + i + 1] = src[rgb + i + 1];
        out[o + i + 2] = src[rgb + i + 2];
        out[o + i + 3] = src[alpha + i];
      }
    }
    ctx.postMessage(out, [out.buffer]);
  } catch {
    ctx.postMessage(null);
  }
};
