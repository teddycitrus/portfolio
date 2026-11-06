import type { ReactNode } from 'react';
import type { Beacon } from '@/types/content';
import {
  Aside,
  AwardProject,
  Body,
  Heading,
  Highlights,
  LinkButtons,
  MetaLine,
  StackChips,
  VideoEmbed,
  linkProps,
} from './BeaconContent';
import { ArrowIcon, buttonClass, cx } from './primitives';
import { visitPlanet } from './navigation';

/** One in-world screen: a single part of a beacon's content. */
export interface ScreenPart {
  key: string;
  /** Content width in CSS px */
  width: number;
  node: ReactNode;
}

const NARROW = 380;
const WIDE = 440;

/** Splits a beacon's content into the parts shown on its screens, title first. */
export const screenParts = (beacon: Beacon): ScreenPart[] => {
  const v = 'panel' as const;
  switch (beacon.kind) {
    case 'profile': {
      const c = beacon.content;
      const parts: ScreenPart[] = [
        {
          key: 'title',
          width: NARROW,
          node: (
            <div className="space-y-3">
              <Heading variant={v}>{c.heading}</Heading>
              {c.meta && c.meta.length > 0 && <MetaLine items={c.meta} />}
            </div>
          ),
        },
        { key: 'body', width: WIDE, node: <Body variant={v}>{c.body}</Body> },
      ];
      if (c.highlights?.length) parts.push({ key: 'hl', width: WIDE, node: <Highlights items={c.highlights} variant={v} /> });
      if (c.aside) parts.push({ key: 'aside', width: NARROW, node: <Aside {...c.aside} bare /> });
      return parts;
    }
    case 'project': {
      const c = beacon.content;
      const parts: ScreenPart[] = [
        {
          key: 'title',
          width: NARROW,
          node: (
            <div className="space-y-3">
              <Heading variant={v}>{c.heading}</Heading>
              <MetaLine
                items={[
                  c.period,
                  c.team && 'Team',
                  c.award && <span className="text-[var(--accent)]">{c.award}</span>,
                ].filter(Boolean)}
              />
            </div>
          ),
        },
      ];
      if (c.videoId)
        parts.push({ key: 'video', width: 480, node: <VideoEmbed videoId={c.videoId} title={c.heading} poster={c.poster} /> });
      parts.push({ key: 'desc', width: WIDE, node: <Body variant={v}>{c.description}</Body> });
      if (c.highlights.length) parts.push({ key: 'hl', width: WIDE, node: <Highlights items={c.highlights} variant={v} /> });
      if (c.stack.length || c.links.length)
        parts.push({
          key: 'stack',
          width: NARROW,
          node: (
            <div className="space-y-5">
              {c.stack.length > 0 && <StackChips items={c.stack} />}
              {c.links.length > 0 && <LinkButtons links={c.links} />}
            </div>
          ),
        });
      return parts;
    }
    case 'award': {
      const c = beacon.content;
      // event and result read as one line of thought; the project link gets its own screen
      const parts: ScreenPart[] = [
        {
          key: 'title',
          width: NARROW,
          node: (
            <div className="space-y-3">
              <Heading variant={v}>{c.event}</Heading>
              <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-[17px] text-ink">{c.result}</span>
                {c.year && <span className="label">{c.year}</span>}
              </p>
            </div>
          ),
        },
      ];
      if (c.project)
        parts.push({
          key: 'project',
          width: 320,
          node: (
            <p className="flex items-baseline gap-3 text-[14px]">
              <span className="label">Project</span>
              <AwardProject c={c} onProject={(pid, bid) => visitPlanet(pid, bid, true)} />
            </p>
          ),
        });
      return parts;
    }
    case 'skills': {
      const c = beacon.content;
      return [
        { key: 'title', width: NARROW, node: <Heading variant={v}>{c.heading}</Heading> },
        { key: 'items', width: WIDE, node: <StackChips items={c.items} label="Skills" /> },
      ];
    }
    case 'link': {
      const c = beacon.content;
      const mail = c.url.startsWith('mailto:');
      return [
        {
          key: 'title',
          width: NARROW,
          node: (
            <div className="space-y-2">
              <Heading variant={v}>{beacon.label}</Heading>
              <p className="break-all font-mono text-[13px] text-[var(--accent)]">{c.handle}</p>
            </div>
          ),
        },
        {
          key: 'open',
          width: 320,
          node: (
            <a href={c.url} {...linkProps(c.url)} className={cx(buttonClass('primary', 'md'), 'w-full justify-between')}>
              {mail ? 'Write an email' : `Open ${beacon.label}`}
              <ArrowIcon external={!mail} className="h-4 w-4" />
            </a>
          ),
        },
      ];
    }
  }
};
