import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { Planet, PlanetStyle } from '@/types/content';
import { walkRadiusFor, type HeightFn } from './Terrain';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry, seedOf } from './rng';
import { callFrom, damp, isPoke, makeEco, smooth01, wrapAngle, type EcoRef, type Viewer } from './faunaCommon';
import { Mesher, rgb, mixRgb } from './faunaGeo';
import Birds, { type BirdCfg } from './faunaBirds';
import Walkers, { type WalkerKind } from './faunaWalkers';
import Skitterers, { type SkitterCfg } from './faunaSkitter';
import Jellies from './faunaJellies';
import { useAppStore } from '@/state/useAppStore';

/* ---------- which creatures live where ---------- */

/** A herd of walkers: medium ones that follow and greet, or big ones that roam slower */
interface Herd {
  kind: WalkerKind;
  count: number;
  size?: number;
  speed?: number;
  /** Deer coat and leg colours */
  colors?: [string, string];
}

/**
 * Each planet has its own creatures, none shared with another: something very
 * small (a flier or a critter underfoot), something medium on the ground, and
 * one giant far off in the sky or on the horizon.
 */
interface Fauna {
  birds: BirdCfg | null;
  walkers: Herd[];
  jellies: number;
  skitter: SkitterCfg | null;
  gliders: GliderCfg | null;
  colossus: boolean;
}

const FAUNA: Record<PlanetStyle, Fauna> = {
  // gulls wheeling over the island
  oceanic: {
    birds: { count: 9, color: '#f2f0ea', tip: '#3a3a40', belly: '#fbfaf6', style: 'soar', alt: [6, 10], radius: [12, 24], perch: 0.35 },
    walkers: [],
    jellies: 0,
    skitter: null,
    gliders: null,
    colossus: false,
  },
  // dark songbirds and grazing deer under the canopy
  forested: {
    birds: { count: 8, color: '#1a1714', tip: '#0e0c0a', belly: '#5a4c3e', style: 'bound', alt: [6, 10], radius: [14, 26], perch: 0.3 },
    walkers: [{ kind: 'deer', count: 4 }],
    jellies: 0,
    skitter: null,
    gliders: null,
    colossus: false,
  },
  // About, dunes at dusk: dune lizards and birds; the bouncing hoppers; sky rays far overhead
  rocky: {
    birds: { count: 5, color: '#241a16', tip: '#120c0a', belly: '#6b5444', style: 'bound', alt: [7, 11], radius: [14, 28], perch: 0.5 },
    walkers: [{ kind: 'hopper', count: 6 }],
    jellies: 0,
    skitter: { kind: 'lizard', count: 10, color: '#6b4a33' },
    gliders: { kind: 'manta', count: 2, color: '#3d2c3f', glow: '#ffb48a', glowK: 0.12, alt: [22, 30], radius: [30, 40] },
    colossus: false,
  },
  // Projects, night over the cloud deck: glowing crabs and drifters; long-legged grazers; sky whales
  'gas-giant': {
    birds: null,
    walkers: [{ kind: 'deer', count: 3, size: 1.15, speed: 0.8, colors: ['#9a8ac0', '#3e3456'] }],
    jellies: 7,
    skitter: { kind: 'crab', count: 9, color: '#2e2440', glow: '#b48cff' },
    gliders: { kind: 'whale', count: 3, color: '#2c2552', glow: '#b79cff', glowK: 0, alt: [18, 25], radius: [24, 32] },
    colossus: false,
  },
  // Awards, the molten world: ember salamanders; magma tortoises; a basalt colossus on the horizon
  molten: {
    birds: null,
    walkers: [{ kind: 'tortoise', count: 4 }],
    jellies: 0,
    skitter: { kind: 'ember', count: 10, color: '#2a140b', glow: '#ff6a1a' },
    gliders: null,
    colossus: true,
  },
};

/*
 * ---------- gliders: big slow creatures of the sky ----------
 * Sky rays and sky whales wheeling in wide, slow loops high overhead, their
 * wings or flukes rippling. The easter egg: stand still and look up at one for
 * a couple of seconds (or click it) and it answers with a long low call and
 * swoops down in a broad circle over you, then climbs back up.
 */

type GliderKind = 'manta' | 'whale';
interface GliderCfg {
  kind: GliderKind;
  count: number;
  color: string;
  glow: string;
  /** How strongly the glow shows (bioluminescent spots, lava-lit edges) */
  glowK: number;
  alt: [number, number];
  radius: [number, number];
}

const GAZE_S = 2.2;
const SWOOP_S = 16;
const SWOOP_COOL_S = 40;
const GAZE_COS = Math.cos(0.14);

/**
 * A manta: broad wings tapering to swept points, a raised body with a blunt
 * head, cephalic lobes curling forward either side of the mouth, a pale belly
 * and pale shoulder marks on a dark back, and a thin whip tail.
 * aWing rises toward the tips; aChord runs nose (0) to tail (1) for the wave.
 */
