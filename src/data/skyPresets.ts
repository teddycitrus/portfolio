import * as THREE from 'three';
import type { Planet, PlanetTime, Vec3 } from '@/types/content';

/**
 * Art-directed sky presets for the planet surfaces. Colours are sRGB hex;
 * buildSky() resolves them into linear THREE.Color objects tinted per planet.
 */
export interface SkyPreset {
  zenith: string;
  upper: string;
  /** Horizon band. Fog uses this exact colour so terrain dissolves into the sky. */
  horizon: string;
  /** Warm (or cool) glow hugging the horizon on the sun side */
  glow: string;
  glowStrength: number;
  /** Mie-like halo around the sun */
  halo: string;
  haloStrength: number;
  /** Direction toward the sun (normalised in buildSky). May sit below the horizon. */
  sunDir: Vec3;
  sunColor: string;
  /** Brightness of the sun disc in the sky shader (values > 1 bloom). 0 hides it. */
  sunDisc: number;
  /** Angular radius of the disc, radians */
  sunSize: number;
  /** Directional light. lightDir defaults to sunDir lifted to a minimum elevation. */
  lightColor: string;
  lightIntensity: number;
  lightDir?: Vec3;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  fogDensity: number;
  starOpacity: number;
  cloudOpacity: number;
  cloudColor: string;
  /** Sister planet hanging in the sky */
  moonDir: Vec3;
  /** Angular radius, radians */
  moonSize: number;
}

export const skyPresets: Record<PlanetTime, SkyPreset> = {
  noon: {
    zenith: '#2c5a94',
    upper: '#6a98c8',
    horizon: '#a8c0d4',
    glow: '#f4ead8',
    glowStrength: 0.18,
    halo: '#fff4e0',
    haloStrength: 0.35,
    sunDir: [0.5, 0.46, -0.73],
    sunColor: '#fff3dc',
    sunDisc: 5,
    sunSize: 0.014,
    lightColor: '#ffeccc',
    lightIntensity: 2.3,
    hemiSky: '#b4cce4',
    hemiGround: '#68746e',
    hemiIntensity: 1.35,
    fogDensity: 0.0095,
    starOpacity: 0,
    cloudOpacity: 0.5,
    cloudColor: '#ffffff',
    moonDir: [-0.32, 0.28, -0.9],
    moonSize: 0.07,
  },
  dawn: {
    zenith: '#28345a',
    upper: '#6a6c98',
    horizon: '#e3ac86',
    glow: '#ffbe84',
    glowStrength: 0.55,
    halo: '#ffd0a0',
    haloStrength: 0.55,
    sunDir: [0.66, 0.15, -0.74],
    sunColor: '#ffc690',
    sunDisc: 4,
    sunSize: 0.016,
    lightColor: '#ffb98a',
    lightIntensity: 2.2,
    hemiSky: '#8c96c0',
    hemiGround: '#3a2a28',
    hemiIntensity: 0.75,
    fogDensity: 0.0155,
    starOpacity: 0.12,
    cloudOpacity: 0.55,
    cloudColor: '#ffd8bc',
    moonDir: [-0.3, 0.29, -0.9],
    moonSize: 0.08,
  },
  dusk: {
    zenith: '#1c1836',
    upper: '#58345c',
    horizon: '#d8784e',
    glow: '#ff9a5c',
    glowStrength: 0.6,
    halo: '#ffb07a',
    haloStrength: 0.6,
    sunDir: [-0.66, 0.13, -0.74],
    sunColor: '#ff9c5e',
    sunDisc: 3.6,
    sunSize: 0.018,
    lightColor: '#ff9e68',
    lightIntensity: 2.0,
    hemiSky: '#7a5a82',
    hemiGround: '#2c1814',
    hemiIntensity: 0.7,
    fogDensity: 0.016,
    starOpacity: 0.3,
    cloudOpacity: 0.6,
    cloudColor: '#ffb48c',
    moonDir: [0.3, 0.27, -0.9],
    moonSize: 0.085,
  },
  twilight: {
    zenith: '#0b1532',
    upper: '#203a6a',
    horizon: '#5c78a2',
    glow: '#d89a7c',
    glowStrength: 0.35,
    halo: '#9fb0d8',
    haloStrength: 0.2,
    sunDir: [0.62, -0.07, -0.78],
    sunColor: '#ffc4a0',
    sunDisc: 0,
    sunSize: 0.026,
    lightColor: '#a8b8e4',
    lightIntensity: 1.1,
    lightDir: [0.6, 0.32, -0.74],
    hemiSky: '#5a74aa',
    hemiGround: '#18202c',
    hemiIntensity: 0.85,
    fogDensity: 0.017,
    starOpacity: 0.55,
    cloudOpacity: 0.35,
    cloudColor: '#9aaad0',
    moonDir: [-0.3, 0.28, -0.9],
    moonSize: 0.085,
  },
  night: {
    zenith: '#060a1c',
    upper: '#121a40',
    horizon: '#2a3464',
    glow: '#4a58a0',
    glowStrength: 0.25,
    halo: '#8c9cf0',
    haloStrength: 0.15,
    /* Off-screen star behind the viewer: lights the sister planet as a gibbous moon */
    sunDir: [0.45, 0.5, 0.74],
    sunColor: '#c8d2ff',
    sunDisc: 0,
    sunSize: 0.02,
    lightColor: '#9fb0ff',
    lightIntensity: 1.5,
    hemiSky: '#46529a',
    hemiGround: '#1a1c36',
    hemiIntensity: 1.05,
    fogDensity: 0.017,
    starOpacity: 1,
    cloudOpacity: 0.22,
    cloudColor: '#6a78b8',
    moonDir: [0.28, 0.3, -0.9],
    moonSize: 0.1,
  },
};

