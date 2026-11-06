import { useEffect, useRef } from 'react';
import { dashScreens } from '@/state/runtime';
import { setSoundEnabled, useSoundEnabled } from '@/audio/drone';
import { useTour } from './tour';
import { useContact } from './contact';
import { MailIcon, PlayIcon, SAFE, cx } from './primitives';

/** A control never shrinks below this, even when the display is small on screen */
const MIN_W = 96;
const MIN_H = 40;
/** Gap kept from the viewport edge */
const EDGE = 8;

const KEYS = ['tour', 'contact'] as const;

/**
 * The two displays on the dash read as console buttons in orbit: the left one
 * starts the tour, the right one opens contact. The buttons follow the
 * displays' screen rects, which the cockpit publishes every frame.
 */
const DashControls = () => {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const sound = useSoundEnabled();

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      KEYS.forEach((k, i) => {
        const el = refs.current[i];
        const d = dashScreens[k];
        if (!el) return;
        if (!d.visible) {
          el.style.visibility = 'hidden';
          return;
        }
        const w = Math.max(MIN_W, d.w);
        const h = Math.max(MIN_H, d.h);
        el.style.visibility = 'visible';
        // the displays sit near the edges on phones: keep the whole control on screen
        const x = Math.min(window.innerWidth - w - EDGE, Math.max(EDGE, d.x + d.w / 2 - w / 2));
        el.style.transform = `translate3d(${x.toFixed(1)}px, ${(d.y + d.h / 2 - h / 2).toFixed(1)}px, 0)`;
        el.style.width = `${w.toFixed(1)}px`;
        el.style.height = `${h.toFixed(1)}px`;
      });
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      KEYS.forEach((k) => (dashScreens[k].hover = false));
    };
  }, []);

  const items = [
    { key: 'tour' as const, label: 'Tour', icon: <PlayIcon className="h-3 w-3" />, onClick: () => useTour.getState().start() },
    { key: 'contact' as const, label: 'Contact', icon: <MailIcon className="h-3.5 w-3.5" />, onClick: () => useContact.getState().show() },
  ];

  return (
    <>
      {items.map((it, i) => (
        <button
          key={it.key}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          onClick={it.onClick}
          onPointerEnter={() => (dashScreens[it.key].hover = true)}
          onPointerLeave={() => (dashScreens[it.key].hover = false)}
          onFocus={() => (dashScreens[it.key].hover = true)}
          onBlur={() => (dashScreens[it.key].hover = false)}
          className={cx(
            'dash-key pointer-events-auto absolute left-0 top-0 flex items-center justify-center gap-2 rounded-[6px]',
            'font-mono text-[12px] font-medium uppercase tracking-[0.18em] text-[#a9dcff]',
            'outline-none transition-[color,text-shadow] duration-200 hover:text-white focus-visible:text-white',
          )}
          style={{ visibility: 'hidden' }}
        >
          {it.icon}
          {it.label}
        </button>
      ))}
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
