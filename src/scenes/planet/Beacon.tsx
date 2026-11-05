import { useEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { Beacon as BeaconData, BeaconKind, Planet, Vec3 } from '@/types/content';
import { useAppStore } from '@/state/useAppStore';
import { dragLook, mouseLook } from '@/state/runtime';
import { arrivalPulse } from './surfaceState';
import { openBeacon } from '@/ui/navigation';


/** Approximate monument height per kind, used for labels and screen-size estimates. */
const BEACON_HEIGHT: Record<BeaconKind, number> = {
  project: 4.2,
  award: 3.05,
  skills: 2.5,
  link: 2.8,
  profile: 2.9,
};

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

const skillPillars = (b: BeaconData): Array<[number, number, number]> => {
  const n = b.kind === 'skills' ? Math.max(3, Math.min(6, b.content.items.length)) : 3;
  const out: Array<[number, number, number]> = [];
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * Math.PI * 2 + 0.4;
    const r = n <= 3 ? 0.36 : 0.44;
    const f = Math.sin(i * 12.9898 + n * 3.7) * 43758.5453;
    out.push([Math.cos(a) * r, Math.sin(a) * r, 1.1 + (f - Math.floor(f)) * 1.0]);
  }
  return out;
};

/** Monument height for one beacon (labels and HUD anchors sit just above it). */
export const beaconHeight = (b: BeaconData): number => {
  if (b.kind === 'award') return AWARD_TIER[awardRank(b).tier].pillar + 0.75;
  if (b.kind === 'skills') return Math.max(...skillPillars(b).map((p) => p[2])) + 0.55;
  return BEACON_HEIGHT[b.kind];
};

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

