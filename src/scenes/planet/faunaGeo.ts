import * as THREE from 'three';

/*
 * Small-creature modelling kit: a triangle soup with per-vertex colour and
 * rig data, lofted tubes and parametric sheets, the leg solve, and the shared
 * materials. Parts are posed as instances, one draw call per part per herd.
 */

export type RGB = [number, number, number];
export const rgb = (hex: string): RGB => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
};
export const mixRgb = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

export type V3 = [number, number, number];
/** A ring of a loft: centre, half widths across and up */
export interface Ring {
  p: V3;
  rx: number;
  ry: number;
}

export class Mesher {
  pos: number[] = [];
  col: number[] = [];
  rigs: number[] = [];
  glows: number[] = [];
  paint: (x: number, y: number, z: number) => RGB = () => [1, 1, 1];
  rig: (x: number, y: number, z: number) => V3 = () => [0, 0, 0];
  glow: (x: number, y: number, z: number) => number = () => 0;

  tri(a: V3, b: V3, c: V3) {
    for (const v of [a, b, c]) {
      this.pos.push(v[0], v[1], v[2]);
      const k = this.paint(v[0], v[1], v[2]);
      this.col.push(k[0], k[1], k[2]);
      const r = this.rig(v[0], v[1], v[2]);
      this.rigs.push(r[0], r[1], r[2]);
      this.glows.push(this.glow(v[0], v[1], v[2]));
    }
  }

  /** A grid of quads over a parametric sheet, nu by nv */
  sheet(nu: number, nv: number, f: (u: number, v: number) => V3) {
    for (let i = 0; i < nu; i += 1) {
      for (let j = 0; j < nv; j += 1) {
        const a = f(i / nu, j / nv);
        const b = f((i + 1) / nu, j / nv);
        const c = f(i / nu, (j + 1) / nv);
        const d = f((i + 1) / nu, (j + 1) / nv);
        this.tri(a, b, c);
        this.tri(b, d, c);
      }
    }
  }

  /** A closed tube through rings of elliptical section, capped at both ends */
  loft(rings: Ring[], sides = 7) {
    const frames = rings.map((r, i) => {
      const prev = rings[Math.max(0, i - 1)].p;
      const next = rings[Math.min(rings.length - 1, i + 1)].p;
      const t = new THREE.Vector3(next[0] - prev[0], next[1] - prev[1], next[2] - prev[2]);
      if (t.lengthSq() < 1e-10) t.set(0, 0, 1);
      t.normalize();
      const ref = Math.abs(t.y) > 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
      const u = new THREE.Vector3().crossVectors(ref, t).normalize();
      const v = new THREE.Vector3().crossVectors(t, u);
      return { u, v, r };
    });
    const at = (i: number, j: number): V3 => {
      const f = frames[i];
      const th = (j / sides) * Math.PI * 2;
      const cu = Math.cos(th) * f.r.rx;
      const cv = Math.sin(th) * f.r.ry;
      return [f.r.p[0] + f.u.x * cu + f.v.x * cv, f.r.p[1] + f.u.y * cu + f.v.y * cv, f.r.p[2] + f.u.z * cu + f.v.z * cv];
    };
    for (let i = 0; i < rings.length - 1; i += 1) {
      for (let j = 0; j < sides; j += 1) {
        const a = at(i, j);
        const b = at(i, j + 1);
        const c = at(i + 1, j);
        const d = at(i + 1, j + 1);
        this.tri(a, b, c);
        this.tri(b, d, c);
      }
    }
    const first = rings[0].p;
    const last = rings[rings.length - 1].p;
    for (let j = 0; j < sides; j += 1) {
      this.tri(first, at(0, j + 1), at(0, j));
      this.tri(last, at(rings.length - 1, j), at(rings.length - 1, j + 1));
    }
  }

  /** A round blob */
  blob(c: V3, rx: number, ry: number, rz: number, sides = 6) {
    const n = 5;
    const rings: Ring[] = [];
    for (let i = 0; i <= n; i += 1) {
      const a = (i / n) * Math.PI;
      const s = Math.max(Math.sin(a), 0.02);
      rings.push({ p: [c[0], c[1], c[2] - Math.cos(a) * rz], rx: rx * s, ry: ry * s });
    }
    this.loft(rings, sides);
  }

  /** A round limb between two points */
  tube(a: V3, b: V3, ra: number, rb: number, sides = 5) {
    this.loft(
      [
        { p: a, rx: ra, ry: ra },
        { p: b, rx: rb, ry: rb },
      ],
      sides,
    );
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aRig', new THREE.Float32BufferAttribute(this.rigs, 3));
    g.setAttribute('aGlow', new THREE.Float32BufferAttribute(this.glows, 1));
    g.computeVertexNormals();
    return g;
  }
}

