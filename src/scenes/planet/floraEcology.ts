import * as THREE from 'three';
import type { Planet, PlanetStyle } from '@/types/content';
import { terrainPalette } from './Terrain';
import type { FloraEnv } from './floraShader';
import { floraMaterial } from './floraShader';
import {
  barrel,
  basaltCluster,
  broadleaf,
  crownPlant,
  cushion,
  druse,
  fern,
  kelp,
  lanterns,
  rock,
  rosette,
  shrub,
  spruce,
  starcup,
  streamer,
  tuft,
  ventTubes,
} from './floraGeometry';

export interface Layer {
  /** Name other layers anchor to */
  id?: string;
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
  count: number;
  minR: number;
  maxR: number;
  scale: [number, number];
  /** extra clearance from beacons beyond the base 2.2 */
  clear: number;
  colorA: THREE.Color;
  colorB: THREE.Color;
  /** 0 = uniform, 1 = strongly clumped */
  clump: number;
  shadow: boolean;
  /** sink into the ground by this fraction of scale (for rocks on slopes) */
  sink: number;
  tiltJitter: number;
  /** Also scatter this many in the spawn foreground (bottom corners of the opening view) */
  fg?: number;
  fgScale?: [number, number];
  foreground?: boolean;
  /** May stand in shallow water along the shore */
  wet?: boolean;
  /** Grow around the instances of this earlier layer */
  anchor?: string;
  /** Share of instances placed around an anchor rather than by open-ground noise */
  anchorShare?: number;
  /** Distance from the anchor, in multiples of its scale */
  anchorRing?: [number, number];
  /** 0..1, how strongly anchored growth keeps to the downwind side */
  lee?: number;
  /** 0..1, how far the plant tilts with the slope */
  follow?: number;
  /** Refuse ground steeper than this rise over run */
  maxSlope?: number;
  /** Keep the full count on phones (shelter that others anchor to) */
  keep?: boolean;
}

/** Prevailing wind per style, a unit vector on xz */
export const WIND: Record<PlanetStyle, [number, number]> = {
  rocky: [0.86, 0.51],
  oceanic: [-0.77, 0.64],
  forested: [0.6, 0.8],
  'gas-giant': [0.5, -0.87],
  molten: [-0.42, -0.91],
};

const C = (hex: string | THREE.Color, mix?: string | THREE.Color, t = 0) => {
  const c = new THREE.Color(hex);
  return mix ? c.lerp(new THREE.Color(mix), t) : c;
};

const stone = (p: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, flatShading: true, ...p });

/* instance colour only varies a species; its real colours are in the vertices */
const VARY_A = new THREE.Color('#ffffff');
const VARY_B = new THREE.Color('#c9c2b8');

