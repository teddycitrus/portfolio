import { create } from 'zustand';

/**
 * overworld         telescope view of all planets
 * transitioning-in  camera dives toward lockedPlanetId
 * planet            walking on activePlanetId
 * transitioning-out camera launches off the surface
 */
export type SceneMode = 'overworld' | 'transitioning-in' | 'planet' | 'transitioning-out';

interface AppState {
  mode: SceneMode;
  hoveredPlanetId: string | null;
  lockedPlanetId: string | null;
  activePlanetId: string | null;
  /** Planet to dive into once the current exit transition finishes */
  pendingPlanetId: string | null;
  /** Beacon whose panel is open on the planet surface */
  focusedBeaconId: string | null;
  /** Beacon the planet camera should glide to (cleared by the camera on arrival) */
  glideBeaconId: string | null;
  readerOpen: boolean;
  /** Section the reader should scroll to when opened */
  readerSection: string | null;
  isTouch: boolean;
  reducedMotion: boolean;
  /** WebGL failed or is missing: the reader becomes the whole site */
  noWebGL: boolean;
  /** The hyperspace arrival is playing: no HUD, no input, and travel waits for it */
  intro: boolean;
  /** A planet asked for during the arrival (a link, Back, the tour); travel starts when it ends */
  introTravel: string | null;

  setNoWebGL: () => void;
  endIntro: () => void;
  setHoveredPlanet: (id: string | null) => void;
  setFocusedBeacon: (id: string | null) => void;
  glideToBeacon: (id: string) => void;
  clearGlide: () => void;
  setIsTouch: (v: boolean) => void;
  setReducedMotion: (v: boolean) => void;
  openReader: (section?: string | null) => void;
  closeReader: () => void;

  /** Go to a planet from anywhere. From another planet it exits first, then dives. */
  travelTo: (planetId: string) => void;
  /** Leave the current planet back to orbit. */
  exitPlanet: () => void;

  /** Called by the transition controller when the dive / launch completes. */
  arriveAtPlanet: () => void;
  arriveAtOverworld: () => void;
}

/**
 * The hyperspace arrival plays on a plain visit to the lobby: not when a link
 * goes straight to a planet or the reader, and not with reduced motion.
 */
const introWanted = () => {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
  return window.location.hash.replace(/^#\/?/, '') === '';
};

export const useAppStore = create<AppState>((set, get) => ({
  mode: 'overworld',
  hoveredPlanetId: null,
  lockedPlanetId: null,
  activePlanetId: null,
  pendingPlanetId: null,
  focusedBeaconId: null,
  glideBeaconId: null,
  readerOpen: false,
  readerSection: null,
  isTouch: false,
  reducedMotion: false,
  noWebGL: false,
  intro: introWanted(),
  introTravel: null,

  setNoWebGL: () => set({ noWebGL: true, readerOpen: true, readerSection: null, intro: false, introTravel: null }),
  endIntro: () => {
    const queued = get().introTravel;
    set({ intro: false, introTravel: null });
    if (queued) get().travelTo(queued);
  },
  setHoveredPlanet: (id) => set({ hoveredPlanetId: id }),
  setFocusedBeacon: (id) => {
    if (get().focusedBeaconId !== id) set({ focusedBeaconId: id });
  },
  glideToBeacon: (id) => set({ glideBeaconId: id }),
  clearGlide: () => set({ glideBeaconId: null }),
  setIsTouch: (v) => set({ isTouch: v }),
  setReducedMotion: (v) => set({ reducedMotion: v }),
  openReader: (section = null) => set({ readerOpen: true, readerSection: section }),
  closeReader: () => {
    if (!get().noWebGL) set({ readerOpen: false });
  },

  travelTo: (planetId) => {
    const s = get();
    if (s.intro) {
      set({ introTravel: planetId });
      return;
    }
    if (s.mode === 'overworld') {
      set({ mode: 'transitioning-in', lockedPlanetId: planetId, hoveredPlanetId: null });
    } else if (s.mode === 'planet') {
      if (s.activePlanetId === planetId) return;
      set({ mode: 'transitioning-out', pendingPlanetId: planetId, focusedBeaconId: null });
    }
  },
  exitPlanet: () => {
    if (get().mode === 'planet') {
      set({ mode: 'transitioning-out', pendingPlanetId: null, focusedBeaconId: null });
    }
  },

  arriveAtPlanet: () =>
    set((s) => ({
      mode: 'planet',
      activePlanetId: s.lockedPlanetId,
      lockedPlanetId: null,
      focusedBeaconId: null,
      glideBeaconId: null,
    })),
  arriveAtOverworld: () => {
    const pending = get().pendingPlanetId;
    set({
      mode: pending ? 'transitioning-in' : 'overworld',
      activePlanetId: null,
      lockedPlanetId: pending,
      pendingPlanetId: null,
      focusedBeaconId: null,
      glideBeaconId: null,
    });
  },
}));
