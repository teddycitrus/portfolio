import { useEffect, useRef } from 'react';
import type { PlanetScreenInfo } from '@/state/runtime';

export interface MarkerEls {
  /** Positioned at the projected point when on screen */
  anchor: HTMLElement | null;
  /** Pinned to the viewport edge when off screen */
  edge: HTMLElement | null;
  /** Rotated to point toward the target */
  arrow: HTMLElement | null;
}

export interface MarkerOptions {
  /** Keep-out margins for edge markers so they clear the HUD bars */
  margin: { top: number; right: number; bottom: number; left: number };
  /** Ids to hide entirely (read every frame) */
  hiddenId?: { current: string | null };
  /** Place the anchor on the left of the point when it is near the right edge */
  flip?: boolean;
}

const show = (el: HTMLElement | null, on: boolean) => {
  if (!el) return;
  const v = on ? 'visible' : 'hidden';
  if (el.style.visibility !== v) el.style.visibility = v;
};

/**
 * rAF loop that positions DOM markers from screen-space projections written
 * by the 3D scene. Writes transforms directly on refs; never sets React state.
 */
export const useScreenMarkers = (source: Record<string, PlanetScreenInfo>, opts: MarkerOptions) => {
  const els = useRef<Record<string, MarkerEls>>({});
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const { margin, hiddenId, flip } = optsRef.current;
      const w = window.innerWidth;
      const h = window.innerHeight;
      for (const [id, m] of Object.entries(els.current)) {
        const info = source[id];
        const hidden = !info || hiddenId?.current === id || !Number.isFinite(info.x) || !Number.isFinite(info.y);
        if (hidden) {
          show(m.anchor, false);
          show(m.edge, false);
          continue;
        }
        if (info.visible) {
          show(m.edge, false);
          if (m.anchor) {
            const left = flip && info.x > w * 0.68;
            m.anchor.dataset.side = left ? 'left' : 'right';
            const gap = Math.max(10, info.size * 0.9 + 10);
            m.anchor.style.transform = left
              ? `translate3d(${info.x - gap}px, ${info.y}px, 0) translate(-100%, -50%)`
              : `translate3d(${info.x + (flip ? gap : 0)}px, ${info.y}px, 0) translate(0, -50%)`;
          }
          show(m.anchor, true);
        } else {
          show(m.anchor, false);
          if (m.edge) {
            // direction from screen centre, y down
            const a = Math.atan2(info.y - h / 2, info.x - w / 2);
            const ex = Math.min(Math.max(info.x, margin.left), w - margin.right);
            const ey = Math.min(Math.max(info.y, margin.top), h - margin.bottom);
            const side = info.x < w / 2 ? 'left' : 'right';
            // arrow sits on the edge point, the title extends inward
            m.edge.style.transform = `translate3d(${ex}px, ${ey}px, 0) translate(${side === 'left' ? '0' : '-100%'}, -50%)`;
            m.edge.dataset.side = side;
            if (m.arrow) m.arrow.style.transform = `rotate(${a}rad)`;
          }
          show(m.edge, true);
        }
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [source]);

  /** Ref callback factory: ref={bind(id, 'anchor')} */
  const bind = (id: string, part: keyof MarkerEls) => (el: HTMLElement | null) => {
    const m = (els.current[id] ??= { anchor: null, edge: null, arrow: null });
    m[part] = el;
    if (!m.anchor && !m.edge) delete els.current[id];
  };

  return bind;
};
