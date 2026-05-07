import { useEffect } from 'react';
import { useAppStore } from '@/state/useAppStore';
import { useGyroscopeBridge } from '@/hooks/useGyroscope';
import { keyboardState } from '@/hooks/useKeyboard';
import { requestPointerLock, usePointerLockBridge } from '@/hooks/usePointerLock';

const GlobalInput = () => {
  useGyroscopeBridge();
  usePointerLockBridge();
  const setPointer = useAppStore((s) => s.setPointer);
  const setIsTouch = useAppStore((s) => s.setIsTouch);

  useEffect(() => {
    const handle = (clientX: number, clientY: number) => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const nx = (clientX / w) * 2 - 1;
      const ny = -((clientY / h) * 2 - 1);
      setPointer(nx, ny, clientX, clientY);
    };
    const onMouseMove = (e: MouseEvent) => handle(e.clientX, e.clientY);
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches[0]) handle(e.touches[0].clientX, e.touches[0].clientY);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('touchmove', onTouchMove);
    };
  }, [setPointer]);

  // Q exits a planet. WASD/arrows are tracked for the planet camera.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      keyboardState[e.code] = true;
      if (e.key === 'Escape') return; // browser handles pointer-lock release
      const k = e.key.toLowerCase();
      const state = useAppStore.getState();
      if (k === 'q' && state.mode === 'planet') {
        state.beginTransitionOut();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keyboardState[e.code] = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // Click to acquire pointer lock + click-targeted planet to enter
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const onUi = !!(target && target.closest('button, a, input, [role="button"]'));
      const state = useAppStore.getState();

      if (
        !state.pointerLocked &&
        !state.isTouch &&
        (state.mode === 'overworld' || state.mode === 'planet')
      ) {
        requestPointerLock();
      }

      if (!onUi && state.mode === 'overworld' && state.hoveredPlanetId) {
        state.beginTransitionIn(state.hoveredPlanetId);
      }
    };
    window.addEventListener('click', onClick);
    return () => window.removeEventListener('click', onClick);
  }, []);

  useEffect(() => {
    const onTouchStart = () => setIsTouch(true);
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch') setIsTouch(true);
    };
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [setIsTouch]);

  return null;
};

export default GlobalInput;
