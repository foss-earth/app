// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

it("keeps Return to map under the windows, so it never covers a window's grip", () => {
  const style = document.createElement("style");
  style.textContent = [
    readFileSync(join(import.meta.dirname, "../../node_modules/@foss-earth/ui/src/windowing/styles/windowing.css"), "utf8"),
    readFileSync(join(import.meta.dirname, "sphere.css"), "utf8"),
  ].join("\n");
  document.head.append(style);
  // As the app lays them out: the overlay's windows, then the button after them.
  document.body.innerHTML = `<div class="foss-earth-window-overlay"><section class="foss-earth-dock-panel" data-side="right">
    <div class="foss-earth-dock-panel-resize-handle" data-at="bottom"></div></section></div>
    <button class="hud-chip hud-chip-button foss-earth-sphere-return">Return to map</button>`;
  const z = (selector: string): number => Number(getComputedStyle(document.querySelector(selector)!).zIndex);
  // The overlay makes no stacking context of its own, so the windows and the button stack together.
  expect(getComputedStyle(document.querySelector(".foss-earth-window-overlay")!).zIndex).toBe("auto");
  expect(z(".foss-earth-sphere-return")).toBeLessThan(z(".foss-earth-dock-panel"));
  expect(z(".foss-earth-sphere-return")).toBeGreaterThan(0);
});