export const buildLayers = (planet: Planet, env: FloraEnv): Layer[] => {
  const pal = terrainPalette(planet);
  const accent = new THREE.Color(planet.accent);
  const [p0, p1, p2] = planet.palette;
  const base = { clear: 0, clump: 0.5, shadow: false, sink: 0, tiltJitter: 0.15 };
  const plant = { ...base, colorA: VARY_A, colorB: VARY_B, follow: 0.5, maxSlope: 0.9 };
  const cover = { ...plant, follow: 1, sink: 0, clump: 0.7, tiltJitter: 0.04 };

  const byStyle: Record<PlanetStyle, () => Layer[]> = {
    /*
     * Dusk on a dry rust plain. Water is rare and the wind never stops, so
     * nothing stands tall in the open: life tucks in behind the boulders,
     * stores what it can and opens only once the heat has gone.
     */
    rocky: () => [
      {
        ...base,
        id: 'boulder',
        keep: true,
        geo: rock(1, 0.65, 7),
        mat: stone(),
        count: 280,
        fg: 7,
        fgScale: [0.2, 0.5],
        minR: 5,
        maxR: 80,
        scale: [0.25, 2.2],
        clear: 1,
        colorA: C(pal.rock, p1, 0.12),
        colorB: C(pal.low, p2, 0.3),
        clump: 0.75,
        shadow: true,
        sink: 0.3,
      },
      {
        ...base,
        geo: rock(0, 0.5, 13),
        mat: stone(),
        count: 360,
        minR: 1.5,
        maxR: 40,
        scale: [0.05, 0.18],
        colorA: C(pal.high),
        colorB: C(pal.rock),
        sink: 0.2,
      },
      {
        // dry bunchgrass, combed by the wind, in the lee of stones and thinly elsewhere
        ...plant,
        geo: tuft({
          seed: 4,
          blades: 7,
          height: 0.46,
          width: 0.016,
          lean: 0.5,
          droop: 0.3,
          root: C('#4a3a2a', p2, 0.2),
          tip: C('#b39a72', p1, 0.2),
          head: { color: C('#c9b08a', p1, 0.3), size: 0.012 },
        }),
        mat: floraMaterial({ roughness: 1 }, env, { lean: 0.08, gust: 0.14, flutter: 0.025, shy: 0.13, shyRadius: 1.5 }),
        count: 620,
        fg: 14,
        fgScale: [1.0, 1.6],
        minR: 2,
        maxR: 50,
        scale: [0.7, 1.5],
        clump: 0.8,
        anchor: 'boulder',
        anchorShare: 0.5,
        anchorRing: [1.0, 2.6],
        lee: 0.65,
      },
      {
        // ribbed water stores, crouched behind rocks; the crown opens after sunset
        ...plant,
        geo: barrel(C('#5e6246', p0, 0.14), C('#7a7656', p1, 0.14), C('#fbe7c9', p1, 0.2), C(p1, p0, 0.28)),
        mat: floraMaterial({ roughness: 0.8 }, env, {
          glow: accent.clone().multiplyScalar(0.55),
          glowBase: 0.6,
          glowPulse: 0.4,
          glowSpeed: 0.3,
          glowOpen: 1,
          bloom: [0.35, 0.3, 0.45],
          shyRadius: 3.5,
        }),
        count: 130,
        minR: 5,
        maxR: 55,
        scale: [0.45, 1.25],
        clump: 0.85,
        follow: 0.3,
        anchor: 'boulder',
        anchorShare: 0.75,
        anchorRing: [1.0, 1.9],
        lee: 0.8,
      },
      {
        // stiff rosettes throw up one spike; its seed heads hold the last light
        ...plant,
        geo: rosette(21, C('#6e6c52', p0, 0.1), C('#a48c62', p0, 0.3), C('#7a5c3e', p2, 0.1), C(p1, p0, 0.3)),
        mat: floraMaterial({ roughness: 0.85 }, env, {
          lean: 0.02,
          gust: 0.07,
          flutter: 0.012,
          glow: accent.clone().multiplyScalar(0.55),
          glowBase: 0.5,
          glowPulse: 0.25,
          glowSpeed: 0.25,
        }),
        count: 60,
        minR: 10,
        maxR: 60,
        scale: [0.6, 1.3],
        clear: 1,
        clump: 0.7,
        follow: 0.3,
        anchor: 'boulder',
        anchorShare: 0.5,
        anchorRing: [1.4, 3.0],
        lee: 0.5,
      },
      {
        // low thorny scrub, branching tight against the stones
        ...plant,
        geo: shrub({
          seed: 8,
          bark: C('#3e2c20', p2, 0.2),
          leaf: C('#7c7048', p0, 0.1),
          leafTip: C('#b49a60', p1, 0.15),
          height: 0.9,
          depth: 3,
          leafLen: 0.11,
          leafWid: 0.018,
          leaves: 2,
        }),
        mat: floraMaterial({ roughness: 0.95 }, env, { lean: 0.02, gust: 0.05, flutter: 0.01, shy: 0.05 }),
        count: 44,
        minR: 8,
        maxR: 60,
        scale: [0.5, 1.2],
        clear: 0.5,
        clump: 0.8,
        anchor: 'boulder',
        anchorShare: 0.8,
        anchorRing: [1.2, 2.2],
        lee: 0.7,
      },
      {
        // crust lichen, the first thing to colonise a shaded stone foot
        ...cover,
        geo: cushion(5, C('#a66a3a', p0, 0.2), C('#7a6a4e', pal.low, 0.3), 7, 0.1),
        mat: floraMaterial({ roughness: 1 }, env, {}),
        count: 340,
        minR: 3,
        maxR: 48,
        scale: [0.2, 0.75],
        sink: 0.1,
        anchor: 'boulder',
        anchorShare: 0.75,
        anchorRing: [0.9, 1.8],
      },
    ],

    /*
     * A floating mesa above the cloud deck, permanent night, ringlight only.
     * With no sun everything feeds on the updraft and on what it can store,
     * so bodies are glassy and lit from within, and signals pass between
     * neighbours like traffic through a network.
     */
    'gas-giant': () => [
      {
        ...plant,
        id: 'druse',
        keep: true,
        geo: druse(31, C(p2, p0, 0.45), C(p2, p0, 0.68), C(p0, p1, 0.35)),
        mat: floraMaterial({ flatShading: true, roughness: 0.28, metalness: 0.1 }, env, {
          glow: accent.clone().multiplyScalar(1.1),
          glowBase: 0.5,
          glowPulse: 0.6,
          glowSpeed: 0.34,
          glowWave: 0.22,
          glowClimb: 1.4,
        }),
        count: 210,
        fg: 5,
        fgScale: [0.22, 0.42],
        minR: 6,
        maxR: 70,
        scale: [0.4, 1.6],
        clear: 1,
        colorA: VARY_A,
        colorB: C('#d7c6d6'),
        clump: 0.85,
        shadow: true,
        sink: 0.05,
        follow: 0.3,
        maxSlope: 2,
      },
      {
        // glass hairs, a bead of light on each tip
        ...plant,
        geo: tuft({
          seed: 6,
          blades: 4,
          height: 0.34,
          width: 0.008,
          lean: 0.28,
          droop: 0.15,
          root: C(pal.low, p2, 0.4),
          tip: C(pal.low, p1, 0.55),
          head: { color: C(p1, p0, 0.2), size: 0.016, glow: 1 },
        }),
        mat: floraMaterial({ roughness: 0.5 }, env, {
          gust: 0.11,
          flutter: 0.02,
          shy: 0.12,
          shyRadius: 1.4,
          glow: accent.clone().multiplyScalar(0.8),
          glowBase: 0.45,
          glowPulse: 0.5,
          glowSpeed: 0.42,
          glowWave: 0.28,
        }),
        count: 650,
        fg: 14,
        fgScale: [1.0, 1.5],
        minR: 2,
        maxR: 45,
        scale: [0.7, 1.4],
        clump: 0.75,
        anchor: 'druse',
        anchorShare: 0.4,
        anchorRing: [0.9, 3.2],
      },
      {
        // bell fungi shelter at the foot of crystal, gills lit from beneath
        ...plant,
        geo: lanterns(14, C('#b08ca0', p1, 0.2), C(p0, p2, 0.32), C(p1, p0, 0.15)),
        mat: floraMaterial({ roughness: 0.65 }, env, {
          gust: 0.01,
          glow: accent.clone().multiplyScalar(0.62),
          glowBase: 0.55,
          glowPulse: 0.4,
          glowSpeed: 0.22,
          glowWave: 0.15,
        }),
        count: 90,
        minR: 5,
        maxR: 45,
        scale: [0.6, 1.5],
        clump: 0.9,
        follow: 0.8,
        anchor: 'druse',
        anchorShare: 0.85,
        anchorRing: [0.5, 1.5],
      },
      {
        // streamers line the rim and ride the updraft out over the drop
        ...plant,
        geo: streamer(19, C(p0, p2, 0.4), C(p1, p0, 0.3)),
        mat: floraMaterial({ roughness: 0.7 }, env, {
          lean: 0.34,
          gust: 0.32,
          flutter: 0.04,
          radial: 1,
          glow: accent.clone().multiplyScalar(0.3),
          glowBase: 0.45,
          glowPulse: 0.4,
          glowSpeed: 0.3,
          glowWave: 0.12,
          glowClimb: 1.2,
        }),
        count: 70,
        minR: 18.5,
        maxR: 25,
        scale: [0.7, 1.4],
        clear: 1,
        clump: 0.2,
        follow: 0.3,
        maxSlope: 3,
      },
      {
        // plum moss, thickest where the crystal gives way to bare ground
        ...cover,
        geo: cushion(9, C(pal.low, p0, 0.28), C(pal.low, p2, 0.32), 7, 0.1),
        mat: floraMaterial({ roughness: 1 }, env, {}),
        count: 300,
        minR: 3,
        maxR: 45,
        scale: [0.25, 0.85],
        sink: 0.1,
        anchor: 'druse',
        anchorShare: 0.8,
        anchorRing: [0.9, 2.6],
      },
      {
        // pale stars that open as something warm comes near
        ...plant,
        geo: starcup(12, C(pal.low, p1, 0.3), C(p1, '#ffffff', 0.15), C(p1, p0, 0.28)),
        mat: floraMaterial({ roughness: 0.6 }, env, {
          gust: 0.09,
          flutter: 0.015,
          glow: accent.clone().multiplyScalar(0.6),
          glowBase: 0.85,
          glowPulse: 0.15,
          glowSpeed: 0.4,
          glowOpen: 1,
          bloom: [0.08, 0.32, 0.6],
          shyRadius: 3.2,
        }),
        count: 110,
        minR: 3.5,
        maxR: 40,
        scale: [0.8, 1.5],
        clump: 0.9,
      },
      {
        ...base,
        geo: rock(0, 0.55, 17),
        mat: stone(),
        count: 200,
        minR: 3,
        maxR: 55,
        scale: [0.08, 0.5],
        colorA: C(pal.rock),
        colorB: C(pal.low),
        sink: 0.25,
      },
    ],

    /*
     * Basalt and slow fire at dawn, around a temple of gold. Leaves here are
     * small and gilded to throw heat back, trunks are armoured, and colonies
     * cluster on the vents, drawing warmth up with a slow pulse.
     */
    molten: () => [
      {
        ...base,
        id: 'basalt',
        keep: true,
        geo: basaltCluster(),
        mat: stone({ roughness: 0.8 }),
        count: 55,
        minR: 15,
        maxR: 70,
        scale: [0.6, 1.3],
        clear: 1.5,
        colorA: C('#2e2824', p2, 0.25),
        colorB: C('#40362e', p0, 0.12),
        clump: 0.9,
        shadow: true,
        sink: 0.2,
        tiltJitter: 0.1,
      },
      {
        // low lava-rock outcrops, the dominant silhouette
        ...base,
        id: 'outcrop',
        keep: true,
        geo: rock(1, 0.5, 29),
        mat: stone(),
        count: 110,
        fg: 7,
        fgScale: [0.22, 0.5],
        minR: 9,
        maxR: 75,
        scale: [0.4, 2.0],
        clear: 1,
        colorA: C('#3a2e26', p2, 0.2),
        colorB: C('#5a4636', p0, 0.15),
        clump: 0.8,
        shadow: true,
        sink: 0.3,
      },
      {
        ...base,
        geo: rock(0, 0.5, 21),
        mat: stone(),
        count: 320,
        minR: 1.5,
        maxR: 45,
        scale: [0.06, 0.3],
        colorA: C(pal.rock),
        colorB: C(pal.low, p1, 0.08),
        sink: 0.2,
      },
      {
        // armoured cycads, fronds edged with gold that warms toward the tips
        ...plant,
        geo: crownPlant(41, {
          height: 1.5,
          bend: 0.05,
          trunk: C('#231a14', p2, 0.2),
          trunkTop: C('#3a2a1c', p0, 0.1),
          frond: C('#3a2c1e', p0, 0.14),
          frondTip: C(p0, p1, 0.2),
          fronds: 9,
          frondLen: 1.1,
          frondDroop: 0.62,
          trunkR: 0.15,
          glow: 0.8,
        }),
        mat: floraMaterial({ roughness: 0.55, metalness: 0.35 }, env, {
          gust: 0.05,
          flutter: 0.008,
          glow: C(accent, '#ff8a3a', 0.45).multiplyScalar(0.34),
          glowBase: 0.4,
          glowPulse: 0.55,
          glowSpeed: 0.28,
          glowWave: 0.16,
        }),
        count: 44,
        minR: 15,
        maxR: 60,
        scale: [0.7, 1.5],
        clear: 2,
        clump: 0.7,
        follow: 0.4,
        tiltJitter: 0.08,
      },
      {
        // mineral tube colonies crowd the vents; warmth climbs each pipe in a slow breath
        ...plant,
        id: 'vents',
        geo: ventTubes(47, C('#2a201a', p2, 0.3), C('#6a4422', p0, 0.3)),
        mat: floraMaterial({ roughness: 0.78 }, env, {
          glow: C('#ff8a3a', accent, 0.3).multiplyScalar(0.95),
          glowBase: 0.2,
          glowPulse: 0.8,
          glowSpeed: 0.5,
          glowClimb: 3,
          glowWave: 0.1,
        }),
        count: 70,
        minR: 7,
        maxR: 55,
        scale: [0.5, 1.4],
        clear: 0.5,
        clump: 0.9,
        follow: 0.6,
        anchor: 'outcrop',
        anchorShare: 0.7,
        anchorRing: [1.0, 2.0],
      },
      {
        // laurel shrubs with gilded leaves: small, tough, a little like a crown
        ...plant,
        geo: shrub({
          seed: 52,
          bark: C('#2a2018', p2, 0.2),
          leaf: C('#4a3d22', p0, 0.2),
          leafTip: C(p0, p1, 0.3),
          height: 0.95,
          depth: 2,
          leafLen: 0.16,
          leafWid: 0.032,
          leaves: 6,
          tipGlow: 0.3,
        }),
        mat: floraMaterial({ roughness: 0.42, metalness: 0.5 }, env, {
          gust: 0.05,
          flutter: 0.012,
          shy: 0.05,
          glow: C(accent, p0, 0.3).multiplyScalar(0.34),
          glowBase: 0.5,
          glowPulse: 0.5,
          glowSpeed: 0.2,
          glowWave: 0.1,
        }),
        count: 52,
        minR: 6,
        maxR: 50,
        scale: [0.55, 1.2],
        clear: 0.5,
        clump: 0.8,
        anchor: 'outcrop',
        anchorShare: 0.55,
        anchorRing: [1.1, 2.3],
        lee: 0.5,
      },
      {
        // black wire grass, every tip a held ember
        ...plant,
        geo: tuft({
          seed: 11,
          blades: 5,
          height: 0.3,
          width: 0.012,
          lean: 0.3,
          droop: 0.12,
          root: C('#120d0a', p2, 0.2),
          tip: C('#3e2c1c', p0, 0.3),
          tipGlow: 1,
        }),
        mat: floraMaterial({ roughness: 0.9 }, env, {
          gust: 0.05,
          flutter: 0.012,
          shy: 0.09,
          shyRadius: 1.3,
          glow: C('#ff8a3a', accent, 0.25).multiplyScalar(0.85),
          glowBase: 0.25,
          glowPulse: 0.7,
          glowSpeed: 0.33,
          glowWave: 0.2,
        }),
        count: 420,
        fg: 12,
        fgScale: [0.9, 1.4],
        minR: 2.5,
        maxR: 45,
        scale: [0.8, 1.4],
        clump: 0.85,
        anchor: 'vents',
        anchorShare: 0.55,
        anchorRing: [1.0, 3.2],
      },
      {
        // ember moss: a dull crust with coal-red hearts where it has settled
        ...cover,
        geo: cushion(16, C('#3a2316', p0, 0.15), C('#1a1410', pal.low, 0.4), 7, 0.1, 1),
        mat: floraMaterial({ roughness: 1 }, env, {
          glow: C('#ff7a2a', accent, 0.15).multiplyScalar(0.55),
          glowBase: 0.15,
          glowPulse: 0.8,
          glowSpeed: 0.27,
          glowWave: 0.24,
        }),
        count: 280,
        minR: 3,
        maxR: 45,
        scale: [0.2, 0.7],
        sink: 0.1,
        anchor: 'vents',
        anchorShare: 0.65,
        anchorRing: [0.9, 2.6],
      },
    ],

    /*
     * Temperate forest: light is what is fought over, so the canopy goes high,
     * and everything else lives in what filters through it.
     */
    forested: () => [
      {
        ...plant,
        id: 'canopy',
        keep: true,
        geo: spruce(C('#3a2c22'), C('#24402e', p0, 0.2), C('#3f6244', p2, 0.15)),
        mat: floraMaterial({ flatShading: true, roughness: 0.85 }, env, { gust: 0.02, flutter: 0.004 }),
        count: 110,
        minR: 17,
        maxR: 75,
        scale: [1.0, 2.2],
        clear: 2,
        colorA: VARY_A,
        colorB: C('#b6c0b2'),
        clump: 0.8,
        shadow: true,
        tiltJitter: 0.05,
        follow: 0.15,
      },
      {
        ...plant,
        id: 'canopy2',
        keep: true,
        geo: broadleaf(23, C('#44342a'), C('#2c4a30', p0, 0.2), C('#5c7a44', p1, 0.15)),
        mat: floraMaterial({ flatShading: true, roughness: 0.9 }, env, { gust: 0.05, flutter: 0.008 }),
        count: 60,
        minR: 18,
        maxR: 70,
        scale: [1.0, 2.0],
        clear: 2,
        colorA: VARY_A,
        colorB: C('#c0c8b0'),
        clump: 0.8,
        shadow: true,
        tiltJitter: 0.05,
        follow: 0.15,
      },
      {
        // ferns fill the shade under the trees
        ...plant,
        geo: fern(27, C('#2e4a2c', p0, 0.15), C('#6f8a4e', p1, 0.15)),
        mat: floraMaterial({ roughness: 1 }, env, { gust: 0.08, flutter: 0.015, shy: 0.1, shyRadius: 1.5 }),
        count: 380,
        fg: 8,
        fgScale: [0.8, 1.3],
        minR: 4,
        maxR: 70,
        scale: [0.6, 1.4],
        clump: 0.8,
        anchor: 'canopy',
        anchorShare: 0.75,
        anchorRing: [0.5, 2.0],
      },
      {
        // grass takes the clearings where the canopy lets the sun in
        ...plant,
        geo: tuft({
          seed: 1,
          blades: 7,
          height: 0.55,
          width: 0.03,
          lean: 0.28,
          droop: 0.2,
          root: C(pal.low, '#3c5230', 0.6),
          tip: C('#7f9a58', p1, 0.12),
        }),
        mat: floraMaterial({ roughness: 1 }, env, { gust: 0.14, flutter: 0.02, shy: 0.14, shyRadius: 1.5 }),
        count: 1500,
        fg: 16,
        fgScale: [1.0, 1.5],
        minR: 2,
        maxR: 55,
        scale: [0.7, 1.3],
        clump: 0.7,
      },
      {
        // shade fungi at the foot of the trees
        ...plant,
        geo: lanterns(36, C('#c8bea6'), C('#8a5a3c', p0, 0.2), C('#d8c8a0'), 3),
        mat: floraMaterial({ roughness: 0.8 }, env, {
          glow: C('#d8c890', accent, 0.2).multiplyScalar(0.12),
          glowBase: 1,
        }),
        count: 90,
        minR: 12,
        maxR: 70,
        scale: [0.5, 1.2],
        clump: 0.8,
        follow: 0.8,
        anchor: 'canopy2',
        anchorShare: 0.85,
        anchorRing: [0.4, 1.2],
      },
      {
        // moss on the shaded ground
        ...cover,
        geo: cushion(44, C('#3e5a30', p0, 0.2), C('#2a3a22', pal.low, 0.4), 7, 0.1),
        mat: floraMaterial({ roughness: 1 }, env, {}),
        count: 260,
        minR: 8,
        maxR: 70,
        scale: [0.3, 1.0],
        sink: 0.1,
        anchor: 'canopy',
        anchorShare: 0.8,
        anchorRing: [0.5, 2.4],
      },
      {
        // low flowers open as evening comes on, kept to the sunny edges
        ...plant,
        geo: starcup(34, C('#3c5a2c'), C('#fff0c0', p1, 0.2), C('#d8c4e8', p1, 0.3), 0.36, 6),
        mat: floraMaterial({ roughness: 0.7 }, env, {
          gust: 0.08,
          flutter: 0.012,
          glow: accent.clone().multiplyScalar(0.18),
          glowBase: 0.6,
          glowOpen: 1,
          bloom: [0.35, 0.3, 0.4],
          shyRadius: 3,
        }),
        count: 170,
        minR: 3.5,
        maxR: 40,
        scale: [0.8, 1.4],
        clump: 0.9,
      },
      {
        ...base,
        geo: rock(0, 0.6, 3),
        mat: stone(),
        count: 90,
        fg: 7,
        fgScale: [0.2, 0.45],
        minR: 5,
        maxR: 50,
        scale: [0.15, 0.6],
        colorA: C(pal.rock, '#7a8070', 0.4),
        colorB: C(pal.rock),
        shadow: true,
        sink: 0.25,
      },
    ],

    /*
     * A small island in constant onshore wind and salt spray. Trees grow
     * trained downwind, grass holds the dunes, and whatever lives at the
     * tideline lies flat and lets the surge go over it.
     */
    oceanic: () => [
      {
        ...base,
        id: 'shore',
        keep: true,
        geo: rock(1, 0.7, 5),
        mat: stone(),
        count: 70,
        fg: 6,
        fgScale: [0.22, 0.5],
        minR: 14,
        maxR: 34,
        wet: true,
        scale: [0.6, 2.4],
        clear: 1.5,
        colorA: C(pal.rock, '#a8a69c', 0.6),
        colorB: C(pal.rock),
        shadow: true,
        sink: 0.3,
      },
      {
        ...base,
        geo: rock(0, 0.45, 9),
        mat: stone(),
        count: 500,
        minR: 1.5,
        maxR: 40,
        scale: [0.05, 0.16],
        colorA: C('#c8c4b8', p1, 0.15),
        colorB: C('#6c7478', p2, 0.2),
        clump: 0.4,
        sink: 0.2,
      },
      {
        // marram holds the dunes
        ...plant,
        geo: tuft({
          seed: 2,
          blades: 5,
          height: 1.1,
          width: 0.018,
          lean: 0.34,
          droop: 0.18,
          root: C('#5e7a52', p0, 0.1),
          tip: C('#a8aa7a', p1, 0.1),
          segs: 3,
        }),
        mat: floraMaterial({ roughness: 1 }, env, { lean: 0.12, gust: 0.2, flutter: 0.04, shy: 0.16, shyRadius: 1.5 }),
        count: 950,
        fg: 12,
        fgScale: [0.7, 1.1],
        minR: 3,
        maxR: 30,
        scale: [0.6, 1.25],
        clump: 0.85,
      },
      {
        // palms trained downwind by the constant blow
        ...plant,
        id: 'palm',
        geo: crownPlant(61, {
          height: 3.2,
          bend: 0.28,
          trunk: C('#6a5c48', p2, 0.1),
          trunkTop: C('#8a7a5e', p0, 0.1),
          frond: C('#4a6a44', p0, 0.2),
          frondTip: C('#8a9c5c', p1, 0.2),
          fronds: 10,
          frondLen: 1.5,
          frondDroop: 0.85,
          trunkR: 0.12,
        }),
        mat: floraMaterial({ roughness: 0.8 }, env, { lean: 0.16, gust: 0.18, flutter: 0.02 }),
        count: 48,
        minR: 12,
        maxR: 26,
        scale: [0.7, 1.35],
        clear: 2,
        clump: 0.8,
        follow: 0.25,
        tiltJitter: 0.05,
      },
      {
        // salt-tolerant cushions that creep along the upper shore
        ...cover,
        geo: cushion(70, C('#a87a8c', p1, 0.2), C('#6a7a5a', pal.low, 0.3), 7, 0.13),
        mat: floraMaterial({ roughness: 1 }, env, {}),
        count: 220,
        minR: 14,
        maxR: 30,
        scale: [0.3, 0.9],
        sink: 0.05,
        clump: 0.75,
        anchor: 'shore',
        anchorShare: 0.7,
        anchorRing: [1.0, 2.4],
      },
      {
        // low succulent mats under the palms
        ...cover,
        geo: fern(72, C('#5e7a4e', p0, 0.1), C('#9aa86a', p1, 0.1), 7, 0.55),
        mat: floraMaterial({ roughness: 0.95 }, env, { gust: 0.08, flutter: 0.02, shy: 0.08, shyRadius: 1.3 }),
        count: 200,
        minR: 8,
        maxR: 28,
        scale: [0.6, 1.2],
        clump: 0.85,
        anchor: 'palm',
        anchorShare: 0.7,
        anchorRing: [0.6, 2.0],
      },
      {
        // kelp in the shallows, moving with the swell
        ...plant,
        geo: kelp(80, C('#2e4a42', p2, 0.2), C('#6a8a5e', p1, 0.1)),
        mat: floraMaterial({ roughness: 0.75 }, env, { gust: 0.18, flutter: 0.06 }),
        count: 110,
        minR: 20,
        maxR: 34,
        wet: true,
        scale: [0.7, 1.4],
        clump: 0.8,
        follow: 0.2,
        maxSlope: 2,
      },
    ],
  };

  return byStyle[planet.style]().flatMap((l) =>
    l.fg
      ? [l, { ...l, id: undefined, count: l.fg, fg: undefined, foreground: true, clump: 0, scale: l.fgScale ?? l.scale, anchor: undefined }]
      : [l],
  );
};
