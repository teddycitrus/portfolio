import raw from './content.json';
import type { Beacon, ContentDocument, Planet, Vec3 } from '@/types/content';

export const content = raw as unknown as ContentDocument;

export const profile = content.profile;
export const planets: Planet[] = content.planets;

export const planetById = (id: string | null | undefined): Planet | undefined =>
  id ? planets.find((p) => p.id === id) : undefined;

export const planetByIndex = (index: number): Planet | undefined =>
  planets.find((p) => p.index === index);

export const beaconById = (
  planet: Planet | undefined,
  id: string | null | undefined,
): Beacon | undefined => (planet && id ? planet.beacons.find((b) => b.id === id) : undefined);

/* ---------- overworld layout ---------- */

/**
 * Portrait slots in index order: [ndc x, screen y fraction from top, apparent radius as a tangent].
 * A vertical zig-zag between the top bar and the bottom dock.
 */
const PORTRAIT_SLOTS: [number, number, number][] = [
  [-0.48, 0.22, 0.088],
  [0.08, 0.37, 0.1],
  [0.48, 0.51, 0.088],
  [-0.48, 0.64, 0.088],
  [0.48, 0.77, 0.088],
];

const view = { aspect: 16 / 9, fov: 60 };
const anchors = new Map<string, Vec3>();
const orderedPlanets = [...planets].sort((a, b) => a.index - b.index);
let driftScale = 1;

const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** 0 on landscape, 1 on portrait, blended between aspect 0.95 and 0.75. */
export const portraitWeight = (aspect: number): number => 1 - smoothstep(0.75, 0.95, aspect);

const rebuildLayout = () => {
  const { aspect, fov } = view;
  const tv = Math.tan((fov * Math.PI) / 360);
  const th = tv * aspect;
  const w = portraitWeight(aspect);
  // Narrower lenses push the system back so on-screen sizes match the 60-80 deg reference composition
  const refFov = 60 + 20 * clamp01((1.4 - aspect) / 0.8);
  const lens = Math.tan((refFov * Math.PI) / 360) / tv;

  // Landscape: one horizontal squeeze so the outermost planet (plus drift and glow) clears the edge
  let k = 1;
  for (const p of planets) {
    const [x, , z] = p.position;
    const u = Math.abs(x) / -z;
    const margin = (p.radius * (p.rings ? 1.7 : 1.35) + 0.9) / (Math.hypot(...p.position) * lens);
    if (u > 1e-6) k = Math.min(k, (th * 0.84 - margin) / u);
  }
  k = Math.max(k, 0.2);

  orderedPlanets.forEach((p, i) => {
    const [x, y, z] = p.position;
    const lx = x * k * lens;
    const ly = y * lens;
    const lz = z * lens;

    const [sx, fy, app] = PORTRAIT_SLOTS[Math.min(i, PORTRAIT_SLOTS.length - 1)];
    const dist = p.radius / app;
    const px = sx * th * dist;
    const py = (1 - 2 * fy) * tv * dist;

    let a = anchors.get(p.id);
    if (!a) anchors.set(p.id, (a = [0, 0, 0]));
    a[0] = lerp(lx, px, w);
    a[1] = lerp(ly, py, w);
    a[2] = lerp(lz, -dist, w);
  });
  driftScale = 1 - 0.45 * w;
  relax(tv, th, true);
};

/* Keep-out ellipses in tangent space (x/-z, y/-z): atmosphere for every planet, rings widen it horizontally. */
const _u = new Float64Array(planets.length);
const _v = new Float64Array(planets.length);
const _ax = new Float64Array(planets.length);
const _ay = new Float64Array(planets.length);

/** Pushes planets apart so no body, atmosphere or ring overlaps another, drift included. Ringed planets stay put. */
const relax = (tv: number, th: number, clampX: boolean) => {
  const n = orderedPlanets.length;
  for (let i = 0; i < n; i++) {
    const p = orderedPlanets[i];
    const a = anchors.get(p.id)!;
    const d = -a[2];
    _u[i] = a[0] / d;
    _v[i] = a[1] / d;
    _ax[i] = (p.radius * (p.rings ? 2.35 : 1.18) + 0.9 * driftScale) / d;
    _ay[i] = (p.radius * 1.18 + 0.5 * driftScale) / d;
  }
  for (let iter = 0; iter < 10; iter++) {
    let moved = false;
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const sx = (_ax[i] + _ax[j]) * 1.06;
        const sy = (_ay[i] + _ay[j]) * 1.06;
        const dx = _u[j] - _u[i];
        const dy = _v[j] - _v[i];
        const nx = dx / sx;
        const ny = dy / sy;
        const len = Math.hypot(nx, ny);
        if (len >= 1) continue;
        moved = true;
        // Separate along the normalised direction; mostly vertical if they sit on top of each other
        const ux = len > 1e-4 ? nx / len : 0;
        const uy = len > 1e-4 ? ny / len : 1;
        const push = 1 - len;
        const ri = orderedPlanets[i].rings ? 0 : orderedPlanets[j].rings ? 1 : 0.5;
        const rj = 1 - ri;
        _u[i] -= ux * push * sx * ri;
        _v[i] -= uy * push * sy * ri;
        _u[j] += ux * push * sx * rj;
        _v[j] += uy * push * sy * rj;
      }
    for (let i = 0; i < n; i++) {
      const my = tv * 0.78 - _ay[i];
      _v[i] = Math.min(Math.max(_v[i], -my), my);
      if (clampX) {
        const mx = th * 0.9 - _ax[i];
        _u[i] = Math.min(Math.max(_u[i], -mx), mx);
      }
    }
    if (!moved) break;
  }
  for (let i = 0; i < n; i++) {
    const a = anchors.get(orderedPlanets[i].id)!;
    const d = -a[2];
    a[0] = _u[i] * d;
    a[1] = _v[i] * d;
  }
};
/** Feed the viewport into the overworld layout; the telescope camera calls this as the aspect settles. */
export const setOverworldView = (aspect: number, fov: number): void => {
  if (Math.abs(aspect - view.aspect) < 1e-4 && Math.abs(fov - view.fov) < 1e-3) return;
  view.aspect = aspect;
  view.fov = fov;
  rebuildLayout();
};

