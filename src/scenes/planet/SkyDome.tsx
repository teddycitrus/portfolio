import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { ResolvedSky } from '@/data/skyPresets';
import Starfield from '../overworld/Starfield';

const DOME_RADIUS = 480;
const MOON_DISTANCE = 420;
const STAR_RADIUS = 400;

const GLSL_NOISE = /* glsl */ `
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
               mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float s = 0.0;
    float a = 0.5;
    mat2 r = mat2(1.6, 1.2, -1.2, 1.6);
    for (int i = 0; i < 5; i++) { s += vnoise(p) * a; p = r * p; a *= 0.5; }
    return s;
  }
`;

const skyVert = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
  }
`;

const skyFrag = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uUpper;
  uniform vec3 uHorizon;
  uniform vec3 uGlow;
  uniform float uGlowStrength;
  uniform vec3 uHalo;
  uniform float uHaloStrength;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uSunDisc;
  uniform float uSunSize;
  uniform vec3 uCloud;
  uniform float uCloudOpacity;
  uniform float uTime;
  varying vec3 vDir;
  ${GLSL_NOISE}
  void main() {
    vec3 dir = normalize(vDir);
    float h = dir.y;
    float hp = max(h, 0.0);

    // base gradient: zenith -> upper -> horizon (horizon equals fog colour at h = 0)
    vec3 col = mix(uZenith, uUpper, exp(-hp * 2.6));
    col = mix(col, uHorizon, exp(-hp * 11.0));
    // below the horizon: stay on the fog colour, darken slightly far down
    col = mix(col, uHorizon * 0.82, smoothstep(0.0, -0.5, h));

    float mu = dot(dir, uSunDir);
    vec2 az = normalize(dir.xz + 1e-5);
    vec2 sunAz = normalize(uSunDir.xz + 1e-5);
    float side = clamp(dot(az, sunAz) * 0.5 + 0.5, 0.0, 1.0);

    // horizon glow toward the sun azimuth
    float band = exp(-abs(h - max(uSunDir.y, -0.05) * 0.3) * 7.0);
    col += uGlow * uGlowStrength * band * pow(side, 3.0);

    // Mie-like halo: broad + tight lobe
    float m = max(mu, 0.0);
    col += uHalo * uHaloStrength * (pow(m, 6.0) * 0.35 + pow(m, 48.0) * 0.6) * smoothstep(-0.2, 0.05, h);

    // high cirrus: streaks projected on a dome plane, lit by forward scattering
    if (uCloudOpacity > 0.0 && h > 0.0) {
      vec2 uv = dir.xz / (h + 0.18);
      uv = vec2(uv.x * 0.55 + uv.y * 0.3, uv.y * 1.6 - uv.x * 0.2) * 1.4 + vec2(uTime * 0.004, uTime * 0.0015);
      float n = fbm(uv);
      float streak = fbm(uv * vec2(0.6, 3.2) + n * 1.4);
      float cirrus = smoothstep(0.5, 0.82, streak * 0.65 + n * 0.45);
      cirrus *= smoothstep(0.02, 0.2, h) * (1.0 - smoothstep(0.55, 0.95, h) * 0.6);
      vec3 cc = mix(uCloud, uSunColor * 1.15, pow(m, 6.0) * 0.6);
      col = mix(col, cc, cirrus * uCloudOpacity * 0.55);
    }

    // sun disc with soft corona; HDR so it blooms
    if (uSunDisc > 0.0) {
      float cosR = cos(uSunSize);
      float disc = smoothstep(cosR - 0.00012, cosR + 0.00006, mu);
      float corona = pow(m, 1400.0) * 0.8 + pow(m, 320.0) * 0.25;
      col += uSunColor * (disc * uSunDisc + corona * uSunDisc * 0.25) * smoothstep(-0.015, 0.01, h);
    }

    // dither against banding
    col += (hash12(gl_FragCoord.xy + fract(uTime) * 61.0) - 0.5) / 255.0;
    // never hand negative or NaN values to the post chain (bloom would spread them)
    col = max(col, vec3(0.0));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const moonVert = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vObj;
  varying vec3 vView;
  void main() {
    vObj = position;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vView = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const moonFrag = /* glsl */ `
  uniform vec3 uSunDir;
  uniform vec3 uC0;
  uniform vec3 uC1;
  uniform vec3 uC2;
  uniform vec3 uAtmo;
  uniform vec3 uHaze;
  uniform float uHazeAmount;
  uniform float uBright;
  varying vec3 vNormal;
  varying vec3 vObj;
  varying vec3 vView;
  ${GLSL_NOISE}
  void main() {
    vec3 n = normalize(vNormal);
    vec3 p = normalize(vObj);
    // latitude bands broken by turbulence
    float t = fbm(p.xz * 3.0 + p.y * 2.0);
    float bands = sin(p.y * 9.0 + t * 4.0) * 0.5 + 0.5;
    vec3 surf = mix(uC1, uC0, smoothstep(0.2, 0.8, bands));
    surf = mix(surf, uC2, smoothstep(0.55, 0.85, fbm(p.xy * 5.0 + t)) * 0.45);

    float ndl = dot(n, uSunDir);
    float lit = smoothstep(-0.08, 0.35, ndl);
    float fres = pow(clamp(1.0 - dot(n, vView), 0.0, 1.0), 3.0);
    vec3 col = surf * (0.03 + lit * uBright);
    col += uAtmo * fres * (0.15 + smoothstep(-0.25, 0.4, ndl) * 0.9);
    // sits inside our atmosphere: veil it with the sky
    col = mix(col, uHaze, uHazeAmount);
    // soft limb
    float alpha = smoothstep(0.0, 0.08, dot(n, vView));
    gl_FragColor = vec4(max(col, vec3(0.0)), alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const ringFrag = /* glsl */ `
  uniform vec3 uC;
  uniform vec3 uHaze;
  uniform float uHazeAmount;
  varying vec2 vUv;
  void main() {
    float r = vUv.x;
    float bands = 0.55 + 0.45 * sin(r * 70.0) * sin(r * 23.0 + 1.3);
    float a = smoothstep(0.0, 0.08, r) * smoothstep(1.0, 0.85, r) * bands * 0.55;
    vec3 col = mix(uC, uHaze, uHazeAmount);
    gl_FragColor = vec4(col, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
const ringVert = /* glsl */ `
  uniform float uInner;
  uniform float uOuter;
  varying vec2 vUv;
  void main() {
    vUv = vec2((length(position.xy) - uInner) / (uOuter - uInner), 0.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/** Hoisted so the per-frame traverse allocates no closure */
const unfogStar = (o: THREE.Object3D) => {
  const m = (o as THREE.Mesh).material as (THREE.Material & { fog?: boolean }) | undefined;
  if (m && (m.fog || m.depthWrite)) {
    m.fog = false;
    m.depthWrite = false;
    m.needsUpdate = true;
  }
};

interface SkyDomeProps {
  sky: ResolvedSky;
  reducedMotion?: boolean;
}

/** Gradient sky, sun, cirrus, starfield and a sister planet. Follows the camera. */
const SkyDome = ({ sky, reducedMotion }: SkyDomeProps) => {
  const group = useRef<THREE.Group>(null);
  const stars = useRef<THREE.Group>(null);

  const skyMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: skyVert,
        fragmentShader: skyFrag,
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        fog: false,
        uniforms: {
          uZenith: { value: sky.zenith },
          uUpper: { value: sky.upper },
          uHorizon: { value: sky.horizon },
          uGlow: { value: sky.glow },
          uGlowStrength: { value: sky.glowStrength },
          uHalo: { value: sky.halo },
          uHaloStrength: { value: sky.haloStrength },
          uSunDir: { value: sky.sunDir },
          uSunColor: { value: sky.sunColor },
          uSunDisc: { value: sky.sunDisc },
          uSunSize: { value: sky.sunSize },
          uCloud: { value: sky.cloudColor },
          uCloudOpacity: { value: sky.cloudOpacity },
          uTime: { value: 0 },
        },
      }),
    [sky],
  );

  // portrait phones: the full-width top bar and the narrow view need the moon nearer the
  // centre column and a little smaller
  const portrait = useThree((s) => s.size.width / Math.max(1, s.size.height) < 0.8);

  const moon = useMemo(() => {
    const dir = sky.moonDir.clone();
    let size = sky.moonSize;
    if (portrait) {
      // just right of centre, in the gap between the two framed labels, below the top bar
      const az = (1.5 * Math.PI) / 180;
      const el = (16 * Math.PI) / 180;
      dir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
      size *= 0.75;
    }
    const radius = Math.tan(size) * MOON_DISTANCE;
    const pos = dir.clone().multiplyScalar(MOON_DISTANCE);
    // haze heavier the lower it hangs
    const hazeAmount = 0.18 + (1 - Math.min(1, dir.y / 0.6)) * 0.2;
    const bright = sky.sunDisc > 0 ? 1.0 : 1.25;
    const mat = new THREE.ShaderMaterial({
      vertexShader: moonVert,
      fragmentShader: moonFrag,
      transparent: true,
      // writes depth so the far half of a ring is hidden behind the disc
      depthWrite: true,
      fog: false,
      uniforms: {
        uSunDir: { value: sky.sunDir },
        uC0: { value: sky.moonColors[0] },
        uC1: { value: sky.moonColors[1] },
        uC2: { value: sky.moonColors[2] },
        uAtmo: { value: sky.moonAtmosphere },
        uHaze: { value: sky.upper.clone().lerp(sky.horizon, 0.5) },
        uHazeAmount: { value: hazeAmount },
        uBright: { value: bright },
      },
    });
    const ringMat = sky.moonRings
      ? new THREE.ShaderMaterial({
          vertexShader: ringVert,
          fragmentShader: ringFrag,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          fog: false,
          uniforms: {
            uC: { value: sky.moonColors[1].clone().lerp(sky.moonAtmosphere, 0.3) },
            uHaze: { value: sky.horizon },
            uHazeAmount: { value: hazeAmount + 0.15 },
            uInner: { value: radius * 1.35 },
            uOuter: { value: radius * 2.2 },
          },
        })
      : null;
    return { radius, pos, mat, ringMat };
  }, [sky, portrait]);

  useEffect(
    () => () => {
      skyMat.dispose();
      moon.mat.dispose();
      moon.ringMat?.dispose();
    },
    [skyMat, moon],
  );

  useFrame(({ camera, clock }) => {
    group.current?.position.copy(camera.position);
    if (!reducedMotion) skyMat.uniforms.uTime.value = clock.elapsedTime;
    // the starfield is owned elsewhere; keep it unfogged and behind the sister planet
    const s = stars.current;
    if (s) {
      s.traverse(unfogStar);
    }
  });

  return (
    <group ref={group}>
      <mesh material={skyMat} renderOrder={-10} frustumCulled={false}>
        <sphereGeometry args={[DOME_RADIUS, 48, 24]} />
      </mesh>
      {sky.starOpacity > 0 && (
        <group ref={stars} renderOrder={-9}>
          <Starfield count={1800} radius={STAR_RADIUS} opacity={sky.starOpacity} />
        </group>
      )}
      <group position={moon.pos} renderOrder={-8}>
        <mesh material={moon.mat}>
          <sphereGeometry args={[moon.radius, 64, 32]} />
        </mesh>
        {moon.ringMat && (
          <mesh material={moon.ringMat} renderOrder={1} rotation={[-1.25, 0.35, 0.2]}>
            <ringGeometry args={[moon.radius * 1.35, moon.radius * 2.2, 128, 1]} />
          </mesh>
        )}
      </group>
    </group>
  );
};

export default SkyDome;
