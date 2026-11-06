import { useEffect, useRef, type CSSProperties } from 'react';
import { planetById } from '@/data/content';
import { dragLook, isKeyDown, joystickState } from '@/state/runtime';
import { useAppStore } from '@/state/useAppStore';
import { ArrowIcon, BackIcon, EASE, SAFE, cx, useNarrow, usePresence } from './primitives';
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
    'inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink/75 transition-colors duration-200 hover:bg-white/[0.07] hover:text-white focus-visible:bg-white/[0.07] focus-visible:text-white outline-none disabled:pointer-events-none disabled:opacity-25';
  const primary =
    'inline-flex h-9 items-center gap-2 rounded-lg bg-[var(--accent)] pl-3.5 pr-3 text-[13px] font-semibold text-[#0a0d14] outline-none transition-[filter,transform] duration-200 hover:brightness-110 active:translate-y-px focus-visible:ring-2 focus-visible:ring-white/60';
  const quiet =
    'inline-flex h-9 items-center rounded-lg px-3 text-[13px] text-ink/75 outline-none transition-colors duration-200 hover:bg-white/[0.07] hover:text-white focus-visible:bg-white/[0.07]';

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
        className="pointer-events-auto relative w-full max-w-[520px] rounded-2xl border border-white/[0.08] bg-[#0a0d14]/[0.88] p-4 shadow-[0_30px_70px_-30px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-xl sm:p-5"
      >
        <div className="flex items-start gap-4">
          <span
            aria-hidden="true"
            className="font-display text-[28px] font-semibold leading-none tabular-nums text-[var(--accent)] sm:text-[32px]"
          >
            {end ? pad(total) : pad(index + 1)}
          </span>
          <div aria-live="polite" className="min-w-0 flex-1 pt-0.5">
            {end ? (
              <>
                <h2 className="pt-1 text-[16px] font-semibold leading-tight text-white">That's the tour</h2>
              </>
            ) : (
              <>
                <h2 className="text-[16px] font-semibold leading-tight text-white">
                  <span className="sr-only">
                    Stop {index + 1} of {total}:{' '}
                  </span>
                  {stop.title}
                </h2>
                <p className="mt-1 text-[14px] leading-snug text-ink-muted">{stop.caption}</p>
              </>
            )}
          </div>
          {!end && (
            <button
              type="button"
              onClick={tour.end}
              className="-mr-1.5 -mt-1 shrink-0 rounded-md px-1.5 py-1 text-[12px] text-ink-faint outline-none transition-colors duration-200 hover:text-ink focus-visible:text-ink"
            >
              End tour
            </button>
          )}
        </div>

        <div className="mt-4 flex items-center gap-3">
          {/* the flight plan: one leg per stop, the current leg fills while its panel is up */}
          <div aria-hidden="true" className={cx('flex min-w-0 flex-1 items-center', end && 'hidden')}>
            {TOUR_STOPS.map((_, i) => {
              const done = end || i < index;
              const here = !end && i === index;
              return (
                <div key={i} className="flex min-w-0 flex-1 items-center">
                  <span
                    className={cx(
                      'h-2 w-2 shrink-0 rounded-full transition-colors duration-300',
                      done || here ? 'bg-[var(--accent)]' : 'bg-white/[0.16]',
                      here && 'shadow-[0_0_0_3px_rgba(255,255,255,0.08)]',
                    )}
                  />
                  <span className="relative mx-1 h-px flex-1 overflow-hidden bg-white/[0.12]">
                    {done && <span className="absolute inset-0 bg-[var(--accent)] opacity-60" />}
                    {here && (
                      <span
                        ref={reduced ? undefined : line}
                        key={stamp}
                        className="absolute inset-0 origin-left bg-[var(--accent)]"
                        style={{ transform: reduced ? 'none' : 'scaleX(0)' }}
                      />
                    )}
                  </span>
                </div>
              );
            })}
            <span
              className={cx(
                'h-2 w-2 shrink-0 rotate-45 rounded-[1px] transition-colors duration-300',
                end ? 'bg-[var(--accent)]' : 'border border-white/25',
              )}
            />
          </div>

          {end ? (
            <div className="flex flex-1 flex-wrap items-center justify-end gap-1">
              <button
                type="button"
                onClick={() => {
                  tour.end();
                  useAppStore.getState().openReader();
                }}
                className={quiet}
              >
                Read as page
              </button>
              <button type="button" onClick={tour.end} className={quiet}>
                Keep exploring
              </button>
              <button
                ref={endBtn}
                type="button"
                onClick={() => {
                  tour.end();
                  useContact.getState().show();
                }}
                className={primary}
              >
                Contact
                <ArrowIcon />
              </button>
            </div>
          ) : (
            <div className="flex shrink-0 items-center gap-1">
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
              <button ref={nextBtn} type="button" onClick={tour.next} className={cx(primary, 'ml-1')}>
                {index === total - 1 ? 'Finish' : 'Next'}
                <ArrowIcon />
              </button>
            </div>
          )}
        </div>
        {paused && !end && <p className="sr-only">Tour paused</p>}
      </section>
    </div>
  );
};

export default TourBar;
