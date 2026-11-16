import * as THREE from 'three';
import type { Planet } from '@/types/content';
import type { HeightFn } from '../Terrain';
import { CAMP_FIRE, MAST, PAD, SOLAR, campPoint } from './site';
import { Decals, Dress, seeded, tone, type V3 } from './dress';

/*
 * The base camp's fittings and clutter. Three service lines (from the mast,
 * the array and the pad) cross the ground and meet at the camp, so the eye
 * follows them in; the things people use lie low and off to the sides, with
 * the ground right in front of me left bare.
 */

const WOOD = '#5a3b24';
const BARK = '#3d2716';
const ROCK = '#8d8478';
const SHELL = '#d9d2c6';
const STEEL = '#55524e';
const IRON = '#2c2a2a';
const CANVAS = '#6d604a';
const CANVAS_DARK = '#4a4034';
const PAPER = '#b9ae98';
const SOOT = new THREE.Color('#120c08');
const SHADOW = new THREE.Color('#1c120c');
const AMBER = tone('#ffb35c', 0.75);
const GREEN = tone('#7fd6a0', 0.5);

const Y_AXIS = new THREE.Vector3(0, 1, 0);

export const buildOutpost = (planet: Planet, ground: HeightFn, top: number) => {
  const cast = new Dress();
  const flat = new Dress();
  const solar = new Dress();
  const lamp = new Dress();
  const stain = new Decals();
  const rand = seeded(902);

  const o = campPoint(planet, 0, 0);
  const ex = campPoint(planet, 1, 0);
  const campYaw = Math.atan2(-(ex[1] - o[1]), ex[0] - o[0]);
  const campY = ground(o[0], o[1]);

  /** Sets flat (and the stains) to stand on the ground at a point in the camp's frame. */
  const at = (lx: number, lz: number, yaw = 0, lift = 0) => {
    const [x, z] = campPoint(planet, lx, lz);
    const y = ground(x, z) + lift;
    flat.frame(x, y, z, campYaw + yaw);
    stain.frame(x, y, z, campYaw + yaw);
  };
  const under = (rx: number, rz: number, alpha = 0.42) => stain.floor(0, 0.012, 0, rx, rz, SHADOW, alpha);

  /* ---------- the landing pad: plate seams, rivets, scorch ---------- */
  flat.frame(PAD.x, top, PAD.z);
  stain.frame(PAD.x, top, PAD.z);
  const weldL = tone('#6e675d');
  const weldD = tone('#3a3632');
  const rivet = tone(IRON, 1.3);
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2;
    const [sa, ca] = [Math.sin(a), Math.cos(a)];
    flat.weld(sa * PAD.r * 0.63, ca * PAD.r * 0.63, sa * (PAD.r - 0.32), ca * (PAD.r - 0.32), 0.008, 0.035, weldL, weldD, 12);
    const b = ((i + 1) / 6) * Math.PI * 2;
    const R = PAD.r - 0.1;
    for (let k = 1; k <= 7; k += 1) {
      const t = k / 8;
      flat.dot(Math.sin(a) * R * (1 - t) + Math.sin(b) * R * t, 0.007, Math.cos(a) * R * (1 - t) + Math.cos(b) * R * t, 0.014, rivet);
    }
    // a bracket bolted to the pad's side at each corner
    const sideR = PAD.r + 0.02;
    flat.box(0.09, 0.28, 0.05, [sa * sideR, -0.2, ca * sideR], tone(ROCK, 0.7), [0, a, 0]);
    for (const dy of [-0.09, 0.09]) flat.box(0.022, 0.022, 0.015, [sa * (sideR + 0.03), -0.2 + dy, ca * (sideR + 0.03)], tone(STEEL), [0, a, 0]);
  }
  stain.floor(0, 0.01, 0, 0.95, 0.95, SOOT, 0.32, 0.14, 5);

  /* ---------- service lines ---------- */
  const conduit = tone('#4d4a45');
  const strap = tone(STEEL, 0.85);
  const route = (pts: [number, number][], r: number, c: THREE.Color) => {
    flat.frame(0, 0, 0);
    const y = (x: number, z: number) => ground(x, z) + r + 0.02;
    let prev: V3 | null = null;
    let run = 0;
    for (let s = 0; s < pts.length - 1; s += 1) {
      const [ax, az] = pts[s];
      const [bx, bz] = pts[s + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.round(len / 0.6));
      const nx = -(bz - az) / (len || 1);
      const nz = (bx - ax) / (len || 1);
      for (let i = s === 0 ? 0 : 1; i <= n; i += 1) {
        const t = i / n;
        // a gentle sag side to side, so it was laid by hand
        const w = Math.sin(t * Math.PI) * Math.sin(t * 7 + s * 2 + ax) * 0.08;
        const x = ax + (bx - ax) * t + nx * w;
        const z = az + (bz - az) * t + nz * w;
        const p: V3 = [x, y(x, z), z];
        if (prev) flat.rod(prev, p, r, c, 5);
        run += 1;
        if (prev && run % 7 === 0) {
          const yaw = Math.atan2(p[0] - prev[0], p[2] - prev[2]);
          flat.box(0.075, 0.03, 0.06, [x, p[1], z], strap, [0, yaw, 0]);
        }
        prev = p;
      }
    }
  };
  const junction = campPoint(planet, -1.9, -1.35);
  const reel = campPoint(planet, 2.1, -1.15);
  route([[MAST.x + 0.55, MAST.z + 0.2], [MAST.x + 3, MAST.z + 2.5], [junction[0] - 0.06, junction[1]]], 0.024, conduit);
  route([[SOLAR.x - 1.1, SOLAR.z + 0.7], [SOLAR.x - 4, SOLAR.z + 3], [reel[0] + 0.1, reel[1] - 0.05]], 0.022, conduit);
  route([[PAD.x - PAD.r * 0.83, PAD.z - PAD.r * 0.5], [PAD.x - 2.4, PAD.z - 3], [junction[0] + 0.05, junction[1] + 0.08]], 0.03, tone('#6a6256'));

  // where the pad's line leaves it, a small coupling box
  flat.frame(PAD.x - PAD.r * 0.86, ground(PAD.x - PAD.r * 0.86, PAD.z - PAD.r * 0.5), PAD.z - PAD.r * 0.5, 0.5);
  flat.box(0.18, 0.13, 0.12, [0, 0.07, 0], tone(ROCK, 0.75));
  flat.box(0.1, 0.012, 0.085, [0, 0.14, 0], tone(STEEL));

  /* ---------- the junction at the camp, where the lines meet ---------- */
  at(-1.9, -1.35, 0.18);
  under(0.3, 0.24);
  flat.box(0.28, 0.32, 0.17, [0, 0.16, 0], tone(ROCK, 0.68));
  flat.box(0.24, 0.27, 0.01, [0, 0.165, 0.09], tone(ROCK, 0.5));
  flat.box(0.25, 0.012, 0.19, [0, 0.33, 0], tone(STEEL, 1.1));
  lamp.origin.copy(flat.origin);
  lamp.lens(-0.07, 0.27, 0.096, 0.009, GREEN);
  lamp.lens(-0.035, 0.27, 0.096, 0.009, AMBER);

  /* ---------- the camp, low and to the sides ---------- */
  const iron = tone(IRON);
  const steel = tone(STEEL);
  const wood = tone(WOOD);
  const bark = tone(BARK);
  const canvas = tone(CANVAS);
  const canvasD = tone(CANVAS_DARK);

  // on the log at my left: two notebooks and a pencil, covers blank
  const nby = campY + 0.4;
  const [nx, nz] = campPoint(planet, -0.62, -0.03);
  flat.frame(nx, nby, nz, campYaw + 0.22);
  flat.box(0.16, 0.022, 0.21, [0, 0.011, 0], tone('#2f3a4a'));
  flat.box(0.15, 0.018, 0.2, [0.003, 0.013, 0], tone(PAPER));
  flat.frame(nx, nby + 0.024, nz, campYaw - 0.1);
  flat.box(0.15, 0.024, 0.2, [0, 0.012, 0], tone('#6e3a2a'));
  flat.box(0.14, 0.02, 0.19, [0.003, 0.014, 0], tone(PAPER, 0.94));
  flat.box(0.012, 0.026, 0.202, [0.056, 0.012, 0], iron);
  flat.rod([-0.05, 0.03, -0.08], [0.04, 0.03, 0.07], 0.005, tone('#a8873a'), 5);

  // the kettle on a small trivet at the fire's edge, sooted
  const [cfx, cfz] = CAMP_FIRE;
  at(cfx - 0.5, cfz - 0.4, 0.5);
  under(0.2, 0.2, 0.5);
  stain.floor(0, 0.013, 0, 0.3, 0.3, SOOT, 0.42, 0.15, 1);
  for (let i = 0; i < 3; i += 1) {
    const a = (i / 3) * Math.PI * 2;
    flat.rod([Math.cos(a) * 0.13, 0, Math.sin(a) * 0.13], [Math.cos(a) * 0.09, 0.13, Math.sin(a) * 0.09], 0.008, iron, 4);
  }
  flat.torus(0.1, 0.008, [0, 0.13, 0], iron);
  flat.lathe(
    [
      [0, 0.135],
      [0.1, 0.135],
      [0.135, 0.17],
      [0.13, 0.22],
      [0.085, 0.262],
      [0.04, 0.27],
      [0, 0.27],
    ],
    [0, 0, 0],
    tone('#3a3431'),
    10,
    (_x, y) => 0.55 + Math.min(1, (y - 0.135) / 0.12) * 0.5,
  );
  flat.cyl(0.018, 0.018, 0.02, [0, 0.28, 0], steel, 6);
  flat.rod([0.12, 0.2, 0], [0.22, 0.26, 0.01], 0.014, tone('#3a3431'), 5);
  flat.torus(0.1, 0.007, [0, 0.285, 0], steel, [0, 0, 0], Math.PI, 8);

  // an enamel mug in reach of the log
  at(0.72, 0.42, 1.2);
  under(0.07, 0.07);
  flat.cyl(0.04, 0.04, 0.085, [0, 0.043, 0], tone('#a8a196'), 8);
  flat.torus(0.028, 0.006, [0.05, 0.045, 0], tone('#a8a196'), [Math.PI / 2, 0, 0], Math.PI, 6);
  flat.cyl(0.036, 0.036, 0.004, [0, 0.082, 0], tone(BARK, 0.6), 8);

  // a pack, slumped against the end of the log
  at(-1.18, -0.28, -0.35);
  under(0.32, 0.26, 0.5);
  flat.box(0.32, 0.42, 0.22, [0, 0.21, 0], canvas, [-0.12, 0, 0]);
  flat.box(0.25, 0.16, 0.05, [0, 0.15, 0.13], canvasD, [-0.12, 0, 0]);
  flat.box(0.27, 0.08, 0.2, [0, 0.44, -0.01], canvasD, [-0.08, 0, 0]);
  for (const s of [-1, 1]) flat.rod([s * 0.09, 0.42, 0.11], [s * 0.1, 0.05, 0.13], 0.012, iron, 4);

  // a roll of tools laid open on the ground
  at(-1.62, 0.42, 0.5);
  under(0.42, 0.22);
  flat.box(0.56, 0.012, 0.3, [0, 0.008, 0], canvasD);
  flat.rod([-0.26, 0.018, -0.16], [-0.26, 0.018, 0.16], 0.022, canvas, 6);
  // spanner, screwdriver, pliers
  flat.box(0.022, 0.012, 0.2, [-0.12, 0.022, 0], steel);
  flat.torus(0.024, 0.009, [-0.12, 0.022, 0.11], steel, [Math.PI / 2, 0, 0], Math.PI * 1.5, 7);
  flat.rod([0.0, 0.025, -0.1], [0.0, 0.025, 0.04], 0.018, tone('#6e3a2a'), 6);
  flat.rod([0.0, 0.025, 0.04], [0.0, 0.025, 0.14], 0.005, steel, 4);
  flat.rod([0.12, 0.025, -0.1], [0.145, 0.025, 0.06], 0.008, steel, 4);
  flat.rod([0.17, 0.025, -0.1], [0.145, 0.025, 0.06], 0.008, steel, 4);
  flat.box(0.05, 0.012, 0.05, [0.145, 0.025, 0.09], steel);

  // a crate, behind the pack, with a coil and a dark lantern on it
  at(-2.45, -0.5, 0.3);
  under(0.5, 0.42, 0.55);
  for (let i = 0; i < 4; i += 1) {
    const y = 0.06 + i * 0.105;
    flat.box(0.7, 0.085, 0.5, [0, y, 0], tone(WOOD, 0.85 + rand() * 0.35));
  }
  for (const [px, pz] of [
    [-0.34, -0.24],
    [0.34, -0.24],
    [-0.34, 0.24],
    [0.34, 0.24],
  ])
    flat.box(0.05, 0.42, 0.05, [px, 0.22, pz], tone(WOOD, 0.6));
  flat.box(0.68, 0.015, 0.48, [0, 0.43, 0], tone(WOOD, 0.7));
  // coil of cable
  for (let i = 0; i < 3; i += 1) flat.torus(0.12 + i * 0.012, 0.012, [0.14, 0.45 + i * 0.016, -0.04], tone('#2f2b28', 0.9 + i * 0.12));
  // lantern: glass unlit
  flat.cyl(0.05, 0.06, 0.02, [-0.16, 0.45, 0.05], steel, 8);
  flat.cyl(0.042, 0.042, 0.08, [-0.16, 0.5, 0.05], tone('#3c3a36'), 8);
  flat.cyl(0.06, 0.04, 0.025, [-0.16, 0.55, 0.05], steel, 8);
  flat.torus(0.038, 0.004, [-0.16, 0.6, 0.05], steel, [0, 0, 0], Math.PI, 6);

  // a jerry can beside it
  at(-2.75, -1.15, 0.5);
  under(0.25, 0.2);
  flat.box(0.26, 0.38, 0.13, [0, 0.19, 0], tone('#584b35'));
  flat.box(0.13, 0.02, 0.02, [0, 0.4, 0], tone(STEEL));
  flat.cyl(0.018, 0.022, 0.04, [0.08, 0.4, 0], tone(STEEL), 6);

  // a bedroll, strapped
  at(-2.75, 0.58, -0.15);
  under(0.5, 0.2);
  flat.cyl(0.13, 0.13, 0.82, [0, 0.13, 0], tone('#55452f'), 8, [0, 0, Math.PI / 2]);
  for (const x of [-0.24, 0.24]) flat.torus(0.135, 0.008, [x, 0.13, 0], tone(IRON, 0.8), [0, Math.PI / 2, 0], Math.PI * 2, 10);

  // the reel the array's cable comes in on
  at(2.1, -1.15, 0.9);
  under(0.42, 0.42, 0.5);
  flat.cyl(0.36, 0.36, 0.035, [0, 0.36, -0.2], wood, 10, [Math.PI / 2, 0, 0]);
  flat.cyl(0.36, 0.36, 0.035, [0, 0.36, 0.2], wood, 10, [Math.PI / 2, 0, 0]);
  flat.cyl(0.16, 0.16, 0.38, [0, 0.36, 0], tone(WOOD, 0.75), 10, [Math.PI / 2, 0, 0]);
  for (let i = 0; i < 6; i += 1) flat.cyl(0.26, 0.26, 0.055, [0, 0.36, -0.15 + i * 0.06], tone('#34302b', 0.85 + (i % 2) * 0.25), 12, [Math.PI / 2, 0, 0]);

  // stacked firewood past the fire
  at(2.62, 0.05, -0.5);
  under(0.65, 0.4, 0.5);
  const logZ = [-0.22, 0, 0.22];
  for (const z of logZ) flat.cyl(0.085, 0.085, 0.85, [0, 0.085, z], bark, 6, [0, 0, Math.PI / 2], (_x, y) => (y > 0 ? 0.85 : 1));
  for (const z of [-0.11, 0.11]) flat.cyl(0.085, 0.085, 0.8, [0.02, 0.23, z], tone(BARK, 1.2), 6, [0, 0, Math.PI / 2]);
  for (const z of logZ) flat.cyl(0.07, 0.07, 0.86, [0, 0.085, z], tone(WOOD, 1.5), 6, [0, 0, Math.PI / 2]);

  // a chopping block with a hatchet left in it
  at(2.9, 0.95, 1);
  under(0.32, 0.32, 0.5);
  flat.cyl(0.21, 0.24, 0.32, [0, 0.16, 0], bark, 8);
  flat.cyl(0.2, 0.2, 0.012, [0, 0.326, 0], tone(WOOD, 1.45), 8);
  flat.rod([0.05, 0.36, 0], [-0.22, 0.46, 0.05], 0.014, tone(WOOD, 1.2), 5);
  flat.box(0.13, 0.08, 0.02, [0.07, 0.355, 0], steel, [0, 0, -0.35]);

  /* ---------- the fire ring ---------- */
  const [fx, fz] = campPoint(planet, cfx, cfz);
  const fy = ground(fx, fz);
  cast.frame(fx, fy, fz);
  for (let i = 0; i < 4; i += 1) {
    cast.part(new THREE.CylinderGeometry(0.05, 0.06, 0.6, 6), [0, 0.07, 0], tone(WOOD), [0, (i * Math.PI) / 4, Math.PI / 2 - 0.25]);
  }
  flat.frame(fx, fy, fz);
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2;
    flat.lump(0.09, [Math.cos(a) * 0.42, 0.05, Math.sin(a) * 0.42], tone(ROCK, 0.72 + rand() * 0.25), [i, i * 2, 0]);
  }
  stain.frame(fx, fy, fz);
  stain.floor(0, 0.02, 0, 0.55, 0.55, SOOT, 0.7, 0.1, 2);

  /* ---------- the comms mast ---------- */
  const my = ground(MAST.x, MAST.z);
  const legs: [number, number][] = [
    [-0.3, -0.3],
    [0.3, -0.3],
    [0.3, 0.3],
    [-0.3, 0.3],
  ];
  cast.frame(MAST.x, my, MAST.z);
  cast.box(1.0, 0.3, 1.0, [0, 0.15, 0], tone(ROCK));
  const legAt = (l: [number, number], y: number): V3 => {
    const t = (y - 0.3) / 5.9;
    const k = 1 - 0.75 * t;
    return [l[0] * k, y, l[1] * k];
  };
  const legRod = tone(IRON);
  for (const l of legs) cast.rod(legAt(l, 0.3), legAt(l, 6.2), 0.035, legRod, 7);
  cast.part(new THREE.SphereGeometry(0.55, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.32), [0.3, 4.6, 0], tone(SHELL), [0, 0, -0.9]);

  // cross bracing, and a service cabinet with its door seam and lamps
  flat.frame(MAST.x, my, MAST.z);
  const levels = [0.3, 1.55, 2.8, 4.05, 5.3];
  for (let i = 0; i < levels.length - 1; i += 1) {
    for (let f = 0; f < 4; f += 1) {
      const a = legs[f];
      const b = legs[(f + 1) % 4];
      flat.rod(legAt(a, levels[i]), legAt(b, levels[i + 1]), 0.009, legRod, 4);
      flat.rod(legAt(a, levels[i + 1]), legAt(b, levels[i + 1]), 0.012, legRod, 4);
    }
  }
  flat.box(1.02, 0.03, 1.02, [0, 0.31, 0], tone(ROCK, 0.72));
  flat.frame(MAST.x + 0.55, my, MAST.z + 0.1, 0.1);
  flat.box(0.4, 0.62, 0.3, [0, 0.31, 0], tone(ROCK, 0.72));
  flat.box(0.012, 0.56, 0.31, [0.01, 0.31, 0], tone(IRON));
  flat.box(0.36, 0.012, 0.31, [0, 0.47, 0], tone(IRON));
  stain.frame(MAST.x + 0.55, my, MAST.z + 0.1).floor(0, 0.012, 0, 0.4, 0.3, SHADOW, 0.42);
  lamp.frame(MAST.x + 0.55, my, MAST.z + 0.1, 0.1);
  lamp.lens(-0.12, 0.54, 0.152, 0.01, GREEN);
  lamp.lens(-0.08, 0.54, 0.152, 0.01, AMBER);

  /* ---------- the solar array ---------- */
  const sy = ground(SOLAR.x, SOLAR.z);
  const base = new THREE.Matrix4().compose(
    new THREE.Vector3(SOLAR.x, sy, SOLAR.z),
    new THREE.Quaternion().setFromAxisAngle(Y_AXIS, SOLAR.yaw),
    new THREE.Vector3(1, 1, 1),
  );
  const tilt = new THREE.Matrix4();
  const panelFrame = new THREE.Matrix4();
  const frameCol = tone('#6d6c6a');
  const cell = tone('#3a4a66');
  for (const x of [-1.3, 0, 1.3]) {
    cast.origin.copy(base);
    cast.rod([x, 0, 0], [x, 0.9, 0], 0.05, legRod, 7);
    tilt.makeRotationX(-0.75).setPosition(x, 1.0, 0);
    panelFrame.multiplyMatrices(base, tilt);
    solar.origin.copy(panelFrame);
    solar.box(1.15, 0.04, 1.6, [0, 0, 0], tone('#ffffff'));
    flat.origin.copy(panelFrame);
    flat.box(1.2, 0.05, 0.03, [0, 0.005, 0.8], frameCol);
    flat.box(1.2, 0.05, 0.03, [0, 0.005, -0.8], frameCol);
    flat.box(0.03, 0.05, 1.58, [0.59, 0.005, 0], frameCol);
    flat.box(0.03, 0.05, 1.58, [-0.59, 0.005, 0], frameCol);
    for (let i = 1; i < 4; i += 1) flat.strip(-0.56 + (i * 1.12) / 4, -0.78, -0.56 + (i * 1.12) / 4, 0.78, 0.023, 0.01, cell);
    for (let i = 1; i < 6; i += 1) flat.strip(-0.56, -0.78 + (i * 1.56) / 6, 0.56, -0.78 + (i * 1.56) / 6, 0.023, 0.01, cell);
    // the mounting foot and a collector box under the middle panel
    flat.origin.copy(base);
    flat.box(0.26, 0.04, 0.26, [x, 0.02, 0], tone(ROCK, 0.7));
    stain.origin.copy(base);
    stain.floor(x, 0.014, 0, 0.3, 0.3, SHADOW, 0.4);
  }
  flat.origin.copy(base);
  flat.box(0.24, 0.2, 0.12, [-1.3, 0.45, 0.085], tone(ROCK, 0.72));
  lamp.origin.copy(base);
  lamp.lens(-1.36, 0.5, 0.147, 0.008, AMBER);

  return { cast: cast.build(), flat: flat.build(), solar: solar.build(), lamp: lamp.build(), stain: stain.build() };
};
