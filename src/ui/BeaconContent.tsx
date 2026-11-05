import { useState, type ReactNode } from 'react';
import type {
  AwardContent,
  Beacon,
  ExternalLink,
  Fact,
  LinkContent,
  ProfileContent,
  ProjectContent,
  SkillsContent,
} from '@/types/content';
import { ArrowIcon, Chip, DISPLAY, PlayIcon, buttonClass, cx } from './primitives';
import { findProjectBeacon } from './navigation';

/** Reader entry headings share one size across every kind; the panel title is 32 too. */
export const ENTRY_HEADING = cx('font-display font-normal leading-[1.05] tracking-[-0.01em] text-ink', DISPLAY.d32);

/**
 * Shared content renderers for the beacon panel and the reader page so a
 * piece of content reads the same in both places.
 */
export type Variant = 'panel' | 'reader';

const isMail = (url: string) => url.startsWith('mailto:');
export const linkProps = (url: string) => (isMail(url) ? {} : { target: '_blank', rel: 'noreferrer' });

const Heading = ({ variant, children, className }: { variant: Variant; children: ReactNode; className?: string }) => {
  const cls = cx(ENTRY_HEADING, className);
  return variant === 'panel' ? (
    <h2 tabIndex={-1} data-panel-heading className={cx(cls, 'scroll-mt-4')}>
      {children}
    </h2>
  ) : (
    <h3 className={cls}>{children}</h3>
  );
};

const Body = ({ children, variant }: { children: ReactNode; variant: Variant }) => (
  <p className={cx('text-ink/85', variant === 'panel' ? 'text-[15px] leading-[1.65]' : 'text-[16px] leading-[1.7]')}>
    {children}
  </p>
);

const MetaLine = ({ items }: { items: ReactNode[] }) => (
  <p className="label flex flex-wrap items-center gap-x-3 gap-y-1">
    {items.map((m, i) => (
      <span key={i}>{m}</span>
    ))}
  </p>
);

const Highlights = ({ items, variant }: { items: string[]; variant: Variant }) => (
  <ul className="space-y-2.5">
    {items.map((h) => (
      <li
        key={h}
        className={cx(
          'flex gap-3 text-ink/85',
          variant === 'panel' ? 'text-[14px] leading-[1.6]' : 'text-[15px] leading-[1.65]',
        )}
      >
        <span aria-hidden="true" className="mt-[0.8em] h-px w-3 shrink-0 bg-[var(--accent)]" />
        <span>{h}</span>
      </li>
    ))}
  </ul>
);

/** Compact closing block: a small label, then the numbers inline. */
const Aside = ({ heading, facts }: { heading: string; facts: Fact[] }) => (
  <section className="space-y-2 border-t border-line pt-4">
    <h4 className="label">{heading}</h4>
    <dl className="flex flex-wrap gap-x-8 gap-y-2">
      {facts.map((f) => (
        <div key={f.label} className="flex items-baseline gap-2">
          <dt className="text-[13px] text-ink-muted">{f.label}</dt>
          <dd className="text-[15px] font-medium text-ink">{f.value}</dd>
        </div>
      ))}
    </dl>
  </section>
);

export const StackChips = ({ items, label = 'Stack' }: { items: string[]; label?: string }) => (
  <ul className="flex flex-wrap gap-x-4 gap-y-2.5" aria-label={label}>
    {items.map((s) => (
      <li key={s}>
        <Chip>{s}</Chip>
      </li>
    ))}
  </ul>
);

export const LinkButtons = ({ links }: { links: ExternalLink[] }) => (
  <div className="flex flex-wrap gap-x-6">
    {links.map((l) => (
      <a key={l.url} href={l.url} {...linkProps(l.url)} className={buttonClass('ghost', 'md')}>
        {l.label}
        <ArrowIcon external={!isMail(l.url)} />
      </a>
    ))}
  </div>
);

