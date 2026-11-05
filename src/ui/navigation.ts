import { planets } from '@/data/content';
import type { Beacon } from '@/types/content';
import { useAppStore } from '@/state/useAppStore';

let cancelPending: (() => void) | null = null;

const focusBeacon = (id: string) => {
  const s = useAppStore.getState();
  s.glideToBeacon(id);
  s.setFocusedBeacon(id);
};

/**
 * Travel to a planet and optionally open one of its beacons once landed.
 * Arrival resets glide/focus in the store, so the beacon is focused after
 * the mode settles on the target planet.
 */
export const visitPlanet = (planetId: string, beaconId?: string) => {
  cancelPending?.();
  cancelPending = null;
  const s = useAppStore.getState();
  if (s.readerOpen) s.closeReader();
  if (s.mode === 'planet' && s.activePlanetId === planetId) {
    if (beaconId) focusBeacon(beaconId);
    return;
  }
  s.travelTo(planetId);
  if (!beaconId) return;
  let timer = 0;
  const unsub = useAppStore.subscribe((st) => {
    if (st.mode === 'planet' && st.activePlanetId === planetId) {
      unsub();
      // let the veil start lifting before the camera glides
      timer = window.setTimeout(() => {
        const now = useAppStore.getState();
        if (now.mode === 'planet' && now.activePlanetId === planetId) focusBeacon(beaconId);
      }, 350);
    } else if (st.mode === 'overworld' || (st.mode === 'planet' && st.activePlanetId !== planetId)) {
      unsub();
    }
  });
  cancelPending = () => {
    unsub();
    window.clearTimeout(timer);
  };
};

/** Project beacon matching an award's project name (by label or heading). */
export const findProjectBeacon = (name: string | undefined): { planetId: string; beacon: Beacon } | undefined => {
  if (!name) return undefined;
  const n = name.trim().toLowerCase();
  for (const p of planets) {
    for (const b of p.beacons) {
      if (b.kind !== 'project') continue;
      if (b.label.toLowerCase() === n || b.content.heading.toLowerCase() === n) return { planetId: p.id, beacon: b };
    }
  }
  return undefined;
};
