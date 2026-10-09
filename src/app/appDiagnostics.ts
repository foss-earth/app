/** Earth identity and feature observations supplied to the public UI diagnostics owner. */
import { createDiagnostics, reportPage, type PreviousVisit, type SessionTrail, type TrailEnvironment } from "@foss-earth/ui/diagnostics";
import { browserTrailEnvironment, readBrowserReportDetails, type GameLog } from "@foss-earth/ui/browser";
import type { RendererSelection } from "@foss-earth/renderer";
import type { SceneControllerState } from "@foss-earth/scenes/browser";
import type { SettingsRegistry } from "@foss-earth/ui/settings";
import { readBuiltFrom, type BuiltFromPart } from "./builtFrom";
import { describeAppIdentity, describeAppIdentityBriefly, type AppIdentity } from "./appIdentity";
export { TRAIL_KEPT, TRAIL_STEPS, effectiveReportSettings, settingsNotAtDefaults } from "@foss-earth/ui/diagnostics";

export { reportSecrets } from "@foss-earth/ui/diagnostics";

function buildParts(): string[] {
  let built = typeof document === "undefined" ? null : readBuiltFrom(document);
  // A report may recover plain text credit from a partially damaged page.
  // About presentation and artifact admission retain their strict validator.
  if (!built && typeof document !== "undefined") {
    try {
      const value = JSON.parse(document.getElementById("foss-earth-built-from")?.textContent ?? "null");
      if (value && typeof value.built === "string" && value.app && typeof value.app.name === "string") built = value;
    } catch { /* Missing or incomplete page metadata adds no report lines. */ }
  }
  if (!built) return [];
  const lines: string[] = [];
  const visit = (part: BuiltFromPart, indent = "", depth = 0): void => {
    if (!part || typeof part !== "object" || typeof part.name !== "string" || depth > 30) return;
    lines.push(`${indent}${part.name} ${part.version ?? "version unknown"}${part.commit ? `; commit ${part.commit}` : ""}${part.dirty ? "; uncommitted changes" : ""}${part.unpushed ? "; unpushed" : ""}${part.repository ? `; ${part.repository}` : ""}`);
    for (const child of Array.isArray(part.parts) ? part.parts : []) visit(child, `${indent}  `, depth + 1);
  };
  visit(built.app);
  return ["Build components:", ...lines];
}

export interface AppDiagnosticsOptions {
  /** The app's log. The diagnostics' own `log` prints to it and records each line. */
  log: GameLog;
  settings: SettingsRegistry;
  identity: AppIdentity;
  /** For tests: the browser as the trail uses it. */
  trailEnvironment?: TrailEnvironment;
  /** For tests: where errors, the console, visibility and leaving are heard. */
  page?: Pick<Window, "addEventListener" | "removeEventListener">;
  console?: Pick<Console, "warn" | "error">;
}

/** What of the renderer the diagnostics read; BabylonRuntime gives it. */
export interface DiagnosedRuntime {
  renderer: Pick<RendererSelection, "requested" | "mode" | "fallbackReason"> & { engine: {
    getInfo?(): { vendor: string; renderer: string; version: string };
    getCaps?(): {
      maxTextureSize?: number; maxRenderTextureSize?: number; maxTexturesImageUnits?: number;
      maxMSAASamples?: number; uintIndices?: boolean; textureFloatRender?: boolean;
      textureHalfFloatRender?: boolean; highPrecisionShaderSupported?: boolean;
    };
  } };
  onDeviceLost(listener: () => void): () => void;
  onDeviceRestored(listener: () => void): () => void;
}

export interface AppDiagnostics {
  /** Prints to the app's log, and adds each line to the trail. */
  log: GameLog;
  trail: SessionTrail;
  attachRuntime(runtime: DiagnosedRuntime): void;
  /** Call with each state of the scene controller. */
  sceneChanged(state: SceneControllerState): void;
  /** More lines for the report, such as what of the app is kept on the device. */
  addState(read: () => Promise<string | null> | string | null): void;
  report(options?: { allSettings?: boolean }): Promise<string>;
  previous(): Promise<PreviousVisit | null>;
  destroy(): void;
}