export interface ResolvedSky {
  zenith: THREE.Color;
  upper: THREE.Color;
  horizon: THREE.Color;
  glow: THREE.Color;
  glowStrength: number;
  halo: THREE.Color;
  haloStrength: number;
  sunDir: THREE.Vector3;
  sunColor: THREE.Color;
  sunDisc: number;
  sunSize: number;
  lightDir: THREE.Vector3;
  lightColor: THREE.Color;
  lightIntensity: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  /** Equal to horizon */
  fogColor: THREE.Color;
  fogDensity: number;
  starOpacity: number;
  cloudOpacity: number;
  cloudColor: THREE.Color;
  moonDir: THREE.Vector3;
  moonSize: number;
  /** Sister planet palette (linear) */
  moonColors: [THREE.Color, THREE.Color, THREE.Color];
  moonAtmosphere: THREE.Color;
  moonRings: boolean;
}

const c = (hex: string) => new THREE.Color(hex);
const cache = new Map<string, ResolvedSky>();

/** Resolve the planet's time-of-day preset, tinted toward its atmosphere and accent. */
export const buildSky = (planet: Planet): ResolvedSky => {
  const hit = cache.get(planet.id);
  if (hit) return hit;
  const p = skyPresets[planet.time];
  const atmo = c(planet.surface.atmosphere);
  const accent = c(planet.accent);
  const tint = c(planet.color);

  const horizon = c(p.horizon).lerp(atmo, 0.18).lerp(accent, 0.06);
  const sunDir = new THREE.Vector3(...p.sunDir).normalize();
  const lightDir = p.lightDir
    ? new THREE.Vector3(...p.lightDir).normalize()
    : sunDir.clone();
  if (lightDir.y < 0.16) {
    lightDir.y = 0.16;
    lightDir.normalize();
  }
  const [p0, p1, p2] = planet.palette;
  // The sister planet borrows the palette, rotated so it reads as a neighbour, not a copy
  const moonColors: [THREE.Color, THREE.Color, THREE.Color] = [c(p1), c(p0).lerp(c('#9a9aa0'), 0.3), c(p2)];

  const sky: ResolvedSky = {
    zenith: c(p.zenith).lerp(tint, 0.06),
    upper: c(p.upper).lerp(atmo, 0.14),
    horizon,
    glow: c(p.glow).lerp(accent, 0.15),
    glowStrength: p.glowStrength,
    halo: c(p.halo).lerp(accent, 0.12),
    haloStrength: p.haloStrength,
    sunDir,
    sunColor: c(p.sunColor),
    sunDisc: p.sunDisc,
    sunSize: p.sunSize,
    lightDir,
    lightColor: c(p.lightColor).lerp(accent, 0.08),
    lightIntensity: p.lightIntensity,
    hemiSky: c(p.hemiSky).lerp(atmo, 0.15),
    hemiGround: c(p.hemiGround).lerp(c(planet.surface.ground), 0.3),
    hemiIntensity: p.hemiIntensity,
    fogColor: horizon.clone(),
    fogDensity: p.fogDensity,
    starOpacity: p.starOpacity,
    cloudOpacity: p.cloudOpacity,
    cloudColor: c(p.cloudColor).lerp(accent, 0.1),
    moonDir: new THREE.Vector3(...p.moonDir).normalize(),
    moonSize: p.moonSize,
    moonColors,
    moonAtmosphere: accent.clone().lerp(horizon, 0.3),
    moonRings: !!planet.rings,
  };
  cache.set(planet.id, sky);
  return sky;
};
