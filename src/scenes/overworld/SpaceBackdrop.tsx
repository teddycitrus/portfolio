import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { planets } from '@/data/content';
import { useAppStore } from '@/state/useAppStore';
import { GALAXY_AXIS, LANE_GLSL, REST_DIR } from './skyField';
import { bakeHash, isBaked, layerSlice, saveBaked, takeBaked, useBakedReady } from './bakedMaps';

const MAX_MARKS = 6;
/** How much further the foreground veil swings than the sky behind it */
const VEIL_PARALLAX = 0.05;
/** Radians per second */
const VEIL_DRIFT = 0.0012;

const BAKE_VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const BAKE_FRAGMENT = /* glsl */ `
  precision highp float;
  #define ENCODE_GAIN 24.0
  #define MAX_MARKS ${MAX_MARKS}
  uniform vec3 uAxis;
  uniform vec3 uCore;
  uniform vec3 uRest;
  uniform float uScale;
  uniform int uMarkCount;
  uniform vec3 uMarkDir[MAX_MARKS];
  uniform vec3 uMarkTint[MAX_MARKS];
  // Loop bounds go through uLoop (always 1) so Direct3D's shader compiler, which Chrome uses on
  // Windows, cannot unroll them: unrolled and inlined, these shaders take it most of a minute.
  uniform int uLoop;
  varying vec3 vDir;

  float sq(float x) { return x * x; }
  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }
  vec3 hash33(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.xxy + p.yxx) * p.zyx);
  }
  float noise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x),
          mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x),
          mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 6 * uLoop; i++) { v += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; }
    return v;
  }
  float ridge(float n) { return 1.0 - abs(2.0 * n - 1.0); }
  ${LANE_GLSL}

  // A gas complex centred on direction c: billowing body, thin ionised sheets along its folds,
  // cold dust in front of it. Returns light; absorb says how much of what is behind is hidden.
  vec3 nebula(vec3 d, vec3 c, float spread, vec3 hot, vec3 cool, float seed, out float absorb) {
    absorb = 0.0;
    float a = dot(d, normalize(c));
    float region = exp(-sq((1.0 - a) / spread));
    if (region < 0.002) return vec3(0.0);
    vec3 p = d * 2.2 + seed;
    vec3 w = p + vec3(fbm(p * 1.3), fbm(p * 1.3 + 5.2), fbm(p * 1.3 + 9.7)) * 1.6;
    vec3 w2 = w + vec3(fbm(w * 1.9 + 3.1), fbm(w * 1.9 + 8.4), fbm(w * 1.9 + 1.7)) * 0.55;
    float body = smoothstep(0.25, 0.78, fbm(w * 0.7 + 2.0));
    float gas = smoothstep(0.34, 0.88, fbm(w2 * 1.4));
    float fold = ridge(fbm(w2 * 2.1 + 6.0));
    float sheet = smoothstep(0.72, 0.99, fold) * smoothstep(0.2, 0.6, body);
    float knots = smoothstep(0.58, 0.95, fbm(w2 * 4.0 + 1.0));
    knots *= knots;
    float dustN = fbm(w2 * 2.3 + 11.0);
    float dust = smoothstep(0.47, 0.7, dustN);
    // the edge of a dark cloud catches light
    float rimLit = smoothstep(0.36, 0.47, dustN) * (1.0 - smoothstep(0.47, 0.56, dustN));
    float m = (gas * 0.62 + body * 0.34 + sheet * 0.5 + knots * 0.7 + rimLit * 0.28 * body) * region * (1.0 - 0.86 * dust);
    float temp = smoothstep(0.32, 0.8, fbm(w * 0.9 + 4.0));
    vec3 tint = mix(cool, hot, temp);
    // a little oxygen teal in the thin gas far from the hot cores
    tint = mix(tint, vec3(0.3, 0.62, 0.72), 0.3 * (1.0 - temp) * smoothstep(0.1, 0.5, gas) * (1.0 - body));
    absorb = dust * region * 0.8;
    return tint * m + hot * knots * region * 0.5 * (1.0 - dust);
  }

  // Unresolved stars about a texel wide: density follows the galaxy, dust hides them
  float starDust(vec3 d, float scale, float density, float sharp) {
    vec3 p = d * scale;
    vec3 i = floor(p);
    float h = hash13(i + 0.37);
    float cut = 1.0 - density;
    if (h < cut) return 0.0;
    vec3 c = 0.3 + 0.4 * hash33(i);
    float e = (h - cut) / max(density, 1e-4);
    return exp(-dot(p - i - c, p - i - c) * sharp) * (0.25 + 0.75 * e * e);
  }

  void main() {
    vec3 d = normalize(vDir);
    float lat = dot(d, uAxis);

    // deep space is not pure black: a faint floor, blue near the galaxy, with slow changes of hue
    vec3 col = mix(vec3(0.0028, 0.0034, 0.0062), vec3(0.0016, 0.0019, 0.0034), smoothstep(0.0, 0.7, abs(lat)));
    float sway = fbm(d * 1.5 + 21.0);
    col *= 0.78 + 0.55 * sway;
    col += vec3(0.0009, 0.0005, 0.0014) * smoothstep(0.42, 0.78, fbm(d * 2.7 + 3.0));

    vec3 w = d * 3.0 + vec3(fbm(d * 2.0), fbm(d * 2.0 + 7.3), fbm(d * 2.0 + 13.7)) * 1.2;
    float wl = lat + (fbm(d * 3.5 + 3.1) - 0.5) * 0.12;

    // the galactic band: a broad glow and a contrasty core of star clouds
    float wide = exp(-wl * wl * 14.0);
    float narrow = exp(-wl * wl * 70.0);
    float clouds = smoothstep(0.35, 0.85, fbm(w * 2.4));
    float grain = smoothstep(0.35, 0.75, noise(d * 70.0)) * 0.6 + smoothstep(0.4, 0.8, noise(d * 160.0)) * 0.4;
    float band = wide * 0.22 + narrow * (0.25 + 1.0 * clouds) * (0.55 + 0.45 * grain);

    // dark lanes along the plane, with fine tendrils peeling off them
    float lane = dustLane(d, lat, fbm(w * 3.2 + 5.0));
    float tendril = smoothstep(0.74, 0.98, ridge(fbm(w * 6.5 + 2.0))) * exp(-wl * wl * 30.0);
    lane = clamp(lane + tendril * 0.45, 0.0, 1.0);
    band *= 1.0 - 0.92 * lane;

    // blue-violet arms, warm toward the core
    float core = pow(max(dot(d, uCore), 0.0), 18.0);
    vec3 tint = mix(vec3(0.62, 0.7, 1.0), vec3(1.0, 0.86, 0.7), clamp(core * 1.3, 0.0, 1.0));
    tint = mix(tint, vec3(0.78, 0.66, 1.0), 0.25 * clouds * (1.0 - core));
    col += tint * (band * 0.02 + core * narrow * 0.02 * (1.0 - 0.7 * lane));

    // the sky's own faint stars, thick in the band and absent in the lanes
    float crowd = clamp(wide * 0.5 + narrow * 0.6, 0.0, 1.0) * (1.0 - lane);
    float dustA = starDust(d, 110.0 * uScale, 0.1 + 0.34 * crowd, 2.6);
    float dustB = starDust(d + 3.1, 230.0 * uScale, 0.1 + 0.5 * crowd, 1.8);
    vec3 starTint = mix(vec3(1.0, 0.88, 0.76), vec3(0.74, 0.84, 1.0), hash13(floor(d * 60.0)));
    col += starTint * (dustA * 0.011 + dustB * 0.0055);

    // the gas frames the window and stays out of the middle, where the planets are
    float rest = smoothstep(0.015, 0.2, 1.0 - dot(d, uRest));
    float gain = mix(0.3, 1.0, rest);
    // four complexes, in a loop so the compiler keeps one copy of the nebula, not four
    const vec3 NEB_DIR[4] = vec3[4](vec3(-0.66, -0.34, -1.0), vec3(0.78, 0.4, -1.0), vec3(0.05, 0.05, -1.0), vec3(1.0, -0.42, -0.6));
    const vec3 NEB_HOT[4] = vec3[4](vec3(1.0, 0.44, 0.58), vec3(0.4, 0.82, 0.95), vec3(0.6, 0.42, 1.0), vec3(1.0, 0.5, 0.3));
    const vec3 NEB_COOL[4] = vec3[4](vec3(0.42, 0.26, 0.9), vec3(0.2, 0.32, 0.9), vec3(0.14, 0.2, 0.55), vec3(0.8, 0.3, 0.5));
    // spread, seed, brightness, how much of the sky behind its dust hides
    const vec4 NEB_K[4] = vec4[4](vec4(0.16, 1.7, 0.038, 0.62), vec4(0.13, 6.3, 0.03, 0.62), vec4(0.32, 9.1, 0.011, 0.4), vec4(0.08, 3.4, 0.026, 0.62));
    for (int k = 0; k < 4 * uLoop; k++) {
      float ab;
      vec3 em = nebula(d, NEB_DIR[k], NEB_K[k].x, NEB_HOT[k], NEB_COOL[k], NEB_K[k].y, ab) * NEB_K[k].z;
      col = col * (1.0 - NEB_K[k].w * ab * gain) + em * gain;
    }

    // each body of work colours its part of the sky, and the sky falls away right behind it
    for (int i = 0; i < uMarkCount; i++) {
      float near = max(1.0 - dot(d, uMarkDir[i]), 0.0);
      float sector = exp(-near / 0.09) * (1.0 - exp(-near / 0.012));
      col += uMarkTint[i] * sector * (0.0009 + 0.002 * sway * sway);
      col *= 1.0 - 0.38 * exp(-near / 0.04);
    }

    // a foreground veil, kept in alpha and laid over the sky at display time
    float veil = smoothstep(0.5, 0.82, fbm(d * 3.1 + 40.0)) * smoothstep(0.35, 0.9, ridge(fbm(w * 0.8 + 27.0)));

    // Gamma-encode with gain so the dark gradients keep precision in an 8-bit cube face
    gl_FragColor = vec4(pow(max(col, 0.0) * ENCODE_GAIN, vec3(1.0 / 2.2)), sqrt(clamp(veil, 0.0, 1.0)));
  }
`;

