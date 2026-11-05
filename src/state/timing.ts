/**
 * Shared transition timeline (milliseconds). The camera controller and the
 * DOM veil both read these so the cut always lands under full cover.
 *
 * Enter: camera dives for ENTER_DIVE, the veil (planet colour) reaches full
 * cover at ENTER_TOTAL, the mode switches to 'planet', then the veil lifts
 * over VEIL_LIFT while the camera settles onto the surface.
 *
 * Exit: camera launches for EXIT_TOTAL with the veil covering from
 * EXIT_VEIL_START, then the mode switches to 'overworld' and the veil lifts.
 */
export const ENTER_DIVE = 1500;
export const ENTER_VEIL_START = 1200;
export const ENTER_TOTAL = 1600;

export const EXIT_VEIL_START = 900;
export const EXIT_TOTAL = 1500;

export const VEIL_FADE_IN = 350;
export const VEIL_LIFT = 900;

/** Reduced-motion: no camera flight, a plain crossfade. */
export const REDUCED_TOTAL = 450;
