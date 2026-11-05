import type { CSSProperties } from 'react';
import { planets, profile } from '@/data/content';
import { planetScreen } from '@/state/runtime';
import { useAppStore } from '@/state/useAppStore';
import { AccentDot, Button, ChevronIcon, EASE, Kbd, PageIcon, SAFE, cx, usePresence } from './primitives';
import { useScreenMarkers } from './useScreenMarkers';

const EDGE_MARGIN = { top: 96, right: 20, bottom: 120, left: 20 };

const PlanetLabels = ({ hovered, isTouch }: { hovered: string | null; isTouch: boolean }) => {
  const setHovered = useAppStore((s) => s.setHoveredPlanet);
  const travelTo = useAppStore((s) => s.travelTo);
  const bind = useScreenMarkers(planetScreen, { margin: EDGE_MARGIN, flip: true });

  return (
    <div className="absolute inset-0 overflow-hidden">
      {planets.map((p) => {
        const isHover = hovered === p.id;
        const accent = { '--accent': p.accent } as CSSProperties;
        const common = {
          onPointerEnter: () => !isTouch && setHovered(p.id),
          onPointerLeave: () => !isTouch && useAppStore.getState().hoveredPlanetId === p.id && setHovered(null),
          onClick: () => travelTo(p.id),
        };
        return (
          <div key={p.id} style={accent}>
            <button
              ref={bind(p.id, 'anchor')}
              type="button"
              tabIndex={-1}
              aria-label={`Land on ${p.title}`}
              {...common}
              className="group pointer-events-auto absolute left-0 top-0 flex max-w-[min(260px,45vw)] flex-col gap-1 rounded-md px-2 py-1.5 text-left data-[side=left]:items-end data-[side=left]:text-right"
              style={{ visibility: 'hidden' }}
            >
              <span className="flex items-center gap-2 group-data-[side=left]:flex-row-reverse">
                <AccentDot glow={isHover} />
                <span className="font-display text-[22px] leading-none text-ink">{p.title}</span>
              </span>
              <span className="label">{p.subtitle}</span>
              <span
                className="grid transition-[grid-template-rows,opacity] duration-300 ease-out"
                style={{ gridTemplateRows: isHover ? '1fr' : '0fr', opacity: isHover ? 1 : 0 }}
              >
                <span className="overflow-hidden">
                  <span className="block pt-1.5 text-[13px] leading-snug text-ink/85">{p.summary}</span>
                  <span className="mt-2 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--accent)]">
                    {isTouch ? 'Tap to land' : 'Click to land'}
                  </span>
                </span>
              </span>
            </button>
            <button
              ref={bind(p.id, 'edge')}
              type="button"
              tabIndex={-1}
              aria-label={`${p.title}, off screen. Land`}
              {...common}
              className="pointer-events-auto absolute left-0 top-0 flex items-center gap-1.5 rounded-full px-1.5 py-1 data-[side=right]:flex-row-reverse"
              style={{ visibility: 'hidden' }}
            >
              <span ref={bind(p.id, 'arrow')} className="inline-flex text-[var(--accent)]">
                <ChevronIcon />
              </span>
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">{p.title}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
};

const Dock = ({ hovered, isTouch }: { hovered: string | null; isTouch: boolean }) => {
  const setHovered = useAppStore((s) => s.setHoveredPlanet);
  const travelTo = useAppStore((s) => s.travelTo);
  return (
    <nav
      aria-label="Planets"
      className="absolute inset-x-0 flex justify-center px-3"
      style={{ bottom: SAFE.bottom }}
    >
      <ul className="panel pointer-events-auto flex max-w-full items-stretch gap-0.5 rounded-2xl p-1 sm:rounded-full">
        {planets.map((p) => {
          const on = hovered === p.id;
          return (
            <li key={p.id} style={{ '--accent': p.accent } as CSSProperties}>
              <button
                type="button"
                onClick={() => travelTo(p.id)}
                onPointerEnter={() => !isTouch && setHovered(p.id)}
                onPointerLeave={() => !isTouch && setHovered(null)}
                onFocus={() => setHovered(p.id)}
                onBlur={() => setHovered(null)}
                aria-label={`${p.title}: ${p.subtitle}. Press ${p.index}`}
                className={cx(
                  'flex h-12 flex-col items-center justify-center gap-1.5 rounded-xl px-2.5 transition-colors duration-200 ease-out sm:h-10 sm:flex-row sm:gap-2 sm:rounded-full sm:px-3',
                  on ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]',
                )}
              >
                {!isTouch && <Kbd className={cx('hidden sm:inline-flex', on && 'border-[color-mix(in_srgb,var(--accent)_50%,transparent)]')}>{p.index}</Kbd>}
                <AccentDot glow={on} className={cx(!isTouch && 'sm:hidden')} />
                <span className={cx('text-[12px] font-medium transition-colors duration-200 sm:text-[13px]', on ? 'text-ink' : 'text-ink/80')}>
                  {p.title}
                </span>
                <span
                  className="hidden overflow-hidden whitespace-nowrap font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--accent)] lg:inline-block"
                  style={{
                    maxWidth: on ? 180 : 0,
                    opacity: on ? 1 : 0,
                    transition: `max-width 350ms ${EASE}, opacity 250ms ${EASE}`,
                  }}
                >
                  {p.subtitle}
                </span>
                {!isTouch && <AccentDot className="hidden sm:inline-block" glow={on} />}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};

const OverworldHud = () => {
  const mode = useAppStore((s) => s.mode);
  const hovered = useAppStore((s) => s.hoveredPlanetId);
  const isTouch = useAppStore((s) => s.isTouch);
  const readerOpen = useAppStore((s) => s.readerOpen);
  const openReader = useAppStore((s) => s.openReader);
  const { mounted, visible } = usePresence(mode === 'overworld', 300);
  if (!mounted) return null;

  const fade: CSSProperties = {
    opacity: visible ? 1 : 0,
    transition: `opacity ${visible ? 600 : 250}ms ${EASE} ${visible ? 250 : 0}ms`,
  };

  return (
    <div className="absolute inset-0" style={fade} aria-hidden={readerOpen || undefined}>
      <PlanetLabels hovered={hovered} isTouch={isTouch} />

      <header
        className="absolute inset-x-0 top-0 flex items-start justify-between gap-4"
        style={{ paddingTop: SAFE.top, paddingLeft: SAFE.left, paddingRight: SAFE.right }}
      >
        <div className="pointer-events-none select-none">
          <p className="font-display text-[24px] leading-none text-ink">{profile.name}</p>
          <p className="label mt-1.5">{profile.role}</p>
        </div>
        <Button size="sm" onClick={() => openReader()} aria-label="Read as a page">
          <PageIcon className="text-ink-muted" />
          <span className="sm:hidden">Read</span>
          <span className="hidden sm:inline">Read as page</span>
          {!isTouch && <Kbd className="ml-0.5 hidden md:inline-flex">R</Kbd>}
        </Button>
      </header>

      <Dock hovered={hovered} isTouch={isTouch} />
    </div>
  );
};

export default OverworldHud;
