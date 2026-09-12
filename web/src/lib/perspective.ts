/**
 * A four point homography, used only to fake a camera view from the top down data.
 *
 * This is the one place the frontend does geometry, and it exists purely so the camera panel
 * is not empty when there is no pipeline running. The real view is an MJPEG stream with the
 * annotations already burned in. Nothing here runs when VITE_USE_MOCK is off.
 *
 * It is the same transform the vision lane applies in reverse: they warp camera pixels into
 * the top down plane, this warps the top down plane back out to a camera plane.
 */

import type { Point } from "./contract";

/** Row major 3x3, with h[8] fixed at 1. */
export type Homography = number[];

/**
 * Solve for the transform taking the four source corners onto the four destination corners.
 *
 * Eight unknowns from eight equations, by plain Gaussian elimination with partial pivoting.
 * No library, and no need for one at this size.
 */
export function homographyFrom(src: Point[], dst: Point[]): Homography {
  const a: number[][] = [];
  const b: number[] = [];

  for (let i = 0; i < 4; i += 1) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }

  for (let col = 0; col < 8; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < 8; row += 1) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    [a[col], a[pivot]] = [a[pivot], a[col]];
    [b[col], b[pivot]] = [b[pivot], b[col]];

    const lead = a[col][col];
    if (Math.abs(lead) < 1e-12) continue;

    for (let row = 0; row < 8; row += 1) {
      if (row === col) continue;
      const factor = a[row][col] / lead;
      if (factor === 0) continue;
      for (let k = col; k < 8; k += 1) a[row][k] -= factor * a[col][k];
      b[row] -= factor * b[col];
    }
  }

  const h = new Array<number>(9).fill(0);
  for (let i = 0; i < 8; i += 1) h[i] = a[i][i] === 0 ? 0 : b[i] / a[i][i];
  h[8] = 1;
  return h;
}

export interface Projected {
  x: number;
  y: number;
  /**
   * Relative size at this point. Things further from the camera come back smaller, which is
   * what stops the fake view looking like a second top down map.
   */
  scale: number;
}

export function project(h: Homography, [x, y]: Point): Projected {
  const w = h[6] * x + h[7] * y + h[8];
  const safe = Math.abs(w) < 1e-9 ? 1e-9 : w;
  return {
    x: (h[0] * x + h[1] * y + h[2]) / safe,
    y: (h[3] * x + h[4] * y + h[5]) / safe,
    scale: 1 / safe,
  };
}

export function projectAll(h: Homography, points: Point[]): Projected[] {
  return points.map((p) => project(h, p));
}

/**
 * The camera the simulation pretends to be: mounted high at the far end, looking back down
 * the lot. Far edge narrow, near edge wide, which is what every fixed lot camera looks like
 * and what PKLot's own footage looks like.
 */
export const SIMULATED_CAMERA: { src: Point[]; dst: Point[] } = {
  src: [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ],
  dst: [
    [0.3, 0.08],
    [0.7, 0.08],
    [1.06, 0.95],
    [-0.06, 0.95],
  ],
};