const mantaGeometry = (color: string) => {
  const span = 4.2;
  const len = 2.0;
  const back = rgb(color);
  const belly = mixRgb(back, rgb('#d9cdbf'), 0.6);
  const mark = mixRgb(back, rgb('#c8b8ae'), 0.32);
  const m = new Mesher();
  const NU = 26;
  const NV = 12;
  // outline in (u across the wing 0..1, w along the chord -1 tail..1 nose)
  const point = (u: number, w: number): [number, number, number] => {
    const lead = Math.sqrt(Math.max(0, 1 - u)) - 0.85 * u;
    const trail = -0.6 * (1 - u) * Math.sqrt(Math.max(0, 1 - u)) - 0.85 * u;
    const z = (len / 2) * (trail + ((w + 1) / 2) * (lead - trail));
    const hump = Math.max(0, 1 - u / 0.32);
    const y = 0.34 * hump * hump * Math.sqrt(Math.max(0, 1 - w * w));
    return [u * span, y, z];
  };
  m.rig = (x, _y, z) => [THREE.MathUtils.clamp((Math.abs(x) / span - 0.12) / 0.8, 0, 1), THREE.MathUtils.clamp(0.5 - z / len, 0, 1), 0];
  for (const s of [-1, 1]) {
    // the dark back
    m.paint = (x, _y, z) => {
      const u = Math.abs(x) / span;
      const shoulder = Math.hypot((u - 0.32) * 3, z * 1.8) < 0.4 && z > -0.2;
      return shoulder ? mark : back;
    };
    m.sheet(NU, NV, (a, b) => {
      const u = a * a * 0.6 + a * 0.4;
      const p = point(u, 1 - b * 2);
      return [s * p[0], p[1], p[2]];
    });
    // the pale belly, just under it
    m.paint = () => belly;
    m.sheet(NU, NV, (a, b) => {
      const u = a * a * 0.6 + a * 0.4;
      const p = point(u, b * 2 - 1);
      return [s * p[0], -0.04 * (1 - u), p[2]];
    });
    // a cephalic lobe either side of the mouth, curling forward
    m.paint = () => mixRgb(back, belly, 0.3);
    m.tube([s * 0.42, 0.02, len * 0.42], [s * 0.5, 0.0, len * 0.62], 0.1, 0.06, 5);
    m.tube([s * 0.5, 0.0, len * 0.62], [s * 0.36, -0.02, len * 0.74], 0.06, 0.02, 5);
  }
  // the tail
  m.rig = () => [0, 1, 0];
  m.paint = () => back;
  m.tube([0, 0.05, -len * 0.3], [0, 0.03, -len * 0.3 - 2.4], 0.06, 0.008, 5);
  return m.build();
};

const WHALE_LEN = 12;
const WHALE_ZOFF = WHALE_LEN / 2;
/** Body radius at s (0 nose, 1 tail): a blunt head, a deep chest, a long taper to the tail stock */
const whaleRadius = (s: number) => {
  const taper = THREE.MathUtils.smoothstep(s, 0.3, 1);
  return 1.35 * Math.min(1, Math.sqrt(s / 0.22)) * (1 - 0.93 * taper);
};
/** The spine rises a little toward the tail */
const whaleSpine = (s: number) => s * s * 0.5;

/**
 * A leviathan in one mesh: a lofted body, scalloped pectoral fins, a dorsal
 * fin, broad flukes and light streamers trailing from the belly.
 * aBody: 0 nose to 1 tail, for the swim wave. aWing: fin flap amount.
 * aSkin: (s, a, 0) on the body with a 0 along the back and 1 along the belly;
 * (span, chord, 1) on fins; (seed, along, 2) on streamers.
 */
