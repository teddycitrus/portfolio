import { create } from 'zustand';

export type SceneMode = 'overworld' | 'transitioning-in' | 'planet' | 'transitioning-out';

interface AppState {
  mode: SceneMode;
  hoveredPlanetId: string | null;
  lockedPlanetId: string | null;
  activePlanetId: string | null;
  pointer: { x: number; y: number };
  pointerScreen: { x: number; y: number };
  isTouch: boolean;
  gyroscopeAvailable: boolean;
  gyroscopeEnabled: boolean;
  pointerLocked: boolean;

  setHoveredPlanet: (id: string | null) => void;
  setPointer: (ndcX: number, ndcY: number, screenX: number, screenY: number) => void;
  setIsTouch: (v: boolean) => void;
  setGyroscopeAvailable: (v: boolean) => void;
  setGyroscopeEnabled: (v: boolean) => void;
  setPointerLocked: (v: boolean) => void;

  beginTransitionIn: (planetId: string) => void;
  arriveAtPlanet: () => void;
  beginTransitionOut: () => void;
  arriveAtOverworld: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  mode: 'overworld',
  hoveredPlanetId: null,
  lockedPlanetId: null,
  activePlanetId: null,
  pointer: { x: 0, y: 0 },
  pointerScreen: { x: 0, y: 0 },
  isTouch: false,
  gyroscopeAvailable: false,
  gyroscopeEnabled: false,
  pointerLocked: false,

  setHoveredPlanet: (id) => set({ hoveredPlanetId: id }),
  setPointer: (ndcX, ndcY, screenX, screenY) =>
    set({ pointer: { x: ndcX, y: ndcY }, pointerScreen: { x: screenX, y: screenY } }),
  setIsTouch: (v) => set({ isTouch: v }),
  setGyroscopeAvailable: (v) => set({ gyroscopeAvailable: v }),
  setGyroscopeEnabled: (v) => set({ gyroscopeEnabled: v }),
  setPointerLocked: (v) => set({ pointerLocked: v }),

  beginTransitionIn: (planetId) =>
    set({ mode: 'transitioning-in', lockedPlanetId: planetId }),
  arriveAtPlanet: () =>
    set((s) => ({ mode: 'planet', activePlanetId: s.lockedPlanetId, lockedPlanetId: null })),
  beginTransitionOut: () => set({ mode: 'transitioning-out' }),
  arriveAtOverworld: () =>
    set({ mode: 'overworld', activePlanetId: null, lockedPlanetId: null }),
}));
