/** Earth compatibility forward: Renderer owns native retirement; Engine owns atlas policy. */
import { createNativeImageResources, type NativeImageResourceOptions } from "@foss-earth/renderer/babylon";
import { attemptNativeCleanup } from "@foss-earth/renderer";
import { createManagedImageryAtlasResources } from "@foss-earth/engine/babylon";
import type { ImageSessionBroker } from "@foss-earth/images";
export interface EarthNativeResourceOptions extends Omit<NativeImageResourceOptions, "broker"> { broker: ImageSessionBroker }
export const attemptEarthCleanup = attemptNativeCleanup;
export function createEarthNativeResources(options: EarthNativeResourceOptions) {
  const native = createNativeImageResources(options);
  return { ...native, managedAtlas: createManagedImageryAtlasResources(options.broker), restoreManagedDevice: native.restoreDevice };
}
