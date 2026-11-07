import type { Pt } from './shape';

/*
 * The pod's doorway: the wall around the doors the viewer steps out through
 * after impact. Like the cockpit it lives in frame units: x / -z is the
 * screen position (1 = screen edge) once the group is scaled by the resting lens.
 */

/** Plane of the jamb, just in front of the pod's doors */
export const JAMB_Z = -0.47;
/** Doorway opening at the jamb, in screen units */
const HOLE_W = 0.78;
const HOLE_TOP = 0.8;
const HOLE_BOTTOM = -1.6;
/** Doorway outline at the jamb plane, counter-clockwise, rounded top corners. */
export const doorway = (): Pt[] => {
  const d = -JAMB_Z;
  const x = HOLE_W * d;
  const top = HOLE_TOP * d;
  const bot = HOLE_BOTTOM * d;
  const r = 0.07;
  const pts: Pt[] = [
    [-x, bot],
    [x, bot],
  ];
  for (let k = 0; k <= 6; k += 1) {
    const a = (k / 6) * (Math.PI / 2);
    pts.push([x - r + Math.cos(a) * r, top - r + Math.sin(a) * r]);
  }
  for (let k = 0; k <= 6; k += 1) {
    const a = Math.PI / 2 + (k / 6) * (Math.PI / 2);
    pts.push([-x + r + Math.cos(a) * r, top - r + Math.sin(a) * r]);
  }
  return pts;
};
