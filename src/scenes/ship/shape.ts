/** Distance from the eye to the reference plane of the deck, in frame units */
export const FRAME_DEPTH = 0.6;

/**
 * The deck is one sheet of glass from the floor up past the top of the view:
 * nothing but the console stands between the viewer and space. The glass and
 * the floor sit just past the edges of the view at rest, seen when looking
 * down or about.
 */
export const GLASS_Z = -FRAME_DEPTH - 0.04;
export const FLOOR_Y = -0.8;

/** Fraction of the lens the overworld layout may use, so planets clear the edges and the console. */
export const WINDOW_FIT = 0.95;
