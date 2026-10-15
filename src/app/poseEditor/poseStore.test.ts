import { describe, expect, it } from "vitest";
import {
  POSE_COALESCE_MS, POSE_FORMAT, POSE_MAX_WAIT_MS, POSE_STORAGE_KEY, POSE_VERSION,
  canonicalSceneUrl, conflictFields, createPoseStore, heightClose, normalizeHeading, normalizeLongitude, normalizeRoll,
  parsePoseStore, poseExportFilename, poseMatchesPublished, serializePoseDocument,
  type DesiredNumbers, type PoseEditRecord, type PoseStorage, type PublishedBaseline,
} from "./poseStore";

const SCENE = "https://umn-vr.github.io/tour/twin-cities/scene.json";
const OTHER = "https://umn-vr.github.io/tour/minneapolis/scene.json";

function baseline(over: Partial<PublishedBaseline> = {}): PublishedBaseline {
  return {
    entityId: "northrop-mall", title: "Northrop Mall", revision: "rev-1", mode: "ground-relative",
    longitudeDeg: -93.234272, latitudeDeg: 44.9762821, heightMeters: null,
    headingDeg: 0, pitchDeg: 0, rollDeg: 0, offsetM: 25, aligned: false, eastM: 0, northM: 0, ...over,
  };
}

function numbers(over: Partial<DesiredNumbers> = {}): DesiredNumbers {
  const base = baseline();
  return {
    mode: base.mode, longitudeDeg: base.longitudeDeg, latitudeDeg: base.latitudeDeg, heightMeters: base.heightMeters,
    headingDeg: base.headingDeg, pitchDeg: base.pitchDeg, offsetM: base.offsetM, ...over,
  };
}

function memory(initial?: string) {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(POSE_STORAGE_KEY, initial);
  const fail = new Set<"get" | "set" | "remove">();
  const storage: PoseStorage = {
    getItem(key) { if (fail.has("get")) throw new Error("get"); return values.has(key) ? values.get(key)! : null; },
    setItem(key, value) { if (fail.has("set")) throw new Error("set"); values.set(key, value); },
    removeItem(key) { if (fail.has("remove")) throw new Error("remove"); values.delete(key); },
  };
  return { storage, fail, raw: () => values.get(POSE_STORAGE_KEY) ?? null, values };
}

function clock() {
  let ms = 0;
  let iso = "2026-10-14T22:28:00.000Z";
  const timers: { run: () => void; at: number; cancelled: boolean }[] = [];
  return {
    nowIso: () => iso,
    setIso(next: string) { iso = next; },
    nowMs: () => ms,
    schedule(run: () => void, delayMs: number) {
      const timer = { run, at: ms + delayMs, cancelled: false };
      timers.push(timer);
      return { cancel() { timer.cancelled = true; } };
    },
    advance(by: number) {
      ms += by;
      let pending = true;
      while (pending) {
        pending = false;
        for (const timer of [...timers]) {
          if (!timer.cancelled && timer.at <= ms) { timer.cancelled = true; pending = true; timer.run(); }
        }
      }
    },
  };
}

function storeFor(bag = memory(), time = clock()) {
  const store = createPoseStore({ storage: bag.storage, nowIso: time.nowIso, nowMs: time.nowMs, schedule: time.schedule });
  return { store, bag, time };
}

function record(over: Partial<PoseEditRecord> = {}): PoseEditRecord {
  const base = baseline();
  return {
    entityId: base.entityId, title: base.title, mode: "ground-relative", authoredRevision: "rev-1", updatedAt: "2026-10-14T22:28:00.000Z",
    capture: { longitudeDeg: -93.2351, latitudeDeg: 44.9764, heightMeters: null },
    imagePose: { headingDeg: 182.5, pitchDeg: -1.2, aligned: true },
    marker: { offsetM: 25 },
    authored: { mode: "ground-relative", longitudeDeg: base.longitudeDeg, latitudeDeg: base.latitudeDeg, heightMeters: null, headingDeg: 0, pitchDeg: 0, rollDeg: 0, offsetM: 25, aligned: false },
    verification: { orientation: { checkedAt: "2026-10-14T22:28:00.000Z", checkedAgainst: "Northrop and Coffman" } },
    ...over,
  };
}

