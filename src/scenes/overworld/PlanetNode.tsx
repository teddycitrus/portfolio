import { useEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { Planet, PlanetStyle, Vec3 } from '@/types/content';
import { getOrbitalPosition } from '@/data/content';
import { useAppStore } from '@/state/useAppStore';
import { dragLook } from '@/state/runtime';
import { SUN_COLOR, SUN_DIRECTION } from './Sun';

interface Props {
  planet: Planet;
}

const STYLE_INDEX: Record<PlanetStyle, number> = {
  oceanic: 0,
  rocky: 1,
  'gas-giant': 2,
  forested: 3,
  molten: 4,
};
const BUMP: Record<PlanetStyle, number> = { oceanic: 0.05, rocky: 0.12, 'gas-giant': 0, forested: 0.05, molten: 0.09 };
const ATMO_SCALE: Record<PlanetStyle, number> = { oceanic: 1.09, rocky: 1.05, 'gas-giant': 1.06, forested: 1.09, molten: 1.07 };
const ATMO_STRENGTH: Record<PlanetStyle, number> = { oceanic: 1, rocky: 0.55, 'gas-giant': 0.75, forested: 1, molten: 0.6 };

/* ---------- shared GLSL ---------- */

const NOISE = /* glsl */ `
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
    for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.02 + 11.7; a *= 0.5; }
    return v;
  }
  float fbm3(vec3 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 3; i++) { v += a * noise(p); p = p * 2.03 + 5.3; a *= 0.5; }
    return v / 0.875;
  }
  vec3 warp(vec3 p) {
    return p + 1.4 * vec3(fbm3(p), fbm3(p + 5.2), fbm3(p + 9.7)) - 0.7;
  }
`;

const PLANET_VERTEX = /* glsl */ `
  varying vec3 vLocal;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  void main() {
    vLocal = normalize(position);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const PLANET_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform vec3 uA;
  uniform vec3 uB;
  uniform vec3 uC;
  uniform vec3 uAtmoColor;
  uniform vec3 uSun;
  uniform vec3 uSunColor;
  uniform int uStyle;
  uniform float uSeed;
  uniform float uTime;
  uniform float uRadius;
  uniform float uBump;
  uniform float uAtmo;
  varying vec3 vLocal;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

  ${NOISE}

  // Sum of crater profiles in a jittered 3D grid: bowl, raised rim
  float craters(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    float h = 0.0;
    for (int x = -1; x <= 1; x++)
    for (int y = -1; y <= 1; y++)
    for (int z = -1; z <= 1; z++) {
      vec3 g = vec3(float(x), float(y), float(z));
      vec3 o = hash33(i + g);
      float r = 0.18 + 0.27 * o.z * o.z;
      float d = length(g + o - f) / r;
      float keep = step(0.45, hash13(i + g + 19.1));
      float bowl = d < 1.0 ? (d * d - 1.0) * 0.7 : 0.0;
      float rim = 0.3 * exp(-sq((d - 1.0) * 4.5));
      h += keep * (bowl + rim) * r * 2.0;
    }
    return h;
  }

  // F1, F2 cellular distances
  vec2 cells(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    float f1 = 8.0, f2 = 8.0;
    for (int x = -1; x <= 1; x++)
    for (int y = -1; y <= 1; y++)
    for (int z = -1; z <= 1; z++) {
      vec3 g = vec3(float(x), float(y), float(z));
      float d = length(g + hash33(i + g) - f);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
    }
    return vec2(f1, f2);
  }

  vec3 perturb(vec3 N, vec3 pos, float h) {
    vec3 dpdx = dFdx(pos), dpdy = dFdy(pos);
    float dhx = dFdx(h), dhy = dFdy(h);
    vec3 r1 = cross(dpdy, N), r2 = cross(N, dpdx);
    float det = dot(dpdx, r1);
    if (abs(det) < 1e-14) return N;
    vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
    return normalize(abs(det) * N - grad);
  }

  void main() {
    vec3 sp = vLocal + vec3(uSeed, uSeed * 0.71, -uSeed * 1.3);
    vec3 albedo;
    float h = 0.0;
    float specMask = 0.0;
    vec3 emissive = vec3(0.0);

    if (uStyle == 0 || uStyle == 3) {
      // Oceanic and forested: warped continents, coastal shallows, ice caps
      bool forest = uStyle == 3;
      float sea = forest ? 0.5 : 0.56;
      vec3 q = warp(sp * 1.5);
      float n = fbm(q * 1.2);
      float land = smoothstep(sea, sea + 0.015, n);
      float shallow = smoothstep(sea - 0.12, sea, n);
      vec3 deep = forest ? mix(uC, vec3(0.006, 0.02, 0.03), 0.5) : uC;
      vec3 ocean = mix(deep, mix(uA, uC, 0.35) * 0.8, shallow * 0.6);
      float alt = clamp((n - sea) / 0.25, 0.0, 1.0);
      float detail = fbm3(sp * 9.0);
      vec3 low = forest ? uA * 0.32 : mix(vec3(0.16, 0.13, 0.09), uA * 0.3, 0.3);
      vec3 mid = forest ? mix(uA * 0.5, vec3(0.2, 0.18, 0.11), 0.45) : vec3(0.27, 0.23, 0.17);
      vec3 high = vec3(0.24, 0.22, 0.2);
      vec3 ground = mix(low, mid, smoothstep(0.1, 0.5, alt + (detail - 0.5) * 0.3));
      ground = mix(ground, high, smoothstep(0.55, 0.9, alt));
      albedo = mix(ocean, ground, land);
      float ice = smoothstep(0.8, 0.86, abs(vLocal.y) + (fbm3(sp * 4.0) - 0.5) * 0.18);
      ice = max(ice, smoothstep(0.82, 0.95, alt) * land);
      albedo = mix(albedo, mix(vec3(0.7, 0.74, 0.78), uB, 0.15), ice);
      specMask = (1.0 - land) * (1.0 - ice);
      h = land * (alt * 0.6 + detail * 0.15);
    } else if (uStyle == 1) {
      // Rocky: warped regolith with two crater scales
      vec3 q = warp(sp * 1.4);
      float n = fbm(q * 1.5);
      float cr = craters(vLocal * 3.5 + uSeed) * 0.55 + craters(vLocal * 8.0 + uSeed * 2.0) * 0.3;
      float fine = fbm3(sp * 14.0);
      albedo = mix(uC * 1.4, uA * 0.85, smoothstep(0.3, 0.7, n));
      albedo = mix(albedo, uB * 0.6, smoothstep(0.62, 0.85, n + (fine - 0.5) * 0.25) * 0.55);
      albedo *= 0.82 + 0.35 * smoothstep(-0.3, 0.15, cr) + (fine - 0.5) * 0.15;
      h = n * 0.5 + cr + fine * 0.04;
    } else if (uStyle == 2) {
      // Gas giant: latitude bands sheared by turbulent flow, one storm oval
      vec3 lp = vLocal;
      float flow = fbm(vec3(lp.x * 2.0, lp.y * 9.0, lp.z * 2.0) + uSeed + vec3(uTime * 0.008, 0.0, 0.0));
      float y = lp.y + (flow - 0.5) * 0.09;
      y += (fbm3(vec3(lp.x * 5.0, lp.y * 26.0, lp.z * 5.0) + uSeed) - 0.5) * 0.025;
      vec3 sc = normalize(vec3(0.75, -0.32, 0.58));
      vec3 dv = (lp - sc) * vec3(1.0, 2.4, 1.0);
      float storm = exp(-dot(dv, dv) * 40.0);
      y += storm * 0.04 * sin(atan(dv.y, dv.x + dv.z) * 2.0 + uTime * 0.05);
      float b1 = 0.5 + 0.5 * sin(y * 21.0 + 0.6);
      float b2 = 0.5 + 0.5 * sin(y * 9.0 + 1.9);
      float zone = smoothstep(0.55, 0.95, 0.5 + 0.5 * sin(y * 13.0 + 0.4));
      albedo = mix(uC * 1.3, uA * 0.85, b1 * 0.7 + b2 * 0.3);
      albedo = mix(albedo, uB * 0.7, zone * 0.5);
      albedo *= 0.88 + 0.24 * fbm3(vec3(lp.x * 7.0, y * 60.0, lp.z * 7.0));
      albedo = mix(albedo, mix(uB * 0.85, vec3(0.75, 0.62, 0.58), 0.4), storm * 0.75);
    } else {
      // Molten: dark basalt plates split by glowing fissures
      vec3 q = warp(sp * 1.8);
      vec2 c1 = cells(q * 2.2);
      vec2 c2 = cells(q * 5.5 + 3.0);
      float plate = fbm(q * 2.0);
      float w1 = 0.05 + 0.05 * fbm3(sp * 6.0);
      float crack = 1.0 - smoothstep(0.0, w1, c1.y - c1.x);
      crack = max(crack, (1.0 - smoothstep(0.0, 0.035, c2.y - c2.x)) * 0.55);
      albedo = mix(vec3(0.035, 0.03, 0.028), uC * 0.9, plate);
      albedo = mix(albedo, uA * 0.32, smoothstep(0.6, 0.8, plate) * 0.5);
      float pulse = 0.85 + 0.15 * sin(uTime * 0.6 + plate * 12.0);
      vec3 lava = mix(vec3(1.0, 0.28, 0.04), mix(uB, vec3(1.0, 0.75, 0.4), 0.5), crack * crack);
      emissive = lava * crack * pulse;
      albedo *= 1.0 - crack * 0.8;
      h = plate * 0.4 - crack * 0.35;
    }

    // Keep palettes restrained
    float l = dot(albedo, vec3(0.2126, 0.7152, 0.0722));
    albedo = mix(vec3(l), albedo, 0.84);

    vec3 Ng = normalize(vWorldNormal);
    vec3 N = uBump > 0.0 ? perturb(Ng, vWorldPos, h * uBump * uRadius) : Ng;
    vec3 V = normalize(cameraPosition - vWorldPos);
    float NgL = dot(Ng, uSun);
    float NdL = max(dot(N, uSun), 0.0);
    float NdV = max(dot(Ng, V), 0.0);

    // Crisp terminator, sunlight reddened through the limb of the atmosphere
    float day = smoothstep(-0.03, 0.06, NgL);
    vec3 redden = mix(vec3(1.0, 0.5, 0.3), vec3(1.0), smoothstep(0.0, 0.32, NgL));
    vec3 col = albedo * uSunColor * redden * NdL * day;
    if (uStyle == 2) col *= mix(0.55, 1.0, pow(NdV, 0.35));

    float twilight = exp(-sq(NgL / 0.08));
    col += albedo * vec3(1.0, 0.42, 0.22) * twilight * 0.18 * uAtmo;
    col += albedo * (uAtmoColor * 0.01 + 0.004);

    if (specMask > 0.0) {
      vec3 H = normalize(uSun + V);
      float nh = max(dot(Ng, H), 0.0);
      float fres = 0.02 + 0.98 * pow(1.0 - max(dot(H, V), 0.0), 5.0);
      float spec = pow(nh, 140.0) * 2.2 + pow(nh, 20.0) * 0.06;
      col += uSunColor * redden * spec * (0.5 + fres) * specMask * day;
    }

    // Night side emission (lava reads strongest in the dark)
    col += emissive * mix(2.4, 0.6, day);

    // Aerial haze across the disc, strongest toward the lit limb
    float rim = pow(1.0 - NdV, 2.6);
    float hazeLight = smoothstep(-0.2, 0.55, NgL);
    vec3 hazeCol = mix(uAtmoColor * vec3(1.0, 0.6, 0.45), uAtmoColor, smoothstep(0.0, 0.4, NgL));
    col = mix(col, hazeCol * 0.55 * hazeLight, rim * 0.55 * uAtmo * hazeLight);

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

const CLOUD_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform vec3 uSun;
  uniform vec3 uSunColor;
  uniform vec3 uAtmoColor;
  uniform float uSeed;
  uniform float uTime;
  uniform float uCover;
  varying vec3 vLocal;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

  ${NOISE}

  void main() {
    vec3 p = vLocal * vec3(2.2, 3.6, 2.2) + uSeed * 1.7 + vec3(uTime * 0.004, 0.0, 0.0);
    vec3 q = warp(p);
    float d = fbm(q * 1.4);
    float c = smoothstep(uCover, uCover + 0.22, d);
    c *= 0.55 + 0.45 * fbm3(p * 6.0);
    vec3 Ng = normalize(vWorldNormal);
    vec3 V = normalize(cameraPosition - vWorldPos);
    float NgL = dot(Ng, uSun);
    float lit = smoothstep(-0.05, 0.25, NgL) * (0.35 + 0.65 * max(NgL, 0.0));
    vec3 redden = mix(vec3(1.0, 0.55, 0.35), vec3(1.0), smoothstep(0.0, 0.3, NgL));
    vec3 col = vec3(0.6, 0.62, 0.64) * uSunColor * redden * lit + uAtmoColor * 0.01;
    float limb = smoothstep(0.0, 0.25, max(dot(Ng, V), 0.0));
    gl_FragColor = vec4(col, c * 0.85 * limb);
    #include <colorspace_fragment>
  }
`;

const ATMO_VERTEX = /* glsl */ `
  varying vec3 vWorldPos;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

// Back faces of the outer shell: density from the closest approach of the view ray to the planet centre
const ATMO_FRAGMENT = /* glsl */ `
  uniform vec3 uCenter;
  uniform vec3 uColor;
  uniform vec3 uSun;
  uniform float uR;
  uniform float uRa;
  uniform float uIntensity;
  varying vec3 vWorldPos;
  void main() {
    vec3 rd = normalize(vWorldPos - cameraPosition);
    vec3 oc = uCenter - cameraPosition;
    vec3 closest = cameraPosition + rd * dot(oc, rd);
    vec3 up = closest - uCenter;
    float d = length(up);
    float h = clamp((d - uR) / (uRa - uR), 0.0, 1.0);
    float dens = exp(-h * 4.5) * (1.0 - h);
    float s = dot(up / max(d, 1e-4), uSun);
    float light = smoothstep(-0.4, 0.6, s);
    vec3 col = mix(uColor * vec3(1.0, 0.55, 0.4), uColor, smoothstep(-0.1, 0.45, s));
    gl_FragColor = vec4(col * dens * light * uIntensity, 1.0);
  }
`;

const RING_VERTEX = /* glsl */ `
  varying vec3 vWorldPos;
  varying vec3 vNormalW;
  varying float vR;
  void main() {
    vR = length(position.xy);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vNormalW = normalize(mat3(modelMatrix) * vec3(0.0, 0.0, 1.0));
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const RING_FRAGMENT = /* glsl */ `
  uniform vec3 uA;
  uniform vec3 uB;
  uniform vec3 uCenter;
  uniform vec3 uSun;
  uniform vec3 uSunColor;
  uniform float uR;
  uniform float uInner;
  uniform float uOuter;
  varying vec3 vWorldPos;
  varying vec3 vNormalW;
  varying float vR;

  float sq(float x) { return x * x; }
  float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
  float noise1(float x) { float i = floor(x), f = fract(x); return mix(hash11(i), hash11(i + 1.0), f * f * (3.0 - 2.0 * f)); }

  void main() {
    float t = (vR - uInner) / (uOuter - uInner);
    float fw = fwidth(t);
    float dens = smoothstep(0.0, 0.06, t) * (1.0 - smoothstep(0.86, 1.0, t));
    dens *= 0.3 + 0.5 * noise1(t * 18.0) + 0.2 * noise1(t * 47.0 + 3.0);
    float fineAmp = clamp(1.0 - fw * 140.0, 0.0, 1.0);
    dens *= 1.0 - 0.3 * fineAmp * noise1(t * 160.0);
    dens *= 1.0 - 0.9 * exp(-sq((t - 0.64) / 0.022));
    dens *= 1.0 - 0.5 * exp(-sq((t - 0.27) / 0.012));

    vec3 base = mix(uA, uB, 0.35 + 0.4 * noise1(t * 9.0));
    float l = dot(base, vec3(0.2126, 0.7152, 0.0722));
    base = mix(vec3(l), base, 0.55) * 0.75;

    vec3 V = normalize(cameraPosition - vWorldPos);
    float nl = dot(vNormalW, uSun);
    float nv = dot(vNormalW, V);
    float lit = 0.2 + 0.8 * abs(nl);
    if (nl * nv < 0.0) lit *= 0.35 + 0.4 * (1.0 - dens);

    vec3 toC = uCenter - vWorldPos;
    float along = dot(toC, uSun);
    float dist = length(toC - uSun * along);
    float shadow = along > 0.0 ? smoothstep(uR * 0.97, uR * 1.03, dist) : 1.0;

    vec3 col = base * uSunColor * lit * (0.06 + 0.94 * shadow);
    gl_FragColor = vec4(col, clamp(dens, 0.0, 1.0) * 0.9);
    #include <colorspace_fragment>
  }
`;

/* ---------- helpers ---------- */

const seedFor = (id: string) => {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) * 0.0731;
};

const linear = (hex: string) => new THREE.Color(hex);
const damp = (k: number, dt: number) => 1 - Math.exp(-k * dt);

const _pos: Vec3 = [0, 0, 0];

const PlanetNode = ({ planet }: Props) => {
  const orbit = useRef<THREE.Group>(null);
  const spin = useRef<THREE.Group>(null);
  const clouds = useRef<THREE.Mesh>(null);
  const target = useRef<THREE.Group>(null);
  const arcs = useRef<THREE.Group>(null);
  const hover = useRef(0);

  const { radius: r, style } = planet;
  const seed = useMemo(() => seedFor(planet.id), [planet.id]);
  const tilt = useMemo(() => ((seed * 7.3) % 0.5) - 0.25, [seed]);
  const spinSpeed = 0.025 + ((seed * 3.1) % 1) * 0.025;
  const hasClouds = style === 'oceanic' || style === 'forested';
  const atmoR = r * ATMO_SCALE[style];
  const haloScale = Math.max(ATMO_STRENGTH[style], 0.7);
  const ringInner = r * 1.38;
  const ringOuter = r * 2.25;

  const mats = useMemo(() => {
    const atmoColor = linear(planet.accent).lerp(new THREE.Color(0.55, 0.65, 0.8), 0.25);
    const surface = new THREE.ShaderMaterial({
      uniforms: {
        uA: { value: linear(planet.palette[0]) },
        uB: { value: linear(planet.palette[1]) },
        uC: { value: linear(planet.palette[2]) },
        uAtmoColor: { value: atmoColor },
        uSun: { value: SUN_DIRECTION },
        uSunColor: { value: SUN_COLOR },
        uStyle: { value: STYLE_INDEX[style] },
        uSeed: { value: seed },
        uTime: { value: 0 },
        uRadius: { value: r },
        uBump: { value: BUMP[style] },
        uAtmo: { value: ATMO_STRENGTH[style] },
      },
      vertexShader: PLANET_VERTEX,
      fragmentShader: PLANET_FRAGMENT,
    });
    const cloud = new THREE.ShaderMaterial({
      uniforms: {
        uSun: { value: SUN_DIRECTION },
        uSunColor: { value: SUN_COLOR },
        uAtmoColor: { value: atmoColor },
        uSeed: { value: seed },
        uTime: { value: 0 },
        uCover: { value: style === 'forested' ? 0.52 : 0.5 },
      },
      vertexShader: PLANET_VERTEX,
      fragmentShader: CLOUD_FRAGMENT,
      transparent: true,
      depthWrite: false,
    });
    const atmo = new THREE.ShaderMaterial({
      uniforms: {
        uCenter: { value: new THREE.Vector3() },
        uColor: { value: atmoColor },
        uSun: { value: SUN_DIRECTION },
        uR: { value: r },
        uRa: { value: atmoR },
        uIntensity: { value: 1 },
      },
      vertexShader: ATMO_VERTEX,
      fragmentShader: ATMO_FRAGMENT,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const ring = new THREE.ShaderMaterial({
      uniforms: {
        uA: { value: linear(planet.palette[0]) },
        uB: { value: linear(planet.palette[1]) },
        uCenter: { value: new THREE.Vector3() },
        uSun: { value: SUN_DIRECTION },
        uSunColor: { value: SUN_COLOR },
        uR: { value: r },
        uInner: { value: ringInner },
        uOuter: { value: ringOuter },
      },
      vertexShader: RING_VERTEX,
      fragmentShader: RING_FRAGMENT,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
    });
    const reticle = new THREE.MeshBasicMaterial({
      color: linear(planet.accent),
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
    return { surface, cloud, atmo, ring, reticle };
  }, [planet.accent, planet.palette, style, seed, r, atmoR, ringInner, ringOuter]);

  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);

  // Reticle line thickness tuned to roughly 1.5px at the planet's resting distance
  const reticleGeo = useMemo(() => {
    const dist = Math.hypot(...planet.position);
    const th = (dist * 0.0018) / (r * 1.32);
    const circle = new THREE.RingGeometry(1 - th / 2, 1 + th / 2, 160);
    const arc = (i: number) =>
      new THREE.RingGeometry(1.07, 1.07 + th * 1.6, 24, 1, (i * Math.PI) / 2 + Math.PI / 4 - 0.16, 0.32);
    return { circle, arcs: [0, 1, 2, 3].map(arc) };
  }, [planet.position, r]);

  useEffect(
    () => () => {
      reticleGeo.circle.dispose();
      reticleGeo.arcs.forEach((g) => g.dispose());
    },
    [reticleGeo],
  );

  useFrame(({ clock, camera }, dt) => {
    const o = orbit.current;
    if (!o) return;
    const t = clock.elapsedTime;
    getOrbitalPosition(planet, t, _pos);
    o.position.set(_pos[0], _pos[1], _pos[2]);

    if (spin.current) spin.current.rotation.y += dt * spinSpeed;
    if (clouds.current) clouds.current.rotation.y += dt * spinSpeed * 0.7;

    const s = useAppStore.getState();
    const hovered = s.hoveredPlanetId === planet.id && s.mode === 'overworld';
    const locked = s.lockedPlanetId === planet.id;
    hover.current += ((hovered ? 1 : 0) - hover.current) * damp(hovered ? 7 : 4, dt);
    const h = hover.current;

    mats.surface.uniforms.uTime.value = t;
    mats.cloud.uniforms.uTime.value = t;
    mats.atmo.uniforms.uCenter.value.copy(o.position);
    mats.atmo.uniforms.uIntensity.value = (0.95 + 0.75 * h + (locked ? 0.3 : 0)) * haloScale;
    mats.ring.uniforms.uCenter.value.copy(o.position);

    const tg = target.current;
    if (tg) {
      tg.visible = h > 0.005;
      if (tg.visible) {
        tg.quaternion.copy(camera.quaternion);
        tg.scale.setScalar(r * 1.32 * (1 + 0.15 * (1 - h)));
        mats.reticle.opacity = 0.5 * h;
        if (arcs.current) arcs.current.rotation.z += dt * 0.12;
      }
    }
  });

  const interactive = () => useAppStore.getState().mode === 'overworld';
  const onOver = (e: ThreeEvent<PointerEvent>) => {
    if (!interactive()) return;
    e.stopPropagation();
    useAppStore.getState().setHoveredPlanet(planet.id);
    document.body.style.cursor = 'pointer';
  };
  const onOut = () => {
    const s = useAppStore.getState();
    if (s.hoveredPlanetId === planet.id) s.setHoveredPlanet(null);
    document.body.style.cursor = '';
  };
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (!interactive() || dragLook.travel >= 6) return;
    e.stopPropagation();
    document.body.style.cursor = '';
    useAppStore.getState().travelTo(planet.id);
  };

  return (
    <group ref={orbit}>
      <group rotation={[0, 0, tilt]}>
        <group ref={spin}>
          <mesh material={mats.surface}>
            <sphereGeometry args={[r, 96, 64]} />
          </mesh>
        </group>
        {hasClouds && (
          <mesh ref={clouds} material={mats.cloud} scale={1.016}>
            <sphereGeometry args={[r, 72, 48]} />
          </mesh>
        )}
        {planet.rings && (
          <mesh material={mats.ring} rotation={[-Math.PI / 2 + 0.38, 0.12, 0]}>
            <ringGeometry args={[ringInner, ringOuter, 192, 1]} />
          </mesh>
        )}
      </group>
      <mesh material={mats.atmo}>
        <sphereGeometry args={[atmoR, 64, 48]} />
      </mesh>
      <mesh visible={false} onPointerOver={onOver} onPointerOut={onOut} onClick={onClick}>
        <sphereGeometry args={[r * 1.25, 24, 16]} />
      </mesh>
      <group ref={target} visible={false} renderOrder={10}>
        <mesh geometry={reticleGeo.circle} material={mats.reticle} renderOrder={10} />
        <group ref={arcs}>
          {reticleGeo.arcs.map((g, i) => (
            <mesh key={i} geometry={g} material={mats.reticle} renderOrder={10} />
          ))}
        </group>
      </group>
    </group>
  );
};

export default PlanetNode;
