import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { flight } from '@/state/runtime';
import { useAppStore } from '@/state/useAppStore';

const COUNT = 340;
/** Streaks live in a tube this long ahead of the eye */
const LENGTH = 60;
const R_MIN = 0.9;
const R_MAX = 5.5;
/** Speeds (units/s) where streaks start to show and reach full strength */
const SHOW_FROM = 18;
const SHOW_FULL = 75;

const _dir = new THREE.Vector3();
const _q = new THREE.Quaternion();
const FWD = new THREE.Vector3(0, 0, -1);

/**
 * Light streaks rushing past the canopy, aligned with the direction of travel
 * (the dive, the descent, the launch). Invisible at walking speed.
 */
const SpeedLines = () => {
  const camera = useThree((s) => s.camera);
  const ref = useRef<THREE.LineSegments>(null);
  const st = useRef({ travel: 0, last: new THREE.Vector3(), has: false, q: new THREE.Quaternion() });

  const { geo, mat } = useMemo(() => {
    const seed = new Float32Array(COUNT * 2 * 3);
    const end = new Float32Array(COUNT * 2);
    for (let i = 0; i < COUNT; i += 1) {
      const a = Math.random() * Math.PI * 2;
      // more streaks toward the edge of the view, few through the middle
      const r = R_MIN + Math.sqrt(Math.random()) * (R_MAX - R_MIN);
      const z = Math.random();
      for (let k = 0; k < 2; k += 1) {
        seed.set([a, r, z], (i * 2 + k) * 3);
        end[i * 2 + k] = k;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(COUNT * 2 * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
    g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      uniforms: {
        uTravel: { value: 0 },
        uLen: { value: 0 },
        uOpacity: { value: 0 },
      },
      vertexShader: /* glsl */ `
        uniform float uTravel;
        uniform float uLen;
        attribute vec3 aSeed;
        attribute float aEnd;
        varying float vA;
        void main() {
          float L = ${LENGTH.toFixed(1)};
          float z = -L * (1.0 - fract(aSeed.z + uTravel / L));
          vec3 p = vec3(cos(aSeed.x) * aSeed.y, sin(aSeed.x) * aSeed.y, z - aEnd * uLen);
          vA = smoothstep(0.0, 5.0, -z) * (1.0 - smoothstep(L * 0.55, L, -z)) * (1.0 - aEnd);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        varying float vA;
        void main() {
          vec3 c = mix(vec3(0.55, 0.7, 1.0), vec3(1.25, 1.2, 1.15), vA);
          gl_FragColor = vec4(c, vA * uOpacity);
        }
      `,
    });
    return { geo: g, mat: m };
  }, []);

  useEffect(
    () => () => {
      geo.dispose();
      mat.dispose();
    },
    [geo, mat],
  );

  useFrame((_, delta) => {
    const l = ref.current;
    if (!l) return;
    const s = st.current;
    const dt = Math.min(delta, 0.05);
    const { reducedMotion: reduced, intro } = useAppStore.getState();
    const speed = flight.speed;
    // the intro camera moves fast outside the ship: no streaks there
    const k = reduced || intro ? 0 : THREE.MathUtils.smoothstep(speed, SHOW_FROM, SHOW_FULL);

    // point the tube along the direction of travel
    if (s.has) {
      _dir.copy(camera.position).sub(s.last);
      if (_dir.lengthSq() > 1e-6 && _dir.length() < 25) {
        _q.setFromUnitVectors(FWD, _dir.normalize());
        s.q.slerp(_q, 1 - Math.exp(-12 * dt));
      }
    }
    s.last.copy(camera.position);
    s.has = true;

    l.visible = k > 0.002;
    l.position.copy(camera.position);
    l.quaternion.copy(s.q);
    s.travel += speed * dt;
    mat.uniforms.uTravel.value = s.travel % 100000;
    mat.uniforms.uLen.value = Math.min(12, speed * 0.07);
    mat.uniforms.uOpacity.value = k * 0.85;
  }, 0.6);

  return <lineSegments ref={ref} geometry={geo} material={mat} frustumCulled={false} renderOrder={28} raycast={() => null} />;
};

export default SpeedLines;