describe("pose normalization", () => {
  it("wraps a heading that rounds to 360 and a longitude that rounds to 180", () => {
    expect(normalizeHeading(359.99999)).toBe(0);
    expect(normalizeLongitude(179.999999996)).toBe(-180);
    expect(normalizeLongitude(-180)).toBe(-180);
    expect(normalizeRoll(-180)).toBe(180);
    expect(normalizeRoll(180)).toBe(180);
  });

  it("treats a missing height as different from zero", () => {
    expect(heightClose(null, null)).toBe(true);
    expect(heightClose(null, 0)).toBe(false);
    expect(heightClose(0, 0)).toBe(true);
  });

  it("canonicalizes an http(s) scene URL and rejects anything else", () => {
    expect(canonicalSceneUrl("twin-cities/scene.json?cache=1#x", "https://umn-vr.github.io/tour/")).toBe(SCENE);
    expect(canonicalSceneUrl("https://user:secret@umn-vr.github.io/tour/twin-cities/scene.json", "https://umn-vr.github.io/tour/")).toBeNull();
    expect(canonicalSceneUrl("file:///tmp/scene.json", "https://umn-vr.github.io/tour/")).toBeNull();
  });

  it("names an export from the UTC day and a safe prefix", () => {
    expect(poseExportFilename("umn-tour-poses", "2026-10-14T22:30:00.000Z")).toBe("umn-tour-poses-2026-10-14.json");
    expect(poseExportFilename(undefined, "2026-10-14T00:00:00.000Z")).toBe("foss-earth-poses-2026-10-14.json");
    expect(poseExportFilename("../secret", "2026-10-14T00:00:00.000Z")).toBe("foss-earth-poses-2026-10-14.json");
  });
});

