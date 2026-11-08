import { forwardRef, useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';

export const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

/** Edge insets that respect mobile safe areas. */
export const SAFE = {
  top: 'max(20px, env(safe-area-inset-top))',
  bottom: 'max(16px, env(safe-area-inset-bottom))',
  left: 'max(20px, env(safe-area-inset-left))',
  right: 'max(20px, env(safe-area-inset-right))',
} as const;

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

/**
 * Keeps a component mounted for its exit transition.
 * `visible` flips one frame after mount so CSS transitions run on enter.
 */
export const usePresence = (show: boolean, exitMs = 400) => {
  const [mounted, setMounted] = useState(show);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (show) {
      setMounted(true);
      let r2 = 0;
      const r1 = requestAnimationFrame(() => {
        r2 = requestAnimationFrame(() => setVisible(true));
      });
      return () => {
        cancelAnimationFrame(r1);
        cancelAnimationFrame(r2);
      };
    }
    setVisible(false);
    const t = window.setTimeout(() => setMounted(false), exitMs);
    return () => window.clearTimeout(t);
  }, [show, exitMs]);
  return { mounted, visible };
};

const useMedia = (query: string) => {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
};

/**
 * Sheet layout: phones and tablet portrait. Short landscape screens at least
 * 700px wide keep a (narrower) side panel so the scene stays visible.
 */
export const useNarrow = () => useMedia('(max-width: 699px), (orientation: portrait) and (max-width: 1024px)');
/** Landscape phones and other very short viewports. */
export const useShort = () => useMedia('(max-height: 500px)');
/**
 * Beacon content goes in the DOM sheet or side panel rather than on in-world
 * screens: phones, tablet portrait, and short screens, where the screens
 * would be scaled down past reading size.
 */
export const usePanelView = () =>
  useMedia('(max-width: 699px), (orientation: portrait) and (max-width: 1024px), (max-height: 500px)');
/** Phones too narrow for the dock and the sound toggle to share the bottom row. */
export const useTiny = () => useMedia('(max-width: 399px)');

/** Shadow that keeps bare text legible over bright skies and planets. */
export const FLOAT_TEXT = '[text-shadow:0_1px_2px_rgba(5,7,13,0.9),0_0_14px_rgba(5,7,13,0.75)]';
/** Labels drawn over the scene (planets, beacons, edge markers): bare text, no surface. */
export const IN_WORLD = FLOAT_TEXT;

/**
 * Display type scale (Archivo expanded): 64 / 44 / 32 / 26 / 22 / 18.
 * Only these sizes are used for display text.
 */
export const DISPLAY = {
  // the expanded cut sets wider than the old serif, so the scale steps down
  d80: 'text-[40px] md:text-[64px]',
  d52: 'text-[32px] md:text-[44px]',
  d40: 'text-[26px] md:text-[32px]',
  d32: 'text-[26px]',
  d24: 'text-[22px]',
  d20: 'text-[18px]',
} as const;

type Variant = 'primary' | 'panel' | 'ghost';

/** Every variant is bare text; primary is underlined so content CTAs still read as the main action. */
const VARIANTS: Record<Variant, string> = {
  primary: 'text-ink underline decoration-white/35 underline-offset-[6px] hover:text-white hover:decoration-white',
  panel: cx('text-ink/85 hover:text-white', FLOAT_TEXT),
  ghost: 'text-ink/85 hover:text-white',
};

/** Button look for anchors and buttons alike. HUD controls are sm (h-9), content CTAs md (h-11). */
export const buttonClass = (variant: Variant = 'panel', size: 'sm' | 'md' = 'md') =>
  cx(
    'pointer-events-auto inline-flex select-none items-center gap-2.5 whitespace-nowrap font-medium transition-[color,text-decoration-color,opacity] duration-200 ease-out',
    // sm controls are 36px tall; an invisible margin brings the touch target past 44px
    size === 'md' ? 'h-11 text-[14px]' : "relative h-9 px-2 text-[13px] after:absolute after:-inset-1.5 after:content-['']",
    VARIANTS[variant],
  );

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md';
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'panel', size = 'md', className, children, ...rest }, ref) => (
    <button ref={ref} type="button" {...rest} className={cx(buttonClass(variant, size), className)}>
      {children}
    </button>
  ),
);
Button.displayName = 'Button';

