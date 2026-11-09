import * as THREE from 'three';

/** Specks per panel */
const COUNT = 220;

/**
 * Specks that crackle off a hologram panel's eroded border: each is born on the
 * outline, drifts outward on its own speed and wobble, and fades over its own
 * lifetime, so they thin out at scattered distances instead of along one line.
 * Positions live in the panel's local plane (z = 0), so they ride along with it.
 */
export interface HoloSparks {
  points: THREE.Points;
  geo: THREE.BufferGeometry;
  mat: THREE.ShaderMaterial;
  vel: Float32Array;
  age: Float32Array;
  life: Float32Array;
  started: boolean;
}

const vert = /* glsl */ `
  attribute float aAlpha;
  attribute float aSize;
  uniform float uViewH;
  varying float vA;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(aSize * projectionMatrix[1][1] * uViewH / max(-mv.z, 0.01), 1.5, 4.0);
    vA = aAlpha;
  }
`;

const frag = /* glsl */ `
  uniform vec3 uColor;
  varying float vA;
  void main() {
    // crisp square specks, like single pixels of static
    if (vA < 0.003) discard;
    gl_FragColor = vec4(uColor, vA);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export const holoSparks = (color: THREE.Color): HoloSparks => {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(COUNT * 3), 3));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(COUNT), 1));
  const size = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i += 1) size[i] = 0.0045 + Math.random() * 0.002;
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  const mat = new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    fog: false,
    uniforms: { uColor: { value: color.clone() }, uViewH: { value: 500 } },
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 6;
  return {
    points,
    geo,
    mat,
    vel: new Float32Array(COUNT * 2),
    age: new Float32Array(COUNT),
    life: new Float32Array(COUNT),
    started: false,
  };
};

/** The panel's current outline, as the hologram shader draws it */
export interface SparkShape {
  poly: THREE.Vector2[];
  n: number;
  /** How far the panel has opened into a rounded screen, 0..1 */
  m: number;
  half: THREE.Vector2;
  rad: number;
  /** Width of the eroded border; specks start somewhere inside it */
  edge: number;
}

const spawn = (s: HoloSparks, i: number, sh: SparkShape) => {
  const pa = s.geo.getAttribute('position') as THREE.BufferAttribute;
  // a point on the outline, edges picked by length
  let total = 0;
  for (let k = 0; k < sh.n; k += 1) total += sh.poly[k].distanceTo(sh.poly[(k + 1) % sh.n]);
  if (total < 1e-5) return;
  let r = Math.random() * total;
  let k = 0;
  for (; k < sh.n - 1; k += 1) {
    const l = sh.poly[k].distanceTo(sh.poly[(k + 1) % sh.n]);
    if (r <= l) break;
    r -= l;
  }
  const a = sh.poly[k];
  const b = sh.poly[(k + 1) % sh.n];
  const len = Math.max(a.distanceTo(b), 1e-6);
  const u = Math.min(1, r / len);
  let px = a.x + (b.x - a.x) * u;
  let py = a.y + (b.y - a.y) * u;
  // outward normal (outlines wind counter-clockwise)
  let nx = (b.y - a.y) / len;
  let ny = -(b.x - a.x) / len;
  // an open screen has rounded corners: put corner specks on the arc
  if (sh.m > 0.6 && sh.rad > 0) {
    const qx = Math.abs(px) - (sh.half.x - sh.rad);
    const qy = Math.abs(py) - (sh.half.y - sh.rad);
    if (qx > 0 && qy > 0) {
      const l = Math.hypot(qx, qy);
      nx = (Math.sign(px) * qx) / l;
      ny = (Math.sign(py) * qy) / l;
      px = Math.sign(px) * (sh.half.x - sh.rad) + nx * sh.rad;
      py = Math.sign(py) * (sh.half.y - sh.rad) + ny * sh.rad;
    }
  }
  const depth = Math.random() * sh.edge * 0.8;
  pa.setXYZ(i, px - nx * depth, py - ny * depth, 0);
  // mostly slow, a few fast: the distance each one covers before it fades varies widely
  const speed = 0.008 + Math.pow(Math.random(), 2) * 0.05;
  const side = (Math.random() - 0.5) * 0.6 * speed;
  s.vel[i * 2] = nx * speed - ny * side;
  s.vel[i * 2 + 1] = ny * speed + nx * side + Math.random() * 0.006;
  s.age[i] = 0;
  s.life[i] = 0.3 + Math.random() * Math.random() * 1.4;
};

const fade = (x: number) => Math.min(1, x / 0.08) * Math.pow(1 - x, 1.6);

export const updateSparks = (s: HoloSparks, sh: SparkShape, dt: number, viewH: number) => {
  const pa = s.geo.getAttribute('position') as THREE.BufferAttribute;
  const al = s.geo.getAttribute('aAlpha') as THREE.BufferAttribute;
  s.mat.uniforms.uViewH.value = viewH;
  for (let i = 0; i < COUNT; i += 1) {
    if (!s.started) {
      // first frame: start everyone partway through a life, so they never pulse in unison
      spawn(s, i, sh);
      const head = Math.random() * s.life[i];
      s.age[i] = head;
      pa.setXY(i, pa.getX(i) + s.vel[i * 2] * head, pa.getY(i) + s.vel[i * 2 + 1] * head);
    }
    s.age[i] += dt;
    if (s.age[i] >= s.life[i]) spawn(s, i, sh);
    // a little drag, a little wander, a slight lift
    const drag = 1 - 0.6 * dt;
    s.vel[i * 2] = s.vel[i * 2] * drag + (Math.random() - 0.5) * 0.1 * dt;
    s.vel[i * 2 + 1] = s.vel[i * 2 + 1] * drag + (Math.random() - 0.5) * 0.1 * dt + 0.006 * dt;
    pa.setXY(i, pa.getX(i) + s.vel[i * 2] * dt, pa.getY(i) + s.vel[i * 2 + 1] * dt);
    // static-like crackle: specks blink off and on as they go
    const flicker = Math.random() < 0.25 ? 0.15 : 1;
    al.setX(i, fade(Math.min(1, s.age[i] / s.life[i])) * 0.85 * flicker);
  }
  s.started = true;
  pa.needsUpdate = true;
  al.needsUpdate = true;
};

export const disposeSparks = (s: HoloSparks) => {
  s.geo.dispose();
  s.mat.dispose();
};
