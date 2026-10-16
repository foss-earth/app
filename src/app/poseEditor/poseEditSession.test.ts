import { expect, it } from "vitest";
import { createPoseEditSession } from "./poseEditSession";

it("restores only the matching scene and keeps an explicit stop across reloads", () => {
  let raw: string | null = null;
  const storage = { getItem: () => raw, setItem(_key: string, text: string) { raw = text; } };
  const scene = { sceneId: "campus", sceneUrl: "https://example.test/campus/scene.json" };
  createPoseEditSession(storage, "route").select(scene, "northrop");
  const resumed = createPoseEditSession(storage, "route");
  expect(resumed.selected(scene)).toBe("northrop");
  expect(resumed.selected({ ...scene, sceneId: "other-campus" })).toBeNull();
  expect(resumed.selected({ ...scene, sceneUrl: "https://example.test/other/scene.json" })).toBeNull();
  resumed.select(scene, null);
  expect(createPoseEditSession(storage, "route").selected(scene)).toBeNull();
});

it("ignores malformed selection data and tolerates unavailable session storage", () => {
  const scene = { sceneId: "campus", sceneUrl: "https://example.test/campus/scene.json" };
  for (const raw of ["broken", "[]", '{"version":2}', '{"version":1,"entityId":3}']) {
    expect(createPoseEditSession({ getItem: () => raw, setItem() {} }, "route").selected(scene)).toBeNull();
  }
  const session = createPoseEditSession({ getItem() { throw Error("blocked"); }, setItem() { throw Error("quota"); } }, "route");
  session.select(scene, "northrop");
  expect(session.selected(scene)).toBe("northrop");
});