const DISPLAY_VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Cheap per-frame pass: decode the baked sky, lay the veil over it from a slightly different
// direction so it slides against the sky, and dither so 8-bit output never bands
const DISPLAY_FRAGMENT = /* glsl */ `
  uniform samplerCube uSky;
  uniform mat3 uVeilRot;
  varying vec3 vDir;
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  void main() {
    vec3 d = normalize(vDir);
    vec3 col = pow(textureCube(uSky, d).rgb, vec3(2.2)) / 24.0;
    // the display mapping greys colour out at these levels: give the gas back some of its hue
    float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = max(vec3(lum) + (col - lum) * 1.35, 0.0);
    float v = textureCube(uSky, uVeilRot * d).a;
    v *= v;
    col = col * (1.0 - 0.5 * v) + vec3(0.0011, 0.001, 0.0016) * v;
    float n = hash12(gl_FragCoord.xy) + hash12(gl_FragCoord.xy + 71.3) - 1.0;
    col *= 1.0 + n * 0.07;
    col += n * 0.0003;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
    #include <colorspace_fragment>
  }
`;

const _drift = new THREE.Quaternion();
const _look = new THREE.Quaternion();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _camEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const _m4 = new THREE.Matrix4();

const skyCache = new WeakMap<THREE.WebGLRenderer, THREE.CubeTexture>();