export function startAppDiagnostics(options: AppDiagnosticsOptions): AppDiagnostics {
  const { settings, identity } = options;
  const page = options.page ?? window;
  let runtime: DiagnosedRuntime | null = null, lost = 0;
  let scene: SceneControllerState | null = null, sceneKey = "", inside: string | null = null;
  let disposed = false;
  const driverOf = (): string | null => {
    try { const info = runtime?.renderer.engine.getInfo?.(); return info ? [info.vendor, info.renderer, info.version].filter(Boolean).join(", ") || null : null; }
    catch { return null; }
  };
  const diagnostics = createDiagnostics({ settings, log: options.log,
    trailIdentity: () => `${describeAppIdentity(identity)}, renderer ${runtime?.renderer.mode ?? "not started"}.`,
    trailEnvironment: options.trailEnvironment ?? browserTrailEnvironment(), page, console: options.console ?? console,
    parts() {
      const context = settings.getDeviceContext(), status = scene?.status ?? null;
      const state = [status
        ? `Scene: ${status.sceneId}, revision ${status.revision}, ${status.entries.length} 360 images, ${status.phase}${status.active ? `, inside ${status.active}` : ""}; ${status.warnings.length} warnings${status.lastError ? `; last error: ${status.lastError}` : ""}`
        : scene?.loading ? `Scene: loading ${reportPage(scene.loading)}`
          : scene?.errors.length ? `Scene: not loaded, ${scene.errors.length} problems; the first: ${scene.errors[0].path}: ${scene.errors[0].message}` : "Scene: none"];
      let capabilities: string[] = [];
      try { const caps = runtime?.renderer.engine.getCaps?.();
        if (caps) capabilities = Object.entries(caps)
          .filter(([key, value]) => ["maxTextureSize", "maxRenderTextureSize", "maxTexturesImageUnits", "maxMSAASamples", "uintIndices", "textureFloatRender", "textureHalfFloatRender", "highPrecisionShaderSupported"].includes(key) && (typeof value === "number" || typeof value === "boolean"))
          .map(([key, value]) => `Graphics capability ${key}: ${value}`);
      } catch { /* A lost device must still be reportable. */ }
      return { at: new Date(), appName: document.title || "FOSS Earth", page: reportPage(location.href),
        build: identity.build, source: identity.source, fossEarth: identity.fossEarth, bundle: identity.bundle,
        userAgent: navigator.userAgent,
        screen: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio, touch: context.touch },
        device: { cores: context.hardwareConcurrency, memoryGiB: context.deviceMemoryGiB }, environment: readBrowserReportDetails(),
        renderer: { asked: runtime?.renderer.requested ?? "not started", mode: runtime?.renderer.mode ?? "not started", driver: driverOf(),
          maxTextureSize: context.maxTextureSize, fallbackReason: runtime?.renderer.fallbackReason ?? null, lost, capabilities },
        state: [...state, ...buildParts()],
      };
    },
  });
  const { trail, log } = diagnostics;
  trail.step(`Opened ${reportPage(typeof location === "undefined" ? "" : location.href)}`);
  log.print({ text: `${describeAppIdentityBriefly(identity)}.` });
  const onVisibility = () => { const hidden = document.hidden;
    trail.step(hidden ? "The page was hidden" : "The page was shown again"); trail.setHidden(hidden); };
  const onPageHide = () => trail.setClosed(true);
  const onPageShow = (event: Event) => { if ((event as PageTransitionEvent).persisted) trail.setClosed(false); };
  document.addEventListener("visibilitychange", onVisibility);
  page.addEventListener("pagehide", onPageHide); page.addEventListener("pageshow", onPageShow);
  return {
    log, trail,
    attachRuntime(next) {
      runtime = next;
      diagnostics.attachRuntime({
        describe: () => `Renderer ${next.renderer.mode} (asked for ${next.renderer.requested})${next.renderer.fallbackReason ? `; fell back: ${next.renderer.fallbackReason}` : ""}; ${driverOf() ?? "GPU not named"}`,
        onDeviceLost: listener => next.onDeviceLost(() => { lost++; listener(); }), onDeviceRestored: listener => next.onDeviceRestored(listener),
      });
    },
    sceneChanged(state) {
      scene = state;
      const status = state.status, key = status ? `${status.sceneId} ${status.revision}` : "", steps: string[] = [];
      if (key !== sceneKey) { sceneKey = key; inside = null;
        if (status) steps.push(`Scene ${status.sceneId}, revision ${status.revision}: ${status.entries.length} 360 images`); }
      const active = status?.active ?? null;
      if (active !== inside) { inside = active; steps.push(active ? `Inside the 360 image ${active}` : "Back on the map"); }
      diagnostics.observeState(status ? `scene ${status.sceneId}, revision ${status.revision}, ${active ? `inside the 360 image ${active}` : "on the map"}` : "", steps);
    },
    addState: diagnostics.addState, report: diagnostics.report, previous: diagnostics.previous,
    destroy() {
      if (disposed) return; disposed = true;
      const failures: unknown[] = [];
      for (const stop of [() => document.removeEventListener("visibilitychange", onVisibility),
        () => page.removeEventListener("pagehide", onPageHide), () => page.removeEventListener("pageshow", onPageShow), () => diagnostics.destroy()]) {
        try { stop(); } catch (error) { failures.push(error); }
      }
      if (failures.length) throw new AggregateError(failures, "Earth diagnostics cleanup failed.");
    },
  };
}
