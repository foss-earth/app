/** Component execution: editable choices, explicit application, and running services. */
import "./nativePanel.css";
import type { PanelSection } from "@foss-earth/ui/react";
import type { ParameterValue, SettingsRegistry } from "@foss-earth/ui/settings";
import { checkChoice, closeHelpTooltipWithin, createChoiceGroup, createHelpTooltip, createParameterControl, createTwoPositionSlider, isolationStatus } from "@foss-earth/ui/browser";
import { componentExecutionChoices, componentExecutionEdits, componentExecutionSettingId, nativeCorePlan,
  NATIVE_CORES, NATIVE_CORE_SETTING_IDS, NATIVE_MANUAL_FIELDS, NATIVE_PARAMETERS, NATIVE_SHARED_SKY_ID, NATIVE_THREADS_ID, NATIVE_TIER_ID,
  type ComponentExecutionField, type NativeCoreId } from "@foss-earth/engine/settings";
import type { NativeCoreReport, NativeSharedReport } from "./nativeReport";
import { TERRAIN_SHARED_HEIGHTS_PARAMETER } from "./terrainNativeWorkerConfig";

export interface NativeStatusView {
  element: HTMLElement;
  refresh(): void;
  /** Component-owned DOM can be composed with its settings without duplicating status. */
  component(core: NativeCoreId): HTMLElement;
  summary(core: NativeCoreId): HTMLElement;
  help(core: NativeCoreId): HTMLElement;
  destroy(): void;
}

const round = (value: number | null | undefined, digits = 2): string =>
  value === null || value === undefined || !Number.isFinite(value) ? "–" : String(Math.round(value * 10 ** digits) / 10 ** digits);

function parityText(parity: unknown): string {
  if (typeof parity === "string") return parity;
  if (parity && typeof parity === "object") return Object.entries(parity)
    .map(([operation, state]) => `${operation} ${state && typeof state === "object" ? `(${parityText(state)})` : String(state)}`).join(", ");
  return "–";
}

const FALLBACK_TEXT: Readonly<Record<string, string>> = {
  "not-cross-origin-isolated": "page not cross-origin isolated",
  "shared-array-buffer-unavailable": "SharedArrayBuffer unavailable",
  "atomics-wait-unavailable": "Atomics.wait unavailable",
  "shared-memory-unavailable": "shared memory unavailable",
  "threaded-startup-failed": "shared threads did not start",
  "threaded-unsupported": "no shared-memory build",
  "no-shared-build": "no shared-memory build",
};
/** A fallback reason in words; the report and help keep its ID. */
export function fallbackText(reason: string): string {
  const retired = /^shared-core-retired: (.+)$/.exec(reason);
  if (retired) return `shared threads stopped (${retired[1].replaceAll("-", " ")})`;
  return FALLBACK_TEXT[reason] ?? reason.replaceAll("-", " ");
}

/** Cooperating threads over one memory, as the shared core ran them, for help. */
function sharedDetailText(shared: NativeSharedReport): string {
  const { threads, batches } = shared;
  return [`Shared memory: ${round(shared.memoryBytes / 1048576, 1)} MiB, fixed`,
    `${threads.ready} of ${threads.requested} threads ready (${threads.connected} connected, limit ${threads.limit})`,
    shared.actual === "retired" ? `retired: ${shared.retiredReason ?? "unknown"}` : null,
    `${batches.total} batches (${batches.parallel} parallel, ${batches.solo} solo)`,
    `rows by thread ${batches.rowsByThread.slice(0, threads.requested).join("/") || "–"}`,
    `coordinator waited ${round(batches.waitMs, 1)} ms (max ${round(batches.maxWaitMs, 1)} ms)`].filter(Boolean).join(" · ");
}

