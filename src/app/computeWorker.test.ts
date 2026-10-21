// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createComputeAdmission } from "@foss-earth/engine/browser";
import { boundedComputeModule, workerComputePort } from "./computeWorker";

const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
afterEach(() => vi.useRealTimers());
function fixture() {
  vi.useFakeTimers();
  const worker = Object.assign(new EventTarget(), { postMessage: vi.fn() });
  const compute = createComputeAdmission({ limit: 1, now: () => 0 }), initialization = createComputeAdmission({ limit: 1, now: () => 0 });
  const port = workerComputePort(worker as unknown as Worker, compute.port("terrain"), initialization.port("initialization"));
  const ready = () => worker.dispatchEvent(new MessageEvent("message", { data: { kind: "earth-compute-ready" } }));
  return { worker, compute, initialization, ...port, ready };
}
describe("worker preparation outside numeric compute admission", () => {
  it("prepares once, consumes readiness before owner listeners and starts numeric admission afterwards", async () => {
    const f = fixture(), owner = vi.fn(); f.worker.addEventListener("message", owner);
    const pending = f.port.acquire(); await tick();
    expect(f.compute.snapshot().active).toBe(0); expect(f.initialization.snapshot().active).toBe(1);
    expect(f.worker.postMessage).toHaveBeenCalledWith({ kind: "earth-compute-prepare" });
    f.ready(); const lease = await pending;
    expect(owner).not.toHaveBeenCalled(); expect(f.initialization.snapshot().active).toBe(0);
    expect(f.compute.snapshot().active).toBe(1); lease.release();
    (await f.port.acquire()).release(); expect(f.worker.postMessage).toHaveBeenCalledOnce();
    f.retire(); expect(vi.getTimerCount()).toBe(0);
  });
  it("cancels a caller promptly during module loading without numeric admission or a fallback", async () => {
    const f = fixture(), abort = new AbortController(), pending = f.port.acquire({ signal: abort.signal }); await tick();
    abort.abort(new Error("obsolete")); await expect(pending).rejects.toThrow("obsolete");
    expect(f.compute.snapshot()).toMatchObject({ active: 0, queued: 0 });
    f.ready(); await tick(); expect(f.initialization.snapshot().active).toBe(0); f.retire();
  });
  it("drains pending initialization on retirement, including a grant/retirement race", async () => {
    const f = fixture(), pending = f.port.acquire(); f.retire();
    await expect(pending).rejects.toThrow("retired");
    expect(f.initialization.snapshot()).toMatchObject({ active: 0, queued: 0 }); expect(vi.getTimerCount()).toBe(0);
  });
  it("bounds lost readiness separately from numeric execution", async () => {
    const f = fixture(), pending = expect(f.port.acquire()).rejects.toThrow("preparation timeout");
    await tick(); await vi.advanceTimersByTimeAsync(15_001); await pending;
    expect(f.compute.snapshot().active).toBe(0); expect(f.initialization.snapshot().active).toBe(0); f.retire();
  });
});

 it("retires a late module after bounded startup failure instead of reusing unresolved I/O under compute admission", async () => {
    vi.useFakeTimers(); let loaded!: (value: { dispose(): void }) => void;
    const dispose = vi.fn(), bounded = boundedComputeModule(new Promise<{ dispose(): void }>(resolve => { loaded = resolve; }));
    const failed = expect(bounded).rejects.toThrow("startup-timeout"); await vi.advanceTimersByTimeAsync(5001); await failed;
    loaded({ dispose }); await tick(); expect(dispose).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
