import * as THREE from 'three';
import type { Planet } from '@/types/content';
import { getBeaconFacing, getBeaconPosition } from '@/data/content';
import type { HeightFn } from '../Terrain';
import { TEMPLE, templeStepTop } from './site';
import { Decals, Dress, fleck, seeded, tone, type V3 } from './dress';

/*
 * The temple's stonework, offerings and stains. The columns are in the edge of
 * view, so they carry the carving; the floor's inlays run in from them toward
 * the statues and fade up as they arrive; the ground right at a statue keeps
 * only a plain frame and a worn patch.
 */

const STONE = '#cdbfa6';
const FLOOR = '#c2b59d';
const KEY = '#9a8b73';
const CLAY = '#7a4a2c';
const WAX = '#cfc3a8';
const SOOT = new THREE.Color('#120c08');
const WEAR = new THREE.Color('#e9dfc9');
const SHADOW = new THREE.Color('#1a120c');
const EMBER = new THREE.Color('#ffb066');

export const COLUMN_H = 4.1;
export const GATE_H = 5.2;

/** A shaft cut with flutes, swelling slightly at the waist. Open ended; rings and blocks cover the ends. */
const fluted = (rt: number, rb: number, h: number, flutes: number, rows: number) => {
  const g = new THREE.CylinderGeometry(rt, rb, h, flutes * 2, rows, true);
  const p = g.attributes.position;
  const ring = flutes * 2 + 1;
  for (let i = 0; i < p.count; i += 1) {
    const j = i % ring;
    const row = Math.floor(i / ring);
    const k = (1 + 0.035 * Math.sin((Math.PI * row) / rows)) * (j % 2 ? 0.9 : 1);
    p.setX(i, p.getX(i) * k);
    p.setZ(i, p.getZ(i) * k);
  }
  return g;
};

const column = (d: Dress, x: number, y: number, z: number, h: number, seed: number) => {
  const stone = tone(STONE);
  d.frame(x, y, z);
  // grime climbs from the floor; soot and rain leave the rest uneven
  const shaftH = h - 0.5;
  const shaftShade = (px: number, py: number, pz: number) => {
    const up = (py + shaftH / 2) / shaftH;
    const grime = 0.74 + 0.26 * Math.min(1, up / 0.3);
    return grime * (0.93 + 0.1 * fleck(px + seed, py, pz));
  };
  const blockShade = (px: number, py: number, pz: number) => 0.9 + 0.12 * fleck(px + seed, py, pz);
  d.box(0.78, 0.24, 0.78, [0, 0.12, 0], tone(STONE, 0.62), undefined, blockShade);
  d.torus(0.325, 0.05, [0, 0.29, 0], tone(STONE, 0.82));
  d.part(fluted(0.27, 0.31, shaftH, 12, 3), [0, 0.24 + shaftH / 2, 0], stone, undefined, undefined, shaftShade);
  d.torus(0.29, 0.03, [0, h - 0.4, 0], tone(STONE, 0.86));
  d.cyl(0.37, 0.28, 0.16, [0, h - 0.25, 0], tone(STONE, 0.95), 12);
  d.box(0.72, 0.17, 0.72, [0, h - 0.085, 0], stone, undefined, blockShade);
};

/** A row of carved teeth under a beam, along z in the current frame. */
const dentils = (d: Dress, x: number, y: number, z0: number, z1: number, c: THREE.Color) => {
  const n = Math.floor((z1 - z0) / 0.34);
  for (let i = 0; i <= n; i += 1) d.box(0.05, 0.11, 0.17, [x, y, z0 + i * 0.34], c);
};

/** A running key band laid into the floor, heading along z. */
const keyBand = (d: Dress, x: number, flip: number, y: number, z0: number, z1: number, rand: () => number) => {
  const c = tone(KEY);
  const w = 0.028;
  const unit = 0.6;
  const v = (t: number) => x + flip * t;
  for (let z = z0; z < z1 - unit; z += unit) {
    d.strip(v(0), z, v(0), z + unit, y, w, c);
    // a few have worn away under the feet
    if (rand() < 0.1) continue;
    d.strip(v(0), z, v(0.36), z, y, w, c);
    d.strip(v(0.36), z, v(0.36), z + 0.36, y, w, c);
    d.strip(v(0.36), z + 0.36, v(0.12), z + 0.36, y, w, c);
    d.strip(v(0.12), z + 0.36, v(0.12), z + 0.18, y, w, c);
    d.strip(v(0.12), z + 0.18, v(0.24), z + 0.18, y, w, c);
  }
};

