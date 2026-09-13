import type { Car } from "../../lib/contract";
import { SCALE } from "../../lib/geometry";

interface CarLayerProps {
  cars: Car[];
}

/**
 * Tracked vehicles, in the same normalized top down space as the stalls.
 *
 * The stalls are a uniform schematic built from the lot's real row structure, not a
 * photographic projection, so vehicles are placed onto the stall they occupy rather than at
 * their raw ground position. Either way the vision lane does the geometry and sends
 * normalized coordinates.
 *
 * Positions arrive eight times a second. Moving each car with a CSS transform transition
 * slightly longer than that interval lets the compositor fill in the frames between, so the
 * motion is smooth rather than stepped, without the map re-rendering any faster.
 */
export function CarLayer({ cars }: CarLayerProps) {
  return (
    <g filter="url(#car-lift)">
      {cars.map((car) => (
        <g
          key={car.id}
          style={{
            transform: `translate(${(car.x * SCALE).toFixed(1)}px, ${(car.y * SCALE).toFixed(1)}px)`,
            transition: "transform 140ms linear",
          }}
        >
          <circle r={17} fill="#2B2825" />
          <circle r={17} fill="none" stroke="#FFFDFA" strokeWidth={4} />
          <title>{`Vehicle ${car.id}`}</title>
        </g>
      ))}
    </g>
  );
}
