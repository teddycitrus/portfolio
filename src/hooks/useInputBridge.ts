import { useEffect } from 'react';
import { useAppStore } from '@/state/useAppStore';
import { dragLook, keyboardState, mouseLook, pointerState } from '@/state/runtime';
import { planetByIndex } from '@/data/content';
import { openBeacon } from '@/ui/navigation';
import { useTour } from '@/ui/tour';

const DRAG_SENSITIVITY = 0.0042;
const TOUCH_DRAG_SENSITIVITY = 0.0065;
const LOCK_SENSITIVITY = 0.0022;
const MAX_LOCK_STEP = 300;
/** An Esc this soon after the cursor was freed is the same press */
const UNLOCK_ESC_MS = 250;

/** Mouse look owns the cursor only while walking a planet on desktop with nothing modal open. */
const wantsLock = () => {
  const s = useAppStore.getState();
  return s.mode === 'planet' && !s.isTouch && !s.readerOpen && !useTour.getState().active;
};

const requestLock = () => {
  const canvas = document.querySelector('canvas');
  if (!canvas || document.pointerLockElement) return;
  try {
    // a promise in current browsers; rejects without a recent user gesture, and a click retries
    (canvas.requestPointerLock() as unknown as Promise<void> | undefined)?.catch?.(() => {});
  } catch {
    /* unsupported: drag to look still works */
  }
};

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
      if (mouseLook.locked) {
        // Chrome can report one huge jump right after the lock is taken
        if (Math.abs(e.movementX) > MAX_LOCK_STEP || Math.abs(e.movementY) > MAX_LOCK_STEP) return;
        // mouse right turns right, mouse up looks up
        dragLook.yaw -= e.movementX * LOCK_SENSITIVITY;
        dragLook.pitch -= e.movementY * LOCK_SENSITIVITY;
        return;
      }
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
      mouseLook.pressLocked = mouseLook.locked;
      if (mouseLook.locked) {
        if (e.button !== 0) return;
        // a link or button on an in-world screen under the crosshair takes the click
        const hit = document
          .elementsFromPoint(window.innerWidth / 2, window.innerHeight / 2)
          .find((el) => el.closest('[data-beacon-screen]'))
          ?.closest<HTMLElement>('a[href], button');
        if (hit) hit.click();
        else if (mouseLook.aimId) openBeacon(mouseLook.aimId, false);
        return;
      }
      if (!(e.target instanceof HTMLCanvasElement)) return;
      if (e.pointerType === 'mouse' && wantsLock()) requestLock();
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
        // the browser spends this Esc on freeing the cursor; pointerlockchange may land before or after it
        const freeing = mouseLook.locked || !!document.pointerLockElement;
        if (freeing || performance.now() - mouseLook.unlockedAt < UNLOCK_ESC_MS) return;
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

    /* ---- pointer lock: taken on landing, given back whenever the cursor is needed ---- */
    const onLockChange = () => {
      const locked = !!document.pointerLockElement;
      if (mouseLook.locked && !locked) mouseLook.unlockedAt = performance.now();
      mouseLook.locked = locked;
      if (locked) {
        activePointer = null;
        dragLook.dragging = false;
      }
    };
    const syncLock = () => {
      const want = wantsLock();
      if (!want && document.pointerLockElement) document.exitPointerLock();
      return want;
    };
    const unsubApp = useAppStore.subscribe((s, p) => {
      // the click or key that started the trip usually still counts as a gesture on arrival
      if (syncLock() && s.mode === 'planet' && p.mode !== 'planet') requestLock();
    });
    const unsubTour = useTour.subscribe(syncLock);

    document.addEventListener('pointerlockchange', onLockChange);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    motion.addEventListener('change', onMotion);
    return () => {
      unsubApp();
      unsubTour();
      document.removeEventListener('pointerlockchange', onLockChange);
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
