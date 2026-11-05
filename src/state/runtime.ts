/**
 * Mutable per-frame state shared between the DOM input layer and the R3F
 * render loop. Nothing here triggers React renders; consumers read it inside
 * useFrame or rAF loops.
 */

export const pointerState = {
  /** Normalised device coords of the mouse, -1..1, y up */
  x: 0,
  y: 0,
  /** True once the mouse has moved at least once (desktop) */
  seen: false,
};

/**
 * Drag-to-look accumulators. Pointer drags on the canvas add to these in
 * radians; camera controllers own the clamping and may reset them.
 */
export const dragLook = {
  yaw: 0,
  pitch: 0,
  dragging: false,
  /** Total pixels moved during the current press, used to tell click from drag */
  travel: 0,
};

export const keyboardState: Record<string, boolean> = {};

export const isKeyDown = (...codes: string[]): boolean =>
  codes.some((c) => keyboardState[c] === true);

/** Virtual joystick on touch devices, -1..1 each axis, y down. */
export const joystickState = {
  x: 0,
  y: 0,
  active: false,
};

/**
 * Screen-space projection of each overworld planet, written by the 3D scene
 * every frame and read by the DOM marker layer.
 *   x, y     pixel position (clamped to the viewport edge when off-screen)
 *   visible  true when the planet centre is inside the viewport
 *   angle    direction from screen centre, radians, for edge arrows
 *   size     approximate on-screen radius in pixels
 */
export interface PlanetScreenInfo {
  x: number;
  y: number;
  visible: boolean;
  angle: number;
  size: number;
}

export const planetScreen: Record<string, PlanetScreenInfo> = {};

/**
 * Screen-space projection of each beacon on the active planet (same shape),
 * written by the surface scene and read by the planet HUD.
 */
export const beaconScreen: Record<string, PlanetScreenInfo> = {};
