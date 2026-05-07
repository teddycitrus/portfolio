import { useEffect } from 'react';
import * as THREE from 'three';
import { useAppStore } from '@/state/useAppStore';

/**
 * Singleton accumulator for FPS-style mouse-look. `yaw` and `pitch` accumulate
 * over time from `mousemove` deltas while the document has pointer lock. The
 * camera components read these directly inside their useFrame loops.
 */
export const lookState = {
  yaw: 0,
  pitch: 0,
  active: false,
};

const SENSITIVITY = 0.0024;
const PITCH_LIMIT = Math.PI / 2 - 0.05;

export const requestPointerLock = (): void => {
  if (typeof document === 'undefined') return;
  if (document.pointerLockElement) return;
  // Use body so the lock target survives canvas remounts during scene swaps
  document.body.requestPointerLock?.();
};

export const exitPointerLock = (): void => {
  if (typeof document === 'undefined') return;
  if (document.pointerLockElement) document.exitPointerLock?.();
};

export const resetLook = (): void => {
  lookState.yaw = 0;
  lookState.pitch = 0;
};

/**
 * Mounted once at the app root. Owns the document-level mouse + pointerlock
 * listeners so individual cameras don't have to.
 */
export const usePointerLockBridge = (): void => {
  const setPointerLocked = useAppStore((s) => s.setPointerLocked);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!document.pointerLockElement) return;
      const state = useAppStore.getState();
      // Don't accumulate look during transitions — the user is along for the ride
      if (state.mode !== 'overworld' && state.mode !== 'planet') return;

      lookState.yaw -= e.movementX * SENSITIVITY;
      lookState.pitch = THREE.MathUtils.clamp(
        lookState.pitch - e.movementY * SENSITIVITY,
        -PITCH_LIMIT,
        PITCH_LIMIT,
      );
    };

    const onChange = () => {
      const locked = !!document.pointerLockElement;
      lookState.active = locked;
      setPointerLocked(locked);
    };

    const onError = () => {
      lookState.active = false;
      setPointerLocked(false);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('pointerlockchange', onChange);
    document.addEventListener('pointerlockerror', onError);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('pointerlockchange', onChange);
      document.removeEventListener('pointerlockerror', onError);
    };
  }, [setPointerLocked]);
};