/** Poster first; the iframe only loads after a click. */
export const VideoEmbed = ({ videoId, title, poster }: { videoId: string; title: string; poster?: string }) => {
  const [play, setPlay] = useState(false);
  // custom poster, then YouTube's max-res frame, then the always-present hq frame
  const sources = [
    poster,
    `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
    `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  ].filter((x): x is string => !!x);
  const [src, setSrc] = useState(0);
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-line bg-space-800">
      {play ? (
        <iframe
          className="absolute inset-0 h-full w-full"
          src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`}
          title={`${title} demo video`}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      ) : (
        <button
          type="button"
          onClick={() => setPlay(true)}
          className="group absolute inset-0 h-full w-full"
          aria-label={`Play ${title} demo video`}
        >
          <img
            src={sources[src]}
            onError={() => setSrc((i) => Math.min(i + 1, sources.length - 1))}
            onLoad={(e) => {
              // YouTube serves a 120px grey placeholder instead of a 404 for missing max-res frames
              if (e.currentTarget.naturalWidth <= 120 && src < sources.length - 1) setSrc(src + 1);
            }}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover opacity-80 transition-opacity duration-300 ease-out group-hover:opacity-100"
          />
          <span className="absolute inset-0 bg-gradient-to-t from-space/70 via-transparent to-transparent" />
          <span className="absolute bottom-3 left-3 inline-flex h-9 items-center gap-2 rounded-full bg-ink pl-3 pr-4 text-[13px] font-medium text-space">
            <PlayIcon className="h-3.5 w-3.5" />
            Watch demo
          </span>
        </button>
      )}
    </div>
  );
};

export const ProfileBody = ({ c, variant }: { c: ProfileContent; variant: Variant }) => (
  <div className="space-y-5">
    <div className="space-y-3">
      <Heading variant={variant}>{c.heading}</Heading>
      {c.meta && c.meta.length > 0 && <MetaLine items={c.meta} />}
    </div>
    <Body variant={variant}>{c.body}</Body>
    {c.highlights && c.highlights.length > 0 && <Highlights items={c.highlights} variant={variant} />}
    {c.aside && <Aside {...c.aside} />}
  </div>
);

export const ProjectBody = ({ c, variant }: { c: ProjectContent; variant: Variant }) => (
  <div className="space-y-5">
    <div className="space-y-3">
      <Heading variant={variant}>{c.heading}</Heading>
      {/* one compact meta line: when, and what it won */}
      <MetaLine
        items={[
          c.period,
          c.team && 'Team',
          c.award && <span className="text-[var(--accent)]">{c.award}</span>,
        ].filter(Boolean)}
      />
    </div>
    {c.videoId && <VideoEmbed videoId={c.videoId} title={c.heading} poster={c.poster} />}
    <Body variant={variant}>{c.description}</Body>
    {c.highlights.length > 0 && <Highlights items={c.highlights} variant={variant} />}
    {c.stack.length > 0 && <StackChips items={c.stack} />}
    {c.links.length > 0 && <LinkButtons links={c.links} />}
  </div>
);

interface AwardProps {
  c: AwardContent;
  variant: Variant;
  /** Called with the project beacon when the award's project is clicked */
  onProject?: (planetId: string, beaconId: string) => void;
}

export const AwardProject = ({ c, onProject }: Pick<AwardProps, 'c' | 'onProject'>) => {
  if (!c.project) return null;
  const match = findProjectBeacon(c.project);
  if (!match || !onProject) return <span className="text-ink">{c.project}</span>;
  return (
    <button
      type="button"
      onClick={() => onProject(match.planetId, match.beacon.id)}
      className="inline-flex items-center gap-1.5 text-ink underline decoration-line underline-offset-4 transition-colors duration-200 ease-out hover:text-[var(--accent)] hover:decoration-[var(--accent)]"
    >
      {c.project}
      <ArrowIcon />
    </button>
  );
};

export const AwardBody = ({ c, variant, onProject }: AwardProps) => (
  <div className="space-y-4">
    <Heading variant={variant}>{c.event}</Heading>
    <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="text-[17px] text-ink">{c.result}</span>
      {c.year && <span className="label">{c.year}</span>}
    </p>
    {c.project && (
      <p className="flex items-baseline gap-3 border-t border-line pt-4 text-[14px]">
        <span className="label">Project</span>
        <AwardProject c={c} onProject={onProject} />
      </p>
    )}
  </div>
);

export const SkillsBody = ({ c, variant }: { c: SkillsContent; variant: Variant }) => (
  <div className="space-y-5">
    <Heading variant={variant}>{c.heading}</Heading>
    <StackChips items={c.items} label="Skills" />
  </div>
);

export const LinkBody = ({ label, c, variant }: { label: string; c: LinkContent; variant: Variant }) => (
  <div className="space-y-5">
    <div className="space-y-2">
      <Heading variant={variant}>{label}</Heading>
      <p className="break-all font-mono text-[13px] text-[var(--accent)]">{c.handle}</p>
    </div>
    <a href={c.url} {...linkProps(c.url)} className={cx(buttonClass('primary', 'md'), 'w-full justify-between')}>
      {isMail(c.url) ? 'Write an email' : `Open ${label}`}
      <ArrowIcon external={!isMail(c.url)} className="h-4 w-4" />
    </a>
  </div>
);

export const BeaconBody = ({
  beacon,
  variant,
  onProject,
}: {
  beacon: Beacon;
  variant: Variant;
  onProject?: AwardProps['onProject'];
}) => {
  switch (beacon.kind) {
    case 'profile':
      return <ProfileBody c={beacon.content} variant={variant} />;
    case 'project':
      return <ProjectBody c={beacon.content} variant={variant} />;
    case 'award':
      return <AwardBody c={beacon.content} variant={variant} onProject={onProject} />;
    case 'skills':
      return <SkillsBody c={beacon.content} variant={variant} />;
    case 'link':
      return <LinkBody label={beacon.label} c={beacon.content} variant={variant} />;
  }
};
