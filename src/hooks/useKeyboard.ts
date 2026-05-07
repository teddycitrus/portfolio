// Singleton key-state map. Updated by GlobalInput, read directly inside
// useFrame loops in the camera components. Avoids re-renders on every keypress.
export const keyboardState: Record<string, boolean> = {};

export const isKeyDown = (...codes: string[]): boolean =>
  codes.some((c) => keyboardState[c] === true);
