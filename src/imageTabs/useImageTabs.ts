import { useSyncExternalStore } from "react";
import type { ImageDocumentsSnapshot } from "./imageDocuments";
import type { ImageSurfaceHost, ImageSurfaceView } from "./imageSurfaceHost";

export function useImageDocuments(host: ImageSurfaceHost): ImageDocumentsSnapshot {
  return useSyncExternalStore(host.registry.subscribe, host.registry.getSnapshot);
}

export function useImageView(host: ImageSurfaceHost): ImageSurfaceView {
  return useSyncExternalStore(host.subscribe, host.getView);
}
