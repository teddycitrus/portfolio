import * as THREE from 'three';
import { noise2 } from './Terrain';
import { mulberry } from './rng';

/*
 * Plant geometry. Everything is indexed and built in one pass per species;
 * colours live in the vertices (instance colour only varies them), and the
 * aVeg / aOpen attributes drive the shader in floraShader.ts.
 */

export type V3 = [number, number, number];
type Col = THREE.ColorRepresentation;

interface Shade {
  c: THREE.Color;
  flex?: number;
  glow?: number;
  open?: V3;
}

const norm = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 1e-6 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 1, 0];
};
const col = (c: Col) => new THREE.Color(c);
const mixc = (a: THREE.Color, b: THREE.Color, t: number) => a.clone().lerp(b, t);

const mesher = () => {
  const pos: number[] = [];
  const nrm: number[] = [];
  const clr: number[] = [];
  const veg: number[] = [];
  const opn: number[] = [];
  const idx: number[] = [];
  let count = 0;
  const v = (p: V3, n: V3, s: Shade) => {
    pos.push(p[0], p[1], p[2]);
    nrm.push(n[0], n[1], n[2]);
    clr.push(s.c.r, s.c.g, s.c.b);
    veg.push(s.flex ?? 0, s.glow ?? 0);
    const o = s.open ?? [0, 0, 0];
    opn.push(o[0], o[1], o[2]);
    count += 1;
    return count - 1;
  };
  const tri = (a: number, b: number, c: number) => idx.push(a, b, c);
  const build = () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(clr, 3));
    g.setAttribute('aVeg', new THREE.Float32BufferAttribute(veg, 2));
    g.setAttribute('aOpen', new THREE.Float32BufferAttribute(opn, 3));
    g.setIndex(idx);
    return g;
  };
  return { v, tri, build };
};
type Mesher = ReturnType<typeof mesher>;

/** A closed skin over rings of equal length. Normals come from the neighbouring vertices. */
const skin = (m: Mesher, rows: V3[][], shade: (t: number, j: number) => Shade) => {
  const R = rows.length;
  const S = rows[0].length;
  const base: number[][] = [];
  for (let i = 0; i < R; i += 1) {
    const row = rows[i];
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const p of row) {
      cx += p[0] / S;
      cy += p[1] / S;
      cz += p[2] / S;
    }
    const ids: number[] = [];
    for (let j = 0; j < S; j += 1) {
      const a = rows[Math.min(R - 1, i + 1)][j];
      const b = rows[Math.max(0, i - 1)][j];
      const c = row[(j + 1) % S];
      const d = row[(j + S - 1) % S];
      const u: V3 = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
      const w: V3 = [c[0] - d[0], c[1] - d[1], c[2] - d[2]];
      let n = norm([u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]);
      const p = row[j];
      if (n[0] * (p[0] - cx) + n[1] * (p[1] - cy) + n[2] * (p[2] - cz) < 0) n = [-n[0], -n[1], -n[2]];
      ids.push(m.v(p, n, shade(i / Math.max(1, R - 1), j)));
    }
    base.push(ids);
  }
  for (let i = 0; i < R - 1; i += 1) {
    for (let j = 0; j < S; j += 1) {
      const k = (j + 1) % S;
      m.tri(base[i][j], base[i][k], base[i + 1][k]);
      m.tri(base[i][j], base[i + 1][k], base[i + 1][j]);
    }
  }
};