rebuildLayout();

/** Current resting anchor of a planet (before drift). */
export const getOverworldAnchor = (planet: Planet): Vec3 => anchors.get(planet.id) ?? planet.position;

/**
 * Overworld placement. Planets rest on a layout anchor fitted to the viewport
 * and drift gently around it so the scene stays alive without ever leaving
 * the field of view. Renderer, hover detection, markers and the entry
 * transition all call this with the same clock time.
 */
export const getOrbitalPosition = (planet: Planet, t: number, out?: Vec3): Vec3 => {
  const [x, y, z] = getOverworldAnchor(planet);
  const phase = planet.index * 1.7;
  const res = out ?? ([0, 0, 0] as Vec3);
  res[0] = x + Math.sin(t * 0.11 + phase) * 0.9 * driftScale;
  res[1] = y + Math.sin(t * 0.17 + phase * 0.6) * 0.5 * driftScale;
  res[2] = z + Math.cos(t * 0.09 + phase) * 0.6 * driftScale;
  return res;
};

/* ---------- planet surface layout ---------- */

/** Where the player stands on arrival, facing -Z. */
export const SURFACE_SPAWN: Vec3 = [0, 1.6, 5];
export const SURFACE_HEAD_HEIGHT = 1.6;
const BEACON_ARC_RADIUS = 9;
/** Where the about planet's camp is: every one of its beacons is there */
export const OUTPOST_CAMP: Vec3 = [0, 0, -4.5];
const BEACON_ARC_SPAN = (94 * Math.PI) / 180;

/** The temple's statues stand in pairs down its aisle, facing in across it */
export const TEMPLE_AISLE_X = 3.3;
export const TEMPLE_ROW_Z = [-5.2, -10.4];
/** A statue faces this far ahead of itself on the aisle's centre line */
const TEMPLE_FACE_AHEAD = 1.8;

/**
 * Beacons are laid out on an arc around the origin, centred on -Z, so every
 * one is visible from the spawn point. Index 0 is leftmost. The temple
 * instead pairs them down its aisle, left then right, front row first.
 */
export const getBeaconPosition = (planet: Planet, beaconIndex: number): Vec3 => {
  if (planet.architecture === 'temple') {
    const row = TEMPLE_ROW_Z[Math.min(TEMPLE_ROW_Z.length - 1, Math.floor(beaconIndex / 2))];
    return [beaconIndex % 2 === 0 ? -TEMPLE_AISLE_X : TEMPLE_AISLE_X, 0, row];
  }
  // the outpost's beacons are all me, sitting at the camp
  if (planet.architecture === 'outpost') return [...OUTPOST_CAMP];
  const n = planet.beacons.length;
  const t = n === 1 ? 0.5 : beaconIndex / (n - 1);
  const angle = -BEACON_ARC_SPAN / 2 + t * BEACON_ARC_SPAN;
  return [Math.sin(angle) * BEACON_ARC_RADIUS, 0, -Math.cos(angle) * BEACON_ARC_RADIUS];
};

export const BEACON_VIEW_DISTANCE = 4.2;

/** The point a monument faces (x, z): the spawn, or the aisle in front of a temple statue. */
export const getBeaconFacing = (planet: Planet, beaconPos: Vec3): [number, number] =>
  planet.architecture === 'temple' ? [0, beaconPos[2] + TEMPLE_FACE_AHEAD] : [SURFACE_SPAWN[0], SURFACE_SPAWN[2]];

/** Standing point used when gliding to a beacon: a few units in front of it, on the side it faces. */
export const getBeaconViewPoint = (planet: Planet, beaconPos: Vec3): Vec3 => {
  const [fx, fz] = getBeaconFacing(planet, beaconPos);
  const dx = fx - beaconPos[0];
  const dz = fz - beaconPos[2];
  const len = Math.hypot(dx, dz) || 1;
  return [
    beaconPos[0] + (dx / len) * BEACON_VIEW_DISTANCE,
    SURFACE_HEAD_HEIGHT,
    beaconPos[2] + (dz / len) * BEACON_VIEW_DISTANCE,
  ];
};
