import { useMemo } from "react";
import type { Layout, ParkState, Point } from "../../lib/contract";
import { homographyFrom, project, SIMULATED_CAMERA } from "../../lib/perspective";

const W = 1000;
const H = 625;

interface SimulatedCameraProps {
  layout: Layout;
  state: ParkState | null;
}

/**
 * A stand in for the camera panel when there is no pipeline running.
 *
 * The real panel is an MJPEG stream with detections and stall outlines already drawn by the
 * vision lane. This projects the same top down data back out through a perspective transform
 * so the two panels can be built, animated and rehearsed against each other with nothing but
 * the fixture. It is labelled on screen as simulated, every time, without exception: a fake
 * camera view that a judge mistakes for real footage would be far worse than an empty box.
 */
export function SimulatedCamera({ layout, state }: SimulatedCameraProps) {
  const h = useMemo(() => homographyFrom(SIMULATED_CAMERA.src, SIMULATED_CAMERA.dst), []);

  const toFrame = (p: Point) => {
    const q = project(h, p);
    return { x: q.x * W, y: q.y * H, scale: q.scale };
  };

  // Painter's algorithm. Without it a far stall can draw over a near one and the depth reads
  // backwards.
  const stalls = useMemo(() => {
    return Object.entries(layout.spots)
      .map(([id, spot]) => {
        const corners = spot.polygon.map(toFrame);
        const centre = toFrame(spot.centroid);
        const xs = corners.map((c) => c.x);
        const ys = corners.map((c) => c.y);
        return {
          id,
          centre,
          points: corners.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" "),
          box: {
            x: Math.min(...xs),
            y: Math.min(...ys),
            width: Math.max(...xs) - Math.min(...xs),
            height: Math.max(...ys) - Math.min(...ys),
          },
        };
      })
      .sort((a, b) => a.centre.y - b.centre.y);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, h]);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" role="img" aria-label="Simulated camera view">
      <defs>
        <linearGradient id="tarmac" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4A4640" />
          <stop offset="55%" stopColor="#35322D" />
          <stop offset="100%" stopColor="#22201D" />
        </linearGradient>
        <radialGradient id="vignette" cx="50%" cy="45%" r="75%">
          <stop offset="55%" stopColor="#000" stopOpacity="0" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.5" />
        </radialGradient>
      </defs>

      <rect width={W} height={H} fill="url(#tarmac)" />

      {stalls.map((stall) => {
        const spot = state?.spots[stall.id];
        const occupied = spot?.status === "occupied";
        const held = spot?.status === "held";
        // Detection boxes are tight around the vehicle, not around the stall.
        const inset = stall.box.width * 0.1;
        const label = Math.max(11, 26 * stall.centre.scale);

        return (
          <g key={stall.id}>
            {/* The stall outline the pipeline draws on every frame, occupied or not. */}
            <polygon
              points={stall.points}
              fill="none"
              stroke={held ? "var(--color-held-fill)" : "rgb(255 255 255 / 0.32)"}
              strokeWidth={Math.max(1, 2.2 * stall.centre.scale)}
              strokeDasharray={held ? "8 6" : undefined}
            />

            {occupied && (
              <>
                <rect
                  x={stall.box.x + inset}
                  y={stall.box.y + inset * 0.6}
                  width={stall.box.width - inset * 2}
                  height={stall.box.height - inset * 1.2}
                  rx={3}
                  fill="rgb(180 80 61 / 0.22)"
                  stroke="var(--color-taken-fill)"
                  strokeWidth={Math.max(1.2, 2.6 * stall.centre.scale)}
                />
                <text
                  x={stall.box.x + inset}
                  y={stall.box.y + inset * 0.6 - label * 0.35}
                  fontSize={label}
                  fontWeight={600}
                  fill="var(--color-taken-fill)"
                >
                  car {spot?.confidence != null ? spot.confidence.toFixed(2) : "--"}
                </text>
              </>
            )}
          </g>
        );
      })}

      {/* Tracked vehicles carry their ByteTrack id, which is the thing the real overlay shows
          that a still frame cannot. */}
      {(state?.cars ?? []).map((car) => {
        const p = toFrame([car.x, car.y]);
        const r = Math.max(6, 20 * p.scale);
        return (
          <g key={car.id} style={{ transition: "transform 140ms linear" }} transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`}>
            <circle r={r} fill="none" stroke="#7FD1B9" strokeWidth={Math.max(1.5, 3 * p.scale)} />
            <circle r={2.5} fill="#7FD1B9" />
            <text x={r + 6} y={4} fontSize={Math.max(11, 24 * p.scale)} fontWeight={600} fill="#7FD1B9">
              id {car.id}
            </text>
          </g>
        );
      })}

      <rect width={W} height={H} fill="url(#vignette)" pointerEvents="none" />
    </svg>
  );
}