const skyUniforms = (size: number) => ({
  uAxis: { value: GALAXY_AXIS },
  uCore: { value: new THREE.Vector3(0.32, -0.12, -0.94).normalize() },
  uRest: { value: REST_DIR },
  uScale: { value: size / 1024 },
  uMarkCount: { value: Math.min(planets.length, MAX_MARKS) },
  uMarkDir: {
    value: Array.from({ length: MAX_MARKS }, (_, i) =>
      planets[i] ? new THREE.Vector3(...planets[i].position).normalize() : new THREE.Vector3(0, 0, -1),
    ),
  },
  uMarkTint: { value: Array.from({ length: MAX_MARKS }, (_, i) => new THREE.Color(planets[i]?.accent ?? '#ffffff')) },
  uLoop: { value: 1 },
});

const SPHERE: [number, number, number] = [10, 64, 32];
const skySize = (touch: boolean) => (touch ? 512 : 1024);
/** Everything the sky is drawn from: the shipped image must match it exactly (see bakedMaps) */
const skyHash = (size: number) =>
  bakeHash(JSON.stringify([THREE.REVISION, BAKE_VERTEX, BAKE_FRAGMENT, skyUniforms(size), SPHERE, size]));

/** Draws the procedural sky into a cube map on the GPU. */
const bakeLive = (gl: THREE.WebGLRenderer, size: number) => {
  const rt = new THREE.WebGLCubeRenderTarget(size, {
    type: THREE.UnsignedByteType,
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
  });
  const mat = new THREE.ShaderMaterial({
    uniforms: skyUniforms(size),
    vertexShader: BAKE_VERTEX,
    fragmentShader: BAKE_FRAGMENT,
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
  });
  const geo = new THREE.SphereGeometry(...SPHERE);
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(geo, mat));
  const cam = new THREE.CubeCamera(0.1, 100, rt);
  cam.update(gl, scene);
  mat.dispose();
  geo.dispose();
  return rt;
};

