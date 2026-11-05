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

/** True below the md breakpoint (768px). */
export const useNarrow = () => {
  const query = '(max-width: 767px)';
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return narrow;
};

type Variant = 'primary' | 'panel' | 'ghost';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-ink text-space hover:bg-white',
  panel: 'panel text-ink hover:border-[rgba(233,238,247,0.28)]',
  ghost: 'border border-line text-ink hover:border-[rgba(233,238,247,0.32)] hover:bg-white/[0.04]',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md';
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ variant = 'panel', size = 'md', className, children, ...rest }, ref) => (
  <button
    ref={ref}
    type="button"
    {...rest}
    className={cx(
      'pointer-events-auto inline-flex select-none items-center gap-2.5 whitespace-nowrap rounded-full font-medium transition-[background-color,border-color,color,opacity] duration-200 ease-out',
      size === 'md' ? 'h-11 px-5 text-[14px]' : 'h-9 px-3.5 text-[13px]',
      VARIANTS[variant],
      className,
    )}
  >
    {children}
  </button>
));
Button.displayName = 'Button';

export const Kbd = ({ children, className }: { children: ReactNode; className?: string }) => (
  <kbd className={cx('kbd', className)}>{children}</kbd>
);

export const AccentDot = ({ color, className, glow }: { color?: string; className?: string; glow?: boolean }) => (
  <span
    aria-hidden="true"
    className={cx('inline-block h-1.5 w-1.5 shrink-0 rounded-full', className)}
    style={{
      background: color ?? 'var(--accent)',
      boxShadow: glow ? `0 0 0 3px color-mix(in srgb, ${color ?? 'var(--accent)'} 22%, transparent)` : undefined,
    }}
  />
);

export const Chip = ({ children, className }: { children: ReactNode; className?: string }) => (
  <span
    className={cx(
      'inline-flex items-center rounded-full border border-line px-2.5 py-1 font-mono text-[12px] leading-none text-ink-muted',
      className,
    )}
  >
    {children}
  </span>
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
  <svg aria-hidden="true" viewBox="0 0 16 16" className={cx('h-3.5 w-3.5 shrink-0', className)} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M13.5 8h-11M7 3.5 2.5 8 7 12.5" />
  </svg>
);

export const CloseIcon = ({ className }: IconProps) => (
  <svg aria-hidden="true" viewBox="0 0 16 16" className={cx('h-4 w-4 shrink-0', className)} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
  </svg>
);

/** Chevron pointing right; rotate it for direction. */
export const ChevronIcon = ({ className }: IconProps) => (
  <svg aria-hidden="true" viewBox="0 0 16 16" className={cx('h-3.5 w-3.5 shrink-0', className)} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 3.5 10.5 8 6 12.5" />
  </svg>
);

export const PageIcon = ({ className }: IconProps) => (
  <svg aria-hidden="true" viewBox="0 0 16 16" className={cx('h-3.5 w-3.5 shrink-0', className)} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
    <path d="M4 2.5h8v11H4zM6 5.5h4M6 8h4M6 10.5h2.5" />
  </svg>
);

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
