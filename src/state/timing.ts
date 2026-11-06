/**
 * Shared transition timeline (milliseconds). The camera controller and the
 * DOM veil both read these so the cut always lands under full cover.
 *
 * Enter: the ship burns toward the planet for ENTER_DIVE, the canopy heats up
 * on entry and the veil (planet sky) reaches full cover at ENTER_TOTAL. The
 * mode switches to 'planet', the veil lifts over ENTER_VEIL_LIFT while the
 * ship descends for DESCENT_MS and touches down. The view cuts to the hatch
 * (DOOR_AT, shut over DOOR_SHUT_MS), which slides open from DOOR_OPEN_AT for
 * DOOR_OPEN_MS while the viewer steps out. Planet in view at about 1.35 s,
 * walking at ARRIVAL_MS after the cut (about 1.65 s from the click).
 *
 * Exit: camera launches for EXIT_TOTAL with the veil covering from
 * EXIT_VEIL_START, then the mode switches to 'overworld' and the veil lifts.
 */
export const ENTER_DIVE = 760;
export const ENTER_VEIL_START = 560;
export const ENTER_VEIL_FADE = 200;
export const ENTER_TOTAL = 760;
export const ENTER_VEIL_LIFT = 380;
export const DESCENT_MS = 440;
export const DOOR_AT = DESCENT_MS + 40;
export const DOOR_SHUT_MS = 70;
export const DOOR_OPEN_AT = DOOR_AT + DOOR_SHUT_MS + 40;
export const DOOR_OPEN_MS = 320;
export const ARRIVAL_MS = DOOR_OPEN_AT + DOOR_OPEN_MS;
/** The cockpit closes back around the viewer this fast on launch */
export const COCKPIT_CLOSE_MS = 600;

export const EXIT_VEIL_START = 900;
export const EXIT_TOTAL = 1500;

export const VEIL_FADE_IN = 350;
export const VEIL_LIFT = 900;

/**
 * Planet-to-planet travel (travelTo while on a planet). The launch is cut
 * short: veil starts covering at EXIT_CHAIN_VEIL_START, the mode switches to
 * 'transitioning-in' at EXIT_CHAIN_TOTAL. The chained dive then happens
 * entirely under cover and arrives at CHAIN_TOTAL, after which the veil lifts.
 */
export const EXIT_CHAIN_VEIL_START = 500;
export const EXIT_CHAIN_TOTAL = 900;
export const CHAIN_TOTAL = 450;

/** Reduced-motion: no camera flight, a plain crossfade. */
export const REDUCED_TOTAL = 450;
