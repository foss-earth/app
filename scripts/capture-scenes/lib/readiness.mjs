// Whether a probe of the page shows the scene as the scenario asks, fully
// loaded. `problems` are failures the wait cannot fix (the wrong source, the
// camera moved); `waiting` are loads still under way. The fingerprint changes
// whenever anything that shows in the picture changes, so a capture is taken
// only after it has held still for several polls.

const angleDifference = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * How far, in degrees of arc, the sky's observer may lag the eye. The sky is computed again only once
 * travel moves the Sun in the sky by `sky.update.sunAngle` (0.05° by default, about 5 km), so a sky
 * computed nearer than that is the one an ordinary visit shows there.
 */
export function skyLagToleranceDeg(scenario) {
  const setting = Number(scenario.settings?.["sky.update.sunAngle"]);
  return (Number.isFinite(setting) && setting > 0 ? setting : 0.05) * 1.1;
}

/** The arc between the sky's observer and the planned eye, degrees. */
export function skyObserverArcDeg(sky, plan) {
  const rad = Math.PI / 180, o = sky.observer, p = plan.observer;
  const h = Math.sin(((o.latDeg - p.latDeg) * rad) / 2) ** 2 + Math.cos(o.latDeg * rad) * Math.cos(p.latDeg * rad) * Math.sin(((o.lonDeg - p.lonDeg) * rad) / 2) ** 2;
  return (2 * Math.asin(Math.min(1, Math.sqrt(h)))) / rad;
}

/** Whether the sky is computed for the planned eye, as near as the sky itself keeps up, rather than for an earlier view. */
export function skyObserverAt(sky, plan, toleranceDeg) {
  const p = plan.observer;
  const altitudeError = Math.abs(sky.observer.altitudeMeters - p.altitudeKm * 1000);
  return skyObserverArcDeg(sky, plan) <= toleranceDeg && altitudeError <= Math.max(50, p.altitudeKm * 1000 * 1e-3);
}

/**
 * `compensationEv`, when given, is the exposure compensation (renderer.exposureEV) the picture must be
 * drawn at: the scenario's, or a bracket step's after it was set live.
 */
