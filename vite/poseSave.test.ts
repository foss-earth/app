import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, expect, it } from "vitest";
import { poseSaveMiddleware, resolvePublicScene, savePoseFile } from "./poseSave";

const scratch: string[] = [];
afterEach(() => { for (const folder of scratch.splice(0)) rmSync(folder, { recursive: true, force: true }); });

function temporary(): string {
  const build = path.resolve(import.meta.dirname, "../build");
  mkdirSync(build, { recursive: true });
  const folder = realpathSync(mkdtempSync(path.join(build, "pose-save-")));
  scratch.push(folder);
  return folder;
}

function sceneFile(folder: string, name: string): string {
  const file = path.join(folder, name);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ entities: [{
    id: "orb", type: "panorama",
    capture: { longitudeDeg: 1, latitudeDeg: 2, height: { meters: 9, datum: "WGS84-ellipsoid" } },
    imagePose: { headingDeg: 3, pitchDeg: 4, rollDeg: 0 },
    marker: { mode: "capture-relative", eastM: 0, northM: 0, offsetM: 5 },
  }] }));
  return file;
}

function reply(): ServerResponse & { statusCode: number; payload: string; finished: Promise<void> } {
  let finish = (): void => {};
  const finished = new Promise<void>(resolve => { finish = resolve; });
  const value = {
    statusCode: 0, payload: "", finished,
    setHeader() { return this; },
    end(body?: string) { this.payload = body ?? ""; finish(); },
  };
  return value as unknown as ServerResponse & { statusCode: number; payload: string; finished: Promise<void> };
}

function request(method: string, url: string, body = ""): IncomingMessage {
  const stream = Readable.from([body]) as IncomingMessage & { originalUrl?: string };
  stream.method = method; stream.url = url; stream.originalUrl = url;
  return stream;
}

it("writes a public scene and refuses a path that escapes it", () => {
  const root = temporary();
  const outside = temporary();
  const file = sceneFile(root, "examples/one.scene.json");
  const secret = path.join(outside, "secret.scene.json");
  writeFileSync(secret, "{}");
  symlinkSync(secret, path.join(root, "linked.scene.json"));
  expect(resolvePublicScene(root, "examples/one.scene.json")).toBe(realpathSync(file));
  expect(resolvePublicScene(root, "../outside.scene.json")).toBeNull();
  expect(resolvePublicScene(root, "linked.scene.json")).toBeNull();
  expect(savePoseFile(file, {
    entityId: "orb", longitudeDeg: -93.2, latitudeDeg: 44.9, headingDeg: 12, pitchDeg: -3, offsetM: 8, heightMeters: 41.25,
  })).toEqual({ ok: true });
  const saved = JSON.parse(readFileSync(file, "utf8")) as { entities: { capture: { height: { meters: number } }; imagePose: { headingDeg: number } }[] };
  expect(saved.entities[0].capture.height.meters).toBe(41.25);
  expect(saved.entities[0].imagePose.headingDeg).toBe(12);
});

it("answers a probe and rejects a scene it cannot write", async () => {
  const root = temporary();
  sceneFile(root, "examples/one.scene.json");
  const handle = poseSaveMiddleware(root);
  const probe = reply();
  handle(request("GET", "/__foss-earth/pose"), probe, () => { throw new Error("The probe was passed through."); });
  expect(probe.statusCode).toBe(200);
  expect(JSON.parse(probe.payload)).toEqual({ ok: true });
  const denied = reply();
  handle(request("POST", "/__foss-earth/pose", JSON.stringify({
    file: "../outside.scene.json", entityId: "orb", longitudeDeg: 0, latitudeDeg: 0, headingDeg: 0, pitchDeg: 0, offsetM: 0,
  })), denied, () => { throw new Error("A rejected save was passed through."); });
  await denied.finished;
  expect(denied.statusCode).toBe(400);
});
