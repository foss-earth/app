import { expect, it, vi } from "vitest";
import { createViewSession } from "./viewSession";
import type { NavigationSnapshot } from "@foss-earth/engine";

const globe: NavigationSnapshot = { version: 1, view: { latDeg: 45, lonDeg: -93, headingDeg: 72, pitchDeg: 40, zoomMeters: 234 }, camera: { center: { x: 123, y: 456, z: 789 }, yaw: 1.2, pitch: .8, radius: 234, fov: 1.1 } };
const look = { headingDeg: 123, pitchDeg: 27, verticalFovDeg: 75 };
it("restores the exact globe and panorama after reload without saving startup or navigation-lease poses", () => {
  let raw: string | null = null, scheduled = () => {}, held = false;
  let pose = globe;
  let panorama = { sceneId: "tour", phase: "immersive", active: "a", view: look };
  const storage = { getItem: () => raw, setItem: vi.fn((_key: string, value: string) => { raw = value; }) };
  const restore = vi.fn(() => true);
  const make = () => createViewSession({ storage, key: "route", capture: () => pose, restore, held: () => held, panorama: () => panorama,
    schedule(run) { scheduled = run; return { cancel() {} }; },
  });
  const first = make();
  first.observe(); scheduled();
  expect(raw).toBeNull();
  first.start(); scheduled();
  expect(storage.setItem).toHaveBeenCalledOnce();
  held = true; pose = { ...globe, camera: { ...globe.camera, radius: 1 } };
  first.flush();
  expect(JSON.parse(raw!).globe.camera.radius).toBe(234);
  first.dispose();
  const second = make();
  expect(second.restoreGlobe()).toBe(true);
  expect(restore).toHaveBeenCalledWith(globe);
  expect(second.saved?.panorama).toEqual({ sceneId: "tour", id: "a", look });
  panorama = { ...panorama, phase: "overview", active: null as unknown as string };
  held = false; pose = globe;
  second.start(); second.flush();
  expect(JSON.parse(raw!).panorama).toBeNull();
  second.dispose();
});
it("ignores malformed or nonfinite snapshots and tolerates blocked storage", () => {
  const session = createViewSession({ storage: { getItem: () => '{"version":1,"globe":{"version":1,"camera":{"radius":null}}}', setItem() { throw Error("quota"); } }, key: "route", capture: () => globe, restore: () => true, held: () => false, panorama: () => null, schedule: () => ({ cancel() {} }) });
  expect(session.restoreGlobe()).toBe(false);
  session.start();
  expect(() => session.dispose()).not.toThrow();
});

it("keeps the last drawn map camera even when a panorama is entered before the write timer fires", () => {
  let raw: string | null = null, held = false, radius = 234;
  const session = createViewSession({ storage: { getItem: () => null, setItem(_key, value) { raw = value; } }, key: "route",
    capture: () => ({ ...globe, camera: { ...globe.camera, radius } }), restore: () => true,
    held: () => held, panorama: () => null, schedule: () => ({ cancel() {} }),
  });
  session.start();
  radius = 678; session.observe();
  held = true; radius = 1;
  session.flush();
  expect(JSON.parse(raw!).globe.camera.radius).toBe(678);
  session.dispose();
});
