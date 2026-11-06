import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useAppStore } from '@/state/useAppStore';
import { beaconScreen, dragLook, joystickState, keyboardState, mouseLook, type PlanetScreenInfo } from '@/state/runtime';
import { BEACON_VIEW_DISTANCE, getBeaconViewPoint, SURFACE_HEAD_HEIGHT, SURFACE_SPAWN } from '@/data/content';
import type { Vec3 } from '@/types/content';
import type { HeightFn } from './Terrain';
import { LABEL_ANCHOR } from './Beacon';
import { arrivalPulse } from './surfaceState';
import { ARRIVAL_MS } from '@/state/timing';

export interface SurfaceBeacon {
  id: string;
  /** Ground-level world position */
  position: Vec3;
  /** Monument height */
  height: number;
}

const WALK_SPEED = 3.4;
const RUN_SPEED = 6.8;
const PITCH_LIMIT = 0.6;
/** The descent and the hatch are drawn by the ship rig; this only gates input and focus */
const SETTLE_MS = ARRIVAL_MS;
const SETTLE_RISE = 0;
const GLIDE_S = 1.1;
const NEAR_FOCUS = 5.5;
const GAZE_RANGE = 14;
const GAZE_ANGLE = (6 * Math.PI) / 180;
const GAZE_HOLD = (9 * Math.PI) / 180;
const GAZE_DWELL = 0.45;
/** With the cursor locked, a click opens the beacon within this angle of the screen centre */
const AIM_ANGLE = (10 * Math.PI) / 180;
const STICKY_RELEASE = 7;
const BEACON_COLLIDE = 1.15;
const EDGE_INSET = 48;
/** Resting gaze sits slightly above level so monuments fill more of the frame */
const PITCH_BIAS = 0.1;
/** Room kept beside the monument on wide screens, where its content screens fan out */
const PANEL_WIDTH = 420;
const GLIDE_DISTANCE = 6;
/** Gaze focus stays off this long after the arrival settle */
const GAZE_LOCKOUT_MS = 1500;
/** Discovery pulse starts this long after the settle */
const PULSE_DELAY_MS = 600;
/** Portrait screens: frame the whole beacon arc from further back */
const PORTRAIT_ASPECT = 0.8;
/** Portrait: horizon at ~40% from the top */
const PORTRAIT_HORIZON = 0.4;
/** Portrait: the framed monuments should fill at least this fraction of screen height */
const PORTRAIT_MIN_SIZE = 0.25;
const PORTRAIT_MIN_Z = 1.0;

/** Extra per-beacon fields for the DOM label layer (until PlanetScreenInfo carries them) */
type BeaconScreenInfo = PlanetScreenInfo & {
  /** Camera to beacon, world units (XZ) */
  distance: number;
  /** Reserved: true when terrain hides the label anchor */
  occluded: boolean;
  /** 0..1 legibility factor: 1 near or focused, ~0.7 far */
  scale: number;
};

const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Two-key check without the rest-array allocation of isKeyDown */
const kd = (a: string, b: string) => keyboardState[a] === true || keyboardState[b] === true;

interface PlanetCameraProps {
  planetId: string;
  beacons: SurfaceBeacon[];
  /** Ground height for this planet's style */
  ground: HeightFn;
  walkRadius: number;
}

/**
 * First-person walker for the planet surface. Owns the camera only in
 * mode 'planet'; TransitionController owns it in the transition modes.
 */