/** Fine broken lines in the slabs. */
const crack = (d: Dress, x: number, z: number, y: number, yaw: number, rand: () => number) => {
  const c = tone('#6e5f4b');
  let a = yaw;
  let px = x;
  let pz = z;
  const n = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < n; i += 1) {
    a += (rand() - 0.5) * 1.1;
    const l = 0.15 + rand() * 0.3;
    const nx = px + Math.sin(a) * l;
    const nz = pz + Math.cos(a) * l;
    d.strip(px, pz, nx, nz, y, 0.012, c);
    px = nx;
    pz = nz;
  }
};

const bowl = (d: Dress, g: Decals, x: number, y: number, z: number, gy: number, r: number, rand: () => number) => {
  d.frame(x, y, z);
  const clay = tone(CLAY, 0.8 + rand() * 0.4);
  d.lathe(
    [
      [0, 0],
      [r * 0.55, 0],
      [r * 0.95, r * 0.45],
      [r, r * 0.7],
      [r * 0.82, r * 0.68],
      [r * 0.5, r * 0.3],
      [0, r * 0.25],
    ],
    [0, 0, 0],
    clay,
    8,
  );
  // grain or ash heaped inside
  d.lump(r * 0.45, [0, r * 0.4, 0], tone('#b49b6e', 0.7 + rand() * 0.4), [rand() * 3, rand() * 3, 0], [1, 0.5, 1]);
  g.floor(x, gy, z, r * 1.8, r * 1.8, SHADOW, 0.32);
};

const candle = (d: Dress, e: Dress, g: Decals, x: number, y: number, z: number, h: number) => {
  d.frame(x, y, z);
  d.cyl(0.021, 0.027, h, [0, h / 2, 0], tone(WAX, 0.86), 6);
  d.lump(0.03, [0.008, 0.012, 0], tone(WAX, 0.72), undefined, [1, 0.35, 1]);
  e.frame(x, y, z);
  e.lump(0.012, [0, h + 0.012, 0], EMBER);
  g.floor(x, y + 0.002, z, 0.06, 0.06, SHADOW, 0.3);
};

const cairn = (d: Dress, g: Decals, x: number, y: number, z: number, rand: () => number) => {
  d.frame(x, y, z);
  let h = 0;
  for (let i = 0; i < 4; i += 1) {
    const r = 0.055 - i * 0.011;
    h += r * 0.6;
    d.lump(r, [(rand() - 0.5) * 0.012, h, (rand() - 0.5) * 0.012], tone(STONE, 0.55 + rand() * 0.25), [rand() * 3, rand() * 3, 0], [1, 0.55, 1]);
    h += r * 0.5;
  }
  g.floor(x, y + 0.002, z, 0.1, 0.1, SHADOW, 0.3);
};

