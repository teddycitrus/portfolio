import { useEffect, useRef } from 'react';
import { useAppStore } from '@/state/useAppStore';

/*
 * Planet names as an old alien inscription: the name in carved capitals
 * (Cinzel) under a faint line of runes (Elder Futhark, Noto Sans Runic). When
 * the HUD first comes up each name starts as runes and resolves letter by
 * letter, as if translated; a hover replays it briefly. Every letter keeps the
 * width of its English form while it scrambles, so the label never jitters.
 */

const RUNES: Record<string, string> = {
  A: 'ᚨ', B: 'ᛒ', C: 'ᚲ', D: 'ᛞ', E: 'ᛖ', F: 'ᚠ', G: 'ᚷ', H: 'ᚺ', I: 'ᛁ', J: 'ᛃ', K: 'ᚲ', L: 'ᛚ', M: 'ᛗ',
  N: 'ᚾ', O: 'ᛟ', P: 'ᛈ', Q: 'ᚲ', R: 'ᚱ', S: 'ᛊ', T: 'ᛏ', U: 'ᚢ', V: 'ᚢ', W: 'ᚹ', X: 'ᛉ', Y: 'ᛇ', Z: 'ᛉ',
};
const POOL = Object.values(RUNES);

/** The name in runes, letter for letter */
export const toRunes = (text: string) =>
  text
    .toUpperCase()
    .split('')
    .map((c) => RUNES[c] ?? c)
    .join('');

/** Time between letters resolving, and how long each scrambles first */
const STEP_MS = 55;
const SCRAMBLE_MS = 260;
/** A hover replays it shorter */
const HOVER_SCRAMBLE_MS = 140;
/** A scrambling letter changes this often */
const TICK_MS = 45;

interface Props {
  text: string;
  /** Replays the translation when this turns true (hover) */
  active: boolean;
  /** Delay of the first translation once the HUD is up */
  delay: number;
}

const AlienName = ({ text, active, delay }: Props) => {
  const glyphs = useRef<(HTMLSpanElement | null)[]>([]);
  const raf = useRef(0);
  const letters = text.toUpperCase().split('');

  const translate = (scramble: number) => {
    cancelAnimationFrame(raf.current);
    if (useAppStore.getState().reducedMotion) return;
    const t0 = performance.now();
    let lastTick = -Infinity;
    const frame = (now: number) => {
      const t = now - t0;
      const tick = now - lastTick >= TICK_MS;
      if (tick) lastTick = now;
      let busy = false;
      letters.forEach((c, i) => {
        const el = glyphs.current[i];
        if (!el || c === ' ') return;
        if (t >= i * STEP_MS + scramble) {
          if (el.textContent !== c) {
            el.textContent = c;
            el.dataset.rune = '';
          }
          return;
        }
        busy = true;
        if (!tick) return;
        // the letter's own rune first, then strangers, so it reads as being worked out
        el.textContent = t < i * STEP_MS ? (RUNES[c] ?? c) : POOL[Math.floor(Math.random() * POOL.length)];
        el.dataset.rune = '1';
      });
      if (busy) raf.current = requestAnimationFrame(frame);
    };
    raf.current = requestAnimationFrame(frame);
  };

  // the first translation waits for the HUD (after the hyperspace arrival)
  useEffect(() => {
    let timer = 0;
    const run = () => {
      // start as runes so nothing flashes in English first
      letters.forEach((c, i) => {
        const el = glyphs.current[i];
        if (el && c !== ' ' && !useAppStore.getState().reducedMotion) {
          el.textContent = RUNES[c] ?? c;
          el.dataset.rune = '1';
        }
      });
      timer = window.setTimeout(() => translate(SCRAMBLE_MS), delay);
    };
    if (!useAppStore.getState().intro) run();
    const unsub = useAppStore.subscribe((s, p) => {
      if (p.intro && !s.intro) run();
    });
    return () => {
      unsub();
      window.clearTimeout(timer);
      cancelAnimationFrame(raf.current);
    };
  }, [text]);

  useEffect(() => {
    if (active) translate(HOVER_SCRAMBLE_MS);
  }, [active]);

  return (
    <span aria-hidden="true" className="flex flex-col items-center">
      <span className="font-runic text-[12px] leading-none tracking-[0.3em] text-[var(--accent)] opacity-80 [text-shadow:0_0_8px_var(--accent)] min-[1921px]:text-[13px]">
        {toRunes(text)}
      </span>
      <span className="mt-1.5 whitespace-nowrap font-inscription text-[18px] font-semibold leading-none tracking-[0.16em] min-[1921px]:text-[21px]">
        {letters.map((c, i) => (
          <span key={i} className="relative inline-block">
            {/* holds the English width while the rune shows */}
            <span className="invisible">{c === ' ' ? ' ' : c}</span>
            <span
              ref={(el) => {
                glyphs.current[i] = el;
              }}
              className="absolute inset-0 text-center data-[rune='1']:font-runic data-[rune='1']:text-[var(--accent)]"
            >
              {c === ' ' ? ' ' : c}
            </span>
          </span>
        ))}
      </span>
    </span>
  );
};

export default AlienName;
