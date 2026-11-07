import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/* Pieces shared by the monuments and the built sites. */

export const noRaycast = () => null;

/** Adds a view-angle rim to a standard material so stone never reads as a flat silhouette. */
export const addRim = (m: THREE.MeshStandardMaterial, color: THREE.Color, strength: number) => {
  m.customProgramCacheKey = () => 'beacon-rim';
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uRim = { value: color.clone().multiplyScalar(strength) };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRim;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float rimF = pow(1.0 - saturate(dot(normalize(normal), normalize(vViewPosition))), 2.5);
        totalEmissiveRadiance += uRim * (0.2 + rimF);`,
      );
  };
  return m;
};

/** A soft additive disc of light on the ground. */
export const glowMaterial = (color: THREE.Color | string) =>
  new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    uniforms: { uColor: { value: new THREE.Color(color) }, uIntensity: { value: 0.5 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uIntensity;
      varying vec2 vUv;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float a = exp(-d * d * 4.5) * (1.0 - smoothstep(0.85, 1.0, d));
        gl_FragColor = vec4(uColor * a * uIntensity, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });

/** A cylinder from a to b (for arms, struts, legs). */
export const Strut = ({ a, b, r, material }: { a: [number, number, number]; b: [number, number, number]; r: number; material: THREE.Material }) => {
  const { pos, quat, len } = useMemo(() => {
    const va = new THREE.Vector3(...a);
    const vb = new THREE.Vector3(...b);
    const d = vb.clone().sub(va);
    return {
      pos: va.clone().add(vb).multiplyScalar(0.5),
      quat: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()),
      len: d.length(),
    };
  }, [a, b]);
  return (
    <mesh material={material} position={pos} quaternion={quat} castShadow raycast={noRaycast}>
      <cylinderGeometry args={[r, r, len, 7]} />
    </mesh>
  );
};

/** How bright a fire burns, 0..1; the owner writes it every frame. */
export interface FireLevel {
  v: number;
}

const flameMaterial = () =>
  new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
    uniforms: { uTime: { value: 0 }, uLevel: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uLevel;
      varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      void main() {
        float y = vUv.y;
        // tongues of flame rising, licking sideways more toward the tip
        float n = noise(vec2(vUv.x * 5.0, y * 4.0 - uTime * 3.2)) * 0.6 + noise(vec2(vUv.x * 11.0, y * 7.0 - uTime * 5.0)) * 0.4;
        float x = vUv.x - 0.5 + (n - 0.5) * 0.28 * y;
        // a teardrop: round at the base, drawn to a point
        float prof = 0.36 * pow(sin(3.14159 * pow(clamp(y, 0.0, 1.0), 0.55)), 0.9) * (0.75 + 0.5 * n);
        float d = abs(x) / max(prof, 1e-3);
        float body = smoothstep(1.0, 0.45, d) * smoothstep(1.0, 0.55, y + (n - 0.5) * 0.35);
        float core = smoothstep(0.7, 0.0, d) * smoothstep(0.75, 0.1, y);
        vec3 col = mix(vec3(1.0, 0.32, 0.06), vec3(1.0, 0.72, 0.28), smoothstep(0.0, 0.8, body));
        col = mix(col, vec3(1.0, 0.95, 0.75), core);
        gl_FragColor = vec4(col * (body * 1.3 + core * 0.8) * (0.45 + 0.55 * uLevel), 1.0);
      }
    `,
  });

/**
 * A fire: a flickering flame on two crossed cards (so it has body from any
 * side), and a pool of light on the ground under it. `size` is the flame
 * height at full.
 */
export const Fire = ({
  level,
  size = 0.5,
  ground = 0,
  pool = 3,
  reducedMotion,
  seed = 0,
}: {
  level: FireLevel;
  size?: number;
  /** Height of the ground below the flame, relative to it (for the light pool) */
  ground?: number;
  pool?: number;
  reducedMotion?: boolean;
  seed?: number;
}) => {
  const flame = useRef<THREE.Group>(null);
  const mats = useMemo(() => ({ flame: flameMaterial(), glow: glowMaterial('#ff9a3c') }), []);
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime + seed * 7.3;
    const lv = Math.max(0, level.v);
    const f = reducedMotion ? 1 : 0.9 + 0.07 * Math.sin(t * 11) + 0.05 * Math.sin(t * 27 + 1);
    const g = flame.current;
    if (g) {
      const h = size * (0.4 + 0.6 * lv) * f;
      g.scale.set(h * 0.75, h, h * 0.75);
    }
    mats.flame.uniforms.uTime.value = reducedMotion ? seed : t;
    mats.flame.uniforms.uLevel.value = lv;
    mats.glow.uniforms.uIntensity.value = (0.18 + 0.55 * lv) * f;
  });

  return (
    <group>
      <group ref={flame}>
        {[0, Math.PI / 2].map((r) => (
          <mesh key={r} material={mats.flame} position={[0, 0.5, 0]} rotation={[0, r + seed, 0]} renderOrder={5} raycast={noRaycast}>
            <planeGeometry args={[1, 1]} />
          </mesh>
        ))}
      </group>
      <mesh material={mats.glow} position={[0, ground + 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2} raycast={noRaycast}>
        <planeGeometry args={[pool, pool]} />
      </mesh>
    </group>
  );
};

/** A canvas texture redrawn once the site's fonts have loaded. */
export const useCanvasTexture = (w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, deps: unknown[]) => {
  const tex = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }, [w, h]);
  useEffect(() => {
    const c = tex.image as HTMLCanvasElement;
    const g = c.getContext('2d');
    if (!g) return;
    let live = true;
    const paint = () => {
      if (!live) return;
      g.clearRect(0, 0, w, h);
      draw(g);
      tex.needsUpdate = true;
    };
    paint();
    void document.fonts?.ready.then(paint);
    return () => {
      live = false;
    };
  }, [tex, ...deps]);
  useEffect(() => () => tex.dispose(), [tex]);
  return tex;
};
