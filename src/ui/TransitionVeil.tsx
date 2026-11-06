import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { planetById } from '@/data/content';
import { buildSky } from '@/data/skyPresets';
import type { Planet } from '@/types/content';
import { useAppStore } from '@/state/useAppStore';
import {
  CHAIN_TOTAL,
  ENTER_VEIL_FADE,
  ENTER_VEIL_LIFT,
  ENTER_VEIL_START,
  EXIT_CHAIN_VEIL_START,
  EXIT_VEIL_START,
  REDUCED_TOTAL,
  VEIL_FADE_IN,
  VEIL_LIFT,
} from '@/state/timing';
import { EASE } from './primitives';

const SPACE = '#05070d';
const REDUCED_FADE = 200;

interface VeilState {
  /** Overall cover, 0..1 */
  cover: number;
  coverMs: number;
  /** Planet atmosphere tint over the dark base, 0..1 */
  tint: number;
  tintMs: number;
  planetId: string | null;
}

/**
 * Full-screen cover for scene swaps. Dives fade into the target planet's
 * atmosphere colour with its name; launches fade to deep space. The camera
 * controller reads the same timing constants so the cut lands under cover.
 */
const TransitionVeil = () => {
  const mode = useAppStore((s) => s.mode);
  const lockedId = useAppStore((s) => s.lockedPlanetId);
  const reduced = useAppStore((s) => s.reducedMotion);
  const [v, setV] = useState<VeilState>({ cover: 0, coverMs: 0, tint: 0, tintMs: 0, planetId: null });
  const covered = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const tintEl = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timers: number[] = [];
    const later = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));
    const fadeIn = reduced ? REDUCED_FADE : VEIL_FADE_IN;
    const lift = reduced ? REDUCED_FADE : VEIL_LIFT;

    if (mode === 'transitioning-in') {
      const planetId = lockedId;
      if (covered.current) {
        // chained dive straight from a launch: stay covered and shift to the
        // destination sky before arrival (CHAIN_TOTAL), then lift as usual
        setV({ cover: 1, coverMs: 0, tint: 1, tintMs: Math.max(150, CHAIN_TOTAL - 150), planetId });
      } else {
        setV({ cover: 0, coverMs: 0, tint: 1, tintMs: 0, planetId });
        later(reduced ? Math.max(0, REDUCED_TOTAL - REDUCED_FADE - 50) : ENTER_VEIL_START, () => {
          covered.current = true;
          setV((s) => ({ ...s, cover: 1, coverMs: reduced ? fadeIn : ENTER_VEIL_FADE }));
        });
      }
    } else if (mode === 'transitioning-out') {
      setV((s) => ({ ...s, tint: 0, tintMs: 0, planetId: null }));
      // planet-to-planet launches are shorter and cover earlier
      const chained = useAppStore.getState().pendingPlanetId !== null;
      const start = reduced
        ? Math.max(0, REDUCED_TOTAL - REDUCED_FADE - 50)
        : chained
          ? EXIT_CHAIN_VEIL_START
          : EXIT_VEIL_START;
      later(start, () => {
        covered.current = true;
        setV((s) => ({ ...s, cover: 1, coverMs: fadeIn }));
      });
    } else if (covered.current) {
      covered.current = false;
      // landing: the atmosphere clears fast while the ship is still descending
      setV((s) => ({ ...s, cover: 0, coverMs: mode === 'planet' && !reduced ? ENTER_VEIL_LIFT : lift }));
    }
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [mode, lockedId, reduced]);

  // Transitions are set here so reduced motion can override the global 1ms rule.
  useLayoutEffect(() => {
    const prio = reduced ? 'important' : '';
    const cover = reduced ? REDUCED_FADE : v.coverMs;
    const tint = reduced ? REDUCED_FADE : v.tintMs;
    root.current?.style.setProperty(
      'transition',
      `opacity ${cover}ms ${v.cover ? 'cubic-bezier(0.4, 0, 0.6, 1)' : EASE}`,
      prio,
    );
    tintEl.current?.style.setProperty('transition', `opacity ${tint}ms ${EASE}`, prio);
  }, [reduced, v]);

  const planet = planetById(v.planetId);

  return (
    <div
      ref={root}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-50"
      style={{
        opacity: v.cover,
        visibility: v.cover === 0 && v.coverMs === 0 ? 'hidden' : 'visible',
        background: SPACE,
      }}
    >
      <div
        ref={tintEl}
        className="absolute inset-0"
        style={{ opacity: v.tint, background: planet ? skyGradient(planet) : SPACE }}
      />
    </div>
  );
};

/**
 * The destination sky (zenith to horizon, sRGB from the same preset the
 * surface uses) so the cut lands on matching colours, with a faint accent
 * glow where the horizon will be.
 */
const gradients = new Map<string, string>();
const skyGradient = (planet: Planet): string => {
  const hit = gradients.get(planet.id);
  if (hit) return hit;
  const sky = buildSky(planet);
  const hex = (c: { getHexString: () => string }) => `#${c.getHexString()}`;
  const g =
    `radial-gradient(ellipse 90% 55% at 50% 62%, color-mix(in srgb, ${planet.accent} 22%, transparent) 0%, transparent 70%), ` +
    `linear-gradient(180deg, ${hex(sky.zenith)} 0%, ${hex(sky.upper)} 38%, ${hex(sky.horizon)} 72%, ${hex(sky.fogColor)} 100%)`;
  gradients.set(planet.id, g);
  return g;
};

export default TransitionVeil;
