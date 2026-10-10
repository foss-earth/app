import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EarthNativeResourceOptions } from "./nativeResources";
import { createEarthNativeResources } from "./nativeResources";

const owner = vi.hoisted(() => ({ bytes: 0, uploader: { pump: vi.fn(), stats: vi.fn(), cancelAll: vi.fn() }, tracker: { transfer: vi.fn(), tryAdmit: vi.fn(), track: vi.fn(), pump: vi.fn(), dispose: vi.fn(), deviceLost: vi.fn() } }));
vi.mock("@foss-earth/renderer/babylon", () => ({
  createTextureTransferTracker: () => owner.tracker,
  createImageTextureUploader: () => owner.uploader,
  createTextureDevicePorts: () => ({}), createImageRegionDevicePorts: () => ({}), createCanvasTextureDevicePorts: () => ({}),
}));
function fixture() {
  const timers: (() => void)[] = [];
  let loss: (() => void) | undefined;
  const stopLoss = vi.fn(), stopTimer = vi.fn(), releaseDevice = vi.fn(), onRetirementError = vi.fn();
  const resources = createEarthNativeResources({
    scene: {}, broker: { pools: { stats: () => ({ uploadOutstanding: { reserved: owner.bytes } }) } },
    limits: () => ({}), wakeWork() {}, createCanvas() {}, invalidatePublishedSource() {},
    after(callback: () => void, delay: number) { expect(delay).toBe(16); timers.push(callback); return stopTimer; },
    observeDeviceLoss(listener: () => void) { loss = listener; return stopLoss; }, onRetirementError,
  } as unknown as EarthNativeResourceOptions);
  return { resources, timers, releaseDevice, stopLoss, stopTimer, onRetirementError, lose: () => loss?.() };
}
beforeEach(() => {
  vi.resetAllMocks(); owner.bytes = 0;
  owner.uploader.stats.mockImplementation(() => ({ outstandingBytes: owner.bytes }));
});
describe("Earth native retirement on its borrowed device", () => {
  it("keeps actual submitted tickets and the device alive until a terminal pump observes completion", () => {
    owner.bytes = 4;
    const { resources, timers, releaseDevice, stopLoss } = fixture();
    resources.dispose(releaseDevice);
    expect(owner.uploader.cancelAll).toHaveBeenCalledExactlyOnceWith("Earth host disposed");
    expect(releaseDevice).not.toHaveBeenCalled();
    expect(timers).toHaveLength(1);
    resources.resourceWork.prepare(); // disposed app frames do no work
    expect(owner.uploader.pump).not.toHaveBeenCalled();
    timers.shift()!(); expect(timers).toHaveLength(1); expect(releaseDevice).not.toHaveBeenCalled();
    owner.uploader.pump.mockImplementation(() => { owner.bytes = 0; });
    timers.shift()!();
    expect(releaseDevice).toHaveBeenCalledTimes(1); expect(stopLoss).toHaveBeenCalledTimes(1);
    expect(timers).toHaveLength(0);
    resources.dispose(releaseDevice); expect(releaseDevice).toHaveBeenCalledTimes(1);
  });
  it("releases immediately without a timer or loss subscription when there are no submitted tickets", () => {
    const { resources, timers, releaseDevice, stopLoss } = fixture();
    resources.dispose(releaseDevice);
    expect(releaseDevice).toHaveBeenCalledTimes(1); expect(timers).toHaveLength(0); expect(stopLoss).not.toHaveBeenCalled();
  });
  it("uses the device-loss flag only after the injected native observation, canceling its retirement timer", () => {
    owner.bytes = 4;
    const { resources, releaseDevice, lose, stopTimer } = fixture();
    resources.dispose(releaseDevice);
    lose();
    expect(owner.tracker.deviceLost).toHaveBeenCalledTimes(1);
    expect(owner.uploader.cancelAll).toHaveBeenLastCalledWith("Observed device loss during retirement", { deviceLost: true });
    expect(releaseDevice).toHaveBeenCalledTimes(1); expect(stopTimer).toHaveBeenCalledTimes(1);
  });
  it("retains tickets on failed completion observation and waits for actual loss without spinning", () => {
    owner.bytes = 4;
    const failure = new Error("completion observation"); owner.uploader.pump.mockImplementation(() => { throw failure; });
    const { resources, timers, onRetirementError, releaseDevice, lose } = fixture();
    resources.dispose(releaseDevice); timers.shift()!();
    expect(onRetirementError).toHaveBeenCalledExactlyOnceWith(failure); expect(timers).toHaveLength(0);
    expect(releaseDevice).not.toHaveBeenCalled();
    lose(); expect(releaseDevice).toHaveBeenCalledTimes(1);
  });
});
