import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { beaconById, planetById } from '@/data/content';
import type { Beacon, Planet } from '@/types/content';
import { useAppStore } from '@/state/useAppStore';
import { BeaconBody } from './BeaconContent';
import { visitPlanet } from './navigation';
import { AccentDot, ArrowIcon, BackIcon, CloseIcon, EASE, KIND_LABEL, SAFE, cx, useNarrow, usePresence } from './primitives';

const SWAP_MS = 160;

const focusBeacon = (id: string) => {
  const s = useAppStore.getState();
  s.glideToBeacon(id);
  s.setFocusedBeacon(id);
};

const Pager = ({ planet, beacon }: { planet: Planet; beacon: Beacon }) => {
  const i = planet.beacons.findIndex((b) => b.id === beacon.id);
  const prev = planet.beacons[i - 1];
  const next = planet.beacons[i + 1];
  if (!prev && !next) return null;
  const btn = 'group flex min-w-0 items-center gap-2 rounded-full px-1 py-2 text-[13px] text-ink-muted transition-colors duration-200 hover:text-ink';
  return (
    <div className="flex items-center justify-between gap-4 border-t border-line px-6 py-2.5">
      {prev ? (
        <button type="button" className={btn} onClick={() => focusBeacon(prev.id)}>
          <BackIcon className="transition-transform duration-200 ease-out group-hover:-translate-x-0.5" />
          <span className="truncate">{prev.label}</span>
        </button>
      ) : (
        <span />
      )}
      {next && (
        <button type="button" className={btn} onClick={() => focusBeacon(next.id)}>
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

  const planet = planetById(activeId);
  const focused = mode === 'planet' ? beaconById(planet, focusedId) : undefined;
  const { mounted, visible } = usePresence(!!focused, 300);

  // crossfade between beacons: fade out, swap, fade in
  const [shown, setShown] = useState<{ planet: Planet; beacon: Beacon } | null>(null);
  const [swapping, setSwapping] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!focused || !planet) {
      setSwapping(false);
      return;
    }
    if (!shown || !visible) {
      setShown({ planet, beacon: focused });
      setSwapping(false);
      return;
    }
    if (shown.beacon.id === focused.id) return;
    setSwapping(true);
    const t = window.setTimeout(() => {
      setShown({ planet, beacon: focused });
      setSwapping(false);
      scroller.current?.scrollTo({ top: 0 });
    }, SWAP_MS);
    return () => window.clearTimeout(t);
  }, [focused?.id, planet?.id]); // keyed on ids on purpose

  if (!mounted || !shown) return null;
  const { beacon } = shown;
  const index = shown.planet.beacons.findIndex((b) => b.id === beacon.id) + 1;

  const enter: CSSProperties = narrow
    ? { transform: visible ? 'none' : 'translateY(24px)', opacity: visible ? 1 : 0 }
    : { transform: visible ? 'none' : 'translateX(16px)', opacity: visible ? 1 : 0 };

  return (
    <aside
      aria-label={`${beacon.label} details`}
      aria-hidden={readerOpen || undefined}
      className={cx(
        'panel pointer-events-auto absolute z-30 flex flex-col overflow-hidden',
        narrow ? 'inset-x-0 bottom-0 max-h-[70vh] rounded-t-2xl border-b-0' : 'rounded-2xl',
      )}
      style={{
        ...enter,
        transition: `transform 450ms ${EASE}, opacity 350ms ${EASE}`,
        ...({ '--accent': shown.planet.accent } as CSSProperties),
        ...(narrow
          ? { paddingBottom: 'env(safe-area-inset-bottom)' }
          : {
              right: SAFE.right,
              top: `calc(${SAFE.top} + 56px)`,
              maxHeight: `calc(100% - ${SAFE.top} - 56px - ${SAFE.bottom} - 72px)`,
              width: 'clamp(320px, 40vw, 420px)',
            }),
      }}
    >
      {narrow && <div aria-hidden="true" className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-white/20" />}
      <div className="flex shrink-0 items-center justify-between gap-3 px-6 pb-1 pt-4">
        <p className="label flex items-center gap-2">
          <AccentDot />
          <span>
            {KIND_LABEL[beacon.kind]} <span className="text-ink-faint">/ {index} of {shown.planet.beacons.length}</span>
          </span>
        </p>
        <button
          type="button"
          onClick={() => useAppStore.getState().setFocusedBeacon(null)}
          aria-label="Close"
          className="-mr-2 inline-flex h-9 w-9 items-center justify-center rounded-full text-ink-muted transition-colors duration-200 hover:bg-white/[0.06] hover:text-ink"
        >
          <CloseIcon />
        </button>
      </div>
      <div
        ref={scroller}
        className="scrollbar-thin min-h-0 flex-auto overflow-y-auto overscroll-contain px-6 pb-6 pt-3"
        style={{
          opacity: swapping ? 0 : 1,
          transform: swapping ? 'translateY(4px)' : 'none',
          transition: `opacity ${SWAP_MS}ms ${EASE}, transform ${SWAP_MS * 2}ms ${EASE}`,
        }}
      >
        <BeaconBody beacon={beacon} variant="panel" onProject={(pid, bid) => visitPlanet(pid, bid)} />
      </div>
      <Pager planet={shown.planet} beacon={beacon} />
    </aside>
  );
};

export default BeaconPanel;
