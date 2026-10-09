/** Earth host feature preparation over the one supplied frame/resource authority. */
import type { GlobeFramePreparation, GlobeRuntimeOptions } from "@foss-earth/engine/babylon";
import type { ImageTextureUploader, TextureTransferTracker } from "@foss-earth/renderer/babylon";
import type { createImageViewer } from "@foss-earth/360/viewer";

export interface EarthFeatureFramePorts {
  /** Host configures its named byte budgets through the existing uploader limits. */
  viewer: Pick<ReturnType<typeof createImageViewer>, "onFrame">;
  /** False after host feature teardown or generation replacement. */
  isCurrent(): boolean;
  /** The same scheduler used by the globe and viewer navigation leases. */
  requestRender(): void;
}

/** Install as world.framePreparation; creates no device, broker, timer or loop. */
export function createEarthFeatureFramePreparation(ports: EarthFeatureFramePorts): NonNullable<GlobeRuntimeOptions["framePreparation"]> {
  return {
    prepare(frame: GlobeFramePreparation) {
      if (!ports.isCurrent()) return;
      // Viewer uses milliseconds; Engine reports its existing seconds delta.
      if (ports.viewer.onFrame({ now: frame.nowMs, dtMs: frame.deltaSeconds * 1000 }) && ports.isCurrent()) ports.requestRender();
    },
  };
}

export interface EarthResourceWorkPorts {
  uploader: Pick<ImageTextureUploader, "pump">;
  transfers: Pick<TextureTransferTracker, "pump">;
  isCurrent(): boolean;
}
/** Owners requestWork on their one scheduler when a queue or fence can progress. */
export function createEarthResourceWork(ports: EarthResourceWorkPorts) {
  return { prepare() {
    if (!ports.isCurrent()) return;
    ports.uploader.pump();
    if (ports.isCurrent()) ports.transfers.pump();
  } };
}
