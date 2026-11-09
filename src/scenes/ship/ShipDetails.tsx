import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { useAppStore } from '@/state/useAppStore';
import { planets } from '@/data/content';
import { dustMaterial, linerMaterial, lightsMaterial } from './materials';
import { FRAME_DEPTH, HOLE, offsetPoly } from './shape';

/*
 * The working life of the deck. Whoever lives here builds things and flies
 * between them, so the bench came along: a half-finished board on standoffs, a
 * tool tray, a mug, spare cable, a logbook with the route card tucked in it
 * (one waypoint per planet), hand-run conduit along the ceiling, and old-style
 * gauges kept because they can be repaired.
 *
 * Everything is one merged lit mesh, one merged unlit mesh for lamps and
 * needles, one ruled strip lining the window cut and one point cloud of dust.
 * All motion is in the vertex shaders, driven by a single clock.
 *
 * Frame units stretch with the aspect ratio, so parts are authored around an
 * anchor and the vertex shaders refit them about it (uFit): a mug stays round
 * on any screen while its position still tracks the window.
 */

const noRaycast = () => null;

type V3 = [number, number, number];

/** Top face of the dash slab at depth z (see the dash mesh in Cockpit) */
const dashY = (z: number) => -0.3915 + (z + 0.44) * 0.2656;
const DASH_TILT = -Math.atan2(0.085, 0.32);
/** The wall's face */
const WALL_Z = -FRAME_DEPTH + 0.002;

const C = {
  steel: '#4a515d',
  steelDark: '#343a45',
  black: '#14171d',
  rubber: '#1b1e24',
  brass: '#5c4d37',
  board: '#1d3a30',
  chip: '#101216',
  cableA: '#3f4654',
  cableB: '#5b4a33',
  cableC: '#2c3a4d',
  paper: '#4c483d',
  ink: '#2b2a26',
  mug: '#47505e',
  book: '#2f3641',
} as const;

const INK: V3 = [0.42, 0.8, 1.0];
const AMBER: V3 = [1.0, 0.68, 0.36];
const MINT: V3 = [0.45, 1.0, 0.7];

const _col = new THREE.Color();
const _rot = new THREE.Matrix4();
const _euler = new THREE.Euler();

/** Collects lit parts into one geometry; each part remembers the anchor it refits about. */
class Kit {
  private geos: THREE.BufferGeometry[] = [];
  private frame = new THREE.Matrix4();
  private anchor = new THREE.Vector3();
  /** Sway of what follows, per unit of distance below the anchor */
  sway = 0;

  at(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
    this.anchor.set(x, y, z);
    _euler.set(rx, ry, rz);
    this.frame.makeRotationFromEuler(_euler).setPosition(x, y, z);
    this.sway = 0;
    return this;
  }

  private stamp(g: THREE.BufferGeometry, color: string, anchors?: Float32Array) {
    const n = g.getAttribute('position').count;
    _col.set(color);
    const cols = new Float32Array(n * 3);
    const anch = anchors ?? new Float32Array(n * 3);
    const sway = new Float32Array(n).fill(this.sway);
    for (let i = 0; i < n; i += 1) {
      cols.set([_col.r, _col.g, _col.b], i * 3);
      if (!anchors) anch.set([this.anchor.x, this.anchor.y, this.anchor.z], i * 3);
    }
    g.deleteAttribute('uv');
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    g.setAttribute('aAnchor', new THREE.BufferAttribute(anch, 3));
    g.setAttribute('aSway', new THREE.BufferAttribute(sway, 1));
    this.geos.push(g);
  }

  private place(g: THREE.BufferGeometry, p: V3, color: string, r?: V3) {
    if (r) g.applyMatrix4(_rot.makeRotationFromEuler(_euler.set(r[0], r[1], r[2])));
    g.translate(p[0], p[1], p[2]);
    g.applyMatrix4(this.frame);
    this.stamp(g, color);
  }

