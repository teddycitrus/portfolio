import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/*
 * The shapes of me at the camp (Camp.tsx), modelled after photos: a long oval
 * face with a narrow jaw and chin, a straight prominent nose, thick straight
 * brows, rectangular dark navy frames, and thick black wavy hair with a lot of
 * volume on top, parted near the middle, with curtains sweeping out over the
 * temples and the tops of the ears. Units are metres in the head's frame:
 * origin at the head's centre, +y up, +z forward (the face).
 */

/** Head half-sizes: width, height (chin to crown), depth */
export const HEAD = { x: 0.071, y: 0.118, z: 0.098 };

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Piecewise linear lookup in a [t, value] table sorted by t. */
const table = (pts: readonly (readonly [number, number])[], t: number) => {
  if (t <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i += 1) {
    const [t1, v1] = pts[i];
    if (t <= t1) {
      const [t0, v0] = pts[i - 1];
      return lerp(v0, v1, (t - t0) / (t1 - t0));
    }
  }
  return pts[pts.length - 1][1];
};

/** Width of the head at a height (unit y, -1 chin .. 1 crown): narrow jaw and chin, cheekbones, a rounded crown */
const WIDTH = [
  [-1, 0.6],
  [-0.93, 0.77],
  [-0.8, 0.87],
  [-0.5, 0.9],
  [-0.2, 0.92],
  [0.05, 0.97],
  [0.35, 1.0],
  [0.7, 0.9],
  [1, 0.5],
] as const;
/** Depth of the face side: flat across the face, the chin a little forward */
const FRONT = [
  [-1, 0.45],
  [-0.86, 0.86],
  [-0.7, 0.84],
  [-0.4, 0.9],
  [0, 0.94],
  [0.4, 0.97],
  [1, 1],
] as const;
/** Depth of the back: a full skull over a slim neck */
const BACK = [
  [-1, 0.5],
  [-0.6, 0.72],
  [-0.2, 1.02],
  [0.3, 1.08],
  [1, 1],
] as const;

const width = (yn: number) => table(WIDTH, yn);
const depth = (yn: number, front: boolean) => table(front ? FRONT : BACK, yn);

/** A unit sphere point on the head surface, scaled out by `grow` (hair sits on a grown skull). */
const headPoint = (x: number, y: number, z: number, out: THREE.Vector3, grow = 1) =>
  out.set(x * width(y) * HEAD.x * grow, y * HEAD.y * grow, z * depth(y, z > 0) * HEAD.z * grow);

/** Forward (z) of the face surface at head-local x, y: where the eyes, nose and lips sit. */
export const faceZ = (x: number, y: number) => {
  const yn = THREE.MathUtils.clamp(y / HEAD.y, -1, 1);
  const xn = x / (width(yn) * HEAD.x);
  return Math.sqrt(Math.max(0, 1 - xn * xn - yn * yn)) * depth(yn, true) * HEAD.z;
};
/** Half-width of the head at head-local height y (for the ears and the glasses' arms). */
export const headHalfWidth = (y: number) => width(THREE.MathUtils.clamp(y / HEAD.y, -1, 1)) * HEAD.x;

const _p = new THREE.Vector3();

/** The head: a sphere shaped into a long face, with a light shadow of stubble on the jaw (vertex colours). */
export const headGeometry = () => {
  const g = new THREE.SphereGeometry(1, 48, 40);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    headPoint(x, y, z, _p);
    pos.setXYZ(i, _p.x, _p.y, _p.z);
    // stubble: the jaw, chin and upper lip a shade darker and cooler
    const jaw = THREE.MathUtils.smoothstep(-y, 0.38, 0.62) * THREE.MathUtils.smoothstep(z, -0.35, 0.1);
    const lip = THREE.MathUtils.smoothstep(-y, 0.44, 0.5) * (1 - THREE.MathUtils.smoothstep(-y, 0.54, 0.6)) * THREE.MathUtils.smoothstep(z, 0.8, 0.95);
    const k = 1 - 0.16 * Math.max(jaw * (1 - THREE.MathUtils.smoothstep(-y, 0.92, 1)), lip * 0.7);
    col[i * 3] = k;
    col[i * 3 + 1] = k * 0.99;
    col[i * 3 + 2] = k * 1.01;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
};

/** Hairline height (unit y) round the head: high on the forehead, down over the temples, low at the nape */
const HAIRLINE = [
  // azimuth: 0 = the face, PI = the back
  [0, 0.66],
  [0.5, 0.6],
  [1.0, 0.36],
  [1.35, 0.2],
  [1.6, 0.12],
  [2.0, -0.1],
  [2.5, -0.3],
  [Math.PI, -0.38],
] as const;
const hairline = (az: number) => table(HAIRLINE, Math.abs(az));

