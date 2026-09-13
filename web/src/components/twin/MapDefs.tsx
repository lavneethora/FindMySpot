/**
 * Fill patterns and the one filter the map uses.
 *
 * The patterns are the redundancy channel that keeps status readable when colour is gone:
 * held is striped, a stall with no reading is cross hatched. Available and occupied are left
 * flat on purpose, because they are the common case and 28 patterned stalls would be noise.
 */
export function MapDefs() {
  return (
    <defs>
      <pattern id="pattern-stripe" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="14" height="14" fill="transparent" />
        <rect width="6" height="14" fill="rgb(0 0 0 / 0.22)" />
      </pattern>

      <pattern id="pattern-crosshatch" width="12" height="12" patternUnits="userSpaceOnUse">
        <path d="M0 0 L12 12 M12 0 L0 12" stroke="rgb(0 0 0 / 0.2)" strokeWidth="2" fill="none" />
      </pattern>

      {/* Asphalt. A flat grey rectangle reads as a missing image, a slight gradient reads as
          a surface. */}
      <linearGradient id="apron" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#EDEAE4" />
        <stop offset="100%" stopColor="#E3DFD8" />
      </linearGradient>

      <filter id="car-lift" x="-50%" y="-50%" width="200%" height="200%">
        <feDropShadow dx="0" dy="3" stdDeviation="4" floodColor="#000" floodOpacity="0.28" />
      </filter>
    </defs>
  );
}
