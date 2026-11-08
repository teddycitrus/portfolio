import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { getBeaconPosition, planetById } from '@/data/content';
import type { Planet } from '@/types/content';
import { beaconScreen, dragLook, isKeyDown, joystickState } from '@/state/runtime';
import { useAppStore } from '@/state/useAppStore';
import {
  BackIcon,
  Button,
  ChevronIcon,
  EASE,
  FLOAT_TEXT,
  HUD_ZOOM,
  HintRow,
  IN_WORLD,
  Kbd,
  PageIcon,
  SAFE,
  cx,
  DISPLAY,
  useNarrow,
  useShort,
  usePresence,
} from './primitives';
import { useScreenMarkers, type Box } from './useScreenMarkers';
import { arrivalPulse } from '@/scenes/planet/surfaceState';
import { openBeacon } from './navigation';

const MOVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

/** Screen rects of HUD chrome (top bar, title, hint, chips, panel) that beacon labels must not sit under. */
const hudBlocks = (() => {
  let frame = 0;
  let cache: Box[] = [];
  return (): Box[] => {
    // layout reads are cheap here but still throttled to every 8th frame
    if (frame++ % 8 === 0) {
      cache = [];
      document.querySelectorAll<HTMLElement>('[data-hud-block]').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width && r.height) cache.push({ x: r.left, y: r.top, w: r.width, h: r.height });
      });
    }
    return cache;
  };
})();

const LABEL_FADE_MS = 350;
const LABEL_STAGGER_MS = 80;

/**
 * Edge arrows for monuments out of view. The monuments themselves carry no
 * floating names: the plaques, orbs and screens say what they are. All
 * positioning happens in the shared marker loop; the arrows are pointer
 * targets only, the chips are the accessible route.
 */