  box(w: number, h: number, d: number, p: V3, color: string, r?: V3) {
    this.place(new THREE.BoxGeometry(w, h, d), p, color, r);
  }

  /** A cylinder along y */
  cyl(rad: number, h: number, p: V3, color: string, r?: V3, segs = 8, radTop = rad) {
    this.place(new THREE.CylinderGeometry(radTop, rad, h, segs), p, color, r);
  }

  torus(rad: number, tube: number, p: V3, color: string, r?: V3, arc = Math.PI * 2) {
    this.place(new THREE.TorusGeometry(rad, tube, 5, 14, arc), p, color, r);
  }

  /** A cable through points given in frame units; its section refits about its own centre line. */
  cable(pts: V3[], rad: number, color: string, tension = 0.5) {
    const curve = new THREE.CatmullRomCurve3(
      pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])),
      false,
      'catmullrom',
      tension,
    );
    const segs = Math.max(6, (pts.length - 1) * 7);
    const radial = 5;
    const g = new THREE.TubeGeometry(curve, segs, rad, radial, false);
    const n = g.getAttribute('position').count;
    const anch = new Float32Array(n * 3);
    const c = new THREE.Vector3();
    for (let i = 0; i <= segs; i += 1) {
      curve.getPointAt(i / segs, c);
      for (let j = 0; j <= radial; j += 1) anch.set([c.x, c.y, c.z], (i * (radial + 1) + j) * 3);
    }
    this.stamp(g, color, anch);
  }

  build() {
    const merged = mergeGeometries(this.geos, false)!;
    for (const g of this.geos) g.dispose();
    return merged;
  }
}

/** Collects lamps, dial marks and needles into one unlit geometry of quads. */
class Lamps {
  private pos: number[] = [];
  private anchor: number[] = [];
  private color: number[] = [];
  private rhythm: number[] = [];
  private mode: number[] = [];
  private uv: number[] = [];
  private frame = new THREE.Matrix4();
  private origin = new THREE.Vector3();
  private v = new THREE.Vector3();

  at(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
    this.origin.set(x, y, z);
    _euler.set(rx, ry, rz);
    this.frame.makeRotationFromEuler(_euler).setPosition(x, y, z);
    return this;
  }

  private quad(cx: number, cy: number, z: number, hx: number, hy: number, col: V3, rhythm: V3, mode: number, ang = 0, pivot = false) {
    const co = Math.cos(ang);
    const si = Math.sin(ang);
    for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]]) {
      const lx = (u * 2 - 1) * hx;
      const ly = pivot ? v * hy * 2 : (v * 2 - 1) * hy;
      this.v.set(cx + lx * co - ly * si, cy + lx * si + ly * co, z).applyMatrix4(this.frame);
      this.pos.push(this.v.x, this.v.y, this.v.z);
      // each mark refits about its own centre so a dial keeps its layout
      this.v.set(cx, cy, z).applyMatrix4(this.frame);
      this.anchor.push(this.v.x, this.v.y, this.v.z);
      this.color.push(col[0], col[1], col[2]);
      this.rhythm.push(rhythm[0], rhythm[1], rhythm[2]);
      this.mode.push(mode);
      this.uv.push(u, v);
    }
  }

  /** A status light. `period` in seconds; `duty` is the lit fraction of it. */
  lamp(x: number, y: number, r: number, col: V3, period: number, phase: number, duty: number, z = 0.0012) {
    this.quad(x, y, z, r, r, col, [period, phase, duty], 0);
  }

  /** A fixed mark on a dial or a card */
  mark(x: number, y: number, hx: number, hy: number, col: V3, level: number, ang = 0, z = 0.0012) {
    this.quad(x, y, z, hx, hy, col, [level, 0, 0], 3, ang);
  }

  /** A needle standing up from its pivot, wandering by `amp` radians over minutes */
  needle(x: number, y: number, len: number, col: V3, amp: number, phase: number, z = 0.0022) {
    this.quad(x, y, z, 0.0009, len / 2, col, [amp, phase, 0], 1, 0, true);
  }

  /** A small round scope with a slow sweep */
  scope(x: number, y: number, r: number, col: V3, phase: number, z = 0.0012) {
    this.quad(x, y, z, r, r, col, [0, phase, 0], 2);
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('aAnchor', new THREE.Float32BufferAttribute(this.anchor, 3));
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(this.color, 3));
    g.setAttribute('aRhythm', new THREE.Float32BufferAttribute(this.rhythm, 3));
    g.setAttribute('aMode', new THREE.Float32BufferAttribute(this.mode, 1));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    return g;
  }
}

