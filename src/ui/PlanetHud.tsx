import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { planetById, planets, profile } from '@/data/content';
import type { Planet } from '@/types/content';
import { beaconScreen, dragLook, isKeyDown, joystickState } from '@/state/runtime';
import { useAppStore } from '@/state/useAppStore';
import {
  AccentDot,
  BackIcon,
  Button,
  ChevronIcon,
  EASE,
  EmailLink,
  HUD_ZOOM,
  KIND_LABEL,
  Kbd,
  PageIcon,
  SAFE,
  cx,
  useNarrow,
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
 * On-screen beacon labels (name + index on a short accent stem) and edge
 * arrows for beacons out of view. All positioning happens in the shared
 * marker loop; labels are pointer targets only, the chips are the
 * accessible route.
 */
const BeaconMarkers = ({ planet, focused, mixedKinds }: { planet: Planet; focused: string | null; mixedKinds: boolean }) => {
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
        const on = focused === b.id;
        return (
          <div key={b.id}>
            <button
              ref={bind(b.id, 'anchor')}
              type="button"
              tabIndex={-1}
              aria-hidden="true"
              onClick={() => openBeacon(b.id)}
              className="group pointer-events-auto absolute left-0 top-0 cursor-pointer [transform-origin:50%_100%]"
              style={{ visibility: 'hidden' }}
            >
              <span
                className={cx(
                  'flex flex-col items-center rounded-md border px-2 py-1 backdrop-blur-sm transition-colors duration-200 group-hover:border-[color-mix(in_srgb,var(--accent)_45%,transparent)] group-data-[compact=true]:hidden',
                  on ? 'border-[color-mix(in_srgb,var(--accent)_40%,transparent)] bg-space/75' : 'border-line bg-space/55',
                )}
              >
                <span className="flex items-center gap-1.5 whitespace-nowrap font-mono text-[13px] font-medium uppercase leading-tight tracking-[0.16em] text-ink max-sm:text-[11px]">
                  {on && <AccentDot />}
                  {b.label}
                </span>
                <span className="whitespace-nowrap font-mono text-[11px] leading-tight tracking-[0.08em] text-ink-muted max-sm:text-[10px]">
                  {String(i + 1).padStart(2, '0')}
                  {mixedKinds && ` ${KIND_LABEL[b.kind]}`}
                </span>
              </span>
              {/* stem down toward the monument; length set by the marker loop */}
              <span
                aria-hidden="true"
                className="absolute left-1/2 top-full h-[var(--stem,14px)] w-px -translate-x-1/2 bg-[var(--accent)] opacity-70 group-data-[compact=true]:hidden"
              />
              {/* collapsed form when there is no room for the name */}
              <span className="hidden h-3 w-3 items-center justify-center group-data-[compact=true]:flex">
                <span className="h-2 w-2 rounded-full bg-[var(--accent)] shadow-[0_0_0_2px_rgba(5,7,13,0.6)]" />
              </span>
            </button>
            <button
              ref={bind(b.id, 'edge')}
              type="button"
              tabIndex={-1}
              onClick={() => openBeacon(b.id)}
              aria-label={`${b.label}, out of view. Go there`}
              className="pointer-events-auto absolute left-0 top-0 flex items-center gap-1.5 rounded-full bg-space/60 px-2 py-1 data-[side=right]:flex-row-reverse"
              style={{ visibility: 'hidden' }}
            >
              <span ref={bind(b.id, 'arrow')} className="inline-flex text-[var(--accent)]">
                <ChevronIcon />
              </span>
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink">{b.label}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
};

const TravelMenu = ({ current, isTouch }: { current: string; isTouch: boolean }) => {
  const [open, setOpen] = useState(false);
  const travelTo = useAppStore((s) => s.travelTo);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', away);
    return () => window.removeEventListener('pointerdown', away);
  }, [open]);

  return (
    <div
      ref={root}
      className="relative"
      onKeyDown={(e) => {
        // Esc closes the menu instead of leaving the planet
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <Button
        ref={trigger}
        size="sm"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((v) => !v)}
        className="max-sm:gap-1.5 max-sm:px-3"
      >
        Travel
        <ChevronIcon
          className={cx('text-ink-muted transition-transform duration-200 ease-out', open ? '-rotate-90' : 'rotate-90')}
        />
      </Button>
      {open && (
        <ul data-hud-block className="panel pointer-events-auto absolute right-0 top-full mt-2 w-56 animate-fade-in rounded-xl p-1.5">
          {planets
            .filter((p) => p.id !== current)
            .map((p) => (
              <li key={p.id} style={{ '--accent': p.accent } as CSSProperties}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    travelTo(p.id);
                  }}
                  className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors duration-150 hover:bg-white/[0.05]"
                >
                  <AccentDot />
                  <span className="flex-1">
                    <span className="block text-[14px] text-ink">{p.title}</span>
                    <span className="block font-mono text-[11px] text-ink-muted">{p.subtitle}</span>
                  </span>
                  {!isTouch && <Kbd>{p.index}</Kbd>}
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
};

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
  return (
    <p
      data-hud-block={show ? '' : undefined}
      aria-hidden="true"
      className="flex items-center justify-center gap-4 rounded-full bg-space/45 px-3 py-1 font-mono text-[12px] text-ink-muted backdrop-blur-sm"
      style={{ opacity: show ? 1 : 0, transition: `opacity 600ms ${EASE}` }}
    >
      <span className="text-ink">{isTouch ? 'Tap a monument' : 'Click a monument'}</span>
      {!isTouch && (
        <>
          <span className="flex items-center gap-1.5">
            <Kbd>W</Kbd>
            <Kbd>A</Kbd>
            <Kbd>S</Kbd>
            <Kbd>D</Kbd> move
          </span>
          <span>Drag to look</span>
          <span className="flex items-center gap-1.5">
            <Kbd>Q</Kbd> back to orbit
          </span>
        </>
      )}
    </p>
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

  const live = mode === 'planet' && !!activeId;
  const { mounted, visible } = usePresence(live, 300);
  // keep the last planet while fading out
  const lastId = useRef(activeId);
  if (activeId) lastId.current = activeId;
  const planet = planetById(lastId.current);
  if (!mounted || !planet) return null;
  // kind text is noise when every beacon here is the same kind
  const mixedKinds = new Set(planet.beacons.map((b) => b.kind)).size > 1;

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
        className="pointer-events-none absolute inset-x-0 top-0 h-[160px] bg-gradient-to-b from-space/50 to-transparent"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[160px] bg-gradient-to-t from-space/50 to-transparent"
      />
      <BeaconMarkers planet={planet} focused={focused} mixedKinds={mixedKinds} />

      <header
        className={cx('absolute inset-x-0 top-0', HUD_ZOOM)}
        style={{ paddingTop: SAFE.top, paddingLeft: SAFE.left, paddingRight: SAFE.right }}
      >
        <div data-hud-block className="flex items-center gap-1.5 sm:gap-2">
          <Button
            size="sm"
            onClick={exitPlanet}
            aria-label="Back to orbit"
            className="max-sm:w-9 max-sm:justify-center max-sm:px-0"
          >
            <BackIcon className="text-ink-muted max-sm:text-ink" />
            <span className="hidden sm:inline">Back to orbit</span>
            {!isTouch && <Kbd className="ml-0.5 hidden md:inline-flex">Q</Kbd>}
          </Button>
          {/* compact single-line title on phones, inside the top bar */}
          <p
            aria-hidden="true"
            className="flex min-w-0 flex-1 select-none items-center gap-2 pl-1 sm:hidden [@media(max-height:500px)]:!flex"
          >
            <AccentDot />
            <span className="truncate font-display text-[21px] leading-none text-ink">{planet.title}</span>
          </p>
          <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
            <TravelMenu current={planet.id} isTouch={isTouch} />
            <EmailLink email={profile.email} name={profile.name} />
            <Button
              size="sm"
              onClick={() => openReader(planet.id)}
              aria-label="Read as a page"
              className="max-sm:gap-1.5 max-sm:px-3"
            >
              <PageIcon className="text-ink-muted" />
              <span className="sm:hidden">Read</span>
              <span className="hidden sm:inline">Read as page</span>
              {!isTouch && <Kbd className="ml-0.5 hidden md:inline-flex">R</Kbd>}
            </Button>
          </div>
        </div>
        <div data-hud-block className="mt-5 hidden w-max max-w-full select-none pl-1 sm:block [@media(max-height:500px)]:!hidden">
          <p className="label flex items-center gap-2">
            <AccentDot />
            <span>
              {String(planet.index).padStart(2, '0')} / {planet.subtitle}
            </span>
          </p>
          <h1 className="mt-1.5 font-display text-[34px] font-normal leading-none text-ink md:text-[40px]">
            {planet.title}
          </h1>
        </div>
        <h1 className="sr-only sm:hidden [@media(max-height:500px)]:!block">{planet.title}</h1>
      </header>

      <div
        className={cx('absolute inset-x-0 bottom-0 flex flex-col items-center gap-3', HUD_ZOOM)}
        style={{ paddingBottom: SAFE.bottom }}
      >
        <div className={cx(!isTouch && 'hidden md:block')}>
          <ControlsHint isTouch={isTouch} />
        </div>
        <nav aria-label={`${planet.title} content`} className="pointer-events-auto w-full">
          <ul
            data-hud-block
            className="scrollbar-thin mx-auto flex w-max max-w-full snap-x scroll-px-5 gap-2 overflow-x-auto pb-1"
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
                      'panel flex h-11 items-center gap-2.5 rounded-full pl-3.5 pr-4 transition-[border-color,background-color] duration-200 ease-out',
                      on
                        ? '!border-[color-mix(in_srgb,var(--accent)_70%,transparent)] !bg-space-700/90'
                        : 'hover:!border-[rgba(233,238,247,0.28)]',
                    )}
                  >
                    <AccentDot glow={on} className={cx(!on && 'opacity-60')} />
                    <span className="text-[14px] font-medium text-ink">{b.label}</span>
                    {mixedKinds && (
                      <>
                        {' '}
                        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted">
                          {KIND_LABEL[b.kind]}
                        </span>
                      </>
                    )}
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