/** Rings around a path; radius and shade are functions of position along it */
const tube = (
  m: Mesher,
  path: V3[],
  radius: (t: number) => number,
  sides: number,
  shade: (t: number, j: number) => Shade,
) => {
  const rows: V3[][] = [];
  for (let i = 0; i < path.length; i += 1) {
    const p = path[i];
    const a = path[Math.max(0, i - 1)];
    const b = path[Math.min(path.length - 1, i + 1)];
    const t = norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
    const ref: V3 = Math.abs(t[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    const u = norm([ref[1] * t[2] - ref[2] * t[1], ref[2] * t[0] - ref[0] * t[2], ref[0] * t[1] - ref[1] * t[0]]);
    const w: V3 = [t[1] * u[2] - t[2] * u[1], t[2] * u[0] - t[0] * u[2], t[0] * u[1] - t[1] * u[0]];
    const r = radius(i / (path.length - 1));
    const row: V3[] = [];
    for (let j = 0; j < sides; j += 1) {
      const c = Math.cos((j / sides) * Math.PI * 2) * r;
      const s = Math.sin((j / sides) * Math.PI * 2) * r;
      row.push([p[0] + u[0] * c + w[0] * s, p[1] + u[1] * c + w[1] * s, p[2] + u[2] * c + w[2] * s]);
    }
    rows.push(row);
  }
  skin(m, rows, shade);
};

/** Flat strip along a path, tapering to a single tip vertex when width(1) is 0 */
const ribbon = (
  m: Mesher,
  path: V3[],
  side: V3,
  width: (t: number) => number,
  normal: V3,
  shade: (t: number) => Shade,
) => {
  const n = path.length - 1;
  const ids: Array<[number, number]> = [];
  for (let i = 0; i <= n; i += 1) {
    const t = i / n;
    const w = width(t);
    const p = path[i];
    const s = shade(t);
    if (w <= 1e-5) {
      const c = m.v(p, normal, s);
      ids.push([c, c]);
    } else {
      ids.push([
        m.v([p[0] - side[0] * w, p[1] - side[1] * w, p[2] - side[2] * w], normal, s),
        m.v([p[0] + side[0] * w, p[1] + side[1] * w, p[2] + side[2] * w], normal, s),
      ]);
    }
  }
  for (let i = 0; i < n; i += 1) {
    const [a, b] = ids[i];
    const [c, d] = ids[i + 1];
    m.tri(a, b, d);
    if (c !== d) m.tri(a, d, c);
  }
};

/** Four-vertex bead for seeds and spores */
const bead = (m: Mesher, at: V3, r: number, s: Shade) => {
  const t = m.v([at[0], at[1] + r * 1.4, at[2]], [0, 1, 0], s);
  const ids = [0, 2.1, 4.2].map((a) =>
    m.v([at[0] + Math.cos(a) * r, at[1] - r * 0.5, at[2] + Math.sin(a) * r], norm([Math.cos(a), 0.3, Math.sin(a)]), s),
  );
  m.tri(ids[0], ids[1], t);
  m.tri(ids[1], ids[2], t);
  m.tri(ids[2], ids[0], t);
  m.tri(ids[0], ids[2], ids[1]);
};

/** Petal that starts folded up against the bud and swings outward along aOpen */
const petal = (m: Mesher, at: V3, a: number, len: number, wid: number, tilt: number, inner: THREE.Color, outer: THREE.Color, flex: number, glow: number) => {
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const closedR = len * 0.2;
  const up = [at[0] + ca * closedR, at[1] + len, at[2] + sa * closedR] as V3;
  const mid = [at[0] + ca * closedR * 1.2, at[1] + len * 0.55, at[2] + sa * closedR * 1.2] as V3;
  const side: V3 = [-sa * wid, 0, ca * wid];
  const n = norm([ca * 0.5, 1, sa * 0.5]);
  const openR = len * 0.95;
  const openTip: V3 = [ca * (openR - closedR), -len * (0.75 + tilt), sa * (openR - closedR)];
  const openMid: V3 = [ca * (openR * 0.55 - closedR), -len * (0.42 + tilt * 0.5), sa * (openR * 0.55 - closedR)];
  const b = m.v(at, n, { c: inner, flex: flex * 0.6, glow: glow * 0.5 });
  const l = m.v([mid[0] - side[0], mid[1], mid[2] - side[2]], n, { c: outer, flex, glow, open: openMid });
  const r = m.v([mid[0] + side[0], mid[1], mid[2] + side[2]], n, { c: outer, flex, glow, open: openMid });
  const t = m.v(up, n, { c: outer, flex, glow: glow * 0.7, open: openTip });
  m.tri(b, r, t);
  m.tri(b, t, l);
};

/* ---------- blades ---------- */

export interface TuftSpec {
  seed: number;
  blades: number;
  height: number;
  width: number;
  lean: number;
  droop: number;
  root: Col;
  tip: Col;
  segs?: number;
  flex?: number;
  /** Glow weight at the blade tip */
  tipGlow?: number;
  /** Bead on each blade tip */
  head?: { color: Col; size: number; glow?: number };
  spread?: number;
}

export const tuft = (s: TuftSpec) => {
  const m = mesher();
  const rnd = mulberry(s.seed);
  const root = col(s.root);
  const tip = col(s.tip);
  const segs = s.segs ?? 2;
  const flexK = s.flex ?? 1;
  for (let b = 0; b < s.blades; b += 1) {
    const a = (b / s.blades) * Math.PI * 2 + rnd() * 0.8;
    const h = s.height * (0.6 + rnd() * 0.4);
    const spread = s.spread ?? 0.1;
    const r0 = spread * (0.4 + rnd() * 0.6);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const lean = s.lean * (0.6 + rnd() * 0.7);
    const droop = s.droop * (0.5 + rnd() * 0.8);
    const path: V3[] = [];
    for (let i = 0; i <= segs; i += 1) {
      const t = i / segs;
      const out = r0 + lean * h * t * t;
      path.push([ca * out, -0.04 + h * (t - droop * t * t), sa * out]);
    }
    const tint = 0.85 + rnd() * 0.3;
    ribbon(
      m,
      path,
      [-sa, 0, ca],
      (t) => s.width * (1 - t * t) * (t >= 1 ? 0 : 1),
      norm([ca * 0.35, 1, sa * 0.35]),
      (t) => ({
        c: mixc(root, tip, t).multiplyScalar(tint),
        flex: t * t * flexK,
        glow: (s.tipGlow ?? 0) * t * t,
      }),
    );
    if (s.head) {
      bead(m, path[segs], s.head.size * (0.7 + rnd() * 0.5), {
        c: col(s.head.color),
        flex: flexK,
        glow: s.head.glow ?? 0,
      });
    }
  }
  return m.build();
};

/* ---------- ground cover ---------- */

/** Low irregular cushion: lichen crust, moss, ember mat */
export const cushion = (seed: number, core: Col, edge: Col, sides = 7, height = 0.1, glow = 0) => {
  const m = mesher();
  const rnd = mulberry(seed);
  const cc = col(core);
  const ec = col(edge);
  const radii: number[] = [];
  for (let j = 0; j < sides; j += 1) radii.push(0.72 + rnd() * 0.5);
  const profile: Array<[number, number]> = [
    [1.05, -0.05],
    [0.92, height * 0.55],
    [0.5, height],
    [0.02, height * 1.1],
  ];
  const rows = profile.map(([r, y]) =>
    radii.map((k, j): V3 => {
      const a = (j / sides) * Math.PI * 2;
      return [Math.cos(a) * r * k, y, Math.sin(a) * r * k];
    }),
  );
  skin(m, rows, (t) => ({ c: mixc(ec, cc, Math.min(1, t * 1.4)), glow: glow * (0.25 + t * 0.75) }));
  return m.build();
};

/* ---------- arid species ---------- */

/** Ribbed barrel that stores water, with a crown of buds that open after sunset */
export const barrel = (body: Col, shoulder: Col, inner: Col, outer: Col) => {
  const m = mesher();
  const ribs = 7;
  const S = ribs * 2;
  const prof: Array<[number, number]> = [
    [0.42, -0.08],
    [0.5, 0.18],
    [0.47, 0.42],
    [0.32, 0.62],
    [0.1, 0.7],
  ];
  const rows = prof.map(([r, y]) => {
    const row: V3[] = [];
    for (let j = 0; j < S; j += 1) {
      const a = (j / S) * Math.PI * 2;
      const k = j % 2 ? 0.86 : 1;
      row.push([Math.cos(a) * r * k, y, Math.sin(a) * r * k]);
    }
    return row;
  });
  const bc = col(body);
  const sc = col(shoulder);
  skin(m, rows, (t, j) => ({ c: mixc(bc, sc, t * t).multiplyScalar(j % 2 ? 0.74 : 1.04) }));
  const ic = col(inner);
  const oc = col(outer);
  for (let i = 0; i < 5; i += 1) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    petal(m, [Math.cos(a) * 0.06, 0.69, Math.sin(a) * 0.06], a, 0.15, 0.05, 0.1, ic, oc, 0, 1);
  }
  return m.build();
};

/** Stiff leaf rosette with a thin flowering spike */
export const rosette = (seed: number, leaf: Col, edge: Col, stalk: Col, pod: Col) => {
  const m = mesher();
  const rnd = mulberry(seed);
  const lc = col(leaf);
  const ec = col(edge);
  const n = 9;
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.3;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const len = 0.5 + rnd() * 0.22;
    const rise = 0.55 + rnd() * 0.35;
    ribbon(
      m,
      [0, 0.45, 1].map((t): V3 => [ca * len * t, -0.02 + len * rise * (t - 0.35 * t * t), sa * len * t]),
      [-sa, 0, ca],
      (t) => (t >= 1 ? 0 : 0.08 * (1 - t * t * 0.6)),
      norm([ca * 0.5, 1, sa * 0.5]),
      (t) => ({ c: mixc(lc, ec, t), flex: t * t * 0.1 }),
    );
  }
  const sc = col(stalk);
  const h = 1.5 + rnd() * 0.5;
  const lean = 0.07;
  const path: V3[] = [0, 0.33, 0.66, 1].map((t) => [lean * t * h, t * h, lean * 0.4 * t * h]);
  tube(m, path, (t) => 0.024 * (1 - t * 0.6), 4, (t) => ({ c: sc, flex: t * t }));
  const pc = col(pod);
  for (let i = 0; i < 6; i += 1) {
    const t = 0.72 + (i / 6) * 0.28;
    const a = i * 2.4;
    bead(m, [lean * t * h + Math.cos(a) * 0.07, t * h, lean * 0.4 * t * h + Math.sin(a) * 0.07], 0.05, {
      c: pc,
      flex: t * t,
      glow: 1,
    });
  }
  return m.build();
};