/* ---------- what is on the deck ---------- */

/** Conduit hand-run along the ceiling, with clamps, a tap box and a tag on a cord. */
const buildCeiling = (k: Kit, l: Lamps) => {
  const y = 0.566;
  const z = WALL_Z + 0.007;
  const span = 0.7;
  k.cable([[-span, y, z], [0, y, z], [span, y, z]], 0.0052, C.steelDark);
  // a thinner line added later, sagging between its clips
  const sag: V3[] = [];
  for (let x = -span; x <= span + 1e-6; x += 0.14) {
    sag.push([x, y - 0.0145, z - 0.002], [x + 0.07, y - 0.0205, z - 0.001]);
  }
  k.cable(sag, 0.0021, C.cableB, 0.3);
  k.cable([[-span, y + 0.0125, z - 0.003], [0.08, y + 0.0125, z - 0.003], [span, y + 0.0125, z - 0.003]], 0.0026, C.cableC);
  for (let x = -0.63; x <= 0.63; x += 0.14) {
    k.at(x, y, z);
    k.box(0.0125, 0.03, 0.0034, [0, -0.003, 0.0052], C.steel);
    k.cyl(0.0022, 0.002, [0, 0.0085, 0.0073], C.brass, [Math.PI / 2, 0, 0], 6);
    k.cyl(0.0022, 0.002, [0, -0.0145, 0.0073], C.brass, [Math.PI / 2, 0, 0], 6);
  }
  // tap box where the added line joins
  k.at(0.216, y - 0.002, z);
  k.box(0.048, 0.036, 0.012, [0, 0, 0.003], C.steelDark);
  k.box(0.042, 0.03, 0.002, [0, 0, 0.0098], C.black);
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    k.cyl(0.0016, 0.0016, [sx * 0.019, sy * 0.012, 0.0106], C.steel, [Math.PI / 2, 0, 0], 6);
  }
  l.at(0.216, y - 0.002, z + 0.0115);
  l.lamp(-0.012, 0.004, 0.0016, INK, 23, 0.1, 0.72);
  l.lamp(-0.004, 0.004, 0.0016, AMBER, 37, 0.6, 0.18);
  // an inspection tag on a cord, moved a little by the air handling
  k.at(-0.238, y - 0.02, z + 0.004);
  k.sway = 0.06;
  k.cable([[-0.238, y - 0.02, z + 0.004], [-0.238, y - 0.05, z + 0.005]], 0.0007, C.cableB);
  k.box(0.012, 0.022, 0.0009, [0, -0.04, 0.001], C.paper);
  k.box(0.0085, 0.0013, 0.0004, [0, -0.034, 0.0017], C.ink);
  k.box(0.0085, 0.0013, 0.0004, [0, -0.0385, 0.0017], C.ink);
  k.sway = 0;
};

