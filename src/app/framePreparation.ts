/** Earth compatibility forwards over its supplied one host frame. */
import { createFeatureFramePreparation, createResourceFrameWork } from "@foss-earth/renderer";
import type { GlobeRuntimeOptions } from "@foss-earth/engine/babylon";
import type { ImageTextureUploader, TextureTransferTracker } from "@foss-earth/renderer/babylon";
import type { createImageViewer } from "@foss-earth/image-viewer/viewer";
export interface EarthFeatureFramePorts {
  viewer: Pick<ReturnType<typeof createImageViewer>, "onFrame">;
  isCurrent(): boolean;
  requestRender(): void;
}
export function createEarthFeatureFramePreparation(ports: EarthFeatureFramePorts): NonNullable<GlobeRuntimeOptions["framePreparation"]> {
  return createFeatureFramePreparation({ onFrame: frame => ports.viewer.onFrame(frame), isCurrent: () => ports.isCurrent(), requestRender: () => ports.requestRender() });
}
export interface EarthResourceWorkPorts { uploader: Pick<ImageTextureUploader, "pump">; transfers: Pick<TextureTransferTracker, "pump">; isCurrent(): boolean }
export const createEarthResourceWork = createResourceFrameWork;
