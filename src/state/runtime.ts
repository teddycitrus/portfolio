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

/**
 * Pointer-lock mouse look on the planet surface (desktop). The input bridge
 * owns the lock; the planet camera writes aimId, the beacon under the
 * screen centre, which a click opens while the cursor is locked.
 */
export const mouseLook = {
  locked: false,
  /** performance.now() of the last unlock, so the Esc that freed the cursor does nothing else */
  unlockedAt: 0,
  aimId: null as string | null,
  /** The current press began while locked: 3D click handlers skip it (the cursor position is stale) */
  pressLocked: false,
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
  /** Beacons only: camera distance (world units, XZ) */
  distance?: number;
  /** Beacons only: reserved, always false for now */
  occluded?: boolean;
  /** Beacons only: 0..1 legibility factor, 1 when close or focused */
  scale?: number;
}

export const planetScreen: Record<string, PlanetScreenInfo> = {};

/**
 * Screen-space projection of each beacon on the active planet (same shape),
 * written by the surface scene and read by the planet HUD.
 */
export const beaconScreen: Record<string, PlanetScreenInfo> = {};

/**
 * Ship flight state, written by the transition controller and the ship rig,
 * read by the cockpit (speed lines, canopy heat) and the camera rig.
 */
export const flight = {
  /** World-space speed of the viewer, units per second (smoothed) */
  speed: 0,
  /** 0..1 heat of atmospheric entry on the canopy */
  heat: 0,
  /** Destination planet accent while a dive is in progress */
  heatColor: '#ffb070',
  /** ms on the arrival clock since the first frame on a planet (-1 before it); drives the takeoff */
  arrivalMs: -1,
  /** World position of the mothership's belly, written by the mothership every frame */
  mother: { x: 40, y: 236, z: -175 },
  /** Where the tractor beam meets the ground, set when the exit starts */
  beamFoot: { x: 0, y: 0, z: 0 },
  /** 0..1 strength of the tractor beam during the exit */
  beam: 0,
};

/**
 * The console across the dash, under the window: in orbit its keys are the
 * contact links. The cockpit writes the screen corners of its face (CSS px,
 * bottom left, bottom right, top right, top left) every frame; the DOM keys
 * write which one is under the pointer or focused, and its cell lights up.
 * `logos` is the strip of logos the DOM draws once for the cockpit to paint on
 * the face.
 */
export const dashPanel = {
  quad: [0, 0, 0, 0, 0, 0, 0, 0],
  visible: false,
  hot: -1,
  logos: null as HTMLCanvasElement | null,
};

/**
 * The hyperspace arrival the site opens on, written by the warp and read by
 * the overworld (hidden in hyperspace) and the cockpit (the rumble).
 */
export const warpFx = {
  /** True while the ship is in hyperspace: the system outside is not drawn */
  inside: false,
  /** Shake of the deck, same scale as the cockpit's own */
  shake: 0,
  /** Degrees the lens is widened past rest; the cockpit frame keeps its size on screen regardless */
  lens: 0,
  /** Where the middle of the canopy glass is on screen, in px from the centre (the deck drifts and shudders) */
  glassX: 0,
  glassY: 0,
};
