import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { profile } from '@/data/content';
import { useContact } from './contact';
import { linkProps } from './BeaconContent';
import { ArrowIcon, EASE, Kbd, cx, usePresence } from './primitives';

/**
 * Contact, opened from the dash in orbit: every way to reach John on one
 * card. Each row is the link itself; email also copies.
 */
const ContactSheet = () => {
  const open = useContact((s) => s.open);
  const hide = useContact((s) => s.hide);
  const { mounted, visible } = usePresence(open, 260);
  const card = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLElement | null>(null);
  const [copied, setCopied] = useState(false);

  // focus the first link on open, hand focus back on close
  useEffect(() => {
    if (open) {
      back.current = document.activeElement as HTMLElement | null;
      const r = requestAnimationFrame(() => card.current?.querySelector<HTMLElement>('ul a')?.focus({ preventScroll: true }));
      return () => cancelAnimationFrame(r);
    }
    back.current?.focus?.({ preventScroll: true });
    setCopied(false);
  }, [open]);

  // Esc closes before any scene shortcut sees it
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      hide();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, hide]);

  if (!mounted) return null;

  // keep Tab inside the card
  const trap = (e: KeyboardEvent) => {
    if (e.key !== 'Tab' || !card.current) return;
    const items = [...card.current.querySelectorAll<HTMLElement>('a,button')];
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(profile.email);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked: the mailto link still works */
    }
  };

  return (
    <div className="pointer-events-auto fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div
        aria-hidden="true"
        onClick={hide}
        className="absolute inset-0 bg-[#04060b]/60 backdrop-blur-[3px]"
        style={{ opacity: visible ? 1 : 0, transition: `opacity 260ms ${EASE}` }}
      />
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="contact-title"
        onKeyDown={trap}
        className="relative w-full max-w-[440px] select-text overflow-hidden rounded-[14px] border border-white/[0.09] bg-[#0b0f18]/95 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.85)]"
        style={{
          opacity: visible ? 1 : 0,
          transform: visible ? 'none' : 'translateY(10px) scale(0.98)',
          transition: `opacity 260ms ${EASE}, transform 360ms ${EASE}`,
        }}
      >
        <div className="flex items-center justify-between px-6 pb-4 pt-5">
          <h2 id="contact-title" className="font-display text-[22px] leading-none text-ink">
            Contact
          </h2>
          <button
            type="button"
            onClick={hide}
            className="-mr-2 inline-flex h-8 items-center gap-2 rounded-md px-2 text-[12px] text-ink-muted transition-colors duration-200 hover:text-ink"
          >
            Close
            <Kbd>Esc</Kbd>
          </button>
        </div>
        <ul className="border-t border-white/[0.07]">
          {profile.links.map((l) => {
            const mail = l.url.startsWith('mailto:');
            return (
              <li key={l.label} className="group relative flex items-center border-b border-white/[0.07] last:border-b-0">
                <a
                  href={l.url}
                  {...linkProps(l.url)}
                  className="flex min-w-0 flex-1 items-center gap-4 px-6 py-3.5 outline-none transition-colors duration-200 hover:bg-white/[0.035] focus-visible:bg-white/[0.05]"
                >
                  <span className="w-[72px] shrink-0 text-[14px] font-medium text-ink">{l.label}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-ink-muted transition-colors duration-200 group-hover:text-ink/90">
                    {l.handle}
                  </span>
                  {!mail && <ArrowIcon external className="h-3.5 w-3.5 text-ink-muted transition-colors duration-200 group-hover:text-ink" />}
                </a>
                {mail && (
                  <button
                    type="button"
                    onClick={copy}
                    aria-live="polite"
                    className={cx(
                      'mr-4 inline-flex h-7 w-[64px] items-center justify-center rounded-md border text-[12px] transition-colors duration-200',
                      copied
                        ? 'border-emerald-400/40 text-emerald-300'
                        : 'border-white/[0.12] text-ink-muted hover:border-white/25 hover:text-ink',
                    )}
                  >
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
};

export default ContactSheet;
