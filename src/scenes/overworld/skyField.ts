import * as THREE from 'three';

/*
 * The shape of the galaxy, shared by the baked sky and the star catalogue so
 * that dark lanes in the gas are also empty of stars. The lane field is a sum
 * of sines because that is the one noise that is identical in GLSL and JS.
 */

/** Pole of the galactic plane */
export const GALAXY_AXIS = new THREE.Vector3(0.45, 0.88, 0.12).normalize();

/** Where the eye rests: the middle of the window, around the planets */
export const REST_DIR = new THREE.Vector3(0, 0.05, -1).normalize();

// kx, ky, kz, phase, amplitude
const WAVES: [number, number, number, number, number][] = [
  [2.1, 1.3, -1.7, 0.4, 0.34],
  [-3.7, 2.2, 2.9, 2.1, 0.26],
  [5.3, -4.1, 3.2, 4.3, 0.2],
  [-7.9, 3.4, -6.1, 1.2, 0.12],
  [11.3, 8.2, 5.7, 5.5, 0.08],
];
const WARP_SCALE = 0.07;
const LANE_SHARPNESS = 62;

const glslFloat = (x: number) => (Number.isInteger(x) ? `${x}.0` : `${x}`);

export const LANE_GLSL = /* glsl */ `
  float laneWaves(vec3 d) {
    return ${WAVES.map(
      ([x, y, z, p, a]) => `${glslFloat(a)} * sin(dot(d, vec3(${glslFloat(x)}, ${glslFloat(y)}, ${glslFloat(z)})) + ${glslFloat(p)})`,
    ).join('\n      + ')};
  }
  // detail is an fbm value in 0..1 that roughens the edge of the lane
  float dustLane(vec3 d, float lat, float detail) {
    float v = laneWaves(d);
    float wl = lat + v * ${glslFloat(WARP_SCALE)};
    float edge = smoothstep(-0.1, 0.55, v + (detail - 0.5) * 0.9);
    return edge * exp(-wl * wl * ${glslFloat(LANE_SHARPNESS)});
  }
`;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Opacity of the dust lanes along a unit direction, without the fine detail of the bake. */
export const dustOpacity = (d: THREE.Vector3) => {
  let v = 0;
  for (const [x, y, z, p, a] of WAVES) v += a * Math.sin(d.x * x + d.y * y + d.z * z + p);
  const wl = d.dot(GALAXY_AXIS) + v * WARP_SCALE;
  return smooth(-0.1, 0.55, v) * Math.exp(-wl * wl * LANE_SHARPNESS);
};

export const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