export function assess(state, { scenario, plan, ui, compensationEv }) {
  const problems = [], waiting = [];
  if (state.phase !== "running") {
    waiting.push(state.recovery ? "the page shows browser recovery" : "the app is starting");
    return { problems, waiting, fingerprint: null };
  }
  const { status, sky, camera, tiles, terrain } = state;
  const google = scenario.scenery.requireMode === "google-tiles";
  if (status.mode !== scenario.scenery.requireMode) {
    // The runtime starts in its fallback until the source answers; a settled other mode is a substitution.
    (status.mode === "fallback" && !status.lastError ? waiting : problems).push(`map source is ${status.mode}, not ${scenario.scenery.requireMode}${status.message ? ` (${status.message})` : ""}`);
  }
  if (status.lastError) problems.push(`map source error: ${status.lastError}`);
  if (google && !status.googleApiKeyProvided) problems.push("the page has no Google key");

  if (plan) {
    if (!camera) waiting.push("no camera yet");
    else {
      const e = plan.engine;
      const off = [];
      if (distance(camera.center, e.center) > 0.5) off.push(`centre ${distance(camera.center, e.center).toFixed(1)} m away`);
      if (angleDifference(camera.yaw, e.yaw) > 1e-5) off.push(`yaw ${(camera.yaw * 180 / Math.PI).toFixed(4)}°`);
      if (Math.abs(camera.pitch - e.pitch) > 1e-5) off.push(`pitch ${(camera.pitch * 180 / Math.PI).toFixed(4)}°`);
      if (Math.abs(camera.radius - e.radius) > 1e-3) off.push(`radius ${camera.radius} m`);
      if (Math.abs(camera.fov - e.fov) > 1e-5) off.push(`fov ${(camera.fov * 180 / Math.PI).toFixed(4)}°`);
      if (off.length) problems.push(`the camera is not where it was placed: ${off.join(", ")}`);
    }
    if (state.fovMode !== null && state.fovMode !== 0) problems.push(`the camera's field of view is not vertical (fovMode ${state.fovMode})`);
  }

  if (!sky) waiting.push("no sky computed yet");
  else {
    if (sky.utcMs !== scenario.time.utcMs) problems.push(`sky time is ${new Date(sky.utcMs).toISOString()}, not ${scenario.time.utc}`);
    if (plan && !skyObserverAt(sky, plan, skyLagToleranceDeg(scenario))) {
      const o = sky.observer;
      waiting.push(`sky observer at ${o.latDeg.toFixed(3)}, ${o.lonDeg.toFixed(3)}, ${(o.altitudeMeters / 1000).toFixed(1)} km; not yet the camera's`);
    }
    if (sky.starCatalogue === "loading") waiting.push("star catalogue loading");
    const night = sky.nightLights;
    if (night) {
      if (night.loading > 0 || night.pending) waiting.push(`night lights loading (${night.here}/${night.needed} tiles, ${night.loading} on the way)`);
      else if (night.failed > 0 && !scenario.readiness.allowNightLightFailures) problems.push(`${night.failed} night-light tile(s) failed${night.error ? `: ${night.error}` : ""}`);
    }
    assessLensFlare(sky.lensFlare, scenario, problems, waiting);
  }
  if (typeof compensationEv === "number" && typeof state.exposureCompensationEv === "number"
    && Math.abs(state.exposureCompensationEv - compensationEv) > 1e-6) {
    waiting.push(`exposure compensation is ${state.exposureCompensationEv.toFixed(2)} EV, not yet ${compensationEv}`);
  }

  if (google) {
    if (state.streaming) waiting.push(`map tiles streaming (${tiles?.visibleTiles ?? "?"} visible, ${tiles?.activeTiles ?? "?"} active)`);
    if (!tiles || !(tiles.visibleTiles > 0)) waiting.push("no map tiles visible yet");
    if (!terrain || terrain.loadedErrorTarget === null) waiting.push("no measurable loaded map detail yet");
    const maxError = scenario.readiness.maxLoadedErrorPx;
    if (typeof maxError === "number" && typeof terrain?.loadedErrorTarget === "number" && terrain.loadedErrorTarget > maxError) {
      waiting.push(`map detail ${terrain.loadedErrorTarget.toFixed(1)} px, above ${maxError} px`);
    }
  }

  if (state.worldPresentation === "split") problems.push("the world is drawn in the split presentation, below docked windows");
  if (state.canvas && (state.canvas.clientWidth !== scenario.image.width || state.canvas.clientHeight !== scenario.image.height)) {
    problems.push(`the globe canvas is ${state.canvas.clientWidth}×${state.canvas.clientHeight}, not the picture's ${scenario.image.width}×${scenario.image.height}`);
  }
  if (!state.fontsLoaded) waiting.push("fonts loading");
  if (ui) {
    if (ui.offenders.length) problems.push(`interface still visible: ${ui.offenders.join(", ")}`);
    if (ui.covers) problems.push(`${ui.covers} window(s) still mask the world`);
    if (scenario.attribution !== false) {
      if (!ui.attribution?.shown) waiting.push("map attribution not shown yet");
      else if (!ui.attribution.imagesLoaded) waiting.push("map attribution artwork loading");
    }
  }

  const flare = sky?.lensFlare;
  const fingerprint = JSON.stringify([
    status.mode, state.streaming, tiles?.visibleTiles, tiles?.activeTiles, terrain?.loadedErrorTarget, terrain?.errorTarget,
    sky?.computations, sky && Math.round(sky.ev100 * 1000), typeof state.exposureCompensationEv === "number" ? Math.round(state.exposureCompensationEv * 1000) : null, sky?.nightLights?.here, sky?.nightLights?.window, camera && camera.center.map(v => Math.round(v * 10)),
    ui?.attribution?.label, ui?.attribution?.rect && [ui.attribution.rect.x, ui.attribution.rect.y, ui.attribution.rect.width], ui?.hiddenMeshes?.length,
    flare && [flare.mode, flare.status, flare.settled, flare.sources.map(source => [
      Math.round((source.visibleFraction ?? 0) * 1000), typeof source.stopsOverWhite === "number" ? Math.round(source.stopsOverWhite * 100) : null,
      source.pixel && [Math.round(source.pixel.x), Math.round(source.pixel.y)],
    ])],
  ]);
  return { problems, waiting, fingerprint };
}

/**
 * The camera lens flare (`sky.exposure.lensFlare`), drawn from the Sun's light
 * that reaches the lens. A picture with it on is taken only once it is settled
 * (no shader preparing, no occlusion reading outstanding), in the mode asked
 * for, and ready: a flare that failed, or that this device cannot draw, settles
 * with a reason, and that is a failure, not a picture without it.
 */
function assessLensFlare(flare, scenario, problems, waiting) {
  const wanted = scenario.settings["sky.exposure.lensFlare"];
  if (!flare) {
    if (wanted !== undefined && wanted !== "off") problems.push(`the scenario asks for lens flare "${wanted}", but this build has no lens flare (built before sky.exposure.lensFlare?)`);
    return;
  }
  if (wanted !== undefined && flare.mode !== wanted) {
    waiting.push(`lens flare is ${flare.mode}, not ${wanted}`);
    return;
  }
  if (flare.mode === "off") return;
  if (!flare.settled) waiting.push(`lens flare preparing (${flare.status})`);
  else if (flare.status !== "ready") problems.push(`lens flare ${flare.mode} is ${flare.status}${flare.reason ? `: ${flare.reason}` : ""}`);
}