/**
 * The cap of hair over the scalp: a grid laid from the hairline up to the
 * crown all the way round, so its edge follows the hairline exactly. Thin at
 * the edge, thick on top.
 */
const capGeometry = () => {
  const g = new THREE.PlaneGeometry(1, 1, 72, 22);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i += 1) {
    const az = (pos.getX(i) + 0.5) * Math.PI * 2 - Math.PI;
    const t = pos.getY(i) + 0.5;
    const h = hairline(az);
    const yn = lerp(h, 0.999, t * t * (3 - 2 * t) * 0.35 + t * 0.65);
    const ry = Math.sqrt(Math.max(0, 1 - yn * yn));
    headPoint(Math.sin(az) * ry, yn, Math.cos(az) * ry, _p, 1.015 + 0.09 * Math.pow(t, 0.8));
    pos.setXYZ(i, _p.x, _p.y, _p.z);
  }
  g.computeVertexNormals();
  return g;
};

/** A lock of hair: a tube along points, swelling in the middle and tapering to a fine end. */
const lock = (pts: [number, number, number][], r: number, tip = 0.15) => {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)), false, 'catmullrom', 0.5);
  const seg = 14;
  const rad = 6;
  const g = new THREE.TubeGeometry(curve, seg, 1, rad, false);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const c = new THREE.Vector3();
  for (let i = 0; i <= seg; i += 1) {
    const t = i / seg;
    curve.getPointAt(t, c);
    // full near the root, widest a third along, fine at the tip
    const k = r * (0.75 + 0.6 * Math.sin(Math.min(1, t * 1.5) * Math.PI * 0.5)) * lerp(1, tip, THREE.MathUtils.smoothstep(t, 0.45, 1));
    for (let j = 0; j <= rad; j += 1) {
      const idx = i * (rad + 1) + j;
      _p.fromBufferAttribute(pos, idx).sub(c).multiplyScalar(k).add(c);
      pos.setXYZ(idx, _p.x, _p.y, _p.z);
    }
  }
  g.computeVertexNormals();
  return g;
};

/** Points on the grown skull at an azimuth (0 = face) and unit height, with some extra lift. */
const on = (az: number, yn: number, grow: number): [number, number, number] => {
  const ry = Math.sqrt(Math.max(0, 1 - yn * yn));
  headPoint(Math.sin(az) * ry, yn, Math.cos(az) * ry, _p, grow);
  return [_p.x, _p.y, _p.z];
};

/**
 * All the hair in one mesh: the cap, then locks laid over it. A part a little
 * left of centre; the top swept out both ways with a lot of lift; curtains
 * that rise off the part and fall out over the temples with a flick; fuller
 * sides over the tops of the ears; the back down to the nape; a few loose
 * strands standing off the top, as in the photos.
 */