export interface ShrubSpec {
  seed: number;
  bark: Col;
  leaf: Col;
  leafTip: Col;
  height: number;
  depth?: number;
  leafLen: number;
  leafWid: number;
  leaves: number;
  /** Glow weight along the leaf tips */
  tipGlow?: number;
}

/** Forking woody shrub: leaves pair off the outer twigs */
export const shrub = (s: ShrubSpec) => {
  const m = mesher();
  const rnd = mulberry(s.seed);
  const bark = col(s.bark);
  const leaf = col(s.leaf);
  const leafTip = col(s.leafTip);
  const depth = s.depth ?? 3;
  const addLeaf = (at: V3, flex: number) => {
    const a = rnd() * Math.PI * 2;
    const len = s.leafLen * (0.7 + rnd() * 0.5);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const rise = 0.2 + rnd() * 0.5;
    const path: V3[] = [at, [at[0] + ca * len * 0.55, at[1] + len * rise * 0.7, at[2] + sa * len * 0.55], [at[0] + ca * len, at[1] + len * (rise - 0.18), at[2] + sa * len]];
    ribbon(m, path, [-sa, 0, ca], (t) => (t >= 1 ? 0 : s.leafWid * (1 - (t - 0.35) * (t - 0.35))), norm([ca * 0.3, 1, sa * 0.3]), (t) => ({
      c: mixc(leaf, leafTip, t).multiplyScalar(0.85 + t * 0.3),
      flex: flex + t * 0.3,
      glow: (s.tipGlow ?? 0) * t * t,
    }));
  };
  const grow = (from: V3, dir: V3, len: number, r: number, d: number, flex: number) => {
    const end: V3 = [from[0] + dir[0] * len, from[1] + dir[1] * len, from[2] + dir[2] * len];
    tube(m, [from, end], (t) => r * (1 - t * 0.4), 4, (t) => ({ c: bark, flex: flex + t * 0.2 }));
    if (d <= 0) {
      for (let i = 0; i < s.leaves; i += 1) addLeaf(end, flex + 0.2);
      return;
    }
    const n = d === depth ? 3 : 2;
    for (let i = 0; i < n; i += 1) {
      const a = (i / n) * Math.PI * 2 + rnd() * 1.4;
      const spread = 0.5 + rnd() * 0.4;
      const nd = norm([dir[0] + Math.cos(a) * spread, dir[1] * 0.85 + 0.1, dir[2] + Math.sin(a) * spread]);
      grow(end, nd, len * (0.62 + rnd() * 0.2), r * 0.62, d - 1, flex + 0.25);
    }
  };
  grow([0, -0.05, 0], [0, 1, 0], s.height * 0.38, 0.05 * s.height, depth, 0);
  return m.build();
};

