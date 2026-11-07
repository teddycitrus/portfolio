import { useEffect, useRef, useState, type ComponentType } from 'react';
import { SiDevpost, SiGithub, SiGmail, SiX } from 'react-icons/si';
import { FaLinkedinIn } from 'react-icons/fa6';
import { PiFileTextBold } from 'react-icons/pi';
import { profile } from '@/data/content';
import { dashPanel } from '@/state/runtime';
import { setSoundEnabled, useSoundEnabled } from '@/audio/drone';
import { linkProps } from './BeaconContent';
import { SAFE, cx } from './primitives';

/** Gap kept from the viewport edge */
const EDGE = 8;
/** The console never gets shorter than this, even when the dash is small on screen */
const MIN_H = 44;
/** Keys narrower than this show only the logo */
const LABEL_MIN_W = 96;

const ICONS: Record<string, ComponentType<{ className?: string }>> = {
  Email: SiGmail,
  GitHub: SiGithub,
  LinkedIn: FaLinkedinIn,
  Devpost: SiDevpost,
  X: SiX,
  Resume: PiFileTextBold,
};

/**
 * The console across the dash, under the window: in orbit each of its keys is
 * a contact link (the logo, and the name when there is room). The keys follow
 * the console's screen rect, which the cockpit publishes every frame, and
 * light the cell they sit on when hovered. Email also copies the address.
 */
const DashControls = () => {
  const row = useRef<HTMLDivElement>(null);
  const sound = useSoundEnabled();
  const [labels, setLabels] = useState(true);
  const [copied, setCopied] = useState(false);
  const links = profile.links;

  useEffect(() => {
    let raf = 0;
    let wide = true;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const el = row.current;
      const d = dashPanel;
      if (!el) return;
      if (!d.visible) {
        el.style.visibility = 'hidden';
        return;
      }
      const w = Math.min(window.innerWidth - EDGE * 2, d.w);
      const h = Math.max(MIN_H, d.h);
      const x = Math.min(window.innerWidth - w - EDGE, Math.max(EDGE, d.x + d.w / 2 - w / 2));
      el.style.visibility = 'visible';
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${(d.y + d.h / 2 - h / 2).toFixed(1)}px, 0)`;
      el.style.width = `${w.toFixed(1)}px`;
      el.style.height = `${h.toFixed(1)}px`;
      const fits = w / links.length >= LABEL_MIN_W;
      if (fits !== wide) setLabels((wide = fits));
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      dashPanel.hot = -1;
    };
  }, [links.length]);

  const copy = () => {
    navigator.clipboard?.writeText(profile.email).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      },
      () => {
        /* clipboard blocked: the mail link still opens */
      },
    );
  };

  return (
    <>
      <nav
        ref={row}
        aria-label="Contact"
        className="pointer-events-auto absolute left-0 top-0 grid"
        style={{ visibility: 'hidden', gridTemplateColumns: `repeat(${links.length}, minmax(0, 1fr))` }}
      >
        {links.map((l, i) => {
          const Icon = ICONS[l.label] ?? PiFileTextBold;
          const mail = l.url.startsWith('mailto:');
          const text = mail && copied ? 'Copied' : l.label;
          return (
            <a
              key={l.label}
              href={l.url}
              {...linkProps(l.url)}
              onClick={mail ? copy : undefined}
              aria-label={mail ? `Email ${profile.email}` : l.label}
              title={mail ? profile.email : l.handle}
              onPointerEnter={() => (dashPanel.hot = i)}
              onPointerLeave={() => dashPanel.hot === i && (dashPanel.hot = -1)}
              onFocus={() => (dashPanel.hot = i)}
              onBlur={() => dashPanel.hot === i && (dashPanel.hot = -1)}
              className={cx(
                'dash-key flex min-w-0 items-center justify-center gap-2.5 rounded-[6px]',
                'font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-[#a9dcff]',
                'outline-none transition-[color,text-shadow,transform] duration-150 hover:text-white focus-visible:text-white active:scale-[0.96]',
              )}
            >
              <Icon className="h-[17px] w-[17px] shrink-0" />
              {labels && <span className="truncate">{text}</span>}
            </a>
          );
        })}
      </nav>
      <button
        type="button"
        aria-pressed={sound}
        onClick={() => setSoundEnabled(!sound)}
        className="pointer-events-auto absolute h-9 text-[13px] font-medium text-ink/70 transition-colors duration-200 hover:text-white"
        style={{ left: SAFE.left, bottom: SAFE.bottom }}
      >
        {sound ? 'Sound on' : 'Sound off'}
      </button>
    </>
  );
};

export default DashControls;
