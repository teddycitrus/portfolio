import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { useAppStore, type SceneMode } from '@/state/useAppStore';
import { dashPanel, flight, warpFx } from '@/state/runtime';
import { profile } from '@/data/content';
import { ARRIVAL_MS, BEAM_DOWN_MS, PULL_AT } from '@/state/timing';
import { responsiveFov } from '@/scenes/overworld/TelescopeCamera';
import { shipSound } from '@/audio/drone';
import { FLOOR_Y, GLASS_H, GLASS_Z, PANE_X } from './shape';
import SpeedLines from './SpeedLines';
import ShipDetails from './ShipDetails';
import { glassMaterial, instrumentMaterial } from './materials';
import { cabinEnv } from './cabinEnv';

/*
 * The ship around the viewer. In orbit it is the beam deck: tall glass panes
 * with hairline seams between them, a floor, and the contact console standing
 * on a pedestal in front of the glass. Picking a planet charges the emitters and fires the
 * tractor beam out through the aperture to it; the viewer is pulled along the
 * beam, the deck falling away, into its light (the transition controller,
 * LaunchBeam and the veil). After the cut the rig lowers the viewer down the
 * beam from the mothership, looking up at it, onto the ground; the deck is not
 * seen again until the lobby.
 *
 * Geometry lives in "frame units": the frame group is scaled by the resting
 * lens, so x / depth and y / depth map straight to screen space (1 = screen
 * edge) at rest.
 */

/* ---------- down the beam ---------- */

/** Roll unwinding about the beam on the way down, radians at the start */
const BEAM_ROLL = 0.35;
/** The viewer floats this far above the ground at the foot of the beam, then settles */
const BEAM_FLOAT = 0.5;
/** Arrival clock value meaning "long since landed" */
const ARRIVAL_DONE = 1e9;

const noRaycast = () => null;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
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
  /** The deck's pose relative to the eye when a dive leaves orbit, kept through the turn */
  rel: THREE.Quaternion;
  deploy: number;
  aspect: number;
}

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _q = new THREE.Quaternion();
const _qShip = new THREE.Quaternion();
const _qHead = new THREE.Quaternion();
const _toShip = new THREE.Vector3();
const _shipPos = new THREE.Vector3();
const _qLook = new THREE.Quaternion();
const _m4 = new THREE.Matrix4();
const _yUp = new THREE.Vector3(0, 1, 0);
const _zAxis = new THREE.Vector3(0, 0, 1);
const _target = new THREE.Quaternion();
const ID = new THREE.Quaternion();
const _corner = new THREE.Vector3();
/** The console's face: it spans the wall under the window, one key per contact link */
const CONSOLE_W = 0.72;
const CONSOLE_H = 0.06;
const CONSOLE_KEYS = profile.links.length;
/** The key faces sweeping in across the console, and the instrument coming back */
const FACE_IN_S = 1.6;
const FACE_OUT_S = 0.5;
const CONSOLE_CORNERS = [
  [-CONSOLE_W / 2, -CONSOLE_H / 2],
  [CONSOLE_W / 2, -CONSOLE_H / 2],
  [CONSOLE_W / 2, CONSOLE_H / 2],
  [-CONSOLE_W / 2, CONSOLE_H / 2],
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
  // wear: edges rubbed bright along the seams, fine scratches, grime settling under the rivets
  for (let i = 0; i < 90; i += 1) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const a = Math.random() * Math.PI;
    const l = 8 + Math.random() * 46;
    g.strokeStyle = `rgba(255,255,255,${0.05 + Math.random() * 0.09})`;
    g.lineWidth = 0.6;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  for (const y of [2, 172, 342])
    for (let x = 0; x < 512; x += 18 + Math.random() * 40) {
      const w = 6 + Math.random() * 26;
      g.fillStyle = `rgba(255,255,255,${0.05 + Math.random() * 0.1})`;
      g.fillRect(x, y + 3.5, w, 1);
      g.fillStyle = `rgba(8,10,14,${0.1 + Math.random() * 0.14})`;
      g.fillRect(x + w * 0.2, y + 6, w * 0.7, 5 + Math.random() * 10);
    }
  // screws at the corners of an access plate, and a stencilled block with its rule
  g.strokeStyle = 'rgba(10,12,18,0.55)';
  g.lineWidth = 1.5;
  g.strokeRect(392, 226, 88, 62);
  for (const [x, y] of [[398, 232], [474, 232], [398, 282], [474, 282]] as const) {
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.beginPath();
    g.arc(x, y, 3, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.28)';
    g.fillRect(x - 2.2, y - 0.5, 4.4, 1);
  }
  for (let i = 0; i < 7; i += 1) {
    g.fillStyle = `rgba(245,240,225,${i % 3 === 2 ? 0.08 : 0.16})`;
    g.fillRect(84 + i * 9, 402, 6, 12);
  }
  g.fillStyle = 'rgba(245,240,225,0.12)';
  g.fillRect(84, 418, 60, 1.5);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
};

