import { create } from 'zustand';
import { useAppStore } from '@/state/useAppStore';
import { visitPlanet } from './navigation';

/**
 * "Take the tour": a short guided path through the strongest content.
 * Captions only restate facts from content.json.
 */
export interface TourStop {
  planetId: string;
  beaconId: string;
  title: string;
  caption: string;
}

export const TOUR_STOPS: TourStop[] = [
  {
    planetId: 'projects',
    beaconId: 'proj-iris',
    title: 'Iris',
    caption: 'Hands-free computer control. Future Impact winner at Hack The Valley X.',
  },
  {
    planetId: 'projects',
    beaconId: 'proj-shieldclaw',
    title: 'ShieldClaw',
    caption: 'Security for AI agents. Team win at Hack Canada 2026.',
  },
  {
    planetId: 'projects',
    beaconId: 'proj-eureka',
    title: 'Eureka',
    caption: 'Supply-chain risk on a live 3D globe, briefed by AI voice agents.',
  },
  {
    planetId: 'about',
    beaconId: 'about-education',
    title: 'Education',
    caption: 'First-year computer science at U of T, St. George.',
  },
];

/** Time each stop stays up once its panel is open. */
export const TOUR_DWELL_MS = 9000;

type Phase = 'travel' | 'dwell' | 'end';

interface TourState {
  active: boolean;
  index: number;
  phase: Phase;
  /** Paused with the Pause button (hover and scroll holds are handled by the bar) */
  paused: boolean;
  /** Bumped on every stop change so timers restart */
  stamp: number;
  start: () => void;
  go: (index: number) => void;
  next: () => void;
  prev: () => void;
  togglePause: () => void;
  end: () => void;
  arrived: () => void;
}

export const useTour = create<TourState>((set, get) => ({
  active: false,
  index: 0,
  phase: 'travel',
  paused: false,
  stamp: 0,

  start: () => {
    const app = useAppStore.getState();
    if (app.readerOpen) app.closeReader();
    set({ active: true, paused: false });
    get().go(0);
  },
  go: (index) => {
    const stop = TOUR_STOPS[index];
    if (!stop) return;
    set((s) => ({ index, phase: 'travel', stamp: s.stamp + 1 }));
    visitPlanet(stop.planetId, stop.beaconId, false);
  },
  next: () => {
    const { index, phase } = get();
    if (phase === 'end') return;
    if (index >= TOUR_STOPS.length - 1) set((s) => ({ phase: 'end', stamp: s.stamp + 1 }));
    else get().go(index + 1);
  },
  prev: () => {
    const { index, phase } = get();
    if (phase === 'end') get().go(TOUR_STOPS.length - 1);
    else if (index > 0) get().go(index - 1);
  },
  togglePause: () => set((s) => ({ paused: !s.paused })),
  // phase is kept so the bar does not change content while it fades out
  end: () => set({ active: false, paused: false }),
  arrived: () => {
    if (get().phase === 'travel') set((s) => ({ phase: 'dwell', stamp: s.stamp + 1 }));
  },
}));

if (import.meta.env.DEV) (window as unknown as { __tour: typeof useTour }).__tour = useTour;