const whaleGeometry = () => {
  const pos: number[] = [];
  const body: number[] = [];
  const wing: number[] = [];
  const skin: number[] = [];
  const index: number[] = [];
  const vert = (x: number, y: number, z: number, b: number, w: number, s0: number, s1: number, kind: number) => {
    pos.push(x, y, z);
    body.push(b);
    wing.push(w);
    skin.push(s0, s1, kind);
    return pos.length / 3 - 1;
  };
  const quad = (a: number, b: number, c: number, d: number) => index.push(a, b, c, b, d, c);

  const RINGS = 32;
  const SIDES = 16;
  const first = pos.length / 3;
  for (let i = 0; i <= RINGS; i += 1) {
    const s = 0.002 + 0.998 * (i / RINGS) ** 1.4;
    const r = whaleRadius(s);
    for (let j = 0; j < SIDES; j += 1) {
      const th = (j / SIDES) * Math.PI * 2;
      const c = Math.cos(th);
      // a flatter back over a deep belly and jaw
      const y = whaleSpine(s) + r * c * (c > 0 ? 0.72 : 1);
      vert(r * Math.sin(th), y, WHALE_ZOFF - s * WHALE_LEN, s, 0, s, 1 - Math.abs(1 - (2 * j) / SIDES), 0);
    }
  }
  for (let i = 0; i < RINGS; i += 1) {
    for (let j = 0; j < SIDES; j += 1) {
      const n = (j + 1) % SIDES;
      quad(first + i * SIDES + j, first + i * SIDES + n, first + (i + 1) * SIDES + j, first + (i + 1) * SIDES + n);
    }
  }

  /** A fin sheet: leading edge from root toward tip, swept back along a curve, chord(u) behind it */
  const fin = (
    root: [number, number, number],
    tip: [number, number, number],
    chord: (u: number) => number,
    bodyAt: number,
    flap: number,
  ) => {
    const SPAN = 12;
    const CHORD = 4;
    const start = pos.length / 3;
    for (let i = 0; i <= SPAN; i += 1) {
      const u = i / SPAN;
      for (let j = 0; j <= CHORD; j += 1) {
        const v = j / CHORD;
        vert(
          root[0] + tip[0] * u,
          root[1] + tip[1] * u,
          root[2] + tip[2] * u * u - v * chord(u),
          bodyAt + (root[2] < -WHALE_ZOFF * 0.8 ? 0.06 * u : 0),
          flap * u,
          u,
          v,
          1,
        );
      }
    }
    for (let i = 0; i < SPAN; i += 1) {
      for (let j = 0; j < CHORD; j += 1) {
        const k = start + i * (CHORD + 1) + j;
        quad(k, k + CHORD + 1, k + 1, k + CHORD + 2);
      }
    }
  };

  const tailY = whaleSpine(1);
  [-1, 1].forEach((sx) => {
    // long pectorals with a knobbled leading edge
    fin([sx * 1.1, -0.45, 2.5], [sx * 5.4, -0.7, -3.4], (u) => 2.1 * (1 - u) ** 0.6 * (1 + 0.07 * Math.sin(u * 24)), 0.3, 1);
    // flukes: wide, swept, narrowing to the notch at the centre
    fin([0, tailY, -WHALE_ZOFF + 0.3], [sx * 3.5, 0, -1.3], (u) => 1.7 * (1 - u) ** 0.7 * (0.55 + 0.45 * Math.min(1, u / 0.3)), 1, 0);
  });
  const dorsalS = 0.62;
  fin([0, whaleSpine(dorsalS) + whaleRadius(dorsalS) * 0.68, WHALE_ZOFF - dorsalS * WHALE_LEN], [0, 0.95, -1.2], (u) => 1.1 * (1 - u), dorsalS, 0);

  // streamers of light, in pairs down the belly
  const rnd = mulberry(seedOf('whale-streamers'));
  for (let p = 0; p < 5; p += 1) {
    const s = 0.34 + p * 0.09;
    [-1, 1].forEach((sx) => {
      const r = whaleRadius(s);
      const x0 = sx * r * 0.45;
      const y0 = whaleSpine(s) - r * 0.85;
      const z0 = WHALE_ZOFF - s * WHALE_LEN;
      const len = 5 + rnd() * 5;
      const seed = rnd() * 20;
      const SEGS = 14;
      const start = pos.length / 3;
      for (let i = 0; i <= SEGS; i += 1) {
        const t = i / SEGS;
        const hw = 0.1 * (1 - t) + 0.012;
        vert(x0 - hw, y0, z0 - t * len, s, 0, seed, t, 2);
        vert(x0 + hw, y0, z0 - t * len, s, 0, seed, t, 2);
      }
      for (let i = 0; i < SEGS; i += 1) {
        const k = start + i * 2;
        quad(k, k + 1, k + 2, k + 3);
      }
    });
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aBody', new THREE.Float32BufferAttribute(body, 1));
  g.setAttribute('aWing', new THREE.Float32BufferAttribute(wing, 1));
  g.setAttribute('aSkin', new THREE.Float32BufferAttribute(skin, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
};

/** The whale's second light, for pleats and fin edges */
const WHALE_ALT = new THREE.Color('#6fe6ff');
/** Each whale's size: a great old one, a grown one, and a calf */
const WHALE_SCALE = [1.55, 1, 0.5];

/** Dark hide lit by markings that pulse from nose to tail and flare when the whale sings */
const whaleMaterial = (cfg: GliderCfg, time: { value: number }, phase: number) => {
  const m = new THREE.MeshStandardMaterial({ color: cfg.color, roughness: 0.6, side: THREE.DoubleSide });
  const sing = { value: 0 };
  m.userData.sing = sing;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.uniforms.uPhase = { value: phase };
    shader.uniforms.uSing = sing;
    shader.uniforms.uGlow = { value: new THREE.Color(cfg.glow) };
    shader.uniforms.uAlt = { value: WHALE_ALT };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float aBody;
        attribute float aWing;
        attribute vec3 aSkin;
        uniform float uTime;
        uniform float uPhase;
        varying vec3 vSkin;
        varying float vBody;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vSkin = aSkin;
        vBody = aBody;
        // a slow swim wave growing toward the flukes, and long lazy fin beats
        transformed.y += sin(uTime * 0.75 + uPhase - aBody * 3.6) * (0.06 + aBody * aBody * 0.85);
        transformed.y += sin(uTime * 0.7 + uPhase - aWing * 1.4) * aWing * aWing * 1.5;
        if (aSkin.z > 1.5) {
          transformed.x += sin(uTime * 1.1 + aSkin.x - aSkin.y * 4.0) * aSkin.y * 0.9;
          transformed.y += cos(uTime * 0.8 + aSkin.x - aSkin.y * 3.0) * aSkin.y * 0.5 - aSkin.y * aSkin.y * 0.6;
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform float uPhase;
        uniform float uSing;
        uniform vec3 uGlow;
        uniform vec3 uAlt;
        varying vec3 vSkin;
        varying float vBody;
        float whaleHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // a paler belly under the dark back
        if (vSkin.z < 0.5) diffuseColor.rgb *= mix(0.7, 2.4, smoothstep(0.5, 0.85, vSkin.y));`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float wave = 0.5 + 0.5 * sin(uTime * 1.1 + uPhase - vBody * 9.0);
        float pulse = 0.3 + 0.7 * wave * wave + uSing;
        vec3 whaleGlow = vec3(0.0);
        if (vSkin.z < 0.5) {
          float s = vSkin.x;
          float a = vSkin.y;
          // beads along the flank
          float flank = smoothstep(0.03, 0.008, abs(a - 0.52 + 0.04 * sin(s * 14.0))) * smoothstep(0.1, 0.8, sin(s * 150.0));
          // a scatter of stars over the back
          vec2 c = vec2(s * 46.0, a * 15.0);
          vec2 id = floor(c);
          float h = whaleHash(id);
          float stars = step(h, 0.42) * smoothstep(0.24, 0.06, length(fract(c) - 0.5 - (vec2(whaleHash(id + 7.0), h) - 0.5) * 0.4));
          stars *= smoothstep(0.5, 0.2, a);
          // throat pleats
          float pleats = smoothstep(0.55, 1.0, sin(a * 130.0)) * smoothstep(0.72, 0.8, a) * smoothstep(0.55, 0.35, s);
          float eye = smoothstep(1.0, 0.5, length(vec2((s - 0.085) * 16.0, (a - 0.47) * 7.0)));
          whaleGlow = uGlow * (flank * 2.2 + stars * 1.8) * pulse + uAlt * pleats * 0.8 * pulse + vec3(2.6, 2.9, 3.2) * eye;
        } else if (vSkin.z < 1.5) {
          float rim = smoothstep(0.78, 1.0, vSkin.y);
          float veins = smoothstep(0.8, 1.0, sin(vSkin.x * 70.0)) * smoothstep(0.1, 0.7, vSkin.y) * 0.45;
          whaleGlow = uAlt * (rim * 1.5 + veins) * pulse;
        } else {
          float t = vSkin.y;
          whaleGlow = mix(uGlow, uAlt, t) * (0.5 + 1.8 * (1.0 - t)) * (0.7 + 0.5 * sin(t * 20.0 - uTime * 3.0 + vSkin.x)) * (1.0 + uSing);
        }
        totalEmissiveRadiance += whaleGlow;`,
      );
  };
  m.customProgramCacheKey = () => 'glider-whale-v2';
  return m;
};

const gliderMaterial = (cfg: GliderCfg, time: { value: number }, phase: number) => {
  const m = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    vertexColors: true,
    roughness: 0.75,
    side: THREE.DoubleSide,
    emissive: new THREE.Color(cfg.glow),
    emissiveIntensity: cfg.glowK,
  });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.uniforms.uPhase = { value: phase };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aRig;\nuniform float uTime;\nuniform float uPhase;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        // slow strokes rolling out along the wings and back along the chord, the tips last
        float aw = aRig.x;
        float stroke = sin(uTime * 0.9 + uPhase - aw * 1.6 - aRig.y * 0.9);
        transformed.y += stroke * aw * aw * 0.7;
        transformed.y += sin(uTime * 0.8 + uPhase + position.z * 0.7) * 0.08 * (1.0 - aw);`,
      );
  };
  m.customProgramCacheKey = () => `glider-${cfg.kind}-v2`;
  return m;
};

interface GliderState {
  cx: number;
  cz: number;
  r: number;
  w: number;
  th: number;
  alt: number;
  ph: number;
  gaze: number;
  swoop: number;
  /** 0..1 how far into the swoop it has blended */
  k: number;
  cool: number;
  sang: boolean;
  last: THREE.Vector3;
}

const Gliders = ({ planet, cfg, eco, reducedMotion }: { planet: Planet; cfg: GliderCfg; eco: EcoRef; reducedMotion?: boolean }) => {
  const camera = useThree((s) => s.camera);
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  const time = useMemo(() => ({ value: 0 }), []);
  const rnd = useMemo(() => mulberry(seedOf(`${planet.id}:gliders`)), [planet.id]);
  const geo = useMemo(() => (cfg.kind === 'manta' ? mantaGeometry(cfg.color) : whaleGeometry()), [cfg.kind]);
  const states = useMemo<GliderState[]>(
    () =>
      Array.from({ length: cfg.count }, (_, i) => ({
        cx: (rnd() - 0.5) * 20,
        cz: -12 - rnd() * 20,
        r: cfg.radius[0] + rnd() * (cfg.radius[1] - cfg.radius[0]),
        w: (0.035 + rnd() * 0.02) * (i % 2 ? -1 : 1),
        th: rnd() * Math.PI * 2,
        alt: cfg.alt[0] + rnd() * (cfg.alt[1] - cfg.alt[0]),
        ph: rnd() * 6.28,
        gaze: 0,
        swoop: 0,
        k: 0,
        cool: 8,
        sang: false,
        last: new THREE.Vector3(NaN, 0, 0),
      })),
    [cfg, rnd],
  );
  const mats = useMemo(
    () => states.map((s) => (cfg.kind === 'manta' ? gliderMaterial : whaleMaterial)(cfg, time, s.ph)),
    [states, cfg, time],
  );
  useEffect(
    () => () => {
      geo.dispose();
      mats.forEach((m) => m.dispose());
    },
    [geo, mats],
  );

  const _fwd = useMemo(() => new THREE.Vector3(), []);
  const _to = useMemo(() => new THREE.Vector3(), []);
  const _p = useMemo(() => new THREE.Vector3(), []);
  const _look = useMemo(() => new THREE.Matrix4(), []);
  const _q = useMemo(() => new THREE.Quaternion(), []);
  const _bank = useMemo(() => new THREE.Quaternion(), []);
  const Z = useMemo(() => new THREE.Vector3(0, 0, 1), []);

  const call = (s: GliderState) => {
    s.swoop = SWOOP_S;
    s.cool = SWOOP_COOL_S;
    s.sang = false;
    callFrom(camera, 'song', s.last.x, s.last.y, s.last.z);
  };

  useFrame(({ clock }, delta) => {
    const dt = reducedMotion ? 0 : Math.min(delta, 0.05);
    const t = clock.elapsedTime;
    time.value = reducedMotion ? 5 : t;
    const cam = camera.position;
    _fwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
    let song = 0;
    states.forEach((s, i) => {
      const g = refs.current[i];
      if (!g) return;
      s.cool -= dt;
      s.swoop = Math.max(0, s.swoop - dt);
      s.k += ((s.swoop > 1.5 ? 1 : 0) - s.k) * damp(0.35, dt);
      s.th += s.w * dt * (1 + s.k * 0.6);
      // its loop eases over to a broad circle low over the viewer during a swoop
      const k = smooth01(s.k);
      if (mats[i].userData.sing) mats[i].userData.sing.value = k * 1.2;
      song = Math.max(song, cfg.kind === 'whale' ? k : 0);
      const cx = s.cx + (cam.x - s.cx) * k;
      const cz = s.cz + (cam.z - s.cz) * k;
      const r = s.r + (11 - s.r) * k;
      const alt = s.alt + (cam.y + 8 - s.alt) * k;
      _p.set(cx + Math.cos(s.th) * r, alt + Math.sin(t * 0.13 + s.ph) * 1.8, cz + Math.sin(s.th) * r);
      // heading from motion; banked into the turn
      if (!Number.isNaN(s.last.x) && dt > 0) {
        _to.copy(_p).sub(s.last);
        if (_to.lengthSq() > 1e-8) {
          // Matrix4.lookAt points +z from the target to the eye: the eye one step ahead puts the nose (+z) forward
          _look.lookAt(_to.add(_p), _p, THREE.Object3D.DEFAULT_UP);
          _q.setFromRotationMatrix(_look);
          _bank.setFromAxisAngle(Z, Math.sign(s.w) * (0.22 + 0.15 * k));
          _q.multiply(_bank);
          g.quaternion.slerp(_q, damp(1.5, dt));
        }
      }
      s.last.copy(_p);
      g.position.copy(_p);
      if (s.swoop > 0 && !s.sang && s.swoop < SWOOP_S * 0.55) {
        s.sang = true;
        callFrom(camera, 'song', _p.x, _p.y, _p.z);
      }

      // look up at one and hold still: it answers
      _to.copy(_p).sub(cam);
      const dist = _to.length();
      const looking = _to.dot(_fwd) / Math.max(dist, 1e-3) > GAZE_COS;
      s.gaze = looking && s.swoop <= 0 ? s.gaze + dt : 0;
      if (!reducedMotion && s.gaze > GAZE_S && s.cool <= 0) call(s);
    });
    eco.current.song = song;
  });

  const poke = (e: ThreeEvent<MouseEvent>, i: number) => {
    if (!isPoke(e)) return;
    const s = states[i];
    if (s.swoop <= 0) call(s);
    else callFrom(camera, 'song', s.last.x, s.last.y, s.last.z);
  };

  return (
    <>
      {states.map((_, i) => (
        <mesh
          key={i}
          ref={(el) => (refs.current[i] = el)}
          geometry={geo}
          material={mats[i]}
          scale={cfg.kind === 'manta' ? 1.1 : WHALE_SCALE[i % WHALE_SCALE.length]}
          frustumCulled={false}
          name={`fauna-${cfg.kind}`}
          onClick={(e) => poke(e, i)}
        />
      ))}
    </>
  );
};

/*
 * ---------- the colossus: a magma golem on the horizon ----------
 * A squat, hunched giant of clumped basalt boulders, wider than it is tall,
 * veined with lava cracks: uneven shoulders, fists hanging to the knees, a head
 * sunk into the chest, stumpy legs. It lumbers slowly round the far edge of the
 * molten world. The easter egg: look at it and hold still for a
 * few seconds (or click it) and it stops, turns its head to you, raises an arm
 * and waves with a deep rumble, then walks on.
 */
const COLOSSUS_R = 62;
/** Built 8 units tall, scaled to this */
const COLOSSUS_H = 16;
const COLOSSUS_SPEED = 1.1;
const COLOSSUS_GAZE_S = 2.5;
const COLOSSUS_WAVE_S = 7;
const COLOSSUS_COOL_S = 35;
const COLOSSUS_GLOW = new THREE.Color('#ff6a1a').multiplyScalar(2.2);
const COLOSSUS_GAZE_COS = Math.cos(0.2);
/** The lava between the rocks burns deeper than the cracks and eyes */
const COLOSSUS_CORE_TINT = new THREE.Color(0.32, 0.05, 0.03);

/** A hash of a vertex position, so the vertices a non-indexed mesh duplicates all move together */
const vhash = (x: number, y: number, z: number, seed: number) => {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + seed * 17.3) * 43758.5453;
  return h - Math.floor(h);
};

/**
 * A clump of n irregular boulders (knocked-about icosahedra) filling an
 * ellipsoid of half sizes r about c, each between size[0] and size[1] across.
 */
const boulders = (rnd: () => number, n: number, c: [number, number, number], r: [number, number, number], size: [number, number]) => {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i += 1) {
    const g = new THREE.IcosahedronGeometry(1, 1);
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const seed = rnd() * 100;
    for (let k = 0; k < pos.count; k += 1) {
      const x = pos.getX(k);
      const y = pos.getY(k);
      const z = pos.getZ(k);
      const d = 0.72 + 0.5 * vhash(Math.round(x * 50), Math.round(y * 50), Math.round(z * 50), seed);
      pos.setXYZ(k, x * d, y * d, z * d);
    }
    const s0 = (size[0] + rnd() * (size[1] - size[0])) / 2;
    g.scale(s0 * (0.75 + rnd() * 0.5), s0 * (0.7 + rnd() * 0.45), s0 * (0.75 + rnd() * 0.5));
    g.rotateX(rnd() * Math.PI);
    g.rotateY(rnd() * Math.PI);
    g.rotateZ(rnd() * Math.PI);
    g.translate(c[0] + (rnd() * 2 - 1) * r[0] * 0.75, c[1] + (rnd() * 2 - 1) * r[1] * 0.75, c[2] + (rnd() * 2 - 1) * r[2] * 0.75);
    g.computeVertexNormals();
    parts.push(g);
  }
  const m = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return m!;
};

/** Merges clumps into one geometry and frees the pieces */
const mergeClumps = (clumps: THREE.BufferGeometry[]) => {
  const m = mergeGeometries(clumps);
  clumps.forEach((p) => p.dispose());
  return m!;
};

/** The golem's left side runs bigger than its right, so it never reads as mirrored */
const GOLEM_SIDE = [1.14, 1];
/** Shoulder centres, per side */
const GOLEM_SHOULDER: [number, number, number][] = [
  [-3.5, 6.6, 0.1],
  [3.25, 6.25, 0.2],
];

/** The golem's parts: rock clumps for each limb (one per side), and the lava cores between the rocks */
const golemParts = (seedKey: string) => {
  const rnd = mulberry(seedOf(seedKey));
  const sides = (f: (k: number) => THREE.BufferGeometry) => GOLEM_SIDE.map(f);
  return {
    hips: boulders(rnd, 7, [0, 3.3, 0], [1.9, 0.6, 1.2], [1.1, 1.6]),
    torso: mergeClumps([
      // a vast hunched chest with a rough hump of rock across the back
      boulders(rnd, 16, [0, 5.35, 0.2], [2.3, 1.45, 1.8], [1.4, 2.1]),
      boulders(rnd, 6, [0.3, 6.6, -0.9], [1.8, 0.5, 0.8], [1.0, 1.6]),
      ...GOLEM_SHOULDER.map((c, i) =>
        boulders(rnd, 6, c, [1.1 * GOLEM_SIDE[i], 0.9 * GOLEM_SIDE[i], 1.1], [1.4 * GOLEM_SIDE[i], 2.0 * GOLEM_SIDE[i]]),
      ),
    ]),
    thigh: sides(() => boulders(rnd, 5, [0, -0.65, 0], [0.7, 0.75, 0.7], [1.1, 1.45])),
    shin: sides(() =>
      mergeClumps([
        boulders(rnd, 5, [0, -0.6, 0.05], [0.7, 0.65, 0.7], [1.1, 1.45]),
        boulders(rnd, 4, [0, -1.45, 0.45], [0.85, 0.2, 0.9], [0.8, 1.1]),
      ]),
    ),
    upper: sides((k) => boulders(rnd, 5, [0, -0.85, 0], [0.8 * k, 0.75, 0.8 * k], [1.1 * k, 1.6 * k])),
    fore: sides((k) =>
      mergeClumps([
        boulders(rnd, 6, [0, -0.9, 0.1], [0.9 * k, 0.8, 0.9 * k], [1.2 * k, 1.7 * k]),
        boulders(rnd, 6, [0, -2.3, 0.2], [0.95 * k, 0.65 * k, 0.95 * k], [1.3 * k, 1.9 * k]),
      ]),
    ),
    head: boulders(rnd, 5, [0, 0.3, 0], [0.7, 0.5, 0.6], [1.0, 1.35]),
    core: new THREE.SphereGeometry(1, 12, 9),
  };
};

/**
 * Dark rock veined with lava: the distance to the nearest Voronoi cell border
 * draws a crack network in model space, widening over hot patches. The cracks
 * go on after the fog so they still burn through the haze.
 */
const golemStone = (glow: THREE.Color) => {
  const m = new THREE.MeshStandardMaterial({ color: '#33211c', roughness: 0.95, flatShading: true });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uGlow = { value: glow };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGolem;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGolem = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vGolem;
        uniform vec3 uGlow;
        vec3 golemHash(vec3 p) {
          p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
          return fract(sin(p) * 43758.5453);
        }
        float golemEdge(vec3 p) {
          vec3 i = floor(p);
          vec3 f = fract(p);
          float a = 8.0;
          float b = 8.0;
          for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
            vec3 g = vec3(float(x), float(y), float(z));
            vec3 r = g + golemHash(i + g) - f;
            float d = dot(r, r);
            if (d < a) { b = a; a = d; } else if (d < b) { b = d; }
          }
          return sqrt(b) - sqrt(a);
        }`,
      )
      .replace(
        '#include <fog_fragment>',
        `#include <fog_fragment>
        vec3 gp = vGolem * 1.25 + 0.3 * sin(vGolem.yzx * 2.3);
        float hot = 0.5 + 0.5 * sin(vGolem.x * 1.3 + sin(vGolem.y * 1.7) * 1.5 + vGolem.z * 1.1);
        float width = mix(0.05, 0.15, hot * hot);
        float edge = golemEdge(gp);
        float crack = smoothstep(width, width * 0.35, edge);
        float heart = smoothstep(width * 0.45, 0.0, edge);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, uGlow * mix(vec3(0.5, 0.1, 0.06), vec3(0.8, 0.5, 0.35), heart), crack);`,
      );
  };
  return m;
};

