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
 * effects run), or null. Read by the preload to know when a surface it asked
 * for is in the scene.
 */
export const surfaceMounted = {
  id: null as string | null,
};
