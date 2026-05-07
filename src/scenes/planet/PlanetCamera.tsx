import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useAppStore } from '@/state/useAppStore';
import { gyroState } from '@/hooks/useGyroscope';
import { keyboardState } from '@/hooks/useKeyboard';
import { joystickState } from '@/hooks/useJoystick';
import { lookState, resetLook } from '@/hooks/usePointerLock';
import { TERRAIN_RADIUS } from './Terrain';

const HEAD_HEIGHT = 1.6;
const WALK_SPEED = 4.2;
const RUN_MULT = 1.8;
const WALK_RADIUS = TERRAIN_RADIUS - 4;

const PlanetCamera = () => {
  const { camera } = useThree();
  const yaw = useRef(0);
  const pitch = useRef(0);
  const targetYaw = useRef(0);
  const targetPitch = useRef(0);
  const mode = useAppStore((s) => s.mode);

  useEffect(() => {
    if (mode === 'planet') {
      camera.position.set(0, HEAD_HEIGHT, 6.5);
      yaw.current = 0;
      pitch.current = 0;
      targetYaw.current = 0;
      targetPitch.current = 0;
      resetLook();
    }
  }, [camera, mode]);

  useFrame((_, deltaSeconds) => {
    if (mode !== 'planet') return;
    const state = useAppStore.getState();
    const useGyro = gyroState.active;
    const useFps = lookState.active;
    const pointer = state.pointer;
    const dt = Math.min(deltaSeconds, 0.05);

    if (useFps) {
      yaw.current = lookState.yaw;
      pitch.current = lookState.pitch;
    } else if (state.isTouch || useGyro) {
      targetYaw.current = useGyro ? gyroState.yaw * 0.7 : -pointer.x * 0.6;
      targetPitch.current = useGyro ? gyroState.pitch * 0.5 : pointer.y * 0.25;
      yaw.current = THREE.MathUtils.lerp(yaw.current, targetYaw.current, 0.18);
      pitch.current = THREE.MathUtils.lerp(pitch.current, targetPitch.current, 0.18);
    }

    const euler = new THREE.Euler(pitch.current, yaw.current, 0, 'YXZ');
    camera.quaternion.setFromEuler(euler);

    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    forward.y = 0;
    if (forward.lengthSq() > 0) forward.normalize();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    right.y = 0;
    if (right.lengthSq() > 0) right.normalize();

    let mvX = 0;
    let mvZ = 0;
    if (keyboardState['KeyW'] || keyboardState['ArrowUp']) mvZ += 1;
    if (keyboardState['KeyS'] || keyboardState['ArrowDown']) mvZ -= 1;
    if (keyboardState['KeyD'] || keyboardState['ArrowRight']) mvX += 1;
    if (keyboardState['KeyA'] || keyboardState['ArrowLeft']) mvX -= 1;

    if (joystickState.active) {
      mvX += joystickState.x;
      mvZ += -joystickState.y;
    }

    if (mvX !== 0 || mvZ !== 0) {
      const speed =
        WALK_SPEED * (keyboardState['ShiftLeft'] || keyboardState['ShiftRight'] ? RUN_MULT : 1);
      const dir = new THREE.Vector3();
      dir.addScaledVector(forward, mvZ);
      dir.addScaledVector(right, mvX);
      if (dir.lengthSq() > 0) dir.normalize();
      camera.position.addScaledVector(dir, speed * dt);
    }

    const horiz = Math.hypot(camera.position.x, camera.position.z);
    if (horiz > WALK_RADIUS) {
      const k = WALK_RADIUS / horiz;
      camera.position.x *= k;
      camera.position.z *= k;
    }
    camera.position.y = HEAD_HEIGHT;
  });

  return null;
};

export default PlanetCamera;