const Colossus = ({ planet, ground, eco, reducedMotion }: { planet: Planet; ground: HeightFn; eco: EcoRef; reducedMotion?: boolean }) => {
  const camera = useThree((s) => s.camera);
  const root = useRef<THREE.Group>(null);
  const legs = useRef<(THREE.Group | null)[]>([]);
  const shins = useRef<(THREE.Group | null)[]>([]);
  const arms = useRef<(THREE.Group | null)[]>([]);
  const fores = useRef<(THREE.Group | null)[]>([]);
  const head = useRef<THREE.Group>(null);
  const mats = useMemo(() => {
    // the glow shows through the haze, so the giant reads as a silhouette with burning seams
    const glow = new THREE.MeshBasicMaterial({ color: COLOSSUS_GLOW.clone(), fog: false });
    return { stone: golemStone(glow.color), glow, core: new THREE.MeshBasicMaterial({ fog: false }) };
  }, []);
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);
  const geo = useMemo(() => golemParts(`${planet.id}:golem`), [planet.id]);
  useEffect(() => () => Object.values(geo).flat().forEach((g) => g.dispose()), [geo]);
  const rnd = useMemo(() => mulberry(seedOf(`${planet.id}:colossus`)), [planet.id]);
  const st = useRef({ a: -Math.PI / 2 - 0.55, gaze: 0, wave: 0, cool: 6, k: 0, stride: rnd() * 10 });
  const _fwd = useMemo(() => new THREE.Vector3(), []);
  const _to = useMemo(() => new THREE.Vector3(), []);

  const hail = () => {
    const s = st.current;
    s.wave = COLOSSUS_WAVE_S;
    s.cool = COLOSSUS_COOL_S;
    const g = root.current;
    if (g) callFrom(camera, 'rumble', g.position.x, g.position.y + COLOSSUS_H * 0.8, g.position.z);
  };

  useFrame(({ clock }, delta) => {
    const g = root.current;
    if (!g) return;
    const dt = reducedMotion ? 0 : Math.min(delta, 0.05);
    const t = clock.elapsedTime;
    const s = st.current;
    s.cool -= dt;
    s.wave = Math.max(0, s.wave - dt);
    s.k += ((s.wave > 0.8 ? 1 : 0) - s.k) * damp(1.1, dt);
    const k = smooth01(s.k);
    eco.current.quake = k;
    const walk = 1 - k;
    s.a += (COLOSSUS_SPEED / COLOSSUS_R) * dt * walk;
    s.stride += COLOSSUS_SPEED * dt * walk;
    const x = Math.cos(s.a) * COLOSSUS_R;
    const z = Math.sin(s.a) * COLOSSUS_R;
    // a heavy stride: one full cycle every 5 units walked
    const ph = (s.stride / 5) * Math.PI * 2;
    const yaw = Math.atan2(-Math.sin(s.a), Math.cos(s.a));
    g.position.set(x, ground(x, z) - 0.3 + Math.abs(Math.sin(ph)) * 0.25 * walk, z);
    // lurching side to side onto each foot
    g.rotation.z = Math.sin(ph) * 0.05 * walk;
    // turning a little toward the viewer while it waves
    const toYaw = Math.atan2(camera.position.x - x, camera.position.z - z);
    g.rotation.y = yaw + wrapAngle(toYaw - yaw) * 0.35 * k;
    for (let i = 0; i < 2; i += 1) {
      const sgn = i ? -1 : 1;
      const leg = legs.current[i];
      const shin = shins.current[i];
      if (leg) leg.rotation.x = Math.sin(ph) * 0.32 * sgn * walk;
      if (shin) shin.rotation.x = Math.max(0, Math.sin(ph + (i ? Math.PI : 0) + 0.6)) * 0.45 * walk;
      const arm = arms.current[i];
      if (arm) arm.rotation.x = -Math.sin(ph) * 0.28 * sgn * walk;
    }
    // the wave: the right arm swings up and out, the forearm waving overhead
    const armR = arms.current[1];
    const foreR = fores.current[1];
    if (armR) armR.rotation.z = 2.6 * k;
    if (foreR) foreR.rotation.z = (0.35 + Math.sin(t * 2.2) * 0.4) * k;
    const h = head.current;
    if (h) {
      h.rotation.y = THREE.MathUtils.clamp(wrapAngle(toYaw - g.rotation.y), -1, 1) * k;
      h.rotation.x = 0.18 * k;
    }
    mats.glow.color.copy(COLOSSUS_GLOW).multiplyScalar(1 + 0.9 * k + 0.12 * Math.sin(t * 1.3));
    mats.core.color.copy(mats.glow.color).multiply(COLOSSUS_CORE_TINT);

    // look at it and hold still: it answers
    _fwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
    _to.set(x, g.position.y + COLOSSUS_H * 0.6, z).sub(camera.position);
    const looking = _to.normalize().dot(_fwd) > COLOSSUS_GAZE_COS;
    s.gaze = looking && s.wave <= 0 ? s.gaze + dt : 0;
    if (!reducedMotion && s.gaze > COLOSSUS_GAZE_S && s.cool <= 0) hail();
  });

  const poke = (e: ThreeEvent<MouseEvent>) => {
    if (!isPoke(e)) return;
    if (st.current.wave <= 0) hail();
  };

  const S = COLOSSUS_H / 10;
  /** A lava core inside a clump: an ellipsoid that shows through the gaps between the rocks */
  const Core = ({ p, r }: { p: [number, number, number]; r: [number, number, number] }) => (
    <mesh geometry={geo.core} material={mats.core} position={p} scale={r} />
  );
  return (
    <group ref={root} scale={S}>
      <mesh geometry={geo.hips} material={mats.stone} />
      <Core p={[0, 3.3, 0]} r={[1.3, 0.45, 0.8]} />
      {/* stumpy legs, planted wide */}
      {[-1, 1].map((sx, i) => (
        <group key={sx} position={[sx * 1.75, 3.0, 0]} ref={(el) => (legs.current[i] = el)}>
          <mesh geometry={geo.thigh[i]} material={mats.stone} />
          <Core p={[0, -0.65, 0]} r={[0.5, 0.6, 0.5]} />
          <group position={[0, -1.45, 0]} ref={(el) => (shins.current[i] = el)}>
            <mesh geometry={geo.shin[i]} material={mats.stone} />
            <Core p={[0, -0.6, 0.05]} r={[0.5, 0.55, 0.5]} />
          </group>
        </group>
      ))}
      {/* the torso hunches forward over the hips */}
      <group rotation={[0.26, 0, 0]}>
        <mesh geometry={geo.torso} material={mats.stone} />
        <Core p={[0, 5.35, 0.2]} r={[1.7, 1.1, 1.25]} />
        {GOLEM_SHOULDER.map((c, i) => (
          <Core key={i} p={c} r={[0.7 * GOLEM_SIDE[i], 0.6 * GOLEM_SIDE[i], 0.7]} />
        ))}
        {/* massive arms, the fists hanging to the knees */}
        {GOLEM_SHOULDER.map((c, i) => (
          <group key={i} position={[c[0] * 1.2, c[1] - 0.2, c[2]]} ref={(el) => (arms.current[i] = el)}>
            <mesh geometry={geo.upper[i]} material={mats.stone} />
            <Core p={[0, -0.85, 0]} r={[0.5 * GOLEM_SIDE[i], 0.65, 0.5 * GOLEM_SIDE[i]]} />
            <group position={[0, -1.7, 0]} ref={(el) => (fores.current[i] = el)}>
              <mesh geometry={geo.fore[i]} material={mats.stone} />
              <Core p={[0, -1.5, 0.15]} r={[0.6 * GOLEM_SIDE[i], 1.3, 0.6 * GOLEM_SIDE[i]]} />
            </group>
          </group>
        ))}
        {/* a lump of a head sunk into the chest, eyes burning */}
        <group position={[0, 6.95, 1.75]} ref={head}>
          <mesh geometry={geo.head} material={mats.stone} />
          <Core p={[0, 0.3, 0]} r={[0.4, 0.3, 0.35]} />
          {[-1, 1].map((sx) => (
            <mesh key={sx} geometry={geo.core} material={mats.glow} position={[sx * 0.36, 0.42, 1.15]} scale={[0.17, 0.1, 0.14]} />
          ))}
        </group>
      </group>
      {/* a generous invisible target for the click */}
      <mesh position={[0, 4, 0.5]} visible={false} onClick={poke}>
        <boxGeometry args={[11.5, 8.4, 5]} />
      </mesh>
    </group>
  );
};