/** One line of a core's jobs and timings, from its own measurements. */
export function nativeDetailText(report: NativeCoreReport): string {
  const detail = report.detail as Record<string, unknown> | null;
  if (!detail) return report.actual === "not started" ? "No work yet: nothing of this core has been loaded." : "";
  if (report.core === "sky") {
    const last = detail.lastJob as { roundTripMs: number; workMs: number; transferBytes: number; starsMs?: number; starInputBytes?: number } | null;
    return [`${String(detail.jobs)} evaluations`, `mean round trip ${round(detail.meanRoundTripMs as number)} ms`,
      `mean work ${round(detail.meanWorkMs as number)} ms`, last ? `last copy ${round(last.transferBytes / 1024, 1)} KiB` : null,
      last?.starsMs ? `last TS star batch ${round(last.starsMs)} ms` : null,
      last?.starInputBytes !== undefined ? `last star input ${round(last.starInputBytes / 1024, 1)} KiB` : null,
      detail.startupMs !== null ? `core startup ${round(detail.startupMs as number, 1)} ms` : null].filter(Boolean).join(" · ");
  }
  if (report.core === "terrain") {
    const targets = (detail.targets as number) ?? 0;
    const mean = detail.meanMs as number | null | undefined;
    return [`${String(detail.workers)} workers`, `${targets} targets`, `mean ${round(mean)} ms each, dispatch to reply`].join(" · ");
  }
  if (report.core === "imagery") {
    const jobs = detail.jobs as number;
    return [`${jobs} batches`, `${String(detail.cacheHits)} cached / ${String(detail.pageSamples)} page samples`,
      `${String(detail.referenceCacheHits ?? 0)} page-memo / ${String(detail.workerCacheHits ?? 0)} worker / ${String(detail.nativeCacheHits ?? 0)} WASM cache hits`,
      `mean round trip ${round(jobs ? (detail.roundTripMs as number) / jobs : null)} ms`,
      `mean work ${round(jobs ? (detail.workMs as number) / jobs : null)} ms`,
      `copied ${round(((detail.inputBytes as number) + (detail.outputBytes as number)) / 1048576)} MiB`,
      `retained ${round(((detail.snapshotBytes as number) + (detail.nativeBytes as number)) / 1048576)} MiB`].join(" · ");
  }
  if (report.core === "google") {
    const jobs = detail.jobs as number;
    return [`${jobs} tiles`, `${String(detail.failures)} failures`,
      `mean round trip ${round(jobs ? (detail.roundTripMs as number) / jobs : null)} ms`,
      `mean work ${round(jobs ? (detail.workMs as number) / jobs : null)} ms`,
      `copied ${round((detail.copyBytes as number) / 1048576)} MiB`].join(" · ");
  }
  if (report.core === "ground") {
    const preparer = detail.preparer as { jobs: number; lastJob: { workMs: number; roundTripMs: number } | null };
    return [`${preparer.jobs} index builds`, `${String(detail.readyMeshes)} ready meshes`,
      `${String(detail.acceleratedQueries)} synchronous TS queries`,
      `indices ${round((detail.snapshotBytes as number) / 1048576)} MiB`,
      preparer.lastJob ? `last build ${round(preparer.lastJob.workMs)} ms / ${round(preparer.lastJob.roundTripMs)} ms round trip` : null].filter(Boolean).join(" · ");
  }
  const perWorker = (detail.perWorker as { tasks: number; meanMs: number }[] | undefined) ?? [];
  const tasks = perWorker.reduce((sum, worker) => sum + worker.tasks, 0);
  const mean = tasks ? perWorker.reduce((sum, worker) => sum + worker.tasks * worker.meanMs, 0) / tasks : null;
  const shared = typeof detail.sharedHeights === "number" && detail.sharedHeights > 0 ? `${detail.sharedHeights} in shared memory` : null;
  return [`${String(detail.workers)} workers`, `${tasks} decodes`, `mean ${round(mean)} ms each, dispatch to reply`,
    `${String(detail.pageDecodes)} on the page`, shared].filter(Boolean).join(" · ");
}

/** Friendly labels are for presentation; machine-readable reports retain their original IDs. */
function runningText(core: NativeCoreReport): string {
  if (core.actual === "not started") return "No work yet";
  if (core.actual === "starting") return "Starting…";
  // Threads that are ready of those asked for: fewer start when the worker budget or the browser refuses.
  if (core.shared?.actual === "threaded") {
    const { ready, requested } = core.shared.threads;
    return `WASM (${ready === requested ? ready : `${ready} of ${requested}`} shared thread${requested === 1 ? "" : "s"})`;
  }
  const detail = core.detail as { workers?: number; pageDecodes?: number } | null;
  const count = detail?.workers;
  const workers = typeof count === "number" && count > 0 ? `${count} worker${count === 1 ? "" : "s"}` : "1 worker";
  let actual = core.actual.replaceAll("wasm-single", "WASM").replace(/\bsingle\b/g, "WASM")
    .replaceAll("typescript", "TS").replaceAll("TypeScript", "TS").replaceAll("WebAssembly", "WASM")
    .replaceAll("(worker)", `(${workers})`).replaceAll("(page)", "(main)")
    .replaceAll("(page fallback)", "(main fallback)")
    .replaceAll("(worker cache + page misses)", "(1 worker + main)")
    .replaceAll(" worker build; TS synchronous queries", " (1 worker build; TS main queries)");
  // Raster reports bare backend IDs; use its measured pool size, not the requested plan.
  if (core.core === "raster" && typeof count === "number" && count > 0 && !actual.includes("(")) {
    actual += ` (${workers}${detail?.pageDecodes ? " + main" : ""})`;
  }
  return actual;
}
/** Only actual runtime reports determine the component tint, including mixed execution. */
function runningImplementation(actual: string): string {
  const typescript = /\btypescript\b/i.test(actual);
  const wasm = /\b(?:wasm(?:-single|-threaded)?|single|threaded|WebAssembly)\b/i.test(actual);
  return typescript && wasm ? "mixed" : wasm ? "wasm" : typescript ? "typescript" : "unknown";
}
/** What a reload would start. A shared-memory request on a page that is not isolated runs single-threaded WASM. */
function plannedText(settings: SettingsRegistry, core: NativeCoreId, isolated: boolean): string {
  const plan = nativeCorePlan(settings, core);
  const location = plan.placement === "worker" || NATIVE_CORES[core].original === "worker" ? "background workers" : "main thread";
  const implementation = plan.kernel === "typescript" ? "TypeScript"
    : plan.sharedMemory ? isolated ? `Shared-memory WASM, ${plan.threads} thread${plan.threads === 1 ? "" : "s"}` : "WebAssembly, 1 thread (page not cross-origin isolated)"
      : plan.threadedFallback ? "TypeScript (no shared-memory build)" : "WebAssembly";
  return `${implementation} · ${location} · ${plan.parallelism === "serial" ? "one worker per component" : "worker pools where supported"}`;
}