/* ---------- airborne mesa species ---------- */

/** Growing cluster of faceted prisms: crystal that reads as a colony */
export const druse = (seed: number, foot: Col, body: Col, tip: Col) => {
  const m = mesher();
  const rnd = mulberry(seed);
  const fc = col(foot);
  const bc = col(body);
  const tc = col(tip);
  const n = 5;
  for (let i = 0; i < n; i += 1) {
    const main = i === 0;
    const h = main ? 1.7 : 0.6 + rnd() * 0.7;
    const r = main ? 0.17 : 0.07 + rnd() * 0.07;
    const a = (i / n) * Math.PI * 2 + rnd();
    const off = main ? 0 : 0.14 + rnd() * 0.22;
    const tilt = main ? 0.04 : 0.2 + rnd() * 0.3;
    const dir = norm([Math.cos(a) * tilt, 1, Math.sin(a) * tilt]);
    const base: V3 = [Math.cos(a) * off, -0.08, Math.sin(a) * off];
    const point = (t: number): V3 => [base[0] + dir[0] * h * t, base[1] + dir[1] * h * t, base[2] + dir[2] * h * t];
    tube(m, [point(0), point(0.74), point(1)], (t) => (t < 0.9 ? r * (1 - t * 0.2) : 0.003), 5, (t) => ({
      c: t < 0.5 ? mixc(fc, bc, t * 2) : mixc(bc, tc, (t - 0.5) * 2),
      glow: main ? t * t : t * t * 0.7,
    }));
  }
  return m.build();
};