/**
 * Creatures chosen by planet style, fewer on touch devices. They notice the
 * viewer: walkers come over, follow and greet, birds circle a still viewer,
 * jellies drift close; each has its own call (see critterCall).
 */
const Wildlife = ({
  planet,
  ground,
  obstacles,
  isTouch,
  reducedMotion,
}: {
  planet: Planet;
  ground: HeightFn;
  /** Monument footprints (x, z) */
  obstacles: [number, number][];
  isTouch?: boolean;
  reducedMotion?: boolean;
}) => {
  const camera = useThree((s) => s.camera);
  const viewer = useRef<Viewer>({ x: NaN, z: NaN, speed: 0, still: 0 });
  const eco = useRef(makeEco());
  useFrame((_, delta) => {
    const v = viewer.current;
    const dt = Math.min(delta, 0.05);
    const c = camera.position;
    if (Number.isNaN(v.x) || dt <= 0) {
      v.x = c.x;
      v.z = c.z;
      return;
    }
    const sp = Math.hypot(c.x - v.x, c.z - v.z) / dt;
    v.speed += (Math.min(sp, 20) - v.speed) * damp(5, dt);
    v.still = v.speed < 0.3 ? v.still + dt : 0;
    v.x = c.x;
    v.z = c.z;
  });
  const f = FAUNA[planet.style];
  // fewer animals on phones, and half on the low tier (see gpuTier)
  const low = useAppStore((s) => s.quality === 'low');
  const k = low ? 0.5 : isTouch ? 0.6 : 1;
  const walkR = walkRadiusFor(planet.style);
  const skitter = useMemo(() => (f.skitter ? { ...f.skitter, count: Math.max(4, Math.round(f.skitter.count * k)) } : null), [f, k]);
  const birds = useMemo(
    () => (f.birds ? { ...f.birds, count: Math.max(3, Math.round(f.birds.count * k)) } : null),
    [f, k],
  );
  return (
    <>
      {birds && (
        <Birds planet={planet} cfg={birds} ground={ground} obstacles={obstacles} maxR={walkR} viewer={viewer} eco={eco} reducedMotion={reducedMotion} />
      )}
      {f.walkers.map((h) => (
        <Walkers
          key={`${h.kind}:${h.size ?? 1}`}
          planet={planet}
          kind={h.kind}
          count={Math.max(1, Math.round(h.count * k))}
          size={h.size}
          speedK={h.speed}
          colors={h.colors}
          maxR={walkR}
          ground={ground}
          obstacles={obstacles}
          viewer={viewer}
          eco={eco}
          reducedMotion={reducedMotion}
        />
      ))}
      {f.skitter && (
        <Skitterers
          planet={planet}
          cfg={skitter!}
          ground={ground}
          obstacles={obstacles}
          viewer={viewer}
          eco={eco}
          maxR={walkR - 1}
          reducedMotion={reducedMotion}
        />
      )}
      {f.gliders && <Gliders planet={planet} cfg={f.gliders} eco={eco} reducedMotion={reducedMotion} />}
      {f.colossus && <Colossus planet={planet} ground={ground} eco={eco} reducedMotion={reducedMotion} />}
      {f.jellies > 0 && <Jellies planet={planet} count={Math.round(f.jellies * k)} eco={eco} reducedMotion={reducedMotion} />}
    </>
  );
};

export default Wildlife;
