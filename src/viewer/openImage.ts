import type { WindowSlotId } from "@foss-earth/ui/windowing";
import type { ImageSurfaceHost } from "../imageTabs/imageSurfaceHost";

/** Opens an address on one side and returns the new tab, or null when it could not be read. */
export async function openImageOnSide(host: ImageSurfaceHost, url: string, slot: WindowSlotId): Promise<string | null> {
  const before = new Set(host.registry.getSnapshot().tabs.map(tab => tab.tabId));
  const opened = await host.openUrl(url, slot);
  if (!opened) return null;
  return host.registry.getSnapshot().tabs.find(tab => !before.has(tab.tabId))?.tabId ?? null;
}