/** Left of the console: gauge pod, mug, spare cable and the lead between them. */
const buildPort = (k: Kit, l: Lamps) => {
  // a repairable instrument pod standing on the dash
  const pz = -0.578;
  const px = -0.445;
  const py = dashY(pz);
  k.at(px, py, pz, -0.14, 0.22);
  k.box(0.1, 0.066, 0.02, [0, 0.033, 0], C.steelDark);
  k.box(0.094, 0.06, 0.002, [0, 0.033, 0.0105], C.black);
  for (const sx of [-1, 1]) {
    k.box(0.004, 0.012, 0.03, [sx * 0.042, 0.004, 0.002], C.steel);
    k.cyl(0.002, 0.002, [sx * 0.044, 0.059, 0.0118], C.brass, [Math.PI / 2, 0, 0], 6);
    k.cyl(0.002, 0.002, [sx * 0.044, 0.007, 0.0118], C.brass, [Math.PI / 2, 0, 0], 6);
  }
  const f = 0.0115;
  const dials: [number, number, number, number][] = [
    [-0.026, 0.036, 0.8, 0.2],
    [0.012, 0.036, 0.55, 0.57],
  ];
  l.at(px, py, pz, -0.14, 0.22);
  for (const [dx, dy, amp, phase] of dials) {
    k.torus(0.0145, 0.0018, [dx, dy, f + 0.001], C.steel);
    for (let a = -2.2; a <= 2.2001; a += 0.44) {
      const major = Math.round(a / 0.44) % 2 === 0;
      const ang = a + Math.PI / 2;
      l.mark(dx + Math.cos(ang) * 0.0115, dy + Math.sin(ang) * 0.0115, 0.0004, major ? 0.0017 : 0.0011, INK, major ? 0.32 : 0.18, a, f + 0.0003);
    }
    l.needle(dx, dy, 0.0105, AMBER, amp, phase, f + 0.001);
    k.cyl(0.0016, 0.0014, [dx, dy, f + 0.0022], C.brass, [Math.PI / 2, 0, 0], 6);
  }
  // the little scope, and a row of lamps that keep their own time
  k.torus(0.0098, 0.0014, [0.036 + 0.0, 0.046 - 0.012 + 0.002, f + 0.0008], C.steel);
  l.scope(0.036, 0.036, 0.0088, INK, 0.3, f);
  const row: [V3, number, number, number][] = [
    [INK, 19, 0.0, 0.8],
    [MINT, 31, 0.3, 0.62],
    [AMBER, 47, 0.55, 0.1],
    [INK, 13, 0.8, 0.4],
    [MINT, 53, 0.15, 0.9],
  ];
  row.forEach(([col, period, phase, duty], i) => l.lamp(-0.03 + i * 0.0098, 0.0125, 0.00135, col, period, phase, duty, f + 0.0003));

  // the mug, on its magnetic pad, lid on against the lack of a floor
  const mz = -0.512;
  const mx = -0.456;
  const my = dashY(mz);
  k.at(mx, my, mz, DASH_TILT * 0.9);
  k.cyl(0.024, 0.0026, [0, 0.0013, 0], C.steelDark, undefined, 12);
  k.cyl(0.0172, 0.04, [0, 0.0226, 0], C.mug, undefined, 12);
  k.cyl(0.0182, 0.0055, [0, 0.0442, 0], C.rubber, undefined, 12);
  k.cyl(0.0176, 0.003, [0, 0.0092, 0], C.steel, undefined, 12);
  k.torus(0.0105, 0.0024, [0.0185, 0.0235, 0], C.steelDark, [0, 0, -Math.PI / 2], Math.PI);

  // spare cable, coiled and strapped
  const cz = -0.451;
  const cx = -0.386;
  const cy = dashY(cz);
  k.at(cx, cy, cz, DASH_TILT + Math.PI / 2);
  for (let i = 0; i < 3; i += 1) k.torus(0.0225 - i * 0.0009, 0.0027, [i * 0.0012, -0.0006 * i, -0.0026 - i * 0.0048], i === 1 ? C.cableB : C.cableA);
  k.at(cx, cy, cz, DASH_TILT);
  k.box(0.012, 0.0162, 0.0062, [0.0, 0.0079, 0.0225], C.rubber);
  k.cable(
    [
      [cx - 0.021, cy + 0.003, cz + 0.009],
      [cx - 0.043, dashY(cz - 0.012) + 0.0035, cz - 0.012],
      [px + 0.02, dashY(pz + 0.036) + 0.003, pz + 0.036],
      [px + 0.02, py + 0.006, pz + 0.012],
    ],
    0.0016,
    C.cableA,
  );
};