describe("pose store", () => {
  it("round-trips separate scene identities in a stable export", () => {
    const { store, time } = storeFor();
    store.setNumbers("umn-twin-cities", SCENE, baseline(), numbers({ headingDeg: 10 }), "now");
    store.setNumbers("umn-minneapolis", OTHER, baseline({ entityId: "coffman", title: "Coffman" }), numbers({ headingDeg: 20 }), "now");
    time.setIso("2026-10-14T22:30:00.000Z");
    const exported = store.exportDocument("2026-10-14T22:30:00.000Z");
    expect(exported.text.endsWith("\n")).toBe(true);
    const again = parsePoseStore(exported.text);
    expect(again.kind).toBe("ok");
    expect(again.scenes.map(scene => scene.sceneId)).toEqual(["umn-minneapolis", "umn-twin-cities"]);
    expect(again.scenes[1].edits[0].imagePose.headingDeg).toBe(10);
    expect(exported.document.exportedAt).toBe("2026-10-14T22:30:00.000Z");
    expect(exported.text).toBe(serializePoseDocument(exported.document));
  });

  it("keeps an unreadable or future payload and still exports new session edits", () => {
    const raw = "{\"version\":2}";
    const bag = memory(raw);
    const { store } = storeFor(bag);
    expect(store.status().persistence).toBe("blocked");
    expect(store.status().originalText).toBe(raw);
    store.setNumbers("umn-twin-cities", SCENE, baseline(), numbers({ headingDeg: 12 }), "now");
    expect(bag.raw()).toBe(raw);
    expect(store.exportDocument("2026-10-14T22:30:00.000Z").text).toContain("\"headingDeg\": 12");
    expect(store.exportDocument("2026-10-14T22:30:00.000Z").disclosures.join(" ")).toMatch(/cannot update|could not be read/i);
  });

  it("keeps valid entries from a partial payload and does not rewrite it", () => {
    const good = record();
    const bad = record({ entityId: "broken" });
    (bad.capture as { longitudeDeg: unknown }).longitudeDeg = "nope";
    const raw = serializePoseDocument({ format: POSE_FORMAT, version: POSE_VERSION, scenes: [{ sceneId: "umn-twin-cities", sceneUrl: SCENE, edits: [good, bad] }] });
    const bag = memory(raw);
    const { store } = storeFor(bag);
    expect(store.edit("umn-twin-cities", SCENE, "northrop-mall")?.imagePose.headingDeg).toBe(182.5);
    expect(store.edit("umn-twin-cities", SCENE, "broken")).toBeNull();
    expect(store.status().skipped.length).toBeGreaterThan(0);
    store.setNumbers("umn-twin-cities", SCENE, baseline({ entityId: "coffman", title: "Coffman" }), numbers({ headingDeg: 4 }), "now");
    expect(bag.raw()).toBe(raw);
    const replaced = store.replaceSaved();
    expect(replaced.ok).toBe(true);
    expect(bag.raw()).not.toBe(raw);
    expect(bag.raw()).toContain("coffman");
    expect(bag.raw()).not.toContain("broken");
  });

  it("skips duplicate scenes and duplicate photographs instead of keeping the last", () => {
    const raw = JSON.stringify({
      format: POSE_FORMAT, version: POSE_VERSION,
      scenes: [
        { sceneId: "umn-twin-cities", sceneUrl: SCENE, edits: [record(), record({ capture: { longitudeDeg: -93.2, latitudeDeg: 44.9, heightMeters: null } })] },
        { sceneId: "umn-twin-cities", sceneUrl: SCENE, edits: [record({ entityId: "other", title: "Other" })] },
      ],
    });
    const parsed = parsePoseStore(raw);
    expect(parsed.kind).toBe("partial");
    expect(parsed.scenes).toEqual([]);
    expect(parsed.skipped.join(" ")).toMatch(/twice/);
  });

  it("rejects non-finite values, wrong types and a blank confirmation", () => {
    const badHeight = record();
    (badHeight.capture as { heightMeters: unknown }).heightMeters = "0";
    const badAligned = record({ imagePose: { headingDeg: 1, pitchDeg: 0, aligned: true }, verification: { orientation: null }, authored: { ...record().authored, aligned: false } });
    expect(parsePoseStore(JSON.stringify({ format: POSE_FORMAT, version: POSE_VERSION, scenes: [{ sceneId: "umn-twin-cities", sceneUrl: SCENE, edits: [badHeight] }] })).scenes[0].edits).toEqual([]);
    expect(parsePoseStore(JSON.stringify({ format: POSE_FORMAT, version: POSE_VERSION, scenes: [{ sceneId: "umn-twin-cities", sceneUrl: SCENE, edits: [badAligned] }] })).skipped.join(" ")).toMatch(/checked/);
    expect(parsePoseStore(JSON.stringify({ format: "other", version: 1, scenes: [] })).kind).toBe("blocked");
    expect(parsePoseStore("")).toMatchObject({ kind: "empty" });
  });

  it("leaves memory exportable when storage cannot be read or written", () => {
    const bag = memory();
    bag.fail.add("set");
    const { store } = storeFor(bag);
    store.setNumbers("umn-twin-cities", SCENE, baseline(), numbers({ headingDeg: 15 }), "now");
    expect(store.status().persistence).toBe("session");
    expect(store.status().messages.join(" ")).toMatch(/session only/);
    expect(store.exportDocument("2026-10-14T22:30:00.000Z").text).toContain("15");
    const cleared = store.clearScene("umn-twin-cities", SCENE, "now");
    expect(cleared.blocked).toBe(true);
    expect(store.edit("umn-twin-cities", SCENE, "northrop-mall")).toBeNull();
    expect(store.status().messages.join(" ")).not.toMatch(/saved across|will persist/i);
  });

  it("pauses writes when another tab changes the payload", () => {
    const bag = memory();
    const { store } = storeFor(bag);
    store.setNumbers("umn-twin-cities", SCENE, baseline(), numbers({ headingDeg: 8 }), "now");
    const written = bag.raw();
    bag.values.set(POSE_STORAGE_KEY, "{\"format\":\"foss-earth-pose-overrides\",\"version\":1,\"scenes\":[]}\n");
    store.observeExternal(bag.raw());
    store.setNumbers("umn-twin-cities", SCENE, baseline(), numbers({ headingDeg: 9 }), "now");
    expect(bag.raw()).not.toBe(written);
    expect(bag.raw()).not.toContain("\"headingDeg\": 9");
    expect(store.edit("umn-twin-cities", SCENE, "northrop-mall")?.imagePose.headingDeg).toBe(9);
    expect(store.status().persistence).toBe("foreign");
    expect(store.status().messages.join(" ")).toMatch(/another tab/);
  });

  it("coalesces a drag, flushes on demand, and does not resurrect a reset", () => {
    const bag = memory();
    const { store, time } = storeFor(bag);
    store.setNumbers("umn-twin-cities", SCENE, baseline(), numbers({ headingDeg: 1 }), "schedule");
    time.advance(POSE_COALESCE_MS - 1);
    expect(bag.raw()).toBeNull();
    time.advance(1);
    expect(bag.raw()).toContain("\"headingDeg\": 1");
    store.setNumbers("umn-twin-cities", SCENE, baseline(), numbers({ headingDeg: 2 }), "schedule");
    store.remove("umn-twin-cities", SCENE, "northrop-mall", "now");
    time.advance(POSE_MAX_WAIT_MS);
    expect(bag.raw()).not.toContain("northrop-mall");
    store.setNumbers("umn-twin-cities", SCENE, baseline(), numbers({ headingDeg: 3 }), "schedule");
    time.advance(POSE_MAX_WAIT_MS);
    expect(bag.raw()).toContain("\"headingDeg\": 3");
  });

  it("keeps the first authored snapshot when a later nudge follows a new revision", () => {
    const { store, time } = storeFor();
    store.setNumbers("umn-twin-cities", SCENE, baseline(), numbers({ headingDeg: 5 }), "now");
    time.setIso("2026-10-15T00:00:00.000Z");
    const later = baseline({ revision: "rev-2", headingDeg: 1 });
    store.setNumbers("umn-twin-cities", SCENE, later, numbers({ headingDeg: 6 }), "now");
    const edit = store.edit("umn-twin-cities", SCENE, "northrop-mall");
    expect(edit?.authoredRevision).toBe("rev-1");
    expect(edit?.authored.headingDeg).toBe(0);
    expect(edit?.updatedAt).toBe("2026-10-15T00:00:00.000Z");
    expect(conflictFields(edit!.authored, later)).toContain("headingDeg");
    store.setNumbers("umn-twin-cities", SCENE, later, numbers({ headingDeg: 6, offsetM: 30 }), "now");
    expect(store.edit("umn-twin-cities", SCENE, "coffman")).toBeNull();
  });

  it("exports a zero-heading confirmation and retires it only when published alignment matches", () => {
    const { store } = storeFor();
    const published = baseline({ aligned: false, headingDeg: 0 });
    expect(store.confirm("umn-twin-cities", SCENE, published, "  ", "now").ok).toBe(false);
    expect(store.confirm("umn-twin-cities", SCENE, published, "Coffman Union", "now").ok).toBe(true);
    const edit = store.edit("umn-twin-cities", SCENE, "northrop-mall");
    expect(edit?.imagePose).toMatchObject({ headingDeg: 0, aligned: true });
    expect(edit?.verification.orientation?.checkedAgainst).toBe("Coffman Union");
    store.reconcile("umn-twin-cities", SCENE, [published], "memory");
    expect(store.edit("umn-twin-cities", SCENE, "northrop-mall")).not.toBeNull();
    store.reconcile("umn-twin-cities", SCENE, [{ ...published, aligned: true }], "memory");
    expect(store.edit("umn-twin-cities", SCENE, "northrop-mall")).toBeNull();
  });

  it("does not revive a confirmation cleared by a heading change that was then undone", () => {
    const { store } = storeFor();
    const published = baseline({ aligned: true });
    store.setNumbers("umn-twin-cities", SCENE, published, numbers({ offsetM: 40 }), "now");
    expect(store.edit("umn-twin-cities", SCENE, "northrop-mall")?.imagePose.aligned).toBe(true);
    expect(store.edit("umn-twin-cities", SCENE, "northrop-mall")?.verification.orientation).toBeNull();
    store.confirm("umn-twin-cities", SCENE, published, "the mall", "now");
    store.setNumbers("umn-twin-cities", SCENE, published, numbers({ headingDeg: 12, offsetM: 40 }), "now");
    expect(store.edit("umn-twin-cities", SCENE, "northrop-mall")?.imagePose.aligned).toBe(false);
    store.setNumbers("umn-twin-cities", SCENE, published, numbers({ headingDeg: 0, offsetM: 40 }), "now");
    const edit = store.edit("umn-twin-cities", SCENE, "northrop-mall");
    expect(edit?.imagePose.aligned).toBe(false);
    expect(edit?.verification.orientation).toBeNull();
    expect(poseMatchesPublished({ ...numbers({ offsetM: 40 }), aligned: false, verification: { orientation: null } }, { ...published, offsetM: 40 }, 0)).toBe(false);
  });

  it("drops an edit that returns to the published place, including a changed roll as a conflict", () => {
    const { store } = storeFor();
    store.setNumbers("umn-twin-cities", SCENE, baseline(), numbers({ headingDeg: 4 }), "now");
    store.setNumbers("umn-twin-cities", SCENE, baseline(), numbers(), "now");
    expect(store.edit("umn-twin-cities", SCENE, "northrop-mall")).toBeNull();
    store.setNumbers("umn-twin-cities", SCENE, baseline(), numbers({ headingDeg: 4 }), "now");
    const edit = store.edit("umn-twin-cities", SCENE, "northrop-mall")!;
    expect(poseMatchesPublished({ ...numbers({ headingDeg: 4 }), aligned: false, verification: { orientation: null } }, baseline({ rollDeg: 2 }), edit.authored.rollDeg)).toBe(false);
    expect(conflictFields(edit.authored, baseline({ rollDeg: 2 }))).toContain("rollDeg");
  });

  it("clears one scene without writing over a blocked payload", () => {
    const raw = "{\"no\":true}";
    const bag = memory(raw);
    const { store } = storeFor(bag);
    store.setNumbers("umn-twin-cities", SCENE, baseline(), numbers({ headingDeg: 3 }), "memory");
    store.setNumbers("umn-minneapolis", OTHER, baseline({ entityId: "coffman", title: "Coffman" }), numbers({ headingDeg: 4 }), "memory");
    const cleared = store.clearScene("umn-twin-cities", SCENE, "now");
    expect(cleared.blocked).toBe(true);
    expect(store.edit("umn-minneapolis", OTHER, "coffman")).not.toBeNull();
    expect(bag.raw()).toBe(raw);
    expect(store.replaceSaved().ok).toBe(true);
    expect(bag.raw()).toContain("coffman");
    expect(bag.raw()).not.toContain("northrop-mall");
  });
});
