/** Earth projects saved host policies into borrowed owner services. */
import { MIB } from "@foss-earth/images";
import { DEFAULT_TERRAIN_LOADER_LIMITS, type TerrainPreparationPolicy } from "@foss-earth/engine";
import { createGlobeRuntimeBudgets } from "@foss-earth/engine/settings";
import { defaultReadinessPolicy } from "@foss-earth/renderer";
import type { DerivedDefault, DeviceContext, ParameterSpec, SettingsRegistry } from "@foss-earth/ui/settings";
import type { EarthBrowserRuntimeOptions } from "./browserRuntime";

/**
 * One terrain decode worker per hardware thread but the page's own, 1–16, and
 * at most 2 where the browser reports 1 GiB of memory or less.
 */
export function terrainDecodeWorkersDefault(context: Pick<DeviceContext, "hardwareConcurrency" | "deviceMemoryGiB">): DerivedDefault<number> {
  const threads = context.hardwareConcurrency;
  if (!threads) return { value: 3, derivedFrom: "3, because this browser does not say how many hardware threads the device has" };
  const value = Math.max(1, Math.min(16, threads - 1));
  if (context.deviceMemoryGiB !== null && context.deviceMemoryGiB <= 1 && value > 2) {
    return { value: 2, derivedFrom: `2, because the browser reports ${context.deviceMemoryGiB} GiB of memory` };
  }
  return { value, derivedFrom: `one for each of the ${threads} hardware threads the browser reports but the page's own${threads - 1 > 16 ? ", limited to 16" : ""}` };
}

export const TERRAIN_DECODE_WORKERS_PARAMETER: ParameterSpec = {
  id: "map.loader.decodeWorkers", label: "Elevation decode workers",
  description: "How many background threads decode elevation tiles at once; 0 decodes them on the page's own thread. The heights are the same either way.",
  kind: "number", unit: "count", default: terrainDecodeWorkersDefault, bounds: () => ({ min: 0, max: 16 }), step: 1,
  defaultReason: "Each worker takes the next tile when it finishes the last, so faster and slower cores each do what they can, and the page keeps a thread for drawing and input.",
  home: { tab: "map", section: "loading", level: "all" }, appliesLive: true,
  source: "src/app/browserPolicy.ts",
};

/** Existing inherited defaults are explicit host policy, available in their existing tabs. The decode workers follow the other elevation loader controls. */
export const EARTH_BROWSER_POLICY_PARAMETERS: readonly ParameterSpec[] = [
  ["scene.overview.minimumPreparationRadius", "Overview preparation minimum radius", 200, 1, 1000000, "m", "scenes", "motion"],
  ["scene.panorama.savedGroupsShown", "Saved image groups shown", 60, 0, 100000, "count", "scenes", "saved"],
  ["map.loader.requests", "Elevation loader requests", DEFAULT_TERRAIN_LOADER_LIMITS.maxConcurrent, 1, 64, "count", "map", "loading"],
  ["map.loader.cacheEntries", "Elevation loader cache entries", DEFAULT_TERRAIN_LOADER_LIMITS.cacheEntries, 1, 100000, "count", "map", "loading"],
  ["map.loader.timeout", "Elevation request timeout", DEFAULT_TERRAIN_LOADER_LIMITS.timeoutMs, 1, 600000, "ms", "map", "loading"],
  ["renderer.readiness.firstCheck", "First readiness check", defaultReadinessPolicy.firstCheckIntervalMs, 1, 60000, "ms", "renderer", "performance"],
  ["renderer.readiness.maximumCheck", "Maximum readiness check", defaultReadinessPolicy.maxCheckIntervalMs, 1, 60000, "ms", "renderer", "performance"],
  ["renderer.readiness.backoff", "Readiness backoff factor", defaultReadinessPolicy.backoffFactor, 1, 16, "none", "renderer", "performance"],
  ["map.preparation.minimumQuality", "Destination elevation quality", 10, 0, 30, "none", "map", "loading"],
  ["map.preparation.localCoverageBelow", "Local destination coverage below", 100, 0, 100000, "m", "map", "loading"],
  ["map.preparation.defaultHeight", "Default destination height", 1524, 0, 100000, "m", "map", "loading"],
  ["map.preparation.defaultClearance", "Default destination clearance", 1000, 0, 100000, "m", "map", "loading"],
].map(([id, label, value, min, max, unit, tab, section]): ParameterSpec => ({
  id: String(id), label: String(label), description: "Earth's explicit host policy for the supplied owner service.",
  kind: "number", unit: unit as "count" | "ms" | "none" | "m", default: Number(value),
  bounds: () => ({ min: Number(min), max: Number(max) }), ...(unit === "count" ? { step: 1 } : {}),
  defaultReason: "Retains the existing browser runtime's initial policy; no device recommendation is implied.",
  home: { tab: String(tab), section: String(section), level: "all" }, appliesLive: true,
  source: "src/app/browserPolicy.ts",
})).flatMap(spec => spec.id === "map.loader.timeout" ? [spec, TERRAIN_DECODE_WORKERS_PARAMETER] : [spec]);

