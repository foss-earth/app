import { describe, expect, it } from "vitest";
import { openingOptions, lookUpOpening, createOpeningViews, OPENING_STORAGE_KEY, type OpeningStorage } from "./openingView";

function storage(): OpeningStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
}

const look = { headingDeg: 12, pitchDeg: 3, verticalFovDeg: 90 };

describe("opening view memory", () => {
  it("follows entering until a remembered or fixed view is selected", () => {
    const saved = storage();
    const views = createOpeningViews({ storage: saved, schedule: run => { run(); return { cancel() {} }; } });
    expect(views.resolve("enter", "garden", look)).toBeNull();
    views.remember("garden", look);
    expect(views.resolve("enter", "garden", null)).toBeNull();
    expect(views.resolve("last", "courtyard", null)).toEqual(look);
    expect(views.resolve("image", "courtyard", null)).toBeNull();
    expect(views.resolve("image", "garden", null)).toEqual(look);
    const fixed = { headingDeg: 0, pitchDeg: 85, verticalFovDeg: 100 };
    expect(views.resolve("fixed", "garden", fixed)).toEqual(fixed);
    const again = createOpeningViews({ storage: saved, schedule: run => { run(); return { cancel() {} }; } });
    expect(again.resolve("image", "garden", null)).toEqual(look);
    expect(saved.values.has(OPENING_STORAGE_KEY)).toBe(true);
    views.dispose();
    again.dispose();
  });
});


it("uses remembered looks between photographs and preserves explicit views and signals", () => {
  const remembered = { ...look, headingDeg: 270 };
  const signal = { aborted: false };
  expect(openingOptions({ signal }, remembered)).toEqual({ signal, view: remembered });
  expect(openingOptions(undefined, remembered)).toEqual({ view: remembered });
  expect(openingOptions({ signal, view: look }, remembered)).toEqual({ signal, view: look });
  expect(openingOptions(undefined, null)).toBeUndefined();
});
it("keeps the incoming map flight ahead of Look up and remembered thumbnail directions", () => {
  const sky = { headingDeg: 0, pitchDeg: 90, verticalFovDeg: 100 };
  const signal = { aborted: false };
  expect(openingOptions(undefined, sky, true)).toBeUndefined();
  expect(openingOptions({ signal }, sky, true)).toEqual({ signal });
  expect(openingOptions({ signal, view: look }, sky, true)).toEqual({ signal, view: look });
  expect(openingOptions(undefined, sky, false)).toEqual({ view: sky });
});
it("Look up stores zenith and selects the fixed mode", () => {
  const writes: [string, unknown][] = [];
  lookUpOpening({ min: -70, max: 88 }, (key, value) => writes.push([key, value]));
  expect(writes).toEqual([["scene.panorama.openingHeading", 0], ["scene.panorama.openingPitch", 88], ["scene.panorama.openingView", "fixed"]]);
});
it("coalesces writes and flushes the final look on disposal", () => {
  const saved = storage();
  let scheduled = 0, cancelled = 0;
  const views = createOpeningViews({ storage: saved, schedule: () => { scheduled++; return { cancel() { cancelled++; } }; } });
  views.remember("a", look);
  views.remember("b", { ...look, headingDeg: 99 });
  expect(scheduled).toBe(1);
  views.dispose();
  expect(cancelled).toBe(1);
  const again = createOpeningViews({ storage: saved, schedule: () => ({ cancel() {} }) });
  expect(again.resolve("last", "a", null)?.headingDeg).toBe(99);
  expect(again.resolve("image", "a", null)).toEqual(look);
  again.dispose();
});
it("ignores corrupt storage and tolerates unavailable persistence", () => {
  const views = createOpeningViews({ storage: { getItem: () => "broken", setItem: () => { throw Error("quota"); } }, schedule: () => ({ cancel() {} }) });
  expect(views.resolve("last", "a", null)).toBeNull();
  views.remember("a", look);
  expect(() => views.dispose()).not.toThrow();
});