const PlanetCamera = ({ planetId, beacons, ground, walkRadius }: PlanetCameraProps) => {
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
    glideStart: 0,
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
    gazeUnlock: 0,
    bias: PITCH_BIAS,
  });
  const sizeRef = useRef(size);
  sizeRef.current = size;
  useEffect(
    () => () => {
      arrivalPulse.start = -1;
      mouseLook.aimId = null;
    },
    [],
  );
  const euler = useRef(new THREE.Euler(0, 0, 0, 'YXZ'));
  const v3 = useRef(new THREE.Vector3());

  // allocate one screen record per beacon; mutate them every frame
  useEffect(() => {
    for (const b of beacons) {
      const info = (beaconScreen[b.id] ?? { x: 0, y: 0, visible: false, angle: 0, size: 0 }) as BeaconScreenInfo;
      info.distance ??= 0;
      info.occluded ??= false;
      info.scale ??= 0.85;
      beaconScreen[b.id] = info;
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
    // portrait: step back only far enough to frame the middle beacons (outer ones may sit at
    // the edges; chips and edge arrows cover them), keep them a readable size, look slightly down
    let sz = SURFACE_SPAWN[2];
    const { width, height } = sizeRef.current;
    const aspect = width / Math.max(1, height);
    s.bias = PITCH_BIAS;
    if (aspect < PORTRAIT_ASPECT && beacons.length) {
      const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      const t = Math.tan(Math.max(0.1, Math.atan(tanV * aspect) - 0.05));
      const byX = [...beacons].sort((a, b) => Math.abs(a.position[0]) - Math.abs(b.position[0]));
      const n = byX.length;
      const pick = n % 2 === 0 ? 1 : n >= 5 ? 2 : 0;
      const mid = byX[Math.min(pick, n - 1)];
      const fit = Math.abs(mid.position[0]) / t + mid.position[2];
      const maxDepth = mid.height / (2 * PORTRAIT_MIN_SIZE * tanV);
      // may also step forward a little when the monuments are short (keeps them a readable size)
      sz = Math.max(PORTRAIT_MIN_Z, Math.min(fit, mid.position[2] + maxDepth, walkRadius - 1));
      s.bias = -Math.atan((0.5 - PORTRAIT_HORIZON) * 2 * tanV);
    }
    const gy = ground(SURFACE_SPAWN[0], sz) + SURFACE_HEAD_HEIGHT;
    s.y = gy + (reduced ? 0 : SETTLE_RISE);
    const now = performance.now();
    s.settleStart = reduced ? -1 : now;
    const settleEnd = now + (reduced ? 0 : SETTLE_MS);
    s.gazeUnlock = settleEnd + GAZE_LOCKOUT_MS;
    arrivalPulse.start = settleEnd + PULSE_DELAY_MS;
    camera.position.set(SURFACE_SPAWN[0], s.y, sz);
    euler.current.set(s.bias, 0, 0);
    camera.quaternion.setFromEuler(euler.current);
  }, [mode, planetId, camera, beacons, ground, walkRadius]);

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
    const kw = kd('KeyW', 'ArrowUp');
    const ks = kd('KeyS', 'ArrowDown');
    const kr = kd('KeyD', 'ArrowRight');
    const kl = kd('KeyA', 'ArrowLeft');
    if (kw) iz -= 1;
    if (ks) iz += 1;
    if (kr) ix += 1;
    if (kl) ix -= 1;
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
    if (store.glideBeaconId && (moving || kw || ks || kr || kl)) {
      s.glideId = null;
      store.clearGlide();
    } else if (store.glideBeaconId && store.glideBeaconId !== s.glideId) {
      const b = beacons.find((x) => x.id === store.glideBeaconId);
      if (!b) {
        store.clearGlide();
      } else {
        // same line as the shared view point, but a little further back so the whole
        // monument and its label fit the frame
        const vp = getBeaconViewPoint(b.position);
        vp[0] = b.position[0] + (vp[0] - b.position[0]) * (GLIDE_DISTANCE / BEACON_VIEW_DISTANCE);
        vp[2] = b.position[2] + (vp[2] - b.position[2]) * (GLIDE_DISTANCE / BEACON_VIEW_DISTANCE);
        s.glideId = b.id;
        s.glideT = 0;
        s.glideStart = performance.now();
        s.from.copy(pos);
        s.to.set(vp[0], ground(vp[0], vp[2]) + SURFACE_HEAD_HEIGHT, vp[2]);
        s.fromYaw = s.yaw;
        const dx = b.position[0] - vp[0];
        const dz = b.position[2] - vp[2];
        let face = Math.atan2(-dx, -dz);
        // wide desktop: turn a little right so the beacon sits left of centre, clear of the panel
        const w = size.width;
        if (w / size.height > 1.2 && w >= 900) {
          const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * (w / size.height);
          face -= Math.atan(((Math.min(PANEL_WIDTH, w * 0.34) / 2) / (w / 2)) * tanH) * 0.9;
        }
        s.toYaw = s.yaw + wrapAngle(face - s.yaw);
        s.fromPitch = s.pitch;
        const mid = b.position[1] + b.height * 0.55;
        s.toPitch = THREE.MathUtils.clamp(
          Math.atan2(mid - s.to.y, Math.hypot(dx, dz)) - s.bias,
          -PITCH_LIMIT,
          PITCH_LIMIT,
        );
        s.vx = s.vz = 0;
        s.settleStart = -1;
        s.sticky = b.id;
        s.dismissed = null;
      }
    }

    if (s.glideId) {
      // wall-clock based so slow frames never stretch the glide
      s.glideT = reduced ? 1 : Math.min(1, (performance.now() - s.glideStart) / (GLIDE_S * 1000));
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
      // locked mouse look wants to feel direct; drags keep the softer follow
      const kLook = damp(reduced || mouseLook.locked ? 30 : 14, dt);
      s.yaw += (dragLook.yaw - s.yaw) * kLook;
      s.pitch += (dragLook.pitch - s.pitch) * kLook;

      /* ---- walk ---- */
      const speed = kd('ShiftLeft', 'ShiftRight') ? RUN_SPEED : WALK_SPEED;
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
      if (r > walkRadius) {
        const nx = pos.x / r;
        const nz = pos.z / r;
        pos.x = nx * walkRadius;
        pos.z = nz * walkRadius;
        const radial = s.vx * nx + s.vz * nz;
        if (radial > 0) {
          s.vx -= radial * nx;
          s.vz -= radial * nz;
        }
      }

      const sp = Math.hypot(s.vx, s.vz);
      if (!reduced && sp > 0.2) s.bob += dt * sp * 1.9;
      const bobAmt = reduced ? 0 : Math.min(1, sp / WALK_SPEED) * 0.022;
      const gh = ground(pos.x, pos.z) + SURFACE_HEAD_HEIGHT;
      const targetY = gh + Math.sin(s.bob * 2) * bobAmt + (1 - settleE) * SETTLE_RISE;
      s.y += (targetY - s.y) * (settle < 1 ? 1 : damp(10, dt));
      pos.y = s.y;
    }

    const viewPitch = s.pitch + s.bias;
    euler.current.set(viewPitch, s.yaw, 0, 'YXZ');
    camera.quaternion.setFromEuler(euler.current);
    camera.updateMatrixWorld();

    /* ---- focus detection ---- */
    mouseLook.aimId = null;
    if (settle >= 1 && !s.glideId) {
      const fx = -Math.sin(s.yaw) * Math.cos(viewPitch);
      const fy = Math.sin(viewPitch);
      const fz = -Math.cos(s.yaw) * Math.cos(viewPitch);
      let nearId: string | null = null;
      let nearD = Infinity;
      let gazeId: string | null = null;
      let gazeA = Infinity;
      let stickyD = Infinity;
      let aimA = AIM_ANGLE;
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
          if (a < aimA) {
            aimA = a;
            mouseLook.aimId = b.id;
          }
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
      // explicit lockout after arrival, so the centre beacon never pops open on its own
      const gaze = gazeId && s.gazeTime >= GAZE_DWELL && performance.now() > s.gazeUnlock ? gazeId : null;

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
      const info = beaconScreen[b.id] as BeaconScreenInfo | undefined;
      if (!info) continue;
      const bdx = b.position[0] - pos.x;
      const bdz = b.position[2] - pos.z;
      info.distance = Math.sqrt(bdx * bdx + bdz * bdz);
      info.occluded = false;
      const legible =
        store.focusedBeaconId === b.id ? 1 : 0.7 + 0.3 * (1 - THREE.MathUtils.smoothstep(info.distance, 5, 17));
      info.scale += (legible - info.scale) * damp(5, dt);
      // anchored at the in-world label above the monument top
      p.set(b.position[0], b.position[1] + b.height + LABEL_ANCHOR, b.position[2]).applyMatrix4(camera.matrixWorldInverse);
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
