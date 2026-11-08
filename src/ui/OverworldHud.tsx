import { useRef, type CSSProperties } from 'react';
import { planets, profile } from '@/data/content';
import { planetScreen } from '@/state/runtime';
import { useAppStore } from '@/state/useAppStore';
import {
  DISPLAY,
  FLOAT_TEXT,
  Button,
  ChevronIcon,
  EASE,
  HUD_ZOOM,
  IN_WORLD,
  Kbd,
  PageIcon,
  SAFE,
  cx,
  usePresence,
  useTiny,
} from './primitives';
import { useScreenMarkers } from './useScreenMarkers';
import DashControls, { SoundToggle } from './DashControls';
import AlienName from './AlienName';

const SAFE_BANDS = { top: 84, bottom: 104 };
/** Clears the hover reticle (about 1.15x the planet radius) with room to spare. */
const LABEL_GAP = (size: number) => size * 0.32 + 18;
/** Keep other labels off the hover reticle and off ring systems. */
const ringed = new Set(planets.filter((p) => p.rings).map((p) => p.id));
const EXTENT = (id: string, size: number) => ({ x: size * (ringed.has(id) ? 2.3 : 1.15), y: size * 1.15 });

/** After the arrival the names fade up one by one, from this long after the HUD starts to show */
const LABEL_DELAY_MS = 500;
const LABEL_STAGGER_MS = 220;
const LABEL_FADE_MS = 1400;

const PlanetLabels = ({ hovered, isTouch }: { hovered: string | null; isTouch: boolean }) => {
  const intro = useAppStore((s) => s.intro);
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
              className={cx(
                IN_WORLD,
                'group pointer-events-auto absolute left-0 top-0 w-max px-2.5 py-1.5 text-center transition-colors duration-200 ease-out',
                // hover reads as the planet's accent rather than extra text
                isHover ? 'text-[var(--accent)]' : 'text-ink',
              )}
              style={{ visibility: 'hidden' }}
            >
              {/* staggered reveal so the first overworld frame is calm; the name translates out of runes */}
              <span className="block animate-fade-in" style={{ animationDelay: `${550 + i * 90}ms` }}>
                <span
                  className="block"
                  style={{
                    opacity: intro ? 0 : 1,
                    filter: intro ? 'blur(3px)' : 'none',
                    transition: `opacity ${LABEL_FADE_MS}ms ${EASE} ${LABEL_DELAY_MS + i * LABEL_STAGGER_MS}ms, filter ${LABEL_FADE_MS}ms ${EASE} ${LABEL_DELAY_MS + i * LABEL_STAGGER_MS}ms`,
                  }}
                >
                  <AlienName text={p.title} active={isHover} delay={LABEL_DELAY_MS + i * LABEL_STAGGER_MS} />
                </span>
              </span>
            </button>
            <button
              ref={bind(p.id, 'edge')}
              type="button"
              tabIndex={-1}
              aria-label={`Go to ${p.title} (off screen)`}
              {...common}
              className={cx(
                IN_WORLD,
                'pointer-events-auto absolute left-0 top-0 flex items-center gap-1.5 px-2 py-1 data-[side=right]:flex-row-reverse',
              )}
              style={{ visibility: 'hidden' }}
            >
              <span ref={bind(p.id, 'arrow')} className="inline-flex text-[var(--accent)]">
                <ChevronIcon />
              </span>
              <span className="text-[13px] font-medium text-ink-muted">{p.title}</span>
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
    // short screens have no room under the console: the dock moves up into the top bar
    <nav
      aria-label="Planets"
      className={cx(
        'pointer-events-none absolute inset-x-0 flex justify-center px-3',
        'bottom-[max(16px,env(safe-area-inset-bottom))] [@media(max-height:500px)]:bottom-auto [@media(max-height:500px)]:top-[max(18px,env(safe-area-inset-top))]',
        // too narrow to centre between the name and the page button: sit against the button
        '[@media(max-height:500px)_and_(max-width:639px)]:justify-end [@media(max-height:500px)_and_(max-width:639px)]:pr-[calc(max(20px,env(safe-area-inset-right))+44px)]',
        HUD_ZOOM,
      )}
    >
      <ul className={cx('pointer-events-auto flex max-w-full items-stretch gap-1 sm:gap-3', FLOAT_TEXT)}>
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
                aria-label={p.title}
                aria-keyshortcuts={String(p.index)}
                className="flex h-12 items-center justify-center gap-2 px-2 sm:h-10"
              >
                <span
                  className={cx(
                    'text-[13px] font-medium transition-colors duration-200 sm:text-[14px]',
                    on ? 'text-[var(--accent)]' : 'text-ink/80',
                  )}
                >
                  {p.title}
                </span>
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
  const tiny = useTiny();
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
        className={cx('absolute inset-x-0 top-0 flex items-start justify-between gap-2', HUD_ZOOM)}
        style={{ paddingTop: SAFE.top, paddingLeft: SAFE.left, paddingRight: SAFE.right }}
      >
        <div className="pointer-events-none select-none">
          <p className={cx('whitespace-nowrap font-display leading-none text-ink', DISPLAY.d24, FLOAT_TEXT)}>{profile.name}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          {tiny && <SoundToggle className="relative" />}
          <Button
            size="sm"
            onClick={() => openReader()}
            aria-label="Read as page"
            className="max-sm:w-9 max-sm:justify-center"
          >
            <PageIcon className="text-ink-muted max-sm:text-ink" />
            <span className="hidden sm:inline">Read as page</span>
            {!isTouch && <Kbd className="ml-0.5 hidden md:inline-flex">R</Kbd>}
          </Button>
        </div>
      </header>

      <Dock hovered={hovered} isTouch={isTouch} />
      <DashControls />
    </div>
  );
};

export default OverworldHud;
