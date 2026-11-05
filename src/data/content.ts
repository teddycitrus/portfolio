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

/** Camera yaw used by the intro composition on landscape screens (looks left, planets shift right). */
const INTRO_YAW = 0.35;

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

const view = { aspect: 16 / 9, fov: 60, focus: 1 };
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

/** Yaw offset the telescope applies at focus 0 (intro) for the current aspect. */
export const getIntroYaw = (): number => INTRO_YAW * (1 - portraitWeight(view.aspect));

const rebuildLayout = () => {
  const { aspect, fov, focus } = view;
  const tv = Math.tan((fov * Math.PI) / 360);
  const th = tv * aspect;
  const w = portraitWeight(aspect);
  const yaw = INTRO_YAW * (1 - w);

  // Landscape: one horizontal squeeze so the outermost planet (plus drift and glow) clears the edge
  let k = 1;
  for (const p of planets) {
    const [x, , z] = p.position;
    const u = Math.abs(x) / -z;
    const margin = (p.radius * (p.rings ? 1.7 : 1.35) + 0.9) / Math.hypot(...p.position);
    if (u > 1e-6) k = Math.min(k, (th * 0.84 - margin) / u);
  }
  k = Math.max(k, 0.2);

  orderedPlanets.forEach((p, i) => {
    const [x, y, z] = p.position;
    const depth = -z;
    // Overworld angle, and the intro angle that lands it in the right part of the frame once the camera yaws
    const uo = (x * k) / depth;
    const ndcIntro = 0.38 + 0.54 * (uo / th);
    const phi = lerp(Math.atan(ndcIntro * th) - yaw, Math.atan(uo), focus);
    // Intro pushes the system back (smaller on screen) and opens it vertically so the packed arc does not overlap
    const back = lerp(1.35, 1, focus);
    const lx = Math.tan(phi) * depth * back;
    const ly = y * lerp(1.6, 1, focus) * back;
    const lz = z * back;

    const [sx, fy, app] = PORTRAIT_SLOTS[Math.min(i, PORTRAIT_SLOTS.length - 1)];
    // Intro on portrait: same zig-zag packed into the upper half, a touch smaller
    const f = lerp(0.1 + (fy - 0.22) * 0.62, fy, focus);
    const dist = (p.radius / app) * lerp(1.2, 1, focus);
    const px = sx * th * dist;
    const py = (1 - 2 * f) * tv * dist;

    let a = anchors.get(p.id);
    if (!a) anchors.set(p.id, (a = [0, 0, 0]));
    a[0] = lerp(lx, px, w);
    a[1] = lerp(ly, py, w);
    a[2] = lerp(lz, -dist, w);
  });
  driftScale = 1 - 0.45 * w;
  relax(tv, th, focus >= 0.999 || w > 0.5);
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
/**
 * Feed the viewport into the overworld layout. focus is 0 for the intro
 * composition and 1 for the centred overworld; the telescope camera eases it.
 */
export const setOverworldView = (aspect: number, fov: number, focus = view.focus): void => {
  if (
    Math.abs(aspect - view.aspect) < 1e-4 &&
    Math.abs(fov - view.fov) < 1e-3 &&
    Math.abs(focus - view.focus) < 1e-4
  )
    return;
  view.aspect = aspect;
  view.fov = fov;
  view.focus = focus;
  rebuildLayout();
};

rebuildLayout();

/** Aspect-only convenience wrapper. */
export const setOverworldAspect = (aspect: number, fov = view.fov): void => setOverworldView(aspect, fov);

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
const BEACON_ARC_SPAN = (94 * Math.PI) / 180;

/**
 * Beacons are laid out on an arc around the origin, centred on -Z, so every
 * one is visible from the spawn point. Index 0 is leftmost.
 */
export const getBeaconPosition = (planet: Planet, beaconIndex: number): Vec3 => {
  const n = planet.beacons.length;
  const t = n === 1 ? 0.5 : beaconIndex / (n - 1);
  const angle = -BEACON_ARC_SPAN / 2 + t * BEACON_ARC_SPAN;
  return [Math.sin(angle) * BEACON_ARC_RADIUS, 0, -Math.cos(angle) * BEACON_ARC_RADIUS];
};

export const getBeaconPositionById = (planet: Planet, beaconId: string): Vec3 | undefined => {
  const i = planet.beacons.findIndex((b) => b.id === beaconId);
  return i === -1 ? undefined : getBeaconPosition(planet, i);
};

export const BEACON_VIEW_DISTANCE = 4.2;

/** Standing point used when gliding to a beacon: a few units in front of it, on the spawn side. */
export const getBeaconViewPoint = (beaconPos: Vec3): Vec3 => {
  const dx = SURFACE_SPAWN[0] - beaconPos[0];
  const dz = SURFACE_SPAWN[2] - beaconPos[2];
  const len = Math.hypot(dx, dz) || 1;
  return [
    beaconPos[0] + (dx / len) * BEACON_VIEW_DISTANCE,
    SURFACE_HEAD_HEIGHT,
    beaconPos[2] + (dz / len) * BEACON_VIEW_DISTANCE,
  ];
};