/** The glass in plan (x, z), round the viewer from the back left to the back right */
const BAY: [number, number][] = [
  [-1.4, 1.6],
  [-1.7, 0.36],
  [-PANE_X, GLASS_Z],
  [PANE_X, GLASS_Z],
  [1.7, 0.36],
  [1.4, 1.6],
];
const GLASS_MID = FLOOR_Y + GLASS_H / 2;

const sideLen = (i: number) => Math.hypot(BAY[i + 1][0] - BAY[i][0], BAY[i + 1][1] - BAY[i][1]);
/** Lays a part built along +x, facing +z, on side i of the bay at height y, `inset` into the room. */
const alongSide = (g: THREE.BufferGeometry, i: number, y: number, inset = 0) => {
  const [ax, az] = BAY[i];
  const [bx, bz] = BAY[i + 1];
  const rot = Math.atan2(-(bz - az), bx - ax);
  g.rotateY(rot);
  g.translate((ax + bx) / 2 + Math.sin(rot) * inset, y, (az + bz) / 2 + Math.cos(rot) * inset);
  return g;
};
const sides = (make: (i: number) => THREE.BufferGeometry) => mergeGeometries(BAY.slice(1).map((_, i) => make(i)), false)!;

const useCockpitParts = (env: THREE.Texture) =>
  useMemo(() => {
    const tex = panelTexture();
    tex.repeat.set(1.6, 1.6);
    const plate = plateMaterial(tex);
    plate.envMap = env;
    plate.envMapIntensity = 1.4;
    const trimTex = tex.clone();
    trimTex.repeat.set(5, 5);
    const trim = new THREE.MeshStandardMaterial({
      color: '#5d6573',
      map: trimTex,
      metalness: 0.8,
      roughness: 0.32,
      envMap: env,
      envMapIntensity: 1.6,
      fog: false,
      transparent: true,
    });
    const strip = new THREE.MeshBasicMaterial({ color: new THREE.Color('#9fc4ff').multiplyScalar(0.75), fog: false, transparent: true });

    // the floor fills the glass's outline; its uvs are frame units
    const floorTex = tex.clone();
    floorTex.repeat.set(1.4, 1.4);
    const floorMat = plateMaterial(floorTex);
    floorMat.envMap = env;
    floorMat.envMapIntensity = 1.4;
    const floor = new THREE.ShapeGeometry(new THREE.Shape(BAY.map(([x, z]) => new THREE.Vector2(x, -z))))
      .rotateX(-Math.PI / 2)
      .translate(0, FLOOR_Y, 0);
    const panes = sides((i) => alongSide(new THREE.PlaneGeometry(sideLen(i), GLASS_H), i, GLASS_MID, 0.002));
    // hairline seams where the panes meet
    const seams = mergeGeometries(
      BAY.slice(1, -1).map(([x, z]) => new THREE.BoxGeometry(0.003, GLASS_H, 0.003).translate(x, GLASS_MID, z)),
      false,
    )!;
    // a running light along the foot of the glass
    const lights = sides((i) => alongSide(new THREE.BoxGeometry(sideLen(i), 0.0018, 0.003), i, FLOOR_Y + 0.001, 0.004));

    return { plate, trim, strip, floor, panes, seams, lights, floorMat, tex, trimTex, floorTex };
  }, [env]);

