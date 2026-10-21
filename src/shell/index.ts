/** Earth compatibility assembly. New consumers use each owner public package and explicit host ports. */
export type {
  HudBarButtonItem,
  HudBarHandle,
  HudBarItem,
  HudBarMenuItem,
  HudBarMenuOption,
  HudBarOptions,
  HudBarSlotItem,
} from "@foss-earth/toolbar/legacy";
export { createHudBar, HUD_BAR_HEIGHT_PROPERTY } from "@foss-earth/toolbar/legacy";
export { createAboutPanel, type AboutPanelHandle, type AboutPanelOptions } from "./aboutPanel";
export { createDiagnosticsSection, type DiagnosticsSectionHandle, type DiagnosticsSource } from "../app/shellCompatibility";
export { createBugReportPanel, type BugReportPanelHandle, type BugReportPanelOptions } from "../app/shellCompatibility";
export { fitHudBar, type HudBarFitItem } from "@foss-earth/toolbar/browser";
export type { BuiltFrom, BuiltFromCommit, BuiltFromPart, BuiltFromSource } from "../app/builtFrom";
export { createMapSourceHud, type MapSourceHudHandle, type MapSourceHudOptions, type MapSourceHudStatus } from "@foss-earth/engine/panels";
export { createMapDetailSlider, describeDetailStatus, type MapDetailSliderHandle, type MapDetailSliderOptions } from "@foss-earth/engine/panels";
export {
  createMapDetailController,
  detailPolicyFromValues,
  detailPolicyValues,
  MAP_DETAIL_PARAMETER_IDS,
  MAP_DETAIL_STORAGE_KEY,
  type MapDetailActiveSource,
  type MapDetailController,
  type MapDetailControllerOptions,
  type MapDetailDelivery,
  type MapDetailRequirement,
  type MapDetailSeedResult,
  type MapDetailStorage,
} from "@foss-earth/engine/settings";
export { createMapDetailPanel, type MapDetailPanelHandle, type MapDetailPanelOptions } from "@foss-earth/engine/panels";
export type { DetailTrackMarker } from "@foss-earth/engine";
export {
  appendHostSections,
  createParameterSection,
  createSectionsElement,
  type HostSectionsHandle,
  type ParameterSectionHandle,
  type ParameterSectionOptions,
  type SectionsElementEntry,
  type SectionsElementHandle,
} from "../app/shellCompatibility";
export { createParameterControl, describeProvenance, type ParameterControlHandle } from "../app/shellCompatibility";
export { markParametersApplied } from "@foss-earth/ui/browser";
export { createHelpTooltip, closeHelpTooltipWithin, type HelpTooltipHandle, type HelpTooltipOptions } from "../app/shellCompatibility";
export { createParameterList, createSettingsTransfer, type ParameterListHandle, type SettingsTransferHandle } from "../app/shellCompatibility";
export { createTrack, detailColour, type TrackFrame, type TrackHandle, type TrackOptions, type TrackRamp, type TrackThumb } from "../app/shellCompatibility";
export { createMapCacheSection, type MapCacheSectionHandle } from "@foss-earth/engine/panels";
export { createSavedImagesSection, type SavedImagesSectionHandle } from "@foss-earth/scenes/browser";
export { createSavedSettingsSection, type SavedSettingsSectionHandle } from "../app/shellCompatibility";
export {
  createPresetStatus,
  createPresetsSection,
  createSavePresetControl,
  type PresetStatusHandle,
  type PresetsSectionHandle,
  type SavePresetHandle,
} from "../app/shellCompatibility";
export { connectMapDetailRuntime, type MapDetailRuntime } from "@foss-earth/engine/settings";
export { connectMapDetailLog } from "@foss-earth/engine/panels";
export { WindowOverlay, type WindowOverlayHandle, type WindowOverlayProps } from "./WindowOverlay";
export { SectionsPanel, type PanelSection } from "@foss-earth/ui/react";
export { MeshInspectorPanel, type MeshInspectorPanelProps } from "@foss-earth/ui/react";
export { ChoiceTrack, HelpTip, IconButton, type ChoiceTrackChoice, type ChoiceTrackProps, type IconButtonProps } from "@foss-earth/ui/react";
export { createMapSourcePanel, type MapSourcePanelHandle, type MapSourcePanelOptions, type MapSourceStatus } from "@foss-earth/engine/panels";
export { createRendererPanel, getRendererLabel, type RendererPanelHandle, type RendererPanelOptions } from "@foss-earth/renderer/panel";
export { reportRendererStart } from "../app/rendererAdviceLog";
export { createSkyPanel, describeSun, type SkyPanelHandle, type SkyPanelOptions } from "@foss-earth/sky/panels";
export { createDateTimePanel, fixedTimeValues, instantInUse, type DateTimePanelHandle, type DateTimePanelOptions } from "@foss-earth/sky/panels";
export { createFrameBudgetPanel, type FrameBudgetPanelHandle, type FrameBudgetPanelOptions } from "@foss-earth/renderer/panel";
export { createSceneHotspots, createScenesPanel, type ScenePanelElement as ScenesPanelHandle } from "@foss-earth/scenes/panel";
export { createSceneHud, type SceneHudHandle } from "@foss-earth/toolbar/browser";
export { createViewerTabs as createSphereTabs, type ViewerTabs as SphereTabs, type ViewerPanelPorts as SphereTabsOptions, type ViewerTabsSnapshot as SphereTabsSnapshot } from "@foss-earth/sphere-image/panels";
export { connectSceneLog } from "@foss-earth/scenes/browser";
export { PANEL_SECTIONS_OPEN_STORAGE_KEY } from "../app/shellCompatibility";
export { SAVED_WORKSPACE_STORAGE_KEY } from "@foss-earth/ui/windowing";
export { trackViewportInsets, VIEWPORT_INSET_BOTTOM_PROPERTY, type ViewportInsetsHandle } from "../app/shellCompatibility";
export { createInputModeHud, type InputModeHudOptions, type InputModeHudHandle } from "@foss-earth/engine/panels";
export { createPositionReadout, type PositionReading, type PositionReadoutHandle, type PositionReadoutOptions } from "@foss-earth/toolbar/browser";
export { surfaceHeightDatum, type HeightDatum } from "@foss-earth/engine";

