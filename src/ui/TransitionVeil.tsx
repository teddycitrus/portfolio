import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { planetById } from '@/data/content';
import { useAppStore } from '@/state/useAppStore';
import {
  ENTER_VEIL_START,
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
        // straight from a launch: stay covered, shift to the new planet colour
        setV({ cover: 1, coverMs: 0, tint: 1, tintMs: 500, planetId });
      } else {
        setV({ cover: 0, coverMs: 0, tint: 1, tintMs: 0, planetId });
        later(reduced ? Math.max(0, REDUCED_TOTAL - REDUCED_FADE - 50) : ENTER_VEIL_START, () => {
          covered.current = true;
          setV((s) => ({ ...s, cover: 1, coverMs: fadeIn }));
        });
      }
    } else if (mode === 'transitioning-out') {
      setV((s) => ({ ...s, tint: 0, tintMs: 0, planetId: null }));
      later(reduced ? Math.max(0, REDUCED_TOTAL - REDUCED_FADE - 50) : EXIT_VEIL_START, () => {
        covered.current = true;
        setV((s) => ({ ...s, cover: 1, coverMs: fadeIn }));
      });
    } else if (covered.current) {
      covered.current = false;
      setV((s) => ({ ...s, cover: 0, coverMs: lift }));
    }
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [mode, lockedId, reduced]);

  // Transitions are set here so reduced motion can override the global 1ms rule.
  useLayoutEffect(() => {
    const prio = reduced ? 'important' : '';
    const cover = reduced ? REDUCED_FADE : v.coverMs;
    const tint = reduced ? REDUCED_FADE : v.tintMs;
    root.current?.style.setProperty('transition', `opacity ${cover}ms ${v.cover ? 'cubic-bezier(0.4, 0, 0.6, 1)' : EASE}`, prio);
    tintEl.current?.style.setProperty('transition', `opacity ${tint}ms ${EASE}`, prio);
  }, [reduced, v]);

  const planet = planetById(v.planetId);
  const color = planet?.color ?? SPACE;

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
        className="absolute inset-0 flex flex-col items-center justify-center"
        style={{
          opacity: v.tint,
          background: `radial-gradient(ellipse 120% 90% at 50% 55%, color-mix(in srgb, ${color} 72%, ${SPACE}) 0%, color-mix(in srgb, ${color} 34%, ${SPACE}) 42%, ${SPACE} 100%)`,
        }}
      >
        {planet && (
          <div className="text-center" style={{ transform: v.cover ? 'none' : 'translateY(6px)', transition: `transform 900ms ${EASE}` }}>
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/70">
              {String(planet.index).padStart(2, '0')} / {planet.subtitle}
            </p>
            <p className="mt-3 font-display text-[56px] leading-none text-white md:text-[72px]">{planet.title}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default TransitionVeil;
