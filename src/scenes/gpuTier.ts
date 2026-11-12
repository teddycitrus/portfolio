/**
 * How much 3D this device gets, decided once before the canvas exists:
 *   'high'  the full scene
 *   'low'   1x pixels, no multisampling, a lighter bloom, no shadows, and only the system warmed
 *   'none'  no 3D at all: the reader is the site (no WebGL, or WebGL drawn on the CPU)
 * Preload can still step it down after timing real frames under the loader.
 * `?quality=high|low|lite` forces a tier; a step down to 'low' is remembered for the next visit.
 */
export type Quality = 'high' | 'low' | 'none';

const STORE_KEY = 'gpu-quality';

/** Renderers Chrome and others fall back to when the GPU is blocked: WebGL runs on the CPU */
const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic|mesa offscreen/i;
/**
 * Integrated and older mobile GPUs that share memory with the CPU: the full post chain at
 * high pixel density takes about all of their bandwidth. Intel Arc is a real GPU.
 */
const WEAK = /intel(?!.*\barc\b)|\bradeon\(tm\) (?:r[2-7]|vega \d|graphics)\b|mali-[gt]\d{1,2}\b|adreno \(tm\) [3-5]\d\d|powervr|videocore/i;

const read = (k: string) => {
  try {
    return window.localStorage.getItem(k);
  } catch {
    return null;
  }
};

/** Remembers a step down so the next visit starts at it (no composer rebuild under the loader). */
export const rememberLow = () => {
  try {
    window.localStorage.setItem(STORE_KEY, 'low');
  } catch {
    /* private window: the next visit measures again */
  }
};

const forced = (): Quality | null => {
  const v = new URLSearchParams(window.location.search).get('quality');
  if (v === 'high' || v === 'low') return v;
  if (v === 'lite' || v === 'none') return 'none';
  return null;
};

const probe = (): { quality: Quality; renderer: string } => {
  if (typeof window === 'undefined') return { quality: 'none', renderer: '' };
  let renderer = '';
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return { quality: 'none', renderer };
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    renderer = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    const force = forced();
    if (force) return { quality: force, renderer };
    // a context that refuses to start when it would be slow means the GPU is not in use
    const strict = document.createElement('canvas').getContext('webgl2', { failIfMajorPerformanceCaveat: true });
    strict?.getExtension('WEBGL_lose_context')?.loseContext();
    if (!strict || SOFTWARE.test(renderer)) return { quality: 'none', renderer };
  } catch {
    return { quality: 'none', renderer };
  }

  const stored = read(STORE_KEY);
  if (stored === 'low') return { quality: 'low', renderer };

  const nav = navigator as Navigator & { deviceMemory?: number };
  const small = (nav.deviceMemory ?? 8) <= 4 || (nav.hardwareConcurrency ?? 8) <= 4;
  return { quality: WEAK.test(renderer) || small ? 'low' : 'high', renderer };
};

const result = probe();

/** The tier picked at startup (the store holds the live one) */
export const startQuality: Quality = result.quality;
export const gpuRenderer = result.renderer;
