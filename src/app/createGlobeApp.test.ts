// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GlobeViewState } from "../engine/types";

const mockState = vi.hoisted(() => ({
  frameCallback: null as (() => void) | null,
  removeObserver: vi.fn(),
  createBabylonRuntime: vi.fn(),
  runtimeDestroy: vi.fn(),
  getViewState: vi.fn(),
  setViewState: vi.fn(),
  configureOrbitTargetHeight: vi.fn(),
  runtimeGetTileMetrics: vi.fn(),
  poiExitTracking: vi.fn(),
  poiGetOrbitTarget: vi.fn(),
  poiDestroy: vi.fn(),
  registryAddLayer: vi.fn(),
  registryRemoveLayer: vi.fn(),
  registryDestroy: vi.fn(),
  compassUpdate: vi.fn(),
  compassDestroy: vi.fn(),
  cullingUpdate: vi.fn(),
  cullingGetStats: vi.fn(),
  cullingDestroy: vi.fn(),
  perfUpdate: vi.fn(),
  perfFormat: vi.fn(),
  resolveAnchorHeight: vi.fn(),
  resolveAnchorHeightMeters: vi.fn(),
  clearAnchorHeights: vi.fn(),
}));

vi.mock("../engine/babylon/createBabylonRuntime", () => ({
  createBabylonRuntime: mockState.createBabylonRuntime,
}));

vi.mock("../layers/poiTracking", () => ({
  createPoiTracking: () => ({
    setPois: vi.fn(),
    enterTracking: vi.fn(),
    exitTracking: mockState.poiExitTracking,
    isTracking: vi.fn(() => false),
    getOrbitTarget: mockState.poiGetOrbitTarget,
    destroy: mockState.poiDestroy,
  }),
}));

vi.mock("../layers/layerRegistry", () => ({
  createLayerRegistry: () => ({
    addLayer: mockState.registryAddLayer,
    removeLayer: mockState.registryRemoveLayer,
    destroy: mockState.registryDestroy,
  }),
}));

vi.mock("../visualization/orbitCompass", () => ({
  createOrbitCompass: () => ({
    update: mockState.compassUpdate,
    isMesh: vi.fn(() => false),
    destroy: mockState.compassDestroy,
  }),
}));

vi.mock("../perf/culling", () => ({
  createHemisphereCulling: () => ({
    setCullables: vi.fn(),
    update: mockState.cullingUpdate,
    getStats: mockState.cullingGetStats,
    destroy: mockState.cullingDestroy,
  }),
}));

vi.mock("../perf/metrics", () => ({
  createPerformanceMetrics: () => ({
    update: mockState.perfUpdate,
    getSnapshot: vi.fn(),
    format: mockState.perfFormat,
  }),
}));

vi.mock("../terrain/anchorHeight", () => ({
  createAnchorHeightResolver: () => ({
    resolve: mockState.resolveAnchorHeight,
    resolveHeight: mockState.resolveAnchorHeightMeters,
    setSample: vi.fn(),
    getCachedHeight: vi.fn(() => null),
    clear: mockState.clearAnchorHeights,
  }),
}));

const viewState: GlobeViewState = {
  latDeg: 44.977753,
  lonDeg: -93.265011,
  headingDeg: 17,
  pitchDeg: 71,
  zoomMeters: 600,
};

async function createAppUnderTest() {
  const { createGlobeApp } = await import("./createGlobeApp");
  const root = document.createElement("div");
  document.body.append(root);
  const app = await createGlobeApp(root);
  return { app, root };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockState.frameCallback = null;
  document.body.replaceChildren();
  window.history.replaceState(null, "", "/");
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    json: async () => ({ object: { sha: "8b0ab4ed380c4c57f87a1f0da8830e19e305df70" } }),
  })));

  mockState.getViewState.mockReturnValue(viewState);
  mockState.runtimeGetTileMetrics.mockReturnValue({ visibleTiles: 3, activeTiles: 5 });
  mockState.poiGetOrbitTarget.mockReturnValue(null);
  mockState.cullingUpdate.mockReturnValue({ total: 4, visible: 3, hidden: 1 });
  mockState.cullingGetStats.mockReturnValue({ total: 4, visible: 3, hidden: 1 });
  mockState.perfUpdate.mockReturnValue({});
  mockState.perfFormat.mockReturnValue("Perf: 60fps 16.7ms p95 18.2ms a42 t3/5 c3/4");
  mockState.resolveAnchorHeight.mockReturnValue({ x: 9, y: 0, z: 0 });
  mockState.resolveAnchorHeightMeters.mockReturnValue(264);
  mockState.createBabylonRuntime.mockResolvedValue({
    engine: { getFps: () => 60 },
    scene: {
      onBeforeRenderObservable: {
        add: vi.fn((callback: () => void) => {
          mockState.frameCallback = callback;
          return { id: "before-render" };
        }),
        remove: mockState.removeObserver,
      },
    },
    renderer: { mode: "webgl" },
    status: {
      mode: "fallback",
      message: "Fallback mode active.",
      googleApiKeyProvided: false,
      lastError: null,
    },
    geospatialCamera: {
      center: { x: 1, y: 0, z: 0 },
      globalPosition: { x: 2, y: 0, z: 0 },
      radius: 600,
    },
    getViewState: mockState.getViewState,
    setViewState: mockState.setViewState,
    configureOrbitTargetHeight: mockState.configureOrbitTargetHeight,
    getTileMetrics: mockState.runtimeGetTileMetrics,
    destroy: mockState.runtimeDestroy,
  });
});

