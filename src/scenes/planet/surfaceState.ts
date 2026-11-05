/**
 * Mutable state shared inside the planet surface scene (camera -> beacons).
 * Read in useFrame only; never triggers React renders.
 */
export const arrivalPulse = {
  /** performance.now() when the discovery pulse starts; -1 when idle */
  start: -1,
};