/** Bell caps on slim stems, gills lit from underneath */
export const lanterns = (seed: number, stem: Col, cap: Col, gill: Col, count = 3) => {
  const m = mesher();
  const rnd = mulberry(seed);
  const sc = col(stem);
  const cc = col(cap);
  const gc = col(gill);
  for (let i = 0; i < count; i += 1) {
    const a = (i / count) * Math.PI * 2 + rnd();
    const off = i === 0 ? 0 : 0.16 + rnd() * 0.16;
    const h = (i === 0 ? 0.55 : 0.28 + rnd() * 0.2) * 1;
    const r = i === 0 ? 0.17 : 0.1 + rnd() * 0.05;
    const x = Math.cos(a) * off;
    const z = Math.sin(a) * off;
    const lean = (rnd() - 0.5) * 0.14;
    const top: V3 = [x + lean, h, z - lean];
    tube(m, [[x, -0.04, z], [x + lean * 0.5, h * 0.55, z - lean * 0.5], top], (t) => 0.018 + 0.012 * (1 - t), 4, (t) => ({ c: sc, flex: t * t * 0.3 }));
    const prof: Array<[number, number]> = [
      [0.5, -0.02],
      [1, 0.04],
      [0.86, 0.32],
      [0.45, 0.58],
      [0.02, 0.66],
    ];
    const S = 7;
    const rows = prof.map(([pr, py]) => {
      const row: V3[] = [];
      for (let j = 0; j < S; j += 1) {
        const ang = (j / S) * Math.PI * 2;
        row.push([top[0] + Math.cos(ang) * r * pr, top[1] + py * r, top[2] + Math.sin(ang) * r * pr]);
      }
      return row;
    });
    skin(m, rows, (t) => ({
      c: t < 0.3 ? gc : mixc(cc, cc.clone().multiplyScalar(0.72), t),
      flex: 0.2,
      glow: t < 0.3 ? 1 : 0.1,
    }));
  }
  return m.build();
};

/** Long ribbons streaming off the mesa rim on the updraft */
export const streamer = (seed: number, root: Col, tip: Col, blades = 3, height = 1.9) => {
  const m = mesher();
  const rnd = mulberry(seed);
  const rc = col(root);
  const tc = col(tip);
  for (let b = 0; b < blades; b += 1) {
    const a = rnd() * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const h = height * (0.6 + rnd() * 0.4);
    const off = 0.1 + rnd() * 0.1;
    const segs = 7;
    const path: V3[] = [];
    for (let i = 0; i <= segs; i += 1) {
      const t = i / segs;
      path.push([ca * off + Math.sin(t * 5 + b) * 0.05 * t, t * h - 0.04, sa * off + Math.cos(t * 4 + b) * 0.05 * t]);
    }
    ribbon(m, path, [-sa, 0, ca], (t) => (t >= 1 ? 0 : 0.05 * (1 - t) + 0.012), norm([ca, 0.5, sa]), (t) => ({
      c: mixc(rc, tc, t),
      flex: t * t,
      glow: t * t * 0.7,
    }));
  }
  return m.build();
};

