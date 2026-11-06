import { useEffect, useRef, type CSSProperties } from 'react';
import { planetById } from '@/data/content';
import { dragLook, isKeyDown, joystickState } from '@/state/runtime';
import { useAppStore } from '@/state/useAppStore';
import { ArrowIcon, BackIcon, Button, EASE, SAFE, cx, useNarrow, usePresence } from './primitives';
import { useContact } from './contact';
import { TOUR_DWELL_MS, TOUR_STOPS, useTour } from './tour';

const MOVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
/** Scrolling or pressing inside the panel holds the dwell this long */
const HOLD_MS = 4000;
/** A focus change within this long of real input counts as the visitor taking over */
const INPUT_WINDOW_MS = 1200;

const PauseIcon = ({ playing }: { playing: boolean }) => (
  <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0" fill="currentColor">
    {playing ? <path d="M4.5 3h2.5v10H4.5zM9 3h2.5v10H9z" /> : <path d="M5 3.2v9.6L12.6 8z" />}
  </svg>
);

/**
 * Watches the app while the tour runs: marks arrival at each stop, and ends
 * the tour when the visitor takes over (travels elsewhere, walks, picks
 * another beacon, opens the reader). Esc ends only the tour.
 */
const useTourController = (active: boolean) => {
  useEffect(() => {
    if (!active) return;
    const tour = useTour.getState;
    let lastInput = 0;
    const onInput = () => (lastInput = performance.now());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // capture phase on window runs before the global shortcut handler
        e.stopPropagation();
        e.preventDefault();
        tour().end();
        return;
      }
      onInput();
    };

    const check = () => {
      const t = tour();
      if (!t.active) return;
      const s = useAppStore.getState();
      const stop = TOUR_STOPS[t.index];
      if (s.readerOpen) return t.end();
      const off =
        (s.mode === 'planet' && s.activePlanetId !== stop.planetId) ||
        (s.mode === 'transitioning-in' && s.lockedPlanetId !== stop.planetId) ||
        (s.mode === 'transitioning-out' && s.pendingPlanetId !== stop.planetId) ||
        s.mode === 'overworld';
      if (off && t.phase !== 'end') return t.end();
      if (s.mode !== 'planet') return;
      if (t.phase === 'travel' && s.focusedBeaconId === stop.beaconId) return t.arrived();
      if (t.phase !== 'travel' && s.focusedBeaconId !== stop.beaconId) {
        // ignore focus moved by the scene itself (gaze); end when the visitor did it
        if (performance.now() - lastInput < INPUT_WINDOW_MS || s.focusedBeaconId === null) t.end();
      }
    };
    const unsub = useAppStore.subscribe(check);

    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onInput, true);
    window.addEventListener('wheel', onInput, true);
    return () => {
      unsub();
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onInput, true);
      window.removeEventListener('wheel', onInput, true);
    };
  }, [active]);
};