/** Right of the console: the board being built, the tool tray, the logbook and route card. */
const buildStarboard = (k: Kit, l: Lamps) => {
  // the logbook, its elastic, a pencil, and the route card sticking out: one waypoint per planet
  const bz = -0.547;
  const bx = 0.433;
  const by = dashY(bz);
  k.at(bx, by, bz, DASH_TILT, -0.16, 0);
  k.box(0.076, 0.0115, 0.1, [0, 0.0058, 0], C.book);
  k.box(0.0715, 0.0092, 0.0985, [0.0012, 0.0058, 0.0], C.paper);
  k.box(0.076, 0.0015, 0.1, [0, 0.0118, 0], C.book);
  k.box(0.0038, 0.0128, 0.1012, [0.029, 0.0062, 0], C.rubber);
  k.cyl(0.0024, 0.074, [-0.015, 0.0144, 0.006], C.brass, [Math.PI / 2, 0, 0.045], 6);
  k.cyl(0.0024, 0.006, [-0.0166, 0.0144, -0.0345], C.steel, [Math.PI / 2, 0, 0.045], 6);
  k.box(0.058, 0.0007, 0.064, [-0.002, 0.013, 0.074], C.paper, [0, 0.08, 0]);
  l.at(bx, by, bz, DASH_TILT - Math.PI / 2, 0, 0.16);
  const n = Math.max(1, planets.length);
  const route: [number, number][] = [];
  for (let i = 0; i < n; i += 1) {
    const u = n === 1 ? 0.5 : i / (n - 1);
    route.push([-0.024 + u * 0.044, -0.098 + Math.sin(u * 8.4 + 0.7) * 0.014 + u * 0.022]);
  }
  route.forEach(([x, y], i) => {
    l.mark(x, y, 0.0024, 0.0024, [0.17, 0.16, 0.14], 1, 0, -0.0126);
    const next = route[i + 1];
    if (!next) return;
    const dx = next[0] - x;
    const dy = next[1] - y;
    l.mark(x + dx / 2, y + dy / 2, 0.00035, Math.hypot(dx, dy) / 2, [0.17, 0.16, 0.14], 1, Math.atan2(dy, dx) - Math.PI / 2, -0.0126);
  });

  // the tool tray: a spanner and a driver in their cutouts
  const tz = -0.43;
  const tx = 0.383;
  const ty = dashY(tz);
  k.at(tx, ty, tz, DASH_TILT, 0.12, 0);
  k.box(0.07, 0.0034, 0.048, [0, 0.0017, 0], C.steelDark);
  for (const [dx, dz, w, d] of [[0, -0.022, 0.07, 0.003], [0, 0.022, 0.07, 0.003], [-0.0335, 0, 0.003, 0.046], [0.0335, 0, 0.003, 0.046]] as const) {
    k.box(w, 0.0062, d, [dx, 0.0031, dz], C.steel);
  }
  k.box(0.048, 0.0024, 0.0064, [-0.002, 0.0048, -0.0105], C.steel);
  k.torus(0.0058, 0.0022, [0.0235, 0.0048, -0.0105], C.steel, [Math.PI / 2, 0, 0], Math.PI * 1.55);
  k.cyl(0.0041, 0.03, [0.008, 0.0066, 0.0105], C.rubber, [0, 0, Math.PI / 2], 6);
  k.cyl(0.0014, 0.03, [-0.018, 0.0066, 0.0105], C.steel, [0, 0, Math.PI / 2], 6);

  // the board in progress, up on standoffs, with hand-run jumpers
  const pz = -0.494;
  const px = 0.379;
  const py = dashY(pz) + 0.006;
  k.at(px, py, pz, DASH_TILT, -0.1, 0);
  k.box(0.058, 0.0022, 0.038, [0, 0, 0], C.board);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    k.cyl(0.0022, 0.0062, [sx * 0.025, -0.0034, sz * 0.015], C.brass, undefined, 6);
  }
  const chips: [number, number, number, number][] = [
    [-0.014, -0.004, 0.0172, 0.0172],
    [0.012, -0.009, 0.0096, 0.0072],
    [0.0185, 0.0075, 0.0072, 0.0126],
    [-0.0025, 0.0118, 0.0102, 0.0054],
  ];
  for (const [x, z, w, d] of chips) k.box(w, 0.0024, d, [x, 0.0022, z], C.chip);
  for (let i = -3; i <= 3; i += 1) {
    k.box(0.0032, 0.0004, 0.0009, [0.0162 + Math.abs(i) * 0.0002, 0.0014, i * 0.0041 + 0.0], C.brass);
  }
  k.box(0.042, 0.0003, 0.0007, [-0.004, 0.0013, 0.0173], C.brass);
  k.box(0.0007, 0.0003, 0.026, [0.0268, 0.0013, 0.002], C.brass);
  k.cable(
    [
      [px - 0.012, py + 0.004, pz - 0.0005],
      [px - 0.002, py + 0.016, pz + 0.006],
      [px + 0.014, py + 0.004, pz + 0.0095],
    ],
    0.0008,
    C.cableB,
  );
  k.cable(
    [
      [px + 0.018, py + 0.004, pz - 0.006],
      [px + 0.033, dashY(pz + 0.013) + 0.0045, pz + 0.013],
      [px + 0.062, dashY(pz + 0.046) + 0.003, pz + 0.046],
      [px + 0.136, dashY(pz + 0.048) + 0.003, pz + 0.048],
    ],
    0.0011,
    C.cableA,
  );
  l.at(px, py, pz, DASH_TILT - Math.PI / 2);
  l.lamp(0.0225, -0.0125, 0.00105, AMBER, 41, 0.35, 0.32, -0.0013);
  l.lamp(0.0192, -0.0125, 0.00105, MINT, 29, 0.7, 0.75, -0.0013);
};

