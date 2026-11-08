import { useEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { Beacon, Planet } from '@/types/content';
import { useAppStore } from '@/state/useAppStore';
import { screenParts, type ScreenPart } from '@/ui/screenParts';
import { panelFocusIntent } from '@/ui/navigation';
import { usePanelView } from '@/ui/primitives';
import { mulberry, seedOf } from './rng';
import { hologramMaterial, holoLook } from './hologram';
import type { HeightFn } from './Terrain';

/* ---------- tuning ---------- */

/** CSS px per world unit on a deployed screen */
const PX = 240;
/** drei Html maps 400 / distanceFactor px to one unit in transform mode */
const DISTANCE_FACTOR = 400 / PX;
/** Orbiting panel radius (world units) */
const ORBIT_SIZE = 0.24;
/** Screens are laid out on a plane this far in front of the camera */
const PLANE_D = 3.2;
/** Screens deploy inside this camera distance (XZ) and fold back past FOLD */
const DEPLOY_NEAR = 7.5;
const DEPLOY_FOLD = 8.5;
/** Camera drift that re-anchors the layout */
const REANCHOR = 1.8;
const GAP = 0.08;
/** Corner radius of a deployed screen, world units (drawn in the hologram shader) */
const CORNER = 0.085;
/** Deployed screens float: bob height (world units) and sway (radians) */
const BOB = 0.014;
const SWAY = 0.018;
/** Panels leave one after another, this far apart */
const STAGGER_S = 0.16;
/** Flight time out to the screen slot and back home */
const OUT_S = 1.35;
const IN_S = 1.0;
/** How high the flight path bows above the straight line */
const ARC = 0.28;

type ShapeKind = 'rect' | 'hex' | 'oct' | 'tag';
const SHAPES: ShapeKind[] = ['hex', 'rect', 'oct', 'tag'];
const VERTS: Record<ShapeKind, number> = { rect: 4, hex: 6, oct: 8, tag: 5 };

/** Orbit form: a small regular polygon (rect is a 3:2 card). Same vertex order as screenShape. */
const orbitShape = (k: ShapeKind, r: number): [number, number][] => {
  if (k === 'rect') {
    const w = r * 1.5;
    const h = r;
    return [
      [w / 2, h / 2],
      [-w / 2, h / 2],
      [-w / 2, -h / 2],
      [w / 2, -h / 2],
    ];
  }
  const n = VERTS[k];
  const a0 = k === 'oct' ? Math.PI / 8 : 0;
  return Array.from({ length: n }, (_, i) => {
    const a = a0 + (i / n) * Math.PI * 2;
    return [Math.cos(a) * r, Math.sin(a) * r] as [number, number];
  });
};

/**
 * Screen form: every polygon opens into a w x h rectangle (extra vertices land
 * on its edges); the shader rounds the corners.
 */
const screenShape = (k: ShapeKind, w: number, h: number): [number, number][] => {
  const x = w / 2;
  const y = h / 2;
  const c = 0;
  switch (k) {
    case 'rect':
      return [
        [x, y],
        [-x, y],
        [-x, -y],
        [x, -y],
      ];
    case 'hex':
      return [
        [x, 0],
        [x - c, y],
        [-x + c, y],
        [-x, 0],
        [-x + c, -y],
        [x - c, -y],
      ];
    case 'oct':
      return [
        [x, y - c],
        [x - c, y],
        [-x + c, y],
        [-x, y - c],
        [-x, -y + c],
        [-x + c, -y],
        [x - c, -y],
        [x, -y + c],
      ];
    case 'tag':
      return [
        [x, 0],
        [x - c, y],
        [-x, y],
        [-x, -y],
        [x - c, -y],
      ];
  }
};

const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);
/** Slow start, slow landing: nothing snaps */
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

interface Box {
  w: number;
  h: number;
}

/**
 * Masonry layout into columns, trying every column count and keeping the one
 * that needs the least shrinking to fit availW x availH. Returns centres
 * relative to the block's top-left, the block size and the fit scale.
 */
