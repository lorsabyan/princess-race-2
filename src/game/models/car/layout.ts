/**
 * Key dimensions of the hero car (1 unit = 1 m, +Y up, car faces -Z, origin on
 * the ground at the center of the footprint). Everything else hangs off these.
 */
export const CAR = {
  wheelR: 0.36,
  wheelW: 0.26,
  /** |x| of the wheel centers. */
  trackX: 0.79,
  axleF: -1.0,
  axleR: 1.03,
  /** Seat cushion top surface, centered (princess root attaches here). */
  seat: [0, 0.62, 0.25] as [number, number, number],
  /** Steering wheel center relative to the seat. */
  wheelFromSeat: [0, 0.42, -0.52] as [number, number, number],
  /** Steering wheel tilt from horizontal (radians). */
  steerTilt: (55 * Math.PI) / 180,
  steerRadius: 0.2,
  spare: { y: 0.7, z: 1.62, scale: 0.84, lean: 0.2 },
} as const;

/** The scooped side panel between the wheels: an ellipsoid carved from the body, mirrored in x. */
export const COVE = { x: 0.815, y: 0.56, z: 0.06, rx: 0.15, ry: 0.13, rz: 0.84 } as const;
