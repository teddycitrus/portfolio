import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { planetById, planets } from '@/data/content';
import type { Planet } from '@/types/content';
import { beaconScreen, dragLook, isKeyDown } from '@/state/runtime';
import { useAppStore } from '@/state/useAppStore';
import {
  AccentDot,
  BackIcon,
  Button,
  ChevronIcon,
  EASE,
  KIND_LABEL,
  Kbd,
  PageIcon,
  SAFE,
  cx,
  usePresence,
} from './primitives';
import { useScreenMarkers } from './useScreenMarkers';

const MOVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
const EDGE_MARGIN = { top: 150, right: 20, bottom: 130, left: 20 };

const focusBeacon = (id: string) => {
  const s = useAppStore.getState();
  s.glideToBeacon(id);
  s.setFocusedBeacon(id);
};

/** Floating dots on the beacons plus edge arrows for the ones out of view. */
const BeaconMarkers = ({ planet, focused }: { planet: Planet; focused: string | null }) => {
  const hiddenId = useRef<string | null>(focused);
  hiddenId.current = focused;
  const bind = useScreenMarkers(beaconScreen, { margin: EDGE_MARGIN, hiddenId });

  return (
    <div className="absolute inset-0 overflow-hidden">
      {planet.beacons.map((b) => (
        <div key={b.id}>
          <button
            ref={bind(b.id, 'anchor')}
            type="button"
            tabIndex={-1}
            onClick={() => focusBeacon(b.id)}
            aria-label={`Open ${b.label}`}
            className="group pointer-events-auto absolute left-0 top-0 -ml-[11px] flex items-center gap-2 rounded-full py-1 pl-2 pr-2.5"
            style={{ visibility: 'hidden' }}
          >
            <span className="relative flex h-2 w-2 items-center justify-center">
              <span className="absolute h-5 w-5 rounded-full border border-[color-mix(in_srgb,var(--accent)_45%,transparent)] transition-transform duration-300 ease-out group-hover:scale-125" />
              <AccentDot className="h-2 w-2" />
            </span>
            <span className="rounded bg-space/55 px-1.5 py-0.5 text-[13px] font-medium text-ink transition-colors duration-200 group-hover:text-[var(--accent)]">
              {b.label}
            </span>
          </button>
          <button
            ref={bind(b.id, 'edge')}
            type="button"
            tabIndex={-1}
            onClick={() => focusBeacon(b.id)}
            aria-label={`${b.label}, out of view. Go there`}
            className="pointer-events-auto absolute left-0 top-0 flex items-center gap-1.5 rounded-full px-1.5 py-1 data-[side=right]:flex-row-reverse"
            style={{ visibility: 'hidden' }}
          >
            <span ref={bind(b.id, 'arrow')} className="inline-flex text-[var(--accent)]">
              <ChevronIcon />
            </span>
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">{b.label}</span>
          </button>
        </div>
      ))}
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
      <Button ref={trigger} size="sm" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((v) => !v)}>
        Travel
        <ChevronIcon className={cx('text-ink-muted transition-transform duration-200 ease-out', open ? '-rotate-90' : 'rotate-90')} />
      </Button>
      {open && (
        <ul className="panel pointer-events-auto absolute right-0 top-full mt-2 w-56 animate-fade-in rounded-xl p-1.5">
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

/** Desktop controls hint, gone after the first move or 8 seconds. */
const ControlsHint = () => {
  const [show, setShow] = useState(true);
  useEffect(() => {
    const t = window.setTimeout(() => setShow(false), 8000);
    const i = window.setInterval(() => {
      if (isKeyDown(...MOVE_KEYS) || dragLook.dragging) setShow(false);
    }, 150);
    return () => {
      window.clearTimeout(t);
      window.clearInterval(i);
    };
  }, []);
  return (
    <p
      aria-hidden="true"
      className="label flex items-center justify-center gap-4 normal-case tracking-[0.04em]"
      style={{ opacity: show ? 1 : 0, transition: `opacity 600ms ${EASE}` }}
    >
      <span className="flex items-center gap-1.5">
        <Kbd>W</Kbd>
        <Kbd>A</Kbd>
        <Kbd>S</Kbd>
        <Kbd>D</Kbd> move
      </span>
      <span>Drag to look</span>
      <span className="flex items-center gap-1.5">
        <Kbd>Esc</Kbd> back
      </span>
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

  const fade: CSSProperties = {
    opacity: visible ? 1 : 0,
    transition: `opacity ${visible ? 600 : 250}ms ${EASE} ${visible ? 350 : 0}ms`,
    '--accent': planet.accent,
  } as CSSProperties;

  return (
    <div className="absolute inset-0" style={fade} aria-hidden={readerOpen || undefined}>
      <BeaconMarkers planet={planet} focused={focused} />

      <header className="absolute inset-x-0 top-0" style={{ paddingTop: SAFE.top, paddingLeft: SAFE.left, paddingRight: SAFE.right }}>
        <div className="flex items-center justify-between gap-2">
          <Button size="sm" onClick={exitPlanet} aria-label="Back to orbit">
            <BackIcon className="text-ink-muted" />
            <span className="sm:hidden">Orbit</span>
            <span className="hidden sm:inline">Back to orbit</span>
            {!isTouch && <Kbd className="ml-0.5 hidden md:inline-flex">Q</Kbd>}
          </Button>
          <div className="flex items-center gap-2">
            <TravelMenu current={planet.id} isTouch={isTouch} />
            <Button size="sm" onClick={() => openReader(planet.id)} aria-label="Read as a page">
              <PageIcon className="text-ink-muted" />
              <span className="sm:hidden">Read</span>
              <span className="hidden sm:inline">Read as page</span>
              {!isTouch && <Kbd className="ml-0.5 hidden md:inline-flex">R</Kbd>}
            </Button>
          </div>
        </div>
        <div className="mt-5 w-max max-w-full select-none pl-1">
          <p className="label flex items-center gap-2">
            <AccentDot />
            <span>
              {String(planet.index).padStart(2, '0')} / {planet.subtitle}
            </span>
          </p>
          <h1 className="mt-1.5 font-display text-[34px] font-normal leading-none text-ink md:text-[40px]">{planet.title}</h1>
        </div>
      </header>

      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-3" style={{ paddingBottom: SAFE.bottom }}>
        {!isTouch && (
          <div className="hidden md:block">
            <ControlsHint />
          </div>
        )}
        <nav aria-label={`${planet.title} content`} className="pointer-events-auto w-full">
          <ul
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
                    onClick={() => focusBeacon(b.id)}
                    className={cx(
                      'panel flex h-11 items-center gap-2.5 rounded-full pl-3.5 pr-4 transition-[border-color,background-color] duration-200 ease-out',
                      on ? '!border-[color-mix(in_srgb,var(--accent)_70%,transparent)] !bg-space-700/90' : 'hover:!border-[rgba(233,238,247,0.28)]',
                    )}
                  >
                    <AccentDot glow={on} className={cx(!on && 'opacity-60')} />
                    <span className="text-[14px] font-medium text-ink">{b.label}</span>
                    <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted">
                      {KIND_LABEL[b.kind]}
                    </span>
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
