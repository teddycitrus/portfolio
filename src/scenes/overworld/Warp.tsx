import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useAppStore } from '@/state/useAppStore';
import { dragLook, flight, warpFx } from '@/state/runtime';
import { endBoot, navDisplay, onBootReveal } from '@/ui/boot';
import { sfxReady, shipSound, soundWanted, warpHum } from '@/audio/drone';
import { responsiveFov } from './TelescopeCamera';

/*
 * The site opens in hyperspace, seen from the observation deck. The loader's
 * painted hyperspace hands over to this one once the scene is drawing; the nav
 * display on the glass runs on to 100%, the drive spools up, and the ship drops
 * out in a flash into the system, the lens snapping back and the deck
 * shuddering. The welcome holds on the glass for about a second, the HUD comes
 * up once it is gone. A click, tap or key in hyperspace drops out straight away.
 * Browsers keep audio locked until a gesture, so with sound on and no gesture
 * yet the ship waits at 100% for one ("Click to drop out"): that click starts
 * the roar and the drop is heard. Nobody clicking, it drops out silently after
 * HOLD_MS. The system outside is not drawn until the drop.
 */

/** Shortest run of the display to 100% once the scene is up */
const RUN_MS = 1200;
/** A cached visit is up in no time: the whole jump lasts at least this long from navigation */
const MIN_TOTAL_MS = 2600;
/** Asked to drop out: this long for the display to finish and the roar to swell in */
const SKIP_MS = 450;
/** Waiting for a click so the drop can be heard, at most this long */
const HOLD_MS = 6000;
/** The drive spooling up, ending in the flash */
const SPOOL_MS = 560;
/** The lens settling after the drop */
const SETTLE_MS = 1100;
/** The welcome on the glass, from the flash, before the display switches off */
const WELCOME_MS = 1150;
/** The HUD comes up once the display has switched off (220 ms in index.html), so the two never stack */
const HUD_AT = WELCOME_MS + 220;

/** The tunnel: a long tube ahead of the deck */
const TUBE_R = 34;
/** Inside the camera far plane (800) */
const TUBE_LEN = 720;
/**
 * The tube starts this far ahead of the eye, already wider than the view, so
 * no triangle crosses the near plane (clipped halves can leave hairline cracks)
 */
const TUBE_NEAR = 10;
const STREAKS = 420;
/** Hyperspace streams past at this many units per second */
const SPEED = 520;
/** Extra lens width in hyperspace, and more as the drive spools */
const WARP_FOV = 8;
const SPOOL_FOV = 14;
/** The lens lands this much narrower at the drop, then eases out */
const DROP_FOV = -4;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const ID = new THREE.Quaternion();
const noRaycast = () => null;

