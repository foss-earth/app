import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./sceneHost.ts", import.meta.url), "utf8");
describe("Earth Scenes adoption uses the public panorama bindings", () => {
  it("supplies the real Scenes projectLink and typed image-description adapters", () => {
    expect(source).toContain('from "@foss-earth/360/globe"');
    expect(source).toContain("projectLink: createGlobeViewerProjection({ viewer, renderer, runtime })");
    expect(source).toContain("describeImage: createViewerSceneDescription(viewer, { representations,");
    expect(source).not.toContain("projectAction:");
    expect(source).not.toContain("presentationFromView(");
  });
  it("passes host abort to its viewer and retires resources before final native release", () => {
    expect(source).toContain("signal: browser.signal");
    expect(source).toContain("resources.retire()");
    expect(source).toContain("viewer.whenSettled()");
    expect(source).toContain("resources.whenSettled()");
    expect(source).not.toContain("requestAnimationFrame(");
    expect(source).not.toContain("setInterval(");
    expect(source).not.toContain("createRenderScheduler(");
    expect(source).not.toContain("bootstrapGlobeRenderer(");
  });
});