export { attachRendererActivity, attachTileStreamingActivity, type RenderActivitySource, type TileStreamingSource } from "@foss-earth/toolbar/browser";

export { attachMapDownloadSpeed, setMapSourceLabel, type MapDownloadSource } from "@foss-earth/toolbar/browser";

export { searchLocations, nearbyAirports } from "../app/locationServices";
/** @deprecated The Map tab's Loading and memory section shows the cache; see createMapCacheSection. */
export { MapCachePanel } from "@foss-earth/engine/react";
export { inspectMapCache, clearMapCache, type MapCacheSnapshot, type MapCacheEntry } from "../app/cacheCompatibility";
export {
  createGameLog,
  GAME_LOG_FADE_MS,
  GAME_LOG_LINE_MS,
  GAME_LOG_MAX_LINES,
  type GameLog,
  type GameLogAction,
  type GameLogEntry,
  type GameLogLine,
  type GameLogTone,
} from "../app/shellCompatibility";
export {
  attachFullscreenButton,
  canRequestFullscreen,
  enterFullscreen,
  exitFullscreen,
  isFullscreen,
  isStandaloneDisplay,
  onFullscreenChange,
  prefersHomeScreenInstall,
  readFullscreenEveryVisit,
  readFullscreenPromptDismissed,
  toggleFullscreen,
  writeFullscreenEveryVisit,
  writeFullscreenPromptDismissed,
} from "@foss-earth/toolbar/browser";
