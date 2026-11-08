import * as THREE from 'three';

/*
 * Pins a DOM element onto a quad in the 3D scene with one matrix3d: the
 * projective map from the element's own rectangle to the quad's four corners
 * on screen. A single flat transform on one element renders the same in every
 * browser, unlike a chain of nested perspective / preserve-3d layers, which
 * Safari places differently from Chrome.
 */

type M3 = number[];

const adj = (m: M3): M3 => [
  m[4] * m[8] - m[5] * m[7],
  m[2] * m[7] - m[1] * m[8],
  m[1] * m[5] - m[2] * m[4],
  m[5] * m[6] - m[3] * m[8],
  m[0] * m[8] - m[2] * m[6],
  m[2] * m[3] - m[0] * m[5],
  m[3] * m[7] - m[4] * m[6],
  m[1] * m[6] - m[0] * m[7],
  m[0] * m[4] - m[1] * m[3],
];
const mul = (a: M3, b: M3): M3 => {
  const c = new Array(9).fill(0);
  for (let i = 0; i < 3; i += 1) for (let j = 0; j < 3; j += 1) for (let k = 0; k < 3; k += 1) c[3 * i + j] += a[3 * i + k] * b[3 * k + j];
  return c;
};
/** The map taking (1,0,0), (0,1,0), (0,0,1), (1,1,1) to four points (each [x, y]) */
const basis = (p: number[][]): M3 => {
  const m = [p[0][0], p[1][0], p[2][0], p[0][1], p[1][1], p[2][1], 1, 1, 1];
  const a = adj(m);
  const v = [a[0] * p[3][0] + a[1] * p[3][1] + a[2], a[3] * p[3][0] + a[4] * p[3][1] + a[5], a[6] * p[3][0] + a[7] * p[3][1] + a[8]];
  return mul(m, [v[0], 0, 0, 0, v[1], 0, 0, 0, v[2]]);
};

/**
 * CSS matrix3d taking a w x h element (transform-origin 0 0) onto four screen
 * points in the order top left, top right, bottom left, bottom right.
 */
export const quadMatrix = (w: number, h: number, dst: number[][]): string => {
  const t = mul(basis(dst), adj(basis([[0, 0], [w, 0], [0, h], [w, h]])));
  const k = t[8] || 1e-9;
  const n = t.map((x) => x / k);
  const f = (x: number) => (Math.abs(x) < 1e-12 ? '0' : x.toPrecision(8));
  return `matrix3d(${f(n[0])},${f(n[3])},0,${f(n[6])},${f(n[1])},${f(n[4])},0,${f(n[7])},0,0,1,0,${f(n[2])},${f(n[5])},0,${f(n[8])})`;
};

const _p = new THREE.Vector3();
const _v = new THREE.Vector3();
const _corners: number[][] = [
  [0, 0],
  [0, 0],
  [0, 0],
  [0, 0],
];
const SIGNS = [
  [-1, 1],
  [1, 1],
  [-1, -1],
  [1, -1],
];

/**
 * Projects a hw x hh (half sizes, world units) quad centred on `obj` (in its
 * local xy plane) to the viewport. Returns null when any corner is behind the
 * camera, so the caller can hide the element.
 */
export const projectQuad = (obj: THREE.Object3D, hw: number, hh: number, camera: THREE.Camera, width: number, height: number) => {
  for (let k = 0; k < 4; k += 1) {
    _p.set(SIGNS[k][0] * hw, SIGNS[k][1] * hh, 0).applyMatrix4(obj.matrixWorld);
    // behind the eye (or on it): no sane projection
    if (_v.copy(_p).applyMatrix4(camera.matrixWorldInverse).z > -0.05) return null;
    _p.project(camera);
    _corners[k][0] = (_p.x * 0.5 + 0.5) * width;
    _corners[k][1] = (0.5 - _p.y * 0.5) * height;
  }
  return _corners;
};
