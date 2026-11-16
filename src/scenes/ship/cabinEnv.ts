import * as THREE from 'three';

/*
 * A tiny made-up surround for the deck's metal to reflect: a dark cabin, the
 * warm strip lamp overhead, the cold blue of the window ahead with the light
 * strip round it, and a faint warm bounce off the dash. Prefiltered once per
 * renderer; costs one cube lookup per pixel of metal.
 */

const VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  varying vec3 vDir;
  float sq(float x) { return x * x; }
  void main() {
    vec3 d = normalize(vDir);
    // the cabin: dark, a little cooler toward the window
    vec3 col = mix(vec3(0.012, 0.013, 0.016), vec3(0.01, 0.016, 0.03), smoothstep(0.2, -0.9, d.z));
    // the window ahead: deep space with a faint blue cast
    float win = smoothstep(-0.55, -0.8, d.z) * smoothstep(0.75, 0.45, abs(d.y + 0.05));
    col = mix(col, vec3(0.02, 0.035, 0.07), win);
    // the light strip round the aperture
    float rim = exp(-sq((-d.z - 0.7) / 0.05)) * smoothstep(0.85, 0.3, abs(d.y));
    col += vec3(0.35, 0.55, 1.0) * rim * 0.9;
    // the warm strip lamp overhead, long across the cabin
    float lamp = exp(-sq((d.y - 0.93) / 0.05)) * smoothstep(0.9, 0.2, abs(d.x));
    col += vec3(1.0, 0.78, 0.55) * lamp * 2.4;
    // the lit cabin behind the pilot, what the face of the bulkhead mostly sees
    float aft = smoothstep(-0.1, 0.5, d.z);
    col += vec3(1.0, 0.8, 0.62) * exp(-sq((d.y - 0.42) / 0.16)) * aft * 0.22;
    col += vec3(0.5, 0.62, 0.9) * exp(-sq((d.x + 0.55) / 0.2)) * smoothstep(0.6, 0.0, abs(d.y)) * aft * 0.06;
    // a soft warm bounce off the dash below
    col += vec3(0.08, 0.06, 0.045) * smoothstep(-0.2, -0.9, d.y);
    gl_FragColor = vec4(col, 1.0);
  }
`;

const cache = new WeakMap<THREE.WebGLRenderer, THREE.Texture>();

/** The deck's reflection map for this renderer, built on first use. */
export const cabinEnv = (gl: THREE.WebGLRenderer): THREE.Texture => {
  const hit = cache.get(gl);
  if (hit) return hit;
  const scene = new THREE.Scene();
  const geo = new THREE.SphereGeometry(10, 48, 24);
  const mat = new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FRAGMENT, side: THREE.BackSide, depthWrite: false });
  scene.add(new THREE.Mesh(geo, mat));
  const pmrem = new THREE.PMREMGenerator(gl);
  const tex = pmrem.fromScene(scene, 0.02).texture;
  pmrem.dispose();
  geo.dispose();
  mat.dispose();
  cache.set(gl, tex);
  return tex;
};
