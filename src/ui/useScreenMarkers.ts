import { useEffect, useRef } from 'react';
import type { PlanetScreenInfo } from '@/state/runtime';

export interface MarkerEls {
  /** Label placed below (or above) the projected point when on screen */
  anchor: HTMLElement | null;
  /** Optional detail shown under the priority anchor; reserved in layout but not part of its size */
  extra: HTMLElement | null;
  /** Pinned to the viewport edge when off screen */
  edge: HTMLElement | null;
  /** Rotated to point toward the target */
  arrow: HTMLElement | null;
}

export interface MarkerOptions {
  /** Keep-out bands so anchored labels clear the HUD bars */
  safe: { top: number; bottom: number };
  /** Id to hide entirely (read every frame) */
  hiddenId?: { current: string | null };
  /** Id placed first and never moved by collisions (read every frame) */
  priorityId?: { current: string | null };
  /** Fixed y for edge markers (viewport height in, px out) instead of the projected y */
  edgeY?: (h: number) => number;
  /** Space between the target disc and its label, from the target's pixel size */
  gap?: (size: number) => number;
  /** Obstacle half-extents around a target (defaults to its pixel size); e.g. wider for rings */
  extent?: (id: string, size: number) => { x: number; y: number };
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  id: string;
}
interface Size {
  w: number;
  h: number;
}

const PAD = 6;
const EDGE = 8;
const EXTRA_GAP = 8;
const NO_SIZE: Size = { w: 0, h: 0 };
const defaultGap = () => 14;

const show = (el: HTMLElement | null, on: boolean) => {
  if (!el) return;
  const v = on ? 'visible' : 'hidden';
  if (el.style.visibility !== v) el.style.visibility = v;
};

const setFlag = (el: HTMLElement, key: string, on: boolean) => {
  const v = on ? 'true' : 'false';
  if (el.dataset[key] !== v) el.dataset[key] = v;
};

const hits = (ax: number, ay: number, aw: number, ah: number, b: Rect) =>
  ax < b.x + b.w + PAD && ax + aw + PAD > b.x && ay < b.y + b.h + PAD && ay + ah + PAD > b.y;

/** Fixed-capacity rect list that reuses its objects between frames. */
class RectPool {
  items: Rect[] = [];
  length = 0;
  reset() {
    this.length = 0;
  }
  push(id: string, x: number, y: number, w: number, h: number) {
    const r = (this.items[this.length] ??= { id: '', x: 0, y: 0, w: 0, h: 0 });
    r.id = id;
    r.x = x;
    r.y = y;
    r.w = w;
    r.h = h;
    this.length++;
    return r;
  }
  /** First rect overlapping the box, skipping `skipId`. */
  find(x: number, y: number, w: number, h: number, skipId?: string): Rect | null {
    for (let i = 0; i < this.length; i++) {
      const r = this.items[i];
      if (r.id !== skipId && hits(x, y, w, h, r)) return r;
    }
    return null;
  }
}

/**
 * rAF loop that positions DOM markers from screen-space projections written
 * by the 3D scene. Anchors sit centred below their target; overlapping
 * anchors move above the target, get pushed down, or are compacted (subtitle
 * hidden via data-compact). Element sizes come from a ResizeObserver, so the
 * loop never reads layout. Writes styles on refs; never sets React state.
 */
