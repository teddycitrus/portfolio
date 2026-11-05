import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { GALAXY_AXIS } from './SpaceBackdrop';

interface StarfieldProps {
  count?: number;
  radius?: number;
  opacity?: number;
}

const VERTEX = /* glsl */ `
  attribute float aSize;
  attribute float aBright;
  attribute float aPhase;
  attribute vec3 aColor;
  uniform float uTime;
  uniform float uPixelRatio;
  varying vec3 vColor;
  varying float vBright;
  void main() {
    // Only the brighter stars scintillate, and only slightly
    float tw = 1.0 + 0.12 * smoothstep(0.35, 1.0, aBright) * sin(uTime * (1.3 + aPhase * 0.4) + aPhase * 6.2831);
    vColor = aColor;
    vBright = aBright * tw;
    gl_PointSize = aSize * uPixelRatio;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float uOpacity;
  varying vec3 vColor;
  varying float vBright;
  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(c, c);
    if (r2 > 1.0) discard;
    // Gaussian core with a faint airy skirt
    float a = exp(-r2 * 7.0) + 0.06 * (1.0 - r2);
    gl_FragColor = vec4(vColor * vBright * a * uOpacity, 1.0);
  }
`;

// Rough blackbody tints, desaturated, with population weights
const TEMPS: [number, [number, number, number]][] = [
  [0.14, [0.74, 0.83, 1.0]],
  [0.48, [1.0, 0.98, 0.96]],
  [0.24, [1.0, 0.93, 0.82]],
  [0.1, [1.0, 0.83, 0.64]],
  [0.04, [1.0, 0.72, 0.52]],
];

const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const Starfield = ({ count = 5000, radius = 220, opacity = 1 }: StarfieldProps) => {
  const ref = useRef<THREE.Points>(null);

  const geometry = useMemo(() => {
    const rand = mulberry32(1337 + count);
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const bright = new Float32Array(count);
    const phase = new Float32Array(count);
    const d = new THREE.Vector3();

    for (let i = 0; i < count; i += 1) {
      const z = rand() * 2 - 1;
      const th = rand() * Math.PI * 2;
      const s = Math.sqrt(1 - z * z);
      d.set(s * Math.cos(th), z, s * Math.sin(th));
      // A third of the stars crowd toward the galactic plane
      if (rand() < 0.35) d.addScaledVector(GALAXY_AXIS, -d.dot(GALAXY_AXIS) * (0.6 + rand() * 0.38)).normalize();
      d.multiplyScalar(radius * (0.85 + rand() * 0.15));
      pos.set([d.x, d.y, d.z], i * 3);

      // Power-law brightness: most stars faint, a handful bright
      const b = Math.pow(rand(), 7);
      bright[i] = 0.18 + b * 2.2 + rand() * 0.12;
      size[i] = 1.6 + b * 4.2 + rand() * 0.5;
      phase[i] = rand();

      let pick = rand();
      let tint = TEMPS[1][1];
      for (const [w, c] of TEMPS) {
        if (pick < w) { tint = c; break; }
        pick -= w;
      }
      col.set(tint, i * 3);
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aBright', new THREE.BufferAttribute(bright, 1));
    g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    return g;
  }, [count, radius]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uPixelRatio: { value: 1 }, uOpacity: { value: 1 } },
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      }),
    [],
  );

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);

  useFrame(({ camera, clock, gl }) => {
    const u = material.uniforms;
    u.uTime.value = clock.elapsedTime;
    u.uPixelRatio.value = gl.getPixelRatio();
    u.uOpacity.value = opacity;
    ref.current?.position.copy(camera.position);
  });

  return <points ref={ref} geometry={geometry} material={material} frustumCulled={false} renderOrder={-80} />;
};

export default Starfield;
