import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useAppStore } from '@/state/useAppStore';
import { getOrbitalPosition, planets } from '@/data/content';
import type { Vec3 } from '@/types/content';
import { onBootReveal } from '@/ui/boot';
import { flight } from '@/state/runtime';
import ShipHull, { useHullParts } from '@/scenes/ship/ShipHull';
import { responsiveFov } from './TelescopeCamera';

/*
 * The opening shot, played once the loader fades. The ship drops out of warp
 * toward the camera and brakes hard, the camera whips round it until the
 * planets sit behind it, then dives into the bridge, landing on the lobby
 * view from the observation deck. The hull is placed so the deck's eye is at
 * the origin, where the lobby camera lives, so the dive ends exactly there.
 */

const WARP_MS = 1000;
const ORBIT_MS = 1500;
const ZOOM_MS = 750;
const TOTAL = WARP_MS + ORBIT_MS + ZOOM_MS;
/** The dark the dive ends in starts at this share of the zoom */
const FLASH_FROM = 0.78;

const SCALE = 1.5;
/** The observation deck's eye in hull units, near the prow under the bridge */
const EYE_LOCAL = new THREE.Vector3(-30, 1.5, 0);
/** Prow (local -x) toward -z, where the planets are */
const YAW = -Math.PI / 2;
const Y = new THREE.Vector3(0, 1, 0);
/** Hull centre in the world, chosen so the eye lands on the origin */
const CENTER = EYE_LOCAL.clone().multiplyScalar(SCALE).applyAxisAngle(Y, YAW).negate();
/** The warp exit starts this far behind the stop point */
const WARP_FROM = 900;
/** Camera offsets from the hull centre: ahead and to the side for the arrival, behind and above to finish */
const CAM_ARRIVE = new THREE.Vector3(55, 14, -120);
const CAM_BEHIND = new THREE.Vector3(28, 20, 125);
/** The shot's lens is a touch wider than the deck's, which already widens on portrait screens */
const INTRO_FOV_GAIN = 5;
/** The dive passes over the spine just behind the bridge before dropping onto the deck */
const DIVE_VIA = new THREE.Vector3(0, 14, 45);
const STREAKS = 220;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeIn = (t: number) => t * t * t;
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

const _orb: Vec3 = [0, 0, 0];
const _look = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _m = new THREE.Matrix4();
const ID = new THREE.Quaternion();
const noRaycast = () => null;

/** A soft round glow for the warp exit flash */
const glowTexture = () => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.2, 'rgba(200,225,255,0.8)');
  grad.addColorStop(0.55, 'rgba(120,170,255,0.18)');
  grad.addColorStop(1, 'rgba(120,170,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
};

