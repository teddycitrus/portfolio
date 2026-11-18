import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { useAppStore } from '@/state/useAppStore';
import { dustMaterial, linerMaterial, lightsMaterial } from './materials';
import { FRAME_DEPTH, HOLE, offsetPoly } from './shape';
import { cabinEnv } from './cabinEnv';

/*
 * The working life of the deck: hand-run conduit along the ceiling, with
 * clamps, a tap box and a tag on a cord.
 *
 * Everything is one merged lit mesh, one merged unlit mesh for lamps and
 * needles, one ruled strip lining the window cut and one point cloud of dust.
 * All motion is in the vertex shaders, driven by a single clock.
 *
 * Frame units stretch with the aspect ratio, so parts are authored around an
 * anchor and the vertex shaders refit them about it (uFit): a clamp stays
 * square on any screen while its position still tracks the window.
 */

const noRaycast = () => null;

type V3 = [number, number, number];

/** The wall's face */
const WALL_Z = -FRAME_DEPTH + 0.002;

const C = {
  steel: '#4a515d',
  steelDark: '#343a45',
  black: '#14171d',
  brass: '#5c4d37',
  cableB: '#5b4a33',
  cableC: '#2c3a4d',
  paper: '#4c483d',
  ink: '#2b2a26',
} as const;

const INK: V3 = [0.42, 0.8, 1.0];
const AMBER: V3 = [1.0, 0.68, 0.36];

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

const useDetailParts = (env: THREE.Texture) =>
  useMemo(() => {
    const kit = new Kit();
    const lamps = new Lamps();
    buildCeiling(kit, lamps);
    const kitGeo = kit.build();
    const lampGeo = lamps.build();
    const linerGeo = linerGeometry();
    const dustGeo = dustGeometry(54);

    // one set of shared uniforms: nothing here needs its own clock
    const uTime = { value: 0 };
    const uFit = { value: new THREE.Vector2(1, 1) };

    const kitMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      metalness: 0.5,
      roughness: 0.48,
      envMap: env,
      envMapIntensity: 1.4,
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
  }, [env]);

const ShipDetails = () => {
  const gl = useThree((s) => s.gl);
  const parts = useDetailParts(useMemo(() => cabinEnv(gl), [gl]));
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
