import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { Beacon, Planet } from '@/types/content';
import { useAppStore } from '@/state/useAppStore';
import { screenParts, type ScreenPart } from '@/ui/screenParts';
import { panelFocusIntent } from '@/ui/navigation';
import { usePanelView } from '@/ui/primitives';
import { mulberry, seedOf } from './rng';
import { hologramMaterial, holoLook } from './hologram';
import type { HeightFn } from './Terrain';
import { projectQuad, quadMatrix } from './screenPlacement';

/* ---------- tuning ---------- */

/** CSS px per world unit on a deployed screen */
const PX = 240;
/** Orbiting panel radius (world units) */
const ORBIT_SIZE = 0.24;
/** Screens are laid out on a plane this far in front of the camera */
const PLANE_D = 3.2;
/** Screens deploy inside this camera distance (XZ) and fold back past FOLD */
const DEPLOY_NEAR = 7.5;
const DEPLOY_FOLD = 8.5;
/** Camera drift that re-anchors the layout */
const REANCHOR = 2.2;
/** Open screens re-measure their content this often (frames), in case the ResizeObserver missed it */
const MEASURE_EVERY = 20;
/** How quickly the whole block glides to a new anchor (per second) */
const GLIDE_RATE = 2.4;
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
 * that fits availW x availH best: the least shrinking, traded a little
 * against how much of the area it fills, so a tall stack wraps into another
 * column when that costs little size, and the whole block reads at a glance. Returns centres relative to the block's top-left,
 * the block size and the fit scale.
 */
const layout = (boxes: Box[], availW: number, availH: number, keepCols = 0) => {
  let best: { pos: [number, number][]; w: number; h: number; s: number; score: number; cols: number } | null = null;
  const most = Math.min(4, boxes.length);
  for (let cols = keepCols ? Math.min(keepCols, most) : 1; cols <= (keepCols ? Math.min(keepCols, most) : most); cols += 1) {
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
    // how far the block reaches toward the larger of its two limits: lower is more compact
    const fill = Math.max((totalW * s) / availW, (totalH * s) / availH);
    // a little smaller is worth it when it makes the block much more compact
    const score = s - 0.15 * fill;
    if (!best || score > best.score + 0.01) {
      const used = new Array(cols).fill(0);
      const pos = boxes.map((b, i) => {
        const c = colOf[i];
        const p: [number, number] = [xs[c] + b.w / 2, used[c] + b.h / 2];
        used[c] += b.h + GAP;
        return p;
      });
      best = { pos, w: totalW, h: totalH, s, score, cols };
    }
  }
  return best!;
};

