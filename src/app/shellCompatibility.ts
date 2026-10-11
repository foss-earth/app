/** Legacy Earth browser defaults around public UI implementations. */
import * as ui from "@foss-earth/ui/browser";
import type { SettingsRegistry } from "@foss-earth/ui/settings";
import { getAppSettings } from "../settings/appSettings";
export * from "@foss-earth/ui/browser";

function storage() {
  try { return window.localStorage; } catch { return null; }
}
function refresh(settings: SettingsRegistry) {
  return { nowMs: () => performance.now(), subscribe: (listener: () => void) => settings.subscribe(() => listener()) };
}
export function createParameterSection(settings: SettingsRegistry = getAppSettings(), options: Omit<ui.ParameterSectionOptions, "document" | "refresh" | "panelStorage">) {
  return ui.createParameterSection(settings, { ...options, document, refresh: refresh(settings), panelStorage: storage() });
}
export function createSectionsElement(entries: readonly ui.SectionsElementEntry[]) {
  return ui.createSectionsElement(entries, { document, storage: storage() });
}
export function appendHostSections(settings: SettingsRegistry, tab: string, sections: ui.SectionsElementHandle, own: readonly string[]) {
  return ui.appendHostSections(settings, tab, sections, own, { document, refresh: refresh(settings), panelStorage: storage() });
}
export function createParameterControl(settings: SettingsRegistry, id: string) {
  return ui.createParameterControl(settings, id, document);
}
export function createParameterList(settings: SettingsRegistry, filter: Parameters<typeof ui.createParameterList>[1]) {
  return ui.createParameterList(settings, filter, document);
}
export function createSettingsTransfer(settings: SettingsRegistry, filter: Parameters<typeof ui.createSettingsTransfer>[1], name: string) {
  return ui.createSettingsTransfer(settings, filter, name, document);
}
export function createSavedSettingsSection(settings: SettingsRegistry = getAppSettings()) {
  return ui.createSavedSettingsSection(settings, document);
}
export function createPresetStatus(settings: SettingsRegistry, filter: Parameters<typeof ui.createPresetStatus>[1]) {
  return ui.createPresetStatus(settings, filter, document);
}
export function createSavePresetControl(settings: SettingsRegistry, filter: Parameters<typeof ui.createSavePresetControl>[1], what: string) {
  return ui.createSavePresetControl(settings, filter, what, document);
}
export function createPresetsSection(settings: SettingsRegistry = getAppSettings()) {
  return ui.createPresetsSection(settings, document);
}
export function createHelpTooltip(options: ui.HelpTooltipOptions) {
  return ui.createHelpTooltip(options);
}
export function createTrack(options: Omit<ui.TrackOptions, "document">) {
  return ui.createTrack({ ...options, document });
}
export function trackViewportInsets(target: HTMLElement = document.documentElement) {
  return ui.trackViewportInsets(target, window);
}
export function createGameLog(settings: SettingsRegistry = getAppSettings()) {
  const element = document.getElementById("app-log") ?? document.createElement("div");
  element.id = "app-log";
  if (!element.isConnected) document.body.append(element);
  return ui.createGameLog(settings, ui.browserGameLogPorts(element, window, {
    onSize: detail => window.dispatchEvent(new CustomEvent(ui.GAME_LOG_SIZE_EVENT, { detail })),
    isCentered: () => document.documentElement.dataset.dockLayout === "dual",
    resizesWidth: () => document.documentElement.dataset.dockLayout !== "stacked",
    isRightAligned: () => document.documentElement.dataset.dockLayout === "single" && document.documentElement.dataset.dockSide === "left",
  }));
}
