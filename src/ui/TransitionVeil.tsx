import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import * as THREE from 'three';
import { planetById } from '@/data/content';
import { buildSky } from '@/data/skyPresets';
import type { Planet } from '@/types/content';
import { useAppStore } from '@/state/useAppStore';
import { flight } from '@/state/runtime';
import {
  CLOUD_HAZE_LIFT,
  CLOUD_LIFT,
  CLOUD_LIFT_AFTER,
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
/** The tractor beam's light: both ways, the view whites out into it and the next scene comes up from it */
const BEAM = '#d4ecff';
const REDUCED_FADE = 200;
/** If the surface never reports frames, the clouds clear anyway after this long on the planet */
const CLOUD_HOLD_MAX = 5000;
/** Cloud banks in flight at once, and how long each takes to rush past */
const CLOUD_LAYERS = 7;
const CLOUD_PASS_S = 1.5;

interface VeilState {
  /** Overall cover, 0..1 */
  cover: number;
  coverMs: number;
  /** Planet atmosphere tint over the dark base, 0..1 */
  tint: number;
  tintMs: number;
  planetId: string | null;
  /** Base colour is the beam's light rather than space */
  flash: boolean;
  /** Cloud banks rushing past, from the plunge until the surface shows through */
  clouds: boolean;
  /** No base colour: only the sky haze and the clouds cover the view (while they part) */
  bare: boolean;
}

/**
 * Full-screen cover for scene swaps. The plunge at a planet flies into its
 * clouds; they keep streaming past while the surface loads and starts drawing,
 * then part around the viewer coming down the beam. Beaming up washes out into
 * the tractor beam's light (with reduced motion, deep space). The camera
 * controller reads the same timing constants so the cut lands under cover.
 * The cloud banks animate on the compositor (transform and opacity only), so
 * they keep moving while the main thread is busy building the surface.
 */
const TransitionVeil = () => {
  const mode = useAppStore((s) => s.mode);
  const lockedId = useAppStore((s) => s.lockedPlanetId);
  const reduced = useAppStore((s) => s.reducedMotion);
  const [v, setV] = useState<VeilState>({
    cover: 0,
    coverMs: 0,
    tint: 0,
    tintMs: 0,
    planetId: null,
    flash: false,
    clouds: false,
    bare: false,
  });
  const covered = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const tintEl = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timers: number[] = [];
    let raf = 0;
    const later = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));
    const fadeIn = reduced ? REDUCED_FADE : VEIL_FADE_IN;
    const lift = reduced ? REDUCED_FADE : VEIL_LIFT;

    if (mode === 'transitioning-in') {
      const planetId = lockedId;
      if (covered.current) {
        // chained straight from a beam up: the light turns into the destination's clouds
        setV((s) => ({ ...s, cover: 1, coverMs: 0, tint: 1, tintMs: 600, planetId, clouds: !reduced }));
      } else {
        // the plunge ends in the destination's sky and clouds, so the cut lands on the colours the
        // viewer is lowered through (reduced motion gets the same crossfade, sooner)
        setV({ cover: 0, coverMs: 0, tint: 1, tintMs: 0, planetId, flash: false, clouds: !reduced, bare: false });
        later(reduced ? Math.max(0, REDUCED_TOTAL - REDUCED_FADE - 50) : ENTER_VEIL_START, () => {
          covered.current = true;
          setV((s) => ({ ...s, cover: 1, coverMs: reduced ? fadeIn : ENTER_VEIL_FADE }));
        });
      }
    } else if (mode === 'transitioning-out') {
      setV((s) => ({ ...s, tint: 0, tintMs: 0, planetId: null, flash: !reduced, clouds: false, bare: false }));
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
    } else if (covered.current && mode === 'planet' && !reduced) {
      // still in the clouds: hold until the surface is drawing and the descent has begun, then the
      // sky haze thins first and the cloud banks part around the viewer coming down the beam
      const since = performance.now();
      const wait = () => {
        if (flight.arrivalMs < CLOUD_LIFT_AFTER && performance.now() - since < CLOUD_HOLD_MAX) {
          raf = requestAnimationFrame(wait);
          return;
        }
        covered.current = false;
        setV((s) => ({ ...s, cover: 0, coverMs: CLOUD_LIFT, tint: 0, tintMs: CLOUD_HAZE_LIFT, flash: false, bare: true }));
        later(CLOUD_LIFT + 100, () => setV((s) => ({ ...s, clouds: false, bare: false })));
      };
      raf = requestAnimationFrame(wait);
    } else if (covered.current) {
      covered.current = false;
      setV((s) => ({ ...s, cover: 0, coverMs: mode === 'planet' && !reduced ? ENTER_VEIL_LIFT : lift, clouds: false }));
    }
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      cancelAnimationFrame(raf);
    };
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
      className="pointer-events-none absolute inset-0 z-50 overflow-hidden"
      style={{
        opacity: v.cover,
        visibility: v.cover === 0 && v.coverMs === 0 ? 'hidden' : 'visible',
        background: v.bare ? 'transparent' : v.flash ? BEAM : SPACE,
      }}
    >
      <div
        ref={tintEl}
        className="absolute inset-0"
        style={{ opacity: v.tint, background: planet ? skyGradient(planet) : SPACE }}
      />
      {v.clouds && planet && <CloudRush planet={planet} />}
    </div>
  );
};