/** Slim stem with a bud that opens into a pale star when it senses warmth */
export const starcup = (seed: number, stem: Col, inner: Col, outer: Col, height = 0.42, petals = 5) => {
  const m = mesher();
  const rnd = mulberry(seed);
  const sc = col(stem);
  const ic = col(inner);
  const oc = col(outer);
  const lean = 0.05 + rnd() * 0.06;
  const path: V3[] = [0, 0.5, 1].map((t) => [lean * t * t, -0.04 + t * height, lean * 0.4 * t * t]);
  ribbon(m, path, [1, 0, 0], (t) => (t >= 1 ? 0.008 : 0.012), [0, 1, 0], (t) => ({ c: sc, flex: t * t }));
  const top = path[2];
  for (let i = 0; i < petals; i += 1) {
    petal(m, [top[0], top[1], top[2]], (i / petals) * Math.PI * 2 + rnd() * 0.4, 0.1, 0.03, 0.12, ic, oc, 1, 1);
  }
  return m.build();
};

/* ---------- heat-adapted species ---------- */

/** Crown plant: fibrous trunk topped by stiff fronds (cycad or wind-bent palm) */
export const crownPlant = (seed: number, opts: {
  height: number;
  bend: number;
  trunk: Col;
  trunkTop: Col;
  frond: Col;
  frondTip: Col;
  fronds: number;
  frondLen: number;
  frondDroop: number;
  trunkR: number;
  glow?: number;
}) => {
  const m = mesher();
  const rnd = mulberry(seed);
  const tc = col(opts.trunk);
  const tt = col(opts.trunkTop);
  const fc = col(opts.frond);
  const ft = col(opts.frondTip);
  const path: V3[] = [0, 0.3, 0.66, 1].map((t) => [opts.bend * t * t * opts.height, t * opts.height - 0.06, 0]);
  tube(m, path, (t) => opts.trunkR * (1 - t * 0.45) + 0.02 * Math.sin(t * 19), 6, (t, j) => ({
    c: mixc(tc, tt, t).multiplyScalar(j % 2 ? 0.85 : 1),
    flex: t * t * 0.25,
  }));
  const top = path[3];
  for (let i = 0; i < opts.fronds; i += 1) {
    const a = (i / opts.fronds) * Math.PI * 2 + rnd() * 0.3;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const len = opts.frondLen * (0.8 + rnd() * 0.3);
    const rise = 0.42 + rnd() * 0.3;
    const segs = 4;
    const pts: V3[] = [];
    for (let k = 0; k <= segs; k += 1) {
      const t = k / segs;
      pts.push([top[0] + ca * len * t, top[1] + len * (rise * t - opts.frondDroop * t * t), top[2] + sa * len * t]);
    }
    ribbon(
      m,
      pts,
      [-sa, 0, ca],
      (t) => (t >= 1 ? 0 : len * 0.09 * (1 - t * t) * (k3(t) ? 0.72 : 1)),
      norm([ca * 0.3, 1, sa * 0.3]),
      (t) => ({ c: mixc(fc, ft, t), flex: 0.25 + t * t, glow: (opts.glow ?? 0) * t }),
    );
  }
  return m.build();
};

/** Alternating notches along a frond for a pinnate edge */
const k3 = (t: number) => Math.round(t * 8) % 2 === 1;