/* ---------- posing ---------- */

const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _rot = new THREE.Matrix4();
/** out = parent * translate(x, y, z) * rotate(rx, ry, rz); no allocation */
export const joint = (out: THREE.Matrix4, parent: THREE.Matrix4, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
  _rot.makeRotationFromEuler(_euler.set(rx, ry, rz));
  _rot.setPosition(x, y, z);
  return out.multiplyMatrices(parent, _rot);
};

/** Result of solveLeg: the hip and knee rotations about x */
export const leg = { hip: 0, knee: 0 };
/**
 * Two-bone solve in the leg's plane. fz is the foot forward of the hip, fy its
 * height against the hip (negative); kneeDir +1 bends the joint forward, -1 back.
 */
export const solveLeg = (fz: number, fy: number, l1: number, l2: number, kneeDir: number) => {
  const raw = Math.hypot(fz, fy);
  const d = Math.min(Math.max(raw, Math.abs(l1 - l2) + 0.001), l1 + l2 - 0.001);
  const k = raw > 1e-5 ? d / raw : 1;
  const tz = fz * k;
  const ty = fy * k;
  const base = Math.atan2(tz, -ty);
  const c = Math.min(1, Math.max(-1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)));
  const th = base + kneeDir * Math.acos(c);
  const kz = Math.sin(th) * l1;
  const ky = -Math.cos(th) * l1;
  const sh = Math.atan2(tz - kz, -(ty - ky));
  leg.hip = -th;
  leg.knee = -(sh - th);
};

/** Result of stride: a foot's offset along the body and its lift */
export const foot = { z: 0, y: 0 };
/** Places a foot through its cycle: planted for the duty fraction, then swung forward */
export const stride = (cycle: number, duty: number, len: number, lift: number) => {
  const c = cycle - Math.floor(cycle);
  if (c < duty) {
    foot.z = len * (0.5 - c / duty);
    foot.y = 0;
  } else {
    const u = (c - duty) / (1 - duty);
    foot.z = len * (-0.5 + u * u * (3 - 2 * u));
    foot.y = lift * Math.sin(u * Math.PI);
  }
};

/* ---------- materials ---------- */

/** Flat-shaded hide coloured per vertex, glowing where aGlow is painted */
export const hideMaterial = (glow: THREE.Color | null, roughness = 0.85) => {
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness, flatShading: true, side: THREE.DoubleSide });
  const value = glow ?? new THREE.Color(0, 0, 0);
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uGlow = { value };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow;\nuniform vec3 uGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uGlow * vGlow;');
  };
  m.customProgramCacheKey = () => 'fauna-hide';
  return m;
};

