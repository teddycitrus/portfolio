import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useAppStore } from '@/state/useAppStore';
import { GALAXY_AXIS, REST_DIR, dustOpacity, mulberry32 } from './skyField';

interface StarfieldProps {
  count?: number;
  radius?: number;
  opacity?: number;
}

/** How much further the nearest stars swing than the far ones when the view turns */
const LOOK_PARALLAX = 0.05;
/** Share of a camera move the nearest stars take part in */
const MOVE_PARALLAX = 0.2;

const VERTEX = /* glsl */ `
  attribute float aSize;
  attribute float aBright;
  attribute float aPhase;
  attribute float aDepth;
  attribute vec3 aColor;
  uniform float uTime;
  uniform float uPixelRatio;
  uniform vec2 uLook;
  uniform vec3 uMove;
  uniform float uCalm;
  uniform vec3 uRest;
  varying vec3 vColor;
  varying float vBright;
  void main() {
    // Only the brighter stars scintillate, and only slightly
    float tw = 1.0 + 0.12 * smoothstep(0.35, 1.0, aBright) * sin(uTime * (1.3 + aPhase * 0.4) + aPhase * 6.2831);
    // bright stars step back around the middle of the window so nothing outshines the planets
    float calm = uCalm * smoothstep(0.72, 0.92, dot(normalize(position), uRest)) * smoothstep(0.3, 1.2, aBright);
    vColor = aColor;
    vBright = aBright * tw * (1.0 - 0.62 * calm);
    gl_PointSize = aSize * (1.0 - 0.4 * calm) * uPixelRatio;

    // small-angle turn of the near layers against the camera, and a share of its travel
    vec3 p = position;
    p.x += position.z * uLook.x * aDepth;
    p.z -= position.x * uLook.x * aDepth;
    p.y -= position.z * uLook.y * aDepth;
    p.z += position.y * uLook.y * aDepth;
    p -= uMove * aDepth;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
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
    // the brightest stars: a tight core and four soft diffraction spikes
    float big = smoothstep(1.0, 2.0, vBright);
    if (big > 0.0) {
      float core = exp(-r2 * 60.0);
      float spikes = exp(-abs(c.x) * 34.0) * exp(-abs(c.y) * 2.6) + exp(-abs(c.y) * 34.0) * exp(-abs(c.x) * 2.6);
      a = mix(a, core * 1.4 + spikes * 0.35 + exp(-r2 * 9.0) * 0.12, big);
    }
    gl_FragColor = vec4(vColor * vBright * a * uOpacity, 1.0);
  }
`;

// Rough blackbody tints from hot to cool. Faint stars are mostly dwarfs, warm;
// the bright ones skew to hot blue-whites plus a few orange giants.
const TINTS: [number, number, number][] = [
  [0.7, 0.8, 1.0],
  [0.86, 0.91, 1.0],
  [1.0, 0.98, 0.95],
  [1.0, 0.9, 0.76],
  [1.0, 0.76, 0.54],
];
const WEIGHTS_FAINT = [0.05, 0.14, 0.33, 0.3, 0.18];
const WEIGHTS_BRIGHT = [0.26, 0.3, 0.2, 0.08, 0.16];

/** Open clusters scattered near the plane: a little reward for looking closely */
const CLUSTERS = 34;
const CLUSTER_SHARE = 0.12;

const _euler = new THREE.Euler(0, 0, 0, 'YXZ');

