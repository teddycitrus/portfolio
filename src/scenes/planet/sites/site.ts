import type { Planet } from '@/types/content';
import { getBeaconFacing, getBeaconPosition, SURFACE_SPAWN } from '@/data/content';
import type { HeightFn } from '../Terrain';
import type { Collider } from '../PlanetCamera';

/*
 * The ground plan of a planet's site. The pillar planets stand on bare
 * terrain; the temple and the outpost add built ground (a raised floor and
 * steps, a landing pad) that the walker, the beacons and the wildlife stand
 * on, obstacles the walker goes round, and ground kept clear of plants.
 */

export interface Site {
  /** Walkable height: the terrain, or built ground where there is some */
  ground: HeightFn;
  /** Obstacles that are not beacons */
  colliders: Collider[];
  /** Extra points kept clear of plants and wildlife (beacons are always clear) */
  clearings: [number, number][];
  /** How close the walker may come to each beacon */
  collide: (index: number) => number;
}

/** Pillar monuments: the walker stops this far from the centre */
const PILLAR_COLLIDE = 1.15;

/* ---------- the temple ---------- */

export const TEMPLE = {
  /** Floor extent */
  x0: -6.4,
  x1: 6.4,
  z0: -16.2,
  z1: -1.6,
  /** Steps down from the front edge toward the spawn */
  steps: 3,
  stepRun: 0.5,
  /** The columns down each side and their spacing */
  colX: 5.7,
  colZ: [-2.4, -5.2, -7.8, -10.4, -13.0],
  colR: 0.5,
  /** The dais with the eternal flame, closing the aisle */
  daisZ: -14.4,
  daisR: 1.9,
};

/** Highest and lowest terrain under a rectangle */
const span = (H: HeightFn, x0: number, x1: number, z0: number, z1: number) => {
  let hi = -Infinity;
  let lo = Infinity;
  for (let x = x0; x <= x1 + 1e-6; x += 0.5) {
    for (let z = z0; z <= z1 + 1e-6; z += 0.5) {
      const y = H(x, z);
      hi = Math.max(hi, y);
      lo = Math.min(lo, y);
    }
  }
  return { hi, lo };
};

export interface TempleLevels {
  /** Top of the floor */
  top: number;
  /** Bottom of the foundation, below the lowest terrain under it */
  base: number;
}

export const templeLevels = (H: HeightFn): TempleLevels => {
  const { hi, lo } = span(H, TEMPLE.x0, TEMPLE.x1, TEMPLE.z0, TEMPLE.z1 + TEMPLE.steps * TEMPLE.stepRun);
  return { top: hi + 0.3, base: lo - 0.8 };
};

/** Top of step k (0 = the one against the floor), stepping down evenly to the terrain in front */
export const templeStepTop = (H: HeightFn, top: number, k: number) => {
  const front = H(0, TEMPLE.z1 + TEMPLE.steps * TEMPLE.stepRun + 0.3);
  const rise = Math.max(0.12, (top - front) / (TEMPLE.steps + 1));
  return top - rise * (k + 1);
};

const templeSite = (H: HeightFn): Site => {
  const { top } = templeLevels(H);
  const stepTops = Array.from({ length: TEMPLE.steps }, (_, k) => templeStepTop(H, top, k));
  const ground: HeightFn = (x, z) => {
    if (x < TEMPLE.x0 || x > TEMPLE.x1) return H(x, z);
    if (z >= TEMPLE.z0 && z <= TEMPLE.z1) return top;
    const k = Math.floor((z - TEMPLE.z1) / TEMPLE.stepRun);
    if (z > TEMPLE.z1 && k < TEMPLE.steps) return Math.max(H(x, z), stepTops[k]);
    return H(x, z);
  };
  const colliders: Collider[] = [];
  for (const z of TEMPLE.colZ) for (const x of [-TEMPLE.colX, TEMPLE.colX]) colliders.push([x, z, TEMPLE.colR]);
  colliders.push([0, TEMPLE.daisZ, TEMPLE.daisR + 0.3]);
  // the gate behind the dais
  colliders.push([-2.3, TEMPLE.z0 + 0.7, TEMPLE.colR], [2.3, TEMPLE.z0 + 0.7, TEMPLE.colR]);
  const clearings: [number, number][] = [];
  for (let x = TEMPLE.x0 + 1; x <= TEMPLE.x1 - 0.9; x += 3.1) {
    for (let z = TEMPLE.z1; z >= TEMPLE.z0; z -= 2.8) clearings.push([x, z]);
  }
  return { ground, colliders, clearings, collide: () => 1.2 };
};

/* ---------- the outpost ---------- */

export const PAD = { r: 1.8, x: SURFACE_SPAWN[0], z: SURFACE_SPAWN[2] };
/** Out-of-the-way kit: the comms mast and the solar array */
export const MAST = { x: -11.5, z: -12.5 };
export const SOLAR = { x: 11, z: -11.5, yaw: -0.6 };
/** The campfire sits this far in front of the hab, toward the spawn */
export const CAMPFIRE_AHEAD = 2.5;

/** Which building stands for which beacon */
export type OutpostKind = 'hab' | 'observatory' | 'workshop';
export const outpostKind = (id: string, index: number): OutpostKind =>
  /hello|home/.test(id) ? 'hab' : /educ|school/.test(id) ? 'observatory' : /focus|work/.test(id) ? 'workshop' : (['hab', 'observatory', 'workshop'] as const)[index % 3];

const OUTPOST_COLLIDE: Record<OutpostKind, number> = { hab: 2.05, observatory: 1.6, workshop: 1.85 };

export const padTop = (H: HeightFn) => span(H, PAD.x - PAD.r, PAD.x + PAD.r, PAD.z - PAD.r, PAD.z + PAD.r).hi + 0.12;

/** Where the campfire burns, in front of the hab */
export const campfireAt = (planet: Planet): [number, number] | null => {
  const i = planet.beacons.findIndex((b, k) => outpostKind(b.id, k) === 'hab');
  if (i < 0) return null;
  const p = getBeaconPosition(planet, i);
  const [fx, fz] = getBeaconFacing(planet, p);
  const dx = fx - p[0];
  const dz = fz - p[2];
  const d = Math.hypot(dx, dz) || 1;
  return [p[0] + (dx / d) * CAMPFIRE_AHEAD, p[2] + (dz / d) * CAMPFIRE_AHEAD];
};

const outpostSite = (planet: Planet, H: HeightFn): Site => {
  const top = padTop(H);
  const ground: HeightFn = (x, z) => {
    const y = H(x, z);
    return Math.hypot(x - PAD.x, z - PAD.z) < PAD.r ? Math.max(y, top) : y;
  };
  const colliders: Collider[] = [
    [MAST.x, MAST.z, 0.7],
    [SOLAR.x, SOLAR.z, 2.2],
  ];
  const fire = campfireAt(planet);
  if (fire) colliders.push([fire[0], fire[1], 0.65]);
  const clearings: [number, number][] = [
    [MAST.x, MAST.z],
    [SOLAR.x, SOLAR.z],
  ];
  if (fire) clearings.push(fire);
  const kinds = planet.beacons.map((b, i) => outpostKind(b.id, i));
  return { ground, colliders, clearings, collide: (i) => OUTPOST_COLLIDE[kinds[i] ?? 'hab'] };
};

export const siteFor = (planet: Planet, H: HeightFn): Site => {
  if (planet.architecture === 'temple') return templeSite(H);
  if (planet.architecture === 'outpost') return outpostSite(planet, H);
  return { ground: H, colliders: [], clearings: [], collide: () => PILLAR_COLLIDE };
};
