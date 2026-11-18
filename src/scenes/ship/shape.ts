/** Distance from the eye to the reference plane of the deck, in frame units */
export const FRAME_DEPTH = 0.6;

/**
 * The deck is a glass bay: one tall front pane filling the view, angled panes
 * either side of it, floor to ceiling, and only the console standing between
 * the viewer and space. At rest the front pane's mullions frame the view just
 * inside its edges and the ceiling's header runs along the top; the floor
 * shows when looking down.
 */
export const GLASS_Z = -FRAME_DEPTH - 0.04;
export const FLOOR_Y = -0.8;
export const CEIL_Y = 0.6;
/** Half the width of the front pane */
export const PANE_X = 0.6;

/** Fraction of the lens the overworld layout may use, so planets clear the edges and the console. */
export const WINDOW_FIT = 0.95;
