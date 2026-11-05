import { useEffect, useRef, type CSSProperties } from 'react';
import { joystickState } from '@/state/runtime';
import { useAppStore } from '@/state/useAppStore';
import { planetById } from '@/data/content';
import { SAFE, useNarrow } from './primitives';

const SIZE = 112;
const RADIUS = 40;

const reset = () => {
  joystickState.x = 0;
  joystickState.y = 0;
  joystickState.active = false;
};

/** Touch-only movement pad. Writes joystickState; no React state per move. */
const MovementJoystick = () => {
  const isTouch = useAppStore((s) => s.isTouch);
  const mode = useAppStore((s) => s.mode);
  const focused = useAppStore((s) => s.focusedBeaconId);
  const readerOpen = useAppStore((s) => s.readerOpen);
  const accent = planetById(useAppStore((s) => s.activePlanetId))?.accent;
  const narrow = useNarrow();
  // the bottom sheet covers the pad on phones
  const covered = !!focused && narrow;
  const active = isTouch && mode === 'planet' && !readerOpen;

  const pad = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const pointer = useRef<number | null>(null);

  useEffect(() => {
    if (!active) return reset;
    const el = pad.current;
    if (!el) return;
    const setKnob = (x: number, y: number, snap: boolean) => {
      if (!knob.current) return;
      knob.current.style.transition = snap ? 'transform 180ms cubic-bezier(0.22, 1, 0.36, 1)' : 'none';
      knob.current.style.transform = `translate(${x}px, ${y}px)`;
    };
    const move = (e: PointerEvent) => {
      if (pointer.current !== e.pointerId) return;
      const r = el.getBoundingClientRect();
      let dx = e.clientX - (r.left + r.width / 2);
      let dy = e.clientY - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy);
      if (d > RADIUS) {
        dx = (dx / d) * RADIUS;
        dy = (dy / d) * RADIUS;
      }
      joystickState.x = dx / RADIUS;
      joystickState.y = dy / RADIUS;
      setKnob(dx, dy, false);
    };
    const down = (e: PointerEvent) => {
      if (pointer.current !== null) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      pointer.current = e.pointerId;
      joystickState.active = true;
      el.dataset.active = 'true';
      move(e);
    };
    const up = (e: PointerEvent) => {
      if (pointer.current !== e.pointerId) return;
      pointer.current = null;
      el.dataset.active = 'false';
      reset();
      setKnob(0, 0, true);
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      pointer.current = null;
      reset();
    };
  }, [active]);

  if (!active) return null;

  return (
    <div
      ref={pad}
      role="presentation"
      aria-hidden="true"
      data-active="false"
      className="group pointer-events-auto absolute z-20 flex touch-none select-none items-center justify-center rounded-full animate-fade-in"
      style={
        {
          width: SIZE,
          height: SIZE,
          left: SAFE.left,
          bottom: `calc(${SAFE.bottom} + 64px)`,
          opacity: covered ? 0 : 1,
          pointerEvents: covered ? 'none' : 'auto',
          '--accent': accent,
          transition: 'opacity 250ms cubic-bezier(0.22, 1, 0.36, 1)',
        } as CSSProperties
      }
    >
      <div className="absolute inset-0 rounded-full border border-white/20 bg-space/30 transition-colors duration-200 group-data-[active=true]:border-[color-mix(in_srgb,var(--accent)_60%,transparent)]" />
      <div ref={knob} className="h-10 w-10 rounded-full bg-ink/85 shadow-[0_4px_16px_rgba(0,0,0,0.4)]" />
    </div>
  );
};

export default MovementJoystick;
