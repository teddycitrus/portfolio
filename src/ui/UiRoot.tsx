import { useEffect, useRef } from 'react';
import { useAppStore } from '@/state/useAppStore';
import OverworldHud from './OverworldHud';
import PlanetHud from './PlanetHud';
import BeaconPanel from './BeaconPanel';
import MovementJoystick from './MovementJoystick';
import Reader from './Reader';
import TransitionVeil from './TransitionVeil';
import TourBar from './TourBar';
import ContactSheet from './ContactSheet';
import { useContact } from './contact';

/**
 * DOM layer above the canvas. The container ignores pointer events so drags
 * and clicks reach the canvas; interactive children opt back in.
 */
const UiRoot = () => {
  // without WebGL the reader is the whole site
  const noWebGL = useAppStore((s) => s.noWebGL);
  const root = useRef<HTMLDivElement>(null);
  const hud = useRef<HTMLDivElement>(null);
  const readerOpen = useAppStore((s) => s.readerOpen);
  const contactOpen = useContact((s) => s.open);
  const intro = useAppStore((s) => s.intro);

  // the reader is modal: make every HUD layer behind it inert (a passive effect,
  // so the reader has already captured the element to return focus to)
  useEffect(() => {
    hud.current?.toggleAttribute('inert', readerOpen || contactOpen);
  }, [readerOpen, contactOpen]);

  // scale HUD chrome a little past 1920px wide so it does not look tiny on 2560+
  useEffect(() => {
    const apply = () => {
      const z = Math.min(1.3, Math.max(1, window.innerWidth / 1920));
      root.current?.style.setProperty('--hud-zoom', z.toFixed(3));
    };
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, []);

  return (
    <div
      ref={root}
      className="pointer-events-none fixed inset-0 z-10 select-none overflow-hidden text-ink [&_aside]:select-text [&_main]:select-text"
    >
      {!noWebGL && (
        <div ref={hud} className="contents">
          {/* the HUD waits out the intro shot, then fades in over the deck */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{ opacity: intro ? 0 : 1, visibility: intro ? 'hidden' : 'visible', transition: 'opacity 700ms ease-out 150ms' }}
          >
            <OverworldHud />
            <PlanetHud />
            <MovementJoystick />
            <BeaconPanel />
            <TourBar />
          </div>
          <TransitionVeil />
        </div>
      )}
      {!noWebGL && <ContactSheet />}
      {/* the dark the intro's dive into the ship ends in; driven by the intro itself */}
      <div id="intro-flash" aria-hidden="true" className="pointer-events-none absolute inset-0 z-[60] bg-space opacity-0" />
      <Reader />
    </div>
  );
};

export default UiRoot;
