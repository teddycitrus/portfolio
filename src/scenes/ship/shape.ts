import * as THREE from 'three';

export type Pt = [number, number];

/** Distance from the eye to the bulkhead, in frame units */
export const FRAME_DEPTH = 0.6;

/**
 * The beam aperture in screen space at rest (1 = screen edge): a rounded,
 * squared-off ring (a superellipse) the tractor beam fires out through, from
 * T at the top down to B above the dashboard. The overworld layout keeps every
 * planet inside it (see WINDOW_FIT).
 */
const S = 0.92;
const T = 0.8;
const B = -0.7;
/** Squareness: 2 is an ellipse, higher fills the corners more */
const SQUARE = 3.4;
const HOLE_STEPS = 128;

/** Fraction of the lens the overworld layout may use, so planets stay inside the window. */
export const WINDOW_FIT = 0.84;

/** The aperture outline in frame units (counter-clockwise). */
export const HOLE: Pt[] = Array.from({ length: HOLE_STEPS }, (_, i) => {
  const a = (i / HOLE_STEPS) * Math.PI * 2;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const x = Math.sign(c) * Math.pow(Math.abs(c), 2 / SQUARE) * S;
  const y = (T + B) / 2 + Math.sign(s) * Math.pow(Math.abs(s), 2 / SQUARE) * ((T - B) / 2);
  return [x * FRAME_DEPTH, y * FRAME_DEPTH] as Pt;
});

/** Grows a convex counter-clockwise outline outward by d. */
export const offsetPoly = (pts: Pt[], d: number): Pt[] => {
  const n = pts.length;
  const normal = (i: number): Pt => {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[(i + 1) % n];
    const l = Math.hypot(bx - ax, by - ay) || 1;
    return [(by - ay) / l, -(bx - ax) / l];
  };
  return pts.map((p, i) => {
    const n1 = normal((i - 1 + n) % n);
    const n2 = normal(i);
    const k = d / Math.max(0.2, 1 + n1[0] * n2[0] + n1[1] * n2[1]);
    return [p[0] + (n1[0] + n2[0]) * k, p[1] + (n1[1] + n2[1]) * k] as Pt;
  });
};

/** A bulkhead far larger than any view, with the window cut out of it. */
export const cockpitShape = (hole: Pt[]) => {
  // wide enough that the wall still fills the view when the viewer turns inside the ship
  const E = 12;
  const s = new THREE.Shape([
    new THREE.Vector2(-E, -E),
    new THREE.Vector2(E, -E),
    new THREE.Vector2(E, E),
    new THREE.Vector2(-E, E),
  ]);
  s.holes.push(new THREE.Path(hole.map(([x, y]) => new THREE.Vector2(x, y))));
  return s;
};
