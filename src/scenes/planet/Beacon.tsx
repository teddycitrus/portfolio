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
import { getBeaconFacing } from '@/data/content';
import { addRim } from './sites/common';
import { STATUE_HEIGHT, TempleStatue } from './sites/Temple';
import { CAMP_HEIGHT, Camp } from './sites/Camp';

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
  | { theme: 'gothic'; S: number; sh: number; apex: number; pinH: number; rose: boolean }
  /* the built sites draw their own monuments (sites/) */
  | { theme: 'temple' }
  | { theme: 'outpost' };

type PillarSpec = Spec & {
  /** Which of the theme's designs this monument uses; neighbours never share one */
  form: number;
  height: number;
  floatY: number;
  shade: number;
};

/** Distinct designs per architecture. A planet's monuments take them in order, so each one differs. */
const FORMS: Record<Architecture, number> = { obelisk: 4, deco: 4, classical: 4, pagoda: 4, gothic: 5, temple: 1, outpost: 1 };

const SIN60 = Math.sin(Math.PI / 3);
const BASE_Y = 0.1;

const buildSpec = (theme: Architecture, b: BeaconData, index: number): PillarSpec => {
  const rnd = mulberry(seedOf(b.id));
  const v = Array.from({ length: 8 }, rnd);
  const shade = (v[7] - 0.5) * 0.08;
  const form = index % FORMS[theme];
  const done = (top: number, lift = 0.3, pad = 0.42) => ({ height: top + pad, floatY: top + lift, shade, form });
  switch (theme) {
    case 'temple':
      return { theme, height: STATUE_HEIGHT + 0.1, floatY: STATUE_HEIGHT, shade, form };
    case 'outpost':
      return { theme, height: CAMP_HEIGHT, floatY: CAMP_HEIGHT, shade, form };
    case 'obelisk': {
      const steps = v[0] < 0.5 ? 2 : 1;
      const H = 2.3 + v[1] * 0.7;
      const bw = 0.25 + v[2] * 0.06;
      const capH = 0.24 + v[4] * 0.1;
      const y0 = steps * 0.12;
      // pylons are squat; floating segments add their gaps
      const top = form === 1 ? y0 + H * 0.72 + 0.04 : form === 2 ? y0 + H * 1.1 + capH : y0 + H + capH;
      return {
        theme, steps, H, bw, tw: bw * (0.58 + v[3] * 0.1), capH, tilt: form === 0 ? (v[5] - 0.5) * 0.06 : 0,
        ticks: 3 + Math.floor(v[6] * 3), ...done(top),
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
      const top = form === 3 ? T * 0.8 + 0.42 + 0.22 : T + spire;
      return { theme, tiers, T, depthK: 0.82 + v[4] * 0.2, spire, fins: v[6] < 0.5 ? 2 : 4, ...done(top, 0.3, 0.5) };
    }
    case 'classical': {
      const P = AWARD_TIER[awardRank(b).tier].pillar + (v[0] - 0.5) * 0.14;
      const capTop = 0.12 + P + 0.2;
      const top =
        form === 1 ? P + 0.39 : form === 2 ? 0.12 + P * 0.78 + 0.55 : form === 3 ? 0.12 + 0.55 + P * 0.72 + 0.2 : capTop;
      return {
        theme, P, rc: 0.19 + v[1] * 0.04, flutes: v[2] < 0.5 ? 12 : 16, ionic: v[3] < 0.5, capTop, ...done(top, 0.42, 0.7),
      };
    }
    case 'pagoda': {
      const n = b.kind === 'skills' ? Math.max(3, Math.min(6, b.content.items.length)) : 4;
      // square, octagonal with steep roofs, round with flat eaves, twisted hexagon with broad flares
      const roofH = (0.13 + v[4] * 0.05) * [1, 1.9, 0.5, 1.25][form];
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
      return { theme, tiers, over: (0.15 + v[3] * 0.07) * [1, 0.7, 1.35, 1.2][form], roofH, finial, top, ...done(top, 0.22, 0.38) };
    }
    case 'gothic': {
      const S = 0.95 + v[0] * 0.3 + 0.16;
      const sh = 1.45 + v[1] * 0.45;
      const pinH = 0.32 + v[2] * 0.18;
      const R = S * 0.42;
      const apex =
        form === 2
          ? sh + 0.36 + S * 0.9 + 0.3
          : form === 3
            ? sh * 0.8 + R * 0.35 + R + 0.2
            : form === 4
              ? sh + S * 0.5 + pinH * 1.6
              : sh + (form === 1 ? S * 0.8 : S) * SIN60;
      return { theme, S, sh, apex, pinH, rose: v[3] < 0.55, ...done(apex, 0.42, 0.6) };
    }
  }
};

/** Monument height for one beacon (labels and HUD anchors sit just above it). */
export const beaconHeight = (planet: Planet, b: BeaconData): number =>
  buildSpec(planet.architecture, b, Math.max(0, planet.beacons.findIndex((x) => x.id === b.id))).height;

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

const Beacon = ({ beacon, planet, index, position, rim = 0.2, rimColor, reducedMotion }: BeaconProps) => {
  const kind = beacon.kind;
  const spec = useMemo(() => buildSpec(planet.architecture, beacon, index), [planet.architecture, beacon, index]);
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

  // face the spawn side (or the temple aisle) so faces read from the walkway
  const yaw = useMemo(() => {
    const [fx, fz] = getBeaconFacing(planet, position);
    return Math.atan2(fx - position[0], fz - position[2]);
  }, [planet, position]);
  const built = spec.theme === 'temple' || spec.theme === 'outpost';
  /** Reach of the focus ring and the hit volume: the camp is wider than a monument */
  const reach = spec.theme === 'outpost' ? 1.5 : 1;
  /** The outpost's beacons all sit at the camp: the first draws it and carries every one's screens */
  const camp = spec.theme === 'outpost';
  const groupIds = useMemo(() => planet.beacons.map((b) => b.id), [planet]);

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
    default: {
      // a different small token on each monument
      const k = index % 5;
      crown = (
        <>
          {kind === 'skills' && (
            <mesh material={mats.seam} rotation={[Math.PI / 2 + k * 0.3, 0, 0]}>
              <torusGeometry args={[0.16, 0.012, 6, 48]} />
            </mesh>
          )}
          <mesh material={kind === 'skills' && k % 2 ? mats.metal : mats.seam}>
            {k === 0 && <sphereGeometry args={[0.06, 14, 10]} />}
            {k === 1 && <octahedronGeometry args={[0.07, 0]} />}
            {k === 2 && <tetrahedronGeometry args={[0.08, 0]} />}
            {k === 3 && <icosahedronGeometry args={[0.065, 0]} />}
            {k === 4 && <torusKnotGeometry args={[0.05, 0.014, 48, 6]} />}
          </mesh>
        </>
      );
    }
  }

  /* ---------- the building itself: one theme per planet, a different design per monument ---------- */
  const S2 = Math.SQRT2;
  const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
  let body: JSX.Element = <></>;
  switch (spec.theme) {
    case 'temple':
    case 'outpost':
      break;
    case 'obelisk': {
      const { steps, H, bw, tw, capH, tilt, ticks, form } = spec;
      const y0 = steps * 0.12;
      const slope = Math.atan((bw - tw) / H);
      const base = Array.from({ length: steps }, (_, i) => (
        <mesh key={`s${i}`} material={mats.stone} position={[0, i * 0.12 + 0.06, 0]} castShadow receiveShadow>
          <boxGeometry args={[(form === 1 ? 1.1 : 0.78) - i * 0.16, 0.12, 0.78 - i * 0.16]} />
        </mesh>
      ));
      if (form === 1) {
        // temple pylons: two battered towers either side of a gate, a lit disc on the lintel
        const PH = H * 0.72;
        const pr = bw * 1.35;
        const gap = 0.16;
        body = (
          <group>
            {base}
            {[-1, 1].map((sx) => (
              <group key={sx} position={[sx * (gap / 2 + pr * 0.62), 0, 0]}>
                <mesh material={mats.stone} position={[0, y0 + PH / 2, 0]} rotation={[0, Math.PI / 4, 0]} castShadow receiveShadow>
                  <cylinderGeometry args={[pr * 0.62 * S2 * 0.72, pr * 0.62 * S2, PH, 4, 1]} />
                </mesh>
                <mesh material={mats.metal} position={[0, y0 + PH + 0.02, 0]} castShadow>
                  <boxGeometry args={[pr * 1.0, 0.05, pr * 1.0]} />
                </mesh>
                {seamStrip(PH * 0.55, y0 + PH * 0.42, pr * 0.62 * 0.86 + 0.02, 0.018, -0.06)}
              </group>
            ))}
            <mesh material={mats.metal} position={[0, y0 + PH * 0.86, 0]} castShadow>
              <boxGeometry args={[gap + 0.12, 0.07, 0.2]} />
            </mesh>
            <mesh material={mats.seam} position={[0, y0 + PH * 0.86 + 0.1, 0.02]}>
              <circleGeometry args={[0.07, 20]} />
            </mesh>
          </group>
        );
      } else if (form === 2) {
        // the shaft cut into blocks that hang apart, light leaking from the gaps
        const n = 4;
        const seg = H / n;
        const gap = (H * 0.1) / n;
        body = (
          <group>
            {base}
            {Array.from({ length: n }, (_, i) => {
              const yb = y0 + i * (seg + gap);
              const rB = lerp(bw, tw, i / n);
              const rT = lerp(bw, tw, (i + 1) / n);
              return (
                <group key={i}>
                  <mesh material={mats.stone} position={[0, yb + seg / 2, 0]} rotation={[0, Math.PI / 4, 0]} castShadow receiveShadow>
                    <cylinderGeometry args={[rT * S2, rB * S2, seg, 4, 1]} />
                  </mesh>
                  <mesh material={mats.seam} position={[0, yb + seg + gap / 2, 0]}>
                    <boxGeometry args={[rT * 1.2, 0.012, rT * 1.2]} />
                  </mesh>
                </group>
              );
            })}
            <mesh material={mats.metal} position={[0, y0 + n * (seg + gap) + capH / 2, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
              <coneGeometry args={[tw * S2, capH, 4]} />
            </mesh>
          </group>
        );
      } else if (form === 3) {
        // three-sided needle wrapped in lit bands
        body = (
          <group>
            {base}
            <mesh material={mats.stone} position={[0, y0 + H / 2, 0]} castShadow receiveShadow>
              <cylinderGeometry args={[tw * 1.3, bw * 1.3, H, 3, 1]} />
            </mesh>
            {[0.28, 0.5, 0.72].map((k) => {
              const r = lerp(bw, tw, k) * 1.3;
              return (
                <mesh key={k} material={k === 0.5 ? mats.metal : mats.seam} position={[0, y0 + H * k, 0]}>
                  <cylinderGeometry args={[r * 1.04, r * 1.05, k === 0.5 ? 0.06 : 0.022, 3]} />
                </mesh>
              );
            })}
            <mesh material={mats.metal} position={[0, y0 + H + capH / 2, 0]} castShadow>
              <coneGeometry args={[tw * 1.3, capH, 3]} />
            </mesh>
          </group>
        );
      } else {
        // stepped base, tapering square shaft, gilded pyramidion, a column of glyph cuts near the top
        body = (
          <group rotation={[0, 0, tilt]}>
            {base}
            <mesh material={mats.stone} position={[0, y0 + H / 2, 0]} rotation={[0, Math.PI / 4, 0]} castShadow receiveShadow>
              <cylinderGeometry args={[tw * S2, bw * S2, H, 4, 1]} />
            </mesh>
            <mesh material={mats.metal} position={[0, y0 + H + capH / 2, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
              <coneGeometry args={[tw * S2, capH, 4]} />
            </mesh>
            {faceSeam(tw * S2, bw * S2, H, y0 + H * 0.36, H * 0.5, Math.SQRT1_2, 0.02)}
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
      }
      break;
    }
    case 'deco': {
      const { tiers, depthK, spire, fins, T, form } = spec;
      if (form === 1) {
        // streamline: stacked drums with chrome bands and a radio mast
        body = (
          <group>
            {tiers.map((t, i) => (
              <group key={i}>
                <mesh material={mats.stone} position={[0, t.y + t.h / 2, 0]} castShadow receiveShadow>
                  <cylinderGeometry args={[(t.w / 2) * 0.94, t.w / 2, t.h, 24]} />
                </mesh>
                <mesh material={mats.metal} position={[0, t.y + t.h, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
                  <torusGeometry args={[t.w / 2 + 0.01, 0.022, 6, 32]} />
                </mesh>
                {i === 0 &&
                  [0.3, 0.42, 0.54].map((k) => (
                    <mesh key={k} material={mats.seam} position={[0, t.y + t.h * k, 0]} rotation={[Math.PI / 2, 0, 0]}>
                      <torusGeometry args={[(t.w / 2) * (1 - k * 0.06) + 0.004, 0.006, 4, 40]} />
                    </mesh>
                  ))}
                {seamStrip(t.h * 0.6, t.y + t.h * 0.5, (t.w / 2) * 0.97 + 0.01, 0.02)}
              </group>
            ))}
            <mesh material={mats.metal} position={[0, T + spire / 2, 0]} castShadow>
              <cylinderGeometry args={[0.012, 0.03, spire, 6]} />
            </mesh>
            {[0.4, 0.75].map((k) => (
              <mesh key={k} material={mats.seam} position={[0, T + spire * k, 0]}>
                <sphereGeometry args={[0.035 - k * 0.012, 10, 8]} />
              </mesh>
            ))}
          </group>
        );
      } else if (form === 2) {
        // twin slabs joined by a skybridge; the spire rises from the taller one
        const w = tiers[0].w * 0.42;
        const d = w * 1.15;
        const towers = [
          { x: -(w / 2 + 0.07), h: T },
          { x: w / 2 + 0.07, h: T * 0.78 },
        ];
        body = (
          <group>
            {towers.map((tw, i) => (
              <group key={i} position={[tw.x, 0, 0]}>
                <mesh material={mats.stone} position={[0, (tw.h - 0.3) / 2, 0]} castShadow receiveShadow>
                  <boxGeometry args={[w, tw.h - 0.3, d]} />
                </mesh>
                <mesh material={mats.stone} position={[0, tw.h - 0.15, 0]} castShadow>
                  <boxGeometry args={[w * 0.66, 0.3, d * 0.66]} />
                </mesh>
                <mesh material={mats.metal} position={[0, tw.h - 0.3, 0]}>
                  <boxGeometry args={[w * 1.06, 0.04, d * 1.06]} />
                </mesh>
                {seamStrip((tw.h - 0.3) * 0.7, (tw.h - 0.3) * 0.5, d / 2 + 0.008, 0.02)}
              </group>
            ))}
            <mesh material={mats.metal} position={[0, T * 0.55, 0]} castShadow>
              <boxGeometry args={[0.16, 0.12, d * 0.6]} />
            </mesh>
            {seamStrip(0.025, T * 0.55, d * 0.3 + 0.008, 0.14)}
            <mesh material={mats.metal} position={[towers[0].x, T + spire / 2, 0]} castShadow>
              <coneGeometry args={[0.045, spire, 6]} />
            </mesh>
          </group>
        );
      } else if (form === 3) {
        // a single slab under a sunburst crown of nested arches
        const H = T * 0.8;
        const R = 0.42;
        const d = 0.5 * depthK;
        body = (
          <group>
            <mesh material={mats.stone} position={[0, H / 2, 0]} castShadow receiveShadow>
              <boxGeometry args={[0.56, H, d]} />
            </mesh>
            <mesh material={mats.metal} position={[0, H, 0]} castShadow>
              <boxGeometry args={[0.62, 0.05, d * 1.08]} />
            </mesh>
            {[-0.16, 0, 0.16].map((x) => (
              <group key={x}>{seamStrip(H * (x === 0 ? 0.78 : 0.6), H * 0.48, d / 2 + 0.008, 0.018, 0, x)}</group>
            ))}
            {[R, R * 0.72, R * 0.44].map((r, i) => (
              <mesh key={r} material={i === 1 ? mats.seam : mats.metal} position={[0, H + 0.02, 0]} castShadow={i !== 1}>
                <torusGeometry args={[r, i === 1 ? 0.01 : 0.024, 6, 32, Math.PI]} />
              </mesh>
            ))}
            {[-0.6, -0.3, 0, 0.3, 0.6].map((a) => (
              <mesh
                key={a}
                material={mats.seam}
                position={[Math.sin(a) * R * 0.58, H + 0.02 + Math.cos(a) * R * 0.58, 0]}
                rotation={[0, 0, -a]}
              >
                <boxGeometry args={[0.012, R * 0.5, 0.012]} />
              </mesh>
            ))}
            <mesh material={mats.metal} position={[0, H + R + 0.11, 0]} castShadow>
              <coneGeometry args={[0.035, 0.22, 6]} />
            </mesh>
          </group>
        );
      } else {
        // stacked setbacks with metal ledges, front fins on the base tier and a needle spire
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
      }
      break;
    }
    case 'classical': {
      const { P, rc, flutes, ionic, capTop, form } = spec;
      const y0 = 0.12;
      /** Base ring, fluted shaft with entasis, echinus. */
      const column = (x: number, z: number, r: number, h: number, yb: number, key: string | number, seam = true) => {
        const rt = r * 0.86;
        return (
          <group key={key} position={[x, 0, z]}>
            <mesh material={mats.stone} position={[0, yb + 0.03, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <torusGeometry args={[r + 0.02, 0.03, 6, flutes]} />
            </mesh>
            <mesh material={mats.stone} position={[0, yb + h / 2, 0]} castShadow receiveShadow>
              <cylinderGeometry args={[rt, r, h, flutes]} />
            </mesh>
            <mesh material={mats.stone} position={[0, yb + h + 0.05, 0]} castShadow>
              <cylinderGeometry args={[rt * 1.45, rt * 1.05, 0.1, flutes]} />
            </mesh>
            {seam && faceSeam(rt, r, h, yb + h / 2, h * 0.8, Math.cos(Math.PI / flutes), 0.018)}
          </group>
        );
      };
      if (form === 1) {
        // a pair of columns carrying a gilded beam
        const r = rc * 0.74;
        const beamY = y0 + P + 0.1 + 0.06;
        body = (
          <group>
            <mesh material={mats.stone} position={[0, 0.06, 0]} castShadow receiveShadow>
              <boxGeometry args={[1.0, 0.12, 0.5]} />
            </mesh>
            {[-0.3, 0.3].map((x) => column(x, 0, r, P, y0, x))}
            <mesh material={mats.metal} position={[0, beamY + 0.06, 0]} castShadow>
              <boxGeometry args={[0.98, 0.12, 0.34]} />
            </mesh>
            {seamStrip(0.02, beamY + 0.06, 0.176, 0.7)}
          </group>
        );
      } else if (form === 2) {
        // tholos: a ring of slim columns under a low dome, a flame at its heart
        const h = P * 0.78;
        const r = rc * 0.42;
        const top = y0 + h + 0.25;
        body = (
          <group>
            <mesh material={mats.stone} position={[0, 0.06, 0]} castShadow receiveShadow>
              <cylinderGeometry args={[0.6, 0.64, 0.12, 24]} />
            </mesh>
            {Array.from({ length: 6 }, (_, k) => {
              const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
              return column(Math.sin(a) * 0.42, Math.cos(a) * 0.42, r, h, y0, k, false);
            })}
            <mesh material={mats.metal} position={[0, y0 + h + 0.15, 0]} castShadow>
              <cylinderGeometry args={[0.54, 0.54, 0.1, 24]} />
            </mesh>
            <mesh material={mats.seam} position={[0, y0 + h + 0.15, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.545, 0.008, 4, 48]} />
            </mesh>
            <mesh material={mats.stone} position={[0, top, 0]} scale={[1, 0.55, 1]} castShadow>
              <sphereGeometry args={[0.5, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
            </mesh>
            <mesh material={mats.seam} position={[0, y0 + h * 0.45, 0]}>
              <octahedronGeometry args={[0.08, 0]} />
            </mesh>
          </group>
        );
      } else if (form === 3) {
        // victory column: a carved pedestal, a banded shaft, a broad capital
        const pedH = 0.55;
        const yb = y0 + pedH;
        const h = P * 0.72;
        const r = rc * 0.85;
        body = (
          <group>
            <mesh material={mats.stone} position={[0, y0 + pedH / 2, 0]} castShadow receiveShadow>
              <boxGeometry args={[0.56, pedH, 0.56]} />
            </mesh>
            <mesh material={mats.metal} position={[0, yb, 0]} castShadow>
              <boxGeometry args={[0.62, 0.05, 0.62]} />
            </mesh>
            <mesh material={mats.seam} position={[0, y0 + pedH / 2, 0.285]}>
              <boxGeometry args={[0.28, 0.26, 0.006]} />
            </mesh>
            {column(0, 0, r, h, yb + 0.02, 'c', false)}
            {[0.2, 0.38, 0.56, 0.74].map((k) => (
              <mesh key={k} material={mats.seam} position={[0, yb + h * k, 0]} rotation={[Math.PI / 2 + 0.22, 0, 0]}>
                <torusGeometry args={[r * (1 - k * 0.14) + 0.006, 0.006, 4, 32]} />
              </mesh>
            ))}
            <mesh material={mats.metal} position={[0, yb + h + 0.16, 0]} castShadow>
              <boxGeometry args={[r * 2.7, 0.08, r * 2.7]} />
            </mesh>
          </group>
        );
      } else {
        // fluted column with entasis on a square base; Doric or Ionic capital
        const rTop = rc * 0.86;
        body = (
          <group>
            <mesh material={mats.stone} position={[0, 0.06, 0]} castShadow receiveShadow>
              <boxGeometry args={[0.62, 0.12, 0.62]} />
            </mesh>
            {column(0, 0, rc, P, y0, 'c')}
            <mesh material={mats.metal} position={[0, capTop - 0.05, 0]} castShadow>
              <boxGeometry args={[rTop * 3.1, 0.1, rTop * 3.1]} />
            </mesh>
            {ionic &&
              [-1, 1].map((sx) => (
                <mesh key={sx} material={mats.metal} position={[sx * rTop * 1.5, capTop - 0.16, rTop * 0.6]}>
                  <torusGeometry args={[0.06, 0.02, 6, 20]} />
                </mesh>
              ))}
          </group>
        );
      }
      break;
    }
    case 'pagoda': {
      // one storey per skill; the plan shape and eaves change per monument
      const { tiers, over, roofH, finial, top, form } = spec;
      const sides = [4, 8, 20, 6][form];
      const twist = form === 3 ? 0.4 : 0;
      const round = form === 2;
      const face = Math.cos(Math.PI / sides);
      const last = tiers[tiers.length - 1];
      const roofTop = last.y + last.h + roofH;
      // cylinders put a vertex at +z; turn them so a flat face looks at the walkway
      const align = Math.PI / sides;
      body = (
        <group>
          <mesh material={mats.stone} position={[0, 0.07, 0]} rotation={[0, align, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.5 / face, 0.52 / face, 0.14, sides]} />
          </mesh>
          {tiers.map((t, i) => {
            const R = t.w / 2 + over * (1 - i * 0.06);
            return (
              <group key={i} rotation={[0, i * twist, 0]}>
                <mesh material={mats.stone} position={[0, t.y + t.h / 2, 0]} rotation={[0, align, 0]} castShadow receiveShadow>
                  <cylinderGeometry args={[t.w / 2 / face, t.w / 2 / face, t.h, sides]} />
                </mesh>
                {round ? (
                  <>
                    <mesh material={mats.metal} position={[0, t.y + t.h + 0.015, 0]} castShadow>
                      <cylinderGeometry args={[R * 0.55, R, 0.05, sides]} />
                    </mesh>
                    <mesh material={mats.metal} position={[0, t.y + t.h + 0.04, 0]} rotation={[Math.PI / 2, 0, 0]}>
                      <torusGeometry args={[R, 0.02, 5, 32]} />
                    </mesh>
                  </>
                ) : (
                  <mesh
                    material={mats.metal}
                    position={[0, t.y + t.h + roofH / 2 - 0.02, 0]}
                    rotation={[0, align, 0]}
                    castShadow
                  >
                    <coneGeometry args={[R / face, roofH, sides]} />
                  </mesh>
                )}
                <mesh material={mats.seam} position={[0, t.y + t.h * 0.48, t.w / 2 + 0.006]}>
                  <boxGeometry args={[t.w * (round ? 0.2 : 0.28), t.h * 0.42, 0.012]} />
                </mesh>
              </group>
            );
          })}
          <mesh material={mats.metal} position={[0, (roofTop + top) / 2, 0]}>
            <cylinderGeometry args={[0.018, 0.03, top - roofTop, 6]} />
          </mesh>
          {(form === 1 ? [0.25, 0.45, 0.65] : [0.35, 0.6]).map((k) => (
            <mesh key={k} material={mats.metal} position={[0, roofTop + finial * k, 0]}>
              <sphereGeometry args={[0.045 - k * 0.03, 10, 8]} />
            </mesh>
          ))}
        </group>
      );
      break;
    }
    case 'gothic': {
      const { S, sh, apex, pinH, rose, form } = spec;
      const pier = (x: number, h: number, key: string | number, w = 0.16) => (
        <group key={key} position={[x, 0, 0]}>
          <mesh material={mats.stone} position={[0, h / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, h, 0.22]} />
          </mesh>
          <mesh material={mats.metal} position={[0, h + 0.04, 0]} castShadow>
            <boxGeometry args={[w + 0.06, 0.06, 0.28]} />
          </mesh>
          <mesh material={mats.metal} position={[0, h + 0.07 + pinH / 2, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
            <coneGeometry args={[0.08, pinH, 4]} />
          </mesh>
          {seamStrip(h * 0.6, h * 0.42, 0.116, 0.018)}
        </group>
      );
      if (form === 1) {
        // triple lancet: a tall centre arch flanked by two lower ones
        const C = S * 0.8;
        const W = C * 0.45;
        const lo = sh * 0.72;
        body = (
          <group>
            {pier(-C / 2, sh, 'a')}
            {pier(C / 2, sh, 'b')}
            {pier(-(C / 2 + W), lo, 'c', 0.13)}
            {pier(C / 2 + W, lo, 'd', 0.13)}
            {pointedArch(C, C, 0.06, sh, 0, mats.stone)}
            {pointedArch(C, C - 0.07, 0.011, sh, 0.06, mats.seam)}
            {[-1, 1].map((sx) => (
              <group key={sx} position={[sx * (C / 2 + W / 2), 0, 0]}>
                {pointedArch(W, W, 0.045, lo, 0, mats.stone)}
                {pointedArch(W, W - 0.05, 0.009, lo, 0.05, mats.seam)}
              </group>
            ))}
            <mesh material={mats.metal} position={[0, apex + 0.12, 0]} castShadow>
              <coneGeometry args={[0.05, 0.26, 4]} />
            </mesh>
          </group>
        );
      } else if (form === 2) {
        // bell tower: square body, corner pinnacles, lancet window and a tall spire
        const th = sh + 0.3;
        const spireH = S * 0.9 + 0.3;
        body = (
          <group>
            <mesh material={mats.stone} position={[0, th / 2, 0]} castShadow receiveShadow>
              <boxGeometry args={[0.5, th, 0.5]} />
            </mesh>
            <mesh material={mats.metal} position={[0, th + 0.03, 0]} castShadow>
              <boxGeometry args={[0.58, 0.06, 0.58]} />
            </mesh>
            {[-1, 1].flatMap((sx) =>
              [-1, 1].map((sz) => (
                <mesh
                  key={`${sx}${sz}`}
                  material={mats.metal}
                  position={[sx * 0.24, th + 0.06 + pinH / 2, sz * 0.24]}
                  rotation={[0, Math.PI / 4, 0]}
                  castShadow
                >
                  <coneGeometry args={[0.05, pinH, 4]} />
                </mesh>
              )),
            )}
            <mesh material={mats.stone} position={[0, th + 0.06 + spireH / 2, 0]} rotation={[0, Math.PI / 8, 0]} castShadow>
              <coneGeometry args={[0.2, spireH, 8]} />
            </mesh>
            {pointedArch(0.2, 0.2, 0.012, th * 0.66, 0.256, mats.seam)}
            {[-0.1, 0.1].map((x) => (
              <group key={x}>{seamStrip(th * 0.3, th * 0.51, 0.256, 0.012, 0, x)}</group>
            ))}
            {seamStrip(th * 0.22, th * 0.22, 0.256, 0.06)}
          </group>
        );
      } else if (form === 3) {
        // rose window held up on two piers, eight lit spokes
        const R = S * 0.42;
        const ph = sh * 0.8;
        const c = ph + R * 0.35;
        body = (
          <group>
            {pier(-(R + 0.04), ph, 'a')}
            {pier(R + 0.04, ph, 'b')}
            <mesh material={mats.stone} position={[0, c, 0]} castShadow>
              <torusGeometry args={[R, 0.06, 8, 40]} />
            </mesh>
            <mesh material={mats.seam} position={[0, c, 0.04]}>
              <torusGeometry args={[R * 0.82, 0.011, 6, 48]} />
            </mesh>
            {[0, 1, 2, 3].map((k) => (
              <mesh key={k} material={mats.seam} position={[0, c, 0.03]} rotation={[0, 0, (k * Math.PI) / 4]}>
                <boxGeometry args={[0.012, R * 1.62, 0.012]} />
              </mesh>
            ))}
            <mesh material={mats.metal} position={[0, c, 0.035]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.07, 0.07, 0.03, 16]} />
            </mesh>
            <mesh material={mats.metal} position={[0, c + R + 0.13, 0]} castShadow>
              <coneGeometry args={[0.05, 0.22, 4]} />
            </mesh>
          </group>
        );
      } else if (form === 4) {
        // a tall pier braced by two flying buttresses
        const ph = sh + S * 0.5;
        const ay = ph * 0.75;
        const rad = 0.6;
        const ox = 0.72;
        body = (
          <group>
            <mesh material={mats.stone} position={[0, ph / 2, 0]} castShadow receiveShadow>
              <boxGeometry args={[0.24, ph, 0.3]} />
            </mesh>
            <mesh material={mats.metal} position={[0, ph + (pinH * 1.6) / 2, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
              <coneGeometry args={[0.12, pinH * 1.6, 4]} />
            </mesh>
            {seamStrip(ph * 0.7, ph * 0.45, 0.156, 0.02)}
            {[-1, 1].map((sx) => (
              <group key={sx}>
                {pier(sx * ox, ay - rad, sx, 0.14)}
                <mesh material={mats.stone} position={[sx * ox, ay, 0]} rotation={[0, 0, sx > 0 ? Math.PI : -Math.PI / 2]} castShadow>
                  <torusGeometry args={[rad, 0.045, 6, 16, Math.PI / 2]} />
                </mesh>
                <mesh material={mats.seam} position={[sx * ox, ay, 0.05]} rotation={[0, 0, sx > 0 ? Math.PI : -Math.PI / 2]}>
                  <torusGeometry args={[rad - 0.05, 0.008, 4, 20, Math.PI / 2]} />
                </mesh>
              </group>
            ))}
          </group>
        );
      } else {
        // pointed-arch gateway: twin piers with pinnacles, ribbed arch, optional rose ring
        body = (
          <group>
            {pier(-S / 2, sh, 'a')}
            {pier(S / 2, sh, 'b')}
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
      }
      break;
    }
  }

  if (camp && index > 0) return null;

  return (
    <group position={position}>
      <group rotation={[0, yaw, 0]}>
        {spec.theme === 'temple' ? (
          <TempleStatue beacon={beacon} planet={planet} focus={state} rim={rim} rimColor={rimColor} reducedMotion={reducedMotion} index={index} />
        ) : camp ? (
          <Camp planet={planet} ids={groupIds} rim={rim} rimColor={rimColor} reducedMotion={reducedMotion} />
        ) : (
          <>
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
          </>
        )}
      </group>

      {/* soft light pool and focus ring */}
      {!built && (
        <mesh material={mats.pool} position={[0, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
          <planeGeometry args={[6, 6]} />
        </mesh>
      )}
      <mesh ref={ring} material={mats.ringMat} position={[0, 0.08, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={reach} renderOrder={3}>
        <ringGeometry args={[1.0, 1.035, 96]} />
      </mesh>

      <BeaconScreens
        beacon={beacon}
        group={camp ? planet.beacons : undefined}
        planet={planet}
        height={height}
        index={index}
        reducedMotion={reducedMotion}
      />

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
        <cylinderGeometry args={[1.3 * reach, 1.3 * reach, height + 1.4, 12]} />
      </mesh>
    </group>
  );
};

export default Beacon;
