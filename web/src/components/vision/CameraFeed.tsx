import { useState } from "react";

interface CameraFeedProps {
  /** Rendered instead of the stream if the pipeline is not serving frames. */
  fallback: React.ReactNode;
  onStatusChange?: (ok: boolean) => void;
}

/**
 * The real camera panel: an MJPEG stream consumed as an image.
 *
 * No WebRTC and no codec work, which is the whole reason the PRD picked MJPEG. Boxes, track
 * ids and stall outlines are already drawn into the frames by the vision lane, because
 * neither contract schema carries a camera space coordinate for us to overlay with.
 */
export function CameraFeed({ fallback, onStatusChange }: CameraFeedProps) {
  const [broken, setBroken] = useState(false);

  if (broken) return <>{fallback}</>;

  return (
    <img
      src="/video"
      alt="Live camera view of the lot, with detected vehicles and stall outlines drawn by the pipeline"
      className="h-full w-full object-cover"
      onError={() => {
        setBroken(true);
        onStatusChange?.(false);
      }}
      onLoad={() => onStatusChange?.(true)}
    />
  );
}
