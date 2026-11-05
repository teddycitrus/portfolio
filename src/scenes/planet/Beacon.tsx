import { useEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { Architecture, Beacon as BeaconData, Planet, Vec3 } from '@/types/content';
import { useAppStore } from '@/state/useAppStore';
import { dragLook, mouseLook } from '@/state/runtime';
import { arrivalPulse } from './surfaceState';
import { openBeacon } from '@/ui/navigation';
import { mulberry, seedOf } from './rng';
import BeaconScreens from './BeaconScreens';

/* ---------- meaning: award tiers, project glyphs, skill counts ---------- */

interface AwardRank {
  /** 1 = winner / 1st place, 2 = placed, 3 = distinction */
  tier: 1 | 2 | 3;
  /** Category win (e.g. Future Impact) gets its own crown */
  category: boolean;
}

const awardRank = (b: BeaconData): AwardRank => {
  if (b.kind !== 'award') return { tier: 2, category: false };
  const r = b.content.result.toLowerCase();
  if (r.includes('distinction')) return { tier: 3, category: false };
  if (r.includes('future impact')) return { tier: 1, category: true };
  if (/winner|1st|first/.test(r)) return { tier: 1, category: false };
  return { tier: 2, category: false };
};

const AWARD_TIER: Record<1 | 2 | 3, { pillar: number; metal: string }> = {
  1: { pillar: 2.3, metal: '#dcb664' },
  2: { pillar: 2.0, metal: '#c8ccd4' },
  3: { pillar: 1.65, metal: '#b9865a' },
};

/* ---------- architecture: one style per planet, varied per monument ---------- */

interface Tier {
  y: number;
  h: number;
  w: number;
}

type Spec =
  | { theme: 'obelisk'; steps: number; H: number; bw: number; tw: number; capH: number; tilt: number; ticks: number }
  | { theme: 'deco'; tiers: Tier[]; depthK: number; spire: number; fins: number; T: number }
  | { theme: 'classical'; P: number; rc: number; flutes: number; ionic: boolean; capTop: number }
  | { theme: 'pagoda'; tiers: Tier[]; over: number; roofH: number; finial: number; top: number }
  | { theme: 'gothic'; S: number; sh: number; apex: number; pinH: number; rose: boolean };

type PillarSpec = Spec & { height: number; floatY: number; shade: number };

const BASE_Y = 0.1;

const buildSpec = (theme: Architecture, b: BeaconData): PillarSpec => {
  const rnd = mulberry(seedOf(b.id));
  const v = Array.from({ length: 8 }, rnd);
  const shade = (v[7] - 0.5) * 0.08;
  switch (theme) {
    case 'obelisk': {
      const steps = v[0] < 0.5 ? 2 : 1;
      const H = 2.3 + v[1] * 0.7;
      const bw = 0.25 + v[2] * 0.06;
      const capH = 0.24 + v[4] * 0.1;
      const top = steps * 0.12 + H + capH;
      return {
        theme, steps, H, bw, tw: bw * (0.58 + v[3] * 0.1), capH, tilt: (v[5] - 0.5) * 0.06,
        ticks: 3 + Math.floor(v[6] * 3), height: top + 0.42, floatY: top + 0.3, shade,
      };
    }
    case 'deco': {
      const n = v[0] < 0.4 ? 4 : 3;
      const T = 3.0 + v[1] * 0.5;
      const weights = [0.44, 0.3, 0.17, 0.09].slice(0, n);
      const sum = weights.reduce((a, x) => a + x, 0);
      const shrink = 0.72 + v[3] * 0.06;
      let y = 0;
      let w = 0.6 + v[2] * 0.1;
      const tiers = weights.map((k) => {
        const t = { y, h: (k / sum) * T, w };
        y += t.h;
        w *= shrink;
        return t;
      });
      const spire = 0.45 + v[5] * 0.35;
      return {
        theme, tiers, T, depthK: 0.82 + v[4] * 0.2, spire, fins: v[6] < 0.5 ? 2 : 4,
        height: T + spire + 0.5, floatY: T + spire + 0.3, shade,
      };
    }
    case 'classical': {
      const P = AWARD_TIER[awardRank(b).tier].pillar + (v[0] - 0.5) * 0.14;
      const capTop = 0.12 + P + 0.2;
      return {
        theme, P, rc: 0.19 + v[1] * 0.04, flutes: v[2] < 0.5 ? 12 : 16, ionic: v[3] < 0.5, capTop,
        height: capTop + 0.7, floatY: capTop + 0.42, shade,
      };
    }
    case 'pagoda': {
      const n = b.kind === 'skills' ? Math.max(3, Math.min(6, b.content.items.length)) : 4;
      const roofH = 0.13 + v[4] * 0.05;
      const shrink = 0.84 + v[2] * 0.05;
      let y = 0.14;
      let h = 0.34 + v[0] * 0.06;
      let w = 0.5 + v[1] * 0.08;
      const tiers: Tier[] = [];
      for (let i = 0; i < n; i += 1) {
        tiers.push({ y, h, w });
        y += h + roofH * 0.6;
        h *= 0.93;
        w *= shrink;
      }
      const finial = 0.32 + v[5] * 0.2;
      const top = y + finial;
      return {
        theme, tiers, over: 0.15 + v[3] * 0.07, roofH, finial, top, height: top + 0.38, floatY: top + 0.22, shade,
      };
    }
    case 'gothic': {
      const S = 0.95 + v[0] * 0.3 + 0.16;
      const sh = 1.45 + v[1] * 0.45;
      const apex = sh + S * Math.sin(Math.PI / 3);
      return {
        theme, S, sh, apex, pinH: 0.32 + v[2] * 0.18, rose: v[3] < 0.55, height: apex + 0.6, floatY: apex + 0.42, shade,
      };
    }
  }
};

/** Monument height for one beacon (labels and HUD anchors sit just above it). */
export const beaconHeight = (planet: Planet, b: BeaconData): number => buildSpec(planet.architecture, b).height;

/** The DOM label sits this far above the monument top (incl. its floating piece); beaconScreen anchors here. */
export const LABEL_ANCHOR = 0.12;

/* ---------- shared resources ---------- */

const poolMaterial = (color: THREE.Color) =>
  new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    uniforms: { uColor: { value: color }, uIntensity: { value: 0.5 } },
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

const SHIELD = (() => {
  const sh = new THREE.Shape();
  sh.moveTo(-0.15, 0.17);
  sh.lineTo(0.15, 0.17);
  sh.lineTo(0.15, 0.0);
  sh.quadraticCurveTo(0.14, -0.13, 0, -0.22);
  sh.quadraticCurveTo(-0.14, -0.13, -0.15, 0.0);
  sh.closePath();
  return sh;
})();

const damp = (cur: number, target: number, rate: number, dt: number) =>
  cur + (target - cur) * (1 - Math.exp(-rate * dt));

interface BeaconProps {
  beacon: BeaconData;
  planet: Planet;
  index: number;
  /** World position at ground level */
  position: Vec3;
  /** Strength of the moonlit/sky rim on the stone (0..1) */
  rim?: number;
  rimColor?: THREE.Color;
  reducedMotion?: boolean;
}

/** Adds a view-angle rim to a standard material so monuments never read as flat silhouettes. */
const addRim = (m: THREE.MeshStandardMaterial, color: THREE.Color, strength: number) => {
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

const SIN60 = Math.sin(Math.PI / 3);

const Beacon = ({ beacon, planet, index, position, rim = 0.2, rimColor, reducedMotion }: BeaconProps) => {
  const kind = beacon.kind;
  const spec = useMemo(() => buildSpec(planet.architecture, beacon), [planet.architecture, beacon]);
  const height = spec.height;
  const rank = useMemo(() => awardRank(beacon), [beacon]);
  const glyph = /iris/.test(beacon.id)
    ? 'eye'
    : /eureka/.test(beacon.id)
      ? 'globe'
      : /bastion/.test(beacon.id)
        ? 'prism'
        : /shield/.test(beacon.id)
          ? 'shield'
          : 'spark';
  // eye and shield glyphs face the walkway, so they sway instead of spinning
  const sway = glyph === 'eye' || glyph === 'shield';
  const floater = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const state = useRef({ focus: 0 });

  // face the spawn side so seams and faces read from the walkway
  const yaw = useMemo(() => Math.atan2(-position[0], 5 - position[2]), [position]);

  const mats = useMemo(() => {
    const accent = new THREE.Color(planet.accent);
    const gold = new THREE.Color(AWARD_TIER[rank.tier].metal).lerp(accent, rank.tier === 1 ? 0.15 : 0.05);
    const stoneColor = new THREE.Color('#bdb6ac').lerp(new THREE.Color(planet.palette[1]), 0.12);
    // award pillars take a warm cast from their metal so they read gold against dark rock
    if (kind === 'award') stoneColor.lerp(gold, 0.22);
    // skills pillars carry the ocean world's blue: tinted stone, blue metal caps, brighter seams
    if (kind === 'skills') stoneColor.lerp(accent, 0.28);
    // every monument is cut from a slightly different block
    stoneColor.offsetHSL(0, 0, spec.shade);
    const rc = rimColor ?? new THREE.Color(planet.accent);
    const stone = addRim(
      new THREE.MeshStandardMaterial({ color: stoneColor, roughness: 0.68, metalness: 0.02, flatShading: true }),
      rc,
      rim * 0.18,
    );
    const plinth = addRim(
      new THREE.MeshStandardMaterial({ color: stoneColor.clone().multiplyScalar(0.62), roughness: 0.9 }),
      rc,
      rim * 0.1,
    );
    const metal = new THREE.MeshStandardMaterial({
      color:
        kind === 'award'
          ? gold
          : kind === 'skills'
            ? stoneColor.clone().lerp(new THREE.Color(planet.color), 0.6)
            : stoneColor.clone().lerp(accent, 0.25),
      roughness: kind === 'award' ? 0.3 : 0.35,
      metalness: kind === 'award' ? 0.75 : kind === 'skills' ? 0.6 : 0.55,
      emissive: kind === 'award' ? gold.clone().multiplyScalar(0.12) : new THREE.Color(0),
    });
    const seamBase =
      kind === 'award' ? gold.clone().lerp(accent, 0.3) : accent.clone().multiplyScalar(kind === 'skills' ? 1.3 : 1);
    const seam = new THREE.MeshBasicMaterial({ color: seamBase.clone() });
    const pool = poolMaterial(kind === 'award' ? gold.clone() : accent.clone());
    const ringMat = new THREE.MeshBasicMaterial({
      color: seamBase.clone().multiplyScalar(1.4),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    return { stone, plinth, metal, seam, seamBase, pool, ringMat };
  }, [planet, kind, rim, rimColor, rank, spec.shade]);

  useEffect(
    () => () => {
      Object.values(mats).forEach((m) => m instanceof THREE.Material && m.dispose());
      document.body.style.cursor = '';
    },
    [mats],
  );

  useFrame(({ clock }, delta) => {
    const dt = Math.min(delta, 0.05);
    const s = state.current;
    const t = clock.elapsedTime;
    const focused = useAppStore.getState().focusedBeaconId === beacon.id;
    s.focus = damp(s.focus, focused ? 1 : 0, 4, dt);

    // one-off discovery pulse after arrival, beacon by beacon
    let pop = 0;
    let popK = 0;
    if (arrivalPulse.start > 0) {
      const lt = (performance.now() - arrivalPulse.start) / 1000 - index * 0.28;
      if (lt > 0 && lt < 1.4) {
        popK = lt / 1.4;
        pop = 1 - popK;
      }
    }
    const breathe = reducedMotion ? 0 : Math.sin(t * 1.1 + index * 1.7) * 0.5 + 0.5;
    const glow = 0.95 + breathe * 0.3 + s.focus * 1.5 + pop * 1.2;
    mats.seam.color.copy(mats.seamBase).multiplyScalar(glow);
    mats.pool.uniforms.uIntensity.value = 0.13 + breathe * 0.04 + s.focus * 0.3;

    if (floater.current && !reducedMotion) {
      floater.current.rotation.y = sway ? Math.sin(t * 0.4 + index) * 0.35 : t * 0.25 + index;
      floater.current.position.y = Math.sin(t * 0.7 + index) * 0.06;
    }

    // expanding ground ring while focused
    if (ring.current) {
      const phase = (t * 0.45 + index * 0.3) % 1;
      const k = reducedMotion ? 0.6 : phase;
      let ro = s.focus * (1 - k) * 0.4;
      let sc = 0.9 + k * 1.8;
      if (pop * 0.6 > ro) {
        ro = pop * 0.6;
        sc = 0.9 + popK * 2.1;
      }
      ring.current.scale.setScalar(sc);
      (ring.current.material as THREE.MeshBasicMaterial).opacity = ro;
      ring.current.visible = ro > 0.005;
    }
  });

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (dragLook.travel >= 6 || mouseLook.pressLocked) return;
    // same path as the HUD chips: glide + focus, without stealing keyboard focus
    openBeacon(beacon.id, false);
  };

  const seamStrip = (h: number, y: number, z: number, w = 0.028, tilt = 0, x = 0) => (
    <mesh material={mats.seam} position={[x, y, z]} rotation={[tilt, 0, 0]}>
      <boxGeometry args={[w, h, 0.012]} />
    </mesh>
  );

  /**
   * Seam on the front of a tapered prism centred at cy. k is the ratio between
   * face distance and radius (cos(pi/n) for a face, 1 for an edge).
   */
  const faceSeam = (rTop: number, rBot: number, H: number, cy: number, len: number, k: number, w = 0.026) => {
    const r = (rTop + rBot) / 2;
    return seamStrip(len, cy, r * k + 0.01, w, -Math.atan(((rBot - rTop) * k) / H));
  };

  /** Two arcs of radius R meeting in a point above two springers S apart (an equilateral arch when R = S). */
  const pointedArch = (S: number, R: number, tube: number, y: number, z: number, mat: THREE.Material) => {
    const th = Math.acos(S / (2 * R));
    return (
      <>
        <mesh material={mat} position={[-S / 2, y, z]} castShadow>
          <torusGeometry args={[R, tube, 6, 20, th]} />
        </mesh>
        <mesh material={mat} position={[S / 2, y, z]} rotation={[0, 0, Math.PI - th]} castShadow>
          <torusGeometry args={[R, tube, 6, 20, th]} />
        </mesh>
      </>
    );
  };

  /* ---------- floating piece: carries the meaning (glyph, crown, count) ---------- */
  let crown: JSX.Element;
  switch (kind) {
    case 'project':
      crown = (
        <>
          {glyph === 'eye' && (
            <>
              <mesh material={mats.metal} scale={[1.35, 0.8, 1]}>
                <torusGeometry args={[0.15, 0.016, 8, 48]} />
              </mesh>
              <mesh material={mats.seam}>
                <sphereGeometry args={[0.06, 16, 12]} />
              </mesh>
            </>
          )}
          {glyph === 'globe' && (
            <>
              <mesh material={mats.metal}>
                <sphereGeometry args={[0.11, 20, 14]} />
              </mesh>
              <mesh material={mats.seam} rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[0.15, 0.008, 6, 48]} />
              </mesh>
              <mesh material={mats.seam} rotation={[0, 0, 0.4]}>
                <torusGeometry args={[0.15, 0.006, 6, 48]} />
              </mesh>
            </>
          )}
          {glyph === 'prism' && (
            <>
              <mesh material={mats.metal}>
                <cylinderGeometry args={[0.13, 0.13, 0.3, 3]} />
              </mesh>
              <mesh material={mats.seam}>
                <cylinderGeometry args={[0.05, 0.05, 0.32, 3]} />
              </mesh>
            </>
          )}
          {glyph === 'shield' && (
            <>
              <mesh material={mats.metal} position={[0, 0, -0.02]}>
                <extrudeGeometry
                  args={[SHIELD, { depth: 0.04, bevelEnabled: true, bevelSize: 0.01, bevelThickness: 0.01, bevelSegments: 1 }]}
                />
              </mesh>
              <mesh material={mats.seam} position={[0, 0.01, 0.035]} scale={0.5}>
                <shapeGeometry args={[SHIELD]} />
              </mesh>
            </>
          )}
          {glyph === 'spark' && (
            <mesh material={mats.seam}>
              <octahedronGeometry args={[0.09, 0]} />
            </mesh>
          )}
        </>
      );
      break;
    case 'award':
      crown = (
        <>
          {rank.tier === 1 && !rank.category && (
            // winner: a level golden halo
            <group rotation={[1.3, 0, 0.1]}>
              <mesh material={mats.metal} castShadow>
                <torusGeometry args={[0.42, 0.018, 8, 72]} />
              </mesh>
              <mesh material={mats.seam} scale={0.8}>
                <torusGeometry args={[0.42, 0.006, 6, 96]} />
              </mesh>
            </group>
          )}
          {rank.category && (
            // category win: an armillary of two crossed rings around a star
            <>
              <mesh material={mats.metal} rotation={[0, 0, 0.5]}>
                <torusGeometry args={[0.32, 0.014, 8, 64]} />
              </mesh>
              <mesh material={mats.metal} rotation={[0, Math.PI / 2, -0.5]}>
                <torusGeometry args={[0.32, 0.014, 8, 64]} />
              </mesh>
              <mesh material={mats.seam} rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[0.32, 0.005, 6, 64]} />
              </mesh>
            </>
          )}
          {rank.tier === 2 && (
            <mesh material={mats.metal} rotation={[1.3, 0, 0.1]}>
              <torusGeometry args={[0.3, 0.014, 8, 64]} />
            </mesh>
          )}
          {rank.tier === 3 && (
            // distinction: a small upright medal
            <group position={[0, -0.05, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <mesh material={mats.metal}>
                <cylinderGeometry args={[0.16, 0.16, 0.03, 32]} />
              </mesh>
              <mesh material={mats.seam} position={[0, 0.017, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <ringGeometry args={[0.1, 0.12, 32]} />
              </mesh>
            </group>
          )}
          {rank.category ? (
            <mesh material={mats.seam}>
              <octahedronGeometry args={[0.075, 0]} />
            </mesh>
          ) : (
            rank.tier !== 3 && (
              <mesh material={mats.seam}>
                <sphereGeometry args={[0.055, 16, 12]} />
              </mesh>
            )
          )}
        </>
      );
      break;
    case 'skills':
      crown = (
        <mesh material={mats.seam} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.16, 0.012, 6, 48]} />
        </mesh>
      );
      break;
    case 'link':
      crown = (
        <mesh material={mats.seam}>
          <sphereGeometry args={[0.06, 14, 10]} />
        </mesh>
      );
      break;
    default:
      crown = (
        <mesh material={mats.seam}>
          <octahedronGeometry args={[0.06, 0]} />
        </mesh>
      );
  }

  /* ---------- the building itself ---------- */
  let body: JSX.Element;
  switch (spec.theme) {
    case 'obelisk': {
      // stepped base, tapering square shaft, gilded pyramidion, a column of glyph cuts near the top
      const { steps, H, bw, tw, capH, tilt, ticks } = spec;
      const y0 = steps * 0.12;
      const slope = Math.atan((bw - tw) / H);
      body = (
        <group rotation={[0, 0, tilt]}>
          {Array.from({ length: steps }, (_, i) => (
            <mesh key={i} material={mats.stone} position={[0, i * 0.12 + 0.06, 0]} castShadow receiveShadow>
              <boxGeometry args={[0.78 - i * 0.16, 0.12, 0.78 - i * 0.16]} />
            </mesh>
          ))}
          <mesh material={mats.stone} position={[0, y0 + H / 2, 0]} rotation={[0, Math.PI / 4, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[tw * Math.SQRT2, bw * Math.SQRT2, H, 4, 1]} />
          </mesh>
          <mesh material={mats.metal} position={[0, y0 + H + capH / 2, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
            <coneGeometry args={[tw * Math.SQRT2, capH, 4]} />
          </mesh>
          {faceSeam(tw * Math.SQRT2, bw * Math.SQRT2, H, y0 + H * 0.36, H * 0.5, Math.SQRT1_2, 0.02)}
          {Array.from({ length: ticks }, (_, i) => {
            const y = y0 + H * (0.68 + i * (0.24 / ticks));
            const half = bw + (tw - bw) * ((y - y0) / H);
            return (
              <mesh key={i} material={mats.seam} position={[0, y, half + 0.008]} rotation={[-slope, 0, 0]}>
                <boxGeometry args={[half * (i % 2 ? 0.7 : 1.1), 0.018, 0.012]} />
              </mesh>
            );
          })}
        </group>
      );
      break;
    }
    case 'deco': {
      // stacked setbacks with metal ledges, front fins on the base tier and a needle spire
      const { tiers, depthK, spire, fins, T } = spec;
      body = (
        <group>
          {tiers.map((t, i) => {
            const d = t.w * depthK;
            return (
              <group key={i}>
                <mesh material={mats.stone} position={[0, t.y + t.h / 2, 0]} castShadow receiveShadow>
                  <boxGeometry args={[t.w, t.h, d]} />
                </mesh>
                <mesh material={mats.metal} position={[0, t.y + t.h - 0.02, 0]} castShadow>
                  <boxGeometry args={[t.w * 1.08, 0.04, d * 1.08]} />
                </mesh>
                {seamStrip(t.h * 0.72, t.y + t.h * 0.48, d / 2 + 0.008, i === 0 ? 0.03 : 0.022)}
                {i === 0 &&
                  Array.from({ length: fins }, (_, f) => {
                    const x = ((f + 0.5) / fins - 0.5) * t.w * 0.8;
                    return Math.abs(x) < 0.05 ? null : (
                      <mesh key={f} material={mats.metal} position={[x, t.y + t.h * 0.46, d / 2 + 0.035]} castShadow>
                        <boxGeometry args={[0.035, t.h * 0.86, 0.07]} />
                      </mesh>
                    );
                  })}
              </group>
            );
          })}
          <mesh material={mats.metal} position={[0, T + spire / 2, 0]} castShadow>
            <coneGeometry args={[0.055, spire, 6]} />
          </mesh>
        </group>
      );
      break;
    }
    case 'classical': {
      // fluted column with entasis on a square base; Doric or Ionic capital
      const { P, rc, flutes, ionic, capTop } = spec;
      const y0 = 0.12;
      const rTop = rc * 0.86;
      body = (
        <group>
          <mesh material={mats.stone} position={[0, 0.06, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.62, 0.12, 0.62]} />
          </mesh>
          <mesh material={mats.stone} position={[0, y0 + 0.03, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <torusGeometry args={[rc + 0.025, 0.035, 6, flutes]} />
          </mesh>
          <mesh material={mats.stone} position={[0, y0 + P / 2, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[rTop, rc, P, flutes]} />
          </mesh>
          <mesh material={mats.stone} position={[0, y0 + P + 0.05, 0]} castShadow>
            <cylinderGeometry args={[rTop * 1.45, rTop * 1.05, 0.1, flutes]} />
          </mesh>
          <mesh material={mats.metal} position={[0, capTop - 0.05, 0]} castShadow>
            <boxGeometry args={[rTop * 3.1, 0.1, rTop * 3.1]} />
          </mesh>
          {ionic &&
            [-1, 1].map((sx) => (
              <mesh key={sx} material={mats.metal} position={[sx * rTop * 1.5, capTop - 0.16, rTop * 0.6]}>
                <torusGeometry args={[0.06, 0.02, 6, 20]} />
              </mesh>
            ))}
          {faceSeam(rTop, rc, P, y0 + P / 2, P * 0.82, Math.cos(Math.PI / flutes), 0.022)}
        </group>
      );
      break;
    }
    case 'pagoda': {
      // one storey per skill: shrinking bodies under wide flared roofs, a lit window on each
      const { tiers, over, roofH, finial, top } = spec;
      const last = tiers[tiers.length - 1];
      const roofTop = last.y + last.h + roofH;
      body = (
        <group>
          <mesh material={mats.stone} position={[0, 0.07, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.92, 0.14, 0.92]} />
          </mesh>
          {tiers.map((t, i) => (
            <group key={i}>
              <mesh material={mats.stone} position={[0, t.y + t.h / 2, 0]} castShadow receiveShadow>
                <boxGeometry args={[t.w, t.h, t.w]} />
              </mesh>
              <mesh
                material={mats.metal}
                position={[0, t.y + t.h + roofH / 2 - 0.02, 0]}
                rotation={[0, Math.PI / 4, 0]}
                castShadow
              >
                <coneGeometry args={[(t.w / 2 + over * (1 - i * 0.06)) * Math.SQRT2, roofH, 4]} />
              </mesh>
              <mesh material={mats.seam} position={[0, t.y + t.h * 0.48, t.w / 2 + 0.006]}>
                <boxGeometry args={[t.w * 0.28, t.h * 0.42, 0.012]} />
              </mesh>
            </group>
          ))}
          <mesh material={mats.metal} position={[0, (roofTop + top) / 2, 0]}>
            <cylinderGeometry args={[0.018, 0.03, top - roofTop, 6]} />
          </mesh>
          {[0.35, 0.6].map((k) => (
            <mesh key={k} material={mats.metal} position={[0, roofTop + finial * k, 0]}>
              <sphereGeometry args={[0.045 - k * 0.03, 10, 8]} />
            </mesh>
          ))}
        </group>
      );
      break;
    }
    case 'gothic': {
      // pointed-arch gateway: twin piers with pinnacles, ribbed arch, optional rose ring
      const { S, sh, apex, pinH, rose } = spec;
      body = (
        <group>
          {[-1, 1].map((sx) => (
            <group key={sx} position={[(sx * S) / 2, 0, 0]}>
              <mesh material={mats.stone} position={[0, sh / 2, 0]} castShadow receiveShadow>
                <boxGeometry args={[0.16, sh, 0.22]} />
              </mesh>
              <mesh material={mats.metal} position={[0, sh + 0.04, 0]} castShadow>
                <boxGeometry args={[0.22, 0.06, 0.28]} />
              </mesh>
              <mesh material={mats.metal} position={[0, sh + 0.07 + pinH / 2, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
                <coneGeometry args={[0.08, pinH, 4]} />
              </mesh>
              {seamStrip(sh * 0.6, sh * 0.42, 0.116, 0.018)}
            </group>
          ))}
          {pointedArch(S, S, 0.07, sh, 0, mats.stone)}
          {pointedArch(S, S - 0.075, 0.012, sh, 0.06, mats.seam)}
          <mesh material={mats.metal} position={[0, apex + 0.12, 0]} castShadow>
            <coneGeometry args={[0.05, 0.26, 4]} />
          </mesh>
          {rose && (
            <mesh material={mats.seam} position={[0, sh + S * SIN60 * 0.42, 0.04]}>
              <torusGeometry args={[S * 0.13, 0.01, 6, 40]} />
            </mesh>
          )}
          <mesh material={mats.seam} position={[0, 1.05, 0]}>
            <octahedronGeometry args={[0.06, 0]} />
          </mesh>
        </group>
      );
      break;
    }
  }

  return (
    <group position={position}>
      <group rotation={[0, yaw, 0]}>
        {/* plinth */}
        <mesh material={mats.plinth} position={[0, 0.04, 0]} receiveShadow castShadow>
          <cylinderGeometry args={[0.85, 0.95, 0.14, 8]} />
        </mesh>
        <group position={[0, BASE_Y, 0]}>
          {body}
          <group ref={floater}>
            <group position={[0, spec.floatY - BASE_Y, 0]}>{crown}</group>
          </group>
        </group>
      </group>

      {/* soft light pool and focus ring */}
      <mesh material={mats.pool} position={[0, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
        <planeGeometry args={[6, 6]} />
      </mesh>
      <mesh ref={ring} material={mats.ringMat} position={[0, 0.08, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={3}>
        <ringGeometry args={[1.0, 1.035, 96]} />
      </mesh>

      <BeaconScreens beacon={beacon} planet={planet} height={height} index={index} reducedMotion={reducedMotion} />

      {/* generous invisible hit volume */}
      <mesh
        position={[0, height / 2, 0]}
        visible={false}
        onClick={onClick}
        onPointerOver={(e) => {
          e.stopPropagation();
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          document.body.style.cursor = '';
        }}
      >
        <cylinderGeometry args={[1.3, 1.3, height + 1.4, 12]} />
      </mesh>
    </group>
  );
};

export default Beacon;