const TourBar = () => {
  const active = useTour((s) => s.active);
  const index = useTour((s) => s.index);
  const phase = useTour((s) => s.phase);
  const paused = useTour((s) => s.paused);
  const stamp = useTour((s) => s.stamp);
  const reduced = useAppStore((s) => s.reducedMotion);
  const narrow = useNarrow();
  const { mounted, visible } = usePresence(active, 300);
  useTourController(active);

  const bar = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLDivElement>(null);
  const nextBtn = useRef<HTMLButtonElement>(null);
  const endBtn = useRef<HTMLButtonElement>(null);
  /** Focus was in the bar (removed elements fire no blur, so this survives re-renders) */
  const focusInside = useRef(false);

  // focus Next when the tour starts, the first end-card action at the end
  useEffect(() => {
    if (!mounted || !active) return;
    const r = requestAnimationFrame(() => nextBtn.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(r);
  }, [mounted, active]);
  useEffect(() => {
    if (phase === 'end') endBtn.current?.focus({ preventScroll: true });
  }, [phase]);
  // ending with focus in the bar: hand it to the open beacon's chip so keyboard users are not dropped
  useEffect(() => {
    if (active || !focusInside.current) return;
    focusInside.current = false;
    const id = useAppStore.getState().focusedBeaconId;
    const chip = id ? document.querySelector<HTMLElement>(`[data-beacon-chip="${id}"]`) : null;
    (chip ?? document.querySelector<HTMLElement>('[data-panel-heading]'))?.focus({ preventScroll: true });
  }, [active]);

  // dwell clock, holds, takeover by walking, and placement next to the panel or sheet
  useEffect(() => {
    if (!mounted) return;
    let raf = 0;
    let last = performance.now();
    let elapsed = 0;
    let holdUntil = 0;
    let frame = 0;

    const onScroll = (e: Event) => {
      const el = e.target as Element | null;
      if (el instanceof Element && el.closest('[data-beacon-panel]')) holdUntil = performance.now() + HOLD_MS;
    };
    const onPress = (e: PointerEvent) => {
      if ((e.target as Element | null)?.closest?.('[data-beacon-panel]')) holdUntil = performance.now() + HOLD_MS;
    };
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('pointerdown', onPress, true);

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const now = performance.now();
      // capped so a backgrounded tab does not skip a stop on return
      const dt = Math.min(500, now - last);
      last = now;
      const t = useTour.getState();
      const s = useAppStore.getState();

      if (t.active && (isKeyDown(...MOVE_KEYS) || joystickState.active)) {
        t.end();
        return;
      }
      if (dragLook.dragging) holdUntil = Math.max(holdUntil, now + 1500);

      const hovering =
        !s.isTouch && (!!bar.current?.matches(':hover') || !!document.querySelector('[data-beacon-panel]:hover'));
      const running = t.active && t.phase === 'dwell' && !t.paused && !hovering && now > holdUntil;
      if (running) elapsed += dt;
      if (line.current) {
        const k = t.phase === 'dwell' ? Math.min(1, elapsed / TOUR_DWELL_MS) : t.phase === 'end' ? 1 : 0;
        line.current.style.transform = `scaleX(${k.toFixed(4)})`;
      }
      if (running && elapsed >= TOUR_DWELL_MS) {
        elapsed = 0;
        t.next();
      }

      // placement: above the chips, left of the desktop panel, or above the phone sheet
      if (bar.current && frame++ % 6 === 0) {
        const panel = document.querySelector<HTMLElement>('[data-beacon-panel]:not([data-beacon-screen])');
        const r = panel?.getBoundingClientRect();
        const zoom = parseFloat(getComputedStyle(bar.current).getPropertyValue('--hud-zoom')) || 1;
        const st = bar.current.style;
        if (narrow) {
          st.left = '12px';
          st.right = '12px';
          st.bottom = r && r.height ? `${Math.round(window.innerHeight - r.top + 8)}px` : SAFE.bottom;
        } else {
          st.left = SAFE.left;
          st.right = r && r.width ? `${Math.round(window.innerWidth - r.left + 16)}px` : SAFE.right;
          st.bottom = `calc(${SAFE.bottom} + ${Math.round(48 * zoom + 14)}px)`;
        }
      }
    };
    raf = requestAnimationFrame(tick);

    // a new stop restarts the clock
    const unsub = useTour.subscribe((s, p) => {
      if (s.stamp !== p.stamp) elapsed = 0;
    });
    return () => {
      cancelAnimationFrame(raf);
      unsub();
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('pointerdown', onPress, true);
    };
  }, [mounted, narrow]);

  if (!mounted) return null;
  const stop = TOUR_STOPS[index];
  const planet = planetById(stop.planetId);
  const total = TOUR_STOPS.length;
  const end = phase === 'end';
  const tour = useTour.getState();

  const pad = (n: number) => String(n).padStart(2, '0');
  const iconBtn =
    'inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/[0.1] text-ink/80 transition-colors duration-200 hover:border-white/25 hover:text-white disabled:pointer-events-none disabled:opacity-30';

  return (
    <div
      ref={bar}
      className="pointer-events-none absolute z-[55] flex justify-center"
      style={{
        left: SAFE.left,
        right: SAFE.right,
        bottom: SAFE.bottom,
        opacity: visible ? 1 : 0,
        transform: visible ? 'none' : 'translateY(8px)',
        transition: `opacity 300ms ${EASE}, transform 400ms ${EASE}, left 300ms ${EASE}, right 300ms ${EASE}, bottom 300ms ${EASE}`,
        ...({ '--accent': planet?.accent ?? '#e9eef7' } as CSSProperties),
      }}
    >
      <section
        onFocus={() => (focusInside.current = true)}
        onBlur={(e) => {
          if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget as Node)) focusInside.current = false;
        }}
        data-hud-block
        aria-label="Guided tour"
        className="pointer-events-auto relative w-full max-w-[600px] overflow-hidden rounded-xl border border-white/[0.09] bg-[#0b0f18]/[0.92] shadow-[0_24px_60px_-28px_rgba(0,0,0,0.8)] backdrop-blur-md"
      >
        {/* one segment per stop; the current one fills with the dwell clock */}
        <div aria-hidden="true" className="flex gap-[3px] px-[3px] pt-[3px]">
          {TOUR_STOPS.map((_, i) => (
            <span key={i} className="relative h-[2px] flex-1 overflow-hidden rounded-full bg-white/[0.08]">
              {(i < index || end) && <span className="absolute inset-0 bg-ink/50" />}
              {i === index && !end && (
                <span
                  ref={reduced ? undefined : line}
                  key={stamp}
                  className="absolute inset-0 origin-left bg-[var(--accent)]"
                  style={{ transform: reduced ? 'none' : 'scaleX(0)' }}
                />
              )}
            </span>
          ))}
        </div>

        <div className="flex items-center gap-4 px-4 py-3 sm:px-5">
          <span aria-hidden="true" className="shrink-0 self-start pt-[3px] font-mono text-[11px] tabular-nums tracking-[0.08em] text-ink-muted">
            {end ? 'END' : `${pad(index + 1)}/${pad(total)}`}
          </span>
          <div aria-live="polite" className="min-w-0 flex-1">
            {end ? (
              <p className="text-[15px] leading-snug text-ink">That's the tour.</p>
            ) : (
              <p className="text-[14px] leading-snug text-ink sm:text-[15px]">
                <span className="sr-only">
                  Stop {index + 1} of {total}.{' '}
                </span>
                {stop.caption}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-white/[0.07] px-4 py-2.5 sm:px-5">
          {end ? (
            <>
              <button
                ref={endBtn}
                type="button"
                onClick={() => {
                  tour.end();
                  useContact.getState().show();
                }}
                className="inline-flex h-8 items-center gap-2 rounded-md bg-ink px-3 text-[13px] font-medium text-[#0b0f18] transition-opacity duration-200 hover:opacity-90"
              >
                Contact
                <ArrowIcon />
              </button>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    tour.end();
                    useAppStore.getState().openReader();
                  }}
                >
                  Read as page
                </Button>
                <Button size="sm" variant="ghost" onClick={tour.end}>
                  Keep exploring
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-1.5">
                <button type="button" onClick={tour.prev} disabled={index === 0} aria-label="Previous stop" className={iconBtn}>
                  <BackIcon />
                </button>
                <button
                  type="button"
                  onClick={tour.togglePause}
                  aria-pressed={paused}
                  aria-label={paused ? 'Resume tour' : 'Pause tour'}
                  className={iconBtn}
                >
                  <PauseIcon playing={!paused} />
                </button>
                <button
                  ref={nextBtn}
                  type="button"
                  onClick={tour.next}
                  aria-label={index === total - 1 ? 'Finish tour' : 'Next stop'}
                  className={cx(iconBtn, 'border-white/20 text-white')}
                >
                  <ArrowIcon />
                </button>
              </div>
              <button
                type="button"
                onClick={tour.end}
                className="inline-flex h-8 items-center rounded-md px-2 text-[12px] text-ink-muted transition-colors duration-200 hover:text-ink"
              >
                End tour
              </button>
            </>
          )}
        </div>
        {paused && !end && <p className="sr-only">Tour paused</p>}
      </section>
    </div>
  );
};

export default TourBar;
