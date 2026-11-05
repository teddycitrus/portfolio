import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/** Pole of the galactic plane; Starfield clusters stars along the same band. */
export const GALAXY_AXIS = new THREE.Vector3(0.45, 0.88, 0.12).normalize();

const VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  precision highp float;
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

  void main() {
    vec3 d = normalize(vDir);
    vec3 col = vec3(0.0016, 0.0021, 0.0036);

    float lat = dot(d, uAxis);
    vec3 w = d * 3.0 + vec3(fbm(d * 2.0), fbm(d * 2.0 + 7.3), fbm(d * 2.0 + 13.7)) * 1.2;
    float wl = lat + (fbm(d * 3.5 + 3.1) - 0.5) * 0.12;

    // Broad diffuse glow plus a tighter mottled star-cloud core
    float wide = exp(-wl * wl * 14.0);
    float narrow = exp(-wl * wl * 70.0);
    float clouds = smoothstep(0.3, 0.8, fbm(w * 2.4));
    float band = wide * 0.35 + narrow * (0.35 + 0.9 * clouds);

    // Dark dust lanes hugging the plane, broken up by warped noise
    float laneNoise = fbm(w * 3.2 + 5.0);
    float lane = smoothstep(0.45, 0.7, laneNoise) * exp(-sq((wl - 0.015) * 16.0));
    band *= 1.0 - 0.8 * lane;

    // Faint warm bulge toward the galactic centre
    float core = pow(max(dot(d, uCore), 0.0), 18.0);
    vec3 tint = mix(vec3(0.78, 0.82, 0.9), vec3(1.0, 0.84, 0.66), clamp(core * 1.6, 0.0, 1.0));
    col += tint * (band * 0.022 + core * narrow * 0.05 * (1.0 - 0.7 * lane));

    // Relative dither so the 8-bit output never bands in the dark gradients
    float n = hash12(gl_FragCoord.xy) + hash12(gl_FragCoord.xy + 71.3) - 1.0;
    col *= 1.0 + n * 0.07;
    col += n * 0.0003;

    gl_FragColor = vec4(max(col, 0.0), 1.0);
    #include <colorspace_fragment>
  }
`;

const SpaceBackdrop = () => {
  const ref = useRef<THREE.Mesh>(null);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uAxis: { value: GALAXY_AXIS },
          uCore: { value: new THREE.Vector3(0.32, -0.12, -0.94).normalize() },
        },
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        fog: false,
      }),
    [],
  );

  useFrame(({ camera }) => {
    ref.current?.position.copy(camera.position);
  });

  return (
    <mesh ref={ref} material={material} renderOrder={-100} frustumCulled={false}>
      <sphereGeometry args={[400, 48, 24]} />
    </mesh>
  );
};

export default SpaceBackdrop;
