import { type Shot } from '../model';

export const COURT_W = 50;

export const COURT_H = 94;

export const HALF_COURT = COURT_H / 2;

export const RIM_X = 25;

export const RIM_Y = 5.25; // distance of each rim from its baseline

const THREE_ARC_RADIUS = 23.75;

const THREE_CORNER_X = 3; // distance of the corner three lines from each sideline

// Measured from the near rim, so every shot from the far half counts as a three.
export const isThree = (s: Shot) =>
  s.x < THREE_CORNER_X ||
  s.x > COURT_W - THREE_CORNER_X ||
  Math.hypot(s.x - RIM_X, s.y - RIM_Y) >= THREE_ARC_RADIUS;

// Clockwise rotation of the drawn court. Shots are always stored in unrotated court coordinates.
export type Rotation = 0 | 90 | 180 | 270;

export const ROTATION_TRANSFORMS: Record<Rotation, string> = {
  0: 'translate(0,0) rotate(0)',
  90: `translate(${COURT_H},0) rotate(90)`,
  180: `translate(${COURT_W},${COURT_H}) rotate(180)`,
  270: `translate(0,${COURT_W}) rotate(270)`,
};

// Undoes ROTATION_TRANSFORMS: maps a point on the rotated drawing back to the unrotated drawing.
export const unrotate = (vx: number, vy: number, rotation: Rotation): [number, number] => {
  switch (rotation) {
    case 90:
      return [vy, COURT_H - vx];
    case 180:
      return [COURT_W - vx, COURT_H - vy];
    case 270:
      return [COURT_W - vy, vx];
    default:
      return [vx, vy];
  }
};

export const fy = (y: number) => COURT_H - y; // flip so baseline is at the bottom

export const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);

// Applies ROTATION_TRANSFORMS to a point on the unrotated drawing.
export const rotatePoint = (x: number, y: number, rotation: Rotation): [number, number] => {
  switch (rotation) {
    case 90:
      return [COURT_H - y, x];
    case 180:
      return [COURT_W - x, COURT_H - y];
    case 270:
      return [y, COURT_W - x];
    default:
      return [x, y];
  }
};
