import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useAppStore } from '@/state/useAppStore';
import { SUN_DIRECTION } from './Sun';
import { mulberry32 } from './skyField';

/*
 * A thin belt of rubble far behind the planets, a long tilted ellipse barely
 * above the star floor. It is real geometry, so it is the one thing in the sky
 * with true parallax when the camera travels. One draw call.
 */

const CENTRE: [number, number, number] = [3, -5, -88];
const TILT: [number, number, number] = [1.34, 0.05, -0.2];
const INNER = 35;
const OUTER = 46;
const noRaycast = () => null;

const VERTEX = /* glsl */ `
  attribute vec4 aOrbit; // angle, radius, height, angular speed
  attribute vec2 aLook;  // size, brightness
  uniform float uTime;
  uniform float uPixelRatio;
  uniform vec3 uSun;
  varying vec3 vColor;
  void main() {
    float a = aOrbit.x + uTime * aOrbit.w;
    vec3 p = vec3(cos(a) * aOrbit.y, sin(a) * aOrbit.y, aOrbit.z);
    vec3 world = (modelMatrix * vec4(p, 1.0)).xyz;
    vec4 mv = viewMatrix * vec4(world, 1.0);
    // rubble on the sunward arc is lit, the far side only just shows
    vec3 radial = (modelMatrix * vec4(cos(a), sin(a), 0.0, 0.0)).xyz;
    float lit = 0.3 + 0.7 * smoothstep(-0.5, 0.8, dot(radial, uSun));
    vColor = mix(vec3(0.62, 0.66, 0.8), vec3(0.95, 0.82, 0.68), lit) * aLook.y * lit;
    gl_PointSize = aLook.x * uPixelRatio;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(c, c);
    if (r2 > 1.0) discard;
    gl_FragColor = vec4(vColor * exp(-r2 * 3.5), 1.0);
  }
`;

const DebrisBelt = () => {
  const geometry = useMemo(() => {
    const count = useAppStore.getState().isTouch ? 420 : 900;
    const rand = mulberry32(4242);
    const orbit = new Float32Array(count * 4);
    const look = new Float32Array(count * 2);
    for (let i = 0; i < count; i += 1) {
      // clumped along the orbit, so it reads as rubble and not as a drawn line
      let a = 0;
      for (let tries = 0; tries < 8; tries += 1) {
        a = rand() * Math.PI * 2;
        if (rand() < 0.5 + 0.28 * Math.sin(a * 3 + 1.1) + 0.22 * Math.sin(a * 7 + 4.2)) break;
      }
      const t = rand();
      const r = INNER + (OUTER - INNER) * (t * 0.7 + rand() * 0.3);
      orbit.set([a, r, (rand() - 0.5) * 1.6, 0.0035 * Math.pow(40 / r, 1.5)], i * 4);
      const big = rand();
      look.set([0.9 + big * big * big * 1.3, 0.05 + big * big * 0.22], i * 2);
    }
    const g = new THREE.BufferGeometry();
    // the shader builds positions; this attribute only sets the vertex count
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute('aOrbit', new THREE.BufferAttribute(orbit, 4));
    g.setAttribute('aLook', new THREE.BufferAttribute(look, 2));
    return g;
  }, []);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uPixelRatio: { value: 1 }, uSun: { value: SUN_DIRECTION } },
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      }),
    [],
  );

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useFrame(({ clock, gl }) => {
    if (!useAppStore.getState().reducedMotion) material.uniforms.uTime.value = clock.elapsedTime;
    material.uniforms.uPixelRatio.value = gl.getPixelRatio();
  });

  return (
    <points
      geometry={geometry}
      material={material}
      position={CENTRE}
      rotation={TILT}
      renderOrder={-70}
      frustumCulled={false}
      raycast={noRaycast}
    />
  );
};

export default DebrisBelt;
