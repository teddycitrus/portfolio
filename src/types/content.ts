export type Vec3 = [number, number, number];

export interface ExternalLink {
  label: string;
  url: string;
}

export interface Fact {
  label: string;
  value: string;
}

export interface ProfileContent {
  heading: string;
  body: string;
  facts?: Fact[];
}

export interface ProjectContent {
  heading: string;
  tagline: string;
  period: string;
  description: string;
  highlights: string[];
  stack: string[];
  /** YouTube video id, rendered as an embed */
  videoId?: string;
  /** Poster image for the video; defaults to the YouTube thumbnail */
  poster?: string;
  award?: string;
  team?: boolean;
  links: ExternalLink[];
}

export interface AwardContent {
  event: string;
  result: string;
  year?: string;
  project?: string;
  description: string;
}

export interface SkillsContent {
  heading: string;
  items: string[];
  note?: string;
}

export interface LinkContent {
  url: string;
  handle: string;
  description: string;
}

interface BeaconBase {
  id: string;
  /** Short label shown on the monument and in lists */
  label: string;
}

export type Beacon =
  | (BeaconBase & { kind: 'profile'; content: ProfileContent })
  | (BeaconBase & { kind: 'project'; content: ProjectContent })
  | (BeaconBase & { kind: 'award'; content: AwardContent })
  | (BeaconBase & { kind: 'skills'; content: SkillsContent })
  | (BeaconBase & { kind: 'link'; content: LinkContent });

export type BeaconKind = Beacon['kind'];

export type PlanetTime = 'noon' | 'dawn' | 'dusk' | 'twilight' | 'night';
export type PlanetStyle = 'oceanic' | 'rocky' | 'gas-giant' | 'forested' | 'molten';

export interface PlanetSurface {
  /** Base ground colour */
  ground: string;
  /** Haze / emissive tint near the horizon */
  atmosphere: string;
}

export interface Planet {
  id: string;
  /** Number key used to travel here (1-based, matches order in content) */
  index: number;
  title: string;
  subtitle: string;
  /** One sentence used in docks, markers and the reader */
  summary: string;
  /** Primary planet colour */
  color: string;
  /** Lighter accent for UI text, beacons and glows */
  accent: string;
  /** Overworld placement in front of the telescope (camera at origin, looking -Z) */
  position: Vec3;
  radius: number;
  time: PlanetTime;
  style: PlanetStyle;
  /** Three-stop palette for the planet shader: dominant, secondary, deep */
  palette: [string, string, string];
  rings?: boolean;
  surface: PlanetSurface;
  beacons: Beacon[];
}

export interface Profile {
  name: string;
  role: string;
  tagline: string;
  location?: string;
  email: string;
}

export interface ContentDocument {
  profile: Profile;
  planets: Planet[];
}
