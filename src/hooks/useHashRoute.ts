import { useEffect } from 'react';
import { useAppStore } from '@/state/useAppStore';
import { beaconById, planetById } from '@/data/content';
import { visitPlanet } from '@/ui/navigation';

/**
 * Keeps the URL hash in sync with where the visitor is, so views can be
 * shared and the browser Back button moves through the site.
 *   #/projects             on the Projects planet
 *   #/projects/proj-iris   with the Iris panel open
 *   #/read  #/read/awards  reader, optionally at a section
 */
interface Route {
  read: boolean;
  planetId: string | null;
  beaconId: string | null;
}

const parse = (hash: string): Route => {
  const [a, b] = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (a === 'read') return { read: true, planetId: planetById(b) ? b : null, beaconId: null };
  const planet = planetById(a);
  if (!planet) return { read: false, planetId: null, beaconId: null };
  return { read: false, planetId: planet.id, beaconId: beaconById(planet, b) ? b : null };
};

const format = (r: Route): string => {
  if (r.read) return r.planetId ? `#/read/${r.planetId}` : '#/read';
  if (!r.planetId) return '';
  return r.beaconId ? `#/${r.planetId}/${r.beaconId}` : `#/${r.planetId}`;
};

const currentRoute = (): Route => {
  const s = useAppStore.getState();
  if (s.readerOpen && !s.noWebGL) return { read: true, planetId: s.readerSection, beaconId: null };
  if (s.mode === 'planet') return { read: false, planetId: s.activePlanetId, beaconId: s.focusedBeaconId };
  return { read: false, planetId: null, beaconId: null };
};

const SITE_TITLE = 'yo its john';

/** The tab title for a route: the planet (and panel) or the reader, then the site. */
const titleFor = (r: Route): string => {
  if (r.read) return `Read · ${SITE_TITLE}`;
  const planet = planetById(r.planetId);
  if (!planet) return SITE_TITLE;
  const beacon = beaconById(planet, r.beaconId);
  return [beacon?.label, planet.title, SITE_TITLE].filter(Boolean).join(' · ');
};

const apply = (r: Route) => {
  const s = useAppStore.getState();
  if (r.read) {
    if (!s.readerOpen) s.openReader(r.planetId);
    return;
  }
  if (s.readerOpen) s.closeReader();
  if (r.planetId) {
    if (s.mode === 'planet' && s.activePlanetId === r.planetId) {
      if (r.beaconId !== s.focusedBeaconId) {
        if (r.beaconId) visitPlanet(r.planetId, r.beaconId);
        else s.setFocusedBeacon(null);
      }
    } else {
      visitPlanet(r.planetId, r.beaconId ?? undefined);
    }
  } else if (s.mode === 'planet') {
    s.exitPlanet();
  }
};

export const useHashRoute = (): void => {
  useEffect(() => {
    let applying = false;
    const initial = parse(window.location.hash);
    if (initial.read || initial.planetId) {
      document.title = titleFor(initial);
      applying = true;
      apply(initial);
      applying = false;
    }

    let last = initial.read || initial.planetId ? format(initial) : format(currentRoute());
    const unsub = useAppStore.subscribe(() => {
      const { mode } = useAppStore.getState();
      if (applying || mode === 'transitioning-in' || mode === 'transitioning-out') return;
      const route = currentRoute();
      const next = format(route);
      document.title = titleFor(route);
      if (next === last) return;
      const prev = parse(last);
      last = next;
      const url = next || `${window.location.pathname}${window.location.search}`;
      // New history entries for real moves (planet or reader); beacon swaps replace.
      const push = prev.read !== route.read || prev.planetId !== route.planetId;
      if (push) window.history.pushState(null, '', url);
      else window.history.replaceState(null, '', url);
    });

    const onPop = () => {
      const r = parse(window.location.hash);
      document.title = titleFor(r);
      last = format(r);
      applying = true;
      apply(r);
      applying = false;
    };
    window.addEventListener('popstate', onPop);
    return () => {
      unsub();
      window.removeEventListener('popstate', onPop);
    };
  }, []);
};
