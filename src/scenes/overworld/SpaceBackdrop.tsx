import { useMemo } from 'react';
import * as THREE from 'three';

const VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vDir = normalize(wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

// Single shader sphere rendered behind everything else. Combines:
//  - a tilted galaxy band (bright along a great circle, dust-modulated)
//  - three soft nebula patches anchored to fixed sky directions
const FRAGMENT = /* glsl */ `
  precision highp float;
  varying vec3 vDir;

  float hash(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
  }
  float noise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i),                hash(i + vec3(1.,0.,0.)), f.x),
          mix(hash(i + vec3(0.,1.,0.)), hash(i + vec3(1.,1.,0.)), f.x), f.y),
      mix(mix(hash(i + vec3(0.,0.,1.)), hash(i + vec3(1.,0.,1.)), f.x),
          mix(hash(i + vec3(0.,1.,1.)), hash(i + vec3(1.,1.,1.)), f.x), f.y),
      f.z);
  }
  float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * noise3(p);
      p *= 2.1;
      a *= 0.5;
    }
    return v;
  }

  float nebulaPatch(vec3 d, vec3 center, float tightness, float scale, float seed) {
    float dot_ = max(dot(d, normalize(center)), 0.0);
    float disc = pow(dot_, tightness);
    float clouds = fbm(d * scale + vec3(seed));
    return disc * clouds;
  }

  void main() {
    vec3 d = vDir;

    // Near-black base — preserves the deep-space look
    vec3 col = vec3(0.004, 0.006, 0.014);

    // ---- Galaxy band ----
    // 'galAxis' is the pole; the band lies on the great circle perpendicular.
    vec3 galAxis = normalize(vec3(0.32, 0.85, 0.42));
    float lat = abs(dot(d, galAxis));
    // Wide-then-tight falloff for a soft band edge
    float band = exp(-lat * lat * 35.0);
    // Stardust modulation along the band — clumpy "lanes"
    float dust = fbm(d * 4.5);
    band *= 0.35 + dust * 0.75;
    // Warm core toward the bright galactic centre direction
    vec3 galCore = normalize(vec3(0.1, 0.18, 0.97));
    float core = pow(max(dot(d, galCore), 0.0), 3.0);
    vec3 galWarm = mix(vec3(0.55, 0.55, 0.7), vec3(0.95, 0.78, 0.55), core);
    col += galWarm * band * 0.16;

    // ---- Nebula patches (faint, tinted) ----
    col += vec3(0.50, 0.20, 0.70) * nebulaPatch(d, vec3( 0.80,  0.30, -0.50), 5.0, 3.0,  1.7) * 0.55;
    col += vec3(0.18, 0.55, 0.78) * nebulaPatch(d, vec3(-0.65,  0.40,  0.55), 6.0, 3.4,  5.3) * 0.50;
    col += vec3(0.78, 0.34, 0.26) * nebulaPatch(d, vec3( 0.10, -0.45, -0.92), 7.0, 2.8, 11.0) * 0.42;

    gl_FragColor = vec4(col, 1.0);
  }
`;

const SpaceBackdrop = () => {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    [],
  );

  return (
    <mesh material={material} renderOrder={-100} frustumCulled={false}>
      <sphereGeometry args={[280, 32, 16]} />
    </mesh>
  );
};

export default SpaceBackdrop;
