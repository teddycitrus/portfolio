import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/state/useAppStore';
import { joystickState } from '@/hooks/useJoystick';

const RADIUS = 60;

const MovementJoystick = () => {
  const isTouch = useAppStore((s) => s.isTouch);
  const mode = useAppStore((s) => s.mode);

  const padRef = useRef<HTMLDivElement>(null);
  const knobOffset = useRef({ x: 0, y: 0 });
  const activePointer = useRef<number | null>(null);
  const [, force] = useState(0);

  useEffect(() => {
    const pad = padRef.current;
    if (!pad) return;

    const onDown = (e: PointerEvent) => {
      if (activePointer.current !== null) return;
      pad.setPointerCapture(e.pointerId);
      activePointer.current = e.pointerId;
      joystickState.active = true;
      knobOffset.current = { x: 0, y: 0 };
      force((n) => n + 1);
    };

    const onMove = (e: PointerEvent) => {
      if (activePointer.current !== e.pointerId) return;
      const rect = pad.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      let dx = e.clientX - cx;
      let dy = e.clientY - cy;
      const d = Math.hypot(dx, dy);
      if (d > RADIUS) {
        dx = (dx / d) * RADIUS;
        dy = (dy / d) * RADIUS;
      }
      knobOffset.current = { x: dx, y: dy };
      joystickState.x = dx / RADIUS;
      joystickState.y = dy / RADIUS;
      force((n) => n + 1);
    };

    const onUp = (e: PointerEvent) => {
      if (activePointer.current !== e.pointerId) return;
      pad.releasePointerCapture(e.pointerId);
      activePointer.current = null;
      knobOffset.current = { x: 0, y: 0 };
      joystickState.x = 0;
      joystickState.y = 0;
      joystickState.active = false;
      force((n) => n + 1);
    };

    pad.addEventListener('pointerdown', onDown);
    pad.addEventListener('pointermove', onMove);
    pad.addEventListener('pointerup', onUp);
    pad.addEventListener('pointercancel', onUp);
    return () => {
      pad.removeEventListener('pointerdown', onDown);
      pad.removeEventListener('pointermove', onMove);
      pad.removeEventListener('pointerup', onUp);
      pad.removeEventListener('pointercancel', onUp);
    };
  }, []);

  if (!isTouch || mode !== 'planet') return null;

  return (
    <div
      ref={padRef}
      className="fixed bottom-8 left-8 z-30 rounded-full glass touch-none select-none pointer-events-auto"
      style={{
        width: RADIUS * 2 + 32,
        height: RADIUS * 2 + 32,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        className="rounded-full border border-cosmos-accent/40"
        style={{
          width: RADIUS * 2,
          height: RADIUS * 2,
          position: 'relative',
        }}
      >
        <div
          className="absolute rounded-full bg-cosmos-accent/60"
          style={{
            width: 36,
            height: 36,
            left: '50%',
            top: '50%',
            transform: `translate(calc(-50% + ${knobOffset.current.x}px), calc(-50% + ${knobOffset.current.y}px))`,
            transition: activePointer.current === null ? 'transform 120ms ease-out' : 'none',
          }}
        />
      </div>
    </div>
  );
};

export default MovementJoystick;
