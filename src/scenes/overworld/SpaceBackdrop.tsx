import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useAppStore } from '@/state/useAppStore';
import * as THREE from 'three';

/** Pole of the galactic plane; Starfield clusters stars along the same band. */
export const GALAXY_AXIS = new THREE.Vector3(0.45, 0.88, 0.12).normalize();

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
  uniform vec3 uAxis;
  uniform vec3 uCore;
  varying vec3 vDir;

  float sq(float x) { return x * x; }
  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
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
    for (int i = 0; i < 6; i++) { v += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; }
    return v;
  }

  // a soft emission nebula centred on direction c: warped clouds, bright knots, cut by dust
  vec3 nebula(vec3 d, vec3 c, float spread, vec3 hot, vec3 cool, float seed) {
    float a = dot(d, normalize(c));
    float region = exp(-sq((1.0 - a) / spread));
    if (region < 0.002) return vec3(0.0);
    vec3 p = d * 2.2 + seed;
    vec3 w = p + vec3(fbm(p * 1.3), fbm(p * 1.3 + 5.2), fbm(p * 1.3 + 9.7)) * 1.6;
    float gas = smoothstep(0.32, 0.9, fbm(w * 1.4));
    float body = smoothstep(0.25, 0.75, fbm(w * 0.7 + 2.0));
    float knots = pow(smoothstep(0.55, 0.95, fbm(w * 4.0 + 1.0)), 2.0);
    float dust = smoothstep(0.48, 0.72, fbm(w * 2.3 + 11.0));
    float m = (gas * 0.75 + body * 0.45 + knots * 0.9) * region * (1.0 - 0.8 * dust);
    vec3 tint = mix(cool, hot, smoothstep(0.35, 0.8, fbm(w * 0.9 + 4.0)));
    return tint * m + hot * knots * region * 0.6;
  }

  void main() {
    vec3 d = normalize(vDir);
    // deep space is not pure black: a faint blue floor that deepens away from the galaxy
    float lat = dot(d, uAxis);
    vec3 col = mix(vec3(0.0028, 0.0034, 0.0062), vec3(0.0016, 0.0019, 0.0034), smoothstep(0.0, 0.7, abs(lat)));

    vec3 w = d * 3.0 + vec3(fbm(d * 2.0), fbm(d * 2.0 + 7.3), fbm(d * 2.0 + 13.7)) * 1.2;
    float wl = lat + (fbm(d * 3.5 + 3.1) - 0.5) * 0.12;

    // the galactic band: a broad glow and a contrasty core of star clouds
    float wide = exp(-wl * wl * 14.0);
    float narrow = exp(-wl * wl * 70.0);
    float clouds = smoothstep(0.35, 0.85, fbm(w * 2.4));
    float grain = smoothstep(0.35, 0.75, noise(d * 70.0)) * 0.6 + smoothstep(0.4, 0.8, noise(d * 160.0)) * 0.4;
    float band = wide * 0.22 + narrow * (0.25 + 1.0 * clouds) * (0.55 + 0.45 * grain);

    // dark dust lanes along the plane
    float laneNoise = fbm(w * 3.2 + 5.0);
    float lane = smoothstep(0.45, 0.7, laneNoise) * exp(-sq((wl - 0.015) * 16.0));
    band *= 1.0 - 0.85 * lane;

    // blue-violet arms, warm toward the core
    float core = pow(max(dot(d, uCore), 0.0), 18.0);
    vec3 tint = mix(vec3(0.62, 0.7, 1.0), vec3(1.0, 0.86, 0.7), clamp(core * 1.3, 0.0, 1.0));
    tint = mix(tint, vec3(0.78, 0.66, 1.0), 0.25 * clouds * (1.0 - core));
    col += tint * (band * 0.02 + core * narrow * 0.02 * (1.0 - 0.7 * lane));

    // emission nebulae framing the view: magenta and amber low left, teal and blue high right,
    // a violet veil behind, and a small red one far off
    col += nebula(d, vec3(-0.62, -0.2, -1.0), 0.16, vec3(1.0, 0.42, 0.62), vec3(0.42, 0.26, 0.9), 1.7) * 0.036;
    col += nebula(d, vec3(0.7, 0.32, -1.0), 0.13, vec3(0.32, 0.9, 0.95), vec3(0.2, 0.36, 0.95), 6.3) * 0.032;
    col += nebula(d, vec3(0.05, 0.05, -1.0), 0.32, vec3(0.6, 0.42, 1.0), vec3(0.14, 0.2, 0.55), 9.1) * 0.012;
    col += nebula(d, vec3(0.95, -0.45, -0.6), 0.08, vec3(1.0, 0.36, 0.3), vec3(0.8, 0.3, 0.5), 3.4) * 0.026;

    // Gamma-encode with gain so the dark gradients keep precision in an 8-bit cube face
    gl_FragColor = vec4(pow(max(col, 0.0) * ENCODE_GAIN, vec3(1.0 / 2.2)), 1.0);
  }
`;

const DISPLAY_VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Cheap per-frame pass: decode the baked sky and dither it so 8-bit output never bands
const DISPLAY_FRAGMENT = /* glsl */ `
  uniform samplerCube uSky;
  varying vec3 vDir;
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  void main() {
    vec3 col = pow(textureCube(uSky, normalize(vDir)).rgb, vec3(2.2)) / 24.0;
    float n = hash12(gl_FragCoord.xy) + hash12(gl_FragCoord.xy + 71.3) - 1.0;
    col *= 1.0 + n * 0.07;
    col += n * 0.0003;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
    #include <colorspace_fragment>
  }
`;

const skyCache = new WeakMap<THREE.WebGLRenderer, THREE.CubeTexture>();

/** Renders the procedural sky into a cube map once per renderer. */
const bakeSky = (gl: THREE.WebGLRenderer, size: number): THREE.CubeTexture => {
  const hit = skyCache.get(gl);
  if (hit) return hit;
  const rt = new THREE.WebGLCubeRenderTarget(size, {
    type: THREE.UnsignedByteType,
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
  });
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uAxis: { value: GALAXY_AXIS },
      uCore: { value: new THREE.Vector3(0.32, -0.12, -0.94).normalize() },
    },
    vertexShader: BAKE_VERTEX,
    fragmentShader: BAKE_FRAGMENT,
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
  });
  const geo = new THREE.SphereGeometry(10, 64, 32);
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(geo, mat));
  const cam = new THREE.CubeCamera(0.1, 100, rt);
  cam.update(gl, scene);
  mat.dispose();
  geo.dispose();
  skyCache.set(gl, rt.texture);
  return rt.texture;
};

const SpaceBackdrop = () => {
  const ref = useRef<THREE.Mesh>(null);
  const gl = useThree((st) => st.gl);
  const material = useMemo(() => {
    const sky = bakeSky(gl, useAppStore.getState().isTouch ? 512 : 1024);
    return new THREE.ShaderMaterial({
      uniforms: { uSky: { value: sky } },
      vertexShader: DISPLAY_VERTEX,
      fragmentShader: DISPLAY_FRAGMENT,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
  }, [gl]);

  useEffect(() => () => material.dispose(), [material]);

  useFrame(({ camera }) => {
    ref.current?.position.copy(camera.position);
  });

  return (
    <mesh ref={ref} material={material} renderOrder={-100} frustumCulled={false}>
      <sphereGeometry args={[400, 32, 16]} />
    </mesh>
  );
};

export default SpaceBackdrop;
