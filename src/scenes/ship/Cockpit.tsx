import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useAppStore, type SceneMode } from '@/state/useAppStore';
import { dashScreens, flight } from '@/state/runtime';
import {
  DESCENT_MS,
  DOOR_AT,
  DOOR_OPEN_AT,
  DOOR_OPEN_MS,
  ENTER_DIVE,
  SLIDE_SHARE,
  TURN_MS,
  WALK_FROM,
} from '@/state/timing';
import { responsiveFov } from '@/scenes/overworld/TelescopeCamera';
import { shipSound } from '@/audio/drone';
import { cockpitShape, FRAME_DEPTH, HOLE, offsetPoly, type Pt } from './shape';
import SpeedLines from './SpeedLines';
import { glassMaterial, instrumentMaterial } from './materials';
import { DOOR_Z, JAMB_Z, SLAB_H, SLAB_TRAVEL, SLAB_W, SLAB_Y, doorway, slabTexture } from './hatch';

/*
 * The ship around the viewer. In orbit it is an observation deck: a bulkhead
 * with a wide canopy window, a dashboard below it and a couple of instruments.
 * Diving into a planet, the ship burns toward it (the transition controller
 * moves the camera), the canopy glows on entry, and after the cut the rig
 * flies the descent and the touchdown. Then the view cuts to the hatch, which
 * slides open while the viewer steps out onto the surface.
 *
 * Geometry lives in "frame units": the bulkhead sits FRAME_DEPTH in front of
 * the eye and the frame group is scaled by the resting lens, so x and y of
 * the bulkhead map straight to screen space (1 = screen edge) at rest.
 */

/* ---------- descent and touchdown ---------- */

/** The descent starts this high and this far behind the landing spot */
const DESCENT_RISE = 15;
const DESCENT_BACK = 9;
const DESCENT_SIDE = 2.2;
/** Nose down at the start of the descent, radians */
const DESCENT_PITCH = 0.62;
const DESCENT_BANK = 0.09;
/** Touchdown: how far the legs compress and how fast it springs back */
const TOUCH_DIP = 0.24;
/** How far behind the spawn the viewer stands at the hatch, world units */
const HATCH_STEP = 1.3;
/** Half the whip pan from the window round to the hatch, radians */
const TURN_YAW = 0.6;
/** Arrival clock value meaning "long since landed" */
const ARRIVAL_DONE = 1e9;

const noRaycast = () => null;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);
/** Smooth pseudo-random wobble, roughly -1..1 */
const wobble = (t: number, k: number) =>
  Math.sin(t * 31.7 + k) * 0.5 + Math.sin(t * 19.3 + k * 2.1) * 0.3 + Math.sin(t * 53.9 + k * 3.7) * 0.2;

interface Rig {
  mode: SceneMode;
  diveAt: number;
  /**
   * Arrival clock in ms, advanced by clamped frame time from the first frame
   * on the planet (-1 until then). Frame time, not the wall clock: the first
   * frames on a new planet can stall on shader compiles, and a wall clock
   * would skip the whole landing.
   */
  arriveAt: number;
  arriveTick: boolean;
  arrivePending: boolean;
  launchAt: number;
  chained: boolean;
  applied: boolean;
  basePos: THREE.Vector3;
  baseQuat: THREE.Quaternion;
  /** What the rig left the camera at, to tell whether anyone moved it since */
  outPos: THREE.Vector3;
  outQuat: THREE.Quaternion;
  lastPos: THREE.Vector3;
  hasLast: boolean;
  ship: THREE.Quaternion;
  deploy: number;
  aspect: number;
  doorSound: boolean;
}

const _fwd = new THREE.Vector3();
const _fwd3 = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _qYaw = new THREE.Quaternion();
const _right = new THREE.Vector3();
const _off = new THREE.Vector3();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _q = new THREE.Quaternion();
const _qShip = new THREE.Quaternion();
const _qHead = new THREE.Quaternion();
const _target = new THREE.Quaternion();
const ID = new THREE.Quaternion();
const _corner = new THREE.Vector3();
/** Corners of a dash display face (its plane is 0.12 x 0.06) */
const DISPLAY_CORNERS = [
  [-0.06, -0.03],
  [0.06, -0.03],
  [0.06, 0.03],
  [-0.06, 0.03],
] as const;

