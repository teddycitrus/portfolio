import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { Planet, PlanetStyle, Vec3 } from '@/types/content';
import { getOrbitalPosition } from '@/data/content';
import { useAppStore } from '@/state/useAppStore';
import { dragLook } from '@/state/runtime';
import { SUN_COLOR, SUN_DIRECTION } from './Sun';
import { STYLE_INDEX, getPlanetMaps, planetSeed } from './planetBake';

interface Props {
  planet: Planet;
}

const ATMO_SCALE: Record<PlanetStyle, number> = { oceanic: 1.09, rocky: 1.05, 'gas-giant': 1.06, forested: 1.09, molten: 1.07 };
const ATMO_STRENGTH: Record<PlanetStyle, number> = { oceanic: 1, rocky: 0.55, 'gas-giant': 0.75, forested: 1, molten: 0.6 };

const PLANET_VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vLocal;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  void main() {
    vUv = uv;
    vLocal = normalize(position);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

// Runtime shading from the baked maps; only lighting is computed per pixel
const PLANET_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform mat4 modelMatrix;
  uniform sampler2D uSurface;
  uniform sampler2D uDetail;
  uniform vec3 uB;
  uniform vec3 uAtmoColor;
  uniform vec3 uSun;
  uniform vec3 uSunColor;
  uniform int uStyle;
  uniform float uTime;
  uniform float uAtmo;
  varying vec2 vUv;
  varying vec3 vLocal;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

  float sq(float x) { return x * x; }

  void main() {
    vec4 S = texture2D(uSurface, vUv);
    vec4 D = texture2D(uDetail, vUv);
    vec3 albedo = S.rgb * S.rgb;
    float specMask = S.a;

    vec3 Ng = normalize(vWorldNormal);
    vec3 N = normalize(mat3(modelMatrix) * (D.xyz * 2.0 - 1.0));
    vec3 V = normalize(cameraPosition - vWorldPos);
    float NgL = dot(Ng, uSun);
    float NdL = max(dot(N, uSun), 0.0);
    float NdV = max(dot(Ng, V), 0.0);

    // Crisp terminator, sunlight reddened through the limb of the atmosphere
    float day = smoothstep(-0.03, 0.06, NgL);
    vec3 redden = mix(vec3(1.0, 0.5, 0.3), vec3(1.0), smoothstep(0.0, 0.32, NgL));
    vec3 col = albedo * uSunColor * redden * NdL * day;
    if (uStyle == 2) col *= mix(0.55, 1.0, pow(NdV, 0.35));

    float twilight = exp(-sq(NgL / 0.065));
    col += albedo * vec3(1.0, 0.45, 0.25) * twilight * 0.12 * uAtmo;
    col += albedo * (uAtmoColor * 0.01 + 0.004);

    if ((uStyle == 0 || uStyle == 3) && specMask > 0.01) {
      vec3 H = normalize(uSun + V);
      float nh = max(dot(Ng, H), 0.0);
      float fres = 0.02 + 0.98 * pow(1.0 - max(dot(H, V), 0.0), 5.0);
      float spec = pow(nh, 500.0) * 0.45 + pow(nh, 24.0) * 0.008;
      col += uSunColor * redden * spec * (0.5 + fres) * specMask * day;
    }

    if (uStyle == 4) {
      float crack = S.a;
      float pulse = 0.85 + 0.15 * sin(uTime * 0.6 + dot(vLocal, vec3(7.0, 5.0, 3.0)));
      vec3 lava = mix(vec3(1.0, 0.28, 0.04), mix(uB, vec3(1.0, 0.75, 0.4), 0.5), crack * crack);
      col += lava * crack * pulse * mix(2.4, 0.6, day);
    }

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
  uniform sampler2D uDetail;
  uniform vec3 uSun;
  uniform vec3 uSunColor;
  uniform vec3 uAtmoColor;
  varying vec2 vUv;
  varying vec3 vLocal;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

  void main() {
    float c = texture2D(uDetail, vUv).a;
    vec3 Ng = normalize(vWorldNormal);
    vec3 V = normalize(cameraPosition - vWorldPos);
    float NgL = dot(Ng, uSun);
    float lit = smoothstep(-0.05, 0.25, NgL) * (0.35 + 0.65 * max(NgL, 0.0));
    vec3 redden = mix(vec3(1.0, 0.55, 0.35), vec3(1.0), smoothstep(0.0, 0.3, NgL));
    vec3 col = vec3(0.6, 0.62, 0.64) * uSunColor * redden * lit + uAtmoColor * 0.01;
    float limb = smoothstep(0.0, 0.3, max(dot(Ng, V), 0.0));
    gl_FragColor = vec4(col, c * 0.8 * limb);
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
  const seed = useMemo(() => planetSeed(planet.id), [planet.id]);
  const gl = useThree((st) => st.gl);
  const maps = useMemo(() => getPlanetMaps(gl, planet, useAppStore.getState().isTouch), [gl, planet]);
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
        uSurface: { value: maps.surface },
        uDetail: { value: maps.detail },
        uB: { value: linear(planet.palette[1]) },
        uAtmoColor: { value: atmoColor },
        uSun: { value: SUN_DIRECTION },
        uSunColor: { value: SUN_COLOR },
        uStyle: { value: STYLE_INDEX[style] },
        uTime: { value: 0 },
        uAtmo: { value: ATMO_STRENGTH[style] },
      },
      vertexShader: PLANET_VERTEX,
      fragmentShader: PLANET_FRAGMENT,
    });
    const cloud = new THREE.ShaderMaterial({
      uniforms: {
        uDetail: { value: maps.detail },
        uSun: { value: SUN_DIRECTION },
        uSunColor: { value: SUN_COLOR },
        uAtmoColor: { value: atmoColor },
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
  }, [planet.accent, planet.palette, style, r, atmoR, ringInner, ringOuter, maps]);

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
    const hovered = s.hoveredPlanetId === planet.id && (s.mode === 'overworld' || s.mode === 'intro');
    const locked = s.lockedPlanetId === planet.id;
    hover.current += ((hovered ? 1 : 0) - hover.current) * damp(hovered ? 7 : 4, dt);
    const h = hover.current;

    mats.surface.uniforms.uTime.value = t;
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

  const interactive = () => {
    const m = useAppStore.getState().mode;
    return m === 'overworld' || m === 'intro';
  };
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
    const st = useAppStore.getState();
    if (st.mode === 'intro') st.start();
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
        <sphereGeometry args={[atmoR, 48, 32]} />
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
