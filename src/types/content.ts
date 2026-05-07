export type Vec3 = [number, number, number];

export type BeaconKind = 'badge' | 'story' | 'project' | 'link';

export interface BadgeContent {
  level: string;
  description: string;
}

export interface StoryContent {
  heading: string;
  body: string;
}

export interface ProjectLink {
  label: string;
  url: string;
}

export interface ProjectContent {
  heading: string;
  description: string;
  video?: string;
  links: ProjectLink[];
}

export interface LinkContent {
  url: string;
  description: string;
}

export type BeaconContent =
  | { kind: 'badge'; data: BadgeContent }
  | { kind: 'story'; data: StoryContent }
  | { kind: 'project'; data: ProjectContent }
  | { kind: 'link'; data: LinkContent };

export interface Beacon {
  id: string;
  label: string;
  position: Vec3;
  kind: BeaconKind;
  content: BadgeContent | StoryContent | ProjectContent | LinkContent;
}

export interface PlanetSurface {
  atmosphere: string;
  ground: string;
  skyTop: string;
  skyBottom: string;
}

export type PlanetTime = 'noon' | 'dawn' | 'dusk' | 'night';
export type PlanetStyle = 'oceanic' | 'rocky' | 'gas-giant' | 'forested';

export interface Planet {
  id: string;
  title: string;
  subtitle: string;
  color: string;
  accent: string;
  position: Vec3;
  radius: number;
  time: PlanetTime;
  /** Procedural surface style for the overworld planet shader */
  style: PlanetStyle;
  /** Three-stop colour palette: dominant, secondary, deep/contrast */
  palette: [string, string, string];
  /** Orbital period in seconds (camera at origin, planet circles around it) */
  orbitPeriod: number;
  surface: PlanetSurface;
  beacons: Beacon[];
}

export interface ContentDocument {
  planets: Planet[];
}
