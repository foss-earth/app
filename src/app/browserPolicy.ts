/** Earth projects saved host policies into borrowed owner services. */
import { MIB } from "@foss-earth/images";
import { DEFAULT_TERRAIN_LOADER_LIMITS, type TerrainPreparationPolicy } from "@foss-earth/engine";
import { createGlobeRuntimeBudgets, wasmCorePlan, terrainDecoderTier } from "@foss-earth/engine/settings";
import { createSkyWorkerEvaluator } from "@foss-earth/sky";
import { defaultReadinessPolicy } from "@foss-earth/renderer";
import type { DerivedDefault, DeviceContext, ParameterSpec, SettingsRegistry } from "@foss-earth/ui/settings";
import type { EarthBrowserRuntimeOptions } from "./browserRuntime";
import { startSkySharedHelpers } from "./skySharedHelpers";
import { skyWorkerName } from "./skyWorkerConfig";
import { terrainMeshWorkerName } from "./terrainMeshWorkerConfig";
import { TERRAIN_SHARED_HEIGHTS_PARAMETER } from "./terrainWasmWorkerConfig";
import { createComputeAdmission } from "@foss-earth/engine/browser";
import { workerComputePort } from "./computeWorker";

export { TERRAIN_SHARED_HEIGHTS_PARAMETER };

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

/** Existing inherited defaults are explicit host policy, available in their existing tabs. The decode worker count follows the other elevation loader controls; shared heights belong to Component execution. */
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
})).flatMap(spec => spec.id === "map.loader.timeout" ? [spec, TERRAIN_DECODE_WORKERS_PARAMETER] : [spec]).concat(TERRAIN_SHARED_HEIGHTS_PARAMETER as ParameterSpec);

