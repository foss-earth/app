import type { BaseTexture } from "@babylonjs/core";
import { checkUntilSettled, type ReadinessPolicy, type ReadinessTimers } from "@foss-earth/renderer";

/** Settles once the renderer can sample `texture`, checking on the host's readiness schedule without drawing. */
export function textureReadiness(timers: ReadinessTimers, policy: ReadinessPolicy) {
  return (texture: BaseTexture, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    if (texture.isReady()) { resolve(); return; }
    let ended = false, stop = () => {};
    const finish = (failed: boolean, error?: unknown) => {
      if (ended) return; ended = true; stop(); signal.removeEventListener("abort", abort);
      if (failed) reject(error); else resolve();
    };
    const abort = () => finish(true, signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    try {
      stop = checkUntilSettled(1, () => {
        try { return texture.isReady() ? 0 : 1; }
        catch (error) { finish(true, error); return 0; }
      }, () => finish(false), timers, policy);
    } catch (error) { finish(true, error); }
    if (signal.aborted) abort();
  });
}
