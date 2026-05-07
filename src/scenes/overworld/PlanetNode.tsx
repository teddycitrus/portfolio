import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Planet, PlanetStyle } from '@/types/content';
import { getOrbitalPosition } from '@/data/content';
import { useAppStore } from '@/state/useAppStore';

interface Props {
  planet: Planet;
}

const styleIndex: Record<PlanetStyle, number> = {
  oceanic: 0,
  rocky: 1,
  'gas-giant': 2,
  forested: 3,
};

const VERTEX = /* glsl */ `
  varying vec3 vLocalPos;
  varying vec3 vNormal;
  void main() {
    vLocalPos = position;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  precision highp float;
  uniform vec3 colorA;
  uniform vec3 colorB;
  uniform vec3 colorC;
  uniform int style;
  uniform float seed;
  uniform vec3 lightDir;
  varying vec3 vLocalPos;
  varying vec3 vNormal;

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

  void main() {
    vec3 p = vLocalPos * 1.4 + vec3(seed, seed * 0.7 + 1.0, seed * 1.3 - 0.5);
    vec3 col;

    if (style == 0) {
      // Oceanic — large landmasses on a deep ocean
      float n = fbm(p);
      float landMask = smoothstep(0.46, 0.55, n);
      vec3 land = mix(colorA, colorB, smoothstep(0.55, 0.72, n));
      col = mix(colorC, land, landMask);
      col += colorB * 0.1 * fbm(p * 5.0); // surf wisps
    } else if (style == 1) {
      // Rocky — high-frequency desert noise
      float base = fbm(p * 1.6);
      float detail = fbm(p * 5.0);
      col = mix(colorA, colorB, base);
      col = mix(col, colorC, detail * 0.35);
    } else if (style == 2) {
      // Gas giant — horizontal bands warped by noise
      float bands = sin(p.y * 5.0 + fbm(p * 1.5) * 2.6) * 0.5 + 0.5;
      col = mix(colorA, colorB, bands);
      col += colorC * (fbm(p * 4.0) - 0.4) * 0.4;
    } else {
      // Forested — green continents in dark sea
      float n = fbm(p * 1.2);
      float landMask = smoothstep(0.42, 0.52, n);
      vec3 land = mix(colorC, colorA, smoothstep(0.5, 0.7, n));
      land = mix(land, colorB, smoothstep(0.7, 0.85, n));
      col = mix(colorC, land, landMask);
    }

    // Simple lambertian + soft ambient
    float diff = max(dot(normalize(vNormal), normalize(lightDir)), 0.0);
    col *= 0.22 + diff * 0.85;

    // Subtle limb darkening
    float fres = pow(1.0 - max(vNormal.z, 0.0), 2.0);
    col *= mix(1.0, 0.85, fres);

    gl_FragColor = vec4(col, 1.0);
  }
`;

const PlanetNode = ({ planet }: Props) => {
  const orbitRef = useRef<THREE.Group>(null);
  const spinRef = useRef<THREE.Group>(null);

  const seed = useMemo(() => {
    let h = 0;
    for (let i = 0; i < planet.id.length; i += 1) {
      h = (h * 31 + planet.id.charCodeAt(i)) & 0xffffffff;
    }
    return Math.abs(h % 1000) * 0.137;
  }, [planet.id]);

  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        colorA: { value: new THREE.Color(planet.palette[0]) },
        colorB: { value: new THREE.Color(planet.palette[1]) },
        colorC: { value: new THREE.Color(planet.palette[2]) },
        style: { value: styleIndex[planet.style] },
        seed: { value: seed },
        lightDir: { value: new THREE.Vector3(0.5, 0.8, 0.4).normalize() },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
    });
  }, [planet.palette, planet.style, seed]);

  const mode = useAppStore((s) => s.mode);

  useFrame((state, delta) => {
    if (!orbitRef.current) return;
    const t = state.clock.elapsedTime;
    const [x, y, z] = getOrbitalPosition(planet, t);
    orbitRef.current.position.set(x, y, z);

    if (spinRef.current) {
      // Independent slow self-rotation per planet
      spinRef.current.rotation.y += delta * (0.06 + (seed % 1) * 0.04);
    }
  });

  if (mode === 'planet' || mode === 'transitioning-out') return null;

  return (
    <group ref={orbitRef}>
      <group ref={spinRef}>
        <mesh material={material}>
          <sphereGeometry args={[planet.radius, 64, 48]} />
        </mesh>
      </group>
    </group>
  );
};

export default PlanetNode;
