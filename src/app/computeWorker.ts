import type { ComputeAdmissionPort, ComputeLease } from "@foss-earth/engine/browser";

/** Cache this bounded promise as the owner's loader result, so a preparation
 * timeout cannot leave numeric admission waiting on the same unresolved I/O. */
export function boundedComputeModule<T>(loading: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let expired = false;
    const timer = setTimeout(() => { expired = true; reject(new Error("startup-timeout")); }, 5000);
    void loading.then(value => {
      clearTimeout(timer);
      if (expired) { try { (value as { dispose?(): void })?.dispose?.(); } catch { /* Abandoned startup realm owns the remaining memory. */ } }
      else resolve(value);
    }, error => { clearTimeout(timer); reject(error); });
  });
}

/** Owner kernels retain their normal startup/fallback decisions. Preparation
 * only moves module I/O ahead of shared compute admission. The cached loader
 * still delivers its original result or failure to that kernel. */
export function installComputePreparation(prepare: () => Promise<unknown>): void {
  self.addEventListener("message", event => {
    if (event.data?.kind !== "earth-compute-prepare") return;
    event.stopImmediatePropagation();
    void Promise.resolve().then(prepare)
      .catch(() => { /* The numeric owner reports its genuine fallback. */ })
      .finally(() => { self.postMessage({ kind: "earth-compute-ready" }); });
  });
}

/** Module loading has its own bounded initialization lane, never a numeric
 * compute grant. No observer/timer exists until the first real request. */
export function workerComputePort(worker: Worker, compute: ComputeAdmissionPort, initialization: ComputeAdmissionPort): {
  port: ComputeAdmissionPort; retire(): void;
} {
  let preparing: Promise<void> | undefined, rejectPreparation: ((error: Error) => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined, initLease: ComputeLease | undefined;
  const abort = new AbortController();
  const onReady = (event: MessageEvent): void => {
    if (event.data?.kind !== "earth-compute-ready") return;
    event.stopImmediatePropagation(); finish?.();
  };
  let finish: (() => void) | undefined;
  worker.addEventListener("message", onReady);
  const prepare = (): Promise<void> => preparing ??= initialization.acquire({ signal: abort.signal }).then(lease => {
    if (abort.signal.aborted) { lease.release("retired"); throw new Error("Worker retired before preparation."); }
    initLease = lease;
    return new Promise<void>((resolve, reject) => {
      const done = (): void => { clearTimeout(timer); timer = undefined; initLease?.release(); initLease = undefined; rejectPreparation = undefined; };
      finish = () => { done(); resolve(); };
      rejectPreparation = error => { done(); reject(error); };
      timer = setTimeout(() => rejectPreparation?.(new Error("Worker preparation timeout.")), 15_000);
      try { worker.postMessage({ kind: "earth-compute-prepare" }); } catch { rejectPreparation(new Error("Worker preparation dispatch failed.")); }
    });
  });
  return {
    port: { async acquire(request = {}) {
      request.signal?.throwIfAborted();
      // A cancelled waiter detaches immediately even if module I/O continues.
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => { request.signal?.removeEventListener("abort", onAbort); reject(request.signal?.reason); };
        request.signal?.addEventListener("abort", onAbort, { once: true });
        void prepare().then(() => { request.signal?.removeEventListener("abort", onAbort); resolve(); }, error => { request.signal?.removeEventListener("abort", onAbort); reject(error); });
      });
      request.signal?.throwIfAborted();
      return compute.acquire(request);
    } },
    retire() { abort.abort(); rejectPreparation?.(new Error("Worker retired during preparation.")); initLease?.release("retired"); initLease = undefined; worker.removeEventListener("message", onReady); },
  };
}
