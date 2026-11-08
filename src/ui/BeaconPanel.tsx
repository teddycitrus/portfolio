import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { beaconById, planetById } from '@/data/content';
import type { Beacon, Planet } from '@/types/content';
import { useAppStore } from '@/state/useAppStore';
import { BeaconBody } from './BeaconContent';
import { openBeacon, panelFocusIntent, visitPlanet } from './navigation';
import {
  ArrowIcon,
  BackIcon,
  CloseIcon,
  EASE,
  HUD_ZOOM,
  SAFE,
  cx,
  useNarrow,
  usePanelView,
  useShort,
  usePresence,
} from './primitives';

const SWAP_MS = 160;

const Pager = ({ planet, beacon }: { planet: Planet; beacon: Beacon }) => {
  const i = planet.beacons.findIndex((b) => b.id === beacon.id);
  const prev = planet.beacons[i - 1];
  const next = planet.beacons[i + 1];
  if (!prev && !next) return null;
  const btn =
    'group flex min-w-0 items-center gap-2 rounded-full px-1 py-2 text-[13px] text-ink-muted transition-colors duration-200 hover:text-ink';
  return (
    <div className="flex items-center justify-between gap-4 border-t border-line px-6 py-2.5">
      {prev ? (
        <button type="button" className={btn} onClick={() => openBeacon(prev.id)}>
          <BackIcon className="transition-transform duration-200 ease-out group-hover:-translate-x-0.5" />
          <span className="truncate">{prev.label}</span>
        </button>
      ) : (
        <span />
      )}
      {next && (
        <button type="button" className={btn} onClick={() => openBeacon(next.id)}>
          <span className="truncate">{next.label}</span>
          <ArrowIcon className="transition-transform duration-200 ease-out group-hover:translate-x-0.5" />
        </button>
      )}
    </div>
  );
};

