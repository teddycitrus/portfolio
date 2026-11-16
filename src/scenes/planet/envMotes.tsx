import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { Planet } from '@/types/content';
import type { ResolvedSky } from '@/data/skyPresets';
import { mulberry, seedOf } from './rng';

interface MoteStyle {
  count: number;
  box: number;
  size: number;
  alpha: number;
  wind: [number, number, number];
  color: (sky: ResolvedSky, accent: THREE.Color) => THREE.Color;
}

const STYLES: Record<Planet['style'], MoteStyle> = {
  // dust held in the low sun
  rocky: {
    count: 240,
    box: 26,
    size: 15,
    alpha: 0.3,
    wind: [0.1, 0.012, -0.05],
    color: (s) => s.lightColor.clone().lerp(s.fogColor, 0.45),
  },
  // spores drifting up out of the undergrowth
  forested: {
    count: 200,
    box: 24,
    size: 15,
    alpha: 0.3,
    wind: [0.04, 0.05, 0.03],
    color: (s, a) => a.clone().lerp(s.fogColor, 0.35),
  },
  // salt haze off the water
  oceanic: {
    count: 180,
    box: 30,
    size: 18,
    alpha: 0.14,
    wind: [0.16, 0.01, 0.08],
    color: (s) => s.fogColor.clone().lerp(new THREE.Color('#ffffff'), 0.4),
  },
  // fine ice in thin air, catching the moon
  'gas-giant': {
    count: 220,
    box: 28,
    size: 11,
    alpha: 0.34,
    wind: [0.05, -0.01, 0.03],
    color: (s, a) => a.clone().lerp(s.hemiSky, 0.5),
  },
  // cold ash sifting down; the embers rise from the flora layer
  molten: {
    count: 240,
    box: 26,
    size: 12,
    alpha: 0.3,
    wind: [0.08, -0.07, 0.02],
    color: (s) => new THREE.Color('#8a8078').lerp(s.fogColor, 0.35),
  },
};

const vert = /* glsl */ `
  uniform float uTime;
  uniform float uBox;
  uniform float uSize;
  uniform vec3 uWind;
  uniform vec3 uSun;
  attribute vec4 aSeed;
  varying float vA;
  void main() {
    // each mote wraps inside a box centred on the camera, so the field needs no CPU work
    vec3 q = position + uWind * uTime * aSeed.w
      + vec3(sin(uTime * 0.13 + aSeed.x * 30.0) * 0.4, sin(uTime * 0.1 + aSeed.y * 30.0) * 0.25, cos(uTime * 0.11 + aSeed.z * 30.0) * 0.4);
    vec3 p = mod(q - cameraPosition + uBox * 0.5, uBox) - uBox * 0.5;
    float d = length(p);
    float ends = (1.0 - smoothstep(uBox * 0.32, uBox * 0.5, d)) * smoothstep(0.7, 2.6, d);
    // forward scattering: visible toward the light, nearly gone elsewhere
    float m = clamp(dot(p / max(d, 0.001), uSun), 0.0, 1.0);
    vA = ends * (0.35 + 0.65 * m * m * m);
    vec4 mv = viewMatrix * vec4(cameraPosition + p, 1.0);
    gl_PointSize = clamp(uSize / max(-mv.z, 0.5), 0.8, 3.2) * (0.7 + aSeed.y * 0.6);
    gl_Position = projectionMatrix * mv;
  }
`;

const frag = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  varying float vA;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r2 = dot(c, c) * 4.0;
    float s = max(1.0 - r2, 0.0);
    gl_FragColor = vec4(uColor, s * s * vA * uAlpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

interface EnvMotesProps {
  planet: Planet;
  sky: ResolvedSky;
  reducedMotion?: boolean;
  isTouch: boolean;
}

/** Ambient particles for each world, drifting around the viewer in a GPU-wrapped box. */
const EnvMotes = ({ planet, sky, reducedMotion, isTouch }: EnvMotesProps) => {
  const dpr = useThree((s) => s.viewport.dpr);
  const built = useMemo(() => {
    const def = STYLES[planet.style];
    const count = Math.round(def.count * (isTouch ? 0.55 : 1));
    const rnd = mulberry(seedOf(`${planet.id}-motes`));
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count * 4);
    for (let i = 0; i < count; i += 1) {
      pos.set([rnd() * def.box, rnd() * def.box, rnd() * def.box], i * 3);
      seed.set([rnd(), rnd(), rnd(), 0.6 + rnd() * 0.8], i * 4);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    const mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTime: { value: 0 },
        uBox: { value: def.box },
        uSize: { value: def.size * dpr },
        uWind: { value: new THREE.Vector3(...def.wind) },
        uSun: { value: sky.lightDir },
        uColor: { value: def.color(sky, new THREE.Color(planet.accent)) },
        uAlpha: { value: def.alpha },
      },
    });
    return { geo, mat };
  }, [planet, sky, isTouch, dpr]);

  useEffect(
    () => () => {
      built.geo.dispose();
      built.mat.dispose();
    },
    [built],
  );

  useFrame((_, dt) => {
    if (!reducedMotion) built.mat.uniforms.uTime.value += Math.min(dt, 0.1);
  });

  return <points geometry={built.geo} material={built.mat} frustumCulled={false} renderOrder={3} raycast={() => undefined} />;
};

export default EnvMotes;