/** A tortoise shell: basalt plates with lava breathing along the seams between them */
export const shellMaterial = (glow: THREE.Color, time: { value: number }) => {
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.92, flatShading: true });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uGlow = { value: glow };
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vShell;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvShell = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vShell;\nuniform vec3 uGlow;\nuniform float uTime;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        vec2 hp = vShell.xz * 6.5;
        vec2 hr = vec2(1.0, 1.732);
        vec2 hh = hr * 0.5;
        vec2 ha = mod(hp, hr) - hh;
        vec2 hb = mod(hp - hh, hr) - hh;
        vec2 hg = dot(ha, ha) < dot(hb, hb) ? ha : hb;
        float hd = max(abs(hg.x), dot(abs(hg), vec2(0.5, 0.866)));
        float seam = smoothstep(0.43, 0.5, hd) * smoothstep(0.1, 0.16, vShell.y);
        float breathe = 0.65 + 0.35 * sin(uTime * 0.7 + vShell.x * 3.0 + vShell.z * 2.0);
        totalEmissiveRadiance += uGlow * seam * breathe;`,
      );
  };
  m.customProgramCacheKey = () => 'fauna-shell';
  return m;
};

/* ---------- walkers ---------- */

export interface PartDef {
  name: string;
  geo: THREE.BufferGeometry;
  /** Instances per creature */
  n: number;
  cast: boolean;
  /** Takes clicks for the creature */
  hit: boolean;
}

export const DEER = {
  frontHip: [0.11, 0.69, 0.31] as V3,
  hindHip: [0.11, 0.74, -0.33] as V3,
  thigh: 0.34,
  shin: 0.37,
  neck: [0, 0.93, 0.38] as V3,
  head: [0, 0.42, 0.25] as V3,
  ear: [0.05, 0.075, -0.03] as V3,
  tail: [0, 0.86, -0.47] as V3,
};

/** A deer in parts, each origin at its joint; the model faces +z */
export const deerParts = (coat: string, dark: string): PartDef[] => {
  const C = rgb(coat);
  const D = rgb(dark);
  const pale = rgb('#ece4d4');
  const belly = mixRgb(C, rgb('#e8dcc8'), 0.55);

  const torso = new Mesher();
  torso.paint = (x, y, z) => {
    if (z < -0.43) return mixRgb(C, pale, 0.7); // the rump patch
    const under = 1 - THREE.MathUtils.smoothstep(y, 0.6, 0.72);
    const spine = y > 0.92 ? 0.25 : 0;
    // faint dappling along the flank
    const dap = Math.sin(x * 40 + z * 22) * Math.sin(y * 30 + z * 13) > 0.72 && y > 0.74 ? 0.1 : 0;
    return mixRgb(mixRgb(mixRgb(C, D, spine), belly, under), pale, dap);
  };
  torso.loft(
    [
      { p: [0, 0.79, -0.48], rx: 0.05, ry: 0.06 },
      { p: [0, 0.79, -0.42], rx: 0.13, ry: 0.15 },
      { p: [0, 0.79, -0.28], rx: 0.17, ry: 0.2 },
      { p: [0, 0.76, -0.08], rx: 0.17, ry: 0.2 },
      { p: [0, 0.76, 0.14], rx: 0.17, ry: 0.22 },
      { p: [0, 0.79, 0.34], rx: 0.15, ry: 0.22 },
      { p: [0, 0.87, 0.47], rx: 0.09, ry: 0.13 },
      { p: [0, 0.92, 0.53], rx: 0.03, ry: 0.04 },
    ],
    9,
  );
  // the shoulder and haunch swell at the top of each leg
  for (const s of [-1, 1]) {
    torso.blob([s * 0.115, 0.74, 0.3], 0.05, 0.14, 0.09, 8);
    torso.blob([s * 0.115, 0.76, -0.3], 0.06, 0.16, 0.12, 8);
  }

  const neck = new Mesher();
  neck.paint = (_x, y, z) => mixRgb(C, belly, THREE.MathUtils.smoothstep(z - y * 0.5, 0.05, 0.1) * 0.6);
  neck.loft(
    [
      { p: [0, -0.04, -0.03], rx: 0.09, ry: 0.14 },
      { p: [0, 0.14, 0.08], rx: 0.075, ry: 0.1 },
      { p: [0, 0.3, 0.18], rx: 0.058, ry: 0.07 },
      { p: DEER.head, rx: 0.05, ry: 0.055 },
    ],
    7,
  );

  const head = new Mesher();
  head.paint = (_x, _y, z) => (z > 0.22 ? D : z > 0.16 ? mixRgb(C, belly, 0.5) : C);
  head.loft(
    [
      { p: [0, 0.01, -0.07], rx: 0.04, ry: 0.05 },
      { p: [0, 0.03, 0.02], rx: 0.07, ry: 0.07 },
      { p: [0, 0.01, 0.13], rx: 0.058, ry: 0.058 },
      { p: [0, -0.015, 0.24], rx: 0.04, ry: 0.04 },
      { p: [0, -0.03, 0.31], rx: 0.024, ry: 0.024 },
    ],
    7,
  );
  head.paint = () => [0.02, 0.015, 0.015];
  for (const s of [-1, 1]) head.blob([s * 0.066, 0.05, 0.075], 0.013, 0.016, 0.016, 5);

  const ear = new Mesher();
  ear.paint = (_x, y) => (y > 0.1 ? D : C);
  ear.sheet(4, 2, (u, v) => {
    const w = 0.042 * Math.sin(Math.min(1, u * 1.15) * Math.PI);
    return [(v - 0.5) * 2 * w, u * 0.17, -0.012 * Math.cos((v - 0.5) * Math.PI)];
  });

  const antler = new Mesher();
  antler.paint = (_x, y) => mixRgb(rgb('#6e5a42'), rgb('#ece0c8'), Math.min(1, y / 0.42));
  for (const s of [-1, 1]) {
    antler.tube([s * 0.04, 0.08, -0.02], [s * 0.12, 0.3, -0.09], 0.016, 0.01, 4);
    antler.tube([s * 0.12, 0.3, -0.09], [s * 0.14, 0.46, 0.0], 0.01, 0.005, 4);
    antler.tube([s * 0.09, 0.22, -0.07], [s * 0.04, 0.34, 0.05], 0.008, 0.004, 4);
    antler.tube([s * 0.125, 0.33, -0.06], [s * 0.22, 0.4, -0.08], 0.008, 0.004, 4);
  }

  const tail = new Mesher();
  tail.paint = (_x, y) => (y < -0.03 ? pale : C);
  tail.loft(
    [
      { p: [0, 0, 0], rx: 0.03, ry: 0.035 },
      { p: [0, -0.06, -0.08], rx: 0.04, ry: 0.035 },
      { p: [0, -0.14, -0.12], rx: 0.012, ry: 0.012 },
    ],
    5,
  );

  const thigh = new Mesher();
  thigh.paint = () => mixRgb(C, D, 0.25);
  thigh.loft(
    [
      { p: [0, 0.03, 0], rx: 0.06, ry: 0.075 },
      { p: [0, -DEER.thigh * 0.55, 0], rx: 0.045, ry: 0.055 },
      { p: [0, -DEER.thigh, 0], rx: 0.03, ry: 0.033 },
    ],
    6,
  );

  const shin = new Mesher();
  shin.paint = (_x, y) => (y < -DEER.shin + 0.06 ? rgb('#14100c') : D);
  shin.loft(
    [
      { p: [0, 0, 0], rx: 0.027, ry: 0.03 },
      { p: [0, -DEER.shin * 0.75, 0.005], rx: 0.018, ry: 0.02 },
      { p: [0, -DEER.shin + 0.05, 0.012], rx: 0.024, ry: 0.03 },
      { p: [0, -DEER.shin, 0.02], rx: 0.03, ry: 0.038 },
    ],
    6,
  );

  return [
    { name: 'torso', geo: torso.build(), n: 1, cast: true, hit: true },
    { name: 'neck', geo: neck.build(), n: 1, cast: true, hit: true },
    { name: 'head', geo: head.build(), n: 1, cast: true, hit: false },
    { name: 'ear', geo: ear.build(), n: 2, cast: false, hit: false },
    { name: 'antler', geo: antler.build(), n: 1, cast: false, hit: false },
    { name: 'tail', geo: tail.build(), n: 1, cast: false, hit: false },
    { name: 'thigh', geo: thigh.build(), n: 4, cast: true, hit: false },
    { name: 'shin', geo: shin.build(), n: 4, cast: false, hit: false },
  ];
};

export const TORTOISE = {
  hip: [
    [-0.33, 0.14, 0.36],
    [0.33, 0.14, 0.36],
    [-0.33, 0.14, -0.36],
    [0.33, 0.14, -0.36],
  ] as V3[],
  neck: [0, 0.2, 0.5] as V3,
};

/** A tortoise: a domed plated shell, pillar legs and a long neck; origin on the ground */
export const tortoiseParts = (): PartDef[] => {
  const shell = new Mesher();
  shell.paint = (_x, y) => mixRgb(rgb('#241b17'), rgb('#3a2d26'), Math.min(1, y / 0.5));
  const rings: Ring[] = [];
  const n = 8;
  for (let i = 0; i <= n; i += 1) {
    const a = (i / n) * Math.PI;
    const s = Math.max(Math.sin(a), 0.04);
    rings.push({ p: [0, 0.17 + 0.28 * s, -Math.cos(a) * 0.66], rx: 0.48 * s, ry: 0.29 * s });
  }
  shell.loft(rings, 14);

  // the rim of the shell, hanging over the body
  const skirt = new Mesher();
  skirt.paint = () => rgb('#1a1310');
  skirt.loft(
    [
      { p: [0, 0.16, -0.7], rx: 0.1, ry: 0.03 },
      { p: [0, 0.16, -0.55], rx: 0.48, ry: 0.05 },
      { p: [0, 0.16, 0.5], rx: 0.48, ry: 0.05 },
      { p: [0, 0.16, 0.7], rx: 0.1, ry: 0.03 },
    ],
    12,
  );

  const legM = new Mesher();
  legM.paint = (_x, y) => (y < -0.12 ? rgb('#0d0907') : rgb('#1c1411'));
  legM.loft(
    [
      { p: [0, 0.02, 0], rx: 0.1, ry: 0.11 },
      { p: [0, -0.08, 0.01], rx: 0.085, ry: 0.09 },
      { p: [0, -0.15, 0.02], rx: 0.1, ry: 0.11 },
    ],
    7,
  );

  const head = new Mesher();
  head.paint = (_x, _y, z) => mixRgb(rgb('#3a2a22'), rgb('#201712'), Math.min(1, z / 0.4));
  head.loft(
    [
      { p: [0, -0.02, -0.12], rx: 0.09, ry: 0.09 },
      { p: [0, 0.0, 0.06], rx: 0.08, ry: 0.085 },
      { p: [0, 0.02, 0.2], rx: 0.09, ry: 0.08 },
      { p: [0, 0.03, 0.33], rx: 0.05, ry: 0.05 },
    ],
    8,
  );
  head.glow = () => 1;
  head.paint = () => [0.8, 0.6, 0.4];
  for (const s of [-1, 1]) head.blob([s * 0.075, 0.07, 0.25], 0.016, 0.014, 0.014, 5);

  return [
    { name: 'shell', geo: shell.build(), n: 1, cast: true, hit: true },
    { name: 'skirt', geo: skirt.build(), n: 1, cast: false, hit: false },
    { name: 'leg', geo: legM.build(), n: 4, cast: true, hit: false },
    { name: 'head', geo: head.build(), n: 1, cast: true, hit: false },
  ];
};

/** A squat alien hopper: a soft pear of a body, big hind feet, stubby arms, eyes on stalks */
export const hopperParts = (bodyC: THREE.Color, darkC: THREE.Color): PartDef[] => {
  const B: RGB = [bodyC.r, bodyC.g, bodyC.b];
  const D: RGB = [darkC.r, darkC.g, darkC.b];
  const belly = mixRgb(B, rgb('#e8d9d2'), 0.45);
  const body = new Mesher();
  body.paint = (x, y, z) => {
    if (y < -0.03 && z > -0.06) return belly;
    // two soft stripes over the back
    return Math.abs(Math.abs(x) - 0.08) < 0.022 && y > 0 ? mixRgb(B, D, 0.75) : B;
  };
  const rings: Ring[] = [];
  const n = 7;
  for (let i = 0; i <= n; i += 1) {
    const a = (i / n) * Math.PI;
    const s = Math.max(Math.sin(a), 0.03);
    const z = -Math.cos(a) * 0.3;
    // a heavier rump, a narrower chest
    rings.push({ p: [0, z * 0.25, z], rx: (0.25 - z * 0.12) * s, ry: (0.24 - z * 0.06) * s });
  }
  body.loft(rings, 10);
  body.paint = () => D;
  for (const s of [-1, 1]) body.tube([s * 0.14, -0.1, 0.16], [s * 0.2, -0.2, 0.2], 0.03, 0.025, 5); // arms
  body.loft(
    [
      { p: [0, 0.06, -0.26], rx: 0.05, ry: 0.05 },
      { p: [0, 0.1, -0.38], rx: 0.015, ry: 0.015 },
    ],
    5,
  ); // the tail nub

  const stalk = new Mesher();
  stalk.paint = () => D;
  stalk.loft(
    [
      { p: [0, 0, 0], rx: 0.024, ry: 0.024 },
      { p: [0, 0.14, 0.015], rx: 0.016, ry: 0.016 },
      { p: [0, 0.26, 0.02], rx: 0.016, ry: 0.016 },
    ],
    5,
  );
  stalk.glow = () => 1;
  stalk.paint = () => [0.75, 0.7, 0.65];
  stalk.blob([0, 0.29, 0.02], 0.044, 0.044, 0.044, 7);
  stalk.glow = () => 0;

  const feet = new Mesher();
  feet.paint = () => D;
  feet.loft(
    [
      { p: [0, 0.03, -0.09], rx: 0.055, ry: 0.035 },
      { p: [0, 0.03, 0.07], rx: 0.07, ry: 0.04 },
      { p: [0, 0.02, 0.17], rx: 0.04, ry: 0.024 },
    ],
    6,
  );

  return [
    { name: 'body', geo: body.build(), n: 1, cast: true, hit: true },
    { name: 'stalk', geo: stalk.build(), n: 2, cast: false, hit: false },
    { name: 'foot', geo: feet.build(), n: 2, cast: false, hit: false },
  ];
};

/* ---------- birds ---------- */

export type BirdStyle = 'soar' | 'bound';

/**
 * A bird with its nose at -z. aRig: (span, side, leg); span is 0 at the
 * shoulder and 1 at the tip. aGlow carries the head weight here.
 */
export const birdMesh = (style: BirdStyle, color: string, tipC: string, bellyC: string) => {
  const C = rgb(color);
  const T = rgb(tipC);
  const B = rgb(bellyC);
  const beak: RGB = style === 'soar' ? rgb('#d9a441') : rgb('#39302a');
  const m = new Mesher();
  const span = style === 'soar' ? 0.72 : 0.36;
  const chord = style === 'soar' ? 0.15 : 0.15;

  m.paint = (_x, y) => (y < 0 ? B : C);
  m.loft(
    [
      { p: [0, 0.005, 0.2], rx: 0.015, ry: 0.012 },
      { p: [0, 0.0, 0.1], rx: 0.04, ry: 0.038 },
      { p: [0, 0.0, -0.03], rx: 0.06, ry: 0.058 },
      { p: [0, 0.015, -0.13], rx: 0.04, ry: 0.043 },
    ],
    7,
  );
  m.glow = (_x, _y, z) => (z < -0.13 ? 1 : 0);
  m.loft(
    [
      { p: [0, 0.015, -0.12], rx: 0.03, ry: 0.032 },
      { p: [0, 0.038, -0.18], rx: 0.04, ry: 0.038 },
      { p: [0, 0.03, -0.235], rx: 0.016, ry: 0.015 },
    ],
    6,
  );
  m.paint = () => beak;
  m.tube([0, 0.03, -0.228], [0, 0.022, -0.3], 0.011, 0.002, 4);
  m.glow = () => 0;

  // tail fan
  m.paint = () => mixRgb(C, T, 0.5);
  m.sheet(3, 1, (u, v) => [(u - 0.5) * 0.12 * (0.6 + v * 0.8), 0, 0.14 + v * (style === 'soar' ? 0.14 : 0.22)]);

  // legs tuck into the body in flight and unfold when perched
  m.paint = () => rgb('#2a2018');
  m.rig = () => [0, 0, 1];
  for (const s of [-1, 1]) m.tube([s * 0.022, -0.03, 0.02], [s * 0.022, -0.16, 0.0], 0.006, 0.005, 3);
  m.rig = () => [0, 0, 0];

  // wings: a broad arm then a tapering hand, with feather tips along the trailing edge
  for (const s of [-1, 1]) {
    m.paint = (x, y, z) => {
      const u = Math.min(1, Math.abs(x) / span);
      const c = y < -0.002 ? B : C;
      return mixRgb(c, T, THREE.MathUtils.smoothstep(u, style === 'soar' ? 0.72 : 0.55, 0.92) * (z > 0 || style === 'soar' ? 1 : 0.5));
    };
    m.rig = (x) => [Math.min(1, Math.abs(x) / span), s, 0];
    m.sheet(5, 2, (u, v) => {
      const lead = -0.07 + 0.04 * u + 0.16 * u * u;
      const tips = v > 0.99 ? 0.012 * Math.sin(u * 28) : 0;
      const w = chord * (1 - 0.72 * u * u);
      return [s * (0.03 + u * span), 0, lead + v * (w * 1.3 + tips)];
    });
    m.rig = () => [0, 0, 0];
  }
  return m.build();
};

/* ---------- skitterers ---------- */

export type SkitterKind = 'lizard' | 'crab' | 'ember';

/**
 * A small creature in one mesh, moved in the vertex shader.
 * aRig: (limb phase, limb weight, spine); spine runs -1 head to 1 tail,
 * and 2 marks the crab's claws (with the side in limb phase).
 */
export const skitterMesh = (kind: SkitterKind, color: string) => {
  const C = rgb(color);
  const m = new Mesher();
  const P = Math.PI;
  if (kind === 'crab') {
    const shell = mixRgb(C, rgb('#7c67a8'), 0.2);
    const under = mixRgb(C, [0, 0, 0], 0.45);
    m.paint = (_x, y) => (y > 0.09 ? shell : under);
    // spots along the carapace rim glow at night
    m.glow = (x, y, z) => (y > 0.11 && Math.abs(Math.hypot(x, z) - 0.095) < 0.02 && Math.sin(Math.atan2(z, x) * 7) > 0.45 ? 1 : 0.02);
    m.loft(
      [
        { p: [0, 0.075, -0.1], rx: 0.03, ry: 0.02 },
        { p: [0, 0.085, -0.075], rx: 0.1, ry: 0.038 },
        { p: [0, 0.095, 0.03], rx: 0.135, ry: 0.052 },
        { p: [0, 0.085, 0.085], rx: 0.1, ry: 0.035 },
        { p: [0, 0.075, 0.1], rx: 0.025, ry: 0.015 },
      ],
      10,
    );
    m.glow = () => 0;
    m.paint = () => under;
    for (const s of [-1, 1]) {
      // three walking legs a side, knees up, feet out; alternate legs step together
      for (let k = 0; k < 3; k += 1) {
        const z = -0.06 + k * 0.05;
        const ph = (k % 2 ? P : 0) + (s > 0 ? 0 : P);
        const foot0: V3 = [s * 0.25, 0.005, z * 1.5];
        const knee: V3 = [s * 0.18, 0.13, z * 1.2];
        const hip: V3 = [s * 0.1, 0.075, z];
        m.rig = () => [ph, 0.35, 0];
        m.tube(hip, knee, 0.012, 0.009, 4);
        m.rig = () => [ph, 1, 0];
        m.tube(knee, foot0, 0.009, 0.003, 4);
      }
      // eyes on short stalks, and a claw held up in front
      m.rig = () => [0, 0, 0];
      m.tube([s * 0.03, 0.11, 0.09], [s * 0.04, 0.15, 0.1], 0.006, 0.005, 3);
      m.paint = () => [0.02, 0.015, 0.03];
      m.glow = () => 1;
      m.blob([s * 0.04, 0.155, 0.1], 0.013, 0.013, 0.013, 4);
      m.glow = () => 0;
      m.paint = () => shell;
      m.rig = () => [s, 1, 2];
      m.tube([s * 0.1, 0.085, 0.085], [s * 0.16, 0.1, 0.16], 0.015, 0.018, 5);
      m.blob([s * 0.17, 0.11, 0.2], 0.042, 0.03, 0.055, 6);
      m.tube([s * 0.17, 0.115, 0.22], [s * 0.14, 0.13, 0.28], 0.016, 0.003, 4);
      m.tube([s * 0.2, 0.1, 0.22], [s * 0.22, 0.1, 0.28], 0.013, 0.003, 4);
      m.rig = () => [0, 0, 0];
      m.paint = () => under;
    }
    return m.build();
  }
  const ember = kind === 'ember';
  const dark = mixRgb(C, [0, 0, 0], 0.4);
  const pale = ember ? C : mixRgb(C, rgb('#d9c4a0'), 0.55);
  // spine runs head -1 to tail 1 along z (nose at +z, tail at -z)
  const LEN = ember ? 0.56 : 0.5;
  const spineOf = (z: number) => Math.max(-1, Math.min(1, -z / LEN));
  m.rig = (_x, _y, z) => [0, 0, spineOf(z)];
  m.paint = (x, y, z) => {
    if (y < 0.03) return pale;
    // a banded back
    return Math.sin(z * 34) > 0.35 && Math.abs(x) < 0.05 ? dark : C;
  };
  m.glow = (x, y, z) => (ember && (y < 0.03 || (Math.sin(z * 34) > 0.65 && Math.abs(x) < 0.03)) ? 0.8 : 0);
  // head to tail: a blunt wedge, slim neck, wide belly, then a long whip of a tail
  const trunk: Ring[] = [
    { p: [0, 0.05, 0.28], rx: 0.012, ry: 0.012 },
    { p: [0, 0.055, 0.24], rx: 0.038, ry: 0.024 },
    { p: [0, 0.055, 0.18], rx: 0.048, ry: 0.03 },
    { p: [0, 0.05, 0.12], rx: 0.038, ry: 0.024 },
    { p: [0, 0.05, 0.03], rx: 0.062, ry: 0.034 },
    { p: [0, 0.05, -0.1], rx: 0.058, ry: 0.032 },
    { p: [0, 0.045, -0.2], rx: 0.03, ry: 0.021 },
  ];
  const tail: Ring[] = [];
  const tailZ0 = -0.2;
  const tailLen = ember ? 0.5 : 0.36;
  for (let i = 1; i <= 7; i += 1) {
    const u = i / 7;
    tail.push({
      p: [ember ? 0.05 * Math.sin(u * 3) : 0, 0.04 - u * 0.012, tailZ0 - u * tailLen],
      rx: 0.024 * (1 - u) + 0.002,
      ry: 0.018 * (1 - u) + 0.002,
    });
  }
  m.loft([...trunk, ...tail], 7);
  // eyes, and on the ember a frill behind the jaw
  m.paint = () => [0.03, 0.02, 0.01];
  m.glow = () => (ember ? 1.2 : 0);
  for (const s of [-1, 1]) m.blob([s * 0.04, 0.078, 0.2], 0.009, 0.01, 0.01, 4);
  m.glow = () => 0;
  if (ember) {
    m.paint = () => dark;
    m.glow = () => 0.5;
    m.rig = (_x, _y, z) => [0, 0, spineOf(z)];
    for (const s of [-1, 1]) {
      m.sheet(3, 1, (u, v) => {
        const a = 0.25 + u * 1.1;
        const r = 0.05 + v * 0.07 * Math.sin(u * P);
        return [s * Math.sin(a) * r, 0.07 + Math.cos(a) * r * 0.6, 0.13 - u * 0.04];
      });
    }
    // low spines along the back
    m.glow = () => 0;
    for (let k = 0; k < 6; k += 1) {
      const z = 0.08 - k * 0.07;
      m.tube([0, 0.075, z], [0, 0.112 - k * 0.003, z - 0.02], 0.012, 0.002, 3);
    }
  }
  // four legs: alternate diagonals, elbows out, little splayed toes
  m.paint = (_x, y) => (y < 0.015 ? dark : C);
  m.glow = () => 0;
  const hips: [number, number, number][] = [
    [0.05, 0.05, 0.08],
    [-0.05, 0.05, 0.08],
    [0.05, 0.05, -0.1],
    [-0.05, 0.05, -0.1],
  ];
  hips.forEach(([x, y, z], k) => {
    const s = Math.sign(x);
    const ph = k === 0 || k === 3 ? 0 : P;
    const knee: V3 = [x + s * 0.06, y + 0.022, z + (z > 0 ? 0.02 : -0.02)];
    const footP: V3 = [x + s * 0.11, 0.005, z + (z > 0 ? 0.05 : -0.04)];
    m.rig = () => [ph, 0.45, spineOf(z)];
    m.tube([x, y, z], knee, 0.012, 0.008, 3);
    m.rig = () => [ph, 1, spineOf(z)];
    m.tube(knee, footP, 0.008, 0.004, 3);
    for (const toe of [-1, 0, 1]) m.tube(footP, [footP[0] + s * 0.02, 0.002, footP[2] + toe * 0.02], 0.003, 0.001, 3);
  });
  return m.build();
};

/* ---------- jellies ---------- */

/** One bell: dome with a scalloped margin and four gonad lobes. aRig: (margin, 0, 0) */
export const jellyBell = () => {
  const m = new Mesher();
  m.paint = (_x, y) => {
    const k = 0.55 + (0.5 - y) * 0.9;
    return [k, k, k];
  };
  m.rig = (_x, y) => [Math.max(0, Math.min(1, 1 - y / 0.55)), 0, 0];
  const dome = (r0: number, h0: number) => (u: number, v: number): V3 => {
    const a = u * Math.PI * 2;
    const b = v * (Math.PI * 0.62);
    const r = r0 * Math.sin(b) * (v > 0.75 ? 1 + 0.05 * Math.cos(a * 8) : 1);
    return [Math.cos(a) * r, h0 * Math.cos(b) - 0.05, Math.sin(a) * r];
  };
  m.sheet(20, 7, dome(0.62, 0.52));
  // the inner subumbrella, seen through the bell
  m.paint = () => [0.45, 0.45, 0.5];
  m.sheet(14, 4, dome(0.5, 0.4));
  // gonads: four soft horseshoes glowing inside the top
  m.paint = () => [1.5, 1.35, 1.55];
  for (let k = 0; k < 4; k += 1) {
    const a = (k / 4) * Math.PI * 2 + 0.4;
    m.blob([Math.cos(a) * 0.17, 0.2, Math.sin(a) * 0.17], 0.07, 0.04, 0.07, 6);
  }
  return m.build();
};

/** Tentacles as thin ribbons. aRig: (along 0..1, ring angle, frilly oral arm 1 or margin tentacle 0) */
export const jellyTentacles = () => {
  const m = new Mesher();
  const ribbon = (a: number, r: number, len: number, w: number, frill: number, seed: number) => {
    m.rig = (x, y) => [Math.max(0, Math.min(1, -(y + 0.08) / len)), a + seed, frill + x * 0];
    m.paint = (_x, y) => {
      const t = Math.max(0, Math.min(1, -(y + 0.08) / len));
      const k = (frill ? 0.9 : 0.75) * (1 - t * 0.75);
      return [k, k, k];
    };
    m.sheet(frill ? 12 : 8, 1, (u, v) => {
      const hw = w * (1 - u * 0.75);
      const f = frill ? Math.sin(u * 22 + seed) * 0.05 * u : 0;
      return [Math.cos(a) * (r + f) + (v - 0.5) * 2 * hw * -Math.sin(a), -0.08 - u * len, Math.sin(a) * (r + f) + (v - 0.5) * 2 * hw * Math.cos(a)];
    });
  };
  for (let k = 0; k < 10; k += 1) ribbon((k / 10) * Math.PI * 2, 0.46, 1.2 + (k % 3) * 0.32, 0.016, 0, k * 1.7);
  for (let k = 0; k < 4; k += 1) ribbon((k / 4) * Math.PI * 2 + 0.3, 0.1, 1.1 + (k % 2) * 0.3, 0.05, 1, k * 2.3);
  return m.build();
};

/** How far a jelly's bell has contracted at a cycle position: a quick squeeze, a slow release */
export const jellyContract = (c: number) => {
  const f = c - Math.floor(c);
  if (f < 0.28) {
    const u = f / 0.28;
    return u * u * (3 - 2 * u);
  }
  const u = (f - 0.28) / 0.72;
  return 1 - u * u * (3 - 2 * u);
};
