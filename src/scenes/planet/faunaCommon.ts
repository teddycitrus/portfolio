import * as THREE from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import { critterCall, type CritterVoice } from '@/audio/drone';
import { dragLook, mouseLook } from '@/state/runtime';
import { useAppStore } from '@/state/useAppStore';

export const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);
export const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
export const smooth01 = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/** Smoothed walking speed (units/s) and how long the viewer has stood still (s). */
export interface Viewer {
  x: number;
  z: number;
  speed: number;
  still: number;
}
export type ViewerRef = { current: Viewer };

/**
 * What the creatures of one planet know of each other, written by whoever is
 * doing it and read by whoever minds: a bird low overhead sends small things
 * still, a whale's song turns heads, the golem's rumble makes the ground wary,
 * and the embers keep near the warm tortoises.
 */
export interface Eco {
  bird: { on: boolean; x: number; z: number };
  /** 0..1 how strongly a sky whale is singing */
  song: number;
  /** 0..1 the golem is rumbling */
  quake: number;
  /** Tortoise positions as x, z pairs */
  warm: Float32Array;
  warmN: number;
}
export type EcoRef = { current: Eco };
export const makeEco = (): Eco => ({ bird: { on: false, x: 0, z: 0 }, song: 0, quake: 0, warm: new Float32Array(16), warmN: 0 });

/** How far creatures keep from the centre of a monument or screen */
export const CLEAR_R = 3;

/** True if a point is within r of any obstacle */
export const nearObstacle = (obstacles: [number, number][], x: number, z: number, r: number) => {
  for (let i = 0; i < obstacles.length; i += 1) {
    if (Math.hypot(x - obstacles[i][0], z - obstacles[i][1]) < r) return true;
  }
  return false;
};

/** Pushes (x, z) out of every obstacle's clear circle; writes to out */
export const clearOf = (obstacles: [number, number][], x: number, z: number, r: number, out: { x: number; z: number }) => {
  out.x = x;
  out.z = z;
  for (let i = 0; i < obstacles.length; i += 1) {
    const ex = out.x - obstacles[i][0];
    const ez = out.z - obstacles[i][1];
    const e = Math.hypot(ex, ez);
    if (e < r && e > 1e-4) {
      out.x = obstacles[i][0] + (ex / e) * r;
      out.z = obstacles[i][1] + (ez / e) * r;
    }
  }
};

/** True while the visitor is reading a beacon: creatures keep clear of it then */
export const reading = () => useAppStore.getState().focusedBeaconId !== null;

const _right = new THREE.Vector3();
/** Plays a call from a world point, levelled by distance and panned around the camera. */
export const callFrom = (camera: THREE.Camera, kind: CritterVoice, x: number, y: number, z: number) => {
  const dx = x - camera.position.x;
  const dy = y - camera.position.y;
  const dz = z - camera.position.z;
  const d = Math.hypot(dx, dy, dz);
  _right.set(1, 0, 0).applyQuaternion(camera.quaternion);
  const pan = d > 1e-3 ? (dx * _right.x + dy * _right.y + dz * _right.z) / d : 0;
  critterCall(kind, d, pan * 0.85);
};

/** A real click on a creature (not the end of a drag, not a locked-cursor press). */
export const isPoke = (e: ThreeEvent<MouseEvent>) => {
  e.stopPropagation();
  return dragLook.travel < 6 && !mouseLook.pressLocked;
};

const _fwd = new THREE.Vector3();
/** The camera's heading on the ground plane: 0 along +z, like the creatures' own */
export const cameraYaw = (camera: THREE.Camera) => {
  _fwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
  return Math.atan2(_fwd.x, _fwd.z);
};

/** Pushes a bearing out of the cone the visitor is looking down, so followers stay at the edge of view */
export const offGaze = (bearing: number, gazeYaw: number, half: number) => {
  const off = wrapAngle(bearing - gazeYaw);
  if (Math.abs(off) >= half) return bearing;
  return gazeYaw + (off >= 0 ? half : -half);
};