const Intro = () => {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const hull = useHullParts();
  // no planet sky to fill the shadow side out here: a cool glow keeps the hull readable
  useEffect(() => {
    hull.hull.emissive.set('#26303f');
    hull.dark.emissive.set('#141a24');
  }, [hull]);
  const outer = useRef<THREE.Group>(null);
  const inner = useRef<THREE.Group>(null);
  const flare = useRef<THREE.Sprite>(null);
  const lines = useRef<THREE.LineSegments>(null);
  const st = useRef({ start: -1, done: !useAppStore.getState().intro, endQuat: new THREE.Quaternion(), endPos: new THREE.Vector3() });

  const streaks = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(STREAKS * 6);
    const seeds = new Float32Array(STREAKS * 3);
    for (let i = 0; i < STREAKS; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const r = 10 + Math.pow(Math.random(), 0.6) * 70;
      seeds[i * 3] = Math.cos(a) * r;
      seeds[i * 3 + 1] = Math.sin(a) * r * 0.7;
      seeds[i * 3 + 2] = Math.random();
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.LineBasicMaterial({
      color: '#cfe2ff',
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    return { g, mat, pos, seeds };
  }, []);
  const flareMat = useMemo(
    () =>
      new THREE.SpriteMaterial({
        map: glowTexture(),
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    [],
  );
  useEffect(
    () => () => {
      streaks.g.dispose();
      streaks.mat.dispose();
      flareMat.map?.dispose();
      flareMat.dispose();
    },
    [streaks, flareMat],
  );

  // the shot starts the moment the loader begins to fade
  useEffect(() => {
    if (st.current.done) return;
    onBootReveal(() => {
      if (st.current.start < 0) st.current.start = performance.now();
    });
  }, []);

  const flash = () => document.getElementById('intro-flash');

  // after the camera controllers and before the cockpit rig
  useFrame(({ clock }) => {
    const s = st.current;
    const g = outer.current;
    const hs = inner.current;
    if (!g || !hs) return;
    if (s.done) {
      g.visible = false;
      if (lines.current) lines.current.visible = false;
      if (flare.current) flare.current.visible = false;
      return;
    }
    const ms = s.start < 0 ? 0 : performance.now() - s.start;
    const aspect = size.width / Math.max(1, size.height);
    // portrait screens are narrow: stand further off so the whole hull stays in frame
    const reach = Math.max(1, 0.55 / aspect);

    /* the ship: out of warp toward the camera, braking hard, stretched along its length until it stops */
    const u = s.start < 0 ? 0 : clamp01(ms / WARP_MS);
    const left = 1 - u;
    g.visible = s.start >= 0;
    g.position.copy(CENTER).z += WARP_FROM * Math.pow(left, 5);
    g.position.y += Math.sin(clock.elapsedTime * 0.8) * 0.4 * u;
    hs.scale.set(SCALE * (1 + 10 * left * left * left), SCALE, SCALE);

    // the bright burst as it drops out, at the prow
    const f = Math.exp(-Math.pow((u - 0.88) / 0.08, 2)) * (s.start < 0 ? 0 : 1);
    const fl = flare.current;
    if (fl) {
      fl.visible = f > 0.01;
      fl.position.copy(g.position).z -= 55;
      fl.scale.setScalar(30 + 140 * f);
      flareMat.opacity = f;
    }

    // warp streaks running with it, fading as it brakes
    const k = s.start < 0 ? 0 : left * left;
    const ln = lines.current;
    if (ln) {
      ln.visible = k > 0.01;
      if (ln.visible) {
        const { pos, seeds } = streaks;
        const len = 40 + 260 * k;
        for (let i = 0; i < STREAKS; i += 1) {
          const z = CENTER.z + (((seeds[i * 3 + 2] - ms * 0.0011) % 1) + 1) % 1 * 1200 - 300;
          const x = CENTER.x + seeds[i * 3];
          const y = CENTER.y + seeds[i * 3 + 1];
          pos.set([x, y, z, x, y, z + len], i * 6);
        }
        streaks.g.attributes.position.needsUpdate = true;
        streaks.mat.opacity = 0.75 * k;
      }
    }

    /* the camera */
    let fov = responsiveFov(aspect) + INTRO_FOV_GAIN;
    if (ms < WARP_MS) {
      _pos.copy(CENTER).addScaledVector(CAM_ARRIVE, reach);
      _look.copy(CENTER);
      // the drop out of warp shakes the shot
      _pos.x += Math.sin(ms * 0.09) * 0.6 * f;
      _pos.y += Math.sin(ms * 0.13 + 1) * 0.6 * f;
      camera.position.copy(_pos);
      _m.lookAt(camera.position, _look, Y);
      camera.quaternion.setFromRotationMatrix(_m);
    } else if (ms < WARP_MS + ORBIT_MS) {
      // round the ship until it sits in front of the planets
      const e = easeInOut((ms - WARP_MS) / ORBIT_MS);
      const a0 = Math.atan2(CAM_ARRIVE.x, CAM_ARRIVE.z);
      const a1 = Math.atan2(CAM_BEHIND.x, CAM_BEHIND.z);
      const r0 = Math.hypot(CAM_ARRIVE.x, CAM_ARRIVE.z) * reach;
      const r1 = Math.hypot(CAM_BEHIND.x, CAM_BEHIND.z) * reach;
      const a = a0 + (a1 - a0) * e;
      const r = r0 + (r1 - r0) * e;
      camera.position.set(CENTER.x + Math.sin(a) * r, CENTER.y + THREE.MathUtils.lerp(CAM_ARRIVE.y, CAM_BEHIND.y, e) * reach, CENTER.z + Math.cos(a) * r);
      // the look swings from the hull to the planets beyond it
      _look.set(0, 0, 0);
      for (const p of planets) {
        getOrbitalPosition(p, clock.elapsedTime, _orb);
        _look.x += _orb[0] / planets.length;
        _look.y += _orb[1] / planets.length;
        _look.z += _orb[2] / planets.length;
      }
      _look.lerp(CENTER, 1 - 0.55 * smooth(0.2, 1, e));
      _m.lookAt(camera.position, _look, Y);
      camera.quaternion.setFromRotationMatrix(_m);
      s.endPos.copy(camera.position);
      s.endQuat.copy(camera.quaternion);
    } else {
      // and straight in through the bridge, onto the deck
      const z = clamp01((ms - WARP_MS - ORBIT_MS) / ZOOM_MS);
      // a curve over the hull and down into the bridge, picking up speed
      const e = easeIn(z);
      const a = 1 - e;
      camera.position.copy(s.endPos).multiplyScalar(a * a).addScaledVector(DIVE_VIA, 2 * a * e);
      camera.quaternion.copy(s.endQuat).slerp(ID, easeInOut(z));
      fov = responsiveFov(aspect) + INTRO_FOV_GAIN * (1 - easeInOut(z));
      const el = flash();
      if (el) {
        el.style.transition = 'none';
        el.style.opacity = String(smooth(FLASH_FROM, 1, z));
      }
    }
    if (Math.abs(camera.fov - fov) > 1e-3) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }

    if (ms >= TOTAL) {
      s.done = true;
      camera.position.set(0, 0, 0);
      camera.quaternion.copy(ID);
      // the dive was fast, but the deck is standing still: no streaks in the window
      flight.speed = 0;
      const el = flash();
      if (el) {
        el.style.transition = 'opacity 450ms cubic-bezier(0.4, 0, 0.2, 1)';
        el.style.opacity = '0';
      }
      useAppStore.getState().endIntro();
    }
  }, 0.4);

  return (
    <>
      <lineSegments ref={lines} geometry={streaks.g} material={streaks.mat} visible={false} frustumCulled={false} raycast={noRaycast} />
      <sprite ref={flare} material={flareMat} visible={false} raycast={noRaycast} />
      <group ref={outer} rotation={[0, YAW, 0]} visible={false}>
        <group ref={inner} scale={SCALE}>
          <ShipHull parts={hull} />
        </group>
      </group>
    </>
  );
};

export default Intro;