/** Mineral tube colony around a vent; its open mouths glow and the glow climbs the pipes */
export const ventTubes = (seed: number, shell: Col, rim: Col, count = 5) => {
  const m = mesher();
  const rnd = mulberry(seed);
  const sc = col(shell);
  const rc = col(rim);
  for (let i = 0; i < count; i += 1) {
    const main = i === 0;
    const a = (i / count) * Math.PI * 2 + rnd();
    const off = main ? 0 : 0.16 + rnd() * 0.2;
    const h = main ? 0.95 : 0.4 + rnd() * 0.45;
    const r = main ? 0.1 : 0.05 + rnd() * 0.04;
    const x = Math.cos(a) * off;
    const z = Math.sin(a) * off;
    const dx = main ? 0.02 : Math.cos(a) * (0.08 + rnd() * 0.16);
    const dz = main ? 0.03 : Math.sin(a) * (0.08 + rnd() * 0.16);
    tube(m, [[x, -0.08, z], [x + dx * 0.5, h * 0.55, z + dz * 0.5], [x + dx, h, z + dz]], (t) => r * (1.2 - t * 0.35), 5, (t, j) => ({
      c: (t > 0.96 ? rc : sc).clone().multiplyScalar(j % 2 ? 0.86 : 1),
      glow: t * t * t * 0.7,
    }));
    // the dark mouth, lit from inside
    const mouth: V3[][] = [0, 1].map((t) => {
      const row: V3[] = [];
      for (let j = 0; j < 5; j += 1) {
        const ang = (j / 5) * Math.PI * 2;
        const q = r * 0.85 * (1 - t);
        row.push([x + dx + Math.cos(ang) * q, h + 0.005, z + dz + Math.sin(ang) * q]);
      }
      return row;
    });
    skin(m, mouth, () => ({ c: rc, glow: 1 }));
  }
  return m.build();
};

/* ---------- temperate and coastal species ---------- */

/** Forked trunk carrying clumped leaf masses */
export const broadleaf = (seed: number, bark: Col, leafLow: Col, leafTop: Col) => {
  const m = mesher();
  const rnd = mulberry(seed);
  const bc = col(bark);
  const lc = col(leafLow);
  const tc = col(leafTop);
  tube(m, [[0, -0.1, 0], [0.04, 1, 0.03], [0.1, 2, 0.05]], (t) => 0.2 * (1 - t * 0.45), 6, (t) => ({ c: bc, flex: t * t * 0.1 }));
  const blob = (cx: number, cy: number, cz: number, r: number) => {
    const S = 6;
    const R = 4;
    const rows: V3[][] = [];
    for (let i = 0; i < R; i += 1) {
      const v = (i + 0.4) / R;
      const y = Math.cos(v * Math.PI) * r * 0.82;
      const pr = Math.sin(v * Math.PI) * r;
      const row: V3[] = [];
      for (let j = 0; j < S; j += 1) {
        const a = (j / S) * Math.PI * 2 + i;
        const k = 0.82 + noise2(cx + j, cy + i) * 0.4;
        row.push([cx + Math.cos(a) * pr * k, cy + y, cz + Math.sin(a) * pr * k]);
      }
      rows.push(row);
    }
    skin(m, rows, (t) => ({ c: mixc(lc, tc, 1 - t).multiplyScalar(0.92 + rnd() * 0.16), flex: 0.3 + cy * 0.06 }));
  };
  for (let i = 0; i < 4; i += 1) {
    const a = (i / 4) * Math.PI * 2 + rnd();
    const r = 0.5 + rnd() * 0.4;
    const y = 2.2 + rnd() * 0.5;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    tube(m, [[0.1, 1.9, 0.05], [x, y, z]], (t) => 0.09 * (1 - t * 0.5), 4, (t) => ({ c: bc, flex: t * t * 0.15 }));
    blob(x, y + 0.2, z, 0.75 + rnd() * 0.3);
  }
  blob(0.1, 3.4, 0.05, 1.05);
  blob(0.5, 2.5, -0.5, 0.65);
  return m.build();
};

/** Spruce with drooping serrated tiers */
export const spruce = (bark: Col, needleLow: Col, needleTop: Col) => {
  const m = mesher();
  const bc = col(bark);
  const lc = col(needleLow);
  const tc = col(needleTop);
  tube(m, [[0, -0.08, 0], [0, 1.2, 0], [0, 4, 0]], (t) => 0.13 * (1 - t * 0.7), 5, () => ({ c: bc }));
  const tiers: Array<[number, number, number]> = [
    [0.75, 0.95, 1.5],
    [1.55, 0.72, 1.35],
    [2.3, 0.5, 1.15],
    [3.05, 0.3, 0.95],
  ];
  const S = 9;
  tiers.forEach(([y, r, h], ti) => {
    const rows = [0, 0.5, 1].map((t) => {
      const row: V3[] = [];
      for (let j = 0; j < S; j += 1) {
        const a = (j / S) * Math.PI * 2 + ti * 0.6;
        const skirt = t === 0 ? (j % 2 ? 0.76 : 1.06) : 1;
        const pr = r * (t === 0 ? 1 : t === 0.5 ? 0.46 : 0.02);
        row.push([Math.cos(a) * pr * skirt, y + (t === 0 ? -0.12 * (j % 2) : t * h), Math.sin(a) * pr * skirt]);
      }
      return row;
    });
    skin(m, rows, (t) => ({ c: mixc(lc, tc, t * 0.8 + ti * 0.07), flex: (y + t * h) * 0.05 }));
  });
  return m.build();
};