export function createNativeStatusView(document: Document, report: () => readonly NativeCoreReport[],
  timers: { set(callback: () => void, delayMs: number): unknown; clear(handle: unknown): void },
  next?: (core: NativeCoreId) => string | null): NativeStatusView {
  const element = document.createElement("div");
  element.className = "foss-earth-execution-status";
  const cards = new Map<NativeCoreId, { element: HTMLElement; actual: HTMLElement; summary: HTMLElement; fallback: HTMLElement; detail: HTMLElement; next: HTMLElement; help: HTMLElement; destroyHelp(): void }>();
  const message = document.createElement("p");
  element.append(message);
  const cardFor = (core: NativeCoreId) => {
    const existing = cards.get(core);
    if (existing) return existing;
    const item = document.createElement("article");
    item.className = "foss-earth-execution-component";
    item.dataset.component = core;
    const heading = document.createElement("h4");
    heading.textContent = NATIVE_CORES[core].label;
    const actual = document.createElement("span");
    actual.className = "foss-earth-execution-component__actual";
    const after = document.createElement("p");
    after.className = "foss-earth-execution-component__next";
    const fallback = document.createElement("p");
    const detail = document.createElement("span");
    const tooltip = createHelpTooltip({ label: `${NATIVE_CORES[core].label} execution information`, content: detail });
    // Help must not trigger the enclosing component's disclosure.
    const onHelpClick = (event: Event): void => { event.preventDefault(); event.stopPropagation(); };
    tooltip.button.addEventListener("click", onHelpClick);
    item.append(heading, actual, after, fallback, tooltip.element);
    element.append(item);
    const card = { element: item, actual, summary: actual, fallback, detail, next: after, help: tooltip.element, destroyHelp: () => { tooltip.button.removeEventListener("click", onHelpClick); tooltip.destroy(); } };
    cards.set(core, card);
    return card;
  };
  let destroyed = false;
  let handle: unknown = null;
  const refresh = (): void => {
    if (destroyed) return;
    let rows: readonly NativeCoreReport[];
    try { rows = report(); } catch (error) {
      message.hidden = false;
      message.textContent = `Status unavailable: ${error instanceof Error ? error.message : String(error)}`;
      for (const card of cards.values()) {
        card.actual.textContent = "Status unavailable";
        card.element.dataset.runningImplementation = "unknown";
        card.detail.textContent = message.textContent;
      }
      return;
    }
    message.textContent = rows.length ? "" : "Component status is not available yet.";
    message.hidden = rows.length > 0;
    for (const coreId of Object.keys(NATIVE_CORES) as NativeCoreId[]) {
      const card = cardFor(coreId);
      const core = rows.find(row => row.core === coreId);
      if (!core) {
        card.actual.textContent = card.summary.textContent = "Status unavailable";
        card.element.dataset.runningImplementation = "unknown";
        card.next.hidden = card.fallback.hidden = true;
        card.detail.textContent = "No component report is available.";
        continue;
      }
      card.actual.textContent = runningText(core);
      card.element.dataset.runningImplementation = runningImplementation(core.actual);
      const after = next?.(core.core);
      card.next.hidden = !after;
      card.next.textContent = after ? `After reload: ${after}` : "";
      card.fallback.hidden = !core.fallbackReason;
      card.fallback.textContent = core.fallbackReason ? `Fallback: ${fallbackText(core.fallbackReason)}` : "";
      if (core.fallbackReason) card.summary.textContent += " · fallback";
      card.detail.textContent = `Actual: ${core.actual} · State: ${core.state}${core.fallbackReason ? ` · Fallback: ${core.fallbackReason}` : ""}${core.shared ? ` · ${sharedDetailText(core.shared)}` : ""} · ${nativeDetailText(core)}${core.scope ? ` · ${core.scope}` : ""} · Parity: ${parityText(core.parity)}`;
    }
  };
  const tick = (): void => {
    handle = null;
    if (destroyed) return;
    if (element.isConnected) refresh();
    handle = timers.set(tick, 1000);
  };
  refresh();
  handle = timers.set(tick, 1000);
  return { element, refresh, component: core => cardFor(core).element, summary: core => cardFor(core).summary, help: core => cardFor(core).help, destroy() {
    if (destroyed) return;
    destroyed = true;
    if (handle !== null) timers.clear(handle);
    handle = null;
    for (const card of cards.values()) card.destroyHelp();
  } };
}