export const buildTemple = (planet: Planet, ground: HeightFn, top: number, base: number) => {
  const cast = new Dress();
  const flat = new Dress();
  const gold = new Dress();
  const ember = new Dress();
  const stain = new Decals();
  const rand = seeded(417);
  const stone = tone(STONE);
  const dark = tone(STONE, 0.62);

  const W = TEMPLE.x1 - TEMPLE.x0;
  const D = TEMPLE.z1 - TEMPLE.z0;
  const cz = (TEMPLE.z0 + TEMPLE.z1) / 2;

  /* ---- the steps: the middle is trodden pale, the noses chipped ---- */
  for (let k = 0; k < TEMPLE.steps; k += 1) {
    const st = templeStepTop(ground, top, k);
    const z0 = TEMPLE.z1 + k * TEMPLE.stepRun;
    const w = W - 0.6 - k * 0.5;
    cast.frame(0, 0, 0).box(w, st - base, TEMPLE.stepRun, [0, (st + base) / 2, z0 + TEMPLE.stepRun / 2], stone);
    flat.frame(0, 0, 0).box(w + 0.03, 0.035, 0.05, [0, st - 0.018, z0 + TEMPLE.stepRun - 0.012], tone(STONE, 0.9));
    stain.floor(0, st + 0.004, z0 + TEMPLE.stepRun * 0.5, 1.5, TEMPLE.stepRun * 0.46, WEAR, 0.3, 0.05, k);
    for (let i = 0; i < 7; i += 1) {
      // chips keep off the worn centre, out toward the ends
      const side = rand() < 0.5 ? -1 : 1;
      const x = side * (1.7 + rand() * (w / 2 - 2));
      flat.lump(0.03 + rand() * 0.04, [x, st - 0.01, z0 + TEMPLE.stepRun + 0.005], tone(STONE, 0.45 + rand() * 0.15), [rand() * 3, rand() * 3, 0], [1.5, 0.6, 0.7]);
    }
  }

  /* ---- the aisle runner, edged in gold ---- */
  flat.frame(0, 0, 0).strip(0, TEMPLE.z1, 0, TEMPLE.z0 + 1.2, top + 0.012, 2.0, dark);
  for (const x of [-1.02, 1.02]) gold.frame(0, 0, 0).box(0.05, 0.02, D - 1.2, [x, top + 0.02, cz + 0.6], tone('#ffffff'));
  stain.frame(0, 0, 0).floor(0, top + 0.016, cz + 2, 0.75, D * 0.42, WEAR, 0.16, 0.05);

  /* ---- colonnades ---- */
  const colZ0 = TEMPLE.colZ[0];
  const colZ1 = TEMPLE.colZ[TEMPLE.colZ.length - 1];
  const beamLen = colZ0 - colZ1 + 0.9;
  const beamZ = (colZ0 + colZ1) / 2;
  TEMPLE.colZ.forEach((z, i) => {
    for (const s of [-1, 1]) {
      const x = s * TEMPLE.colX;
      column(cast, x, top, z, COLUMN_H, i * 3 + (s > 0 ? 1 : 0));
      stain.frame(0, 0, 0).floor(x, top + 0.008, z, 0.75, 0.75, SOOT, 0.22, 0.14, i + s);
    }
  });
  for (const s of [-1, 1]) {
    const x = s * TEMPLE.colX;
    const inner = -s;
    cast.frame(0, 0, 0).box(0.85, 0.4, beamLen, [x, top + COLUMN_H + 0.2, beamZ], stone, undefined, (px, py, pz) => (py < 0 ? 0.8 : 1) * (0.94 + 0.08 * fleck(px, py, pz)));
    flat.frame(0, 0, 0);
    flat.box(0.98, 0.07, beamLen + 0.12, [x, top + COLUMN_H + 0.435, beamZ], stone);
    flat.box(0.9, 0.05, beamLen + 0.02, [x, top + COLUMN_H + 0.34, beamZ], tone(STONE, 0.84));
    flat.box(0.9, 0.04, beamLen + 0.02, [x, top + COLUMN_H + 0.02, beamZ], tone(STONE, 0.72));
    dentils(flat, x + inner * 0.44, top + COLUMN_H + 0.12, colZ1 - 0.3, colZ0 + 0.3, tone(STONE, 0.78));
  }

  /* ---- the gate ---- */
  const gz = TEMPLE.z0 + 0.7;
  for (const s of [-1, 1]) column(cast, s * 2.3, top, gz, GATE_H, 40 + s);
  cast.frame(0, 0, 0).box(5.8, 0.45, 0.9, [0, top + GATE_H + 0.22, gz], stone, undefined, (px, py, pz) => (py < 0 ? 0.78 : 1) * (0.94 + 0.08 * fleck(px, py, pz)));
  flat.frame(0, 0, 0);
  flat.box(5.96, 0.07, 1.04, [0, top + GATE_H + 0.48, gz], stone);
  flat.box(5.84, 0.05, 0.94, [0, top + GATE_H + 0.025, gz], tone(STONE, 0.72));
  for (let i = -8; i <= 8; i += 1) flat.box(0.17, 0.11, 0.05, [i * 0.34, top + GATE_H + 0.12, gz + 0.465], tone(STONE, 0.78));
  gold.frame(0, 0, 0).box(4.6, 0.06, 0.02, [0, top + GATE_H + 0.22, gz + 0.46], tone('#ffffff'));
  // the eternal flame has been blackening the lintel for a long time
  stain.frame(0, 0, 0).fan([0, top + GATE_H + 0.2, gz + 0.453], [1.7, 0, 0], [0, 0.24, 0], SOOT, 0.55, 0.14, 3);

  /* ---- the dais, its tiers cut with panels, the pedestal sooted toward the flame ---- */
  const dz = TEMPLE.daisZ;
  const R = TEMPLE.daisR;
  cast.frame(0, top, dz);
  cast.cyl(R, R + 0.1, 0.3, [0, 0.15, 0], dark, 10);
  cast.cyl(R - 0.5, R - 0.4, 0.3, [0, 0.45, 0], stone, 10);
  cast.cyl(0.28, 0.4, 0.7, [0, 0.95, 0], stone, 10, undefined, (_x, py) => 1 - Math.max(0, (py + 0.1) / 0.45) * 0.55);
  flat.frame(0, top, dz);
  flat.cyl(R + 0.05, R + 0.05, 0.05, [0, 0.285, 0], tone(STONE, 0.72), 10);
  flat.cyl(R - 0.45, R - 0.45, 0.05, [0, 0.6, 0], tone(STONE, 0.9), 10);
  for (let i = 0; i < 10; i += 1) {
    const a = ((i + 0.5) / 10) * Math.PI * 2;
    const apothem = (R + 0.05) * Math.cos(Math.PI / 10);
    flat.box(0.72, 0.13, 0.012, [Math.sin(a) * apothem, 0.13, Math.cos(a) * apothem], tone(STONE, 0.42), [0, a, 0]);
    flat.box(0.62, 0.012, 0.014, [Math.sin(a) * apothem, 0.13, Math.cos(a) * apothem], tone(STONE, 0.72), [0, a, 0]);
  }
  stain.frame(0, top, dz);
  stain.floor(0, 0.606, 0, R - 0.55, R - 0.55, SOOT, 0.6, 0.1, 1);
  stain.floor(0, 0.302, 0, R + 0.1, R + 0.1, SOOT, 0.22, 0.1, 2);

  /* ---- offerings on the dais' lowest step, left where they were set down ---- */
  const dais = (a: number, r: number): [number, number] => [Math.sin(a) * r, dz + Math.cos(a) * r];
  const ledge = top + 0.3;
  stain.frame(0, 0, 0);
  let a = -1.4;
  let idx = 0;
  while (a < 1.4) {
    const r = R - 0.34 + rand() * 0.14;
    const [x, z] = dais(a, r);
    const kind = idx % 5;
    if (kind === 0 || kind === 3) bowl(flat, stain, x, ledge, z, ledge + 0.002, 0.075 + rand() * 0.03, rand);
    else if (kind === 2) cairn(flat, stain, x, ledge, z, rand);
    else {
      candle(flat, ember, stain, x, ledge, z, 0.06 + rand() * 0.06);
      const [x2, z2] = dais(a + 0.07, r + 0.03);
      candle(flat, ember, stain, x2, ledge, z2, 0.04 + rand() * 0.04);
    }
    a += 0.28 + rand() * 0.22;
    idx += 1;
  }

  /* ---- at the columns: a votive bowl here and there, stone chips ---- */
  TEMPLE.colZ.forEach((z, i) => {
    for (const s of [-1, 1]) {
      const x = s * (TEMPLE.colX - 0.62);
      if ((i + (s > 0 ? 1 : 0)) % 2 === 0) bowl(flat, stain, x, top, z + 0.1, top + 0.009, 0.08, rand);
      for (let k = 0; k < 3; k += 1) {
        const cx = s * TEMPLE.colX + (rand() - 0.5) * 1.3;
        const cz2 = z + (rand() - 0.5) * 1.3;
        if (Math.abs(cx - s * TEMPLE.colX) < 0.45 && Math.abs(cz2 - z) < 0.45) continue;
        flat.frame(0, 0, 0).lump(0.02 + rand() * 0.04, [cx, top + 0.01, cz2], tone(STONE, 0.5 + rand() * 0.3), [rand() * 3, rand() * 3, 0], [1.1, 0.5, 0.8]);
      }
    }
  });

  /* ---- floor inlays: key bands down the aisle, lines leading in to each statue ---- */
  const inlayY = top + 0.007;
  flat.frame(0, 0, 0);
  keyBand(flat, -1.2, -1, inlayY, TEMPLE.daisZ + 2.6, TEMPLE.z1 - 0.3, rand);
  keyBand(flat, 1.2, 1, inlayY, TEMPLE.daisZ + 2.6, TEMPLE.z1 - 0.3, rand);
  // faint at the column, darkening and warming as it reaches the statue
  const lineFar = tone(FLOOR);
  const lineNear = tone('#6f5228');
  planet.beacons.forEach((_, i) => {
    const p = getBeaconPosition(planet, i);
    const s = Math.sign(p[0]);
    const fromZ = [p[2] + 2.6, p[2] - 2.6];
    for (const z of fromZ) {
      if (z < TEMPLE.colZ[TEMPLE.colZ.length - 1] - 0.5 || z > TEMPLE.colZ[0] + 0.5) continue;
      const x0 = s * (TEMPLE.colX - 0.42);
      const ax = x0;
      const az = z;
      const dx = p[0] - ax;
      const dz2 = p[2] - az;
      const len = Math.hypot(dx, dz2) || 1;
      flat.frame(0, 0, 0).strip(ax, az, p[0] - (dx / len) * 1.25, p[2] - (dz2 / len) * 1.25, inlayY, 0.05, lineFar, lineNear);
    }
  });

  /* ---- at each statue: a plain inlaid frame, a base course, a worn place to stand ---- */
  planet.beacons.forEach((_, i) => {
    const p = getBeaconPosition(planet, i);
    const [fx, fz] = getBeaconFacing(planet, p);
    const yaw = Math.atan2(fx - p[0], fz - p[2]);
    const fr = tone('#7d6a4a');
    flat.frame(p[0], top, p[2], yaw);
    flat.box(1.42, 0.06, 1.26, [0, 0.03, 0], tone(STONE, 0.5));
    const hw = 1.2;
    const hd = 1.1;
    const y = 0.008;
    flat.strip(-hw, -hd, hw, -hd, y, 0.035, fr);
    flat.strip(-hw, hd, hw, hd, y, 0.035, fr);
    flat.strip(-hw, -hd, -hw, hd, y, 0.035, fr);
    flat.strip(hw, -hd, hw, hd, y, 0.035, fr);
    stain.frame(p[0], top, p[2], yaw);
    stain.floor(0, 0.009, 1.75, 1.0, 0.6, WEAR, 0.22, 0.1, i);
    // soot under the two braziers
    for (const s of [-1, 1]) stain.floor(0.88 * s, 0.01, 0.72, 0.28, 0.28, SOOT, 0.36, 0.14, i * s);
  });

  /* ---- cracks, kept to the outer slabs ---- */
  flat.frame(0, 0, 0);
  for (let i = 0; i < 26; i += 1) {
    const side = i % 2 ? 1 : -1;
    const x = side * (4.6 + rand() * 1.6);
    const z = TEMPLE.z0 + 0.5 + rand() * (D - 1);
    crack(flat, x, z, inlayY, rand() * Math.PI * 2, rand);
  }
  const front: V3 = [0, top + 0.009, TEMPLE.z1 - 0.2];
  stain.frame(0, 0, 0).fan(front, [0, 0, 0.5], [1.8, 0, 0], WEAR, 0.18, 0.08);

  return { cast: cast.build(), flat: flat.build(), gold: gold.build(), ember: ember.build(), stain: stain.build() };
};
