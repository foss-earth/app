/** Earth host binding for the public UI controller; no eager import setup. */
import { createThemeController, type ThemeController, type GlobeTheme } from "@foss-earth/ui/browser";
import type { SettingsRegistry } from "@foss-earth/ui/settings";
import { getAppSettings } from "../settings/appSettings";
export type { GlobeTheme } from "@foss-earth/ui/browser";
let current: { settings: SettingsRegistry; controller: ThemeController } | null = null;
export function bindEarthTheme(settings: SettingsRegistry, document: Document): ThemeController {
  if (current?.settings === settings) return current.controller;
  current?.controller.dispose();
  const host = document.defaultView;
  const controller = createThemeController(settings, { root: document.documentElement,
    onChange: theme => host?.dispatchEvent(new CustomEvent("foss-earth:theme-change", { detail: theme })) });
  const bound = { ...controller, dispose() { if (current?.controller === bound) current = null; controller.dispose(); } };
  current = { settings, controller: bound };
  return bound;
}
const theme = () => bindEarthTheme(getAppSettings(), document);
export const getTheme = (): GlobeTheme => theme().getTheme();
export const setTheme = (value: GlobeTheme): void => theme().setTheme(value);
export const toggleTheme = (): GlobeTheme => theme().toggleTheme();
export const onThemeChange = (listener: (value: GlobeTheme) => void): (() => void) => theme().onThemeChange(listener);