export interface NativeSectionsOptions {
  document: Document;
  settings: SettingsRegistry;
  /**
   * Draws one section. `reload` is the panel's Apply & reload, which carries the edited values in the URL; a host
   * section with its own Changes pending should use it, and the panel's stylesheet hides that repeat of its own.
   */
  section(section: "selection" | "cores", content: { main: HTMLElement; covers: readonly string[]; footer?: HTMLElement; reload?: () => void }): HTMLElement;
  report(): readonly NativeCoreReport[];
  /** The host owns navigation, so browser tests and embedding apps can provide it explicitly. */
  reload(url: string): void;
  timers: { set(callback: () => void, delayMs: number): unknown; clear(handle: unknown): void };
}

/** Carry the edited values across reload even when the opening URL or unavailable storage would override them. */
export function componentExecutionReloadUrl(settings: SettingsRegistry, href: string): string {
  const url = new URL(href);
  for (const spec of settings.list({ tab: "native" })) {
    url.searchParams.set(`set.${spec.id}`, String(settings.get(spec.id)));
  }
  return url.href;
}

let panelCount = 0;
/** Shared by Earth, the UMN tour and fly. Stable internal IDs preserve URLs and workspace placement. */
export function createNativeSections(options: NativeSectionsOptions): { sections: PanelSection[]; status: NativeStatusView; destroy(): void } {
  const { document, settings } = options;
  const panelId = ++panelCount;
  const initial = Object.fromEntries(settings.list({ tab: "native" }).map(spec => [spec.id, settings.get(spec.id)]));
  const planKey = (core: NativeCoreId): string => JSON.stringify(nativeCorePlan(settings, core));
  const initialPlans = new Map((Object.keys(NATIVE_CORES) as NativeCoreId[]).map(core => [core, planKey(core)]));
  // Shared memory needs a cross-origin isolated page, which stays so for the page's life; the runtime decides the same way.
  const view = document.defaultView;
  const isolated = view?.crossOriginIsolated === true;
  const isolation = view ? isolationStatus(view) : null;
  // Over http from a network address, as a phone opening a development server, the browser isolates nothing.
  const secure = view?.isSecureContext !== false;
  const notIsolatedReason = !secure
    ? `Only a secure page (HTTPS or localhost) can share memory, and this one${view?.location.host ? ` (${view.location.protocol}//${view.location.host})` : ""} is not. Open it over HTTPS: a development server started with --host serves HTTPS, and past the browser's warning about its certificate the page is secure.`
    : isolation ? isolation.reason ?? `Isolation is ${isolation.state}.`
      : "In development the server's headers decide: start it with FOSS_EARTH_ISOLATION=enforce.";
  const unavailableStatus = secure ? "Not isolated" : "Not secure";
  const unavailableTitle = secure ? "Shared memory needs a cross-origin isolated page." : "Shared memory needs a secure (HTTPS) page.";
  const capability = isolated ? "This page is cross-origin isolated, so shared memory can run."
    : `This page isn't cross-origin isolated, so a shared-memory sky runs single-threaded WASM. ${notIsolatedReason}`;
  // Hosts that register it get Terrain heights → Shared memory.
  const sharedHeightsId = TERRAIN_SHARED_HEIGHTS_PARAMETER.id;
  const heightsShareable = settings.has(sharedHeightsId);
  const heightsChanged = (): boolean => heightsShareable && settings.get(sharedHeightsId) !== initial[sharedHeightsId];
  const status = createNativeStatusView(document, options.report, options.timers,
    core => planKey(core) === initialPlans.get(core) ? null : plannedText(settings, core, isolated));
  const cleanups: (() => void)[] = [];
  const updates: (() => void)[] = [];
  const global = document.createElement("div");
  global.className = "foss-earth-execution-settings";
  const pending = document.createElement("div");
  pending.className = "foss-earth-execution-pending";
  const pendingText = document.createElement("p");
  pendingText.setAttribute("role", "status");
  const apply = document.createElement("button");
  apply.type = "button";
  apply.className = "foss-earth-choice";
  apply.textContent = "Apply & reload";
  apply.setAttribute("aria-label", "Apply execution settings and reload");
  const discard = document.createElement("button");
  discard.type = "button";
  discard.className = "foss-earth-choice";
  discard.textContent = "Discard";
  discard.setAttribute("aria-label", "Discard pending execution changes");
  const error = document.createElement("p");
  error.setAttribute("role", "alert");
  error.hidden = true;
  pending.append(pendingText, apply, discard, error);
  global.append(pending);
  const notify = (values: Record<string, ParameterValue>): void => {
    const result = settings.setMany(values);
    error.hidden = result.ok;
    error.textContent = result.ok ? "" : result.reason;
  };
  // Only the sky has a shared-memory build; its switch and the global Shared memory set it the same way:
  // native.sharedSky shares a WASM sky, and a sky that would not run WASM is asked for its threaded build.
  const skyId = NATIVE_CORE_SETTING_IDS.sky;
  const sharedSkyId = NATIVE_SHARED_SKY_ID;
  const skyBefore = settings.get(skyId) === "threaded" ? "inherit" : settings.get(skyId);
  const skyShared = (): boolean => nativeCorePlan(settings, "sky").sharedMemory;
  const setSkyShared = (shared: boolean): void => {
    if (settings.has(sharedSkyId)) notify({ [sharedSkyId]: shared });
    if (skyShared() === shared) return;
    if (shared) { notify({ [skyId]: "threaded" }); return; }
    notify({ [skyId]: skyBefore });
    // A global threaded selection still reaches the sky through Global.
    if (skyShared()) notify({ [skyId]: "single" });
  };
  const heightsShared = (): boolean => heightsShareable && settings.get(sharedHeightsId) === true;
  // Where the page cannot share memory, the switches show only a request someone made, so it can be
  // turned off; the default's request shows Off, grayed, with ? saying why.
  const asked = (id: string): boolean => !["default", "host-default"].includes(settings.inspect(id).provenance);
  const skyShown = (): boolean => skyShared() && (isolated || nativeCorePlan(settings, "sky").requested === "threaded"
    || (settings.has(sharedSkyId) && asked(sharedSkyId)));
  const heightsShown = (): boolean => heightsShared() && (isolated || asked(sharedHeightsId));
  const group = (parent: HTMLElement, core: NativeCoreId | undefined, field: ComponentExecutionField | "mode",
    label: string, choices: readonly { id: string; label: string }[], read: () => string, helpText: string): HTMLElement => {
    const id = field === "mode" ? core ? NATIVE_CORE_SETTING_IDS[core] : NATIVE_TIER_ID : componentExecutionSettingId(field, core);
    const name = `execution-${panelId}-${core ?? "global"}-${field}`;
    const shortLabels: Record<string, string> = { inherit: "Global", typescript: "TS", wasm: "WASM", original: "Default", worker: "Workers", serial: "1 worker", auto: field === "parallelism" ? "Pool" : "Auto" };
    const element = createChoiceGroup(name, label, choices.map(choice => ({ ...choice, shortLabel: shortLabels[choice.id] })), document);
    element.dataset.executionControl = `${core ?? "global"}.${field}`;
    const explanation = document.createElement("div");
    const explanationText = document.createElement("p");
    explanation.append(explanationText);
    const tooltip = createHelpTooltip({ label: `Explain ${core ? `${NATIVE_CORES[core].label}: ` : ""}${label}`, content: explanation,
      onOpen: () => {
        const state = settings.inspect(id);
        const component = core ? ` Selected: ${plannedText(settings, core, isolated)}. ${NATIVE_CORES[core].scope} ${nativeCorePlan(settings, core).autoReason ?? ""}` : "";
        explanationText.textContent = `${helpText}${component} Takes effect after Apply and reload. Setting: ${id}. Current value: ${read()}. Source: ${state.provenance}. Default: ${String(state.defaultValue)}. ${state.spec.defaultReason}`;
        explanationText.append(" ", source);
      } });
    const source = document.createElement("a");
    source.className = "foss-earth-parameter__source";
    source.textContent = "↗";
    source.href = "https://github.com/foss-earth/engine/blob/main/src/settings/catalogue/native.ts";
    source.target = "_blank";
    source.rel = "noopener noreferrer";
    source.setAttribute("aria-label", `${label} source code`);
    source.title = `${label} source code, opens in a new tab`;
    explanationText.append(" ", source);
    const changed = document.createElement("span");
    changed.className = "foss-earth-execution-control-pending";
    changed.textContent = "·";
    changed.title = "Changes pending";
    changed.setAttribute("aria-label", "Changes pending");
    element.append(changed, tooltip.element);
    const original = read();
    const onChange = (event: Event): void => {
      const target = event.target as HTMLInputElement;
      if (target.type === "radio" && target.checked) notify(componentExecutionEdits(settings, core, field, target.value));
    };
    element.addEventListener("change", onChange);
    updates.push(() => {
      checkChoice(element, name, read());
      changed.hidden = read() === original;
      const own = settings.get(core ? NATIVE_CORE_SETTING_IDS[core] : NATIVE_TIER_ID);
      const manual = own !== "auto" && own !== "inherit";
      element.hidden = field !== "mode" && !manual;
      const implementation = core ? nativeCorePlan(settings, core).kernel : componentExecutionChoices(settings).implementation;
      const forced = settings.inspect(id).provenance === "host" || settings.inspect(core ? NATIVE_CORE_SETTING_IDS[core] : NATIVE_TIER_ID).provenance === "host";
      for (const input of element.querySelectorAll<HTMLInputElement>("input")) {
        const requiresWorker = field === "placement" && input.value === "original" && (implementation === "single" || implementation === "wasm");
        const fixedWorker = field === "parallelism" && input.value === "auto" && core !== undefined && core !== "raster" && core !== "terrain";
        input.disabled = forced || requiresWorker || fixedWorker;
        input.title = requiresWorker ? "WebAssembly currently requires background workers." : fixedWorker ? "This component currently supports only one worker." : "";
      }
    });
    cleanups.push(() => { element.removeEventListener("change", onChange); tooltip.destroy(); });
    parent.append(element);
    return element;
  };
  const mode = (core?: NativeCoreId): string => {
    const tier = settings.get(core ? NATIVE_CORE_SETTING_IDS[core] : NATIVE_TIER_ID);
    return tier === "inherit" || tier === "auto" ? tier : "custom";
  };
  /** Mode and the manual fields; returns the Implementation control, which shared memory follows. */
  const manual = (parent: HTMLElement, core?: NativeCoreId): HTMLElement => {
    group(parent, core, "mode", "Mode", [...(core ? [{ id: "inherit", label: "Use global settings" }] : []),
      { id: "auto", label: "Auto" }, { id: "custom", label: "Manual" }], () => mode(core),
      core ? "Use global settings inherits each global decision. Auto uses this component's measured choice. Manual can override individual decisions." : "Auto uses each component's measured configuration. Manual sets the global defaults below.");
    const fields = NATIVE_MANUAL_FIELDS.map(field => {
      const spec = settings.spec(componentExecutionSettingId(field, core))!;
      return group(parent, core, field, field === "parallelism" ? "Parallelism" : field === "placement" ? "Location" : spec.label, spec.choices!, () => componentExecutionChoices(settings, core)[field], spec.description);
    });
    return fields[NATIVE_MANUAL_FIELDS.indexOf("implementation")];
  };
  // Only the sky has a shared-memory build, so its choice and thread count sit after the sky's Implementation.
  const sharedMemory = (implementation: HTMLElement): void => {
    const on = skyShared;
    const original = on();
    const element = document.createElement("div");
    element.className = "foss-earth-choices foss-earth-choice-group foss-earth-parameter--compact-choice foss-earth-execution-shared";
    element.dataset.executionControl = "sky.shared";
    element.setAttribute("role", "group");
    element.setAttribute("aria-label", "Shared memory");
    const heading = document.createElement("div");
    heading.className = "foss-earth-choices__heading";
    heading.textContent = "Shared memory";
    const slider = createTwoPositionSlider({ document, label: "Shared memory for the sky", options: [{ label: "Off" }, { label: "On" }],
      onInput: index => setSkyShared(index === 1) });
    // Unavailable on a page that is not isolated: On would only run single-threaded WASM.
    const unavailable = document.createElement("span");
    unavailable.textContent = unavailableStatus;
    unavailable.className = "foss-earth-choice-group__status";
    unavailable.hidden = isolated;
    const changed = document.createElement("span");
    changed.className = "foss-earth-execution-control-pending";
    changed.textContent = "·";
    changed.title = "Changes pending";
    changed.setAttribute("aria-label", "Changes pending");
    const explanation = document.createElement("p");
    const tooltip = createHelpTooltip({ label: "Explain Sky: Shared memory", content: explanation,
      onOpen: () => {
        explanation.textContent = `On runs the sky's shared-memory WASM build: its worker coordinates helper workers over one fixed 4 MiB memory, and Shared-memory threads says how many threads, the coordinator included. Helpers come from the total preparation workers. Off runs the sky without shared memory. Only the sky has such a build. ${capability} Takes effect after Apply and reload. Settings: ${settings.has(sharedSkyId) ? `${sharedSkyId}, now ${String(settings.get(sharedSkyId))}, which shares a sky that runs WASM; ` : ""}${skyId}=threaded asks for the shared build whatever Global says, now ${String(settings.get(skyId))}.`;
      } });
    // "Not isolated · ?" wraps as one, so ? never starts a line alone.
    const end = document.createElement("span");
    end.className = "foss-earth-execution-shared__end";
    end.append(unavailable, changed, tooltip.element);
    element.append(heading, slider.element, end);
    // The standard count control, shown while shared memory is asked for.
    const threads = createParameterControl(settings, NATIVE_THREADS_ID, document);
    threads.element.dataset.executionControl = "sky.threads";
    implementation.after(element, threads.element);
    updates.push(() => {
      const shared = on(), shown = skyShown();
      // A selection from the URL stays visible and can be turned off where it cannot run.
      slider.update(shown ? 1 : 0, settings.inspect(skyId).provenance === "host" || (!isolated && !shown));
      slider.input.title = !isolated && !shown ? unavailableTitle : "";
      changed.hidden = shared === original;
      threads.element.hidden = !shown;
      threads.update();
    });
    cleanups.push(() => { slider.destroy(); tooltip.destroy(); threads.destroy(); });
  };
  // Terrain heights' decode workers publish each tile once in shared memory, which
  // Terrain geometry's workers read without a copy; where the page builds the
  // geometry a transfer already costs nothing, so the runtime asks only then.
  const sharedHeights = (parent: HTMLElement): void => {
    const on = heightsShared;
    const geometryInWorkers = (): boolean => nativeCorePlan(settings, "terrain").placement === "worker";
    const original = on();
    const element = document.createElement("div");
    element.className = "foss-earth-choices foss-earth-choice-group foss-earth-parameter--compact-choice foss-earth-execution-shared";
    element.dataset.executionControl = "raster.sharedHeights";
    element.setAttribute("role", "group");
    element.setAttribute("aria-label", "Shared memory");
    const heading = document.createElement("div");
    heading.className = "foss-earth-choices__heading";
    heading.textContent = "Shared memory";
    const slider = createTwoPositionSlider({ document, label: "Shared memory for terrain heights", options: [{ label: "Off" }, { label: "On" }],
      onInput: index => notify({ [sharedHeightsId]: index === 1 }) });
    // Why On would not share anything here: no isolation, or no geometry workers to read the tiles.
    const unused = document.createElement("span");
    unused.className = "foss-earth-choice-group__status";
    const changed = document.createElement("span");
    changed.className = "foss-earth-execution-control-pending";
    changed.textContent = "·";
    changed.title = "Changes pending";
    changed.setAttribute("aria-label", "Changes pending");
    const explanation = document.createElement("p");
    const tooltip = createHelpTooltip({ label: "Explain Terrain heights: Shared memory", content: explanation,
      onOpen: () => {
        explanation.textContent = `On keeps each decoded elevation tile once, in shared memory that the page and Terrain geometry's workers read, instead of copying it for each mesh job. The heights are the same either way. Used only while Terrain geometry runs in background workers${geometryInWorkers() ? "" : ", which it won't after reload"}; elsewhere tiles are transferred as before. ${isolated ? "This page is cross-origin isolated, so tiles can be shared." : `This page isn't cross-origin isolated, so tiles are transferred. ${notIsolatedReason}`} Details reports how many tiles arrived in shared memory. Takes effect after Apply and reload. Setting: ${sharedHeightsId}, now ${String(on())}.`;
      } });
    const end = document.createElement("span");
    end.className = "foss-earth-execution-shared__end";
    end.append(unused, changed, tooltip.element);
    element.append(heading, slider.element, end);
    parent.append(element);
    updates.push(() => {
      const shared = on(), shown = heightsShown();
      slider.update(shown ? 1 : 0, settings.inspect(sharedHeightsId).provenance === "host" || (!isolated && !shown));
      slider.input.title = !isolated && !shown ? unavailableTitle : "";
      unused.hidden = isolated && geometryInWorkers();
      unused.textContent = isolated ? "Needs geometry workers" : unavailableStatus;
      unused.title = isolated ? "Used only while Terrain geometry runs in background workers." : "";
      changed.hidden = shared === original;
    });
    cleanups.push(() => { slider.destroy(); tooltip.destroy(); });
  };
  // Every use of shared memory at once, beside the global choices, so it is found without opening a component;
  // each component's own switch changes one. Where the page cannot share memory it stays, grayed, and says why.
  const sharedMemoryEverywhere = (parent: HTMLElement): void => {
    const uses = (): boolean[] => [skyShared(), ...(heightsShareable ? [heightsShared()] : [])];
    const original = uses().join();
    const element = document.createElement("div");
    element.className = "foss-earth-choices foss-earth-choice-group foss-earth-parameter--compact-choice foss-earth-execution-shared";
    element.dataset.executionControl = "global.shared";
    element.setAttribute("role", "group");
    element.setAttribute("aria-label", "Shared memory");
    const heading = document.createElement("div");
    heading.className = "foss-earth-choices__heading";
    heading.textContent = "Shared memory";
    const slider = createTwoPositionSlider({ document, label: "Shared memory wherever it is supported", options: [{ label: "Off" }, { label: "On" }],
      onInput: index => {
        setSkyShared(index === 1);
        if (heightsShareable) notify({ [sharedHeightsId]: index === 1 });
      } });
    const state = document.createElement("span");
    state.className = "foss-earth-choice-group__status";
    const changed = document.createElement("span");
    changed.className = "foss-earth-execution-control-pending";
    changed.textContent = "·";
    changed.title = "Changes pending";
    changed.setAttribute("aria-label", "Changes pending");
    const explanation = document.createElement("p");
    const tooltip = createHelpTooltip({ label: "Explain Shared memory", content: explanation,
      onOpen: () => {
        const where = heightsShareable ? "the sky's shared-memory build (Sky → Shared memory) and one copy of each decoded elevation tile (Terrain heights → Shared memory)" : "the sky's shared-memory build (Sky → Shared memory)";
        explanation.textContent = `Shared memory lets the page and its workers work on one copy of data instead of each getting its own. On turns on each use: ${where}; each component's switch changes one. ${isolated ? "This page is cross-origin isolated, so shared memory can run." : `This page can't share memory. ${notIsolatedReason}`} Takes effect after Apply and reload.`;
      } });
    const end = document.createElement("span");
    end.className = "foss-earth-execution-shared__end";
    end.append(state, changed, tooltip.element);
    element.append(heading, slider.element, end);
    parent.append(element);
    updates.push(() => {
      const now = uses(), shown = [skyShown(), ...(heightsShareable ? [heightsShown()] : [])];
      const all = shown.every(Boolean), some = shown.some(Boolean);
      const forced = settings.inspect(skyId).provenance === "host" && (!heightsShareable || settings.inspect(sharedHeightsId).provenance === "host");
      // Where it cannot run, a request from the URL shows On, so the switch only turns it off.
      slider.update((isolated ? all : some) ? 1 : 0, forced || (!isolated && !some));
      slider.input.title = !isolated && !some ? unavailableTitle : "";
      state.hidden = isolated && (all || !some);
      state.textContent = isolated ? "Partly on" : unavailableStatus;
      state.title = isolated ? "Some components share memory and some do not; each component's Shared memory says which." : "";
      changed.hidden = now.join() === original;
    });
    cleanups.push(() => { slider.destroy(); tooltip.destroy(); });
  };
  manual(global);
  sharedMemoryEverywhere(global);
  const components = status.element;
  components.classList.add("foss-earth-execution-settings");
  for (const core of Object.keys(NATIVE_CORES) as NativeCoreId[]) {
    const details = document.createElement("details");
    details.className = "foss-earth-execution-override";
    details.dataset.executionComponent = core;
    const summary = document.createElement("summary");
    const componentLabel = document.createElement("span");
    componentLabel.textContent = NATIVE_CORES[core].label;
    const pendingLabel = document.createElement("span");
    const running = document.createElement("span");
    running.className = "foss-earth-execution-override__running";
    running.append(": ", status.summary(core), pendingLabel);
    summary.append(componentLabel, running, " ", status.help(core));
    const body = document.createElement("div");
    const implementation = manual(body, core);
    if (core === "sky") sharedMemory(implementation);
    if (core === "raster" && heightsShareable) sharedHeights(body);
    const note = document.createElement("p");
    note.className = "foss-earth-execution-note";
    body.append(note, status.component(core));
    details.append(summary, body);
    components.append(details);
    updates.push(() => {
      const basemap = settings.spec("map.source.basemap") ? settings.get("map.source.basemap") : null;
      const visible = basemap === null || core === "sky" || core === "ground"
        || (core === "google" ? basemap === "google" : basemap !== "google");
      if (!visible && !details.hidden) {
        closeHelpTooltipWithin(details);
        if (details.contains(document.activeElement)) global.querySelector<HTMLInputElement>("input:checked:not(:disabled)")?.focus();
      }
      details.hidden = !visible;
      const plan = nativeCorePlan(settings, core);
      const changed = planKey(core) !== initialPlans.get(core) || (core === "raster" && heightsChanged());
      pendingLabel.textContent = changed ? " · Pending" : "";
      note.hidden = plan.requested !== "auto";
      note.textContent = `Auto: ${plan.kernel === "typescript" ? "TS" : "WASM"} · ${plan.placement === "worker" || NATIVE_CORES[core].original === "worker" ? "Workers" : "Main thread"}`;
    });
  }
  const refresh = (): void => {
    for (const update of updates) update();
    const dirty = settings.get("native.workers") !== initial["native.workers"] || settings.get(NATIVE_THREADS_ID) !== initial[NATIVE_THREADS_ID]
      || [...initialPlans].some(([core, value]) => planKey(core) !== value) || heightsChanged();
    pending.dataset.pending = String(dirty);
    pending.hidden = !dirty;
    pendingText.textContent = dirty ? "Changes pending" : "";
    apply.hidden = discard.hidden = !dirty;
    status.refresh();
  };
  const applyChanges = (): void => options.reload(componentExecutionReloadUrl(settings, document.defaultView!.location.href));
  const discardChanges = (): void => notify(initial);
  apply.addEventListener("click", applyChanges);
  discard.addEventListener("click", discardChanges);
  const unsubscribe = settings.subscribe(changed => { if ([...changed].some(id => id.startsWith("native.") || id === "map.source.basemap")) refresh(); });
  refresh();
  // One Changes pending for the tab: the panel's, which compares what would run.
  const section = (id: "selection" | "cores", main: HTMLElement, covers: readonly string[]): HTMLElement => {
    const element = options.section(id, { main, covers, reload: applyChanges });
    element.classList.add("foss-earth-execution-section");
    return element;
  };
  return {
    sections: [
      { id: "selection", title: "Global defaults", element: section("selection", global, NATIVE_PARAMETERS.filter(spec => spec.home.section === "selection" && spec.id !== "native.workers").map(spec => spec.id)), defaultOpen: true },
      { id: "cores", title: "Components", element: section("cores", components, [...NATIVE_PARAMETERS.filter(spec => spec.home.section === "cores").map(spec => spec.id),
        ...(heightsShareable ? [sharedHeightsId] : [])]), defaultOpen: true },
    ], status,
    destroy() {
      unsubscribe(); status.destroy();
      apply.removeEventListener("click", applyChanges); discard.removeEventListener("click", discardChanges);
      for (const cleanup of cleanups) cleanup();
    },
  };
}
