import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useAppStore } from '@/state/useAppStore';
import { planets, getOrbitalPosition } from '@/data/content';
import { gyroState } from '@/hooks/useGyroscope';
import { lookState, resetLook } from '@/hooks/usePointerLock';

const HOVER_ANGLE = THREE.MathUtils.degToRad(8);

const TelescopeCamera = () => {
  const { camera } = useThree();
  const yaw = useRef(0);
  const pitch = useRef(0);

  const mode = useAppStore((s) => s.mode);

  useEffect(() => {
    if (mode === 'overworld') {
      camera.position.set(0, 0, 0);
      yaw.current = 0;
      pitch.current = 0;
      resetLook();
    }
  }, [camera, mode]);

  useFrame((state) => {
    if (mode !== 'overworld') return;

    const store = useAppStore.getState();
    const useGyro = gyroState.active;
    const useFps = lookState.active;

    if (useFps) {
      yaw.current = lookState.yaw;
      pitch.current = lookState.pitch;
    } else if (store.isTouch || useGyro) {
      const range = Math.PI * 0.85;
      const ty = useGyro ? gyroState.yaw : -store.pointer.x * (range / 2);
      const tp = useGyro ? gyroState.pitch : store.pointer.y * (range / 3);
      yaw.current = THREE.MathUtils.lerp(yaw.current, ty, 0.18);
      pitch.current = THREE.MathUtils.lerp(pitch.current, tp, 0.18);
    }

    const euler = new THREE.Euler(pitch.current, yaw.current, 0, 'YXZ');
    camera.quaternion.setFromEuler(euler);

    // Always-on hover detection — pick the planet whose orbital position
    // is closest to camera-forward right now.
    const t = state.clock.elapsedTime;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const toPlanet = new THREE.Vector3();
    let bestId: string | null = null;
    let bestAngle = HOVER_ANGLE;
    for (const planet of planets) {
      const [x, y, z] = getOrbitalPosition(planet, t);
      toPlanet.set(x, y, z).normalize();
      const dot = THREE.MathUtils.clamp(forward.dot(toPlanet), -1, 1);
      const angle = Math.acos(dot);
      if (angle < bestAngle) {
        bestAngle = angle;
        bestId = planet.id;
      }
    }
    if (bestId !== store.hoveredPlanetId) store.setHoveredPlanet(bestId);
  });

  return null;
};

export default TelescopeCamera;
