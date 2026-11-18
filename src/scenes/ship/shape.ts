/** Distance from the eye to the reference plane of the deck, in frame units */
export const FRAME_DEPTH = 0.6;

/**
 * The deck is glass: one tall front pane wider than the view, angled panes
 * either side of it, and only the console standing between the viewer and
 * space. The hairline seams between the panes sit just past the edges of the
 * view at rest, seen when looking about; the floor shows when looking down.
 */
export const GLASS_Z = -FRAME_DEPTH - 0.04;
export const FLOOR_Y = -0.8;
/** How far the glass rises above the floor */
export const GLASS_H = 4;
/** Half the width of the front pane */
export const PANE_X = 0.68;

/** Fraction of the lens the overworld layout may use, so planets clear the edges and the console. */
export const WINDOW_FIT = 0.95;
