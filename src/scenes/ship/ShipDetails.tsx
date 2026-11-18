import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { useAppStore } from '@/state/useAppStore';
import { dustMaterial, lightsMaterial } from './materials';
import { FLOOR_Y } from './shape';
import { cabinEnv } from './cabinEnv';

/*
 * The console's pedestal and the dust hanging in the cabin air.
 *
 * Everything is one merged lit mesh, one merged unlit mesh for lamps and one
 * point cloud of dust.
 * All motion is in the vertex shaders, driven by a single clock.
 *
 * Frame units stretch with the aspect ratio, so parts are authored around an
 * anchor and the vertex shaders refit them about it (uFit): the pedestal's
 * foot stays round on any screen while its position still tracks the view.
 */

const noRaycast = () => null;

type V3 = [number, number, number];

const C = {
  steel: '#4a515d',
  steelDark: '#343a45',
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

/** The console's pedestal: a collar behind the display, one rod down to a foot on the floor. */
const buildPedestal = (k: Kit, l: Lamps) => {
  const z = -0.5;
  const top = -0.468;
  k.at(0, top, z - 0.002, -0.32);
  k.box(0.09, 0.018, 0.012, [0, 0, 0], C.steelDark);
  k.cable([[0, top, z - 0.004], [0, FLOOR_Y + 0.01, z - 0.004]], 0.0062, C.steel);
  k.at(0, FLOOR_Y, z - 0.004);
  k.cyl(0.042, 0.007, [0, 0.0035, 0], C.steelDark, undefined, 24, 0.038);
  k.cyl(0.013, 0.022, [0, 0.016, 0], C.steel, undefined, 12, 0.008);
  // status lights round the foot, keeping their own time
  l.at(0, FLOOR_Y + 0.0075, z - 0.004, -Math.PI / 2);
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2;
    l.lamp(Math.cos(a) * 0.028, Math.sin(a) * 0.028, 0.0016, i % 3 === 0 ? AMBER : INK, 19 + i * 7.3, i * 0.31, 0.7, 0.0004);
  }
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
    buildPedestal(kit, lamps);
    const kitGeo = kit.build();
    const lampGeo = lamps.build();
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
    const dustMat = dustMaterial(uTime);
    return { kitGeo, lampGeo, dustGeo, kitMat, lampMat, dustMat, uTime, uFit };
  }, [env]);

const ShipDetails = () => {
  const gl = useThree((s) => s.gl);
  const parts = useDetailParts(useMemo(() => cabinEnv(gl), [gl]));
  const size = useThree((s) => s.size);
  const lastAspect = useRef(0);

  useEffect(
    () => () => {
      for (const g of [parts.kitGeo, parts.lampGeo, parts.dustGeo]) g.dispose();
      for (const m of [parts.kitMat, parts.lampMat, parts.dustMat]) m.dispose();
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
      <mesh geometry={parts.kitGeo} material={parts.kitMat} raycast={noRaycast} renderOrder={31} frustumCulled={false} />
      <mesh geometry={parts.lampGeo} material={parts.lampMat} raycast={noRaycast} renderOrder={32} frustumCulled={false} />
      <points geometry={parts.dustGeo} material={parts.dustMat} raycast={noRaycast} renderOrder={33} frustumCulled={false} />
    </>
  );
};

export default ShipDetails;
