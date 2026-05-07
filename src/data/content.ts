import raw from './content.json';
import type { ContentDocument, Planet, Vec3 } from '@/types/content';

export const content = raw as unknown as ContentDocument;

export const planets: Planet[] = content.planets;

export const planetById = (id: string): Planet | undefined =>
  planets.find((p) => p.id === id);

interface OrbitParams {
  radius: number;
  baseAngle: number;
  y: number;
  omega: number;
}

const orbitCache = new Map<string, OrbitParams>();

const getOrbitParams = (planet: Planet): OrbitParams => {
  const cached = orbitCache.get(planet.id);
  if (cached) return cached;
  const radius = Math.hypot(planet.position[0], planet.position[2]);
  const baseAngle = Math.atan2(planet.position[2], planet.position[0]);
  const omega = (2 * Math.PI) / Math.max(planet.orbitPeriod, 1);
  const params: OrbitParams = { radius, baseAngle, y: planet.position[1], omega };
  orbitCache.set(planet.id, params);
  return params;
};

/**
 * Deterministic orbital position around the user (origin) at time `t` (sec).
 * Both the renderer and the hover-detection code call this with the same `t`
 * so the planet you see in the crosshairs is the one that gets selected.
 */
export const getOrbitalPosition = (planet: Planet, t: number): Vec3 => {
  const { radius, baseAngle, y, omega } = getOrbitParams(planet);
  const a = baseAngle + t * omega;
  return [Math.cos(a) * radius, y, Math.sin(a) * radius];
};
