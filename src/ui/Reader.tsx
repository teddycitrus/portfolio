import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { planets, profile } from '@/data/content';
import type { Beacon, Planet } from '@/types/content';
import { useAppStore } from '@/state/useAppStore';
import { AwardProject, FactGrid, ProjectBody, linkProps } from './BeaconContent';
import { visitPlanet } from './navigation';
import { AccentDot, ArrowIcon, CloseIcon, EASE, SAFE, cx, usePresence } from './primitives';

const sectionId = (id: string) => `reader-${id}`;
const entryId = (id: string) => `reader-entry-${id}`;

const contactLinks = planets
  .flatMap((p) => p.beacons)
  .filter((b): b is Extract<Beacon, { kind: 'link' }> => b.kind === 'link');

const SectionBody = ({ planet, onProject }: { planet: Planet; onProject: (beaconId: string) => void }) => {
  const b = planet.beacons;
  const projects = b.filter((x): x is Extract<Beacon, { kind: 'project' }> => x.kind === 'project');
  const profiles = b.filter((x): x is Extract<Beacon, { kind: 'profile' }> => x.kind === 'profile');
  const awards = b.filter((x): x is Extract<Beacon, { kind: 'award' }> => x.kind === 'award');
  const skills = b.filter((x): x is Extract<Beacon, { kind: 'skills' }> => x.kind === 'skills');
  const links = b.filter((x): x is Extract<Beacon, { kind: 'link' }> => x.kind === 'link');

  return (
    <div className="space-y-12">
      {profiles.length > 0 && (
        <div className="space-y-10">
          {profiles.map((p) => (
            <article key={p.id} id={entryId(p.id)} className="space-y-4">
              <h3 className="font-display text-[26px] font-normal leading-tight text-ink md:text-[28px]">
                {p.content.heading}
              </h3>
              <p className="text-[16px] leading-[1.75] text-ink/85">{p.content.body}</p>
              {p.content.facts && p.content.facts.length > 0 && (
                <div className="pt-2">
                  <FactGrid facts={p.content.facts} />
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {projects.length > 0 && (
        <div className="divide-y divide-line">
          {projects.map((p) => (
            <article key={p.id} id={entryId(p.id)} className="scroll-mt-8 py-10 first:pt-0 last:pb-0">
              <ProjectBody c={p.content} variant="reader" />
            </article>
          ))}
        </div>
      )}

      {awards.length > 0 && (
        <ol className="border-t border-line">
          {awards.map((a) => (
            <li
              key={a.id}
              id={entryId(a.id)}
              className="grid gap-x-8 gap-y-2 border-b border-line py-6 sm:grid-cols-[88px_1fr]"
            >
              <p className="font-mono text-[13px] text-ink-muted sm:pt-1.5">{a.content.year ?? ''}</p>
              <div className="space-y-2">
                <p className="label">{a.content.event}</p>
                <h3 className="font-display text-[26px] font-normal leading-tight text-ink">{a.content.result}</h3>
                <p className="text-[16px] leading-[1.7] text-ink/85">{a.content.description}</p>
                {a.content.project && (
                  <p className="flex items-baseline gap-3 pt-1 text-[14px]">
                    <span className="label">Project</span>
                    <AwardProject c={a.content} onProject={(_pid, bid) => onProject(bid)} />
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}

      {skills.length > 0 && (
        <div className="grid gap-x-10 gap-y-8 sm:grid-cols-2">
          {skills.map((s) => (
            <div key={s.id} id={entryId(s.id)} className="space-y-3">
              <h3 className="label text-ink">{s.content.heading}</h3>
              <ul className="flex flex-wrap gap-2">
                {s.content.items.map((i) => (
                  <li key={i} className="rounded-full border border-line px-3 py-1.5 text-[14px] text-ink">
                    {i}
                  </li>
                ))}
              </ul>
              {s.content.note && <p className="text-[14px] text-ink-muted">{s.content.note}</p>}
            </div>
          ))}
        </div>
      )}

      {links.length > 0 && (
        <ul className="border-t border-line">
          {links.map((l) => (
            <li key={l.id} id={entryId(l.id)}>
              <a
                href={l.content.url}
                {...linkProps(l.content.url)}
                className="group grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-1.5 border-b border-line py-5 sm:grid-cols-[160px_1fr_auto]"
              >
                <span className="col-start-1 row-start-1 font-display text-[24px] leading-none text-ink">
                  {l.label}
                </span>
                <span className="col-span-2 col-start-1 row-start-2 text-[14px] text-ink-muted sm:col-span-1 sm:col-start-2 sm:row-start-1">
                  <span className="block font-mono text-[13px] text-ink transition-colors duration-200 group-hover:text-[var(--accent)]">
                    {l.content.handle}
                  </span>
                  {l.content.description}
                </span>
                <ArrowIcon
                  external={!l.content.url.startsWith('mailto:')}
                  className="col-start-2 row-start-1 h-4 w-4 text-ink-muted transition-[color,transform] duration-200 ease-out group-hover:translate-x-0.5 group-hover:text-[var(--accent)] sm:col-start-3"
                />
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

const Reader = () => {
  const open = useAppStore((s) => s.readerOpen);
  const section = useAppStore((s) => s.readerSection);
  const closeReader = useAppStore((s) => s.closeReader);
  const isTouch = useAppStore((s) => s.isTouch);
  const noWebGL = useAppStore((s) => s.noWebGL);
  const { mounted, visible } = usePresence(open, 350);
  const [current, setCurrent] = useState<string>(planets[0]?.id ?? '');

  const scroller = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const tabs = useRef<HTMLElement>(null);
  const tabRow = useRef<HTMLOListElement>(null);

  /** Space the sticky mobile tabs take at the top of the scroller. */
  const topOffset = () => {
    const t = tabs.current;
    if (!t || t.offsetParent === null) return 24;
    return t.offsetHeight + (parseFloat(getComputedStyle(t).top) || 0) + 16;
  };

  // focus the dialog on open (Tab then reaches Close first), restore on close
  useEffect(() => {
    if (!open) return;
    returnFocus.current = document.activeElement as HTMLElement | null;
    const r = requestAnimationFrame(() => dialog.current?.focus({ preventScroll: true }));
    return () => {
      cancelAnimationFrame(r);
      const el = returnFocus.current;
      if (el && document.contains(el)) el.focus({ preventScroll: true });
    };
  }, [open]);

  // jump to the requested section
  useEffect(() => {
    if (!open || !mounted) return;
    const el = section ? document.getElementById(sectionId(section)) : null;
    const sc = scroller.current;
    if (!sc) return;
    if (el) {
      sc.scrollTop = el.offsetTop - topOffset();
      setCurrent(section!);
    } else sc.scrollTop = 0;
  }, [open, mounted, section]);

  // highlight the section in view
  useEffect(() => {
    if (!mounted || !scroller.current) return;
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (hit) setCurrent(hit.target.id.replace('reader-', ''));
      },
      { root: scroller.current, rootMargin: '-30% 0px -60% 0px' },
    );
    planets.forEach((p) => {
      const el = document.getElementById(sectionId(p.id));
      if (el) io.observe(el);
    });
    return () => io.disconnect();
  }, [mounted]);

  // keep the active mobile tab in view
  useEffect(() => {
    const row = tabRow.current;
    const btn = row?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!row || !btn) return;
    const l = btn.offsetLeft - 16;
    const r = btn.offsetLeft + btn.offsetWidth + 16 - row.clientWidth;
    if (row.scrollLeft > l) row.scrollTo({ left: l, behavior: 'smooth' });
    else if (row.scrollLeft < r) row.scrollTo({ left: r, behavior: 'smooth' });
  }, [current]);

  if (!mounted) return null;

  const goTo = (id: string) => {
    const el = document.getElementById(id);
    const sc = scroller.current;
    if (el && sc) sc.scrollTo({ top: el.offsetTop - topOffset(), behavior: 'smooth' });
  };

  // focus trap-lite: keep Tab inside the dialog
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Tab' || !dialog.current) return;
    const items = [...dialog.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), iframe')].filter(
      (el) => el.offsetParent !== null,
    );
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const currentPlanet = planets.find((p) => p.id === current);

  return (
    <div
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-label={`${profile.name}, portfolio`}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="pointer-events-auto absolute inset-0 z-[60] outline-none"
      style={{ '--accent': currentPlanet?.accent ?? '#e9eef7' } as CSSProperties}
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-space/85 backdrop-blur-md"
        style={{ opacity: visible ? 1 : 0, transition: `opacity 350ms ${EASE}` }}
      />

      {!noWebGL && (
        <>
          {/* keeps the floating Close legible over scrolling text on phones */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-space via-space/80 to-transparent lg:hidden"
            style={{ height: `calc(${SAFE.top} + 64px)`, opacity: visible ? 1 : 0 }}
          />
          <button
            type="button"
            onClick={closeReader}
            aria-label="Close page"
            className="panel absolute z-20 inline-flex h-10 items-center gap-2 rounded-full pl-3.5 pr-4 text-[13px] font-medium text-ink transition-[opacity,border-color] duration-300 ease-out hover:border-[rgba(233,238,247,0.28)]"
            style={{ top: SAFE.top, right: SAFE.right, opacity: visible ? 1 : 0 }}
          >
            <CloseIcon className="h-3.5 w-3.5 text-ink-muted" />
            Close
            {!isTouch && <kbd className="kbd ml-0.5 hidden md:inline-flex">Esc</kbd>}
          </button>
        </>
      )}

      <div
        ref={scroller}
        className="scrollbar-thin absolute inset-0 overflow-y-auto overscroll-contain"
        style={{
          opacity: visible ? 1 : 0,
          transform: visible ? 'none' : 'translateY(12px)',
          transition: `opacity 400ms ${EASE}, transform 500ms ${EASE}`,
        }}
      >
        <div className="relative mx-auto grid max-w-[1120px] grid-cols-1 lg:grid-cols-[180px_minmax(0,720px)] lg:justify-center lg:gap-16">
          <nav aria-label="Sections" className="hidden lg:block">
            <ol className="sticky top-0 space-y-1 pt-[148px]">
              {planets.map((p) => {
                const on = current === p.id;
                return (
                  <li key={p.id} style={{ '--accent': p.accent } as CSSProperties}>
                    <button
                      type="button"
                      onClick={() => goTo(sectionId(p.id))}
                      aria-current={on ? 'true' : undefined}
                      className={cx(
                        'flex w-full items-center gap-3 rounded-md py-1.5 text-left text-[14px] transition-colors duration-200',
                        on ? 'text-ink' : 'text-ink-faint hover:text-ink-muted',
                      )}
                    >
                      <span className="w-5 font-mono text-[11px]">{String(p.index).padStart(2, '0')}</span>{' '}
                      <span>{p.title}</span>
                      <AccentDot className={cx('transition-opacity duration-200', on ? 'opacity-100' : 'opacity-0')} />
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>

          <main
            className={cx(
              'px-[max(24px,env(safe-area-inset-left))] pb-32 md:px-10 lg:px-0 lg:pt-32',
              noWebGL
                ? 'pt-[calc(max(20px,env(safe-area-inset-top))+28px)]'
                : 'pt-[calc(max(20px,env(safe-area-inset-top))+76px)]',
            )}
          >
            <header className="border-line pb-12 lg:border-b">
              <p className="label">
                {profile.location && (
                  <>
                    {profile.location} <span className="text-ink-faint">/</span>{' '}
                  </>
                )}
                {profile.role}
              </p>
              <h1 className="mt-5 font-display text-[56px] font-normal leading-[0.95] tracking-[-0.02em] text-ink md:text-[80px]">
                {profile.name}
              </h1>
              <p className="mt-6 max-w-[38ch] text-[19px] leading-[1.55] text-ink-muted md:text-[21px]">
                {profile.tagline}
              </p>
              <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2">
                {contactLinks.map((l) => (
                  <li key={l.id}>
                    <a
                      href={l.content.url}
                      {...linkProps(l.content.url)}
                      className="inline-flex items-center gap-1.5 text-[14px] text-ink underline decoration-line underline-offset-[5px] transition-colors duration-200 hover:decoration-ink"
                    >
                      {l.label}
                      <ArrowIcon external={!l.content.url.startsWith('mailto:')} className="h-3 w-3 text-ink-muted" />
                    </a>
                  </li>
                ))}
              </ul>
            </header>

            {/* section tabs for phones and tablets; the side nav takes over at lg */}
            <nav
              ref={tabs}
              aria-label="Sections"
              className="sticky z-[5] -mx-[max(24px,env(safe-area-inset-left))] border-y border-line bg-space/80 backdrop-blur-md md:-mx-10 lg:hidden"
              style={{ top: noWebGL ? 0 : `calc(${SAFE.top} + 48px)` }}
            >
              <ol
                ref={tabRow}
                className="scrollbar-thin flex gap-1 overflow-x-auto px-[max(16px,env(safe-area-inset-left))] py-2 md:px-8"
              >
                {planets.map((p) => {
                  const on = current === p.id;
                  return (
                    <li key={p.id} className="shrink-0" style={{ '--accent': p.accent } as CSSProperties}>
                      <button
                        type="button"
                        onClick={() => goTo(sectionId(p.id))}
                        aria-current={on ? 'true' : undefined}
                        className={cx(
                          'flex h-9 items-center gap-2 rounded-full px-3 text-[14px] transition-colors duration-200',
                          on ? 'bg-white/[0.07] text-ink' : 'text-ink-muted',
                        )}
                      >
                        <AccentDot
                          className={cx('transition-opacity duration-200', on ? 'opacity-100' : 'opacity-40')}
                        />
                        {p.title}
                      </button>
                    </li>
                  );
                })}
              </ol>
            </nav>

            {planets.map((p) => (
              <section
                key={p.id}
                id={sectionId(p.id)}
                aria-labelledby={`${sectionId(p.id)}-title`}
                className="border-b border-line py-16 last:border-b-0"
                style={{ '--accent': p.accent } as CSSProperties}
              >
                <div className="mb-10 flex items-end justify-between gap-4">
                  <div>
                    <p className="label flex items-center gap-2.5">
                      <AccentDot />
                      <span>{String(p.index).padStart(2, '0')}</span>
                      <span className="text-ink-faint">/</span>
                      <span>{p.subtitle}</span>
                    </p>
                    <h2
                      id={`${sectionId(p.id)}-title`}
                      className="mt-3 font-display text-[44px] font-normal leading-none text-ink md:text-[52px]"
                    >
                      {p.title}
                    </h2>
                  </div>
                  {!noWebGL && (
                    <button
                      type="button"
                      onClick={() => visitPlanet(p.id)}
                      className="group inline-flex h-9 shrink-0 items-center gap-2 rounded-full border border-line px-3.5 text-[13px] font-medium text-ink-muted transition-colors duration-200 hover:border-[color-mix(in_srgb,var(--accent)_60%,transparent)] hover:text-ink"
                    >
                      Visit planet
                      <ArrowIcon className="text-[var(--accent)] transition-transform duration-200 ease-out group-hover:translate-x-0.5" />
                    </button>
                  )}
                </div>
                <SectionBody planet={p} onProject={(bid) => goTo(entryId(bid))} />
              </section>
            ))}

            <footer className="space-y-2 pt-8 font-mono text-[12px] text-ink-faint">
              {noWebGL && <p>The interactive version needs WebGL.</p>}
              <p>
                {profile.name} / {new Date().getFullYear()}
              </p>
            </footer>
          </main>
        </div>
      </div>
    </div>
  );
};

export default Reader;
