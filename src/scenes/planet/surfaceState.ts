import { createContext } from 'react';

/**
 * Mutable state shared inside the planet surface scene (camera -> beacons).
 * Read in useFrame only; never triggers React renders.
 */
export const arrivalPulse = {
  /** performance.now() when the discovery pulse starts; -1 when idle */
  start: -1,
};

/**
 * The planet whose surface is mounted (its whole tree committed and its
 * effects run), or null. Read by LazySurface to know when a surface it is
 * compiling out of sight is in its scene.
 */
export const surfaceMounted = {
  id: null as string | null,
};

/**
 * True inside a surface mounted out of sight to compile it (see LazySurface):
 * taking it down must leave the page as it found it (the cursor, for one).
 */
export const StagedSurface = createContext(false);
