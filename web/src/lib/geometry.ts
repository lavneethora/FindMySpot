/**
 * Everything the twin needs to turn normalized top down coordinates into an SVG viewport.
 *
 * The contract is normalized 0..1, which is awkward to draw in directly: stroke widths and
 * font sizes end up as fractions and round badly. Everything here works in units of 1/1000,
 * so a stall roughly 0.055 wide becomes 55 units and the numbers stay legible.
 */

import type { Layout, Point } from "./contract";

export const SCALE = 1000;

export interface ViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function units(p: Point): Point {
  return [p[0] * SCALE, p[1] * SCALE];
}

export function path(points: Point[]): string {
  return points.map(([x, y]) => `${(x * SCALE).toFixed(1)},${(y * SCALE).toFixed(1)}`).join(" ");
}

/** Every point the map will ever draw, so nothing ends up outside the viewport. */
function allPoints(layout: Layout): Point[] {
  const points: Point[] = [[layout.entrance.x, layout.entrance.y]];
  for (const spot of Object.values(layout.spots)) {
    points.push(...spot.polygon, spot.centroid);
  }
  for (const node of Object.values(layout.aisles?.nodes ?? {})) {
    points.push(node);
  }
  return points;
}

/**
 * Frame the lot, then widen the short axis until the viewport matches the panel's aspect.
 *
 * Letterboxing instead would leave dead bands beside the map. Expanding the viewBox means the
 * SVG fills the panel exactly, the lot stays centred, and the asphalt can be painted right to
 * the edges. The lot is never stretched: both axes keep the same scale.
 */
export function viewBoxFor(layout: Layout, aspect: number, padding = 0.04): ViewBox {
  const points = allPoints(layout);
  if (points.length === 0) return { x: 0, y: 0, width: SCALE, height: SCALE / aspect };

  const xs = points.map(([x]) => x * SCALE);
  const ys = points.map(([, y]) => y * SCALE);
  const pad = padding * SCALE;

  let minX = Math.min(...xs) - pad;
  let minY = Math.min(...ys) - pad;
  let width = Math.max(...xs) + pad - minX;
  let height = Math.max(...ys) + pad - minY;

  if (width / height < aspect) {
    const wanted = height * aspect;
    minX -= (wanted - width) / 2;
    width = wanted;
  } else {
    const wanted = width / aspect;
    minY -= (wanted - height) / 2;
    height = wanted;
  }

  return { x: minX, y: minY, width, height };
}

export function viewBoxString(box: ViewBox): string {
  return `${box.x.toFixed(1)} ${box.y.toFixed(1)} ${box.width.toFixed(1)} ${box.height.toFixed(1)}`;
}

/**
 * A label has to fit inside its own stall, and PKLot stalls are not all the same size. Deriving
 * the size from the polygon keeps "A14" inside a narrow stall instead of spilling into its
 * neighbour.
 */
export function labelSize(polygon: Point[]): number {
  const xs = polygon.map(([x]) => x * SCALE);
  const ys = polygon.map(([, y]) => y * SCALE);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  return Math.max(12, Math.min(width * 0.42, height * 0.5));
}
