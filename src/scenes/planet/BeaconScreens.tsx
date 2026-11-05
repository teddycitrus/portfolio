import { useEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { Beacon, Planet } from '@/types/content';
import { useAppStore } from '@/state/useAppStore';
import { screenParts } from '@/ui/screenParts';
import { panelFocusIntent } from '@/ui/navigation';
import { CloseIcon, useNarrow } from '@/ui/primitives';
import { mulberry, seedOf } from './rng';

/* ---------- tuning ---------- */

/** CSS px per world unit on a deployed screen */
const PX = 240;
/** drei Html maps 400 / distanceFactor px to one unit in transform mode */
const DISTANCE_FACTOR = 400 / PX;
/** Orbiting panel radius (world units) */
const ORBIT_SIZE = 0.2;
/** Screens are laid out on a plane this far in front of the camera */
const PLANE_D = 3.2;
/** Screens deploy inside this camera distance (XZ) and fold back past FOLD */
const DEPLOY_NEAR = 7.5;
const DEPLOY_FOLD = 8.5;
/** Camera drift that re-anchors the layout */
const REANCHOR = 1.8;
const GAP = 0.08;
/** Chamfer / point depth of screen outlines, world units */
const CUT = 0.09;
const STAGGER_S = 0.07;

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

/** Screen form: a w x h panel keeping the polygon's character in its corners. */
const screenShape = (k: ShapeKind, w: number, h: number): [number, number][] => {
  const x = w / 2;
  const y = h / 2;
  const c = Math.min(CUT, w * 0.2, h * 0.3);
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

interface Panel {
  kind: ShapeKind;
  orbit: [number, number][];
  geo: THREE.BufferGeometry;
  line: THREE.BufferGeometry;
  fill: THREE.MeshBasicMaterial;
  edge: THREE.LineBasicMaterial;
  m: number;
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  /** Measured content size, world units (before fit scaling) */
  size: Box;
}

interface Props {
  beacon: Beacon;
  planet: Planet;
  /** Monument height */
  height: number;
  index: number;
  reducedMotion?: boolean;
}

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _o = new THREE.Object3D();
const _op = new THREE.Vector3();
const _oq = new THREE.Quaternion();
const _tp = new THREE.Vector3();
const ORBIT_FILL = new THREE.Color();
const SCREEN_FILL = new THREE.Color('#080b14');

/**
 * Flat polygon panels that orbit a monument, one per part of its content.
 * When the monument is focused and the viewer stands close (desktop only),
 * they fan out beside it, turn to face the camera and grow into screens that
 * carry the content as real DOM (links and the video stay clickable).
 */
const BeaconScreens = ({ beacon, planet, height, index, reducedMotion }: Props) => {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const narrow = useNarrow();
  const parts = useMemo(() => screenParts(beacon), [beacon]);
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
      const line = new THREE.BufferGeometry();
      line.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      return {
        kind,
        orbit: orbitShape(kind, r),
        geo,
        line,
        fill: new THREE.MeshBasicMaterial({
          color: accent.clone().multiplyScalar(0.35),
          transparent: true,
          opacity: 0.5,
          side: THREE.DoubleSide,
          depthWrite: false,
          fog: false,
        }),
        edge: new THREE.LineBasicMaterial({ color: accent.clone(), transparent: true, opacity: 0.9, fog: false }),
        m: -1,
        pos: new THREE.Vector3(NaN, 0, 0),
        quat: new THREE.Quaternion(),
        size: { w: p.width / PX, h: 0.6 },
      };
    });
  }, [beacon.id, parts, planet.accent]);

  useEffect(
    () => () => {
      panels.forEach((p) => {
        p.geo.dispose();
        p.line.dispose();
        p.fill.dispose();
        p.edge.dispose();
      });
    },
    [panels],
  );

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

    const focused = store.focusedBeaconId === beacon.id && store.mode === 'planet' && !store.readerOpen;
    const want = focused && !narrow && !store.glideBeaconId && dist < (s.active ? DEPLOY_FOLD : DEPLOY_NEAR);
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

    // measured content sizes (world units)
    contents.current.forEach((el, i) => {
      if (el && el.offsetWidth) {
        panels[i].size.w = el.offsetWidth / PX;
        panels[i].size.h = el.offsetHeight / PX;
      }
    });

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
      const availH = halfH * 1.5;
      lay = layout(
        panels.map((p) => p.size),
        availW,
        availH,
      );
      regionX = leftSide ? x1 - lay.w * lay.s : x0;
      s.fit = lay.s;
      topY = (lay.h * lay.s) / 2 - halfH * 0.04;
    }

    let anyOut = false;
    const spin = reducedMotion ? 0 : 0.22 * (index % 2 ? -1 : 1);
    panels.forEach((p, i) => {
      const grp = groups.current[i];
      if (!grp) return;
      const go = s.active && t - s.since >= i * STAGGER_S;
      const rate = reducedMotion ? 30 : go ? 4.2 : 3.2;
      const prevM = p.m;
      p.m += ((go ? 1 : 0) - Math.max(0, p.m)) * damp(rate, dt);
      if (p.m < 0.0005 && !go) p.m = 0;

      // orbit pose
      const th = index * 1.3 + t * spin + (i / n) * Math.PI * 2;
      const rad = 1.12 + (i % 2) * 0.1;
      const oy = height * (0.32 + 0.5 * ((i + 0.5) / n)) + (reducedMotion ? 0 : Math.sin(t * 0.8 + i * 1.9) * 0.07);
      _o.position.set(Math.cos(th) * rad, oy, Math.sin(th) * rad);
      _o.lookAt(Math.cos(th) * 3, oy + 0.4, Math.sin(th) * 3);
      _o.rotateZ(Math.sin(i * 2.1 + index) * 0.5);
      const orbitPos = _op.copy(_o.position);
      const orbitQuat = _oq.copy(_o.quaternion);
      if (Number.isNaN(p.pos.x)) {
        p.pos.copy(orbitPos);
        p.quat.copy(orbitQuat);
      }

      const w = p.size.w * s.fit;
      const h = p.size.h * s.fit;
      if (lay && go) {
        // fly out to the screen slot, turning to face the viewer
        const [lx, ly] = lay.pos[i];
        _tp.set(regionX + lx * lay.s, topY - ly * lay.s, -PLANE_D).applyQuaternion(s.anchorQuat).add(s.anchorPos);
        p.pos.lerp(_tp, damp(reducedMotion ? 30 : 5, dt));
        _o.position.copy(p.pos);
        _o.lookAt(cam);
        p.quat.slerp(_o.quaternion, damp(reducedMotion ? 30 : 7, dt));
        htmlGroups.current[i]?.scale.setScalar(lay.s);
      } else if (p.m > 0.0005) {
        // folding home: chase the orbit slot
        p.pos.lerp(orbitPos, damp(reducedMotion ? 30 : 4.5, dt));
        p.quat.slerp(orbitQuat, damp(reducedMotion ? 30 : 4.5, dt));
      } else {
        p.pos.copy(orbitPos);
        p.quat.copy(orbitQuat);
      }
      grp.position.copy(p.pos);
      grp.quaternion.copy(p.quat);
      if (p.m > 0.0005) anyOut = true;

      // morph the outline from orbiting polygon to screen
      if (Math.abs(p.m - prevM) > 1e-5 || prevM < 0 || lay) {
        const scr = screenShape(p.kind, w, h);
        const pa = p.geo.getAttribute('position') as THREE.BufferAttribute;
        const la = p.line.getAttribute('position') as THREE.BufferAttribute;
        const m = p.m * p.m * (3 - 2 * p.m);
        pa.setXYZ(0, 0, 0, 0);
        for (let k = 0; k < p.orbit.length; k += 1) {
          const x = p.orbit[k][0] + (scr[k][0] - p.orbit[k][0]) * m;
          const y = p.orbit[k][1] + (scr[k][1] - p.orbit[k][1]) * m;
          pa.setXYZ(k + 1, x, y, 0);
          la.setXYZ(k, x, y, 0.001);
        }
        pa.needsUpdate = true;
        la.needsUpdate = true;
        p.geo.computeBoundingSphere();
        p.line.computeBoundingSphere();
      }

      ORBIT_FILL.set(planet.accent).multiplyScalar(0.35);
      p.fill.color.copy(ORBIT_FILL).lerp(SCREEN_FILL, p.m);
      p.fill.opacity = 0.5 + 0.44 * p.m;
      p.edge.opacity = 0.9 - 0.35 * p.m;

      const el = contents.current[i];
      if (el) {
        const o = smooth(0.82, 0.98, p.m);
        el.style.opacity = o.toFixed(3);
        el.style.visibility = o > 0.01 ? 'visible' : 'hidden';
        el.style.pointerEvents = o > 0.6 ? 'auto' : 'none';
        // beacon labels keep clear of readable screens
        if (el.hasAttribute('data-hud-block') !== o > 0.3) el.toggleAttribute('data-hud-block', o > 0.3);
      }
    });

    // deliberate opens move keyboard focus to the title screen's heading once it is readable
    if (s.active && !s.focusedOnce && panels[0].m > 0.95 && panelFocusIntent.id === beacon.id) {
      s.focusedOnce = true;
      panelFocusIntent.id = null;
      contents.current[0]?.querySelector<HTMLElement>('[data-panel-heading]')?.focus({ preventScroll: true });
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
          <mesh geometry={p.geo} material={p.fill} renderOrder={5} />
          <lineLoop geometry={p.line} material={p.edge} renderOrder={6} />
          {open && (
            <group
              ref={(el) => {
                htmlGroups.current[i] = el;
              }}
            >
              <Html transform distanceFactor={DISTANCE_FACTOR} portal={layer} zIndexRange={[4, 0]} pointerEvents="auto">
                <div
                  ref={(el) => {
                    contents.current[i] = el;
                  }}
                  data-beacon-panel
                  data-beacon-screen
                  role="group"
                  aria-label={i === 0 ? `${beacon.label} details` : undefined}
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
                  {i === 0 && (
                    <button
                      type="button"
                      onClick={() => useAppStore.getState().setFocusedBeacon(null)}
                      aria-label="Close"
                      className="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-full text-ink-muted transition-colors duration-200 hover:bg-white/[0.06] hover:text-ink"
                    >
                      <CloseIcon />
                    </button>
                  )}
                  <div className={i === 0 ? '[&_[data-panel-heading]]:pr-8' : undefined}>{parts[i].node}</div>
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