const Beacon = ({ beacon, planet, index, position, rim = 0.2, rimColor, reducedMotion }: BeaconProps) => {
  const kind = beacon.kind;
  const height = useMemo(() => beaconHeight(beacon), [beacon]);
  const rank = useMemo(() => awardRank(beacon), [beacon]);
  const pillars = useMemo(() => skillPillars(beacon), [beacon]);
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
  }, [planet, kind, rim, rimColor, rank]);

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

  const seamStrip = (h: number, y: number, z: number, w = 0.028, tilt = 0) => (
    <mesh material={mats.seam} position={[0, y, z]} rotation={[tilt, 0, 0]}>
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

  let body: JSX.Element;
  switch (kind) {
    case 'project':
      body = (
        <group>
          <mesh material={mats.stone} position={[0, 1.7, 0]} rotation={[0, Math.PI / 4, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.2, 0.34, 3.4, 4, 1]} />
          </mesh>
          <mesh material={mats.metal} position={[0, 3.52, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
            <coneGeometry args={[0.2, 0.32, 4]} />
          </mesh>
          {faceSeam(0.2, 0.34, 3.4, 1.7, 2.9, Math.SQRT1_2)}
          <group ref={floater}>
            <group position={[0, 4.0, 0]}>
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
            </group>
          </group>
        </group>
      );
      break;
    case 'award': {
      const P = AWARD_TIER[rank.tier].pillar;
      const crownY = P + 0.48;
      body = (
        <group>
          <mesh material={mats.stone} position={[0, P / 2, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.2, 0.26, P, 8]} />
          </mesh>
          <mesh material={mats.metal} position={[0, P + 0.06, 0]} castShadow>
            <cylinderGeometry args={[0.3, 0.22, 0.12, 8]} />
          </mesh>
          {faceSeam(0.2, 0.26, P, P / 2, P * 0.82, 1, 0.022)}
          <group ref={floater}>
            {rank.tier === 1 && !rank.category && (
              // winner: a level golden halo
              <group position={[0, crownY, 0]} rotation={[1.3, 0, 0.1]}>
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
              <group position={[0, crownY, 0]}>
                <mesh material={mats.metal} rotation={[0, 0, 0.5]}>
                  <torusGeometry args={[0.32, 0.014, 8, 64]} />
                </mesh>
                <mesh material={mats.metal} rotation={[0, Math.PI / 2, -0.5]}>
                  <torusGeometry args={[0.32, 0.014, 8, 64]} />
                </mesh>
                <mesh material={mats.seam} rotation={[Math.PI / 2, 0, 0]}>
                  <torusGeometry args={[0.32, 0.005, 6, 64]} />
                </mesh>
              </group>
            )}
            {rank.tier === 2 && (
              <group position={[0, crownY, 0]} rotation={[1.3, 0, 0.1]}>
                <mesh material={mats.metal}>
                  <torusGeometry args={[0.3, 0.014, 8, 64]} />
                </mesh>
              </group>
            )}
            {rank.tier === 3 && (
              // distinction: a small upright medal
              <group position={[0, crownY - 0.05, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <mesh material={mats.metal}>
                  <cylinderGeometry args={[0.16, 0.16, 0.03, 32]} />
                </mesh>
                <mesh material={mats.seam} position={[0, 0.017, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                  <ringGeometry args={[0.1, 0.12, 32]} />
                </mesh>
              </group>
            )}
            {rank.category ? (
              <mesh material={mats.seam} position={[0, crownY, 0]}>
                <octahedronGeometry args={[0.075, 0]} />
              </mesh>
            ) : (
              rank.tier !== 3 && (
                <mesh material={mats.seam} position={[0, crownY, 0]}>
                  <sphereGeometry args={[0.055, 16, 12]} />
                </mesh>
              )
            )}
          </group>
        </group>
      );
      break;
    }
    case 'skills': {
      const w = pillars.length > 4 ? 0.22 : 0.28;
      const top = Math.max(...pillars.map((p) => p[2]));
      body = (
        <group>
          {pillars.map(([x, z, h], i) => (
            <group key={i} position={[x, 0, z]}>
              <mesh material={mats.stone} position={[0, h / 2, 0]} castShadow receiveShadow>
                <boxGeometry args={[w, h, w]} />
              </mesh>
              <mesh material={mats.metal} position={[0, h + 0.045, 0]} castShadow>
                <boxGeometry args={[w * 1.14, 0.09, w * 1.14]} />
              </mesh>
              <mesh material={mats.seam} position={[0, h + 0.095, 0]}>
                <boxGeometry args={[w * 0.6, 0.012, w * 0.6]} />
              </mesh>
              {seamStrip(h * 0.75, h * 0.45, w / 2 + 0.005, 0.02)}
            </group>
          ))}
          <group ref={floater}>
            <mesh material={mats.seam} position={[0, top + 0.35, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.16, 0.012, 6, 48]} />
            </mesh>
          </group>
        </group>
      );
      break;
    }
    case 'link':
      body = (
        <group>
          <group scale={[0.62, 1.7, 1]}>
            <mesh material={mats.metal} castShadow>
              <torusGeometry args={[0.95, 0.045, 8, 64, Math.PI]} />
            </mesh>
            <mesh material={mats.seam} position={[0, 0, 0.05]}>
              <torusGeometry args={[0.95, 0.008, 6, 96, Math.PI]} />
            </mesh>
          </group>
          <mesh material={mats.stone} position={[0, 1.25, -0.15]} castShadow>
            <cylinderGeometry args={[0.025, 0.04, 2.5, 6]} />
          </mesh>
          <group ref={floater}>
            <mesh material={mats.seam} position={[0, 2.62, -0.15]}>
              <sphereGeometry args={[0.06, 14, 10]} />
            </mesh>
          </group>
          <mesh material={mats.seam} position={[0, 1.05, 0]}>
            <octahedronGeometry args={[0.06, 0]} />
          </mesh>
        </group>
      );
      break;
    default:
      body = (
        <group rotation={[0, 0, 0.035]}>
          <group scale={[1.15, 1, 0.55]}>
            <mesh material={mats.stone} position={[0, 1.2, 0]} rotation={[0, Math.PI / 4, 0]} castShadow receiveShadow>
              <cylinderGeometry args={[0.3, 0.42, 2.4, 4, 1]} />
            </mesh>
          </group>
          {faceSeam(0.3, 0.42, 2.4, 1.15, 1.7, Math.SQRT1_2 * 0.55, 0.02)}
          <group ref={floater}>
            <mesh material={mats.seam} position={[0, 2.75, 0]}>
              <octahedronGeometry args={[0.06, 0]} />
            </mesh>
          </group>
        </group>
      );
  }

  return (
    <group position={position}>
      <group rotation={[0, yaw, 0]}>
        {/* plinth */}
        <mesh material={mats.plinth} position={[0, 0.04, 0]} receiveShadow castShadow>
          <cylinderGeometry args={[0.85, 0.95, 0.14, 8]} />
        </mesh>
        <group position={[0, 0.1, 0]}>{body}</group>
      </group>

      {/* soft light pool and focus ring */}
      <mesh material={mats.pool} position={[0, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
        <planeGeometry args={[6, 6]} />
      </mesh>
      <mesh ref={ring} material={mats.ringMat} position={[0, 0.08, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={3}>
        <ringGeometry args={[1.0, 1.035, 96]} />
      </mesh>

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
