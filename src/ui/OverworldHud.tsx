import { useRef, type CSSProperties } from 'react';
import { planets, profile } from '@/data/content';
import { planetScreen } from '@/state/runtime';
import { useAppStore } from '@/state/useAppStore';
import {
  AccentDot,
  Button,
  ChevronIcon,
  EASE,
  EmailLink,
  HUD_ZOOM,
  Kbd,
  PageIcon,
  SAFE,
  cx,
  usePresence,
} from './primitives';
import { useScreenMarkers } from './useScreenMarkers';

const SAFE_BANDS = { top: 84, bottom: 104 };
/** Clears the hover reticle (about 1.15x the planet radius) with room to spare. */
const LABEL_GAP = (size: number) => size * 0.32 + 18;
/** Keep other labels off the hover reticle and off ring systems. */
const ringed = new Set(planets.filter((p) => p.rings).map((p) => p.id));
const EXTENT = (id: string, size: number) => ({ x: size * (ringed.has(id) ? 2.3 : 1.15), y: size * 1.15 });

const PlanetLabels = ({ hovered, isTouch }: { hovered: string | null; isTouch: boolean }) => {
  const setHovered = useAppStore((s) => s.setHoveredPlanet);
  const travelTo = useAppStore((s) => s.travelTo);
  const priorityId = useRef<string | null>(hovered);
  priorityId.current = hovered;
  const bind = useScreenMarkers(planetScreen, { safe: SAFE_BANDS, priorityId, gap: LABEL_GAP, extent: EXTENT });

  return (
    <div className="absolute inset-0 overflow-hidden">
      {planets.map((p, i) => {
        const isHover = hovered === p.id;
        const common = {
          onPointerEnter: () => !isTouch && setHovered(p.id),
          onPointerLeave: () => !isTouch && useAppStore.getState().hoveredPlanetId === p.id && setHovered(null),
          onClick: () => travelTo(p.id),
        };
        return (
          <div key={p.id} style={{ '--accent': p.accent } as CSSProperties}>
            <button
              ref={bind(p.id, 'anchor')}
              type="button"
              tabIndex={-1}
              aria-label={`Land on ${p.title}`}
              {...common}
              className="group pointer-events-auto absolute left-0 top-0 w-max rounded-lg bg-space/55 px-2.5 py-1.5 text-center backdrop-blur-sm"
              style={{ visibility: 'hidden' }}
            >
              {/* staggered reveal so the first overworld frame is calm */}
              <span
                className="flex animate-fade-in flex-col items-center"
                style={{ animationDelay: `${550 + i * 90}ms` }}
              >
                <span className="flex items-center gap-1.5">
                  <AccentDot glow={isHover} />
                  <span className="whitespace-nowrap font-display text-[17px] leading-none text-ink sm:text-[21px] min-[1921px]:text-[25px]">
                    {p.title}
                  </span>
                </span>
                <span className="label mt-1.5 whitespace-nowrap max-sm:hidden group-data-[compact=true]:hidden">
                  {p.subtitle}
                </span>
              </span>
              {/* hover detail: positioned outside the label so it never changes the label's size */}
              <span
                ref={bind(p.id, 'extra')}
                aria-hidden="true"
                className="pointer-events-none absolute left-1/2 top-full mt-2 w-[240px] rounded-lg bg-space/55 px-2.5 py-2 backdrop-blur-sm group-data-[up=true]:bottom-full group-data-[up=true]:top-auto group-data-[up=true]:mb-2 group-data-[up=true]:mt-0 max-sm:w-auto max-sm:whitespace-nowrap"
                style={{
                  opacity: isHover ? 1 : 0,
                  transform: `translate(-50%, ${isHover ? 0 : -4}px)`,
                  transition: `opacity 250ms ${EASE}, transform 350ms ${EASE}`,
                }}
              >
                <span className="block text-[13px] leading-snug text-ink/90 max-sm:hidden">{p.summary}</span>
                <span className="mt-1.5 block font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--accent)] max-sm:mt-0">
                  {isTouch ? 'Tap to land' : 'Click to land'}
                </span>
              </span>
            </button>
            <button
              ref={bind(p.id, 'edge')}
              type="button"
              tabIndex={-1}
              aria-label={`${p.title}, off screen. Land`}
              {...common}
              className="pointer-events-auto absolute left-0 top-0 flex items-center gap-1.5 rounded-full bg-space/60 px-2 py-1 data-[side=right]:flex-row-reverse"
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
      className={cx('absolute inset-x-0 flex justify-center px-3', HUD_ZOOM)}
      style={{ bottom: SAFE.bottom }}
    >
      <ul className="panel pointer-events-auto flex max-w-full items-stretch gap-0.5 rounded-2xl p-1 sm:rounded-full">
        {planets.map((p) => {
          const on = hovered === p.id;
          return (
            <li key={p.id} className="relative" style={{ '--accent': p.accent } as CSSProperties}>
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
                {!isTouch && (
                  <Kbd
                    className={cx(
                      'hidden sm:inline-flex',
                      on && 'border-[color-mix(in_srgb,var(--accent)_50%,transparent)]',
                    )}
                  >
                    {p.index}
                  </Kbd>
                )}
                <AccentDot glow={on} className={cx(!isTouch && 'sm:hidden')} />
                <span
                  className={cx(
                    'text-[12px] font-medium transition-colors duration-200 sm:text-[13px]',
                    on ? 'text-ink' : 'text-ink/80',
                  )}
                >
                  {p.title}
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
        className={cx('absolute inset-x-0 top-0 flex items-start justify-between gap-4', HUD_ZOOM)}
        style={{ paddingTop: SAFE.top, paddingLeft: SAFE.left, paddingRight: SAFE.right }}
      >
        <div className="pointer-events-none select-none">
          <p className="font-display text-[24px] leading-none text-ink">{profile.name}</p>
          <p className="label mt-1.5">{profile.role}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <EmailLink email={profile.email} name={profile.name} />
          <Button size="sm" onClick={() => openReader()} aria-label="Read as a page">
            <PageIcon className="text-ink-muted" />
            <span className="sm:hidden">Read</span>
            <span className="hidden sm:inline">Read as page</span>
            {!isTouch && <Kbd className="ml-0.5 hidden md:inline-flex">R</Kbd>}
          </Button>
        </div>
      </header>

      <Dock hovered={hovered} isTouch={isTouch} />
    </div>
  );
};

export default OverworldHud;
