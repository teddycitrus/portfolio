/**
 * Shared transition timeline (milliseconds). The camera controller and the
 * DOM veil both read these so the cut always lands under full cover.
 *
 * Enter: in the lobby the ship eases round onto the planet over DIVE_TURN_MS,
 * then plunges at it from DIVE_PUSH_AT, accelerating until it fills the
 * window, and the view crossfades into that planet's sky from
 * ENTER_VEIL_START over ENTER_VEIL_FADE; the mode switches at ENTER_TOTAL.
 * On the planet the sky clears over ENTER_VEIL_LIFT while the viewer is
 * lowered down the beam from the mothership for BEAM_DOWN_MS, looking up at
 * it, slowing all the way; the feet touch, the view comes down to the ground
 * ahead and the beam fades. Walking at ARRIVAL_MS.
 *
 * Exit: the viewer looks up at the mothership, a tractor beam comes down,
 * lifts them off the ground and pulls them up along it; the veil flashes the
 * beam's light from EXIT_VEIL_START and the lobby is back at EXIT_TOTAL.
 */
export const DIVE_TURN_MS = 650;
export const DIVE_PUSH_AT = 150;
export const ENTER_VEIL_START = 930;
export const ENTER_VEIL_FADE = 380;
export const ENTER_TOTAL = 1350;
export const ENTER_VEIL_LIFT = 700;
export const BEAM_DOWN_MS = 1500;

/**
 * Landing through the clouds: from ENTER_VEIL_START the plunge flies into the
 * planet's cloud banks, which keep streaming past while the surface loads and
 * draws its first frames. Once CLOUD_LIFT_AFTER of the descent has played,
 * the sky haze thins over CLOUD_HAZE_LIFT and the banks part over CLOUD_LIFT,
 * showing the ground coming up below.
 */
export const CLOUD_LIFT_AFTER = 180;
export const CLOUD_HAZE_LIFT = 450;
export const CLOUD_LIFT = 1100;
export const ARRIVAL_MS = BEAM_DOWN_MS + 700;

/** Exit: the look up to the ship, then the beam lifts the viewer from BEAM_LIFT_AT */
export const BEAM_LOOK_MS = 700;
export const BEAM_LIFT_AT = 650;
export const EXIT_VEIL_START = 1550;
export const EXIT_TOTAL = 2000;

export const VEIL_FADE_IN = 350;
export const VEIL_LIFT = 900;

/**
 * Planet-to-planet travel (travelTo while on a planet). The launch is cut
 * short: veil starts covering at EXIT_CHAIN_VEIL_START, the mode switches to
 * 'transitioning-in' at EXIT_CHAIN_TOTAL. The chained dive then happens
 * entirely under cover and arrives at CHAIN_TOTAL, after which the veil lifts.
 */
export const EXIT_CHAIN_VEIL_START = 1350;
export const EXIT_CHAIN_TOTAL = 1750;
export const CHAIN_TOTAL = 450;

/** Reduced-motion: no camera flight, a plain crossfade. */
export const REDUCED_TOTAL = 450;