const layout = (boxes: Box[], availW: number, availH: number) => {
  let best: { pos: [number, number][]; w: number; h: number; s: number } | null = null;
  for (let cols = 1; cols <= Math.min(3, boxes.length); cols += 1) {
    const colW = new Array(cols).fill(0);
    const colH = new Array(cols).fill(0);
    const colOf: number[] = [];
    boxes.forEach((b) => {
      // title stays top-left; the rest fill the shortest column
      let c = 0;
      if (colOf.length > 0) for (let i = 1; i < cols; i += 1) if (colH[i] < colH[c]) c = i;
      colOf.push(c);
      colW[c] = Math.max(colW[c], b.w);
      colH[c] += b.h + GAP;
    });
    const xs: number[] = [];
    let acc = 0;
    for (let c = 0; c < cols; c += 1) {
      xs.push(acc);
      acc += colW[c] + GAP;
    }
    const totalW = acc - GAP;
    const totalH = Math.max(...colH) - GAP;
    const s = Math.min(1, availW / totalW, availH / totalH);
    if (!best || s > best.s + 0.02) {
      const fill = new Array(cols).fill(0);
      const pos = boxes.map((b, i) => {
        const c = colOf[i];
        const p: [number, number] = [xs[c] + b.w / 2, fill[c] + b.h / 2];
        fill[c] += b.h + GAP;
        return p;
      });
      best = { pos, w: totalW, h: totalH, s };
    }
  }
  return best!;
};

/** Deployed screens keep at least this much air under them (world units) */
const GROUND_CLEAR = 0.18;
const FLOOR_SAMPLES = 7;
const _fp = new THREE.Vector3();
const _fu = new THREE.Vector3();

/**
 * The lowest height on the layout plane (camera-anchored, y up) that stays
 * GROUND_CLEAR above the ground everywhere between x0 and x1. The plane is
 * tilted with the anchored view, so each sample walks the plane's own up
 * direction to the height where it clears the ground under it.
 */
const groundFloor = (
  x0: number,
  x1: number,
  quat: THREE.Quaternion,
  anchor: THREE.Vector3,
  base: THREE.Vector3,
  ground: HeightFn,
) => {
  const up = _fu.set(0, 1, 0).applyQuaternion(quat);
  if (up.y < 0.2) return -Infinity;
  let floor = -Infinity;
  for (let k = 0; k < FLOOR_SAMPLES; k += 1) {
    const x = x0 + ((x1 - x0) * k) / (FLOOR_SAMPLES - 1);
    // the plane point at height 0, then the ground under where the screen's foot would be
    const p = _fp.set(x, 0, -PLANE_D).applyQuaternion(quat).add(anchor).add(base);
    let y = 0;
    for (let i = 0; i < 2; i += 1) {
      const gx = p.x + up.x * y;
      const gz = p.z + up.z * y;
      y = (ground(gx, gz) + GROUND_CLEAR - p.y) / up.y;
    }
    floor = Math.max(floor, y);
  }
  return floor;
};

interface Panel {
  kind: ShapeKind;
  orbit: [number, number][];
  geo: THREE.BufferGeometry;
  mat: THREE.ShaderMaterial;
  /** Linear flight progress 0..1; m is its eased value */
  prog: number;
  m: number;
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  /** Smoothed screen slot and facing; kept while folding home */
  target: THREE.Vector3;
  face: THREE.Quaternion;
  hasTarget: boolean;
  /** Measured content size, world units (before fit scaling) */
  size: Box;
}

interface Props {
  beacon: Beacon;
  /**
   * Beacons that share this spot and open together (the about camp): one
   * panel each, holding all of its parts, opening when any of them is focused
   */
  group?: Beacon[];
  planet: Planet;
  /** Monument height */
  height: number;
  index: number;
  reducedMotion?: boolean;
  /** Walkable height (world x, z): deployed screens stay above it */
  ground: HeightFn;
}

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _o = new THREE.Object3D();
const _op = new THREE.Vector3();
const _oq = new THREE.Quaternion();
const _tp = new THREE.Vector3();

/**
 * Flat polygon panels that orbit a monument, one per part of its content.
 * When the monument is focused and the viewer stands close (desktop only),
 * they fan out beside it, turn to face the camera and grow into screens that
 * carry the content as real DOM (links and the video stay clickable).
 */
/** All of a beacon's parts stacked in one panel, as wide as its widest part. */
const wholePart = (b: Beacon): ScreenPart => {
  const parts = screenParts(b);
  return {
    key: b.id,
    width: Math.max(...parts.map((p) => p.width)),
    node: (
      <div className="space-y-5">
        {parts.map((p) => (
          <div key={p.key}>{p.node}</div>
        ))}
      </div>
    ),
  };
};