const Starfield = ({ count = 9000, radius = 220, opacity = 1 }: StarfieldProps) => {
  const ref = useRef<THREE.Points>(null);

  const geometry = useMemo(() => {
    const rand = mulberry32(1337 + count);
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const bright = new Float32Array(count);
    const phase = new Float32Array(count);
    const depth = new Float32Array(count);
    const d = new THREE.Vector3();

    const onSphere = (out: THREE.Vector3) => {
      const z = rand() * 2 - 1;
      const th = rand() * Math.PI * 2;
      const s = Math.sqrt(1 - z * z);
      return out.set(s * Math.cos(th), z, s * Math.sin(th));
    };

    const centres = Array.from({ length: CLUSTERS }, () => {
      const c = onSphere(new THREE.Vector3());
      c.addScaledVector(GALAXY_AXIS, -c.dot(GALAXY_AXIS) * (0.7 + rand() * 0.28)).normalize();
      return { c, spread: 0.006 + rand() * rand() * 0.02 };
    });

    for (let i = 0; i < count; i += 1) {
      let clustered = false;
      // dust hides stars: redraw any that land in a lane, most of the time
      for (let tries = 0; tries < 6; tries += 1) {
        clustered = rand() < CLUSTER_SHARE;
        if (clustered) {
          const { c, spread } = centres[Math.floor(rand() * CLUSTERS)];
          d.set(c.x + (rand() + rand() + rand() - 1.5) * spread, c.y + (rand() + rand() + rand() - 1.5) * spread, c.z + (rand() + rand() + rand() - 1.5) * spread).normalize();
        } else {
          onSphere(d);
          // A third of the stars crowd toward the galactic plane
          if (rand() < 0.35) d.addScaledVector(GALAXY_AXIS, -d.dot(GALAXY_AXIS) * (0.6 + rand() * 0.38)).normalize();
        }
        if (rand() > dustOpacity(d) * 0.9) break;
      }
      const shell = radius * (0.85 + rand() * 0.15);
      pos.set([d.x * shell, d.y * shell, d.z * shell], i * 3);

      // Flux from a power law, as in a real magnitude count: many faint, very few bright
      const u = Math.max(rand(), 1e-4);
      const flux = Math.min(0.09 * Math.pow(u, -0.625), 3.2) * (clustered ? 0.75 : 1);
      bright[i] = flux + rand() * 0.06;
      const big = flux > 1 ? 7 * Math.min(1, (flux - 1) / 1.8) : 0;
      size[i] = 1.1 + 1.7 * Math.sqrt(flux) + rand() * 0.3 + big;
      phase[i] = rand();
      // A few stars live on nearer shells and move against the rest
      depth[i] = rand() < 0.14 ? 0.5 + rand() * 0.5 : 0;

      const weights = flux > 0.6 ? WEIGHTS_BRIGHT : WEIGHTS_FAINT;
      let pick = rand();
      let tint = TINTS[2];
      for (let k = 0; k < TINTS.length; k += 1) {
        if (pick < weights[k]) { tint = TINTS[k]; break; }
        pick -= weights[k];
      }
      col.set(tint, i * 3);
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aBright', new THREE.BufferAttribute(bright, 1));
    g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    g.setAttribute('aDepth', new THREE.BufferAttribute(depth, 1));
    return g;
  }, [count, radius]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uPixelRatio: { value: 1 },
          uOpacity: { value: 1 },
          uLook: { value: new THREE.Vector2() },
          uMove: { value: new THREE.Vector3() },
          uCalm: { value: 0 },
          uRest: { value: REST_DIR },
        },
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
    const { mode, reducedMotion } = useAppStore.getState();
    u.uTime.value = reducedMotion ? 0 : clock.elapsedTime;
    u.uPixelRatio.value = gl.getPixelRatio();
    u.uOpacity.value = opacity;
    ref.current?.position.copy(camera.position);

    // depth and composition belong to the view from the ship; the planet surface sky stays put
    const orbit = mode !== 'planet';
    u.uCalm.value = orbit ? 1 : 0;
    if (orbit) {
      _euler.setFromQuaternion(camera.quaternion, 'YXZ');
      (u.uLook.value as THREE.Vector2).set(-_euler.y * LOOK_PARALLAX, -_euler.x * LOOK_PARALLAX);
      (u.uMove.value as THREE.Vector3).copy(camera.position).multiplyScalar(MOVE_PARALLAX);
    } else {
      (u.uLook.value as THREE.Vector2).set(0, 0);
      (u.uMove.value as THREE.Vector3).set(0, 0, 0);
    }
  });

  return <points ref={ref} geometry={geometry} material={material} frustumCulled={false} renderOrder={-80} />;
};

export default Starfield;
