import * as THREE from 'three';

export type Pt = [number, number];

/** Distance from the eye to the bulkhead, in frame units */
export const FRAME_DEPTH = 0.6;

/**
 * The canopy window in screen space at rest (1 = screen edge): a wide opening
 * with clipped upper corners and a deeper taper toward the dashboard.
 * The overworld layout keeps every planet inside it (see WINDOW_FIT).
 */
const S = 0.9;
const T = 0.8;
const B = -0.7;
const CORNERS: Pt[] = [
  [-S + 0.12, T],
  [S - 0.12, T],
  [S, T - 0.16],
  [S, B + 0.24],
  [S - 0.3, B],
  [-S + 0.3, B],
  [-S, B + 0.24],
  [-S, T - 0.16],
];

/** Fraction of the lens the overworld layout may use, so planets stay inside the window. */
export const WINDOW_FIT = 0.84;

/** Rounds each corner of a polygon with a few arc samples (quadratic Bezier). */
const roundCorners = (pts: Pt[], r: number, steps = 5): Pt[] => {
  const out: Pt[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i += 1) {
    const p = pts[i];
    const a = pts[(i - 1 + n) % n];
    const b = pts[(i + 1) % n];
    const la = Math.hypot(a[0] - p[0], a[1] - p[1]);
    const lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const ra = Math.min(r, la / 2) / la;
    const rb = Math.min(r, lb / 2) / lb;
    const s: Pt = [p[0] + (a[0] - p[0]) * ra, p[1] + (a[1] - p[1]) * ra];
    const e: Pt = [p[0] + (b[0] - p[0]) * rb, p[1] + (b[1] - p[1]) * rb];
    for (let k = 0; k <= steps; k += 1) {
      const t = k / steps;
      const u = 1 - t;
      out.push([u * u * s[0] + 2 * u * t * p[0] + t * t * e[0], u * u * s[1] + 2 * u * t * p[1] + t * t * e[1]]);
    }
  }
  return out;
};

/** The window outline in frame units (counter-clockwise). */
export const HOLE: Pt[] = roundCorners([...CORNERS].reverse(), 0.045).map(([x, y]) => [x * FRAME_DEPTH, y * FRAME_DEPTH]);

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
