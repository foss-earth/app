// Functions run inside the FOSS Earth page. Each is self-contained: it is sent
// as source text with JSON arguments, and returns plain data. They use the
// handle the app exposes with ?bench=1 (window.__fossEarthBench), and, to
// change a setting live, the settings it exposes with ?panoramaTest=1, so
// nothing here ships to ordinary visits.

/** Calls `fn(arg)` in the page and returns its value. */
export function inPage(page, fn, arg) {
  return page.evaluate(`(${fn.toString()})(${JSON.stringify(arg ?? null)})`);
}

/** The app's, scenery's and sky's state, as readiness signals. */
export function probe() {
  const doc = document;
  const runtime = window.__fossEarthBench?.runtime ?? null;
  const overlay = Boolean(doc.querySelector(".foss-earth-overlay-root"));
  if (!runtime) return { phase: "starting", overlay, readyState: doc.readyState, recovery: Boolean(doc.querySelector("[data-browser-recovery], .browser-recovery")) };
  const status = runtime.status ?? {};
  const env = runtime.sky?.getEnvironment?.() ?? null;
  const metrics = runtime.getTileMetrics?.() ?? null;
  const terrain = runtime.getGoogleTerrainDetailState?.() ?? null;
  const snapshot = runtime.captureNavigationSnapshot?.() ?? null;
  const camera = runtime.geospatialCamera ?? null;
  const engine = runtime.scene?.getEngine?.() ?? null;
  const canvas = engine?.getRenderingCanvas?.() ?? null;
  const night = env?.nightLights ?? null;
  const flare = env?.lensFlare ?? null;
  // renderer.exposureEV as drawn: the factor every image-processed material is multiplied by.
  const processing = runtime.scene?.imageProcessingConfiguration ?? null;
  let gl = null;
  try { gl = engine?.getGlInfo?.() ?? null; } catch { gl = null; }
  const finite = value => (typeof value === "number" && Number.isFinite(value) ? value : value === Infinity ? "Infinity" : null);
  return {
    phase: "running",
    overlay,
    status: { mode: status.mode ?? null, message: status.message ?? null, lastError: status.lastError ?? null, googleApiKeyProvided: Boolean(status.googleApiKeyProvided),
      terrainSource: status.terrainSource?.id ?? status.terrainSource?.name ?? (typeof status.terrainSource === "string" ? status.terrainSource : null) },
    streaming: Boolean(runtime.isStreamingTiles?.()),
    tiles: metrics ? { visibleTiles: metrics.visibleTiles ?? null, activeTiles: metrics.activeTiles ?? null } : null,
    terrain: terrain ? { errorTarget: finite(terrain.errorTarget), loadedErrorTarget: finite(terrain.loadedErrorTarget), defaultErrorTarget: finite(terrain.defaultErrorTarget) } : null,
    sky: env ? {
      model: env.model, utcMs: env.illumination.utcMs,
      observer: { latDeg: env.illumination.observer.latDeg, lonDeg: env.illumination.observer.lonDeg, altitudeMeters: env.illumination.observer.altitudeMeters },
      sunDirection: [...env.illumination.sunDirection], sunAzimuthDeg: env.illumination.sunAzimuthDeg,
      sunElevationDeg: env.illumination.sunElevationDeg, geometricElevationDeg: env.illumination.geometricElevationDeg,
      ev100: env.ev100, meteredEv100: env.meteredEv100, adaptedEv100: env.adaptedEv100, exposureHeld: env.exposureHeld,
      // 0 meters the light at the eye, 1 the ground below it (sky.exposure.groundMeterAltitude); absent before that setting.
      meterGroundShare: finite(env.meterGroundShare),
      starCatalogue: env.starCatalogue, computations: env.cost?.computations ?? null, direct: env.direct,
      nightLights: night ? { mode: night.mode, needed: night.state.needed, here: night.state.here, loading: night.state.loading, failed: night.state.failed,
        pending: night.state.pending !== null, window: night.state.window !== null, error: night.state.error, switchSunDeg: night.switchSunDeg } : null,
      // Absent before sky.exposure.lensFlare existed; read live, so it includes GPU work finished after the sky's computation.
      lensFlare: flare ? { mode: flare.mode ?? null, status: flare.status ?? null, settled: flare.settled === true, reason: flare.reason ?? null,
        sources: (flare.sources ?? []).map(source => ({ id: source.id, visibleFraction: finite(source.visibleFraction), stopsOverWhite: finite(source.stopsOverWhite),
          pixel: source.pixel ? { x: source.pixel.x, y: source.pixel.y } : null })) } : null,
    } : null,
    exposureCompensationEv: processing && processing.exposure > 0 ? Math.log2(processing.exposure) : null,
    camera: snapshot?.camera ? { center: [snapshot.camera.center.x, snapshot.camera.center.y, snapshot.camera.center.z], yaw: snapshot.camera.yaw, pitch: snapshot.camera.pitch, radius: snapshot.camera.radius, fov: snapshot.camera.fov } : null,
    eye: camera?.position ? [camera.position.x, camera.position.y, camera.position.z] : null,
    fovMode: camera?.fovMode ?? null,
    canvas: canvas ? { width: canvas.width, height: canvas.height, clientWidth: canvas.clientWidth, clientHeight: canvas.clientHeight } : null,
    viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
    worldPresentation: doc.documentElement.dataset.worldPresentation ?? null,
    fontsLoaded: doc.fonts ? doc.fonts.status === "loaded" : true,
    renderer: { mode: runtime.renderer?.mode ?? runtime.renderer?.backend ?? null, webgpu: Boolean(engine?.isWebGPU), webglVersion: engine?.webGLVersion ?? null,
      gpu: gl ? `${gl.vendor ?? ""} | ${gl.renderer ?? ""}` : null, hardwareScaling: engine?.getHardwareScalingLevel?.() ?? null },
  };
}