export function createEarthBrowserPolicy(settings: SettingsRegistry): Pick<EarthBrowserRuntimeOptions,
  "imageSessionLimits" | "imageTransferLimits" | "imageUploadLimits" | "resourceParameterIds" |
  "terrainLoaderLimits" | "terrainPreparation" | "readinessPolicy" | "describeMapTransfer" |
  "mapPriority" | "createWorker" | "createTerrainWorker" | "terrainDecodeWorkers" | "createTerrainMeshWorker" | "terrainMeshWorkers" | "createTerrainHeightWorker" | "createGoogleWorker" | "createGroundWorker" | "createSkyEvaluator" | "wasmPlans" | "computeScheduling" | "onFrameError"> {
  const n = (id: string) => settings.get<number>(id);
  const p = (suffix: string) => n(`scene.panorama.${suffix}`);
  const count = (suffix: string) => Math.max(1, Math.round(p(suffix)));
  const budgets = createGlobeRuntimeBudgets(settings);
  // Read once: WASM execution applies from the next reload.
  const wasmPlans = { raster: wasmCorePlan(settings, "raster"), sky: wasmCorePlan(settings, "sky"), terrain: wasmCorePlan(settings, "terrain"),
    imagery: wasmCorePlan(settings, "imagery"), google: wasmCorePlan(settings, "google"), ground: wasmCorePlan(settings, "ground") };
  const wasmTier = terrainDecoderTier(wasmPlans.raster);
  // Read once: decode workers are told at startup. Each still checks its realm can share.
  // Only mesh workers read whole grids; for targets on the page a transfer already costs nothing.
  const sharedHeights = settings.get<boolean>(TERRAIN_SHARED_HEIGHTS_PARAMETER.id) === true && wasmPlans.terrain.placement === "worker";
  let nextTerrainWorker = 0;
  let nextTerrainMeshWorker = 0;
  const workerLimit = Math.max(1, Math.round(n("wasm.workers")));
  const fixed = settings.get("wasm.compute") === "fixed";
  const requestedComputeLanes = n("wasm.computeLanes");
  const compute = fixed ? createComputeAdmission({ limit: Math.min(workerLimit, requestedComputeLanes), now: () => performance.now(), agingMs: n("wasm.computeAging"), observe: settings.get("wasm.computeObserve") === true }) : null;
  const initialization = fixed ? createComputeAdmission({ limit: Math.min(workerLimit, n("wasm.computeInitialization")), now: () => performance.now() }) : null;
  const activeWorkers = new Set<Worker>();
  const activeDecoders = new Set<Worker>();
  const reserved = 1 + Number(wasmPlans.sky.placement === "worker") + Number(wasmPlans.imagery.placement === "worker")
    + Number(wasmPlans.google.placement === "worker") + Number(wasmPlans.ground.placement === "worker")
    + (wasmPlans.terrain.placement === "worker" ? wasmPlans.terrain.parallelism === "serial" ? 1 : 2 : 0)
    // A threaded sky's helpers are workers from the same budget; a page that
    // cannot share memory starts none, so it keeps their slots for decoding.
    + (wasmPlans.sky.sharedMemory && globalThis.crossOriginIsolated === true ? wasmPlans.sky.threads - 1 : 0);
  // A pool that is refused a worker decodes every later tile on the page, so
  // the decode pool never asks for more workers than the budget leaves it.
  const decoderSlots = Math.max(0, workerLimit - reserved);
  const budgeted = (factory: () => Worker, decoder = false, component = "atlas"): Worker | null => {
    if (typeof Worker === "undefined" || activeWorkers.size >= workerLimit) return null;
    // Reserve dedicated-core slots before the decode pool fills, so a forced
    // WASM core can start when its first batch arrives later in startup.
    if (decoder && activeDecoders.size >= decoderSlots) return null;
    const worker = factory(), terminate = worker.terminate.bind(worker);
    const admission = compute && initialization ? workerComputePort(worker, compute.port(component, component === "height-cache" ? -1 : 0), initialization.port("initialization")) : null;
    if (admission) Object.defineProperty(worker, "compute", { value: admission.port });
    activeWorkers.add(worker);
    if (decoder) activeDecoders.add(worker);
    worker.terminate = () => { activeWorkers.delete(worker); activeDecoders.delete(worker); try { terminate(); } finally { admission?.retire(); } };
    return worker;
  };
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
    createWorker: () => budgeted(() => new Worker(new URL("./atlasImagery.worker.ts", import.meta.url), { type: "module" })),
    createTerrainWorker: () => budgeted(() => new Worker(new URL("./terrainDecode.worker.ts", import.meta.url), {
      type: "module", name: JSON.stringify({ kind: "earth-terrain", id: `terrain-${++nextTerrainWorker}`, wasmTier, sharedHeights }),
    }), true, "raster"),
    terrainDecodeWorkers: () => Math.min(decoderSlots, wasmPlans.raster.parallelism === "serial" ? Math.min(1, n("map.loader.decodeWorkers")) : n("map.loader.decodeWorkers")),
    createTerrainMeshWorker: () => wasmPlans.terrain.placement === "original" ? null : budgeted(() => new Worker(new URL("./terrainMesh.worker.ts", import.meta.url), {
      type: "module", name: terrainMeshWorkerName(wasmPlans.terrain.kernel, `terrain-mesh-${++nextTerrainMeshWorker}`),
    }), false, "terrain"),
    terrainMeshWorkers: () => Math.min(wasmPlans.terrain.parallelism === "serial" ? 1 : 2, n("map.loader.decodeWorkers")),
    createTerrainHeightWorker: () => wasmPlans.imagery.placement === "original" ? null
      : budgeted(() => new Worker(new URL("./terrainHeights.worker.ts", import.meta.url), { type: "module", name: wasmPlans.imagery.kernel }), false, "height-cache"),
    createGoogleWorker: () => wasmPlans.google.placement === "original" ? null
      : budgeted(() => new Worker(new URL("./googlePreparation.worker.ts", import.meta.url), { type: "module", name: wasmPlans.google.kernel }), false, "google"),
    createGroundWorker: () => wasmPlans.ground.placement === "original" ? null
      : budgeted(() => new Worker(new URL("./groundBvh.worker.ts", import.meta.url), { type: "module", name: wasmPlans.ground.kernel }), false, "ground"),
    // The original sky evaluates on the page; the A/B arms both evaluate in one sky worker.
    createSkyEvaluator: () => wasmPlans.sky.placement === "original" ? null : createSkyWorkerEvaluator({
      kernel: wasmPlans.sky.kernel,
      createWorker: () => budgeted(() => new Worker(new URL("./skyEvaluation.worker.ts", import.meta.url), {
        type: "module", name: skyWorkerName(wasmPlans.sky.kernel, wasmPlans.sky.threads),
      }), false, "sky"),
      createHelpers: wasmPlans.sky.sharedMemory ? () => startSkySharedHelpers(wasmPlans.sky.threads - 1,
        index => budgeted(() => new Worker(new URL("./skySharedHelper.worker.ts", import.meta.url), { type: "module", name: `earth-sky-helper-${index + 1}` }))) : undefined,
      now: () => performance.now(),
      timers: { set: (callback, delayMs) => setTimeout(callback, delayMs), clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) },
    }),
    wasmPlans,
    computeScheduling: { snapshot: () => ({ requested: fixed ? "fixed" as const : "legacy" as const, requestedLanes: requestedComputeLanes,
      liveWorkers: activeWorkers.size, topology: { logicalConcurrency: settings.getDeviceContext().hardwareConcurrency, efficiencyCores: null, source: "browser-logical-only" as const },
      admission: compute?.snapshot() ?? null }), dispose() { compute?.dispose(); initialization?.dispose(); } },
    onFrameError: error => console.error("Earth frame failed", error),
  };
}
