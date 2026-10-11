/** Earth owns app policy and toolbar item descriptors; owners supply parameter behavior. */
import { CHECK_PUBLISHED_EVERY_DEFAULT } from "../../app/publishedVersion";
import { UI_PARAMETERS, type ParameterSpec } from "@foss-earth/ui/settings";
import {
  createToolbarParameters, POSITION_PARAMETERS, MAP_SOURCE_HUD_LAYOUT_PARAMETERS, type ToolbarItemDescriptor,
} from "@foss-earth/toolbar";
import {
  LOCATION_LOOKUP_PARAMETERS, POSITION_GEOID_PARAMETERS, ENGINE_VISUALIZATION_PARAMETERS,
} from "@foss-earth/engine/settings";
export { INTERFACE_TAB, TOOLBAR_EDIT_PRIORITIES_ID, toolbarPriorityParameterId,
  POSITION_COORDINATE_LABELS_ID, POSITION_ALTITUDE_ID, POSITION_ALTITUDE_UNIT_ID,
} from "@foss-earth/toolbar";
export { POSITION_SEA_LEVEL_GRID_ID } from "@foss-earth/engine/settings";
export type { ToolbarVisibility, CoordinateLabels, AltitudeReference, AltitudeUnit } from "@foss-earth/toolbar";
export const SETTINGS_TAB = "settings";

export const TOOLBAR_BUTTONS = [
  ["help", "Help (?)", "the ? button that opens the controls help"],
  ["renderer", "Renderer", "the WebGPU or WebGL indicator that opens the Renderer tab"],
  ["inputMode", "Input method", "the input method button, which opens the Controls tab"],
  ["theme", "Theme button", "the light and dark theme button"],
  ["settings", "Settings (⚙)", "the ⚙ button that opens the Settings tab"],
  ["bugReport", "Bug report (🐞)", "the 🐞 button that shows or closes the Bug report tab"],
  ["fullscreen", "Fullscreen", "the button that enters or leaves fullscreen"],
  ["position", "Camera position", "the latitude, longitude, altitude, heading, pitch and zoom readout that opens Location"],
] as const;

export const TOOLBAR_PRIORITIES = [
  ["north", "North", 0],
  ["help", "Help (?)", 1],
  ["inputMode", "Input method", 2],
  ["fullscreen", "Fullscreen", 3],
  ["fps", "FPS", 4],
  ["renderer", "Renderer", 5],
  ["position", "Camera position", 6],
  ["theme", "Theme button", 7],
  ["settings", "Settings (⚙)", 8],
  ["bugReport", "Bug report (🐞)", 9],
  ["frame", "Frame time", 10],
  ["p95", "P95 frame time", 11],
  ["activeMeshes", "Active meshes (#⬟)", 12],
  ["drawCalls", "Draw calls", 13],
  ["tiles", "Map tiles (#/#t)", 14],
  ["culling", "Culling", 15],
  ["memory", "Memory", 16],
] as const;

export const PERFORMANCE_HUD_METRICS = [
  ["fps", "FPS", true, "Frames per second rendered by the map."],
  ["frame", "Frame time", false, "Average time spent rendering each frame."],
  ["p95", "P95 frame time", false, "95th percentile frame time over the recent sample window."],
  ["activeMeshes", "Active meshes (#⬟)", false, "Babylon meshes currently active in the scene."],
  ["drawCalls", "Draw calls", false, "GPU draw calls submitted for the current frame when the renderer exposes them."],
  ["tiles", "Map tiles (#/#t)", false, "Visible map tiles over active map tiles managed by the tile runtime."],
  ["culling", "Culling", false, "Visible tracked objects over total tracked objects after hemisphere culling."],
  ["memory", "Memory", false, "Approximate JavaScript heap memory currently used by the page."],
] as const;
export type ToolbarItemId = typeof TOOLBAR_PRIORITIES[number][0];
const orderingReason = "North and help come first, followed by input method, fullscreen, FPS, renderer, position, theme, settings, bug report and additional performance readings.";
const toolbarItems: readonly ToolbarItemDescriptor[] = TOOLBAR_PRIORITIES.map(([id, label, defaultPriority]) => {
  const button = TOOLBAR_BUTTONS.find(([item]) => item === id);
  const metric = PERFORMANCE_HUD_METRICS.find(([item]) => item === id);
  return {
    id, label, defaultPriority, essential: id === "north",
    description: button ? `Shows ${button[2]}.` : metric?.[3] ?? "North stays available.",
    visibilityId: button ? `interface.toolbar.${id}` : metric ? `interface.performanceHud.${id}` : undefined,
    defaultVisibility: button || metric?.[2] ? "auto" : "off",
    defaultReason: button ? "Shown when it fits after the higher-priority controls and before the detail slider and attribution."
      : metric?.[2] ? "Shown when it fits after north, help, input method and fullscreen: it is the first performance reading to look at."
      : "Hidden by default: a debugging reading.",
    priorityDefaultReason: orderingReason,
    source: "src/settings/catalogue/interface.ts",
  };
});
const toolbarParameters = createToolbarParameters(toolbarItems).map(spec =>
  spec.id.startsWith("interface.toolbar.priority.") || spec.id === "interface.toolbar.editPriorities"
    ? { ...spec, source: "src/app/createGlobeApp.ts" } : spec);
