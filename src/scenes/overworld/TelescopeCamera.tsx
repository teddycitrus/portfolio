import { useEffect, useLayoutEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useAppStore, type SceneMode } from '@/state/useAppStore';
import { dragLook, pointerState } from '@/state/runtime';
import { setOverworldView } from '@/data/content';
import { WINDOW_FIT } from '@/scenes/ship/shape';

const MOUSE_YAW = 0.12;
const MOUSE_PITCH = 0.07;
const MAX_YAW = 0.9;
const MAX_PITCH = 0.5;

const portraitRamp = (aspect: number) => THREE.MathUtils.clamp((1.4 - aspect) / 0.8, 0, 1);

/**
 * Overworld vertical fov: a long 50 deg lens on landscape (planets near the edges stay round),
 * widening to 80 on portrait. The layout refits planets to whatever this returns.
 */
export const responsiveFov = (aspect: number): number => 50 + 30 * portraitRamp(aspect);

/** Fov for the planet surface: 60 on landscape, up to 80 on portrait. */
export const surfaceFov = (aspect: number): number => 60 + 20 * portraitRamp(aspect);

interface Spring {
  v: number;
}

/** Critically damped spring step (Unity style SmoothDamp). Mutates the velocity holder. */
const smoothDamp = (cur: number, target: number, s: Spring, smoothTime: number, dt: number) => {
  const omega = 2 / smoothTime;
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = cur - target;
  const temp = (s.v + omega * change) * dt;
  s.v = (s.v - omega * temp) * exp;
  return target + (change + temp) * exp;
};

const clamp = THREE.MathUtils.clamp;
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');

const TelescopeCamera = () => {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const mode = useAppStore((s) => s.mode);
  const prevMode = useRef<SceneMode | null>(null);
  const look = useRef({ yaw: 0, pitch: 0, vy: { v: 0 }, vp: { v: 0 }, dYaw: 0, dPitch: 0 });
  const frame = useRef({ aspect: 0 });
  const size = useThree((s) => s.size);

  useLayoutEffect(() => {
    const f = frame.current;
    if (f.aspect === 0) f.aspect = size.width / Math.max(size.height, 1);
    setOverworldView(f.aspect, responsiveFov(f.aspect) * WINDOW_FIT);
  }, [size]);

  useEffect(() => {
    const prev = prevMode.current;
    prevMode.current = mode;
    // Mounting straight into overworld means we just came back from a planet
    if (mode !== 'overworld' || prev === 'overworld') return;
    // Arriving from a transition: back to the eyepiece, keep the current heading and settle from there
    _euler.setFromQuaternion(camera.quaternion, 'YXZ');
    const l = look.current;
    // The cut happens under the veil, so start only a short tilt above the system and settle onto it
    l.yaw = clamp(Math.atan2(Math.sin(_euler.y), Math.cos(_euler.y)), -0.25, 0.25);
    l.pitch = clamp(_euler.x, -0.3, 0.3);
    l.vy.v = l.vp.v = l.dYaw = l.dPitch = 0;
    dragLook.yaw = dragLook.pitch = 0;
    camera.position.set(0, 0, 0);
  }, [camera, mode]);

  useFrame((_, delta) => {
    if (mode !== 'overworld') return;
    const dt = Math.min(delta, 0.25);
    const l = look.current;
    const { isTouch } = useAppStore.getState();

    let ty = 0;
    let tp = 0;
    if (!isTouch && pointerState.seen) {
      ty = -pointerState.x * MOUSE_YAW;
      tp = pointerState.y * MOUSE_PITCH;
    }
    // Drag offsets: grabbing the sky, so positive dx swings the view left
    dragLook.yaw = clamp(dragLook.yaw, -MAX_YAW - ty, MAX_YAW - ty);
    dragLook.pitch = clamp(dragLook.pitch, -MAX_PITCH - tp, MAX_PITCH - tp);
    if (!isTouch && !dragLook.dragging) {
      const k = Math.exp(-0.7 * dt);
      dragLook.yaw *= k;
      dragLook.pitch *= k;
    }

    // Layout follows a smoothed aspect so the portrait blend animates on resize
    const f = frame.current;
    const aspect = size.width / Math.max(size.height, 1);
    f.aspect += (aspect - f.aspect) * (1 - Math.exp(-5 * dt));
    if (Math.abs(aspect - f.aspect) < 1e-3) f.aspect = aspect;
    setOverworldView(f.aspect, responsiveFov(f.aspect) * WINDOW_FIT);

    l.yaw = smoothDamp(l.yaw, ty, l.vy, 0.45, dt);
    l.pitch = smoothDamp(l.pitch, tp, l.vp, 0.45, dt);
    const dk = 1 - Math.exp(-14 * dt);
    l.dYaw += (dragLook.yaw - l.dYaw) * dk;
    l.dPitch += (dragLook.pitch - l.dPitch) * dk;

    _euler.set(l.pitch + l.dPitch, l.yaw + l.dYaw, 0, 'YXZ');
    camera.quaternion.setFromEuler(_euler);

    const fov = responsiveFov(aspect);
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov += (fov - camera.fov) * (1 - Math.exp(-3 * dt));
      camera.updateProjectionMatrix();
    }
  });

  return null;
};

export default TelescopeCamera;
