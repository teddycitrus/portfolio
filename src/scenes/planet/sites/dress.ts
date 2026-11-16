import * as THREE from 'three';

/*
 * Set dressing for the built sites. Small parts are written into one geometry
 * per material with their colour in the vertices, so a site's fine detail
 * costs a handful of draw calls however many pieces it has.
 */

export type V3 = [number, number, number];
type Shade = (x: number, y: number, z: number) => number;

const _m = new THREE.Matrix4();
const _n = new THREE.Matrix3();
const _p = new THREE.Vector3();
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export const tone = (hex: string | THREE.Color, k = 1) => new THREE.Color(hex).multiplyScalar(k);

/** A repeatable random stream, so a site looks the same on every visit. */
export const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** Cheap position noise in 0..1, for weathering vertex colours. */
export const fleck = (x: number, y: number, z: number) => {
  const h = Math.sin(x * 37.1 + y * 91.7 + z * 53.3) * 43758.5453;
  return h - Math.floor(h);
};

export class Dress {
  private pos: number[] = [];
  private nor: number[] = [];
  private col: number[] = [];
  /** Every part is placed in this frame */
  origin = new THREE.Matrix4();

  frame(x: number, y: number, z: number, yaw = 0) {
    this.origin.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(0, yaw, 0)), _s.set(1, 1, 1));
    return this;
  }

  /** Copies a geometry in, then disposes it. */
  part(g: THREE.BufferGeometry, p: V3, c: THREE.Color, r?: V3, s?: V3 | number, shade?: Shade) {
    const sc = s === undefined ? [1, 1, 1] : typeof s === 'number' ? [s, s, s] : s;
    _m.compose(_p.set(p[0], p[1], p[2]), _q.setFromEuler(_e.set(r?.[0] ?? 0, r?.[1] ?? 0, r?.[2] ?? 0)), _s.set(sc[0], sc[1], sc[2]));
    _m.premultiply(this.origin);
    _n.getNormalMatrix(_m);
    const P = g.attributes.position;
    const N = g.attributes.normal;
    const index = g.index;
    const count = index ? index.count : P.count;
    for (let k = 0; k < count; k += 1) {
      const i = index ? index.getX(k) : k;
      const f = shade ? shade(P.getX(i), P.getY(i), P.getZ(i)) : 1;
      _v.fromBufferAttribute(P, i).applyMatrix4(_m);
      this.pos.push(_v.x, _v.y, _v.z);
      _v.fromBufferAttribute(N, i).applyMatrix3(_n);
      this.nor.push(_v.x, _v.y, _v.z);
      this.col.push(c.r * f, c.g * f, c.b * f);
    }
    g.dispose();
    return this;
  }

  box(w: number, h: number, d: number, p: V3, c: THREE.Color, r?: V3, shade?: Shade) {
    return this.part(new THREE.BoxGeometry(w, h, d), p, c, r, undefined, shade);
  }

  cyl(rt: number, rb: number, h: number, p: V3, c: THREE.Color, sides = 8, r?: V3, shade?: Shade) {
    return this.part(new THREE.CylinderGeometry(rt, rb, h, sides), p, c, r, undefined, shade);
  }

  /** A flat ring lying in the XZ plane by default. */
  torus(R: number, t: number, p: V3, c: THREE.Color, r: V3 = [Math.PI / 2, 0, 0], arc = Math.PI * 2, tubular = 12) {
    return this.part(new THREE.TorusGeometry(R, t, 4, tubular, arc), p, c, r);
  }

  /** An irregular stone. */
  lump(rad: number, p: V3, c: THREE.Color, r?: V3, s?: V3 | number) {
    return this.part(new THREE.DodecahedronGeometry(rad, 0), p, c, r, s);
  }

  /** A lathe from (radius, height) pairs. */
  lathe(profile: [number, number][], p: V3, c: THREE.Color, sides = 8, shade?: Shade) {
    return this.part(new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x, y)), sides), p, c, undefined, undefined, shade);
  }

  /** A round bar from a to b. */
  rod(a: V3, b: V3, r: number, c: THREE.Color, sides = 5) {
    _a.set(a[0], a[1], a[2]);
    _b.set(b[0], b[1], b[2]);
    const len = _a.distanceTo(_b);
    if (len < 1e-5) return this;
    const dir = _b.clone().sub(_a).divideScalar(len);
    const q = new THREE.Quaternion().setFromUnitVectors(UP, dir);
    const e = new THREE.Euler().setFromQuaternion(q);
    const mid: V3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    return this.part(new THREE.CylinderGeometry(r, r, len, sides, 1, true), mid, c, [e.x, e.y, e.z]);
  }

  private tri(a: V3, b: V3, d: V3, ca: THREE.Color, cb: THREE.Color, cd: THREE.Color) {
    const va = _p.set(a[0], a[1], a[2]).applyMatrix4(this.origin).clone();
    const vb = _v.set(b[0], b[1], b[2]).applyMatrix4(this.origin).clone();
    const vd = _a.set(d[0], d[1], d[2]).applyMatrix4(this.origin).clone();
    const n = _b.copy(vb).sub(va).cross(_s.copy(vd).sub(va)).normalize();
    this.pos.push(va.x, va.y, va.z, vb.x, vb.y, vb.z, vd.x, vd.y, vd.z);
    this.nor.push(n.x, n.y, n.z, n.x, n.y, n.z, n.x, n.y, n.z);
    this.col.push(ca.r, ca.g, ca.b, cb.r, cb.g, cb.b, cd.r, cd.g, cd.b);
  }

  /** A strip lying flat at height y from (ax, az) to (bx, bz), its colour running from ca to cb. */
  strip(ax: number, az: number, bx: number, bz: number, y: number, w: number, ca: THREE.Color, cb: THREE.Color = ca) {
    const len = Math.hypot(bx - ax, bz - az) || 1;
    const nx = (-(bz - az) / len) * w * 0.5;
    const nz = ((bx - ax) / len) * w * 0.5;
    const a0: V3 = [ax + nx, y, az + nz];
    const a1: V3 = [ax - nx, y, az - nz];
    const b0: V3 = [bx + nx, y, bz + nz];
    const b1: V3 = [bx - nx, y, bz - nz];
    this.tri(a0, b0, a1, ca, cb, ca);
    this.tri(b0, b1, a1, cb, cb, ca);
    return this;
  }

  /** A weld: a flat bead of alternating light and dark ripples. */
  weld(ax: number, az: number, bx: number, bz: number, y: number, w: number, light: THREE.Color, dark: THREE.Color, n: number) {
    for (let i = 0; i < n; i += 1) {
      const t0 = i / n;
      const t1 = (i + 1) / n;
      const c = i % 2 ? dark : light;
      this.strip(ax + (bx - ax) * t0, az + (bz - az) * t0, ax + (bx - ax) * t1, az + (bz - az) * t1, y, w * (i % 2 ? 0.8 : 1), c);
    }
    return this;
  }

  /** A small polygon lying flat: a rivet or a lamp lens seen from above. */
  dot(x: number, y: number, z: number, r: number, c: THREE.Color, sides = 6) {
    for (let i = 0; i < sides; i += 1) {
      const a0 = (i / sides) * Math.PI * 2;
      const a1 = ((i + 1) / sides) * Math.PI * 2;
      this.tri([x, y, z], [x + Math.sin(a0) * r, y, z + Math.cos(a0) * r], [x + Math.sin(a1) * r, y, z + Math.cos(a1) * r], c, c, c);
    }
    return this;
  }

  /** An upright lamp lens on a face looking along +z in the current frame. */
  lens(x: number, y: number, z: number, r: number, c: THREE.Color, sides = 6) {
    for (let i = 0; i < sides; i += 1) {
      const a0 = (i / sides) * Math.PI * 2;
      const a1 = ((i + 1) / sides) * Math.PI * 2;
      this.tri([x, y, z], [x + Math.cos(a0) * r, y + Math.sin(a0) * r, z], [x + Math.cos(a1) * r, y + Math.sin(a1) * r, z], c, c, c);
    }
    return this;
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    this.pos = [];
    this.nor = [];
    this.col = [];
    return g;
  }
}