/**
 * Puts the camera's orbit centre one short reach in front of the eye, as the
 * engine's own placed views do, so the eye is where the scenario says and
 * looks where it says. Uses the public snapshot restore, which needs no lease.
 */
export function placeCamera({ center, yaw, pitch, radius, fov }) {
  const runtime = window.__fossEarthBench.runtime;
  const current = runtime.captureNavigationSnapshot();
  if (!current) throw new Error("The runtime has no navigation snapshot yet");
  const restored = runtime.restoreNavigationSnapshot({ ...current, camera: { center: { x: center[0], y: center[1], z: center[2] }, yaw, pitch, radius, fov } });
  runtime.requestRender?.();
  const after = runtime.captureNavigationSnapshot()?.camera ?? null;
  return { restored, after: after && { center: [after.center.x, after.center.y, after.center.z], yaw: after.yaw, pitch: after.pitch, radius: after.radius, fov: after.fov } };
}

/**
 * Capture-only presentation: hides every control and window, keeps the globe
 * canvas and the basemap's attribution chip. Opaque windows are removed from
 * layout (not only hidden) because the engine masks the world under them.
 * Returns what remains visible and the attribution shown.
 */
export function hideInterface({ keepAttribution }) {
  const doc = document, root = doc.documentElement;
  const runtime = window.__fossEarthBench.runtime;
  const canvas = runtime.scene.getEngine().getRenderingCanvas();
  canvas.setAttribute("data-capture-scene-canvas", "");
  root.setAttribute("data-capture-scene", "");
  let style = doc.getElementById("capture-scene-style");
  if (!style) {
    style = doc.createElement("style");
    style.id = "capture-scene-style";
    doc.head.append(style);
  }
  const scope = "html[data-capture-scene]";
  const text = [
    `${scope} body * { visibility: hidden !important; }`,
    `${scope} [data-occlude-world], ${scope} #app-log { display: none !important; }`,
    `${scope} canvas[data-capture-scene-canvas] { visibility: visible !important; }`,
    `${scope} * { cursor: none !important; caret-color: transparent !important; }`,
    ...(keepAttribution ? [
      `${scope} .map-source-hud__chip, ${scope} .map-source-hud__chip * { visibility: visible !important; animation: none !important; transition: none !important; }`,
      // The provider's mark, name and attribution link stay; its download rate, warning and detail rail are controls.
      `${scope} .map-source-hud__chip :is(.map-download-speed, .map-source-hud__warning, .map-detail-control),
       ${scope} .map-source-hud__chip :is(.map-download-speed, .map-source-hud__warning, .map-detail-control) * { visibility: hidden !important; }`,
      `${scope} .map-source-hud__chip :focus { outline: none !important; }`,
    ] : []),
  ].join("\n");
  // Called on every readiness poll: only a change restyles the page.
  if (style.textContent !== text) style.textContent = text;
  if (doc.activeElement instanceof HTMLElement && doc.activeElement !== doc.body) doc.activeElement.blur();
  return inspectInterface();

  function inspectInterface() {
    const shown = element => {
      const check = element.checkVisibility;
      if (typeof check === "function" && !check.call(element, { visibilityProperty: true, opacityProperty: true })) return false;
      const rect = element.getBoundingClientRect();
      return rect.width >= 1 && rect.height >= 1 && rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight;
    };
    const chip = doc.querySelector(".map-source-hud__chip");
    const offenders = [];
    for (const element of doc.body.querySelectorAll("*")) {
      if (element === canvas || element.contains(canvas)) continue;
      if (keepAttribution && chip && (chip.contains(element) || element.contains(chip))) continue;
      // Text or a box drawn by this element itself, not by a visible descendant.
      if (!shown(element)) continue;
      const style = getComputedStyle(element);
      if (style.visibility !== "visible") continue;
      offenders.push(`${element.tagName.toLowerCase()}${element.id ? "#" + element.id : ""}${typeof element.className === "string" && element.className ? "." + element.className.trim().split(/\s+/).slice(0, 3).join(".") : ""}`);
      if (offenders.length >= 12) break;
    }
    const covers = [...doc.querySelectorAll("[data-occlude-world], #app-log")].filter(element => {
      const rect = element.getBoundingClientRect();
      return rect.width >= 1 && rect.height >= 1;
    }).length;
    const credit = chip?.querySelector(".map-source-hud__credit");
    const label = chip?.querySelector(".map-source-label");
    const wordmark = chip?.querySelector(".map-source-hud__wordmark:not([hidden])");
    const rect = chip?.getBoundingClientRect();
    const images = chip ? [...chip.querySelectorAll("img")].filter(image => !image.closest("[hidden]") && shown(image)) : [];
    return {
      offenders, covers,
      attribution: chip ? {
        shown: shown(chip), label: label?.textContent?.trim() ?? null, wordmark: Boolean(wordmark),
        imagesLoaded: images.every(image => image.complete && image.naturalWidth > 0),
        credit: credit?.getAttribute("title") ?? null, creditHref: credit?.getAttribute("href") ?? null,
        rect: rect && { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      } : null,
    };
  }
}

/**
 * Capture-only: hides the scene's own overlays, such as the horizon compass's
 * letters (meshes named orbit-compass-*), which are drawn in the world rather
 * than in the page. Their owners toggle them with setEnabled, never with
 * isVisible, so this holds until the page is closed.
 */
export function hideSceneMeshes({ prefixes }) {
  const scene = window.__fossEarthBench.runtime.scene;
  const hidden = [];
  let changed = false;
  for (const mesh of scene.meshes) {
    if (!prefixes.some(prefix => mesh.name.startsWith(prefix))) continue;
    if (mesh.isVisible) { mesh.isVisible = false; changed = true; }
    hidden.push(mesh.name);
  }
  if (changed) window.__fossEarthBench.runtime.requestRender?.();
  return hidden.sort();
}

/**
 * Sets an app parameter as its control would, through the settings registry
 * the app exposes with ?panoramaTest=1. That flag adds the handle and changes
 * nothing else. The value replaces one given in the page's address.
 */
export function setSetting({ id, value }) {
  const settings = window.__fossEarthPanoramaTest?.settings;
  if (!settings) return { ok: false, reason: "the page exposes no settings (it needs ?panoramaTest=1)", value: null };
  const result = settings.set(id, value);
  window.__fossEarthBench?.runtime?.requestRender?.();
  return { ok: result.ok, reason: result.ok ? null : result.reason, value: settings.get(id) };
}

/** Asks for a frame and waits until two have been presented. */
export function settleFrames() {
  window.__fossEarthBench.runtime.requestRender?.();
  return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))));
}
