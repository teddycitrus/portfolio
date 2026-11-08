import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { planets, profile } from "@/data/content";
import type { Beacon, Planet } from "@/types/content";
import { useAppStore } from "@/state/useAppStore";
import { TbAlignLeft, TbCode, TbTrophy, TbUser, TbX } from "react-icons/tb";
import type { IconType } from "react-icons";
import "@fontsource-variable/inter/wght.css";
import "@fontsource/commit-mono/400.css";
import "./reader.css";
import {
  AwardProject,
  ProfileBody,
  ProjectBody,
  StackChips,
  linkProps,
} from "./BeaconContent";
import { visitPlanet } from "./navigation";
import { ArrowIcon, EASE, usePresence } from "./primitives";

const sectionId = (id: string) => `reader-${id}`;
const entryId = (id: string) => `reader-entry-${id}`;

const contactLinks = profile.links.filter((l) => l.label !== "Resume");
const resume = profile.links.find((l) => l.label === "Resume");
const ICONS: Record<string, IconType> = {
  about: TbUser,
  projects: TbCode,
  awards: TbTrophy,
};

const SectionBody = ({
  planet,
  onProject,
}: {
  planet: Planet;
  onProject: (beaconId: string) => void;
}) => {
  const b = planet.beacons;
  const projects = b.filter(
    (x): x is Extract<Beacon, { kind: "project" }> => x.kind === "project",
  );
  const profiles = b.filter(
    (x): x is Extract<Beacon, { kind: "profile" }> => x.kind === "profile",
  );
  const awards = b.filter(
    (x): x is Extract<Beacon, { kind: "award" }> => x.kind === "award",
  );
  const skills = b.filter(
    (x): x is Extract<Beacon, { kind: "skills" }> => x.kind === "skills",
  );
  const links = b.filter(
    (x): x is Extract<Beacon, { kind: "link" }> => x.kind === "link",
  );

  return (
    <div className="space-y-10">
      {profiles.map((p) => (
        <article key={p.id} id={entryId(p.id)} className="scroll-mt-32">
          <ProfileBody c={p.content} variant="reader" />
        </article>
      ))}

      {projects.length > 0 && (
        <div className="divide-y divide-[var(--d-line)]">
          {projects.map((p) => (
            <article
              key={p.id}
              id={entryId(p.id)}
              className="scroll-mt-32 py-10 first:pt-0 last:pb-0"
            >
              <ProjectBody c={p.content} variant="reader" />
            </article>
          ))}
        </div>
      )}

      {awards.length > 0 && (
        <ol className="d-card divide-y divide-[var(--d-line)] overflow-hidden">
          {awards.map((a) => (
            <li
              key={a.id}
              id={entryId(a.id)}
              className="d-row scroll-mt-32 space-y-1.5 px-5 py-4"
            >
              <div className="flex items-baseline justify-between gap-4">
                <h3 className="d-strong text-[16px]">{a.content.event}</h3>
                {a.content.year && (
                  <span className="d-meta shrink-0">{a.content.year}</span>
                )}
              </div>
              <p className="d-p">{a.content.result}</p>
              {a.content.project && (
                <p className="flex items-baseline gap-3 pt-1 text-[14px]">
                  <span className="d-meta">Project</span>
                  <AwardProject
                    c={a.content}
                    onProject={(_pid, bid) => onProject(bid)}
                  />
                </p>
              )}
            </li>
          ))}
        </ol>
      )}

      {skills.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {skills.map((s) => (
            <div
              key={s.id}
              id={entryId(s.id)}
              className="d-card scroll-mt-32 space-y-3 p-5"
            >
              <h3 className="d-h3">{s.content.heading}</h3>
              <StackChips
                items={s.content.items}
                label={s.content.heading}
                variant="reader"
              />
            </div>
          ))}
        </div>
      )}

      {links.length > 0 && (
        <ul className="d-card divide-y divide-[var(--d-line)] overflow-hidden">
          {links.map((l) => (
            <li key={l.id} id={entryId(l.id)}>
              <a
                href={l.content.url}
                {...linkProps(l.content.url)}
                className="d-row grid grid-cols-[120px_1fr_auto] items-center gap-4 px-5 py-3.5"
              >
                <span className="d-strong text-[14px]">{l.label}</span>
                <span className="d-mono truncate text-[13px] text-[var(--d-muted)]">
                  {l.content.handle}
                </span>
                <ArrowIcon
                  external={!l.content.url.startsWith("mailto:")}
                  className="h-3.5 w-3.5 text-[var(--d-muted)]"
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
  const noWebGL = useAppStore((s) => s.noWebGL);
  const { mounted, visible } = usePresence(open, 350);
  const [current, setCurrent] = useState<string>(planets[0]?.id ?? "");

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

  // capture where focus was the moment the reader opens (before anything unmounts), restore on close
  useLayoutEffect(() => {
    if (!open) return;
    const a = document.activeElement as HTMLElement | null;
    returnFocus.current = a && a !== document.body ? a : null;
    return () => {
      const el = returnFocus.current;
      returnFocus.current = null;
      if (el && document.contains(el))
        requestAnimationFrame(() => el.focus({ preventScroll: true }));
    };
  }, [open]);
  // focus the dialog once it is actually in the DOM (Tab then reaches Close first)
  useEffect(() => {
    if (open && mounted) dialog.current?.focus({ preventScroll: true });
  }, [open, mounted]);

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
          .sort(
            (a, b) => a.boundingClientRect.top - b.boundingClientRect.top,
          )[0];
        if (hit) setCurrent(hit.target.id.replace("reader-", ""));
      },
      { root: scroller.current, rootMargin: "-30% 0px -60% 0px" },
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
    if (row.scrollLeft > l) row.scrollTo({ left: l, behavior: "smooth" });
    else if (row.scrollLeft < r) row.scrollTo({ left: r, behavior: "smooth" });
  }, [current]);

  if (!mounted) return null;

  const goTo = (id: string) => {
    const el = document.getElementById(id);
    const sc = scroller.current;
    if (el && sc)
      sc.scrollTo({ top: el.offsetTop - topOffset(), behavior: "smooth" });
  };

  // focus trap-lite: keep Tab inside the dialog
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Tab" || !dialog.current) return;
    const items = [
      ...dialog.current.querySelectorAll<HTMLElement>(
        "a[href], button:not([disabled]), iframe",
      ),
    ].filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (
      e.shiftKey &&
      (document.activeElement === first ||
        document.activeElement === dialog.current)
    ) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const currentPlanet = planets.find((p) => p.id === current);

  const entries = currentPlanet?.beacons ?? [];

  return (
    <div
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-label={`${profile.name}, portfolio`}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="docs pointer-events-auto absolute inset-0 z-[60] outline-none"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-black"
        style={{
          opacity: visible ? 1 : 0,
          transition: `opacity 300ms ${EASE}`,
        }}
      />

      <div
        ref={scroller}
        className="scrollbar-thin absolute inset-0 overflow-y-auto overscroll-contain"
        style={{
          opacity: visible ? 1 : 0,
          transform: visible ? "none" : "translateY(8px)",
          transition: `opacity 300ms ${EASE}, transform 400ms ${EASE}`,
        }}
      >
        <header
          className="sticky top-0 z-20 border-b border-[var(--d-line)] bg-black/85 backdrop-blur-md"
          style={{ paddingTop: "env(safe-area-inset-top)" }}
        >
          <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between gap-4 px-[max(20px,env(safe-area-inset-left))] lg:px-[72px]">
            <span className="d-strong text-[16px] tracking-[-0.02em]">
              {profile.name}
            </span>
            <div className="flex items-center gap-2">
              {resume && (
                <a
                  href={resume.url}
                  {...linkProps(resume.url)}
                  className="d-btn d-btn-primary h-9 px-4"
                >
                  Resume
                </a>
              )}
              {!noWebGL && (
                <button
                  type="button"
                  onClick={closeReader}
                  aria-label="Close page"
                  className="d-btn h-9"
                >
                  <TbX className="h-3.5 w-3.5" />
                  Close
                  <span className="hidden md:inline-flex">
                    <span className="d-kbd">Esc</span>
                  </span>
                </button>
              )}
            </div>
          </div>

          {/* section tabs for phones and tablets; the side nav takes over at lg */}
          <nav
            ref={tabs}
            aria-label="Sections"
            className="border-t border-[var(--d-line)] lg:hidden"
          >
            <ol
              ref={tabRow}
              className="scrollbar-thin flex gap-6 overflow-x-auto px-[max(20px,env(safe-area-inset-left))]"
            >
              {planets.map((p) => {
                const Icon = ICONS[p.id] ?? TbAlignLeft;
                return (
                  <li key={p.id} className="shrink-0">
                    <button
                      type="button"
                      onClick={() => goTo(sectionId(p.id))}
                      aria-current={current === p.id ? "true" : undefined}
                      className="d-tab"
                    >
                      <Icon className="h-4 w-4" />
                      {p.title}
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>
        </header>

        <div className="mx-auto grid max-w-[1440px] grid-cols-1 px-[max(20px,env(safe-area-inset-left))] lg:grid-cols-[256px_minmax(0,660px)] lg:gap-9 lg:px-[72px] xl:grid-cols-[256px_minmax(0,660px)_minmax(0,264px)] xl:justify-between">
          <nav aria-label="Sections" className="hidden lg:block">
            <ol className="sticky top-16 space-y-1 pt-10">
              {planets.map((p) => {
                const Icon = ICONS[p.id] ?? TbAlignLeft;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => goTo(sectionId(p.id))}
                      aria-current={current === p.id ? "true" : undefined}
                      className="d-nav-item -ml-3"
                    >
                      <Icon />
                      {p.title}
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>

          <main className="min-w-0 pb-32 pt-10">
            <h1 className="d-h1">{profile.name}</h1>
            <p className="d-p mt-3">
              {profile.location
                ? `${profile.role}, ${profile.location}`
                : profile.role}
            </p>
            <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-2">
              {contactLinks.map((l) => (
                <li key={l.label}>
                  <a
                    href={l.url}
                    {...linkProps(l.url)}
                    className="d-link inline-flex items-center gap-1.5 text-[14px]"
                  >
                    {l.label}
                    <ArrowIcon
                      external={!l.url.startsWith("mailto:")}
                      className="h-3 w-3 text-[var(--d-muted)]"
                    />
                  </a>
                </li>
              ))}
            </ul>

            {planets.map((p) => (
              <section
                key={p.id}
                id={sectionId(p.id)}
                aria-labelledby={`${sectionId(p.id)}-title`}
                className="mt-14 scroll-mt-32 border-t border-[var(--d-line)] pt-10"
              >
                <div className="mb-8 flex items-center justify-between gap-4">
                  <h2 id={`${sectionId(p.id)}-title`} className="d-h2">
                    {p.title}
                  </h2>
                  {!noWebGL && (
                    <button
                      type="button"
                      onClick={() => visitPlanet(p.id)}
                      className="d-btn shrink-0"
                    >
                      Land on the planet
                      <ArrowIcon className="h-3 w-3" />
                    </button>
                  )}
                </div>
                <SectionBody
                  planet={p}
                  onProject={(bid) => goTo(entryId(bid))}
                />
              </section>
            ))}

            <footer className="mt-16 space-y-1 border-t border-[var(--d-line)] pt-6 text-[13px] text-[var(--d-muted)]">
              {noWebGL && (
                <p>The interactive version of this site needs WebGL.</p>
              )}
              <p>
                {profile.name} / {new Date().getFullYear()}
              </p>
            </footer>
          </main>

          <aside aria-label="On this page" className="hidden xl:block">
            <div className="sticky top-16 pt-10">
              <h2 className="mb-2 flex items-center gap-2 text-[14px] font-[580] text-[#d0d0d0]">
                <TbAlignLeft className="h-4 w-4" />
                On this page
              </h2>
              <ul>
                {entries.map((b) => (
                  <li key={b.id}>
                    <button
                      type="button"
                      onClick={() => goTo(entryId(b.id))}
                      className="d-toc-item"
                    >
                      {b.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
};

export default Reader;
