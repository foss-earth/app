/** Earth starts the shared sky core's helper workers; Sky's evaluator owns and ends them. */
import type { SkyHelperGroup } from "@foss-earth/sky";

/**
 * Up to `count` helpers from `start`, which takes each from the page's worker
 * budget and returns null when none is left. None where this page cannot share
 * memory: the sky worker then reports its fallback and runs without helpers.
 */
export function startSkySharedHelpers(count: number, start: (index: number) => Worker | null): SkyHelperGroup | null {
  if (count < 1 || globalThis.crossOriginIsolated !== true || typeof SharedArrayBuffer !== "function" || typeof MessageChannel !== "function") return null;
  const workers: Worker[] = [];
  const ports: MessagePort[] = [];
  for (let index = 0; index < count; index++) {
    const worker = start(index);
    if (!worker) break;
    const channel = new MessageChannel();
    worker.postMessage({ kind: "sky-shared-port", port: channel.port2 }, [channel.port2]);
    workers.push(worker);
    ports.push(channel.port1);
  }
  if (!workers.length) return null;
  return { ports, terminate: () => { for (const worker of workers.splice(0)) worker.terminate(); } };
}