/** Controls hint line on the planet surface. */
export const HintRow = ({ items, className }: { items: ReactNode[]; className?: string }) => (
  <p className={cx('flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-ink-muted', className)}>
    {items.map((item, i) => (
      <span key={i} className="inline-flex items-center gap-4">
        {i > 0 && <span aria-hidden="true" className="h-3 w-px bg-white/15" />}
        <span className="inline-flex items-center gap-1.5">{item}</span>
      </span>
    ))}
  </p>
);

export const Kbd = ({ children, className }: { children: ReactNode; className?: string }) => (
  <kbd className={cx('kbd', className)}>{children}</kbd>
);

/** Tech names (stack and skills) everywhere: plain sans 13px. */
export const Chip = ({ children, className }: { children: ReactNode; className?: string }) => (
  <span className={cx('inline-flex items-center text-[13px] leading-none text-ink/90', className)}>{children}</span>
);

interface IconProps {
  className?: string;
}

/** Right arrow; `external` tilts it up-right. */
export const ArrowIcon = ({ className, external }: IconProps & { external?: boolean }) => (
  <svg
    aria-hidden="true"
    viewBox="0 0 16 16"
    className={cx('h-3.5 w-3.5 shrink-0', className)}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={external ? { transform: 'rotate(-45deg)' } : undefined}
  >
    <path d="M2.5 8h11M9 3.5 13.5 8 9 12.5" />
  </svg>
);

export const BackIcon = ({ className }: IconProps) => (
  <svg
    aria-hidden="true"
    viewBox="0 0 16 16"
    className={cx('h-3.5 w-3.5 shrink-0', className)}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M13.5 8h-11M7 3.5 2.5 8 7 12.5" />
  </svg>
);

export const CloseIcon = ({ className }: IconProps) => (
  <svg
    aria-hidden="true"
    viewBox="0 0 16 16"
    className={cx('h-4 w-4 shrink-0', className)}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
  >
    <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
  </svg>
);

/** Chevron pointing right; rotate it for direction. */
export const ChevronIcon = ({ className }: IconProps) => (
  <svg
    aria-hidden="true"
    viewBox="0 0 16 16"
    className={cx('h-3.5 w-3.5 shrink-0', className)}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M6 3.5 10.5 8 6 12.5" />
  </svg>
);

export const PageIcon = ({ className }: IconProps) => (
  <svg
    aria-hidden="true"
    viewBox="0 0 16 16"
    className={cx('h-3.5 w-3.5 shrink-0', className)}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    strokeLinecap="round"
  >
    <path d="M4 2.5h8v11H4zM6 5.5h4M6 8h4M6 10.5h2.5" />
  </svg>
);

export const MailIcon = ({ className }: IconProps) => (
  <svg
    aria-hidden="true"
    viewBox="0 0 16 16"
    className={cx('h-3.5 w-3.5 shrink-0', className)}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    strokeLinejoin="round"
  >
    <path d="M2.5 4h11v8h-11zM2.5 4.5 8 9l5.5-4.5" />
  </svg>
);

/** Slightly larger HUD on very wide screens; set by UiRoot as --hud-zoom. */
export const HUD_ZOOM = '[zoom:var(--hud-zoom,1)]';

export const PlayIcon = ({ className }: IconProps) => (
  <svg aria-hidden="true" viewBox="0 0 16 16" className={cx('h-4 w-4 shrink-0', className)} fill="currentColor">
    <path d="M5 3.2v9.6L12.6 8z" />
  </svg>
);

export const KIND_LABEL = {
  profile: 'Profile',
  project: 'Project',
  award: 'Award',
  skills: 'Skills',
  link: 'Link',
} as const;
