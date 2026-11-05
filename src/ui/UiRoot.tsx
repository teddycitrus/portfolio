import Intro from './Intro';
import OverworldHud from './OverworldHud';
import PlanetHud from './PlanetHud';
import BeaconPanel from './BeaconPanel';
import MovementJoystick from './MovementJoystick';
import Reader from './Reader';
import TransitionVeil from './TransitionVeil';

/**
 * DOM layer above the canvas. The container ignores pointer events so drags
 * and clicks reach the canvas; interactive children opt back in.
 */
const UiRoot = () => (
  <div className="pointer-events-none fixed inset-0 z-10 select-none overflow-hidden text-ink [&_input]:select-text [&_main]:select-text [&_aside]:select-text">
    <Intro />
    <OverworldHud />
    <PlanetHud />
    <MovementJoystick />
    <BeaconPanel />
    <TransitionVeil />
    <Reader />
  </div>
);

export default UiRoot;
