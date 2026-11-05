import { useEffect } from 'react';
import { useAppStore } from '@/state/useAppStore';
import { dragLook, keyboardState, pointerState } from '@/state/runtime';
import { planetByIndex } from '@/data/content';

const DRAG_SENSITIVITY = 0.0042;
const TOUCH_DRAG_SENSITIVITY = 0.0065;

const isTypingTarget = (el: EventTarget | null) =>
  el instanceof HTMLElement && !!el.closest('input, textarea, [contenteditable="true"]');

/**
 * Mounted once at the app root. Owns every document-level listener:
 * pointer position, drag-to-look on the canvas, keyboard state, global
 * shortcuts, touch detection and the reduced-motion preference.
 */
export const useInputBridge = (): void => {
  useEffect(() => {
    const store = useAppStore.getState;

    /* ---- pointer position + drag look ---- */
    let activePointer: number | null = null;
    let lastX = 0;
    let lastY = 0;

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') {
        pointerState.x = (e.clientX / window.innerWidth) * 2 - 1;
        pointerState.y = -((e.clientY / window.innerHeight) * 2 - 1);
        pointerState.seen = true;
      }
      if (activePointer !== e.pointerId) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      dragLook.travel += Math.abs(dx) + Math.abs(dy);
      const k = e.pointerType === 'touch' ? TOUCH_DRAG_SENSITIVITY : DRAG_SENSITIVITY;
      dragLook.yaw += dx * k;
      dragLook.pitch += dy * k;
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch') store().setIsTouch(true);
      if (!(e.target instanceof HTMLCanvasElement)) return;
      if (activePointer !== null) return;
      activePointer = e.pointerId;
      lastX = e.clientX;
      lastY = e.clientY;
      dragLook.travel = 0;
      dragLook.dragging = true;
    };

    const onPointerUp = (e: PointerEvent) => {
      if (activePointer !== e.pointerId) return;
      activePointer = null;
      dragLook.dragging = false;
    };

    /* ---- keyboard ---- */
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      keyboardState[e.code] = true;
      const s = store();

      if (e.key === 'Escape') {
        if (s.readerOpen) s.closeReader();
        else if (s.mode === 'planet' && s.focusedBeaconId) s.setFocusedBeacon(null);
        else if (s.mode === 'planet') s.exitPlanet();
        return;
      }
      if (s.readerOpen) return;

      if (e.key === 'q' || e.key === 'Q') {
        s.exitPlanet();
        return;
      }
      if (e.key === 'r' || e.key === 'R') {
        s.openReader(s.activePlanetId);
        return;
      }
      if (/^[1-9]$/.test(e.key) && (s.mode === 'overworld' || s.mode === 'planet')) {
        const planet = planetByIndex(Number(e.key));
        if (planet) s.travelTo(planet.id);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keyboardState[e.code] = false;
    };
    const onBlur = () => {
      for (const k of Object.keys(keyboardState)) keyboardState[k] = false;
      activePointer = null;
      dragLook.dragging = false;
    };

    /* ---- environment ---- */
    const coarse = window.matchMedia('(pointer: coarse)');
    if (coarse.matches) store().setIsTouch(true);
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    store().setReducedMotion(motion.matches);
    const onMotion = () => store().setReducedMotion(motion.matches);

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    motion.addEventListener('change', onMotion);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      motion.removeEventListener('change', onMotion);
    };
  }, []);
};