/** Below the console: a row of guarded toggles, set the way they were last left. */
const buildToggles = (k: Kit, l: Lamps) => {
  const z = -0.429;
  const y = dashY(z);
  // base plate
  k.at(0, y, z, DASH_TILT);
  k.box(0.256, 0.0026, 0.034, [0, 0.0013, 0], C.steelDark);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) k.cyl(0.0021, 0.0014, [sx * 0.122, 0.003, sz * 0.012], C.steel, undefined, 6);
  }
  const down = new Set([1, 2, 5, 7]);
  for (let i = 0; i < 9; i += 1) {
    const x = -0.096 + i * 0.024;
    k.at(x, y, z, DASH_TILT);
    k.cyl(0.0044, 0.0024, [0, 0.0034, 0], C.black, undefined, 8);
    k.cyl(0.0013, 0.013, [0, 0.0084, 0], C.steel, [down.has(i) ? 0.5 : -0.5, 0, 0], 6);
    if (i === 3 || i === 7) {
      // guards on the two that must not get bumped
      for (const s of [-1, 1]) k.box(0.0012, 0.009, 0.014, [s * 0.0064, 0.0068, 0], C.brass);
      k.box(0.0134, 0.0012, 0.014, [0, 0.0116, 0], C.brass);
    }
    l.at(x, y, z, DASH_TILT - Math.PI / 2);
    l.lamp(0, 0.0098, 0.00095, i % 3 === 0 ? MINT : INK, 17 + i * 6.3, i * 0.37, down.has(i) ? 0.05 : 0.85, -0.0028);
  }
};

