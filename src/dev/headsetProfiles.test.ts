// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { XRDevice, type XRFrame } from "iwer";
import { P_DEVICE } from "iwer/lib/private.js";
import { headsetProfile } from "./headsetProfiles";
import { appleVisionPro, installVisionProPinch } from "./transientPinch";

describe("headset profiles", () => {
  it("names the four devices and refuses any other", () => {
    expect(headsetProfile("quest2").device.name).toBe("Meta Quest 2");
    expect(headsetProfile("quest3").kind).toBe("controller");
    expect(headsetProfile("questPro").kind).toBe("controller");
    expect(headsetProfile("visionpro")).toMatchObject({ kind: "controllerless", device: appleVisionPro });
    expect(() => headsetProfile("")).toThrow(/quest2, quest3, questPro, visionpro/);
    expect(() => headsetProfile("vision")).toThrow(/Unknown headsetEmulator/);
  });
});

describe("Vision Pro pinch", () => {
  it("offers immersive-vr only, and a pointer with no gamepad for the length of a pinch", () => {
    expect(appleVisionPro.supportedSessionModes).toEqual(["inline", "immersive-vr"]);
    expect(appleVisionPro.supportedFeatures).not.toContain("hand-tracking");
    expect(appleVisionPro.name).toBe("Apple Vision Pro");

    const device = new XRDevice(appleVisionPro, { stereoEnabled: true });
    const events: string[] = [];
    const frame = { session: { dispatchEvent(event: Event) { events.push(event.type); } } } as XRFrame;
    const pinch = installVisionProPinch(device);
    expect([...device.inputSources]).toEqual([]);
    expect(device.controllers.left).toBeUndefined();

    expect(() => pinch.begin()).toThrow(/Aim/);
    pinch.aim([0, 1.2, -1]);
    pinch.begin();
    expect(device.inputSources.map(source => source.targetRayMode)).toEqual(["transient-pointer"]);
    expect(device.inputSources[0]?.gamepad).toBeUndefined();

    device[P_DEVICE].onFrameStart(frame);
    expect(events).toEqual(["selectstart"]);
    expect(device.inputSources).toHaveLength(1);

    pinch.finish();
    device[P_DEVICE].onFrameStart(frame);
    expect(events).toEqual(["selectstart", "select", "selectend"]);
    expect([...device.inputSources]).toEqual([]);
    expect(() => pinch.finish()).toThrow(/begun/);
  });
});
