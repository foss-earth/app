/**
 * `foss-earth/immersive`: a VR headset session for an app on a runtime from
 * `createBabylonRuntime`, with the page's interface on panels around the head,
 * and the VR tab that enters it (with `foss-earth/immersive.css`). An app with
 * a vehicle seats the headset in it (`HeadsetPlace.up`) and may show parts of
 * its page on a surface of its own, such as a cockpit's screen
 * (`HeadsetSurface`). A dev server with `headsetEmulator()` (`foss-earth/vite`)
 * emulates a headset for it: docs/agent-testing.md.
 */
export {
  createHeadsetSession, HEADSET_SESSION_EVENT,
  type HeadsetInspection, type HeadsetPlace, type HeadsetSession, type HeadsetSessionOptions, type HeadsetState,
} from "../app/immersive/headsetSession";
export {
  HEADSET_UI_SELECTORS,
  type HeadsetSurface, type HeadsetUi, type HeadsetUiInspection, type HeadsetUiParts, type HeadsetUiSelectors,
} from "../app/immersive/headsetUi";
export { createHeadsetPanel, HEADSET_CONTROLS, offerHeadsetTab, type HeadsetPanel, type HeadsetPanelOptions } from "../app/immersive/headsetPanel";
export type { ImmersiveFrames } from "../app/immersive/frames";
export { headsetFramesOf } from "../app/runtimeCompatibility";
