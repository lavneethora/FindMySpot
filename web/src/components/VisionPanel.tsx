import { Panel, PanelHead } from "./ui/Panel";
import { Placeholder } from "./ui/Placeholder";
import { Pill } from "./ui/Badge";

interface VisionPanelProps {
  accuracy?: number | null;
}

/**
 * The camera side of the demo. Deliberately `solid` rather than `glass`: this panel will wrap
 * an MJPEG stream repainting several times a second, and a backdrop filter over that makes
 * the compositor re-blur on every frame.
 *
 * The annotations, boxes, track ids and stall outlines, are burned into the frames server
 * side. Neither contract schema carries a camera space coordinate, only normalized top down,
 * so drawing an overlay here is not possible even in principle.
 */
export function VisionPanel({ accuracy }: VisionPanelProps) {
  return (
    <Panel tone="solid" className="flex flex-col">
      <PanelHead
        title="Camera"
        hint="One ordinary fixed camera. Detections and stall outlines drawn by the pipeline."
        aside={
          accuracy != null ? <Pill title="Running accuracy against dataset ground truth">{(accuracy * 100).toFixed(1)}% accurate</Pill> : null
        }
      />
      <Placeholder what="The annotated camera feed lands here in the next change." ratio="16 / 10" />
    </Panel>
  );
}
