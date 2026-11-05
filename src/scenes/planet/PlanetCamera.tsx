import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useAppStore } from '@/state/useAppStore';
import { beaconScreen, dragLook, isKeyDown, joystickState } from '@/state/runtime';
import { getBeaconViewPoint, SURFACE_HEAD_HEIGHT, SURFACE_SPAWN } from '@/data/content';
import type { Vec3 } from '@/types/content';
import { terrainHeight } from './Terrain';

export interface SurfaceBeacon {
  id: string;
  /** Ground-level world position */
  position: Vec3;
  /** Monument height */
  height: number;
}

const WALK_SPEED = 3.4;
const RUN_SPEED = 6.8;
export const WALK_RADIUS = 30;
const PITCH_LIMIT = 0.6;
const SETTLE_MS = 900;
const SETTLE_RISE = 2.5;
const GLIDE_S = 1.1;
const NEAR_FOCUS = 5.5;
const GAZE_RANGE = 14;
const GAZE_ANGLE = (6 * Math.PI) / 180;
const GAZE_HOLD = (9 * Math.PI) / 180;
const GAZE_DWELL = 0.45;
const STICKY_RELEASE = 7;
const BEACON_COLLIDE = 1.15;
const EDGE_INSET = 48;

const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

const MOVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

interface PlanetCameraProps {
  planetId: string;
  beacons: SurfaceBeacon[];
}

/**
 * First-person walker for the planet surface. Owns the camera only in
 * mode 'planet'; TransitionController owns it in the transition modes.
 */
