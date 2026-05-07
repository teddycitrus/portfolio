import { useEffect } from 'react';
import * as THREE from 'three';
import { useAppStore } from '@/state/useAppStore';

interface DeviceOrientationEventStatic {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}

// Shared mutable refs so multiple camera components can read the latest orientation
// without forcing re-renders. Yaw/pitch are radians.
export const gyroState = {
  yaw: 0,
  pitch: 0,
  baseGamma: null as number | null,
  baseBeta: null as number | null,
  active: false,
};

export const requestGyroscopePermission = async (): Promise<boolean> => {
  if (typeof window === 'undefined') return false;
  const D = (window as unknown as { DeviceOrientationEvent?: DeviceOrientationEventStatic })
    .DeviceOrientationEvent;
  if (!D) return false;
  if (typeof D.requestPermission === 'function') {
    try {
      const result = await D.requestPermission();
      return result === 'granted';
    } catch {
      return false;
    }
  }
  // Android + non-iOS — no explicit permission required
  return true;
};

export const recalibrateGyroscope = () => {
  gyroState.baseGamma = null;
  gyroState.baseBeta = null;
};

/**
 * Mounts a single deviceorientation listener that updates the shared `gyroState`.
 * Camera components consume those refs in their useFrame loop.
 */
export const useGyroscopeBridge = () => {
  const enabled = useAppStore((s) => s.gyroscopeEnabled);
  const setAvailable = useAppStore((s) => s.setGyroscopeAvailable);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setAvailable('DeviceOrientationEvent' in window);
  }, [setAvailable]);

  useEffect(() => {
    if (!enabled) {
      gyroState.active = false;
      return;
    }

    const handler = (e: DeviceOrientationEvent) => {
      if (e.gamma == null || e.beta == null) return;

      // Capture neutral orientation on first reading so the user can hold
      // the phone naturally (~60° tilt) without the view feeling skewed.
      if (gyroState.baseGamma === null) gyroState.baseGamma = e.gamma;
      if (gyroState.baseBeta === null) gyroState.baseBeta = e.beta;

      const dGamma = e.gamma - gyroState.baseGamma;
      const dBeta = e.beta - gyroState.baseBeta;

      // gamma → yaw (left/right tilt). Negate so tilting left looks left.
      // beta  → pitch (front/back tilt).
      const yawDeg = THREE.MathUtils.clamp(-dGamma * 1.4, -85, 85);
      const pitchDeg = THREE.MathUtils.clamp(dBeta * 0.7, -50, 50);

      gyroState.yaw = THREE.MathUtils.degToRad(yawDeg);
      gyroState.pitch = THREE.MathUtils.degToRad(pitchDeg);
      gyroState.active = true;
    };

    window.addEventListener('deviceorientation', handler);
    return () => {
      window.removeEventListener('deviceorientation', handler);
      gyroState.active = false;
    };
  }, [enabled]);
};