export const hairGeometry = () => {
  const parts: THREE.BufferGeometry[] = [capGeometry()];
  const PART = -0.12;
  // the top: from the part out to each side, high and wavy
  for (let side = -1; side <= 1; side += 2) {
    for (let k = 0; k < 10; k += 1) {
      const along = k / 9; // front to crown
      // a little irregular, like real waves
      const j = Math.sin(k * 2.3 + side) * 0.08;
      const yStart = lerp(0.78, 0.96, along);
      const azRoot = PART + side * 0.05;
      const azEnd = side * lerp(1.3, 1.75, along);
      const root = on(PART + side * 0.04, yStart, 1.05);
      // pushed back along the part as the locks go from the forehead to the crown
      const zBack = lerp(0.0, -0.075, along);
      const mid = on(azRoot + side * (0.6 + j), lerp(0.88, 0.92, along) + j * 0.3, 1.24 + j * 0.25);
      const out = on(azEnd + side * j, lerp(0.42, 0.5, along) - 0.05 * Math.sin(k * 1.7), 1.16);
      const flick = on(azEnd + side * 0.15, lerp(0.36, 0.44, along) + 0.06, 1.2);
      const shift = (p: [number, number, number], w: number): [number, number, number] => [p[0], p[1], p[2] + zBack * w];
      parts.push(lock([shift(root, 1), shift(mid, 1), shift(out, 0.6), shift(flick, 0.5)], 0.024 - along * 0.004, 0.3));
    }
  }
  // curtains: up off the part at the hairline, then out and down over the corners of the
  // forehead, ending past the temples in a flick
  for (let side = -1; side <= 1; side += 2)
    for (let k = 0; k < 3; k += 1) {
      const a0 = PART + side * (0.05 + k * 0.1);
      parts.push(
        lock(
          [
            on(a0, 0.72, 1.04),
            on(a0 + side * 0.18, 0.86, 1.22),
            on(a0 + side * (0.5 + k * 0.08), 0.62 - k * 0.03, 1.16),
            on(side * (0.8 + k * 0.12), 0.32 + k * 0.03, 1.12),
            on(side * (1.12 + k * 0.1), 0.26 + k * 0.04, 1.2),
          ],
          0.016,
          0.22,
        ),
      );
    }
  // sides: down over the tops of the ears, waving
  for (let side = -1; side <= 1; side += 2)
    for (let k = 0; k < 4; k += 1) {
      const az = side * (1.5 + k * 0.32);
      parts.push(
        lock(
          [on(az - side * 0.1, 0.62, 1.14), on(az, 0.36, 1.2), on(az + side * 0.08, 0.16, 1.15), on(az + side * 0.02, 0.04 - k * 0.05, 1.12)],
          0.015,
          0.35,
        ),
      );
    }
  // the back: from the crown down to the nape, a little flip at the ends
  for (let k = 0; k < 7; k += 1) {
    const az = Math.PI - 0.9 + (k / 6) * 1.8;
    parts.push(
      lock(
        [on(az, 0.82, 1.08), on(az, 0.42, 1.12), on(az, 0.0, 1.1), on(az, -0.28, 1.04), on(az, -0.36, 1.03)],
        0.016,
        0.25,
      ),
    );
  }
  // loose strands standing off the top
  const strands: [number, number, number, number][] = [
    [0.4, 0.95, 0.5, 1.0],
    [-0.5, 0.92, -0.9, 0.9],
    [1.1, 0.8, 1.5, 0.7],
    [-1.2, 0.78, -1.6, 0.65],
    [2.5, 0.85, 2.9, 0.8],
  ];
  for (const [a0, y0, a1, y1] of strands)
    parts.push(lock([on(a0, y0, 1.14), on((a0 + a1) / 2, (y0 + y1) / 2 + 0.03, 1.22), on(a1, y1 - 0.12, 1.24)], 0.0016, 0.6));
  const g = mergeGeometries(parts.map((p) => p.toNonIndexed()));
  parts.forEach((p) => p.dispose());
  return g!;
};

/** One rectangular frame front of the glasses: a rounded rectangle ring, lens w x h, rim thickness t. */
export const frameGeometry = (w: number, h: number, t: number, depth: number) => {
  const round = (sh: THREE.Shape | THREE.Path, x: number, y: number, ww: number, hh: number, r: number) => {
    sh.moveTo(x + r, y);
    sh.lineTo(x + ww - r, y);
    sh.quadraticCurveTo(x + ww, y, x + ww, y + r);
    sh.lineTo(x + ww, y + hh - r);
    sh.quadraticCurveTo(x + ww, y + hh, x + ww - r, y + hh);
    sh.lineTo(x + r, y + hh);
    sh.quadraticCurveTo(x, y + hh, x, y + hh - r);
    sh.lineTo(x, y + r);
    sh.quadraticCurveTo(x, y, x + r, y);
  };
  const outer = new THREE.Shape();
  // a little deeper at the top, like the acetate frames in the photos
  round(outer, -w / 2 - t, -h / 2 - t * 0.9, w + 2 * t, h + t * 2.2, Math.min(h / 2 + t, 0.0095));
  const hole = new THREE.Path();
  round(hole, -w / 2, -h / 2, w, h, Math.min(h / 2, 0.0068));
  outer.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(outer, { depth, bevelEnabled: true, bevelThickness: depth * 0.3, bevelSize: t * 0.25, bevelSegments: 2, curveSegments: 4 });
  g.translate(0, 0, -depth / 2);
  return g;
};

/** A lens filling a frame. */
export const lensGeometry = (w: number, h: number) => {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, -h / 2);
  s.lineTo(w / 2, -h / 2);
  s.lineTo(w / 2, h / 2);
  s.lineTo(-w / 2, h / 2);
  s.closePath();
  return new THREE.ShapeGeometry(s);
};

/**
 * The open zip-up hoodie's body: the torso profile turned round the spine,
 * leaving a gap down the front where the zip hangs open, with a thicker
 * ribbed hem. `gap` is the half-angle of the opening (0 faces the front).
 */
export const hoodieGeometry = (gap: number) => {
  const profile = [
    [0.0, -0.005],
    [0.15, 0.0],
    [0.162, 0.03],
    [0.152, 0.06],
    [0.158, 0.16],
    [0.168, 0.3],
    [0.17, 0.38],
    [0.162, 0.44],
    [0.14, 0.49],
    [0.09, 0.53],
    [0.058, 0.55],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  return new THREE.LatheGeometry(profile, 28, gap, Math.PI * 2 - gap * 2);
};
