import type { ComponentType } from 'react';
import { useAppStore } from '@/state/useAppStore';

/*
 * The planet surface (terrain, plants, wildlife, monuments, sky) is its own
 * chunk: nothing draws it until the first landing, so the first paint and
 * the hyperspace arrival do not pay to parse it. It is fetched once the
 * browser is idle after the arrival, or straight away when a trip starts,
 * and the dive holds its covered last frame until it is in (see
 * TransitionController), so a landing never renders onto nothing.
 */

export type SurfaceComponent = ComponentType<{ stageId?: string }>;

let scene: SurfaceComponent | null = null;
let pending: Promise<SurfaceComponent> | null = null;
const listeners = new Set<() => void>();

/** The surface component once loaded, else null. */
export const surfaceScene = () => scene;

export const onSurfaceLoaded = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const loadSurface = () =>
  (pending ??= import('./PlanetSurfaceScene').then(
    (m) => {
      scene = m.default;
      listeners.forEach((fn) => fn());
      return scene;
    },
    (e) => {
      // a failed fetch (offline for a moment) is retried by the next trigger
      pending = null;
      throw e;
    },
  ));

const idle = (fn: () => void) => {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(fn, { timeout: 2500 });
  else window.setTimeout(fn, 300);
};

const quietly = () => void loadSurface().catch(() => {});

/** Starts the preload: at idle once the arrival is over, at once when a trip begins. */
export const scheduleSurfaceLoad = () => {
  const s = useAppStore.getState();
  if (s.mode !== 'overworld') quietly();
  else if (!s.intro) idle(quietly);
  const unsub = useAppStore.subscribe((n, p) => {
    if (n.mode !== 'overworld' && p.mode === 'overworld') quietly();
    else if (!n.intro && p.intro) idle(quietly);
    if (scene) unsub();
  });
};
