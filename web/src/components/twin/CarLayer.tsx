import type { Car } from "../../lib/contract";
import { SCALE } from "../../lib/geometry";

interface CarLayerProps {
  cars: Car[];
}

/**
 * Tracked vehicles, in the same normalized top down space as the stalls because the vision
 * lane warps them through the homography before sending anything.
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