/** The strip lining the window cut, from just behind the frame ring to the outer glass. */
const linerGeometry = () => {
  const front = offsetPoly(HOLE, 0.0015);
  const back = offsetPoly(HOLE, 0.006);
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let u = 0;
  const n = front.length;
  for (let i = 0; i <= n; i += 1) {
    const a = front[i % n];
    const b = back[i % n];
    pos.push(a[0], a[1], -FRAME_DEPTH + 0.002, b[0], b[1], -FRAME_DEPTH - 0.072);
    uv.push(u, 0, u, 1);
    const c = front[(i + 1) % n];
    u += Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (i < n) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
};

/** Seeds for the dust; positions are worked out in the vertex shader. */
const dustGeometry = (count: number) => {
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    pos.set([Math.random(), Math.random(), Math.random()], i * 3);
    seed[i] = Math.random();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  // the shader moves the points about, so bounds would be meaningless
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 10);
  return g;
};

const useDetailParts = () =>
  useMemo(() => {
    const kit = new Kit();
    const lamps = new Lamps();
    buildCeiling(kit, lamps);
    buildPort(kit, lamps);
    buildStarboard(kit, lamps);
    buildToggles(kit, lamps);
    const kitGeo = kit.build();
    const lampGeo = lamps.build();
    const linerGeo = linerGeometry();
    const dustGeo = dustGeometry(54);

    // one set of shared uniforms: nothing here needs its own clock
    const uTime = { value: 0 };
    const uFit = { value: new THREE.Vector2(1, 1) };

    const kitMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      metalness: 0.42,
      roughness: 0.58,
      fog: false,
      transparent: true,
      opacity: 1,
    });
    kitMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uTime;
      shader.uniforms.uFit = uFit;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          attribute vec3 aAnchor;
          attribute float aSway;
          uniform float uTime;
          uniform vec2 uFit;`,
        )
        .replace(
          '#include <begin_vertex>',
          `vec3 q = position - aAnchor;
          vec3 transformed = aAnchor + q * vec3(uFit, 1.0);
          transformed.x += aSway * q.y * (sin(uTime * 0.53 + aAnchor.x * 40.0) + 0.4 * sin(uTime * 0.91));`,
        );
    };
    kitMat.customProgramCacheKey = () => 'ship-kit-v1';

    const lampMat = lightsMaterial(uTime, uFit);
    const linerMat = linerMaterial(uTime);
    const dustMat = dustMaterial(uTime);
    return { kitGeo, lampGeo, linerGeo, dustGeo, kitMat, lampMat, linerMat, dustMat, uTime, uFit };
  }, []);

const ShipDetails = () => {
  const parts = useDetailParts();
  const size = useThree((s) => s.size);
  const lastAspect = useRef(0);

  useEffect(
    () => () => {
      for (const g of [parts.kitGeo, parts.lampGeo, parts.linerGeo, parts.dustGeo]) g.dispose();
      for (const m of [parts.kitMat, parts.lampMat, parts.linerMat, parts.dustMat]) m.dispose();
    },
    [parts],
  );

  useFrame(({ clock }) => {
    const aspect = size.width / Math.max(1, size.height);
    if (aspect !== lastAspect.current) {
      lastAspect.current = aspect;
      // one authored unit spans the same pixels on x and y, sized by the shorter side
      parts.uFit.value.set(Math.min(1, 1 / aspect), Math.min(1, aspect));
    }
    // reduced motion: lamps hold, needles rest, the dust hangs still
    if (!useAppStore.getState().reducedMotion) parts.uTime.value = clock.elapsedTime;
  });

  return (
    <>
      <mesh geometry={parts.linerGeo} material={parts.linerMat} raycast={noRaycast} renderOrder={30} frustumCulled={false} />
      <mesh geometry={parts.kitGeo} material={parts.kitMat} raycast={noRaycast} renderOrder={31} frustumCulled={false} />
      <mesh geometry={parts.lampGeo} material={parts.lampMat} raycast={noRaycast} renderOrder={32} frustumCulled={false} />
      <points geometry={parts.dustGeo} material={parts.dustMat} raycast={noRaycast} renderOrder={33} frustumCulled={false} />
    </>
  );
};

export default ShipDetails;