/** The band screens are laid out in, as fractions of the view's half-height above and below its centre */
const SCREEN_TOP = 0.52;
const SCREEN_BOTTOM = 0.72;
/** ...and how far out to the side they may reach, as a fraction of the half-width */
const SCREEN_SIDE = 0.86;
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
  const contents = useRef<(HTMLDivElement | null)[]>([]);
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  const size = useThree((st) => st.size);
  // the screens' DOM lives in its own React root inside #screen-layer (above the canvas, below the HUD)
  const host = useRef<{ el: HTMLDivElement; root: Root } | null>(null);
  useLayoutEffect(() => {
    const el = document.createElement('div');
    (document.getElementById('screen-layer') ?? document.body).appendChild(el);
    const root = createRoot(el);
    host.current = { el, root };
    return () => {
      host.current = null;
      // unmounting a root while React renders warns: let this render finish first
      window.setTimeout(() => {
        root.unmount();
        el.remove();
      }, 0);
    };
  }, []);

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

  // content sizes (world units) come from a ResizeObserver, so the frame loop rarely reads layout.
  // Safari does not always report these transformed elements, so open screens
  // are also measured every MEASURE_EVERY frames; the layout is redone only when a size changes
  const ro = useRef<ResizeObserver | null>(null);
  const sizeVer = useRef(0);
  const measure = useRef((el: HTMLElement) => {
    void el;
  });
  measure.current = (el: HTMLElement) => {
    const i = contents.current.indexOf(el as HTMLDivElement);
    if (i < 0 || !panels[i] || !el.offsetWidth) return;
    const w = el.offsetWidth / PX;
    const h = el.offsetHeight / PX;
    const size = panels[i].size;
    if (Math.abs(size.w - w) < 1e-4 && Math.abs(size.h - h) < 1e-4) return;
    size.w = w;
    size.h = h;
    sizeVer.current += 1;
  };
  useEffect(() => {
    const obs = new ResizeObserver((entries) => entries.forEach((e) => measure.current(e.target as HTMLElement)));
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
    /** The plan for the current anchor: the masonry, where the block starts, its top and scale */
    lay: null as ReturnType<typeof layout> | null,
    regionX: 0,
    topY: 0,
    planFit: 1,
    planVer: -1,
    /** Frame counter for the periodic size check */
    frame: 0,
    /** The block sits left of the monument */
    left: false,
    /** The anchor and plan as shown: they glide to a new anchor rather than jump */
    viewPos: new THREE.Vector3(),
    viewQuat: new THREE.Quaternion(),
    vRegionX: 0,
    vTopY: 0,
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

    /*
     * The block is planned once per anchor: where the viewer stood when the
     * screens opened, and again only after they walk REANCHOR away. The column
     * arrangement is chosen when the screens open (and once more when their
     * real sizes come in) and then kept, so walking never reshuffles them; on
     * a new anchor the whole block glides there as one piece, facing that
     * spot, so small steps move nothing.
     */
    const first = s.active && !s.anchored;
    const moved = s.active && s.anchored && s.anchorPos.distanceTo(cam) > REANCHOR;
    if (first || moved) {
      s.anchorPos.copy(cam);
      s.anchorQuat.copy(camera.quaternion);
      s.anchored = true;
    }
    // the fallback for browsers whose ResizeObserver misses these elements (Safari)
    if (openRef.current && (s.frame = (s.frame + 1) % MEASURE_EVERY) === 0)
      contents.current.forEach((el) => el && measure.current(el));
    const resized = s.active && s.planVer !== sizeVer.current;
    if (first || moved || resized) {
      s.planVer = sizeVer.current;
      // the column count is free when the screens open or their sizes arrive, kept on a new anchor
      const keep = moved && !resized && s.lay ? s.lay.cols : 0;
      let leftSide = false;
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
      const rightRoom = halfW * SCREEN_SIDE - (px + margin);
      const leftRoom = px - margin + halfW * SCREEN_SIDE;
      // the side with room, chosen when the screens open; walking keeps it unless it runs out
      leftSide = moved && !resized ? (s.left ? leftRoom > halfW * 0.35 || rightRoom < leftRoom : rightRoom < halfW * 0.35 && leftRoom > rightRoom) : rightRoom < halfW * 0.7;
      s.left = leftSide;
      const x0 = leftSide ? -halfW * SCREEN_SIDE : px + margin;
      const x1 = leftSide ? px - margin : halfW * SCREEN_SIDE;
      const availW = Math.max(0.5, x1 - x0);
      // the screens live in a band: no higher than SCREEN_TOP of the way up the view (higher
      // ones are hard to read), no lower than the ground or SCREEN_BOTTOM down. A stack too
      // tall for the band wraps into more columns instead of climbing
      const floor = Math.max(groundFloor(x0, x1, s.anchorQuat, s.anchorPos, base, ground), -halfH * SCREEN_BOTTOM);
      const ceiling = Math.max(halfH * SCREEN_TOP, floor + halfH * 0.5);
      const lay = layout(
        panels.map((p) => p.size),
        availW,
        ceiling - floor,
        keep,
      );
      s.lay = lay;
      s.regionX = leftSide ? x1 - lay.w * lay.s : x0;
      s.planFit = lay.s;
      // centred on the eye line where it fits, otherwise kept inside the band (the ground wins)
      const h = lay.h * lay.s;
      s.topY = Math.max(Math.min(h / 2 - halfH * 0.04, ceiling), floor + h);
      if (first) {
        s.viewPos.copy(s.anchorPos);
        s.viewQuat.copy(s.anchorQuat);
        s.vRegionX = s.regionX;
        s.vTopY = s.topY;
        s.fit = s.planFit;
      }
    }
    if (s.active) {
      const k = damp(reducedMotion ? 30 : GLIDE_RATE, dt);
      s.viewPos.lerp(s.anchorPos, k);
      s.viewQuat.slerp(s.anchorQuat, k);
      s.vRegionX += (s.regionX - s.vRegionX) * k;
      s.vTopY += (s.topY - s.vTopY) * k;
      s.fit += (s.planFit - s.fit) * k;
    }
    const lay = s.active ? s.lay : null;

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
        // the screen slot in the block as shown, facing the spot it was laid out for
        const [lx, ly] = lay.pos[i];
        _tp.set(s.vRegionX + lx * s.fit, s.vTopY - ly * s.fit, -PLANE_D).applyQuaternion(s.viewQuat).add(s.viewPos);
        _o.position.copy(_tp);
        _o.lookAt(s.viewPos);
        p.target.copy(_tp);
        p.face.copy(_o.quaternion);
        p.hasTarget = true;
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

  useEffect(() => {
    host.current?.root.render(
      open ? (
        <>
          {parts.map((part, i) => (
            <div
              key={part.key}
              ref={bindContent(i)}
              data-beacon-panel
              data-beacon-screen
              role="group"
              aria-label={group ? `${group[i].label} details` : i === 0 ? `${beacon.label} details` : undefined}
              className="absolute left-0 top-0 select-text px-7 py-6 text-ink"
              style={
                {
                  width: part.width,
                  opacity: 0,
                  visibility: 'hidden',
                  transformOrigin: '0 0',
                  '--accent': planet.accent,
                } as CSSProperties
              }
            >
              {part.node}
            </div>
          ))}
        </>
      ) : null,
    );
  }, [open, parts, group, beacon.label, planet.accent]);

  // after the camera and the cockpit rig have moved this frame, before the composer renders it:
  // each readable screen's DOM is mapped straight onto its panel's four corners on screen
  const placed = useRef<string[]>([]);
  useFrame(() => {
    if (!openRef.current) return;
    camera.updateMatrixWorld();
    const fit = st.current.fit;
    panels.forEach((p, i) => {
      const el = contents.current[i];
      const grp = groups.current[i];
      if (!el || !grp || el.style.visibility === 'hidden') return;
      grp.updateWorldMatrix(true, false);
      const q = projectQuad(grp, (p.size.w * fit) / 2, (p.size.h * fit) / 2, camera, size.width, size.height);
      const tf = q ? quadMatrix(p.size.w * PX, p.size.h * PX, q) : 'scale(0)';
      if (placed.current[i] !== tf) {
        placed.current[i] = tf;
        el.style.transform = tf;
      }
    });
  }, 0.95);

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
        </group>
      ))}
    </group>
  );
};

export default BeaconScreens;