/** Soft stains that fade out to nothing at their edge: soot, scorch, wear, contact shadow. */
export class Decals {
  private pos: number[] = [];
  private col: number[] = [];
  origin = new THREE.Matrix4();

  frame(x: number, y: number, z: number, yaw = 0) {
    this.origin.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(0, yaw, 0)), _s.set(1, 1, 1));
    return this;
  }

  private vert(x: number, y: number, z: number, c: THREE.Color, a: number) {
    _v.set(x, y, z).applyMatrix4(this.origin);
    this.pos.push(_v.x, _v.y, _v.z);
    this.col.push(c.r, c.g, c.b, a);
  }

  /** An ellipse on the plane through p spanned by u and v. Its winding faces u cross v. */
  fan(p: V3, u: V3, v: V3, c: THREE.Color, alpha: number, wobble = 0, seed = 0) {
    const n = 14;
    const rad = (i: number) => 1 + (wobble ? Math.sin(i * 2.4 + seed) * wobble + Math.sin(i * 5.1 + seed * 2) * wobble * 0.5 : 0);
    const at = (i: number) => {
      const a = (i / n) * Math.PI * 2;
      const k = rad(i % n);
      const cu = Math.cos(a) * k;
      const sv = Math.sin(a) * k;
      return [p[0] + u[0] * cu + v[0] * sv, p[1] + u[1] * cu + v[1] * sv, p[2] + u[2] * cu + v[2] * sv] as V3;
    };
    for (let i = 0; i < n; i += 1) {
      const e0 = at(i);
      const e1 = at(i + 1);
      this.vert(p[0], p[1], p[2], c, alpha);
      this.vert(e0[0], e0[1], e0[2], c, 0);
      this.vert(e1[0], e1[1], e1[2], c, 0);
    }
    return this;
  }

  /** A stain lying on the ground. */
  floor(x: number, y: number, z: number, rx: number, rz: number, c: THREE.Color, alpha: number, wobble = 0.12, seed = 0) {
    return this.fan([x, y, z], [0, 0, rz], [rx, 0, 0], c, alpha, wobble, seed);
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 4));
    this.pos = [];
    this.col = [];
    return g;
  }
}

/** The one material every decal batch uses. */
export const decalMaterial = () =>
  new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