describe("createGlobeApp smoke behavior", () => {
  it("boots the fallback shell and updates HUD/perf state on the frame callback", async () => {
    const { root } = await createAppUnderTest();

    expect(mockState.createBabylonRuntime).toHaveBeenCalledWith(
      expect.any(HTMLCanvasElement),
      expect.objectContaining({ googleApiKey: null }),
    );
    expect(root.querySelector("#runtimeModePill")?.textContent).toBe("Tiles: Fallback");
    expect(root.querySelector("#settingsBuildLine")?.textContent).toMatch(
      /^Build: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
    );
    expect(root.querySelector("#settingsSourceLine")?.textContent).toMatch(/^Source: [\w.-]+$/);
    expect(root.querySelector("#settingsBundleLine")?.textContent).toMatch(/^Bundle: (dev|index-[\w-]+\.js)$/);
    await vi.waitFor(() => {
      expect(root.querySelector("#settingsDeployLine")?.textContent).toBe("Deploy: 8b0ab4ed380c");
    });
    expect(mockState.configureOrbitTargetHeight).toHaveBeenCalledWith({
      resolveSurfaceHeightMeters: mockState.resolveAnchorHeightMeters,
      initialOffsetMeters: 1_000,
    });

    mockState.frameCallback?.();

    expect(root.querySelector("#hudStatus")?.textContent).toContain("44.9778°N");
    expect(root.querySelector("#perfMetricsPill")?.textContent).toBe("Perf: 60fps 16.7ms p95 18.2ms a42 t3/5 c3/4");
    expect(mockState.resolveAnchorHeight).toHaveBeenCalledWith({ x: 1, y: 0, z: 0 });
    expect(mockState.compassUpdate).toHaveBeenCalledWith({ x: 9, y: 0, z: 0 }, 600);
  });

  it("passes URL API keys through runtime startup", async () => {
    window.history.replaceState(null, "", "/?key=test-key");

    await createAppUnderTest();

    expect(mockState.createBabylonRuntime).toHaveBeenCalledWith(
      expect.any(HTMLCanvasElement),
      expect.objectContaining({ googleApiKey: "test-key" }),
    );
  });

  it("exits POI tracking before north-up reset", async () => {
    const { root } = await createAppUnderTest();

    root.querySelector<HTMLButtonElement>("#northButton")?.click();

    expect(mockState.poiExitTracking).toHaveBeenCalledTimes(1);
    expect(mockState.setViewState).toHaveBeenCalledWith({ headingDeg: 0, pitchDeg: 89 });
  });

  it("delegates layer lifecycle through the registry", async () => {
    const { app } = await createAppUnderTest();
    const layer = {
      id: "smoke-layer",
      setup: vi.fn(() => ({})),
      destroy: vi.fn(),
    };

    app.addLayer(layer);
    app.removeLayer("smoke-layer");

    expect(mockState.registryAddLayer).toHaveBeenCalledWith(layer);
    expect(mockState.registryRemoveLayer).toHaveBeenCalledWith("smoke-layer");
  });

  it("tears down observers, feature handles, runtime, and DOM", async () => {
    const { app, root } = await createAppUnderTest();

    app.destroy();

    expect(mockState.removeObserver).toHaveBeenCalledWith({ id: "before-render" });
    expect(mockState.poiDestroy).toHaveBeenCalledTimes(1);
    expect(mockState.registryDestroy).toHaveBeenCalledTimes(1);
    expect(mockState.cullingDestroy).toHaveBeenCalledTimes(1);
    expect(mockState.compassDestroy).toHaveBeenCalledTimes(1);
    expect(mockState.runtimeDestroy).toHaveBeenCalledTimes(1);
    expect(root.childElementCount).toBe(0);
  });
});