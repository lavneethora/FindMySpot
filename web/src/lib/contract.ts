/**
 * TypeScript mirror of contracts/state.schema.json and contracts/layout.schema.json.
 *
 * Both schemas set additionalProperties true, and the agreed rule is that the frontend
 * ignores fields it does not recognise. So these interfaces describe what we read, not
 * everything that may arrive. Adding a field here is free. Changing the shape of one is a
 * sync with the vision lane, not an edit.
 */

export type SpotStatus = "occupied" | "available" | "held";

/** A point in normalized top down space. Origin top left, both axes 0..1. */
export type Point = [number, number];

export interface Spot {
  status: SpotStatus;
  /** Detector confidence for an occupied spot. Null when available. */
  confidence?: number | null;
  /** ByteTrack id of the vehicle in this spot, when known. */
  vehicle_id?: number | null;
  /** Present only when status is held. */
  held_until?: string | null;
}

export interface Car {
  id: number;
  x: number;
  y: number;
}

export interface Summary {
  total: number;
  occupied: number;
  available: number;
  /** Running per spot accuracy against dataset ground truth. Null before it is meaningful. */
  accuracy?: number | null;
}

export interface Transition {
  spot_id: string;
  from: SpotStatus;
  to: SpotStatus;
}

/** One message off the WebSocket. */
export interface ParkState {
  camera_id: string;
  timestamp: string;
  spots: Record<string, Spot>;
  cars: Car[];
  summary: Summary;
  best_spot?: string | null;
  last_event?: Transition | null;
}

export interface LayoutSpot {
  /** Corners in normalized top down space, clockwise. Render as an SVG polygon. */
  polygon: Point[];
  centroid: Point;
  distance_to_entrance_m?: number;
}

export interface AisleGraph {
  nodes?: Record<string, Point>;
  edges?: [string, string][];
}

/** GET /api/layout. Static while the camera is fixed, so it is fetched once. */
export interface Layout {
  camera_id: string;
  lot_name?: string;
  entrance: { x: number; y: number };
  spots: Record<string, LayoutSpot>;
  aisles?: AisleGraph;
}

/** POST /api/hold. Documented in contracts/README.md, not schema'd yet. */
export interface Hold {
  spot_id: string;
  held_until: string;
  route: Point[];
}

/**
 * GET /api/analytics, as the pipeline actually returns it.
 *
 * Two different quantities here. `buckets` are transition COUNTS: how many stalls filled and
 * emptied in each window. `levels` is the occupancy curve itself, recorded once per frame by
 * the pipeline. One is the derivative of the other.
 *
 * Read `levels` for the curve. The buckets are still the right source for arrivals versus
 * departures, which is a genuinely different question.
 */
export interface AnalyticsBucket {
  /** Start of the bucket, ISO. */
  t: string;
  became_occupied: number;
  became_available: number;
}

/**
 * Occupancy level per bucket, recorded once per frame by the pipeline.
 *
 * This is the curve itself, not its derivative. Deltas cannot produce it: summing them needs a
 * starting occupancy nobody stores, which is why this used to be reconstructed by counting
 * backwards from the present and came out approximate at the far end.
 */
export interface AnalyticsLevel {
  /** Start of the bucket, ISO. */
  t: string;
  /** Mean occupied stalls across the bucket. */
  occupied: number;
  /** Highest occupancy seen in the bucket. */
  peak: number;
  total: number;
}

export interface AnalyticsEvent {
  t: string;
  spot_id: string;
  status: string;
}

export interface Analytics {
  camera_id: string;
  /** The occupancy curve. Prefer this over reconstructing from buckets. */
  levels?: AnalyticsLevel[];
  buckets: AnalyticsBucket[];
  recent: AnalyticsEvent[];
}

/**
 * Layout and state are produced independently, so a spot id present in one is not
 * guaranteed to be present in the other. Read through these rather than indexing, or a
 * mismatch between the lanes becomes a blank screen instead of a missing stall.
 */
export function spotOf(state: ParkState | null, id: string): Spot | undefined {
  return state?.spots[id];
}

export function statusOf(state: ParkState | null, id: string): SpotStatus | "unknown" {
  return state?.spots[id]?.status ?? "unknown";
}

/**
 * Compare two spot ids without caring how they were typed on the wire.
 *
 * Spot ids are strings in the schema, but they are also the keys of a JSON object, which means
 * they arrive as strings no matter what. `best_spot` and `last_event.spot_id` are separate
 * fields, and a pipeline whose stall ids are integers can easily emit those as numbers. The
 * key lookups coerce on their own; strict equality does not, and a silently missing
 * recommendation ring is exactly the sort of thing that eats twenty minutes at an integration
 * sync. Never parse an id, never assume a prefix, only compare.
 */
export function sameSpot(a: string | number | null | undefined, b: string | number | null | undefined): boolean {
  return a != null && b != null && String(a) === String(b);
}
