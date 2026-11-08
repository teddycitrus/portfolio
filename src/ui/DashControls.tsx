import { useEffect, useRef, type ComponentType, type CSSProperties } from 'react';
import { SiDevpost, SiGithub, SiGmail, SiX } from 'react-icons/si';
import { FaLinkedinIn } from 'react-icons/fa6';
import { PiFileTextBold } from 'react-icons/pi';
import { profile } from '@/data/content';
import { dashPanel } from '@/state/runtime';
import { setSoundEnabled, useSoundEnabled } from '@/audio/drone';
import { linkProps } from './BeaconContent';
import { SAFE, cx } from './primitives';

const ICONS: Record<string, ComponentType<{ className?: string }>> = {
  Email: SiGmail,
  GitHub: SiGithub,
  LinkedIn: FaLinkedinIn,
  Devpost: SiDevpost,
  X: SiX,
  Resume: PiFileTextBold,
};

/** One key cell of the logo strip, in canvas px (the cells on the face are 2:1) */
const CELL_W = 256;
const CELL_H = 128;
/** Logo size within its cell */
const LOGO = 56;

/** Draws the icons into a strip of logos, one per cell, for the cockpit to paint on the console. */
const drawLogos = async (svgs: SVGSVGElement[]) => {
  const c = document.createElement('canvas');
  c.width = CELL_W * svgs.length;
  c.height = CELL_H;
  const g = c.getContext('2d')!;
  await Promise.all(
    svgs.map(async (svg, i) => {
      const src = new XMLSerializer().serializeToString(svg).replace(/currentColor/g, '#fff');
      const img = new Image(LOGO, LOGO);
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(src)}`;
      await img.decode();
      g.drawImage(img, i * CELL_W + (CELL_W - LOGO) / 2, (CELL_H - LOGO) / 2, LOGO, LOGO);
    }),
  );
  return c;
};

/**
 * The console across the dash, under the window: in orbit each of its key
 * cells is a contact link. The logos are painted on the console itself (so
 * they stay put on the dash as the view turns); the links here are invisible
 * keys laid over the cells, each clipped to its cell's outline from the
 * corners the cockpit projects every frame. The hovered or focused cell
 * lights up on the console.
 */
const DashControls = () => {
  const keys = useRef<(HTMLAnchorElement | null)[]>([]);
  const icons = useRef<HTMLDivElement>(null);
  const links = profile.links;

  // the logo strip, drawn once from the same icons
  useEffect(() => {
    const svgs = [...(icons.current?.querySelectorAll('svg') ?? [])].map((s) => {
      const el = s.cloneNode(true) as SVGSVGElement;
      el.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      el.setAttribute('width', String(LOGO));
      el.setAttribute('height', String(LOGO));
      return el;
    });
    let live = true;
    drawLogos(svgs).then(
      (c) => live && (dashPanel.logos = c),
      () => {
        /* no logos: the keys still work */
      },
    );
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    let raf = 0;
    const n = links.length;
    // a point on the face: u across (0..1), v up (0..1)
    const at = (u: number, v: number) => {
      const q = dashPanel.quad;
      const bx = q[0] + (q[2] - q[0]) * u;
      const by = q[1] + (q[3] - q[1]) * u;
      const tx = q[6] + (q[4] - q[6]) * u;
      const ty = q[7] + (q[5] - q[7]) * u;
      return [bx + (tx - bx) * v, by + (ty - by) * v];
    };
    // what the keys were last laid out from: the keys are invisible hit areas, so while the
    // console moves less than half a pixel nothing is recomputed or written
    const last = new Float32Array(8);
    let lastVisible: boolean | null = null;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const q = dashPanel.quad;
      const vis = dashPanel.visible;
      if (vis === lastVisible) {
        if (!vis) return;
        let same = true;
        for (let k = 0; k < 8; k += 1) if (Math.abs(q[k] - last[k]) > 0.5) same = false;
        if (same) return;
      }
      lastVisible = vis;
      last.set(q);
      keys.current.forEach((el, i) => {
        if (!el) return;
        if (!vis) {
          el.style.visibility = 'hidden';
          return;
        }
        const pts = [at(i / n, 0), at((i + 1) / n, 0), at((i + 1) / n, 1), at(i / n, 1)];
        const x0 = Math.min(pts[0][0], pts[1][0], pts[2][0], pts[3][0]);
        const y0 = Math.min(pts[0][1], pts[1][1], pts[2][1], pts[3][1]);
        const x1 = Math.max(pts[0][0], pts[1][0], pts[2][0], pts[3][0]);
        const y1 = Math.max(pts[0][1], pts[1][1], pts[2][1], pts[3][1]);
        el.style.visibility = 'visible';
        el.style.transform = `translate3d(${x0.toFixed(1)}px, ${y0.toFixed(1)}px, 0)`;
        el.style.width = `${(x1 - x0).toFixed(1)}px`;
        el.style.height = `${(y1 - y0).toFixed(1)}px`;
        el.style.clipPath = `polygon(${pts.map(([x, y]) => `${(x - x0).toFixed(1)}px ${(y - y0).toFixed(1)}px`).join(',')})`;
      });
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      dashPanel.hot = -1;
    };
  }, [links.length]);

  return (
    <>
      <nav aria-label="Contact">
        {links.map((l, i) => {
          const mail = l.url.startsWith('mailto:');
          return (
            <a
              key={l.label}
              ref={(el) => {
                keys.current[i] = el;
              }}
              href={l.url}
              {...linkProps(l.url)}
              aria-label={mail ? `Email ${profile.email}` : l.label}
              title={mail ? profile.email : l.label}
              onPointerEnter={() => (dashPanel.hot = i)}
              onPointerLeave={() => dashPanel.hot === i && (dashPanel.hot = -1)}
              onFocus={() => (dashPanel.hot = i)}
              onBlur={() => dashPanel.hot === i && (dashPanel.hot = -1)}
              className="pointer-events-auto absolute left-0 top-0 outline-none"
              style={{ visibility: 'hidden' }}
            />
          );
        })}
      </nav>
      {/* the icons the logo strip is drawn from */}
      <div ref={icons} aria-hidden="true" className="hidden">
        {links.map((l) => {
          const Icon = ICONS[l.label] ?? PiFileTextBold;
          return <Icon key={l.label} />;
        })}
      </div>
      <SoundToggle className="absolute" style={{ left: SAFE.left, bottom: SAFE.bottom }} />
    </>
  );
};

export const SoundToggle = ({ className, style }: { className?: string; style?: CSSProperties }) => {
  const sound = useSoundEnabled();
  return (
    <button
      type="button"
      aria-pressed={sound}
      onClick={() => setSoundEnabled(!sound)}
      className={cx(
        "pointer-events-auto h-9 whitespace-nowrap text-[13px] font-medium text-ink/70 transition-colors duration-200 after:absolute after:-inset-1.5 after:content-[''] hover:text-white",
        className,
      )}
      style={style}
    >
      {sound ? 'Sound on' : 'Sound off'}
    </button>
  );
};

export default DashControls;