/** Arching fern: serrated fronds from one crown */
export const fern = (seed: number, frond: Col, tip: Col, fronds = 6, len = 0.9) => {
  const m = mesher();
  const rnd = mulberry(seed);
  const fc = col(frond);
  const tc = col(tip);
  for (let i = 0; i < fronds; i += 1) {
    const a = (i / fronds) * Math.PI * 2 + rnd() * 0.5;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const L = len * (0.7 + rnd() * 0.5);
    const segs = 8;
    const path: V3[] = [];
    for (let k = 0; k <= segs; k += 1) {
      const t = k / segs;
      path.push([ca * L * t, L * (0.8 * t - 0.62 * t * t) - 0.02, sa * L * t]);
    }
    ribbon(m, path, [-sa, 0, ca], (t) => (t >= 1 ? 0 : (k3(t) ? 0.04 : 0.09) * (1 - t * 0.8)), norm([ca * 0.2, 1, sa * 0.2]), (t) => ({
      c: mixc(fc, tc, t),
      flex: t * t,
    }));
  }
  return m.build();
};

/** Wet ribbons rooted below the waterline; they follow the surge */
export const kelp = (seed: number, root: Col, tip: Col) => {
  const m = mesher();
  const rnd = mulberry(seed);
  const rc = col(root);
  const tc = col(tip);
  for (let b = 0; b < 3; b += 1) {
    const a = rnd() * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const h = 0.9 + rnd() * 0.5;
    const segs = 5;
    const path: V3[] = [];
    for (let k = 0; k <= segs; k += 1) {
      const t = k / segs;
      const w = Math.sin(t * 7 + b) * 0.08 * t;
      path.push([ca * (0.08 + w), t * h - 0.15, sa * (0.08 - w)]);
    }
    ribbon(m, path, [-sa, 0, ca], (t) => (t >= 1 ? 0 : 0.055), [ca, 0.6, sa], (t) => ({ c: mixc(rc, tc, t), flex: t * t }));
  }
  return m.build();
};

/* ---------- stone ---------- */

const paint = (g: THREE.BufferGeometry, color: Col) => {
  const c = col(color);
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 1) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
};

/** Faceted rock: icosahedron jittered by position-hash so shared corners stay welded. */
export const rock = (detail: number, squash: number, seed: number) => {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i += 1) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const k = 0.75 + noise2(x * 2.1 + seed, z * 2.1 + y * 1.7) * 0.5;
    p.setXYZ(i, x * k, Math.max(y * k * squash, -0.15), z * k);
  }
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return paint(g, '#ffffff');
};

/** Hex-packed basalt columns. */
export const basaltCluster = () => {
  const m = mesher();
  const white = new THREE.Color('#ffffff');
  const grey = new THREE.Color('#e8e8e8');
  const rnd = mulberry(77);
  const cells: Array<[number, number]> = [[0, 0]];
  for (let i = 0; i < 6; i += 1) cells.push([Math.cos((i / 6) * Math.PI * 2) * 0.54, Math.sin((i / 6) * Math.PI * 2) * 0.54]);
  for (let i = 0; i < 5; i += 1) cells.push([Math.cos((i / 6) * Math.PI * 2 + 0.52) * 0.94, Math.sin((i / 6) * Math.PI * 2 + 0.52) * 0.94]);
  cells.forEach(([cx, cz], i) => {
    const d = Math.hypot(cx, cz);
    const h = Math.max(0.12, 0.75 - d * 0.5 + (rnd() - 0.5) * 0.35);
    const tx = (rnd() - 0.5) * 0.12 * h;
    const tz = (rnd() - 0.5) * 0.12 * h;
    tube(m, [[cx, -0.4, cz], [cx + tx, h, cz + tz], [cx + tx, h, cz + tz]], (t) => (t >= 1 ? 0.002 : 0.28), 6, () => ({
      c: i % 2 ? grey : white,
    }));
  });
  return m.build();
};
