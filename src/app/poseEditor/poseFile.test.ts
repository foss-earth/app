import { describe, expect, it } from "vitest";
import { scenePublicPath, writePose } from "./poseFile";

const scene = () => ({
  entities: [{
    id: "orb", type: "panorama",
    capture: { longitudeDeg: 0, latitudeDeg: 0, height: null },
    imagePose: { headingDeg: 10, pitchDeg: 0, rollDeg: 1 },
    marker: { mode: "ground-relative", eastM: 0, northM: 0, offsetM: 30 },
  }],
});

describe("scene pose files", () => {
  it("keeps a public scene path and refuses one that leaves the app", () => {
    expect(scenePublicPath("examples/panorama-scenes/umn-single.scene.json", "http://localhost:5173/app/")).toBe("examples/panorama-scenes/umn-single.scene.json");
    expect(scenePublicPath("http://localhost:5173/app/examples/a.scene.json", "http://localhost:5173/app/")).toBe("examples/a.scene.json");
    expect(scenePublicPath("../secret.scene.json", "http://localhost:5173/app/")).toBeNull();
    expect(scenePublicPath("http://example.com/app/a.scene.json", "http://localhost:5173/app/")).toBeNull();
    expect(scenePublicPath("examples/notes.txt", "http://localhost:5173/app/")).toBeNull();
  });

  it("writes one sphere's place and leaves its height when the edit does not include one", () => {
    const written = writePose(scene(), {
      entityId: "orb", longitudeDeg: -93.235, latitudeDeg: 44.974, headingDeg: 359.99996, pitchDeg: -2.5, offsetM: 12.3456,
    });
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    const entity = (written.scene.entities as Record<string, unknown>[])[0];
    expect(entity.capture).toMatchObject({ longitudeDeg: -93.235, latitudeDeg: 44.974, height: null });
    expect(entity.imagePose).toMatchObject({ headingDeg: 0, pitchDeg: -2.5, rollDeg: 1 });
    expect(entity.marker).toMatchObject({ offsetM: 12.346 });
  });

  it("rejects a place the scene format cannot store", () => {
    expect(writePose(scene(), { entityId: "missing", longitudeDeg: 0, latitudeDeg: 0, headingDeg: 0, pitchDeg: 0, offsetM: 0 }).ok).toBe(false);
    expect(writePose(scene(), { entityId: "orb", longitudeDeg: 180, latitudeDeg: 0, headingDeg: 0, pitchDeg: 0, offsetM: 0 }).ok).toBe(false);
    expect(writePose(scene(), { entityId: "orb", longitudeDeg: 0, latitudeDeg: 0, headingDeg: 0, pitchDeg: 91, offsetM: 0 }).ok).toBe(false);
  });
});