/* ---------- the rig: camera offsets, ship pose, sounds ---------- */

const Cockpit = () => {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const gl = useThree((s) => s.gl);
  const env = useMemo(() => cabinEnv(gl), [gl]);
  const parts = useCockpitParts(env);
  const shipRef = useRef<THREE.Group>(null);
  const frameRef = useRef<THREE.Group>(null);
  const glow = useRef<THREE.PointLight>(null);
  const glass = useMemo(() => glassMaterial(), []);
  const consoleRef = useRef<THREE.Mesh>(null);
  const screen = useMemo(() => instrumentMaterial(0, CONSOLE_KEYS, CONSOLE_W / CONSOLE_H / 2), []);
  const logos = useRef<{ canvas: HTMLCanvasElement | null; tex: THREE.CanvasTexture | null }>({ canvas: null, tex: null });
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
    rel: new THREE.Quaternion(),
    deploy: useAppStore.getState().mode === 'planet' ? 0 : 1,
    aspect: size.width / Math.max(1, size.height),
  });

  useEffect(
    () => () => {
      for (const m of [parts.plate, parts.trim, parts.strip, parts.floorMat, glass, screen]) m.dispose();
      for (const g of [parts.floor, parts.panes, parts.seams, parts.lights]) g.dispose();
      parts.tex.dispose();
      parts.trimTex.dispose();
      parts.floorTex.dispose();
      logos.current.tex?.dispose();
    },
    [parts, glass, screen],
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
          // in orbit the deck is fixed and the eye looks about inside it: keep that offset, so
          // the ship turning onto the planet carries the deck with the eye instead of snapping it
          if (p.mode === 'overworld') r.rel.copy(r.baseQuat).invert().multiply(r.ship);
          else r.rel.identity();
          if (!r.chained && !s.reducedMotion) shipSound('beam');
        } else if (s.mode === 'planet') {
          r.arriveAt = -1;
          r.arriveTick = false;
          r.arrivePending = true;
          flight.arrivalMs = -1;
        } else if (s.mode === 'transitioning-out') {
          r.launchAt = now;
          if (!s.reducedMotion) shipSound('beam');
        } else if (s.mode === 'overworld') {
          flight.heat = 0;
        }
      }),
    [],
  );

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
      if (!reduced) shipSound('lower', BEAM_DOWN_MS / 1000);
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

    let shake = 0;
    if (mode === 'planet' && r.arriveAt >= 0) {
      // the first frame starts the clock at 0; a stalled frame counts as one frame
      if (r.arriveTick) r.arriveAt += Math.min(delta, 0.1) * 1000;
      r.arriveTick = true;
      flight.arrivalMs = reduced ? ARRIVAL_DONE : r.arriveAt;
    }
    if (mode === 'transitioning-in' && !reduced && !r.chained) {
      // the drive's hum as the ship comes round, then the rumble of the plunge growing with speed
      shake = 0.0015 * clamp01((now - r.diveAt) / 600) + 0.003 * THREE.MathUtils.smoothstep(flight.speed, 20, 110);
    } else if (mode === 'transitioning-out' && !reduced) {
      // the beam's hum in the bones
      shake = 0.0025 * clamp01((now - r.launchAt) / 600);
    } else if (mode === 'overworld') {
      // hyperspace, and the drop out of it
      shake = warpFx.shake;
    }

    _fwd.set(0, 0, -1).applyQuaternion(r.baseQuat);
    _fwd.y = 0;
    if (_fwd.lengthSq() < 1e-6) _fwd.set(0, 0, -1);
    _fwd.normalize();
    _right.set(-_fwd.z, 0, _fwd.x);

    /* down the beam: the exit's pull run backwards, slowing all the way to the feet touching */
    if (mode === 'planet' && r.arriveAt >= 0 && !reduced && r.arriveAt < ARRIVAL_MS + 50) {
      const ms = r.arriveAt;
      const m = flight.mother;
      _shipPos.set(m.x, m.y, m.z);
      _toShip.copy(_shipPos).sub(r.basePos).normalize();
      const sLeft = Math.max(0, BEAM_DOWN_MS - ms) / 1000;
      const pull = 0.8 * sLeft + 7 * sLeft * sLeft + 20 * sLeft * sLeft * sLeft;
      camera.position.addScaledVector(_toShip, pull);
      camera.position.y += BEAM_FLOAT * (1 - THREE.MathUtils.smoothstep(ms, BEAM_DOWN_MS - 350, BEAM_DOWN_MS + 300));
      // looking up at the ship being left behind, then down to the ground ahead as the feet touch
      _m4.lookAt(camera.position, _shipPos, _yUp);
      _qLook.setFromRotationMatrix(_m4).multiply(_q.setFromAxisAngle(_zAxis, BEAM_ROLL * sLeft * sLeft));
      const k = easeInOutCubic(clamp01((ms - (BEAM_DOWN_MS - 650)) / 950));
      _qLook.slerp(camera.quaternion, k);
      camera.quaternion.copy(_qLook);
      flight.beam = 1 - THREE.MathUtils.smoothstep(ms, BEAM_DOWN_MS + 100, BEAM_DOWN_MS + 700);
      shake = 0.0025 * (1 - k);
    }

    // the ship's orientation before shake: fixed in orbit, swinging after the camera otherwise
    if (mode === 'overworld' || reduced) r.ship.copy(mode === 'overworld' ? ID : camera.quaternion);
    // turning onto a planet the deck keeps its place around the eye, with just enough lag to feel
    // the ship's weight
    else if (mode === 'transitioning-in') r.ship.slerp(_q.copy(camera.quaternion).multiply(r.rel), damp(22, dt));
    else r.ship.slerp(camera.quaternion, damp(16, dt));

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
    // beamed down or up, there is no deck around the viewer; launching, the beam pulls the viewer
    // out through the aperture and the deck falls away past the edges of the view
    const deploy =
      mode === 'planet' || mode === 'transitioning-out'
        ? 0
        : mode === 'transitioning-in' && !r.chained && !reduced
          ? 1 - THREE.MathUtils.smoothstep(now - r.diveAt, PULL_AT - 60, PULL_AT + 420)
          : 1;
    r.deploy = deploy;

    const aspect = size.width / Math.max(1, size.height);
    r.aspect += (aspect - r.aspect) * damp(5, dt);
    // a lens widened for hyperspace widens the view outside, not the deck: the frame keeps its size on screen
    const tv = Math.tan(THREE.MathUtils.degToRad(responsiveFov(r.aspect) + warpFx.lens) / 2);

    const ship = shipRef.current;
    const frame = frameRef.current;
    if (!ship || !frame) return;
    ship.visible = deploy > 0.001;
    if (!ship.visible) {
      // on a planet the deck is gone: nothing below is seen, so none of it is worked out or uploaded
      dashPanel.visible = false;
      return;
    }
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
      g.color.copy(GLOW_C).lerp(heatColor(), flight.heat * 0.6);
    }
    glass.uniforms.uTime.value = t;
    glass.uniforms.uHeat.value = flight.heat;
    (glass.uniforms.uHeatColor.value as THREE.Color).copy(heatColor());
    screen.uniforms.uTime.value = t;

    /* the console is the contact keys in orbit: publish its screen rect for the DOM keys */
    // in hyperspace it is still an instrument; the key faces come up with the HUD
    const asControls = mode === 'overworld' && deploy > 0.999 && !store.intro;
    ship.updateMatrixWorld();
    {
      const d = dashPanel;
      const mesh = consoleRef.current;
      // in orbit the console turns into a row of key faces, swept in left to right after the
      // arrival; the graphics come back quicker in flight
      const face = screen.uniforms.uFace;
      face.value = asControls ? Math.min(1, face.value + dt / FACE_IN_S) : Math.max(0, face.value - dt / FACE_OUT_S);
      screen.uniforms.uHot.value = asControls ? d.hot : -1;
      // the logos are drawn by the DOM once its icons are up: paint them on the face
      if (d.logos && d.logos !== logos.current.canvas) {
        logos.current.tex?.dispose();
        const tex = new THREE.CanvasTexture(d.logos);
        tex.anisotropy = 8;
        logos.current = { canvas: d.logos, tex };
        screen.uniforms.uLogos.value = tex;
        screen.uniforms.uLogoOn.value = 1;
      }
      d.visible = asControls && !!mesh;
      if (d.visible && mesh) {
        CONSOLE_CORNERS.forEach(([cx, cy], k) => {
          _corner.set(cx, cy, 0);
          mesh.localToWorld(_corner).project(camera);
          d.quad[k * 2] = ((_corner.x + 1) / 2) * size.width;
          d.quad[k * 2 + 1] = ((1 - _corner.y) / 2) * size.height;
        });
      }
    }
    parts.strip.color.copy(STRIP_C).lerp(STRIP_HOT, Math.min(1, flight.launch)).multiplyScalar(1 + flight.launch * 1.6);
  }, 0.5);


  return (
    <>
    <SpeedLines />
    <group ref={shipRef} renderOrder={30}>
      {/* cabin light: only reaches the frame, the planets are far outside its range */}
      <pointLight position={[0, -0.12, -0.18]} intensity={0.55} distance={1.4} decay={2} color="#a9c2ff" />
      {/* warm fill that picks up the burn and the glow of entry */}
      <pointLight ref={glow} position={[0, 0.3, -0.35]} intensity={0.18} distance={1.0} decay={2} color="#ffd2a8" />
      <group ref={frameRef}>
        <mesh geometry={parts.floor} material={parts.floorMat} raycast={noRaycast} renderOrder={30} />
        <mesh geometry={parts.seams} material={SEAM_MAT} raycast={noRaycast} renderOrder={30} />
        {/* the running light along the glass charges for the beam */}
        <mesh geometry={parts.lights} material={parts.strip} raycast={noRaycast} renderOrder={31} />
        {/* the glass: reflections, dust, and the plasma of atmospheric entry */}
        <mesh geometry={parts.panes} material={glass} raycast={noRaycast} renderOrder={29} />
        <ShipDetails />
        {/* the console: one long display along the bottom of the view, tilted toward the pilot */}
        <group position={[0, -0.46, -0.49]} rotation={[-0.32, 0, 0]}>
          <mesh material={parts.trim} raycast={noRaycast} renderOrder={30}>
            <boxGeometry args={[CONSOLE_W + 0.01, CONSOLE_H + 0.01, 0.008]} />
          </mesh>
          <mesh ref={consoleRef} material={screen} position={[0, 0, 0.0045]} raycast={noRaycast} renderOrder={31}>
            <planeGeometry args={[CONSOLE_W, CONSOLE_H]} />
          </mesh>
        </group>
      </group>
    </group>
    </>
  );
};

/* ---------- colours ---------- */

/** The seams between the panes: a faint cold line, as glass edges catch the light */
const SEAM_MAT = new THREE.MeshBasicMaterial({ color: new THREE.Color('#8fa6c8').multiplyScalar(0.35), fog: false, transparent: true });
/** The running light at rest; picking a planet charges it for the beam */
const STRIP_C = new THREE.Color('#9fc4ff').multiplyScalar(0.75);
const STRIP_HOT = new THREE.Color('#d4ecff');
/** Colours the frame loop uses, parsed once (Color.set on a hex string parses and converts every call) */
const GLOW_C = new THREE.Color('#ffd2a8');
const _heat = new THREE.Color('#ffb070');
let heatHex = '#ffb070';
/** flight.heatColor as a Color, re-parsed only when the hex changes */
const heatColor = () => {
  if (flight.heatColor !== heatHex) {
    heatHex = flight.heatColor;
    _heat.set(heatHex);
  }
  return _heat;
};

export default Cockpit;
