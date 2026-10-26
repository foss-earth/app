// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { getAppSettings } from "../settings/appSettings";
import { bindEarthTheme } from "./theme";

/**
 * FOSS Earth shows its own colors, so its pages name no brand palette. From 11
 * to 26 October 2026 their <html> named the UMN tour's (data-ui-theme="umn"),
 * and https://foss-earth.github.io/app/ was published in maroon and gold. A
 * host such as the tour names its palette on its own pages.
 */

it.each(["index.html", "viewer.html"])("%s names no brand palette on its root", page => {
  const html = readFileSync(join(import.meta.dirname, "../..", page), "utf8");
  const root = /<html\b[^>]*>/i.exec(html)?.[0];
  expect(root).toBeDefined();
  expect(root).not.toMatch(/\sdata-ui-theme\s*=/i);
});

it("names none when it binds its light and dark modes", () => {
  const controller = bindEarthTheme(getAppSettings(), document);
  try {
    expect(document.documentElement.getAttribute("data-theme")).toMatch(/^(dark|light)$/);
    expect(document.documentElement.hasAttribute("data-ui-theme")).toBe(false);
  } finally {
    controller.dispose();
  }
});
