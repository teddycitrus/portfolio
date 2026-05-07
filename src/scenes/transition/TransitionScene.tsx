import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useAppStore } from '@/state/useAppStore';
import { planetById, getOrbitalPosition } from '@/data/content';

const ENTER_DOLLY_DURATION = 1.4;
const ENTER_TOTAL = 1.8;
const EXIT_LAUNCH_DURATION = 1.5;
const EXIT_TOTAL = 2.0;

const TransitionScene = () => {
  const { camera } = useThree();
  const startRef = useRef<number | null>(null);
  const startPosRef = useRef(new THREE.Vector3());
  const startQuatRef = useRef(new THREE.Quaternion());
  const startFovRef = useRef(75);
  const cleanupRef = useRef<(() => void) | null>(null);

  const mode = useAppStore((s) => s.mode);
  const lockedId = useAppStore((s) => s.lockedPlanetId);
  const arriveAtPlanet = useAppStore((s) => s.arriveAtPlanet);
  const arriveAtOverworld = useAppStore((s) => s.arriveAtOverworld);

  // Capture starting state + schedule the mode swap
  useEffect(() => {
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }

    if (mode === 'transitioning-in') {
      startRef.current = null; // first useFrame fills this
      startPosRef.current.copy(camera.position);
      startQuatRef.current.copy(camera.quaternion);
      const persp = camera as THREE.PerspectiveCamera;
      startFovRef.current = persp.fov;

      const id = window.setTimeout(() => {
        persp.fov = 75;
        persp.updateProjectionMatrix();
        arriveAtPlanet();
      }, ENTER_TOTAL * 1000);
      cleanupRef.current = () => window.clearTimeout(id);
    }

    if (mode === 'transitioning-out') {
      startRef.current = null;
      startPosRef.current.copy(camera.position);
      startQuatRef.current.copy(camera.quaternion);
      const persp = camera as THREE.PerspectiveCamera;
      startFovRef.current = persp.fov;

      const id = window.setTimeout(() => {
        persp.fov = 75;
        persp.updateProjectionMatrix();
        arriveAtOverworld();
      }, EXIT_TOTAL * 1000);
      cleanupRef.current = () => window.clearTimeout(id);
    }

    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, [mode, camera, arriveAtPlanet, arriveAtOverworld]);

  useFrame((state) => {
    if (mode !== 'transitioning-in' && mode !== 'transitioning-out') return;

    if (startRef.current === null) startRef.current = state.clock.elapsedTime;
    const elapsed = state.clock.elapsedTime - startRef.current;
    const persp = camera as THREE.PerspectiveCamera;

    if (mode === 'transitioning-in' && lockedId) {
      const planet = planetById(lockedId);
      if (!planet) return;

      // Track the orbiting planet — camera always knows where it is *now*
      const [px, py, pz] = getOrbitalPosition(planet, state.clock.elapsedTime);
      const target = new THREE.Vector3(px, py, pz);

      const progress = THREE.MathUtils.clamp(elapsed / ENTER_DOLLY_DURATION, 0, 1);
      // Cubic ease-in — slow start, accelerating "fall" toward the planet
      const eased = progress * progress * progress;

      camera.position.copy(startPosRef.current).lerp(target, eased);
      camera.lookAt(target);

      // Slight FOV tighten for cinematic focus
      persp.fov = THREE.MathUtils.lerp(startFovRef.current, 50, progress);
      persp.updateProjectionMatrix();
    }

    if (mode === 'transitioning-out') {
      // Sudden launch straight up — initial high velocity + acceleration
      const launchT = elapsed; // unbounded — we just want height to grow fast
      const heightCurve = launchT * 80 + launchT * launchT * 220;
      camera.position.x = startPosRef.current.x;
      camera.position.z = startPosRef.current.z;
      camera.position.y = startPosRef.current.y + heightCurve;

      // Tilt to look straight up over the first 0.7s
      const lookT = THREE.MathUtils.clamp(elapsed / 0.7, 0, 1);
      const eased = lookT * lookT;
      const targetEuler = new THREE.Euler(Math.PI / 2 - 0.25, 0, 0, 'YXZ');
      const targetQuat = new THREE.Quaternion().setFromEuler(targetEuler);
      camera.quaternion.slerpQuaternions(startQuatRef.current, targetQuat, eased);

      // FOV widens as we punch through the atmosphere
      const fovT = THREE.MathUtils.clamp(elapsed / EXIT_LAUNCH_DURATION, 0, 1);
      persp.fov = THREE.MathUtils.lerp(startFovRef.current, 92, fovT);
      persp.updateProjectionMatrix();
    }
  });

  return null;
};

export default TransitionScene;