const BeaconScreens = ({ beacon, group, planet, height, index, reducedMotion, ground }: Props) => {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const panelView = usePanelView();
  const parts = useMemo(() => (group ? group.map(wholePart) : screenParts(beacon)), [beacon, group]);
  const ids = useMemo(() => (group ? group.map((b) => b.id) : [beacon.id]), [beacon, group]);
  const root = useRef<THREE.Group>(null);
  const groups = useRef<(THREE.Group | null)[]>([]);
  const htmlGroups = useRef<(THREE.Group | null)[]>([]);
  const contents = useRef<(HTMLDivElement | null)[]>([]);
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  const layer = useMemo(
    () => ({ current: document.getElementById('screen-layer') ?? document.body }) as MutableRefObject<HTMLElement>,
    [],
  );

  const panels = useMemo<Panel[]>(() => {
    const rnd = mulberry(seedOf(`${beacon.id}:screens`));
    const start = Math.floor(rnd() * SHAPES.length);
    const accent = new THREE.Color(planet.accent);
    return parts.map((p, i) => {
      const kind = SHAPES[(start + i) % SHAPES.length];
      const n = VERTS[kind];
      const r = ORBIT_SIZE * (0.85 + rnd() * 0.3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((n + 1) * 3), 3));
      const idx: number[] = [];
      for (let k = 0; k < n; k += 1) idx.push(0, 1 + k, 1 + ((k + 1) % n));
      geo.setIndex(idx);
      const mat = hologramMaterial(accent, holoLook(rnd), rnd() * 10);
      mat.uniforms.uN.value = n;
      return {
        kind,
        orbit: orbitShape(kind, r),
        geo,
        mat,
        prog: 0,
        m: -1,
        pos: new THREE.Vector3(NaN, 0, 0),
        quat: new THREE.Quaternion(),
        target: new THREE.Vector3(),
        face: new THREE.Quaternion(),
        hasTarget: false,
        size: { w: p.width / PX, h: 0.6 },
      };
    });
  }, [beacon.id, parts, planet.accent]);

  useEffect(
    () => () => {
      panels.forEach((p) => {
        p.geo.dispose();
        p.mat.dispose();
      });
    },
    [panels],
  );

  // content sizes (world units) come from a ResizeObserver, so the frame loop never reads layout
  const ro = useRef<ResizeObserver | null>(null);
  useEffect(() => {
    const measure = (el: HTMLElement) => {
      const i = contents.current.indexOf(el as HTMLDivElement);
      if (i < 0 || !panels[i] || !el.offsetWidth) return;
      panels[i].size.w = el.offsetWidth / PX;
      panels[i].size.h = el.offsetHeight / PX;
    };
    const obs = new ResizeObserver((entries) => entries.forEach((e) => measure(e.target as HTMLElement)));
    ro.current = obs;
    contents.current.forEach((el) => el && obs.observe(el));
    return () => {
      obs.disconnect();
      ro.current = null;
    };
  }, [panels]);
  const bindContent = (i: number) => (el: HTMLDivElement | null) => {
    const prev = contents.current[i];
    if (prev === el) return;
    if (prev) ro.current?.unobserve(prev);
    contents.current[i] = el;
    if (el) ro.current?.observe(el);
  };

  const st = useRef({
    active: false,
    since: 0,
    anchorPos: new THREE.Vector3(),
    anchorQuat: new THREE.Quaternion(),
    anchored: false,
    focusedOnce: false,
    /** Fit scale of the last layout, kept while screens fold home */
    fit: 1,
  });

  useFrame(({ clock }, delta) => {
    const g = root.current;
    if (!g) return;
    const dt = Math.min(delta, 0.05);
    const t = clock.elapsedTime;
    const s = st.current;
    const store = useAppStore.getState();
    const n = panels.length;
    const base = g.getWorldPosition(_w);
    // camera in this group's frame (the group is never rotated or scaled)
    const cam = _v.copy(camera.position).sub(base);
    const dist = Math.hypot(cam.x, cam.z);

    const focused = !!store.focusedBeaconId && ids.includes(store.focusedBeaconId) && store.mode === 'planet' && !store.readerOpen;
    const want = focused && !panelView && !store.glideBeaconId && dist < (s.active ? DEPLOY_FOLD : DEPLOY_NEAR);
    if (want !== s.active) {
      s.active = want;
      s.since = t;
      s.anchored = false;
      s.focusedOnce = false;
    }
    if (want && !openRef.current) {
      openRef.current = true;
      setOpen(true);
    }

    // anchor the layout to where the viewer stands; re-anchor only after walking
    if (s.active && (!s.anchored || s.anchorPos.distanceTo(cam) > REANCHOR)) {
      s.anchorPos.copy(cam);
      s.anchorQuat.copy(camera.quaternion);
      s.anchored = true;
    }

    let lay: ReturnType<typeof layout> | null = null;
    let regionX = 0;
    let topY = 0;
    let leftSide = false;
    if (s.active) {
      const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      const halfH = PLANE_D * tanV;
      const halfW = halfH * camera.aspect;
      // pillar middle in the anchored camera frame, projected to the layout plane
      _q.copy(s.anchorQuat).invert();
      const mid = _o.position.set(0, height * 0.55, 0).sub(s.anchorPos).applyQuaternion(_q);
      const depth = Math.max(0.5, -mid.z);
      const px = (mid.x * PLANE_D) / depth;
      // clear the monument's footprint (plinth and widest arches) as seen on the layout plane
      const margin = (0.95 * PLANE_D) / depth + 0.08;
      let x0 = px + margin;
      let x1 = halfW * 0.94;
      if (x1 - x0 < halfW * 0.7) {
        leftSide = true;
        x0 = -halfW * 0.94;
        x1 = px - margin;
      }
      const availW = Math.max(0.5, x1 - x0);
      // the ground across the region, as the lowest plane height a screen may reach
      const floor = groundFloor(x0, x1, s.anchorQuat, s.anchorPos, base, ground);
      const sizes = panels.map((p) => p.size);
      const centred = (h: number) => h / 2 - halfH * 0.04;
      lay = layout(sizes, availW, halfH * 1.5);
      if (centred(lay.h * lay.s) - lay.h * lay.s < floor) {
        // the block would reach the ground: give it only the room above it, so the screens
        // that would sink wrap into more columns beside the others instead
        const top = Math.max(centred(lay.h * lay.s), halfH * 0.75);
        lay = layout(sizes, availW, Math.max(halfH * 0.5, top - floor));
      }
      regionX = leftSide ? x1 - lay.w * lay.s : x0;
      s.fit = lay.s;
      // and never below it, whatever the fit
      topY = Math.max(centred(lay.h * lay.s), floor + lay.h * lay.s);
    }

    let anyOut = false;
    const spin = reducedMotion ? 0 : 0.22 * (index % 2 ? -1 : 1);
    panels.forEach((p, i) => {
      const grp = groups.current[i];
      if (!grp) return;
      const go = s.active && t - s.since >= i * STAGGER_S;
      const prevM = p.m;
      p.prog = reducedMotion
        ? go ? 1 : 0
        : Math.min(1, Math.max(0, p.prog + (go ? dt / OUT_S : -dt / IN_S)));
      p.m = easeInOut(p.prog);

      // orbit pose
      const th = index * 1.3 + t * spin + (i / n) * Math.PI * 2;
      const rad = 1.12 + (i % 2) * 0.1;
      const oy = height * (0.32 + 0.5 * ((i + 0.5) / n)) + (reducedMotion ? 0 : Math.sin(t * 0.8 + i * 1.9) * 0.07);
      _o.position.set(Math.cos(th) * rad, oy, Math.sin(th) * rad);
      _o.lookAt(Math.cos(th) * 3, oy + 0.4, Math.sin(th) * 3);
      _o.rotateZ(Math.sin(i * 2.1 + index) * 0.5);
      const orbitPos = _op.copy(_o.position);
      const orbitQuat = _oq.copy(_o.quaternion);

      if (lay && s.active) {
        // the screen slot, re-anchored gently when the viewer walks
        const [lx, ly] = lay.pos[i];
        _tp.set(regionX + lx * lay.s, topY - ly * lay.s, -PLANE_D).applyQuaternion(s.anchorQuat).add(s.anchorPos);
        _o.position.copy(_tp);
        _o.lookAt(cam);
        if (!p.hasTarget) {
          p.target.copy(_tp);
          p.face.copy(_o.quaternion);
          p.hasTarget = true;
        } else {
          p.target.lerp(_tp, damp(reducedMotion ? 30 : 2.2, dt));
          p.face.slerp(_o.quaternion, damp(reducedMotion ? 30 : 2.2, dt));
        }
      }
      if (p.prog <= 0) p.hasTarget = false;

      if (p.hasTarget && p.m > 0) {
        // one smooth bowed path between the orbit slot and the screen slot
        p.pos.copy(orbitPos).lerp(p.target, p.m);
        p.pos.y += Math.sin(Math.PI * p.m) * ARC;
        p.quat.copy(orbitQuat).slerp(p.face, p.m);
      } else {
        p.pos.copy(orbitPos);
        p.quat.copy(orbitQuat);
      }
      grp.position.copy(p.pos);
      grp.quaternion.copy(p.quat);
      if (!reducedMotion && p.m > 0) {
        // deployed screens drift gently, each on its own slow rhythm
        const k = p.m * p.m;
        grp.translateY(Math.sin(t * 0.9 + i * 1.7) * BOB * k);
        grp.translateX(Math.sin(t * 0.6 + i * 2.9) * BOB * 0.5 * k);
        grp.rotateX(Math.sin(t * 0.7 + i * 1.3) * SWAY * k);
        grp.rotateY(Math.sin(t * 0.55 + i * 2.2) * SWAY * k);
        grp.rotateZ(Math.sin(t * 0.8 + i * 0.9) * SWAY * 0.4 * k);
      }
      htmlGroups.current[i]?.scale.setScalar(s.fit);
      if (p.prog > 0) anyOut = true;

      // morph the outline from orbiting polygon to screen
      const w = p.size.w * s.fit;
      const h = p.size.h * s.fit;
      if (Math.abs(p.m - prevM) > 1e-5 || prevM < 0 || lay) {
        const scr = screenShape(p.kind, w, h);
        const pa = p.geo.getAttribute('position') as THREE.BufferAttribute;
        const poly = p.mat.uniforms.uPoly.value as THREE.Vector2[];
        pa.setXYZ(0, 0, 0, 0);
        for (let k = 0; k < p.orbit.length; k += 1) {
          const x = p.orbit[k][0] + (scr[k][0] - p.orbit[k][0]) * p.m;
          const y = p.orbit[k][1] + (scr[k][1] - p.orbit[k][1]) * p.m;
          pa.setXYZ(k + 1, x, y, 0);
          poly[k].set(x, y);
        }
        pa.needsUpdate = true;
        p.geo.computeBoundingSphere();
      }
      p.mat.uniforms.uM.value = p.m;
      (p.mat.uniforms.uHalf.value as THREE.Vector2).set(w / 2, h / 2);
      p.mat.uniforms.uRad.value = Math.min(CORNER * s.fit, w * 0.25, h * 0.25);
      p.mat.uniforms.uTime.value = t;

      const el = contents.current[i];
      if (el) {
        const o = smooth(0.72, 0.97, p.m);
        // same 3-decimal value as before, in the form the style reads back ("1", not "1.000")
        const op = String(Math.round(o * 1000) / 1000);
        const vis = o > 0.01 ? 'visible' : 'hidden';
        const pe = o > 0.6 ? 'auto' : 'none';
        // written only on change: a settled screen costs no style work
        if (el.style.opacity !== op) el.style.opacity = op;
        if (el.style.visibility !== vis) el.style.visibility = vis;
        if (el.style.pointerEvents !== pe) el.style.pointerEvents = pe;
        // beacon labels keep clear of readable screens
        if (el.hasAttribute('data-hud-block') !== o > 0.3) el.toggleAttribute('data-hud-block', o > 0.3);
      }
    });

    // deliberate opens move keyboard focus to the title screen's heading once it is readable
    const intent = panelFocusIntent.id ? ids.indexOf(panelFocusIntent.id) : -1;
    if (s.active && !s.focusedOnce && intent >= 0 && panels[intent].m > 0.95) {
      s.focusedOnce = true;
      panelFocusIntent.id = null;
      contents.current[intent]?.querySelector<HTMLElement>('[data-panel-heading]')?.focus({ preventScroll: true });
    }

    if (!s.active && !anyOut && openRef.current) {
      openRef.current = false;
      setOpen(false);
    }
  });

  return (
    <group ref={root}>
      {panels.map((p, i) => (
        <group
          key={parts[i].key}
          ref={(el) => {
            groups.current[i] = el;
          }}
        >
          <mesh geometry={p.geo} material={p.mat} renderOrder={5} />
          {open && (
            <group
              ref={(el) => {
                htmlGroups.current[i] = el;
              }}
            >
              <Html transform distanceFactor={DISTANCE_FACTOR} portal={layer} zIndexRange={[4, 0]} pointerEvents="auto">
                <div
                  ref={bindContent(i)}
                  data-beacon-panel
                  data-beacon-screen
                  role="group"
                  aria-label={group ? `${group[i].label} details` : i === 0 ? `${beacon.label} details` : undefined}
                  className="relative select-text px-7 py-6 text-ink"
                  style={
                    {
                      width: parts[i].width,
                      opacity: 0,
                      visibility: 'hidden',
                      '--accent': planet.accent,
                    } as CSSProperties
                  }
                >
                  {parts[i].node}
                </div>
              </Html>
            </group>
          )}
        </group>
      ))}
    </group>
  );
};

export default BeaconScreens;