const tubeMaterial = () =>
  new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    fog: false,
    uniforms: { uTravel: { value: 0 }, uGain: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec3 vP;
      void main() {
        vP = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTravel;
      uniform float uGain;
      varying vec3 vP;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      void main() {
        float a = atan(vP.y, vP.x) / 6.2831853 + 0.5;
        float d = -vP.z;
        // long bands of light along the walls, streaming toward the deck
        float z = (d + uTravel) * 0.012;
        float n = noise(vec2(a * 40.0, z)) * 0.65 + noise(vec2(a * 97.0, z * 2.3)) * 0.35;
        float bands = pow(n, 3.0);
        vec3 deep = vec3(0.06, 0.1, 0.32);
        vec3 lit = vec3(0.55, 0.78, 1.25);
        vec3 col = mix(deep, lit, bands);
        // faint near the deck, brightest toward the far end where it all converges
        float fade = smoothstep(20.0, 160.0, d) * (0.35 + 0.65 * smoothstep(200.0, ${TUBE_LEN.toFixed(1)}, d));
        gl_FragColor = vec4(col * fade * uGain * 0.55, 1.0);
      }
    `,
  });

const streakMaterial = () =>
  new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    uniforms: { uTravel: { value: 0 }, uLen: { value: 30 }, uGain: { value: 1 } },
    vertexShader: /* glsl */ `
      uniform float uTravel;
      uniform float uLen;
      attribute vec3 aSeed;
      attribute float aEnd;
      varying float vA;
      void main() {
        float L = ${TUBE_LEN.toFixed(1)};
        float z = -L * (1.0 - fract(aSeed.z + uTravel / L));
        vec3 p = vec3(cos(aSeed.x) * aSeed.y, sin(aSeed.x) * aSeed.y, z - aEnd * uLen);
        vA = smoothstep(L, L * 0.55, -z) * (1.0 - aEnd * 0.85);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uGain;
      varying float vA;
      void main() {
        vec3 c = mix(vec3(0.5, 0.68, 1.0), vec3(1.2, 1.25, 1.3), vA);
        gl_FragColor = vec4(c, vA * uGain);
      }
    `,
  });

/** The light at the end of the tunnel, where everything converges */
const coreMaterial = () =>
  new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    uniforms: { uGain: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uGain;
      varying vec2 vUv;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float core = exp(-d * d * 9.0);
        float halo = exp(-d * 3.2) * 0.45;
        vec3 c = vec3(0.75, 0.86, 1.0) * core * 1.4 + vec3(0.3, 0.45, 1.0) * halo;
        gl_FragColor = vec4(c * uGain, 1.0);
      }
    `,
  });

const flashEl = () => document.getElementById('warp-flash');

const Warp = () => {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const root = useRef<THREE.Group>(null);
  const st = useRef({
    start: -1,
    runEnd: 0,
    travel: 0,
    phase: 0 as 0 | 1 | 2 | 3,
    /** When the ship started waiting at 100% for a click (ms into the jump), or -1 */
    holdAt: -1,
    asked: false,
    flashAt: 0,
    hud: false,
    welcome: false,
    done: false,
    hum: null as ((fade: number) => void) | null,
  });

  const parts = useMemo(() => {
    const tube = new THREE.CylinderGeometry(TUBE_R, TUBE_R * 0.55, TUBE_LEN, 64, 24, true);
    // along -z from the deck: the wide end at the eye, the far end narrowing away
    tube.rotateX(-Math.PI / 2);
    tube.translate(0, 0, -TUBE_LEN / 2 - TUBE_NEAR);
    const seed = new Float32Array(STREAKS * 2 * 3);
    const end = new Float32Array(STREAKS * 2);
    for (let i = 0; i < STREAKS; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const r = 3 + Math.pow(Math.random(), 0.7) * (TUBE_R - 6);
      const z = Math.random();
      for (let k = 0; k < 2; k += 1) {
        seed.set([a, r, z], (i * 2 + k) * 3);
        end[i * 2 + k] = k;
      }
    }
    const lines = new THREE.BufferGeometry();
    lines.setAttribute('position', new THREE.BufferAttribute(new Float32Array(STREAKS * 2 * 3), 3));
    lines.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
    lines.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    return { tube, tubeMat: tubeMaterial(), lines, lineMat: streakMaterial(), core: new THREE.PlaneGeometry(1, 1), coreMat: coreMaterial() };
  }, []);

  useEffect(
    () => () => {
      parts.tube.dispose();
      parts.tubeMat.dispose();
      parts.lines.dispose();
      parts.lineMat.dispose();
      parts.core.dispose();
      parts.coreMat.dispose();
    },
    [parts],
  );

  useEffect(() => {
    const s = st.current;
    warpFx.inside = useAppStore.getState().intro;
    onBootReveal(() => {
      if (!useAppStore.getState().intro) {
        warpFx.inside = false;
        return;
      }
      const now = performance.now();
      s.start = now;
      s.runEnd = Math.max(RUN_MS, MIN_TOTAL_MS - now);
      navDisplay.to(1, s.runEnd);
    });
    // anyone in a hurry drops out now (the same press unlocks the sound for the drop)
    const skip = () => {
      if (s.start < 0 || s.phase !== 0 || s.asked) return;
      s.asked = true;
      const ms = performance.now() - s.start;
      if (s.runEnd - ms <= SKIP_MS && s.holdAt < 0) return;
      s.runEnd = ms + SKIP_MS;
      navDisplay.to(1, SKIP_MS);
    };
    window.addEventListener('pointerdown', skip);
    window.addEventListener('keydown', skip);
    return () => {
      window.removeEventListener('pointerdown', skip);
      window.removeEventListener('keydown', skip);
      s.hum?.(0.3);
      s.hum = null;
      warpFx.inside = false;
      warpFx.shake = 0;
      warpFx.lens = 0;
    };
  }, []);

  useFrame((_, delta) => {
    const s = st.current;
    const g = root.current;
    if (!g) return;
    if (s.done || !useAppStore.getState().intro) {
      g.visible = false;
      warpFx.lens = 0;
      return;
    }
    const dt = Math.min(delta, 0.05);
    const base = responsiveFov(size.width / Math.max(1, size.height));
    const ms = s.start < 0 ? 0 : performance.now() - s.start;

    // the deck faces the system it is arriving at, and stays put
    camera.position.set(0, 0, 0);
    camera.quaternion.copy(ID);
    dragLook.yaw = 0;
    dragLook.pitch = 0;

    // sound needs a gesture first: the roar starts whenever audio becomes available in hyperspace
    if (!s.hum && s.phase < 2) s.hum = warpHum();

    let gain = 1;
    let speed = SPEED;
    let len = 34;
    let fov = base + WARP_FOV;
    let shake = 0.0011;
    if (s.phase === 0 && s.start >= 0 && ms >= s.runEnd) {
      // with sound wanted but still locked, wait for the click that unlocks it
      if (!s.asked && soundWanted() && !sfxReady() && s.holdAt < 0) {
        s.holdAt = ms;
        navDisplay.status('At destination');
        navDisplay.ready();
      }
    }
    const held = s.holdAt >= 0 && !s.asked && ms - s.holdAt < HOLD_MS;
    if (s.phase === 0 && s.start >= 0 && ms >= s.runEnd && !held) {
      s.phase = 1;
      navDisplay.status('Dropping out');
      navDisplay.spool();
      shipSound('dropout', SPOOL_MS / 1000);
      s.hum?.(SPOOL_MS / 1000);
      s.hum = null;
    }
    if (s.phase === 1) {
      // the drive spools: everything stretches and brightens toward the flash
      const u = clamp01((ms - s.runEnd) / SPOOL_MS);
      const e = u * u;
      speed = SPEED * (1 + 5 * e);
      len = 34 + 260 * e;
      gain = 1 + 1.4 * e;
      fov = base + WARP_FOV + SPOOL_FOV * e;
      shake = 0.0011 + 0.004 * e;
      const f = flashEl();
      if (f) {
        f.style.transition = 'none';
        f.style.opacity = String(Math.pow(clamp01((u - 0.55) / 0.45), 2));
      }
      if (u >= 1) {
        s.phase = 2;
        s.flashAt = performance.now();
        warpFx.inside = false;
        flight.heat = 0;
        navDisplay.arrived();
        if (f) {
          f.style.transition = 'opacity 520ms cubic-bezier(0.23, 1, 0.32, 1)';
          f.style.opacity = '0';
        }
      }
    }
    if (s.phase >= 2) {
      // out: the lens snaps narrow and eases back, the deck shudders and settles
      const since = performance.now() - s.flashAt;
      const k = clamp01(since / SETTLE_MS);
      fov = base + DROP_FOV * (1 - easeOut(k));
      shake = 0.007 * Math.pow(1 - k, 2);
      gain = 0;
      if (!s.hud && since >= HUD_AT) {
        s.hud = true;
        flight.speed = 0;
        useAppStore.getState().endIntro();
      }
      if (!s.welcome && since >= WELCOME_MS) {
        s.welcome = true;
        endBoot();
      }
      if (k >= 1 && s.welcome && s.hud) {
        s.done = true;
        warpFx.shake = 0;
        warpFx.lens = 0;
        return;
      }
    }
    warpFx.shake = shake;
    warpFx.lens = fov - base;
    if (!s.welcome) navDisplay.drift(warpFx.glassX, warpFx.glassY);

    if (Math.abs(camera.fov - fov) > 1e-3) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }

    // a cold glow on the canopy in hyperspace
    if (s.phase < 2) {
      flight.heat = 0.16 + 0.3 * (gain - 1);
      flight.heatColor = '#7fa8ff';
    }

    g.visible = gain > 0;
    s.travel += speed * dt;
    parts.tubeMat.uniforms.uTravel.value = s.travel % 100000;
    parts.tubeMat.uniforms.uGain.value = gain;
    parts.lineMat.uniforms.uTravel.value = s.travel % 100000;
    parts.lineMat.uniforms.uLen.value = len;
    parts.lineMat.uniforms.uGain.value = Math.min(1.6, gain);
    parts.coreMat.uniforms.uGain.value = gain;
  }, 0.4);

  return (
    <group ref={root} visible={useAppStore.getState().intro}>
      <mesh geometry={parts.tube} material={parts.tubeMat} frustumCulled={false} raycast={noRaycast} renderOrder={1} />
      <mesh geometry={parts.core} material={parts.coreMat} position={[0, 0, -TUBE_LEN + 20]} scale={TUBE_R * 2.6} raycast={noRaycast} renderOrder={1} />
      <lineSegments geometry={parts.lines} material={parts.lineMat} frustumCulled={false} raycast={noRaycast} renderOrder={2} />
    </group>
  );
};

export default Warp;