const BeaconPanel = () => {
  const mode = useAppStore((s) => s.mode);
  const activeId = useAppStore((s) => s.activePlanetId);
  const focusedId = useAppStore((s) => s.focusedBeaconId);
  const readerOpen = useAppStore((s) => s.readerOpen);
  const narrow = useNarrow();
  const short = useShort();
  const panelView = usePanelView();

  const planet = planetById(activeId);
  const focused = mode === 'planet' ? beaconById(planet, focusedId) : undefined;
  // wide screens show the content on in-world screens around the monument; phones keep this
  // sheet, and short landscape screens a side panel
  const { mounted, visible } = usePresence(!!focused && panelView, 300);

  // crossfade between beacons: fade out, swap, fade in
  const [shown, setShown] = useState<{ planet: Planet; beacon: Beacon } | null>(null);
  const [swapping, setSwapping] = useState(false);
  // phone sheet opens compact; handle tap, drag up or scrolling expands it
  const [expanded, setExpanded] = useState(false);
  const dragY = useRef<number | null>(null);
  const dragged = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);

  const aside = useRef<HTMLElement>(null);
  const lastId = useRef<string | null>(null);

  useEffect(() => {
    if (!focused || !planet) {
      // closing with focus inside the panel: hand focus back to its chip
      if (lastId.current && aside.current?.contains(document.activeElement)) {
        document.querySelector<HTMLElement>(`[data-beacon-chip="${lastId.current}"]`)?.focus();
      }
      lastId.current = null;
      setSwapping(false);
      return;
    }
    if (!shown || !visible) {
      lastId.current = focused.id;
      setShown({ planet, beacon: focused });
      setSwapping(false);
      setExpanded(false);
      return;
    }
    lastId.current = focused.id;
    if (shown.beacon.id === focused.id) return;
    setSwapping(true);
    const t = window.setTimeout(() => {
      setShown({ planet, beacon: focused });
      setSwapping(false);
      scroller.current?.scrollTo({ top: 0 });
    }, SWAP_MS);
    return () => window.clearTimeout(t);
  }, [focused?.id, planet?.id]); // keyed on ids on purpose

  // deliberate opens (click, Enter) move focus to the heading once content is in place
  useEffect(() => {
    if (!shown || swapping || panelFocusIntent.id !== shown.beacon.id) return;
    panelFocusIntent.id = null;
    const r = requestAnimationFrame(() =>
      aside.current?.querySelector<HTMLElement>('[data-panel-heading]')?.focus({ preventScroll: true }),
    );
    return () => cancelAnimationFrame(r);
  }, [shown, swapping]);

  const live = (
    <p className="sr-only" aria-live="polite">
      {focused && shown ? `Showing ${shown.beacon.label}` : ''}
    </p>
  );
  if (!mounted || !shown || !panelView) return live;
  const { beacon } = shown;

  const enter: CSSProperties = narrow
    ? { transform: visible ? 'none' : 'translateY(24px)', opacity: visible ? 1 : 0 }
    : { transform: visible ? 'none' : 'translateX(16px)', opacity: visible ? 1 : 0 };

  return (
    <>
      {live}
      <aside
        ref={aside}
        data-hud-block
        data-beacon-panel
        aria-label={`${beacon.label} details`}
        aria-hidden={readerOpen || undefined}
        className={cx(
          'panel pointer-events-auto absolute z-30 flex flex-col overflow-hidden',
          narrow ? 'inset-x-0 bottom-0 mx-auto max-w-[720px] rounded-t-2xl border-b-0' : 'rounded-2xl',
        )}
        style={{
          ...enter,
          transition: `transform 450ms ${EASE}, opacity 350ms ${EASE}, max-height 450ms ${EASE}`,
          ...({ '--accent': shown.planet.accent } as CSSProperties),
          ...(narrow
            ? {
                paddingBottom: 'env(safe-area-inset-bottom)',
                // dvh: the visible height, so the sheet top never hides under the browser's URL bar
                maxHeight: expanded ? '88dvh' : 'min(88dvh, max(46dvh, 300px))',
              }
            : {
                right: SAFE.right,
                top: `calc(${SAFE.top} + 56px * var(--hud-zoom, 1))`,
                // short landscape: run to the bottom edge (the chips move left of the panel)
                maxHeight: short
                  ? `calc(100% - ${SAFE.top} - ${SAFE.bottom} - 56px)`
                  : `calc(100% - ${SAFE.top} - ${SAFE.bottom} - 128px * var(--hud-zoom, 1))`,
                width: short ? '360px' : 'clamp(320px, 40vw, calc(420px * var(--hud-zoom, 1)))',
              }),
        }}
      >
        {narrow && (
          <button
            type="button"
            aria-label={expanded ? 'Collapse details' : 'Expand details'}
            aria-expanded={expanded}
            className="flex h-6 w-full shrink-0 touch-none items-end justify-center"
            onPointerDown={(e) => {
              dragY.current = e.clientY;
              dragged.current = false;
            }}
            onPointerUp={(e) => {
              const start = dragY.current;
              dragY.current = null;
              const dy = start === null ? 0 : e.clientY - start;
              if (Math.abs(dy) <= 24) return; // a tap; onClick toggles
              dragged.current = true;
              if (dy < 0) setExpanded(true);
              else if (expanded) setExpanded(false);
              else useAppStore.getState().setFocusedBeacon(null);
            }}
            onClick={() => {
              // also reached by keyboard, screen readers and switch access
              if (dragged.current) {
                dragged.current = false;
                return;
              }
              setExpanded((v) => !v);
            }}
          >
            <span className="h-1 w-10 rounded-full bg-white/25" />
          </button>
        )}
        {/* close floats top-right; the heading leaves room for it */}
        <div className={cx('absolute z-10', narrow ? 'right-3 top-5' : 'right-3 top-3', HUD_ZOOM)}>
          <button
            type="button"
            onClick={() => useAppStore.getState().setFocusedBeacon(null)}
            aria-label="Close"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-ink-muted transition-colors duration-200 hover:bg-white/[0.06] hover:text-ink"
          >
            <CloseIcon />
          </button>
        </div>
        <div
          ref={scroller}
          onScroll={(e) => {
            if (narrow && !expanded && e.currentTarget.scrollTop > 24) setExpanded(true);
          }}
          className={cx(
            'scrollbar-thin min-h-[160px] flex-auto overflow-y-auto overscroll-contain pb-8 [@media(max-height:500px)]:min-h-[110px] [&_[data-panel-heading]]:pr-10',
            narrow ? 'pt-3' : 'pt-6',
            narrow ? 'px-5' : 'px-6',
          )}
          style={{
            // fade the last 24px to hint at more content
            maskImage: 'linear-gradient(to bottom, #000 calc(100% - 24px), transparent)',
            WebkitMaskImage: 'linear-gradient(to bottom, #000 calc(100% - 24px), transparent)',
            opacity: swapping ? 0 : 1,
            transform: swapping ? 'translateY(4px)' : 'none',
            transition: `opacity ${SWAP_MS}ms ${EASE}, transform ${SWAP_MS * 2}ms ${EASE}`,
          }}
        >
          <div className={HUD_ZOOM}>
            <BeaconBody beacon={beacon} variant="panel" onProject={(pid, bid) => visitPlanet(pid, bid, true)} />
          </div>
        </div>
        <div className={HUD_ZOOM}>
          <Pager planet={shown.planet} beacon={beacon} />
        </div>
      </aside>
    </>
  );
};

export default BeaconPanel;