const PlanetCamera = ({ planetId, beacons }: PlanetCameraProps) => {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const mode = useAppStore((s) => s.mode);

  const st = useRef({
    yaw: 0,
    pitch: 0,
    vx: 0,
    vz: 0,
    y: SURFACE_SPAWN[1],
    bob: 0,
    settleStart: -1,
    glideId: null as string | null,
    glideT: 0,
    from: new THREE.Vector3(),
    to: new THREE.Vector3(),
    fromYaw: 0,
    toYaw: 0,
    fromPitch: 0,
    toPitch: 0,
    lastSet: null as string | null,
    sticky: null as string | null,
    dismissed: null as string | null,
    gazeId: null as string | null,
    gazeTime: 0,
  });
  const euler = useRef(new THREE.Euler(0, 0, 0, 'YXZ'));
  const v3 = useRef(new THREE.Vector3());

  // allocate one screen record per beacon; mutate them every frame
  useEffect(() => {
    for (const b of beacons) {
      beaconScreen[b.id] = beaconScreen[b.id] ?? { x: 0, y: 0, visible: false, angle: 0, size: 0 };
    }
    return () => {
      for (const b of beacons) delete beaconScreen[b.id];
    };
  }, [beacons]);

  // arrival
  useEffect(() => {
    if (mode !== 'planet') return;
    const s = st.current;
    const reduced = useAppStore.getState().reducedMotion;
    dragLook.yaw = 0;
    dragLook.pitch = 0;
    s.yaw = 0;
    s.pitch = 0;
    s.vx = 0;
    s.vz = 0;
    s.bob = 0;
    s.glideId = null;
    s.lastSet = null;
    s.sticky = null;
    s.dismissed = null;
    s.gazeId = null;
    s.gazeTime = 0;
    const ground = terrainHeight(SURFACE_SPAWN[0], SURFACE_SPAWN[2]) + SURFACE_HEAD_HEIGHT;
    s.y = ground + (reduced ? 0 : SETTLE_RISE);
    s.settleStart = reduced ? -1 : performance.now();
    camera.position.set(SURFACE_SPAWN[0], s.y, SURFACE_SPAWN[2]);
    euler.current.set(reduced ? 0 : -0.12, 0, 0);
    camera.quaternion.setFromEuler(euler.current);
  }, [mode, planetId, camera]);

  useFrame((_, delta) => {
    if (mode !== 'planet') return;
    const dt = Math.min(delta, 0.05);
    const s = st.current;
    const store = useAppStore.getState();
    const reduced = store.reducedMotion;
    const pos = camera.position;

    /* ---- settle after arrival ---- */
    let settle = 1;
    if (s.settleStart >= 0) {
      settle = Math.min(1, (performance.now() - s.settleStart) / SETTLE_MS);
      if (settle >= 1) s.settleStart = -1;
    }
    const settleE = easeOut(settle);

    /* ---- input ---- */
    let ix = 0;
    let iz = 0;
    if (isKeyDown('KeyW', 'ArrowUp')) iz -= 1;
    if (isKeyDown('KeyS', 'ArrowDown')) iz += 1;
    if (isKeyDown('KeyD', 'ArrowRight')) ix += 1;
    if (isKeyDown('KeyA', 'ArrowLeft')) ix -= 1;
    if (joystickState.active) {
      ix += joystickState.x;
      iz += joystickState.y;
    }
    const inLen = Math.hypot(ix, iz);
    if (inLen > 1) {
      ix /= inLen;
      iz /= inLen;
    }
    const moving = inLen > 0.05;
    if (store.readerOpen) ix = iz = 0;

    /* ---- glide ---- */
    if (store.glideBeaconId && (moving || isKeyDown(...MOVE_KEYS))) {
      s.glideId = null;
      store.clearGlide();
    } else if (store.glideBeaconId && store.glideBeaconId !== s.glideId) {
      const b = beacons.find((x) => x.id === store.glideBeaconId);
      if (!b) {
        store.clearGlide();
      } else {
        const vp = getBeaconViewPoint(b.position);
        s.glideId = b.id;
        s.glideT = 0;
        s.from.copy(pos);
        s.to.set(vp[0], terrainHeight(vp[0], vp[2]) + SURFACE_HEAD_HEIGHT, vp[2]);
        s.fromYaw = s.yaw;
        const dx = b.position[0] - vp[0];
        const dz = b.position[2] - vp[2];
        s.toYaw = s.yaw + wrapAngle(Math.atan2(-dx, -dz) - s.yaw);
        s.fromPitch = s.pitch;
        const mid = b.position[1] + b.height * 0.55;
        s.toPitch = THREE.MathUtils.clamp(Math.atan2(mid - s.to.y, Math.hypot(dx, dz)), -PITCH_LIMIT, PITCH_LIMIT);
        s.vx = s.vz = 0;
        s.settleStart = -1;
        s.sticky = b.id;
        s.dismissed = null;
      }
    }

    if (s.glideId) {
      s.glideT = reduced ? 1 : Math.min(1, s.glideT + dt / GLIDE_S);
      const k = easeInOut(s.glideT);
      pos.lerpVectors(s.from, s.to, k);
      s.yaw = s.fromYaw + (s.toYaw - s.fromYaw) * k;
      s.pitch = s.fromPitch + (s.toPitch - s.fromPitch) * k;
      dragLook.yaw = s.yaw;
      dragLook.pitch = s.pitch;
      s.y = pos.y;
      if (s.glideT >= 1) {
        s.glideId = null;
        store.clearGlide();
      }
    } else {
      /* ---- look: drag right turns the view left, drag down tilts up ---- */
      dragLook.pitch = THREE.MathUtils.clamp(dragLook.pitch, -PITCH_LIMIT, PITCH_LIMIT);
      const kl = damp(reduced ? 30 : 14, dt);
      s.yaw += (dragLook.yaw - s.yaw) * kl;
      s.pitch += (dragLook.pitch - s.pitch) * kl;

      /* ---- walk ---- */
      const speed = isKeyDown('ShiftLeft', 'ShiftRight') ? RUN_SPEED : WALK_SPEED;
      const sin = Math.sin(s.yaw);
      const cos = Math.cos(s.yaw);
      // forward (-z local) = (-sin, -cos); right = (cos, -sin)
      const tx = (ix * cos + iz * sin) * speed;
      const tz = (-ix * sin + iz * cos) * speed;
      const ka = damp(moving ? 6 : 9, dt);
      s.vx += (tx - s.vx) * ka;
      s.vz += (tz - s.vz) * ka;
      pos.x += s.vx * dt;
      pos.z += s.vz * dt;

      // keep out of monuments
      for (const b of beacons) {
        const dx = pos.x - b.position[0];
        const dz = pos.z - b.position[2];
        const d = Math.hypot(dx, dz);
        if (d < BEACON_COLLIDE && d > 1e-4) {
          pos.x = b.position[0] + (dx / d) * BEACON_COLLIDE;
          pos.z = b.position[2] + (dz / d) * BEACON_COLLIDE;
        }
      }
      const r = Math.hypot(pos.x, pos.z);
      if (r > WALK_RADIUS) {
        const nx = pos.x / r;
        const nz = pos.z / r;
        pos.x = nx * WALK_RADIUS;
        pos.z = nz * WALK_RADIUS;
        const radial = s.vx * nx + s.vz * nz;
        if (radial > 0) {
          s.vx -= radial * nx;
          s.vz -= radial * nz;
        }
      }

      const sp = Math.hypot(s.vx, s.vz);
      if (!reduced && sp > 0.2) s.bob += dt * sp * 1.9;
      const bobAmt = reduced ? 0 : Math.min(1, sp / WALK_SPEED) * 0.022;
      const ground = terrainHeight(pos.x, pos.z) + SURFACE_HEAD_HEIGHT;
      const targetY = ground + Math.sin(s.bob * 2) * bobAmt + (1 - settleE) * SETTLE_RISE;
      s.y += (targetY - s.y) * (settle < 1 ? 1 : damp(10, dt));
      pos.y = s.y;
    }

    const settlePitch = (1 - settleE) * -0.12;
    euler.current.set(s.pitch + settlePitch, s.yaw, 0, 'YXZ');
    camera.quaternion.setFromEuler(euler.current);
    camera.updateMatrixWorld();

    /* ---- focus detection ---- */
    if (settle >= 1 && !s.glideId) {
      const fx = -Math.sin(s.yaw) * Math.cos(s.pitch);
      const fy = Math.sin(s.pitch);
      const fz = -Math.cos(s.yaw) * Math.cos(s.pitch);
      let nearId: string | null = null;
      let nearD = Infinity;
      let gazeId: string | null = null;
      let gazeA = Infinity;
      let stickyD = Infinity;
      for (const b of beacons) {
        const dx = b.position[0] - pos.x;
        const dz = b.position[2] - pos.z;
        const d = Math.hypot(dx, dz);
        if (b.id === s.sticky) stickyD = d;
        if (d < nearD) {
          nearD = d;
          nearId = b.id;
        }
        if (d < GAZE_RANGE && d > 0.5) {
          const dy = b.position[1] + b.height * 0.55 - pos.y;
          const len = Math.hypot(dx, dy, dz);
          const a = Math.acos(THREE.MathUtils.clamp((dx * fx + dy * fy + dz * fz) / len, -1, 1));
          const limit = b.id === s.gazeId && store.focusedBeaconId === b.id ? GAZE_HOLD : GAZE_ANGLE;
          if (a < limit && a < gazeA) {
            gazeA = a;
            gazeId = b.id;
          }
        }
      }
      const prox = nearD < NEAR_FOCUS ? nearId : null;

      // external changes (click, HUD list, Escape) override auto focus
      if (store.focusedBeaconId !== s.lastSet) {
        if (store.focusedBeaconId) s.sticky = store.focusedBeaconId;
        else {
          s.dismissed = s.lastSet;
          s.sticky = null;
        }
        s.lastSet = store.focusedBeaconId;
      }

      if (gazeId !== s.gazeId) {
        s.gazeId = gazeId;
        s.gazeTime = 0;
      } else if (gazeId) s.gazeTime += dt;
      const gaze = gazeId && s.gazeTime >= GAZE_DWELL ? gazeId : null;

      let next: string | null = prox ?? gaze;
      if (s.sticky) {
        if (stickyD > STICKY_RELEASE) s.sticky = null;
        else if (prox && prox !== s.sticky && nearD < stickyD - 0.5) s.sticky = null;
        else next = s.sticky;
      }
      // a dismissed beacon stays closed until the player looks or walks away from it
      if (s.dismissed) {
        if (next === s.dismissed) next = null;
        else if (prox !== s.dismissed && gazeId !== s.dismissed) s.dismissed = null;
      }
      if (next !== store.focusedBeaconId) {
        s.lastSet = next;
        store.setFocusedBeacon(next);
      }
    }

    /* ---- screen projection for the HUD ---- */
    const w = size.width;
    const h = size.height;
    const cx = w / 2;
    const cy = h / 2;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const p = v3.current;
    for (const b of beacons) {
      const info = beaconScreen[b.id];
      if (!info) continue;
      p.set(b.position[0], b.position[1] + b.height * 0.55, b.position[2]).applyMatrix4(camera.matrixWorldInverse);
      const depth = -p.z;
      info.size = depth > 0.1 ? (b.height / (depth * tanHalf * 2)) * h : 0;
      let sx: number;
      let sy: number;
      if (depth > 0.1) {
        p.applyMatrix4(camera.projectionMatrix);
        sx = (p.x * 0.5 + 0.5) * w;
        sy = (-p.y * 0.5 + 0.5) * h;
      } else {
        // behind the camera: push far out along its view-space direction so it pins to an edge
        const len = Math.hypot(p.x, p.y);
        sx = len > 1e-3 ? cx + (p.x / len) * w : cx;
        sy = len > 1e-3 ? cy - (p.y / len) * h : cy + h;
      }
      const onScreen = depth > 0.1 && sx >= 0 && sx <= w && sy >= 0 && sy <= h;
      info.angle = Math.atan2(sy - cy, sx - cx);
      if (!onScreen) {
        // project onto the inset rectangle along the direction from centre
        const ex = cx - EDGE_INSET;
        const ey = cy - EDGE_INSET;
        const dx = sx - cx;
        const dy = sy - cy;
        const k = Math.min(ex / Math.max(Math.abs(dx), 1e-4), ey / Math.max(Math.abs(dy), 1e-4));
        sx = cx + dx * k;
        sy = cy + dy * k;
      }
      info.x = sx;
      info.y = sy;
      info.visible = onScreen;
    }
  });

  return null;
};

export default PlanetCamera;