export const APP_FILE_PARAMETERS: readonly ParameterSpec[] = [
  {
    id: "app.keepFiles",
    label: "Keep the app's files",
    description: "Keeps the app's own files on this device once they have been downloaded, so a later visit starts without asking the network for them, however long ago the last one was. Each file's name carries its content, so a kept file is never out of date: a new version of the app has new names, which are downloaded once, and the old files go. The page itself is not kept: it is the browser's to ask the network for. Off forgets them and leaves the app to the browser's own cache. Scene images are kept apart: Scenes → Saved images.",
    unit: "none",
    kind: "boolean",
    default: true,
    defaultReason: "GitHub Pages lets the browser keep a file for ten minutes. On a visit to the UMN tour eleven minutes after the last, the browser asked for every file of the app again, and 1.55 of its 1.72 MiB came again in full (docs/proposals/panorama-scenes.md, \"Loading once\").",
    home: { tab: SETTINGS_TAB, section: "app-files", level: "main" },
    appliesLive: true,
    source: "src/app/appFiles.ts",
  },
  {
    id: "app.checkPublished",
    label: "Ask which version is published",
    description: "Asks this site for the page itself when the app starts, when the page is shown again and while it stays shown, no more often than the time below, and compares the build written in it with this page's. A browser that restores a tab, as a phone does, may show its own copy of the page from days before, and with it that day's app; this is how the app can tell. The answer is the page, a few kilobytes, or a few hundred bytes when it has not changed. Off asks nothing, and the app is whichever one the browser shows.",
    unit: "none",
    kind: "boolean",
    default: true,
    defaultReason: "On 2026-10-04 an iPhone was still running the UMN tour's app of two days and four releases before, from Safari's copy of the page, and nothing said so (docs/app-files.md).",
    home: { tab: SETTINGS_TAB, section: "app-files", level: "main" },
    appliesLive: true,
    source: "src/app/publishedVersion.ts",
  },
  {
    id: "app.checkPublishedEvery",
    label: "Ask again after",
    description: "How long after asking the site which version is published the app asks again, while the page is shown or when it is shown again.",
    unit: { id: "min", text: "min" },
    kind: "number",
    bounds: () => ({ min: 1, max: 1440 }),
    step: 0.05,
    scale: "log2",
    default: CHECK_PUBLISHED_EVERY_DEFAULT,
    defaultReason: "GitHub Pages tells a browser that its copy of a page is good for ten minutes, so asking again after ten asks no more often than the browser itself would.",
    home: { tab: SETTINGS_TAB, section: "app-files", level: "main" },
    appliesLive: true,
    source: "src/app/publishedVersion.ts",
  },
  {
    id: "app.reloadOlderPage",
    label: "Reload an older page by itself",
    description: "When this page is an older version of the app than the published one and nobody has touched it yet, as when a browser has just opened its own copy, the page reloads at once and its log says so. It does that once for a published version: a browser that answers with its old copy again is not asked forever. A page that has been touched is never reloaded by itself: its log says a newer version is published, with a button. Off always leaves it to the button.",
    unit: "none",
    kind: "boolean",
    default: true,
    defaultReason: "A visitor cannot tell that the page a browser restored is an old one, and an old app may not read today's scene: on 2026-10-03 one showed an error in place of the UMN tour (docs/app-files.md).",
    home: { tab: SETTINGS_TAB, section: "app-files", level: "main" },
    appliesLive: true,
    source: "src/app/publishedVersion.ts",
  },
];
/** Compatibility aggregate; each parameter's implementation comes from its owner. */
export const INTERFACE_PARAMETERS: readonly ParameterSpec[] = [
  ...APP_FILE_PARAMETERS, ...UI_PARAMETERS, ...toolbarParameters, ...POSITION_PARAMETERS, ...MAP_SOURCE_HUD_LAYOUT_PARAMETERS,
  ...LOCATION_LOOKUP_PARAMETERS, ...POSITION_GEOID_PARAMETERS, ...ENGINE_VISUALIZATION_PARAMETERS,
];
