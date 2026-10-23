/**
 * Emulated headsets a dev page can ask for with `?headsetEmulator=`.
 * An unknown name is refused. It does not fall through to Quest 3.
 */
import { metaQuest2, metaQuest3, metaQuestPro, type XRDeviceConfig } from "iwer";
import { appleVisionPro } from "./transientPinch";

export type HeadsetKind = "controller" | "controllerless";

export interface HeadsetProfile {
  readonly id: string;
  readonly kind: HeadsetKind;
  readonly device: XRDeviceConfig;
}

const PROFILES = {
  quest2: { id: "quest2", kind: "controller", device: metaQuest2 },
  quest3: { id: "quest3", kind: "controller", device: metaQuest3 },
  questPro: { id: "questPro", kind: "controller", device: metaQuestPro },
  visionpro: { id: "visionpro", kind: "controllerless", device: appleVisionPro },
} as const satisfies Record<string, HeadsetProfile>;

export const HEADSET_PROFILE_IDS = Object.keys(PROFILES) as (keyof typeof PROFILES)[];

/** The profile named by `?headsetEmulator=`, or a throw when the name is not one of the four. */
export function headsetProfile(name: string): HeadsetProfile {
  const profile = (PROFILES as Record<string, HeadsetProfile>)[name];
  if (!profile) {
    throw new Error(`Unknown headsetEmulator "${name}". Known: ${HEADSET_PROFILE_IDS.join(", ")}.`);
  }
  return profile;
}
