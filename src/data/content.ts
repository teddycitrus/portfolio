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

/**
 * Overworld placement. Planets sit in a fixed arc in front of the telescope and
 * drift gently around their anchor so the scene stays alive without ever
 * leaving the field of view. Renderer, hover detection, markers and the
 * entry transition all call this with the same clock time.
 */
export const getOrbitalPosition = (planet: Planet, t: number, out?: Vec3): Vec3 => {
  const [x, y, z] = planet.position;
  const phase = planet.index * 1.7;
  const res = out ?? ([0, 0, 0] as Vec3);
  res[0] = x + Math.sin(t * 0.11 + phase) * 0.9;
  res[1] = y + Math.sin(t * 0.17 + phase * 0.6) * 0.5;
  res[2] = z + Math.cos(t * 0.09 + phase) * 0.6;
  return res;
};

/* ---------- planet surface layout ---------- */

/** Where the player stands on arrival, facing -Z. */
export const SURFACE_SPAWN: Vec3 = [0, 1.6, 5];
export const SURFACE_HEAD_HEIGHT = 1.6;
const BEACON_ARC_RADIUS = 9;
const BEACON_ARC_SPAN = (110 * Math.PI) / 180;

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