const CLOUD_CSS = `
@keyframes veil-cloud-rush {
  0% { transform: translate(-50%, -50%) rotate(var(--r)) scale(0.35); opacity: 0; }
  22% { opacity: var(--o); }
  70% { opacity: var(--o); }
  100% { transform: translate(-50%, -50%) rotate(var(--r)) scale(3.4); opacity: 0; }
}`;

/** Banks of the planet's cloud rushing out past the edges of the view, one after another. */
const CloudRush = ({ planet }: { planet: Planet }) => {
  const sprites = cloudSprites(planet);
  return (
    <>
      <style>{CLOUD_CSS}</style>
      {Array.from({ length: CLOUD_LAYERS }, (_, i) => (
        <div
          key={i}
          className="absolute left-1/2 top-1/2"
          style={
            {
              width: '150vmax',
              height: '150vmax',
              backgroundImage: `url(${sprites[i % sprites.length]})`,
              backgroundSize: '100% 100%',
              willChange: 'transform, opacity',
              '--r': `${(i * 137) % 360}deg`,
              '--o': String(0.75 + ((i * 7) % 4) * 0.08),
              // speeding up as each bank gets near, like flying into it
              animation: `veil-cloud-rush ${CLOUD_PASS_S}s cubic-bezier(0.55, 0, 0.9, 0.6) ${(-i * CLOUD_PASS_S) / CLOUD_LAYERS}s infinite`,
            } as CSSProperties
          }
        />
      ))}
    </>
  );
};

/**
 * A few cloud-bank sprites per planet: soft puffs in its sky's light and shade,
 * scattered around a small open middle so each bank parts around the view.
 */
const sprites = new Map<string, string[]>();
const cloudSprites = (planet: Planet): string[] => {
  const hit = sprites.get(planet.id);
  if (hit) return hit;
  const sky = buildSky(planet);
  const white = new THREE.Color(1, 1, 1);
  const light = `#${sky.horizon.clone().lerp(white, 0.55).getHexString()}`;
  const shade = `#${sky.fogColor.clone().lerp(sky.upper, 0.35).lerp(white, 0.15).getHexString()}`;
  const S = 384;
  const out = [0, 1, 2].map((v) => {
    const c = document.createElement('canvas');
    c.width = S;
    c.height = S;
    const g = c.getContext('2d');
    if (!g) return '';
    let seed = 9301 + v * 4957 + planet.id.length * 131;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 34; i += 1) {
      const r = 34 + rnd() * 80;
      // kept inside the sprite so no puff is cut by its edge
      const reach = Math.max(0.1, (S / 2 - r - 2) / S);
      const d = 0.1 + rnd() * (reach - 0.1);
      const a = rnd() * Math.PI * 2;
      const x = S / 2 + Math.cos(a) * d * S;
      const y = S / 2 + Math.sin(a) * d * S;
      const grad = g.createRadialGradient(x - r * 0.15, y - r * 0.2, r * 0.05, x, y, r);
      grad.addColorStop(0, `${light}d0`);
      grad.addColorStop(0.45, `${light}70`);
      grad.addColorStop(0.75, `${shade}30`);
      grad.addColorStop(1, `${shade}00`);
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    return c.toDataURL('image/png');
  });
  sprites.set(planet.id, out);
  return out;
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
