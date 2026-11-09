/**
 * Shared transition timeline (milliseconds). The camera controller and the
 * DOM veil both read these so the cut always lands under full cover.
 *
 * Enter: in the lobby the deck turns onto the planet over DIVE_TURN_MS while
 * the aperture's emitters charge; the tractor beam fires out to the planet
 * from BEAM_OUT_AT over BEAM_OUT_MS; from PULL_AT the viewer is pulled along
 * it, faster and faster, the deck falling away; the view whites out into the
 * beam's light from ENTER_VEIL_START over ENTER_VEIL_FADE and the mode
 * switches at ENTER_TOTAL (the beam up from a planet, run the other way).
 * On the planet the light clears over ENTER_VEIL_LIFT while the viewer is
 * lowered down the beam from the mothership for BEAM_DOWN_MS, looking up at
 * it, slowing all the way; the feet touch, the view comes down to the ground
 * ahead and the beam fades. Walking at ARRIVAL_MS.
 *
 * Exit: the viewer looks up at the mothership, a tractor beam comes down,
 * lifts them off the ground and pulls them up along it; the veil flashes the
 * beam's light from EXIT_VEIL_START and the lobby is back at EXIT_TOTAL.
 */
export const DIVE_TURN_MS = 650;
export const BEAM_OUT_AT = 420;
export const BEAM_OUT_MS = 480;
export const PULL_AT = 1000;
export const ENTER_VEIL_START = 1520;
export const ENTER_VEIL_FADE = 300;
export const ENTER_TOTAL = 1850;
export const ENTER_VEIL_LIFT = 700;
export const BEAM_DOWN_MS = 1500;
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
