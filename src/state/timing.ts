/**
 * Shared transition timeline (milliseconds). The camera controller and the
 * DOM veil both read these so the cut always lands under full cover.
 *
 * Enter: the ship burns toward the planet for ENTER_DIVE, the canopy heats up
 * on entry and the veil (planet sky) reaches full cover at ENTER_TOTAL. The
 * mode switches to 'planet', the veil lifts over ENTER_VEIL_LIFT while the
 * ship descends for DESCENT_MS and touches down. The view cuts to the hatch
 * (DOOR_AT, the viewer turns away from the window, a whip pan through a
 * blink of dark over TURN_MS, and comes round onto the shut hatch), the lamp
 * holds amber, then the slabs slide open from DOOR_OPEN_AT and the viewer
 * walks out through the doorway over DOOR_OPEN_MS. Walking at ARRIVAL_MS.
 *
 * Exit: the viewer looks up at the mothership, a tractor beam comes down,
 * lifts them off the ground and pulls them up along it; the veil flashes the
 * beam's light from EXIT_VEIL_START and the lobby is back at EXIT_TOTAL.
 *
 * Exit: camera launches for EXIT_TOTAL with the veil covering from
 * EXIT_VEIL_START, then the mode switches to 'overworld' and the veil lifts.
 */
export const ENTER_DIVE = 760;
export const ENTER_VEIL_START = 560;
export const ENTER_VEIL_FADE = 200;
export const ENTER_TOTAL = 760;
export const ENTER_VEIL_LIFT = 380;
export const DESCENT_MS = 900;
/** A beat on the ground after touchdown before the view moves to the hatch */
export const DOOR_AT = DESCENT_MS + 300;
/** The turn from the window to the hatch; the view swaps at its midpoint, under the dark */
export const TURN_MS = 760;
/** The lamp holds amber this long before the latches release */
export const DOOR_OPEN_AT = DOOR_AT + TURN_MS + 260;
export const DOOR_OPEN_MS = 900;
/** Share of DOOR_OPEN_MS the slabs take to run; the walk out starts at WALK_FROM */
export const SLIDE_SHARE = 0.55;
export const WALK_FROM = 0.3;
export const ARRIVAL_MS = DOOR_OPEN_AT + DOOR_OPEN_MS;

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