const BeaconMarkers = ({ planet, focused }: { planet: Planet; focused: string | null }) => {
  const narrow = useNarrow();
  // the phone sheet already shows the focused beacon
  const hiddenId = useRef<string | null>(null);
  hiddenId.current = narrow ? focused : null;
  const priorityId = useRef<string | null>(focused);
  priorityId.current = focused;
  const mountedAt = useRef(performance.now());
  const index = useRef(new Map(planet.beacons.map((b, i) => [b.id, i])));

  const bind = useScreenMarkers(beaconScreen, {
    placement: 'above',
    safe: { top: 0, bottom: 0 },
    hiddenId,
    priorityId,
    blockers: hudBlocks,
    // nearest and most central first, so those keep their names when space is tight
    rank: (_id, info, w) => (info.distance ?? 0) + (Math.abs(info.x - w / 2) / w) * 6,
    look: (id, info, now) => {
      // reveal one by one with the 3D discovery pulse after the arrival settle
      const start = arrivalPulse.start;
      const i = index.current.get(id) ?? 0;
      const reveal =
        start > 0
          ? Math.min(1, Math.max(0, (now - start - i * LABEL_STAGGER_MS) / LABEL_FADE_MS))
          : now - mountedAt.current > 500
            ? 1
            : 0;
      const k = Math.min(1, Math.max(0, info.scale ?? 1));
      return { opacity: reveal * (0.75 + 0.25 * k), scale: 0.92 + 0.08 * k };
    },
    edgeY: (h) => h - (window.innerWidth < 640 ? 280 : 190),
  });

  return (
    <div className="absolute inset-0 overflow-hidden">
      {planet.beacons.map((b, i) => {
        // beacons sharing a spot (the about camp) get one arrow
        const [x, , z] = getBeaconPosition(planet, i);
        if (planet.beacons.slice(0, i).some((_, k) => {
          const [kx, , kz] = getBeaconPosition(planet, k);
          return kx === x && kz === z;
        }))
          return null;
        return (
          <div key={b.id}>
            <button
              ref={bind(b.id, 'edge')}
              type="button"
              tabIndex={-1}
              onClick={() => openBeacon(b.id)}
              aria-label={`Go to ${b.label} (off screen)`}
              className={cx(
                IN_WORLD,
                'pointer-events-auto absolute left-0 top-0 flex items-center gap-1.5 px-2 py-1 data-[side=right]:flex-row-reverse',
              )}
              style={{ visibility: 'hidden' }}
            >
              <span ref={bind(b.id, 'arrow')} className="inline-flex text-[var(--accent)]">
                <ChevronIcon />
              </span>
              <span className="text-[13px] font-medium text-ink">{b.label}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
};

const usePointerLocked = () => {
  const [locked, setLocked] = useState(() => !!document.pointerLockElement);
  useEffect(() => {
    const on = () => setLocked(!!document.pointerLockElement);
    document.addEventListener('pointerlockchange', on);
    return () => document.removeEventListener('pointerlockchange', on);
  }, []);
  return locked;
};

/** Centre mark while the cursor is locked; a click opens the monument under it. */
const Crosshair = () => (
  <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2">
    <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-white/70" />
    <span className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-white/70" />
  </div>
);

/** Shown while the cursor is free on desktop, until a click on the scene takes it back. */
const LookPrompt = () => (
  <p aria-hidden="true" className={cx('animate-fade-in px-4 py-1.5 text-[13px] text-ink', FLOAT_TEXT)}>
    Click to look around
  </p>
);

/** Arrival hint, gone after the first move, the first opened beacon or 8 seconds. */
const ControlsHint = ({ isTouch }: { isTouch: boolean }) => {
  const [show, setShow] = useState(true);
  useEffect(() => {
    const t = window.setTimeout(() => setShow(false), 8000);
    const i = window.setInterval(() => {
      const s = useAppStore.getState();
      if (isKeyDown(...MOVE_KEYS) || dragLook.dragging || joystickState.active || s.focusedBeaconId) setShow(false);
    }, 150);
    return () => {
      window.clearTimeout(t);
      window.clearInterval(i);
    };
  }, []);
  const items = isTouch
    ? [<span className="text-ink">Tap a monument</span>]
    : [
        <span className="text-ink">Click a monument</span>,
        <>
          <Kbd>W</Kbd>
          <Kbd>A</Kbd>
          <Kbd>S</Kbd>
          <Kbd>D</Kbd>
          <span className="ml-0.5">Move</span>
        </>,
        <>
          <Kbd>Esc</Kbd>
          <span className="ml-0.5">Free cursor</span>
        </>,
        <>
          <Kbd>Q</Kbd>
          <span className="ml-0.5">Back to orbit</span>
        </>,
      ];
  return (
    <div
      data-hud-block={show ? '' : undefined}
      aria-hidden="true"
      className={cx('px-4 py-1.5', FLOAT_TEXT)}
      style={{ opacity: show ? 1 : 0, transition: `opacity 600ms ${EASE}` }}
    >
      <HintRow items={items} className="justify-center" />
    </div>
  );
};

const PlanetHud = () => {
  const mode = useAppStore((s) => s.mode);
  const activeId = useAppStore((s) => s.activePlanetId);
  const focused = useAppStore((s) => s.focusedBeaconId);
  const isTouch = useAppStore((s) => s.isTouch);
  const readerOpen = useAppStore((s) => s.readerOpen);
  const exitPlanet = useAppStore((s) => s.exitPlanet);
  const openReader = useAppStore((s) => s.openReader);
  const narrow = useNarrow();
  const short = useShort();
  const locked = usePointerLocked();
  const header = useRef<HTMLElement>(null);

  const live = mode === 'planet' && !!activeId;
  const { mounted, visible } = usePresence(live, 300);

  // after landing, focus would otherwise drop to <body> (the dock that had it is gone)
  useEffect(() => {
    if (!mounted || !live) return;
    const r = requestAnimationFrame(() => {
      const a = document.activeElement;
      if (a && a !== document.body) return;
      const titles = header.current?.querySelectorAll<HTMLElement>('[data-planet-title]') ?? [];
      const t = [...titles].find((el) => el.offsetParent !== null);
      t?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(r);
  }, [mounted, live, activeId]);
  // keep the last planet while fading out
  const lastId = useRef(activeId);
  if (activeId) lastId.current = activeId;
  const planet = planetById(lastId.current);
  if (!mounted || !planet) return null;

  const fade: CSSProperties = {
    opacity: visible ? 1 : 0,
    transition: `opacity ${visible ? 600 : 250}ms ${EASE} ${visible ? 350 : 0}ms`,
    '--accent': planet.accent,
  } as CSSProperties;

  return (
    <div className="absolute inset-0" style={fade} aria-hidden={readerOpen || undefined}>
      {/* soft scrims keep the bars legible on bright skies */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[160px] bg-gradient-to-b from-space/70 to-transparent"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[160px] bg-gradient-to-t from-space/50 to-transparent"
      />
      <BeaconMarkers planet={planet} focused={focused} />
      {locked && <Crosshair />}

      {/* z-40 keeps the header above the beacon panel (z-30) */}
      <header
        ref={header}
        className={cx('absolute inset-x-0 top-0 z-40', HUD_ZOOM)}
        style={{ paddingTop: SAFE.top, paddingLeft: SAFE.left, paddingRight: SAFE.right }}
      >
        <div data-hud-block className="flex items-center gap-1.5 sm:gap-2">
          <Button
            size="sm"
            onClick={exitPlanet}
            aria-label="Back to orbit"
            className="max-sm:w-9 max-sm:justify-center"
          >
            <BackIcon className="text-ink-muted max-sm:text-ink" />
            <span className="hidden sm:inline">Back to orbit</span>
            {!isTouch && <Kbd className="ml-0.5 hidden md:inline-flex">Q</Kbd>}
          </Button>
          {/* compact single-line title on phones, inside the top bar */}
          <p
            aria-hidden="true"
            className={cx(
              'flex min-w-0 flex-1 select-none items-center pl-1 sm:hidden [@media(max-height:500px)]:!flex',
              FLOAT_TEXT,
            )}
          >
            <span className="truncate font-display text-[18px] leading-none text-ink">{planet.title}</span>
          </p>
          <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
            <Button
              size="sm"
              onClick={() => openReader(planet.id)}
              aria-label="Read as page"
              className="max-sm:w-9 max-sm:justify-center"
            >
              <PageIcon className="text-ink-muted max-sm:text-ink" />
              <span className="hidden sm:inline">Read as page</span>
              {!isTouch && <Kbd className="ml-0.5 hidden md:inline-flex">R</Kbd>}
            </Button>
          </div>
        </div>
        <div
          data-hud-block
          className="mt-4 hidden w-max max-w-full select-none pl-1 [text-shadow:0_1px_14px_rgba(5,7,13,0.7)] sm:block [@media(max-height:500px)]:!hidden"
        >
          <h1
            data-planet-title
            tabIndex={-1}
            className={cx('font-display leading-none text-ink outline-none', DISPLAY.d40)}
          >
            {planet.title}
          </h1>
        </div>
        <h1 data-planet-title tabIndex={-1} className="sr-only sm:hidden [@media(max-height:500px)]:!block">
          {planet.title}
        </h1>
      </header>

      <div
        className={cx('absolute inset-x-0 bottom-0 flex flex-col items-center gap-3', HUD_ZOOM)}
        style={{ paddingBottom: SAFE.bottom }}
      >
        <div className={cx(!isTouch && 'hidden md:block')}>
          {isTouch || locked ? <ControlsHint isTouch={isTouch} /> : <LookPrompt />}
        </div>
        <nav
          aria-label={`${planet.title} content`}
          className="pointer-events-auto w-full"
          // short landscape screens: keep the chips clear of the side panel
          style={short && !narrow && focused ? { paddingRight: 'calc(360px + 12px)' } : undefined}
        >
          <ul
            data-hud-block
            className={cx(
              'scrollbar-thin mx-auto flex w-max max-w-full snap-x scroll-px-5 gap-2 overflow-x-auto pb-1 sm:gap-4',
              FLOAT_TEXT,
            )}
            style={{ paddingLeft: SAFE.left, paddingRight: SAFE.right }}
          >
            {planet.beacons.map((b) => {
              const on = focused === b.id;
              return (
                <li key={b.id} className="shrink-0 snap-start">
                  <button
                    type="button"
                    aria-pressed={on}
                    data-beacon-chip={b.id}
                    onClick={() => openBeacon(b.id)}
                    className={cx(
                      'flex h-11 items-center px-2 text-[14px] font-medium transition-colors duration-200 ease-out',
                      on ? 'text-[var(--accent)]' : 'text-ink/80 hover:text-white',
                    )}
                  >
                    {b.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </div>
  );
};

export default PlanetHud;
