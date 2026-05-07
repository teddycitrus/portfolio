import * as THREE from 'three';

export type TimeOfDay = 'noon' | 'dawn' | 'dusk' | 'night';

export interface SkyPreset {
  /** Three-stop gradient applied to the dome from horizon → mid-sky → zenith */
  horizonColor: string;
  midColor: string;
  topColor: string;
  /** Glow halo radiating from the sun direction */
  glowColor: string;
  glowFalloff: number;
  /** Sun disc colour and intensity. intensity=0 disables the disc (night). */
  sunCoreColor: string;
  sunIntensity: number;
  /** Direction from origin toward the sun (will be normalised) */
  sunDirection: [number, number, number];
  /** Lighting parameters consumed by PlanetSurfaceScene */
  sunLightColor: string;
  sunLightIntensity: number;
  ambientColor: string;
  ambientIntensity: number;
  fogColor: string;
  fogNear: number;
  fogFar: number;
  /** 0..1 — multiplier applied to the in-scene starfield */
  starOpacity: number;
}

export const skyPresets: Record<TimeOfDay, SkyPreset> = {
  noon: {
    horizonColor: '#cfe5f0',
    midColor: '#7eb1d9',
    topColor: '#3b6db0',
    glowColor: '#ffffff',
    glowFalloff: 16,
    sunCoreColor: '#fff8d8',
    sunIntensity: 1,
    sunDirection: [0.25, 1.0, 0.3],
    sunLightColor: '#fff4d4',
    sunLightIntensity: 1.5,
    ambientColor: '#cfe0f0',
    ambientIntensity: 0.7,
    fogColor: '#cfe5f0',
    fogNear: 36,
    fogFar: 130,
    starOpacity: 0,
  },
  dawn: {
    horizonColor: '#e8a06a',
    midColor: '#7d6ea8',
    topColor: '#1f2a4e',
    glowColor: '#ffb27a',
    glowFalloff: 6,
    sunCoreColor: '#ffd29a',
    sunIntensity: 0.95,
    sunDirection: [0.85, 0.18, -0.45],
    sunLightColor: '#ffc090',
    sunLightIntensity: 1.0,
    ambientColor: '#5a6a96',
    ambientIntensity: 0.55,
    fogColor: '#a88a78',
    fogNear: 28,
    fogFar: 110,
    starOpacity: 0.25,
  },
  dusk: {
    horizonColor: '#d65838',
    midColor: '#8a3a64',
    topColor: '#231446',
    glowColor: '#ff7748',
    glowFalloff: 6,
    sunCoreColor: '#ff9056',
    sunIntensity: 0.85,
    sunDirection: [-0.78, 0.15, -0.4],
    sunLightColor: '#ffa066',
    sunLightIntensity: 0.9,
    ambientColor: '#5a3a58',
    ambientIntensity: 0.5,
    fogColor: '#8a3624',
    fogNear: 26,
    fogFar: 100,
    starOpacity: 0.45,
  },
  night: {
    horizonColor: '#000000',
    midColor: '#000000',
    topColor: '#000000',
    glowColor: '#000000',
    glowFalloff: 2,
    sunCoreColor: '#000000',
    sunIntensity: 0,
    sunDirection: [0, -0.3, 0],
    sunLightColor: '#3a4a64',
    sunLightIntensity: 0.18,
    ambientColor: '#0a1228',
    ambientIntensity: 0.32,
    fogColor: '#000000',
    fogNear: 28,
    fogFar: 100,
    starOpacity: 1.0,
  },
};

export const getSunDirection = (preset: SkyPreset): THREE.Vector3 => {
  return new THREE.Vector3(...preset.sunDirection).normalize();
};
