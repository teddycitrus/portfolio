import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { ResolvedSky } from '@/data/skyPresets';
import { flight } from '@/state/runtime';
import { FALL_MS } from '@/state/timing';

/*
 * The dust the drop pod throws up when it hits: a ring of soft puffs rolling
 * outward along the ground and lifting, thinning out over a few seconds.
 * Everything moves in the shader from the age of the impact.
 */

const COUNT = 140;
const LIFE = 3.4;

const VERT = /* glsl */ `
  attribute float aDir;
  attribute float aSpeed;
  attribute float aRise;
  attribute float aSize;
  attribute float aAlpha;
  uniform vec3 uOrigin;
  uniform float uAge;
  uniform float uPx;
  varying float vA;
  void main() {
    float out_ = 1.0 - exp(-uAge * 2.4);
    float r = 2.2 + aSpeed * out_;
    vec3 p = uOrigin + vec3(cos(aDir) * r, 0.25 + aRise * (1.0 - exp(-uAge * 1.6)), sin(aDir) * r);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = min(aSize * (0.6 + uAge * 0.7) * uPx / max(1.0, -mv.z), uPx * 0.35);
    vA = aAlpha * smoothstep(0.0, 0.05, uAge) * (1.0 - smoothstep(0.5, ${LIFE.toFixed(1)}, uAge));
  }
`;
const FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying float vA;
  void main() {
    vec2 q = gl_PointCoord * 2.0 - 1.0;
    float d = dot(q, q);
    if (d > 1.0) discard;
    gl_FragColor = vec4(uColor, vA * exp(-d * 2.6) * (1.0 - d));
    #include <colorspace_fragment>
  }
`;

interface Props {
  sky: ResolvedSky;
  /** Ground height at (x, z) */
  ground: (x: number, z: number) => number;
  reducedMotion?: boolean;
}

const noRaycast = () => null;

const PodDust = ({ sky, ground, reducedMotion }: Props) => {
  const gl = useThree((s) => s.gl);
  const ref = useRef<THREE.Points>(null);
  const origin = useRef<THREE.Vector3 | null>(null);

  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const dir = new Float32Array(COUNT);
    const speed = new Float32Array(COUNT);
    const rise = new Float32Array(COUNT);
    const size = new Float32Array(COUNT);
    const alpha = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i += 1) {
      dir[i] = (i / COUNT) * Math.PI * 2 + Math.random() * 0.2;
      speed[i] = 3 + Math.random() * 7;
      rise[i] = 0.2 + Math.random() * Math.random() * 1.4;
      size[i] = 0.8 + Math.random() * 1.2;
      alpha[i] = 0.12 + Math.random() * 0.18;
    }
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(COUNT * 3), 3));
    g.setAttribute('aDir', new THREE.BufferAttribute(dir, 1));
    g.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));
    g.setAttribute('aRise', new THREE.BufferAttribute(rise, 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
    return g;
  }, []);

  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        fog: false,
        uniforms: {
          uOrigin: { value: new THREE.Vector3() },
          uAge: { value: 0 },
          uPx: { value: 400 },
          // the ground's own colour lifted toward the haze
          uColor: { value: sky.hemiGround.clone().lerp(sky.fogColor, 0.6).lerp(new THREE.Color('#ffffff'), 0.1) },
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
      }),
    [sky],
  );

  useEffect(
    () => () => {
      geo.dispose();
      mat.dispose();
    },
    [geo, mat],
  );

  useFrame(({ camera, size }) => {
    const pts = ref.current;
    if (!pts) return;
    const ms = flight.arrivalMs;
    const age = (ms - FALL_MS) / 1000;
    const on = !reducedMotion && ms >= FALL_MS && age < LIFE;
    pts.visible = on;
    if (!on) {
      if (ms < FALL_MS) origin.current = null;
      return;
    }
    if (!origin.current) {
      // the pod is wherever the viewer is at the moment of impact
      const { x, z } = camera.position;
      origin.current = new THREE.Vector3(x, ground(x, z), z);
      mat.uniforms.uOrigin.value.copy(origin.current);
    }
    mat.uniforms.uAge.value = age;
    const cam = camera as THREE.PerspectiveCamera;
    mat.uniforms.uPx.value = (size.height * gl.getPixelRatio()) / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
  });

  return <points ref={ref} geometry={geo} material={mat} visible={false} frustumCulled={false} raycast={noRaycast} renderOrder={6} />;
};

export default PodDust;