export const useScreenMarkers = (source: Record<string, PlanetScreenInfo>, opts: MarkerOptions) => {
  const els = useRef<Record<string, MarkerEls>>({});
  const order = useRef<string[]>([]);
  const sizes = useRef(new Map<HTMLElement, Size>());
  /** Natural (non-compact) anchor size, so compaction does not flicker */
  const full = useRef(new Map<HTMLElement, Size>());
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const ro = useRef<ResizeObserver | null>(null);

  // created in an effect (not render) so StrictMode remounts reconnect it
  useEffect(() => {
    const obs = new ResizeObserver((entries) => {
      for (const e of entries) {
        const el = e.target as HTMLElement;
        const s = { w: el.offsetWidth, h: el.offsetHeight };
        sizes.current.set(el, s);
        if (el.dataset.compact !== 'true') full.current.set(el, s);
      }
    });
    ro.current = obs;
    for (const m of Object.values(els.current)) {
      for (const el of [m.anchor, m.extra, m.edge]) if (el) obs.observe(el);
    }
    return () => {
      obs.disconnect();
      ro.current = null;
    };
  }, []);

  useEffect(() => {
    let raf = 0;
    const ids: string[] = [];
    const discs = new RectPool();
    const placed = new RectPool();
    const edges = new RectPool();

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const { safe, hiddenId, priorityId, edgeY, gap = defaultGap, extent } = optsRef.current;
      const w = window.innerWidth;
      const h = window.innerHeight;
      const prio = priorityId?.current ?? null;

      ids.length = 0;
      if (prio && els.current[prio]) ids.push(prio);
      for (const id of order.current) if (id !== prio && els.current[id]) ids.push(id);

      // other targets' discs are obstacles too, so labels avoid covering them
      discs.reset();
      placed.reset();
      edges.reset();
      for (const id of ids) {
        const i = source[id];
        if (!i?.visible || !Number.isFinite(i.x)) continue;
        const e = extent ? extent(id, i.size) : { x: i.size, y: i.size };
        discs.push(id, i.x - e.x, i.y - e.y, e.x * 2, e.y * 2);
      }

      for (const id of ids) {
        const m = els.current[id];
        const info = source[id];
        if (!info || hiddenId?.current === id || !Number.isFinite(info.x) || !Number.isFinite(info.y)) {
          show(m.anchor, false);
          show(m.edge, false);
          continue;
        }

        if (info.visible) {
          show(m.edge, false);
          const a = m.anchor;
          if (!a) continue;
          const sz = sizes.current.get(a) ?? NO_SIZE;
          const fz = full.current.get(a) ?? sz;
          const aw = Math.max(sz.w, fz.w);
          const ah = fz.h;
          const isPrio = id === prio;
          const ex = isPrio && m.extra ? (sizes.current.get(m.extra) ?? NO_SIZE) : NO_SIZE;
          const exH = ex.h ? ex.h + EXTRA_GAP : 0;

          const x = Math.min(Math.max(info.x - aw / 2, EDGE), w - EDGE - aw);
          const g = gap(info.size);
          const below = info.y + info.size + g;
          const above = info.y - info.size - g - ah;
          const fits = (y: number, hh: number) => y >= safe.top && y + hh <= h - safe.bottom;
          const freeOf = (y: number, hh: number) =>
            !discs.find(x, y, aw, hh, id) && (isPrio || !placed.find(x, y, aw, hh));

          let y = below;
          let up = false;
          let compact = false;
          if (fits(below, ah + exH) && freeOf(below, ah + exH)) y = below;
          else if (fits(above - exH, ah + exH) && freeOf(above - exH, ah + exH)) {
            y = above;
            up = true;
          } else if (!isPrio) {
            // push below whatever it collides with, then fall back to compact
            const clash = placed.find(x, below, aw, ah);
            const pushed = clash ? clash.y + clash.h + PAD : below;
            if (fits(pushed, ah) && freeOf(pushed, ah)) y = pushed;
            else {
              compact = true;
              y = fits(below, ah) || !fits(above, ah) ? below : above;
            }
          }
          const hh = compact ? Math.min(sz.h, ah) : ah;
          placed.push(id, x, y, aw, hh);
          if (exH) {
            // reserve the detail block on the side away from the target
            const exX = Math.min(Math.max(info.x - ex.w / 2, EDGE), w - EDGE - ex.w);
            placed.push(id, exX, up ? y - exH : y + ah + EXTRA_GAP, ex.w, ex.h);
          }
          setFlag(a, 'compact', compact);
          setFlag(a, 'up', up);
          a.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
          show(a, true);
        } else {
          show(m.anchor, false);
          const e = m.edge;
          if (!e) continue;
          const es = sizes.current.get(e) ?? NO_SIZE;
          const side = info.x < w / 2 ? 'left' : 'right';
          const ex = side === 'left' ? info.x : info.x - es.w;
          const baseY = edgeY ? edgeY(h) : info.y;
          const dir = baseY > h / 2 ? -1 : 1;
          // stack edge markers that would overlap, moving away from the nearer screen edge
          let y = baseY;
          for (let n = 0; n < 6 && edges.find(ex, y - es.h / 2, es.w, es.h); n++) y += dir * (es.h + PAD);
          edges.push(id, ex, y - es.h / 2, es.w, es.h);
          // arrow sits on the clamped edge point, the title extends inward
          e.style.transform = `translate3d(${info.x}px, ${y}px, 0) translate(${side === 'left' ? '0' : '-100%'}, -50%)`;
          if (e.dataset.side !== side) e.dataset.side = side;
          // direction from screen centre to the clamped point (y down)
          if (m.arrow) m.arrow.style.transform = `rotate(${Math.atan2(info.y - h / 2, info.x - w / 2)}rad)`;
          show(e, true);
        }
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [source]);

  /** Ref callback factory: ref={bind(id, 'anchor')}. First bind order sets default priority. */
  const bind = (id: string, part: keyof MarkerEls) => (el: HTMLElement | null) => {
    // children attach before parents, so entries are never deleted mid-attach
    const m = (els.current[id] ??= { anchor: null, extra: null, edge: null, arrow: null });
    const prev = m[part];
    if (prev === el) return;
    if (prev && part !== 'arrow') ro.current?.unobserve(prev);
    m[part] = el;
    if (el && part !== 'arrow') ro.current?.observe(el);
    if (el && !order.current.includes(id)) order.current.push(id);
  };

  return bind;
};
