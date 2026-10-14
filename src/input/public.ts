/** Earth host compatibility over globe, viewer and controller public contracts. */
import { getAppSettings } from "../settings/appSettings";
import * as preferences from "@foss-earth/engine/settings";
import { isSafariGestureSupported as supported } from "@foss-earth/engine/browser";
import { createGlobeGamepadAdapter as createEngineAdapter, createStandardGlobeProfile as createEngineProfile, type GlobeGamepadAdapterOptions } from "@foss-earth/engine/gamepad";
import { createSphereProfileContribution, SPHERE_GAMEPAD_ACTIONS } from "@foss-earth/sphere-image";
import { DEFAULT_BINDING_TRANSFORM } from "@felipegalind0/gamepad-tools/core";
import type { HudInputMode, InputSensitivitySettings, OrbitInvertSettings } from "@foss-earth/engine";
export { type HudInputMode, type InputSensitivitySettings, DEFAULT_ORBIT_INVERT_SETTINGS, normalizeOrbitInvertSettings, type OrbitInvertSettings,
  type GlobeNavigationActionId, type GlobeNavigationIntent, type GlobeNavigationIntentFrame } from "@foss-earth/engine";
export { GLOBE_GAMEPAD_ACTIONS, STANDARD_GLOBE_PROFILE_ID, STANDARD_GLOBE_PROFILE_NAME, type GlobeGamepadAdapterOptions, type GlobeNavigationTarget } from "@foss-earth/engine/gamepad";
export { SPHERE_GAMEPAD_ACTIONS } from "@foss-earth/sphere-image";
export const loadInputModePreference = (modes: ReadonlySet<HudInputMode>): HudInputMode => preferences.loadInputModePreference(getAppSettings(), modes);
export const saveInputModePreference = (mode: HudInputMode): void => preferences.saveInputModePreference(getAppSettings(), mode);
export const loadInputSensitivityPreference = (): InputSensitivitySettings => preferences.loadInputSensitivityPreference(getAppSettings());
export const getOrbitInvertSettings = (): Readonly<OrbitInvertSettings> => preferences.getOrbitInvertSettings(getAppSettings());
export const loadOrbitInvertSettings = (): OrbitInvertSettings => preferences.loadOrbitInvertSettings(getAppSettings());
export const saveOrbitInvertSettings = (value: OrbitInvertSettings): void => preferences.saveOrbitInvertSettings(getAppSettings(), value);
export const isSafariGestureSupported = (): boolean => supported({ userAgent: navigator.userAgent, hasGestureEvent: "GestureEvent" in window });
export function createStandardGlobeProfile(slot?: number, deadzone?: number) {
  return createEngineProfile(slot, deadzone, createSphereProfileContribution(DEFAULT_BINDING_TRANSFORM));
}
export function createGlobeGamepadAdapter(target: Parameters<typeof createEngineAdapter>[0], options: GlobeGamepadAdapterOptions = {}) {
  return createEngineAdapter(target, { ...options, featureActions: [...SPHERE_GAMEPAD_ACTIONS, ...(options.featureActions ?? [])] });
}
