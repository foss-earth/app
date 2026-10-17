/**
 * An emulated VR headset in place of the browser's WebXR, installed before the
 * app starts. The dev server adds it to a page opened with
 * `?headsetEmulator=quest3` (vite/headsetEmulator.ts); no build holds it.
 *
 * Meta's Immersive Web Emulation Runtime answers `navigator.xr`: Enter VR
 * starts a session drawn side by side, an eye each, over the page.
 * `window.__fossEarthHeadsetEmulator` is the device, for a test or the console
 * to move the headset and controllers and press their buttons, e.g.
 * `__fossEarthHeadsetEmulator.remote.dispatch("select", { device: "controller-right" })`.
 */
import { XRDevice, metaQuest2, metaQuest3, metaQuestPro } from "iwer";

declare global {
  interface Window {
    /** Dev server only, with `?headsetEmulator=`: the emulated headset. */
    __fossEarthHeadsetEmulator?: XRDevice;
  }
}

const DEVICES = { quest3: metaQuest3, quest2: metaQuest2, questPro: metaQuestPro };
const requested = new URLSearchParams(window.location.search).get("headsetEmulator") ?? "";
// An eye each, as a headset shows it; the emulator starts with one picture.
const device = new XRDevice(DEVICES[requested as keyof typeof DEVICES] ?? metaQuest3, { stereoEnabled: true });
// Desktop Chrome has a WebXR of its own, with no headset behind it.
device.installRuntime({ forceInstall: true });
window.__fossEarthHeadsetEmulator = device;
console.info(`[vr] Emulated headset: ${device.name}.`);
