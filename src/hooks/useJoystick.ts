// Shared state for the on-screen virtual joystick. Components reading this
// inside useFrame skip the React render path entirely.
export const joystickState = {
  x: 0,
  y: 0,
  active: false,
};
