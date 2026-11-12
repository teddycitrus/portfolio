import * as THREE from 'three';

/*
 * Three links a shader program on its first draw, and Chrome on Windows then
 * blocks until Direct3D has compiled it: a freeze of up to seconds on a first
 * visit. Compiling ahead of the draw, through the parallel-compile extension
 * where the browser has it, does that work off the main thread. Kept programs
 * stay in three's cache after whatever used them unmounts, so a planet
 * surface compiled out of sight (see LazySurface) draws without compiling.
 */

const kept = new Set<THREE.WebGLProgram>();
let target: THREE.WebGLRenderTarget | null = null;

type Program = { isReady: () => boolean };

/** Resolves once every material's program is linked, dropping any disposed meanwhile. */
const whenReady = (gl: THREE.WebGLRenderer, pending: Set<THREE.Material>, alive: () => boolean, until: number) =>
  new Promise<void>((done) => {
    const check = () => {
      if (!alive() || performance.now() > until) return done();
      for (const m of pending) {
        const program = (gl.properties.get(m) as { currentProgram?: Program } | undefined)?.currentProgram;
        // without the parallel-compile extension a program reports ready straight away
        if (!program || program.isReady()) pending.delete(m);
      }
      if (pending.size === 0) done();
      else window.setTimeout(check, 16);
    };
    check();
  });

/** Runs `fn` against the render target the composer draws to (three picks programs by target) */
const onTarget = <T,>(gl: THREE.WebGLRenderer, fn: () => T) => {
  target ??= new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  const prev = gl.getRenderTarget();
  try {
    gl.setRenderTarget(target);
    return fn();
  } finally {
    gl.setRenderTarget(prev);
  }
};

/** Holds on to every program made so far: unmounting what used them would otherwise delete them. */
export const keepPrograms = (gl: THREE.WebGLRenderer) => {
  for (const p of gl.info.programs ?? []) {
    if (kept.has(p)) continue;
    kept.add(p);
    p.usedTimes += 1;
  }
};

/**
 * Compiles every material under `root`, visible or not, with its lights and fog, and resolves
 * once the GPU is done with them (or after `timeoutMs`). Like three's compileAsync, but a
 * material disposed while waiting (a part rebuilt) is dropped instead of stalling the wait.
 */
export const precompile = (
  gl: THREE.WebGLRenderer,
  root: THREE.Object3D,
  camera: THREE.Camera,
  alive: () => boolean = () => true,
  timeoutMs = 12000,
) => {
  // the composer draws the scene to a target, so compile against one too or the programs
  // would not be the ones used
  const shown = root.visible;
  let pending = new Set<THREE.Material>();
  try {
    root.visible = true;
    pending = onTarget(gl, () => gl.compile(root, camera) as Set<THREE.Material>);
  } catch {
    /* a bad material: the frames that follow compile what they can */
  } finally {
    root.visible = shown;
  }
  return whenReady(gl, pending, alive, performance.now() + timeoutMs);
};

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/**
 * The same for a scene that is on screen while it compiles: setting up a program (building its
 * source, some tens of kilobytes) costs the main thread too, so objects are handed over a few at
 * a time, at most `budgetMs` of it per frame.
 */
export const precompileSliced = async (
  gl: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  alive: () => boolean = () => true,
  budgetMs = 6,
  timeoutMs = 12000,
) => {
  const until = performance.now() + timeoutMs;
  const objects: THREE.Object3D[] = [];
  scene.traverse((o) => {
    if ((o as THREE.Mesh).material) objects.push(o);
  });
  const pending = new Set<THREE.Material>();
  let start = performance.now();
  for (const o of objects) {
    if (!alive()) return;
    if (performance.now() - start > budgetMs) {
      await nextFrame();
      start = performance.now();
    }
    // removed while waiting (a part rebuilt): its replacement is picked up by the next pass
    if (!o.parent) continue;
    try {
      for (const m of onTarget(gl, () => gl.compile(o, camera, scene) as Set<THREE.Material>)) pending.add(m);
    } catch {
      /* a bad material: drawing it later compiles what it can */
    }
  }
  await whenReady(gl, pending, alive, until);
};
