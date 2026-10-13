import { describe, expect, it } from "vitest";
import { DEFAULT_NAVIGATION_ANCHORS, NAVIGATION_ANCHOR_SETTING_IDS, SHOW_NAVIGATION_ANCHORS_ID, ZOOM_CENTER_ID } from "@foss-earth/engine";
import { NAVIGATION_ANCHOR_PRESETS } from "@foss-earth/engine/settings";
import { FOSS_EARTH_PARAMETERS } from "./catalogue";
import { BUILT_IN_PRESETS } from "./presets";
import { createSettingsRegistry, type SettingsStorage } from "./registry";

function registry() {
  const data = new Map<string, string>();
  const storage: SettingsStorage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); } };
  const settings = createSettingsRegistry({ storage, deviceContext: { maxTextureSize: 16384, rendererMode: "webgl2" } });
  settings.register(FOSS_EARTH_PARAMETERS);
  settings.registerPresets(BUILT_IN_PRESETS);
  settings.registerPresets(NAVIGATION_ANCHOR_PRESETS);
  return settings;
}

describe("zoom point presets", () => {
  const zoomAnchorIds = NAVIGATION_ANCHOR_SETTING_IDS.filter(id => id.endsWith("zoomAnchor"));

  it("are the engine's two, listed after the built-in ones, each setting the zoom choices and the zoom centre", () => {
    const settings = registry();
    expect(settings.listPresets().map(preset => preset.name)).toEqual([...BUILT_IN_PRESETS.map(preset => preset.name), "Pointer and touch anchors", "Compass-centered"]);
    for (const preset of NAVIGATION_ANCHOR_PRESETS) {
      expect(Object.keys(preset.values).sort(), preset.id).toEqual([...zoomAnchorIds, ZOOM_CENTER_ID].sort());
      expect(settings.diffPreset(preset).rejected, preset.id).toEqual([]);
    }
  });

  it("Compass-centered zooms about the compass, and Pointer and touch anchors puts the ground anchor back, leaving the markers switch alone", () => {
    const settings = registry();
    settings.set(SHOW_NAVIGATION_ANCHORS_ID, false);
    const [pointerAndTouch, compassCentered] = NAVIGATION_ANCHOR_PRESETS;
    settings.applyPreset(compassCentered);
    for (const id of zoomAnchorIds) expect(settings.get(id), id).toBe("target");
    expect(settings.get(ZOOM_CENTER_ID)).toBe("view");
    expect(settings.get(SHOW_NAVIGATION_ANCHORS_ID)).toBe(false);
    settings.applyPreset(pointerAndTouch);
    expect(settings.get("input.mouse.zoomAnchor")).toBe(DEFAULT_NAVIGATION_ANCHORS.mouse.zoom);
    expect(settings.get("input.touch.zoomAnchor")).toBe(DEFAULT_NAVIGATION_ANCHORS.touch.zoom);
    expect(settings.get("input.nonPointer.zoomAnchor")).toBe(DEFAULT_NAVIGATION_ANCHORS.nonPointer.zoom);
    expect(settings.get(ZOOM_CENTER_ID)).toBe("anchor");
    expect(settings.diffPreset(pointerAndTouch).changes).toEqual([]);
    expect(settings.get(SHOW_NAVIGATION_ANCHORS_ID)).toBe(false);
  });
});