export function createEarthBrowserPolicy(settings: SettingsRegistry): Pick<EarthBrowserRuntimeOptions,
  "imageSessionLimits" | "imageTransferLimits" | "imageUploadLimits" | "resourceParameterIds" |
  "terrainLoaderLimits" | "terrainPreparation" | "readinessPolicy" | "describeMapTransfer" |
  "mapPriority" | "createWorker" | "createTerrainWorker" | "terrainDecodeWorkers" | "onFrameError"> {
  const n = (id: string) => settings.get<number>(id);
  const p = (suffix: string) => n(`scene.panorama.${suffix}`);
  const count = (suffix: string) => Math.max(1, Math.round(p(suffix)));
  const budgets = createGlobeRuntimeBudgets(settings);
  const altitude: TerrainPreparationPolicy["fallback"] = (request, groundHeightMeters) => ({
    groundHeightMeters,
    altitudeMeters: Math.max(request.altitudeMeters ?? -Infinity,
      groundHeightMeters + (request.altitudeAboveGroundMeters ?? (request.altitudeMeters === undefined ? n("map.preparation.defaultHeight") : 0)),
      groundHeightMeters + (request.clearanceMeters ?? n("map.preparation.defaultClearance"))),
  });
  // Coarser elevation keeps every terrain tile that many levels from its own
  // elevation, so a destination asks for that many levels less.
  const requiredQuality = () => n("map.preparation.minimumQuality") - Math.max(0, Math.round(n("map.terrain.coarserElevation")) || 0);
  const terrainPreparation: TerrainPreparationPolicy = {
    ...budgets,
    fallback: altitude,
    requiredRasterQuality: requiredQuality,
    evaluate(request, samples, google, settled) {
      const isReady = (hit: typeof samples[number]) => !!hit && Number.isFinite(hit.heightMeters) && (google ? settled : hit.quality >= requiredQuality());
      const center = samples[0] ?? null;
      const centerReady = isReady(center);
      const centerHeight = centerReady ? altitude(request, center!.heightMeters).altitudeMeters : null;
      const local = !centerReady || centerHeight === null || centerHeight - center!.heightMeters < n("map.preparation.localCoverageBelow");
      const required = local ? samples : samples.slice(0, 1);
      const readySamples = required.filter(isReady).length;
      const present = required.filter(Boolean).length;
      const ready = required.length > 0 && readySamples === required.length;
      const progress = { phase: ready ? "checking" as const : present ? "refining" as const : "loading" as const,
        readySamples, totalSamples: required.length,
        progress: required.length ? (present * 0.2 + readySamples * 0.75) / required.length : 0,
        message: ready ? "Checking terrain clearance…" : present ? "Waiting for displayed destination terrain." : "Waiting for terrain coverage.",
      };
      if (!ready) return { progress, result: null };
      const result = altitude(request, center!.heightMeters);
      if (request.clearanceMeters !== 0) result.altitudeMeters = Math.max(result.altitudeMeters,
        Math.max(...required.map(hit => hit!.heightMeters)) + (request.clearanceMeters ?? n("map.preparation.defaultClearance")));
      return { progress, result };
    },
  };
  return {
    imageSessionLimits: () => ({ pools: { sourceGpu: p("sourceGpuMiB") * MIB,
      overlap: p("overlapMiB") * MIB, decoded: p("decodedMiB") * MIB,
      encoded: p("encodedMiB") * MIB, uploadOutstanding: p("uploadOutstandingMiB") * MIB },
      requests: count("requests"), decodes: count("decodes") }),
    imageTransferLimits: () => ({ responseBytes: p("responseMiB") * MIB, timeoutMs: p("requestTimeout") * 1000 }),
    imageUploadLimits: () => ({ bytesPerFrame: p("uploadMiBPerFrame") * MIB, outstandingBytes: p("uploadOutstandingMiB") * MIB }),
    resourceParameterIds: ["sourceGpuMiB", "overlapMiB", "decodedMiB", "encodedMiB", "uploadOutstandingMiB", "requests", "decodes", "responseMiB", "requestTimeout", "uploadMiBPerFrame"].map(s => `scene.panorama.${s}`),
    terrainLoaderLimits: () => ({ maxConcurrent: n("map.loader.requests"), cacheEntries: n("map.loader.cacheEntries"), timeoutMs: n("map.loader.timeout") }),
    terrainPreparation,
    readinessPolicy: { get firstCheckIntervalMs() { return n("renderer.readiness.firstCheck"); },
      get maxCheckIntervalMs() { return Math.max(n("renderer.readiness.firstCheck"), n("renderer.readiness.maximumCheck")); },
      get backoffFactor() { return n("renderer.readiness.backoff"); } },
    // Compressed response size is unknown. Common transport reserves each chunk before allocation.
    describeMapTransfer: () => ({ declaredBytes: 0 }), mapPriority: () => 0,
    createWorker: () => typeof Worker === "undefined" ? null : new Worker(new URL("./atlasImagery.worker.ts", import.meta.url), { type: "module" }),
    createTerrainWorker: () => typeof Worker === "undefined" ? null : new Worker(new URL("./terrainDecode.worker.ts", import.meta.url), { type: "module" }),
    terrainDecodeWorkers: () => n("map.loader.decodeWorkers"),
    onFrameError: error => console.error("Earth frame failed", error),
  };
}
