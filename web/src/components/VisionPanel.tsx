import type { Layout, ParkState } from "../lib/contract";
import type { Connection } from "../lib/source";
import { Panel, PanelHead } from "./ui/Panel";
import { Placeholder } from "./ui/Placeholder";
import { Pill } from "./ui/Badge";
import { CameraFeed } from "./vision/CameraFeed";
import { SimulatedCamera } from "./vision/SimulatedCamera";

interface VisionPanelProps {
  layout: Layout | null;
  state: ParkState | null;
  connection: Connection;
}

/**
 * The camera side of the demo. `solid` rather than `glass`, because an MJPEG stream repaints
 * several times a second and a backdrop filter over it makes the compositor re-blur on every
 * frame.
 */
export function VisionPanel({ layout, state, connection }: VisionPanelProps) {
  const simulated = connection === "mock" || connection === "fallback";
  const accuracy = state?.summary.accuracy;

  const stand_in = layout ? (
    <SimulatedCamera layout={layout} state={state} />
  ) : (
    <Placeholder what="Waiting for the lot layout." ratio="16 / 10" />
  );

  return (
    <Panel tone="solid" className="flex flex-col">
      <PanelHead
        title="Camera"
        hint="One ordinary fixed camera. Detections, track ids and stall outlines drawn by the pipeline."
        aside={
          accuracy != null ? (
            <Pill title="Running per stall accuracy against the dataset's own ground truth">
              {(accuracy * 100).toFixed(1)}% accurate
            </Pill>
          ) : null
        }
      />

      <div className="relative overflow-hidden rounded-panel border border-card-border bg-[#22201D]" style={{ aspectRatio: "16 / 10" }}>
        {simulated ? stand_in : <CameraFeed fallback={stand_in} />}

        {/* Never let a reconstruction pass for footage. This badge is not conditional on
            anything a reviewer might later flip off. */}
        {simulated && (
          <span className="absolute top-3 left-3 rounded-chip bg-black/55 px-2.5 py-1 text-small font-semibold tracking-wide text-white/90 uppercase">
            Simulated view
          </span>
        )}

        <span className="absolute right-3 bottom-3 rounded-chip bg-black/45 px-2.5 py-1 text-small text-white/70">
          {layout?.camera_id ?? "camera"}
        </span>
      </div>

      <p className="mt-3 text-small text-ink/40">
        {simulated
          ? "No pipeline connected, so this view is reconstructed from the same state the map uses. It is not camera footage."
          : "Annotations are drawn into the frames by the pipeline, not by the browser."}
      </p>
    </Panel>
  );
}
