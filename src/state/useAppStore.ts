import { create } from 'zustand';

/**
 * intro             title card, scene renders behind it
 * overworld         telescope view of all planets
 * transitioning-in  camera dives toward lockedPlanetId
 * planet            walking on activePlanetId
 * transitioning-out camera launches off the surface
 */
export type SceneMode = 'intro' | 'overworld' | 'transitioning-in' | 'planet' | 'transitioning-out';

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

  start: () => void;
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

export const useAppStore = create<AppState>((set, get) => ({
  mode: 'intro',
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

  start: () => {
    if (get().mode === 'intro') set({ mode: 'overworld' });
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
  closeReader: () => set({ readerOpen: false }),

  travelTo: (planetId) => {
    const s = get();
    if (s.mode === 'intro' || s.mode === 'overworld') {
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
