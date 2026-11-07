/**
 * Shared transition timeline (milliseconds). The camera controller and the
 * DOM veil both read these so the cut always lands under full cover.
 *
 * Enter: the drop pod's doors slam shut around the viewer over POD_SHUT_MS,
 * the pod fires at POD_SEAL_MS and falls toward the planet for ENTER_DIVE,
 * its porthole burning on entry; the veil (planet sky) is at full cover at
 * ENTER_TOTAL. The mode switches to 'planet', the veil lifts over
 * ENTER_VEIL_LIFT while the pod drops out of the sky for FALL_MS and slams
 * into the ground. A beat, the lamp goes green, the doors blow off at
 * DOOR_OPEN_AT and the viewer walks out over DOOR_OPEN_MS. Walking at ARRIVAL_MS.
 *
 * Exit: the viewer looks up at the mothership, a tractor beam comes down,
 * lifts them off the ground and pulls them up along it; the veil flashes the
 * beam's light from EXIT_VEIL_START and the lobby is back at EXIT_TOTAL.
 */
export const POD_SHUT_MS = 240;
export const POD_SEAL_MS = 420;
export const ENTER_DIVE = 760;
export const ENTER_VEIL_START = POD_SEAL_MS + 560;
export const ENTER_VEIL_FADE = 200;
export const ENTER_TOTAL = POD_SEAL_MS + ENTER_DIVE;
export const ENTER_VEIL_LIFT = 380;
export const FALL_MS = 1050;
/** The lamp holds amber after impact, then the bolts fire */
export const DOOR_OPEN_AT = FALL_MS + 620;
export const DOOR_OPEN_MS = 820;
/** Share of DOOR_OPEN_MS the doors take to clear; the walk out starts at WALK_FROM */
export const BLAST_SHARE = 0.32;
export const WALK_FROM = 0.18;
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