/** Development only: writes out either sky size that has no matching image yet. */
const saveSky = (gl: THREE.WebGLRenderer) => {
  for (const touch of [false, true]) {
    const size = skySize(touch);
    const hash = skyHash(size);
    if (isBaked(`sky-${size}`, hash)) continue;
    const rt = bakeLive(gl, size);
    void saveBaked(gl, `sky-${size}`, hash, rt, size, size, 6, touch);
    rt.dispose();
  }
};

/** The sky cube once per renderer: the shipped image when it matches the code, otherwise baked live. */
const bakeSky = (gl: THREE.WebGLRenderer, touch: boolean): THREE.CubeTexture => {
  const hit = skyCache.get(gl);
  if (hit) return hit;
  const size = skySize(touch);
  const px = takeBaked(`sky-${size}`, skyHash(size));
  let tex: THREE.CubeTexture;
  if (px) {
    const faces = Array.from({ length: 6 }, (_, i) => new THREE.DataTexture(layerSlice(px, size, size, i), size, size));
    tex = new THREE.CubeTexture(faces as unknown as HTMLImageElement[]);
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
  } else {
    if (import.meta.env.DEV) saveSky(gl);
    tex = bakeLive(gl, size).texture;
  }
  skyCache.set(gl, tex);
  return tex;
};

const SpaceBackdrop = () => {
  useBakedReady();
  const ref = useRef<THREE.Mesh>(null);
  const gl = useThree((st) => st.gl);
  const material = useMemo(() => {
    const sky = bakeSky(gl, useAppStore.getState().isTouch);
    return new THREE.ShaderMaterial({
      uniforms: { uSky: { value: sky }, uVeilRot: { value: new THREE.Matrix3() } },
      vertexShader: DISPLAY_VERTEX,
      fragmentShader: DISPLAY_FRAGMENT,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
  }, [gl]);

  useEffect(() => () => material.dispose(), [material]);

  useFrame(({ camera, clock }) => {
    ref.current?.position.copy(camera.position);
    const { reducedMotion } = useAppStore.getState();
    _camEuler.setFromQuaternion(camera.quaternion, 'YXZ');
    _euler.set(_camEuler.x * VEIL_PARALLAX, _camEuler.y * VEIL_PARALLAX, 0, 'YXZ');
    _look.setFromEuler(_euler);
    _drift.setFromAxisAngle(GALAXY_AXIS, reducedMotion ? 0 : clock.elapsedTime * VEIL_DRIFT);
    _m4.makeRotationFromQuaternion(_drift.premultiply(_look));
    (material.uniforms.uVeilRot.value as THREE.Matrix3).setFromMatrix4(_m4);
  });

  return (
    <mesh ref={ref} material={material} renderOrder={-100} frustumCulled={false}>
      <sphereGeometry args={[400, 32, 16]} />
    </mesh>
  );
};

export default SpaceBackdrop;