/* ---------- geometry ---------- */

const plateMaterial = (map: THREE.Texture) =>
  new THREE.MeshStandardMaterial({
    color: '#3a4352',
    map,
    metalness: 0.45,
    roughness: 0.55,
    fog: false,
    transparent: true,
    opacity: 1,
  });

/** Dark brushed panels with seams and rivets, drawn once to a canvas. */
const panelTexture = () => {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = '#9aa3b2';
  g.fillRect(0, 0, 512, 512);
  // brushed grain
  for (let i = 0; i < 1400; i += 1) {
    g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${0.025 + Math.random() * 0.03})`;
    g.fillRect(Math.random() * 512, Math.random() * 512, 30 + Math.random() * 120, 1);
  }
  // panel seams: a dark groove with a lit lower lip
  const seam = (x0: number, y0: number, x1: number, y1: number) => {
    g.strokeStyle = 'rgba(10,12,18,0.85)';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.16)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x0 + 1.5, y0 + 2);
    g.lineTo(x1 + 1.5, y1 + 2);
    g.stroke();
  };
  for (const y of [0, 170, 340]) seam(0, y + 2, 512, y + 2);
  for (const [x, y0, y1] of [
    [128, 0, 170],
    [384, 0, 170],
    [256, 170, 340],
    [64, 340, 512],
    [320, 340, 512],
  ] as const)
    seam(x, y0, x, y1);
  // rivet rows along the seams
  for (const y of [14, 184, 354])
    for (let x = 10; x < 512; x += 32) {
      g.fillStyle = 'rgba(0,0,0,0.5)';
      g.beginPath();
      g.arc(x + 0.8, y + 0.8, 2.6, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.beginPath();
      g.arc(x, y, 1.8, 0, Math.PI * 2);
      g.fill();
    }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
};

/** A thin tube following a closed outline (frame units), for the window's light strip. */
const outlineTube = (pts: Pt[], z: number, radius: number) => {
  const curve = new THREE.CatmullRomCurve3(
    pts.map(([x, y]) => new THREE.Vector3(x, y, z)),
    true,
    'catmullrom',
    0.08,
  );
  return new THREE.TubeGeometry(curve, 400, radius, 6, true);
};

/** Points every `step` along a closed outline (for rivets). */
const along = (pts: Pt[], step: number): Pt[] => {
  const out: Pt[] = [];
  for (let i = 0; i < pts.length; i += 1) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[(i + 1) % pts.length];
    const len = Math.hypot(bx - ax, by - ay);
    const n = Math.max(1, Math.round(len / step));
    for (let k = 0; k < n; k += 1) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  return out;
};

const useCockpitParts = () =>
  useMemo(() => {
    const D = FRAME_DEPTH;
    const tex = panelTexture();
    tex.repeat.set(1.6, 1.6);
    const plate = plateMaterial(tex);
    const trimTex = tex.clone();
    trimTex.repeat.set(5, 5);
    const trim = new THREE.MeshStandardMaterial({
      color: '#59606d',
      map: trimTex,
      metalness: 0.7,
      roughness: 0.38,
      fog: false,
      transparent: true,
    });
    const dark = new THREE.MeshStandardMaterial({ color: '#141922', metalness: 0.3, roughness: 0.7, fog: false, transparent: true });
    const strip = new THREE.MeshBasicMaterial({ color: new THREE.Color('#9fc4ff').multiplyScalar(0.75), fog: false, transparent: true });
    const amber = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb46a').multiplyScalar(1.15), fog: false, transparent: true });

    // the bulkhead: a huge plate with the window cut out, beveled so the cut reads as thick metal
    const hole = offsetPoly(HOLE, 0.02);
    const bulkhead = new THREE.ExtrudeGeometry(cockpitShape(hole), {
      depth: 0.05,
      bevelEnabled: true,
      bevelThickness: 0.012,
      bevelSize: 0.012,
      bevelSegments: 3,
      curveSegments: 6,
    });
    bulkhead.translate(0, 0, -D - 0.062);

    // the window frame: a raised ring just inside the bulkhead cut
    const ringShape = new THREE.Shape(offsetPoly(HOLE, 0.045).map(([x, y]) => new THREE.Vector2(x, y)));
    ringShape.holes.push(new THREE.Path(HOLE.map(([x, y]) => new THREE.Vector2(x, y))));
    const ring = new THREE.ExtrudeGeometry(ringShape, {
      depth: 0.012,
      bevelEnabled: true,
      bevelThickness: 0.006,
      bevelSize: 0.006,
      bevelSegments: 3,
    });
    ring.translate(0, 0, -D + 0.004);

    const lightStrip = outlineTube(offsetPoly(HOLE, 0.006), -D + 0.019, 0.0013);

    const rivetGeo = new THREE.SphereGeometry(0.0034, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    rivetGeo.rotateX(Math.PI / 2);
    rivetGeo.scale(1, 1, 0.5);
    const rivetPts = along(offsetPoly(HOLE, 0.031), 0.04);

    // dashboard: a slab rising toward the viewer below the window
    const dash = new THREE.BoxGeometry(5, 0.03, 0.36);
    // the top rises toward the pilot, like a dashboard under a windscreen
    const dashTilt = -Math.atan2(0.085, 0.32);

    return { plate, trim, dark, strip, amber, bulkhead, ring, lightStrip, rivetGeo, rivetPts, dash, dashTilt, tex, trimTex };
  }, []);

const useHatchParts = () =>
  useMemo(() => {
    const tL = slabTexture(false);
    const tR = slabTexture(true);
    const slabMat = (map: THREE.Texture) =>
      new THREE.MeshStandardMaterial({ color: '#9aa3b2', map, metalness: 0.5, roughness: 0.5, fog: false, transparent: true });
    const slabMatL = slabMat(tL);
    const slabMatR = slabMat(tR);
    const slab = new THREE.BoxGeometry(SLAB_W, SLAB_H, 0.03);
    const jambTex = panelTexture();
    jambTex.repeat.set(2, 2);
    const jambMat = new THREE.MeshStandardMaterial({
      color: '#4a5260',
      map: jambTex,
      metalness: 0.55,
      roughness: 0.5,
      fog: false,
      transparent: true,
    });
    const jamb = new THREE.ExtrudeGeometry(cockpitShape(doorway()), {
      depth: 0.04,
      bevelEnabled: true,
      bevelThickness: 0.01,
      bevelSize: 0.01,
      bevelSegments: 3,
      curveSegments: 6,
    });
    jamb.translate(0, 0, JAMB_Z - 0.05);
    const mats = [slabMatL, slabMatR, jambMat];
    return {
      slab,
      jamb,
      slabMatL,
      slabMatR,
      jambMat,
      setOpacity: (o: number) => {
        for (const m of mats) {
          m.opacity = o;
          m.depthWrite = o >= 1;
        }
      },
      dispose: () => {
        for (const m of mats) m.dispose();
        for (const t of [tL, tR, jambTex]) t.dispose();
        slab.dispose();
        jamb.dispose();
      },
    };
  }, []);

/* ---------- the rig: camera offsets, ship pose, sounds ---------- */

const Cockpit = () => {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const parts = useCockpitParts();
  const shipRef = useRef<THREE.Group>(null);
  const frameRef = useRef<THREE.Group>(null);
  const leds = useRef<THREE.InstancedMesh>(null);
  const glow = useRef<THREE.PointLight>(null);
  const rivets = useRef<THREE.InstancedMesh>(null);
  const hatchRef = useRef<THREE.Group>(null);
  const blinkRef = useRef<THREE.Mesh>(null);
  const blinkMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({ color: '#020306', transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false }),
    [],
  );
  useEffect(() => () => blinkMat.dispose(), [blinkMat]);
  const slabL = useRef<THREE.Mesh>(null);
  const slabR = useRef<THREE.Mesh>(null);
  const lamp = useRef<THREE.MeshBasicMaterial>(null);
  const hatch = useHatchParts();
  const glass = useMemo(() => glassMaterial(), []);
  const displays = useRef<(THREE.Mesh | null)[]>([]);
  const screenL = useMemo(() => instrumentMaterial(0), []);
  const screenR = useMemo(() => instrumentMaterial(1), []);
  const rig = useRef<Rig>({
    mode: useAppStore.getState().mode,
    diveAt: -1,
    arriveAt: -1,
    arriveTick: false,
    arrivePending: false,
    launchAt: -1,
    chained: false,
    applied: false,
    basePos: new THREE.Vector3(),
    baseQuat: new THREE.Quaternion(),
    outPos: new THREE.Vector3(),
    outQuat: new THREE.Quaternion(),
    lastPos: new THREE.Vector3(),
    hasLast: false,
    ship: new THREE.Quaternion(),
    deploy: useAppStore.getState().mode === 'planet' ? 0 : 1,
    aspect: size.width / Math.max(1, size.height),
    doorSound: false,
  });

  useEffect(
    () => () => {
      for (const m of [parts.plate, parts.trim, parts.dark, parts.strip, parts.amber, glass, screenL, screenR]) m.dispose();
      for (const g of [parts.bulkhead, parts.ring, parts.lightStrip, parts.rivetGeo, parts.dash]) g.dispose();
      parts.tex.dispose();
      parts.trimTex.dispose();
      hatch.dispose();
    },
    [parts, glass, screenL, screenR, hatch],
  );

  // timeline marks and engine sounds follow the scene mode
  useEffect(
    () =>
      useAppStore.subscribe((s, p) => {
        if (s.mode === p.mode) return;
        const r = rig.current;
        const now = performance.now();
        r.chained = s.mode === 'transitioning-in' && p.mode === 'transitioning-out';
        r.mode = s.mode;
        if (s.mode === 'transitioning-in') {
          r.diveAt = now;
          if (!r.chained && !s.reducedMotion) shipSound('dive');
        } else if (s.mode === 'planet') {
          r.arriveAt = -1;
          r.arriveTick = false;
          r.arrivePending = true;
          flight.arrivalMs = -1;
          r.doorSound = false;
        } else if (s.mode === 'transitioning-out') {
          r.launchAt = now;
          if (!s.reducedMotion) shipSound('beam');
        } else if (s.mode === 'overworld') {
          flight.heat = 0;
        }
      }),
    [],
  );

  // rivet layout
  useEffect(() => {
    const m = rivets.current;
    if (!m) return;
    const o = new THREE.Object3D();
    parts.rivetPts.forEach(([x, y], i) => {
      o.position.set(x, y, -FRAME_DEPTH + 0.026);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
    if (leds.current) {
      placeLeds(leds.current);
      for (let i = 0; i < LED_COUNT; i += 1) leds.current.setColorAt(i, _c.set('#7fd4ff'));
      LED_MAT.needsUpdate = true;
    }
  }, [parts]);

  // restore the camera to what its controller wrote, before any controller runs;
  // skipped when something placed the camera in between (the landing spawn on arrival)
  useFrame(() => {
    const r = rig.current;
    if (!r.applied) return;
    r.applied = false;
    if (!camera.position.equals(r.outPos) || !camera.quaternion.equals(r.outQuat)) return;
    camera.position.copy(r.basePos);
    camera.quaternion.copy(r.baseQuat);
  }, -1);

  // after the controllers: speed, descent, shake, then place the ship around the eye
  useFrame(({ clock }, delta) => {
    const r = rig.current;
    const dt = Math.min(delta, 0.05);
    const now = performance.now();
    const t = clock.elapsedTime;
    const store = useAppStore.getState();
    const reduced = store.reducedMotion;
    const mode = store.mode;

    if (r.arrivePending && mode === 'planet') {
      // the first frame after the surface mounts starts the descent clock
      r.arrivePending = false;
      r.arriveAt = 0;
      if (!reduced) shipSound('land', DESCENT_MS / 1000);
    }

    r.basePos.copy(camera.position);
    r.baseQuat.copy(camera.quaternion);

    /* speed, from what the controllers did (teleports at the cut are ignored) */
    if (r.hasLast && dt > 0) {
      const step = camera.position.distanceTo(r.lastPos);
      if (step < 25) flight.speed += (step / dt - flight.speed) * damp(10, dt);
    }
    r.lastPos.copy(camera.position);
    r.hasLast = true;
    if (mode !== 'transitioning-in') flight.heat = Math.max(0, flight.heat - dt * 3.2);

    /* descent: the ship comes down from behind and above, nose down, and settles onto its legs */
    let descK = 0;
    let shake = 0;
    let dip = 0;
    /** hatch: -1 hidden, else 0..1 fade in while it shuts; open is the 0..1 slide */
    let hatchIn = -1;
    let open = 0;
    /** 0..1 slab travel, then 0..1 steps out through the doorway (they overlap) */
    let slideK = 0;
    let walkK = 0;
    /** the turn: yaw of the view off the ship's heading, and how dark the blink is */
    let turnYaw = 0;
    let blink = 0;
    if (mode === 'planet' && r.arriveAt >= 0) {
      // the first frame starts the clock at 0; a stalled frame counts as one frame
      if (r.arriveTick) r.arriveAt += Math.min(delta, 0.1) * 1000;
      r.arriveTick = true;
      flight.arrivalMs = reduced ? ARRIVAL_DONE : r.arriveAt;
    }
    if (mode === 'planet' && r.arriveAt >= 0 && !reduced) {
      const ms = r.arriveAt;
      if (ms >= DOOR_AT) {
        const u = clamp01((ms - DOOR_AT) / TURN_MS);
        // first half: swing right, away from the window; second half: come round onto the hatch
        if (u < 0.5) turnYaw = -TURN_YAW * Math.pow(u * 2, 2.2);
        else turnYaw = TURN_YAW * (1 - easeOutCubic((u - 0.5) * 2));
        blink = u < 0.5 ? THREE.MathUtils.smoothstep(u, 0.12, 0.42) : 1 - THREE.MathUtils.smoothstep(u, 0.6, 0.92);
        hatchIn = u >= 0.5 ? 1 : -1;
        open = clamp01((ms - DOOR_OPEN_AT) / DOOR_OPEN_MS);
        slideK = easeInOutCubic(clamp01(open / SLIDE_SHARE));
        walkK = easeInOutCubic(clamp01((open - WALK_FROM) / (1 - WALK_FROM)));
        if (!r.doorSound && ms >= DOOR_OPEN_AT - 30) {
          r.doorSound = true;
          shipSound('door', (DOOR_OPEN_MS * SLIDE_SHARE) / 1000);
        }
        if (ms >= DOOR_OPEN_AT) shake += 0.006 * Math.exp(-16 * ((ms - DOOR_OPEN_AT) / 1000));
        if (ms > DOOR_OPEN_AT + DOOR_OPEN_MS + 120) hatchIn = -1;
      }
      descK = 1 - easeOutCubic(clamp01(ms / DESCENT_MS));
      shake += 0.007 * descK;
      if (ms > DESCENT_MS) {
        const ts = (ms - DESCENT_MS) / 1000;
        if (ts < 1.2) {
          dip = -TOUCH_DIP * Math.exp(-7.5 * ts) * Math.sin(13 * ts);
          shake += 0.016 * Math.exp(-10 * ts);
        }
      }
    } else if (mode === 'transitioning-in' && !r.chained && !reduced) {
      const u = clamp01((now - r.diveAt) / ENTER_DIVE);
      // ignition kick, then a rattle that builds with speed and entry heat
      shake = 0.0015 + 0.011 * u * u * u + 0.006 * flight.heat + 0.006 * Math.exp(-u * 14);
    } else if (mode === 'transitioning-out' && !reduced) {
      // the beam's hum in the bones
      shake = 0.0025 * clamp01((now - r.launchAt) / 600);
    }

    _fwd.set(0, 0, -1).applyQuaternion(r.baseQuat);
    _fwd.y = 0;
    if (_fwd.lengthSq() < 1e-6) _fwd.set(0, 0, -1);
    _fwd.normalize();
    _right.set(-_fwd.z, 0, _fwd.x);

    if (descK > 0 || dip !== 0) {
      _off
        .set(0, DESCENT_RISE * descK + dip, 0)
        .addScaledVector(_fwd, -DESCENT_BACK * descK)
        .addScaledVector(_right, DESCENT_SIDE * descK * descK);
      camera.position.add(_off);
      _e.set(-DESCENT_PITCH * Math.pow(descK, 1.25) + dip * 0.12, 0, DESCENT_BANK * descK, 'YXZ');
      camera.quaternion.multiply(_q.setFromEuler(_e));
    }
    // behind the shut hatch the viewer stands a step back, then walks out as it opens
    if (hatchIn >= 1) camera.position.addScaledVector(_fwd, -HATCH_STEP * (1 - walkK));

    // the ship's orientation before shake: fixed in orbit, swinging after the camera otherwise
    if (mode === 'overworld' || reduced) r.ship.copy(mode === 'overworld' ? ID : camera.quaternion);
    else r.ship.slerp(camera.quaternion, damp(mode === 'transitioning-in' ? 7 : 16, dt));
    // the turn happens inside the ship: the view swings, the ship stays put
    _qYaw.setFromAxisAngle(_up, turnYaw);
    if (turnYaw !== 0) camera.quaternion.multiply(_qYaw);

    // shake moves ship and eye together; the head adds a little of its own
    _qShip.identity();
    _qHead.identity();
    if (shake > 0) {
      _e.set(wobble(t, 0.3) * shake, wobble(t, 1.7) * shake, wobble(t, 4.1) * shake * 0.6, 'YXZ');
      _qShip.setFromEuler(_e);
      _e.set(wobble(t * 1.3, 7.7) * shake * 0.35, wobble(t * 1.3, 9.1) * shake * 0.35, 0, 'YXZ');
      _qHead.setFromEuler(_e);
      camera.position.addScaledVector(_right, wobble(t, 2.9) * shake * 1.5);
      camera.position.y += wobble(t, 5.3) * shake * 1.5;
    }
    _target.copy(camera.quaternion).multiply(_qShip);
    camera.quaternion.copy(_target).multiply(_qHead);
    r.outPos.copy(camera.position);
    r.outQuat.copy(camera.quaternion);
    r.applied = true;

    /* deploy: 1 = the frame around the view, 0 = cleared away past the screen edges */
    let deploy = 1;
    if (mode === 'planet') {
      if (reduced) deploy = 0;
      else if (r.arriveAt >= DOOR_AT + TURN_MS / 2) deploy = 0;
    } else if (mode === 'transitioning-out') {
      // beamed straight up: no cockpit until the lobby
      deploy = 0;
    }
    r.deploy = deploy;

    const aspect = size.width / Math.max(1, size.height);
    r.aspect += (aspect - r.aspect) * damp(5, dt);
    const tv = Math.tan(THREE.MathUtils.degToRad(responsiveFov(r.aspect)) / 2);

    /* the hatch: locked to the eye, fades in shut, slides open, then the doorway passes the eye */
    const h = hatchRef.current;
    if (h) {
      h.visible = hatchIn >= 0;
      if (h.visible) {
        h.position.copy(camera.position);
        // the hatch is fixed in the ship: it swings into view as the turn comes round
        h.quaternion.copy(camera.quaternion).multiply(_qYaw.invert());
        const through = THREE.MathUtils.smoothstep(walkK, 0.4, 1);
        const outH = 1 + 2.2 * through * through;
        h.scale.set(tv * r.aspect * outH, tv * outH, 1);
        const slide = slideK * SLAB_TRAVEL;
        // the latches pop a hair inward before the slabs run
        const pop = Math.sin(Math.PI * clamp01(open / SLIDE_SHARE / 0.14)) * 0.006;
        slabL.current?.position.set(-SLAB_W / 2 - slide + pop, SLAB_Y, DOOR_Z);
        slabR.current?.position.set(SLAB_W / 2 + slide - pop, SLAB_Y, DOOR_Z);
        hatch.setOpacity(hatchIn);
        if (lamp.current) lamp.current.color.set(open > 0 ? '#5dffa0' : '#ffae3d').multiplyScalar(1.6);
      }
    }

    const bm = blinkRef.current;
    if (bm) {
      bm.visible = blink > 0.001;
      if (bm.visible) {
        bm.position.copy(camera.position).add(_fwd3.set(0, 0, -0.1).applyQuaternion(camera.quaternion));
        bm.quaternion.copy(camera.quaternion);
        blinkMat.opacity = blink;
      }
    }

    const ship = shipRef.current;
    const frame = frameRef.current;
    if (!ship || !frame) return;
    ship.visible = deploy > 0.001;
    ship.position.copy(camera.position);
    ship.quaternion.copy(r.ship).multiply(_qShip);
    if (mode === 'overworld' && !reduced) {
      // a slow drift of the deck around the eye keeps it from reading as a flat overlay
      ship.position.x += Math.sin(t * 0.31) * 0.0025;
      ship.position.y += Math.sin(t * 0.43 + 1) * 0.002;
      _e.set(Math.sin(t * 0.27) * 0.0035, Math.sin(t * 0.21 + 2) * 0.0045, Math.sin(t * 0.17) * 0.002, 'YXZ');
      ship.quaternion.multiply(_q.setFromEuler(_e));
    }

    // fit the frame to the resting lens; clearing pushes it out past the edges
    const out = 1 + 1.25 * (1 - easeInOutCubic(deploy));
    frame.scale.set(tv * r.aspect * out, tv * out, 1);

    /* instruments, lights and the canopy */
    const g = glow.current;
    if (g) {
      const burn = THREE.MathUtils.smoothstep(flight.speed, 20, 120);
      g.intensity = 0.18 + burn * 0.25 + flight.heat * 1.6;
      g.color.set('#ffd2a8').lerp(_c.set(flight.heatColor), flight.heat * 0.6);
    }
    glass.uniforms.uTime.value = t;
    glass.uniforms.uHeat.value = flight.heat;
    (glass.uniforms.uHeatColor.value as THREE.Color).set(flight.heatColor);
    screenL.uniforms.uTime.value = t;
    screenR.uniforms.uTime.value = t;

    /* the dash displays are controls in orbit: publish their screen rects for the DOM labels */
    const asControls = mode === 'overworld' && deploy > 0.999;
    ship.updateMatrixWorld();
    (['tour', 'contact'] as const).forEach((key, i) => {
      const d = dashScreens[key];
      const mesh = displays.current[i];
      const mat = i === 0 ? screenL : screenR;
      // in orbit the display turns into a plain key face; the graphics come back in flight
      mat.uniforms.uFace.value += ((asControls ? 1 : 0) - mat.uniforms.uFace.value) * damp(8, dt);
      mat.uniforms.uHover.value += ((asControls && d.hover ? 1 : 0) - mat.uniforms.uHover.value) * damp(14, dt);
      d.visible = asControls && !!mesh;
      if (!d.visible || !mesh) return;
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const [cx, cy] of DISPLAY_CORNERS) {
        _corner.set(cx, cy, 0);
        mesh.localToWorld(_corner).project(camera);
        const px = ((_corner.x + 1) / 2) * size.width;
        const py = ((1 - _corner.y) / 2) * size.height;
        x0 = Math.min(x0, px);
        x1 = Math.max(x1, px);
        y0 = Math.min(y0, py);
        y1 = Math.max(y1, py);
      }
      d.x = x0;
      d.y = y0;
      d.w = x1 - x0;
      d.h = y1 - y0;
    });
    const l = leds.current;
    if (l) {
      for (let i = 0; i < LED_COUNT; i += 1) {
        const on = Math.sin(t * (1.3 + (i % 5) * 0.7) + i * 2.4) > 0.2 || i % 6 === 0;
        _c.set(i % 7 === 3 ? '#ffb46a' : '#7fd4ff').multiplyScalar(on ? 1.4 : 0.12);
        l.setColorAt(i, _c);
      }
      if (l.instanceColor) l.instanceColor.needsUpdate = true;
    }
  }, 0.5);

  const D = FRAME_DEPTH;
  // dashboard surface: back edge just under the window, front edge below the screen
  const dashY = -0.407;
  const dashZ = -0.44;

  return (
    <>
    <SpeedLines />
    <mesh ref={blinkRef} material={blinkMat} visible={false} raycast={noRaycast} renderOrder={999} frustumCulled={false}>
      <planeGeometry args={[4, 4]} />
    </mesh>
    <group ref={hatchRef} visible={false}>
      <pointLight position={[0, 0.22, -0.25]} intensity={0.7} distance={1.2} decay={2} color="#c9d8ff" />
      <mesh geometry={hatch.jamb} material={hatch.jambMat} raycast={noRaycast} renderOrder={34} />
      <mesh ref={slabL} geometry={hatch.slab} material={hatch.slabMatL} raycast={noRaycast} renderOrder={33} />
      <mesh ref={slabR} geometry={hatch.slab} material={hatch.slabMatR} raycast={noRaycast} renderOrder={33} />
      {/* status lamp over the doorway: amber while sealed, green once the latches release */}
      <mesh position={[0, 0.8 * -JAMB_Z + 0.03, JAMB_Z + 0.022]} raycast={noRaycast} renderOrder={35}>
        <boxGeometry args={[0.05, 0.008, 0.006]} />
        <meshBasicMaterial ref={lamp} color="#ffae3d" toneMapped={false} fog={false} transparent />
      </mesh>
    </group>
    <group ref={shipRef} renderOrder={30}>
      {/* cabin light: only reaches the frame, the planets are far outside its range */}
      <pointLight position={[0, -0.12, -0.18]} intensity={0.55} distance={1.4} decay={2} color="#a9c2ff" />
      {/* warm fill that picks up the burn and the glow of entry */}
      <pointLight ref={glow} position={[0, 0.3, -0.35]} intensity={0.18} distance={1.0} decay={2} color="#ffd2a8" />
      <group ref={frameRef}>
        <mesh geometry={parts.bulkhead} material={parts.plate} raycast={noRaycast} renderOrder={30} />
        <mesh geometry={parts.ring} material={parts.trim} raycast={noRaycast} renderOrder={30} />
        <mesh geometry={parts.lightStrip} material={parts.strip} raycast={noRaycast} renderOrder={31} />
        <instancedMesh
          ref={rivets}
          args={[parts.rivetGeo, parts.trim, parts.rivetPts.length]}
          raycast={noRaycast}
          renderOrder={31}
        />
        {/* canopy glass: reflections, dust, and the plasma of atmospheric entry */}
        <mesh material={glass} position={[0, 0.03, -D - 0.03]} raycast={noRaycast} renderOrder={29}>
          <planeGeometry args={[1.3, 1.1]} />
        </mesh>
        {/* dashboard */}
        <mesh
          geometry={parts.dash}
          material={parts.dark}
          position={[0, dashY, dashZ]}
          rotation={[parts.dashTilt, 0, 0]}
          raycast={noRaycast}
          renderOrder={30}
        />
        {/* a lit lip along the dashboard's back edge */}
        <mesh position={[0, -0.436, -0.6]} material={parts.strip} raycast={noRaycast} renderOrder={31}>
          <boxGeometry args={[0.5, 0.0022, 0.003]} />
        </mesh>
        <instancedMesh ref={leds} args={[LED_GEO, LED_MAT, LED_COUNT]} raycast={noRaycast} renderOrder={31} />
        {/* two instrument displays standing on the dash, tilted toward the pilot */}
        {[
          { x: -0.3, m: screenL },
          { x: 0.3, m: screenR },
        ].map(({ x, m }, i) => (
          <group key={x} position={[x * 0.97, -0.372, -0.49]} rotation={[-0.32, -Math.sign(x) * 0.16, 0]}>
            <mesh material={parts.trim} raycast={noRaycast} renderOrder={30}>
              <boxGeometry args={[0.13, 0.07, 0.008]} />
            </mesh>
            <mesh
              ref={(el) => {
                displays.current[i] = el;
              }}
              material={m}
              position={[0, 0, 0.0045]}
              raycast={noRaycast}
              renderOrder={31}
            >
              <planeGeometry args={[0.12, 0.06]} />
            </mesh>
          </group>
        ))}
      </group>
    </group>
    </>
  );
};

/* ---------- status lights along the dash ---------- */

const LED_COUNT = 18;
const LED_GEO = new THREE.BoxGeometry(0.009, 0.0035, 0.004);
const LED_MAT = new THREE.MeshBasicMaterial({ color: '#ffffff', fog: false, transparent: true, toneMapped: false });
const _c = new THREE.Color();

/** Places the status lights in a row on the dash, behind the HUD chips. */
export const placeLeds = (m: THREE.InstancedMesh) => {
  const o = new THREE.Object3D();
  for (let i = 0; i < LED_COUNT; i += 1) {
    const x = -0.17 + (i / (LED_COUNT - 1)) * 0.34 + (i >= LED_COUNT / 2 ? 0.02 : -0.02);
    o.position.set(x, -0.4295, -0.585);
    o.rotation.set(0.26, 0, 0);
    o.updateMatrix();
    m.setMatrixAt(i, o.matrix);
  }
  m.instanceMatrix.needsUpdate = true;
};

export default Cockpit;
