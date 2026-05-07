import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/state/useAppStore';

/** Black fade-cut that covers the moment the scene swaps. */
const TransitionFade = () => {
  const mode = useAppStore((s) => s.mode);
  const [opacity, setOpacity] = useState(0);
  const fadeTimer = useRef<number | null>(null);
  const cameFromTransition = useRef(false);

  useEffect(() => {
    const clear = () => {
      if (fadeTimer.current !== null) {
        clearTimeout(fadeTimer.current);
        fadeTimer.current = null;
      }
    };

    if (mode === 'transitioning-in') {
      cameFromTransition.current = true;
      clear();
      // Mode swap is at 1.8s. Start fade at 1.3s → peaks right at the cut.
      fadeTimer.current = window.setTimeout(() => setOpacity(1), 1300);
      return clear;
    }

    if (mode === 'transitioning-out') {
      cameFromTransition.current = true;
      clear();
      // Mode swap is at 2.0s. Start fade at 1.5s.
      fadeTimer.current = window.setTimeout(() => setOpacity(1), 1500);
      return clear;
    }

    if ((mode === 'planet' || mode === 'overworld') && cameFromTransition.current) {
      cameFromTransition.current = false;
      setOpacity(0);
      return;
    }

    setOpacity(0);
  }, [mode]);

  return (
    <div
      className="pointer-events-none fixed inset-0 z-50 bg-cosmos-deep"
      style={{
        opacity,
        transition: 'opacity 500ms cubic-bezier(0.4, 0.0, 0.2, 1)',
      }}
    />
  );
};

export default TransitionFade;
