import type { CSSProperties, KeyboardEvent } from 'react';
import { profile } from '@/data/content';
import { useAppStore } from '@/state/useAppStore';
import { ArrowIcon, Button, EASE, Kbd, SAFE, usePresence } from './primitives';

/** Keep Enter/Space on these buttons from reaching the global intro shortcut. */
const ownKeys = (e: KeyboardEvent) => {
  if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
};

const Intro = () => {
  const mode = useAppStore((s) => s.mode);
  const isTouch = useAppStore((s) => s.isTouch);
  const start = useAppStore((s) => s.start);
  const openReader = useAppStore((s) => s.openReader);
  const { mounted, visible } = usePresence(mode === 'intro', 550);
  if (!mounted) return null;

  const leaving = mode !== 'intro';
  const step = (i: number): CSSProperties => ({
    opacity: visible ? 1 : 0,
    transform: visible ? 'none' : leaving ? 'translateY(-8px)' : 'translateY(12px)',
    transition: `opacity ${leaving ? 450 : 700}ms ${EASE} ${leaving ? 0 : 150 + i * 90}ms, transform ${leaving ? 450 : 800}ms ${EASE} ${leaving ? 0 : 150 + i * 90}ms`,
  });

  return (
    <section
      aria-label="Introduction"
      className="pointer-events-none absolute inset-0 z-20 flex flex-col justify-end md:justify-center"
      style={{ paddingLeft: SAFE.left, paddingRight: SAFE.right, paddingTop: SAFE.top, paddingBottom: SAFE.bottom }}
    >
      {/* legibility only: darkens the text side, leaves the planets clear */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[linear-gradient(0deg,rgba(5,7,13,0.92)_0%,rgba(5,7,13,0.6)_40%,transparent_70%)] md:bg-[linear-gradient(90deg,rgba(5,7,13,0.88)_0%,rgba(5,7,13,0.55)_38%,transparent_62%)]"
        style={{ opacity: visible ? 1 : 0, transition: `opacity 700ms ${EASE}` }}
      />

      <div className="relative w-full max-w-[640px] pb-2 md:ml-[clamp(0px,6vw,112px)] md:pb-0">
        <p className="label mb-6 flex flex-wrap gap-x-3" style={step(0)}>
          {profile.location && <span className="max-sm:hidden">{profile.location}</span>}
          {profile.location && (
            <span aria-hidden="true" className="text-ink-faint max-sm:hidden">
              /
            </span>
          )}
          <span>{profile.role}</span>
        </p>
        <h1
          className="font-display text-[clamp(58px,10vw,136px)] font-normal leading-[0.9] tracking-[-0.02em] text-ink"
          style={step(1)}
        >
          {profile.name.split(' ').map((w, i) => (
            <span key={w} className="block" style={i === 1 ? { paddingLeft: '0.04em' } : undefined}>
              {w}
            </span>
          ))}
        </h1>
        <p
          className="mt-6 max-w-[36ch] text-[17px] leading-[1.55] text-ink-muted md:mt-8 md:text-[19px]"
          style={step(2)}
        >
          {profile.tagline}
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3 md:mt-10" style={step(3)}>
          <Button variant="primary" onClick={start} onKeyDown={ownKeys} disabled={leaving}>
            Enter the system
            <ArrowIcon />
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              start();
              openReader();
            }}
            onKeyDown={ownKeys}
            disabled={leaving}
            className="bg-space/40"
          >
            Read as a page
          </Button>
        </div>
        <p
          className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-ink-muted md:mt-12"
          style={step(4)}
        >
          {isTouch ? (
            <>
              <span>Drag to look</span>
              <span aria-hidden="true" className="h-3 w-px bg-white/15" />
              <span>Tap a planet to land</span>
            </>
          ) : (
            <>
              <span>Move the mouse to look</span>
              <span aria-hidden="true" className="h-3 w-px bg-white/15" />
              <span>Click a planet to land</span>
              <span aria-hidden="true" className="h-3 w-px bg-white/15" />
              <span className="inline-flex items-center gap-1.5">
                <Kbd>1</Kbd>
                <span className="text-ink-faint">to</span>
                <Kbd>5</Kbd>
                <span>jump</span>
              </span>
            </>
          )}
        </p>
      </div>
    </section>
  );
};

export default Intro;
