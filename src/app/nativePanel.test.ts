// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSettingsRegistry } from "@foss-earth/ui/settings";
import { nativeCorePlan, MAP_SOURCE_PARAMETERS, NATIVE_PARAMETERS, type NativeCoreId } from "@foss-earth/engine/settings";
import { componentExecutionReloadUrl, createNativeSections, createNativeStatusView, nativeDetailText } from "./nativePanel";
import type { ParameterSpec } from "@foss-earth/ui/settings";
import type { NativeCoreReport } from "./nativeReport";
import { describeNativeCores } from "./nativeReport";
import { TERRAIN_SHARED_HEIGHTS_PARAMETER } from "./terrainNativeWorkerConfig";

const ids: NativeCoreId[] = ["raster", "sky", "terrain", "imagery", "google", "ground"];
const settingsFor = (search = "") => {
  const settings = createSettingsRegistry({ storage: null, searchParams: new URLSearchParams(search) });
  settings.register([...MAP_SOURCE_PARAMETERS, ...NATIVE_PARAMETERS]);
  return settings;
};
const panels: ReturnType<typeof createNativeSections>[] = [];
function mount(settings = settingsFor()) {
  // These reports deliberately retain the startup configuration, as real services do.
  const plans = Object.fromEntries(ids.map(id => [id, nativeCorePlan(settings, id)])) as Record<NativeCoreId, ReturnType<typeof nativeCorePlan>>;
  const reload = vi.fn();
  const clear = vi.fn();
  const covers: Record<string, readonly string[]> = {};
  const sectionReloads: Record<string, (() => void) | undefined> = {};
  const panel = createNativeSections({ document, settings, reload,
    section: (section, content) => { covers[section] = content.covers; sectionReloads[section] = content.reload; return content.main; },
    report: () => describeNativeCores({ plans, terrainDecode: () => null, skyEvaluation: () => null }),
    timers: { set: () => 123, clear },
  });
  for (const section of panel.sections) document.body.append(section.element);
  panels.push(panel);
  const choose = (control: string, value: string) => {
    const input = document.querySelector<HTMLInputElement>(`[data-execution-control="${control}"] input[value="${value}"]`)!;
    expect(input, `${control} / ${value}`).toBeTruthy();
    expect(input.disabled).toBe(false);
    input.click();
  };
  return { settings, panel, reload, clear, choose, covers, sectionReloads };
}
/** Pages are cross-origin isolated only where the server or the app's service worker made them so; jsdom's is not. */
const isolate = () => Object.defineProperty(window, "crossOriginIsolated", { value: true, configurable: true });
/** A page over http from a network address, as a phone opening a development server: not a secure context. */
const secureContext = Object.getOwnPropertyDescriptor(window, "isSecureContext");
const insecure = () => Object.defineProperty(window, "isSecureContext", { value: false, configurable: true });
afterEach(() => {
  for (const panel of panels.splice(0)) panel.destroy();
  document.body.replaceChildren();
  delete (window as { crossOriginIsolated?: boolean }).crossOriginIsolated;
  if (secureContext) Object.defineProperty(window, "isSecureContext", secureContext);
  else delete (window as { isSecureContext?: boolean }).isSecureContext;
});

describe("Component execution", () => {
  it("separates the choices and keeps diagnostics collapsed", () => {
    const { panel } = mount();
    expect(panel.sections.map(section => section.title)).toEqual(["Global defaults", "Components"]);
    expect(document.querySelector("table")).toBeNull();
    expect(document.querySelectorAll('.foss-earth-execution-override [data-component]')).toHaveLength(6);
    expect(document.querySelector('[data-component="sky"]')?.closest('details')?.className).toBe('foss-earth-execution-override');
    const mode = document.querySelector('[data-execution-control="sky.mode"]')!;
    expect([...mode.querySelectorAll("label span")].map(span => span.textContent)).toEqual(["Global", "Auto", "Manual"]);
    expect(mode.querySelectorAll(":scope > a")).toHaveLength(0);
    expect(mode.lastElementChild?.querySelector("button")?.textContent).toBe("?");
    mode.querySelector<HTMLButtonElement>("button")!.click();
    const tooltip = document.getElementById(mode.querySelector("button")!.getAttribute("aria-controls")!)!;
    expect(tooltip.querySelector<HTMLAnchorElement>("a")!.textContent).toBe("↗");
    expect(tooltip.querySelector<HTMLAnchorElement>("a")!.getAttribute("aria-label")).toContain("source code");
    expect(tooltip.querySelector("p")!.lastElementChild).toBe(tooltip.querySelector("a"));
    mode.querySelector<HTMLButtonElement>("button")!.click();
    for (const field of ["mode", "implementation", "placement", "parallelism"]) {
      expect(document.querySelector(`[data-execution-control="global.${field}"]`)).not.toBeNull();
    }
    // Shared memory is found beside the global choices, without opening a component, and is the sky's own decision after its Implementation.
    const everywhere = document.querySelector<HTMLElement>('[data-execution-control="global.shared"]')!;
    expect(everywhere.previousElementSibling).toBe(document.querySelector('[data-execution-control="global.parallelism"]'));
    expect(everywhere.closest("details")).toBeNull();
    const shared = document.querySelector<HTMLElement>('[data-execution-control="sky.shared"]')!;
    expect(shared.closest("[data-execution-component]")?.getAttribute("data-execution-component")).toBe("sky");
    expect(document.querySelector('[data-execution-control="sky.implementation"]')!.nextElementSibling).toBe(shared);
    expect([...document.querySelectorAll<HTMLElement>('[data-execution-control$=".shared"]')].map(control => control.dataset.executionControl)).toEqual(["global.shared", "sky.shared"]);
    expect(shared.querySelector(".foss-earth-choices__heading")!.textContent).toBe("Shared memory");
    expect(shared.lastElementChild?.lastElementChild?.querySelector("button")?.textContent).toBe("?");
    expect([...document.querySelectorAll('[data-execution-control="global.parallelism"] label span')].map(span => span.textContent)).toEqual(["1 worker", "Pool"]);
    expect(document.querySelector('[data-execution-control="global.parallelism"] input[value="serial"]')?.getAttribute("aria-label")).toBe("One worker per component");
    expect([...document.querySelectorAll<HTMLElement>(".foss-earth-execution-override > div > .foss-earth-execution-note")].every(note => note.hidden)).toBe(true);
    expect(document.querySelectorAll(".foss-earth-execution-component")).toHaveLength(6);
    expect(document.querySelector(".foss-earth-execution-component details")).toBeNull();
    const component = document.querySelector<HTMLDetailsElement>(".foss-earth-execution-override")!;
    const title = component.querySelector("summary")!;
    const help = title.querySelector("button")!;
    expect(title.lastElementChild?.contains(help)).toBe(true);
    expect(help.textContent).toBe("?");
    expect(component.open).toBe(false);
    help.click();
    expect(component.open).toBe(false);
    expect(help.getAttribute("aria-expanded")).toBe("true");
    const info = document.getElementById(help.getAttribute("aria-controls")!)!;
    expect(info.hidden).toBe(false);
    expect(info.textContent).toContain("Parity:");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(info.hidden).toBe(true);
    component.open = true;
    help.click();
    expect(component.open).toBe(true);
    expect(help.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector<HTMLButtonElement>(".foss-earth-execution-pending button")!.hidden).toBe(true);
  });

  it("shows only applicable components and preserves hidden overrides, expansion and status", () => {
    const { settings, choose, panel } = mount();
    const card = (id: NativeCoreId) => document.querySelector<HTMLDetailsElement>(`[data-execution-component="${id}"]`)!;
    const visible = () => ids.filter(id => !card(id).hidden);
    expect(visible()).toEqual(["raster", "sky", "terrain", "imagery", "ground"]);
    card("terrain").open = true;
    choose("terrain.mode", "custom");
    choose("terrain.implementation", "wasm");
    const control = card("terrain").querySelector('[data-execution-control="terrain.implementation"]')!;
    const help = card("terrain").querySelector<HTMLButtonElement>("summary button")!;
    help.focus(); help.click();
    const info = document.getElementById(help.getAttribute("aria-controls")!)!;
    expect(info.hidden).toBe(false);
    settings.set("map.source.basemap", "google");
    expect(visible()).toEqual(["sky", "google", "ground"]);
    expect(info.hidden).toBe(true);
    expect(document.activeElement?.closest('[data-execution-control="global.mode"]')).not.toBeNull();
    expect(card("terrain").open).toBe(true);
    expect(settings.get("native.core.terrain.implementation")).toBe("wasm");
    expect(panel.status.component("terrain")).toBe(card("terrain").querySelector('[data-component="terrain"]'));
    settings.set("map.source.basemap", "osm-standard");
    expect(visible()).toEqual(["raster", "sky", "terrain", "imagery", "ground"]);
    expect(card("terrain").querySelector('[data-execution-control="terrain.implementation"]')).toBe(control);
    expect(card("terrain").open).toBe(true);
    expect(card("terrain").querySelector<HTMLInputElement>('input[value="wasm"]')!.checked).toBe(true);
  });

  it("immediately shows pending and current settings separately, then reloads with the exact draft", () => {
    const { settings, choose, reload, panel } = mount(settingsFor("set.native.tier=typescript-worker"));
    const before = panel.status.summary("terrain").textContent;
    choose("global.implementation", "wasm");
    // Sky → Shared memory is on by default, so a WASM sky runs its shared build.
    expect(nativeCorePlan(settings, "sky")).toMatchObject({ kernel: "threaded", placement: "worker" });
    expect(document.querySelector('.foss-earth-execution-pending [role="status"]')!.textContent).toContain("Changes pending");
    expect(panel.status.summary("terrain").textContent).toBe(before);
    expect(document.querySelector('.foss-earth-execution-component[data-component="terrain"] .foss-earth-execution-component__next')!.textContent).toContain("After reload: WebAssembly");
    expect(document.querySelector<HTMLInputElement>('[data-execution-control="global.placement"] input[value="original"]')!.disabled).toBe(true);
    document.querySelector<HTMLButtonElement>(".foss-earth-execution-pending button")!.click();
    expect(reload).toHaveBeenCalledOnce();
    const url = new URL(reload.mock.calls[0][0]);
    const reloaded = settingsFor(url.search);
    expect(nativeCorePlan(reloaded, "sky")).toMatchObject({ kernel: "threaded", placement: "worker" });
    expect(url.searchParams.get("set.native.tier")).toBe("custom");
  });

  it("inherits individual decisions and updates only the selected component", () => {
    const { settings, choose } = mount(settingsFor("set.native.tier=single"));
    choose("sky.mode", "custom");
    choose("sky.implementation", "typescript");
    expect(nativeCorePlan(settings, "sky")).toMatchObject({ kernel: "typescript", placement: "worker" });
    expect(nativeCorePlan(settings, "terrain").kernel).toBe("single");
    choose("global.parallelism", "serial");
    expect(nativeCorePlan(settings, "sky").parallelism).toBe("serial");
    expect(settings.get("native.core.sky.parallelism")).toBe("inherit");
    expect(document.querySelector<HTMLInputElement>('[data-execution-control="sky.parallelism"] input[value="auto"]')!.disabled).toBe(true);
  });

  it("retains manual choices across Auto and clears pending when the original selection is restored", () => {
    const { settings, choose } = mount(settingsFor("set.native.tier=single"));
    choose("global.mode", "auto");
    expect(document.querySelector<HTMLElement>('[data-execution-control="global.implementation"]')!.hidden).toBe(true);
    choose("global.mode", "custom");
    expect(nativeCorePlan(settings, "sky").kernel).toBe("threaded");
    document.querySelectorAll<HTMLButtonElement>(".foss-earth-execution-pending button")[1]!.click();
    expect(settings.get("native.tier")).toBe("single");
    expect(document.querySelector<HTMLButtonElement>(".foss-earth-execution-pending button")!.hidden).toBe(true);
    choose("sky.mode", "custom");
    choose("sky.implementation", "typescript");
    choose("sky.mode", "inherit");
    expect(document.querySelector<HTMLButtonElement>(".foss-earth-execution-pending button")!.hidden).toBe(true);
    choose("sky.mode", "custom");
    expect(nativeCorePlan(settings, "sky").kernel).toBe("typescript");
  });

  it("compacts measured execution while preserving mixed placement and fallbacks", () => {
    const plans = Object.fromEntries(ids.map(id => [id, nativeCorePlan(settingsFor(), id)])) as Record<NativeCoreId, ReturnType<typeof nativeCorePlan>>;
    const rows = describeNativeCores({ plans, terrainDecode: () => null, skyEvaluation: () => null });
    const view = createNativeStatusView(document, () => rows, { set: () => 1, clear: () => {} });
    const update = (id: NativeCoreId, actual: string, expected: string, detail: unknown = null, fallbackReason: string | null = null) => {
      Object.assign(rows.find(row => row.core === id)!, { actual, detail, fallbackReason } satisfies Partial<NativeCoreReport>);
      view.refresh();
      expect(view.summary(id).textContent).toBe(expected);
    };
    try {
      update("sky", "typescript (worker)", "TS (1 worker)");
      expect(view.component("sky").dataset.runningImplementation).toBe("typescript");
      update("terrain", "wasm-single (worker)", "WASM (3 workers)", { workers: 3 });
      expect(view.component("terrain").dataset.runningImplementation).toBe("wasm");
      update("terrain", "typescript (page)", "TS (main)");
      update("raster", "mixed: typescript, wasm-single", "mixed: TS, WASM (2 workers + main)", { workers: 2, pageDecodes: 1 });
      expect(view.component("raster").dataset.runningImplementation).toBe("mixed");
      update("imagery", "wasm-single (worker cache + page misses)", "WASM (1 worker + main)");
      update("ground", "single worker build; TypeScript synchronous queries", "WASM (1 worker build; TS main queries)");
      const sky = rows.find(row => row.core === "sky")!;
      sky.shared = { actual: "threaded", retiredReason: null, crossOriginIsolated: true, memoryBytes: 4194304, memoryGrows: false,
        threads: { requested: 4, limit: 8, connected: 4, ready: 4, helpers: [] }, copies: { inBytes: 0, outBytes: 0 }, lastBatch: null,
        batches: { total: 6, parallel: 5, solo: 1, rows: 0, directions: 0, rowsByThread: [3, 2, 2, 1], waitMs: 1.25, maxWaitMs: 0.5 } };
      sky.parity = { tables: "same", fanRows: { solo: "same", parallel: "same" } };
      update("sky", "threaded (worker)", "WASM (4 shared threads)");
      expect(view.component("sky").dataset.runningImplementation).toBe("wasm");
      view.help("sky").querySelector("button")!.click();
      const info = document.getElementById(view.help("sky").querySelector("button")!.getAttribute("aria-controls")!)!;
      expect(info.textContent).toContain("Shared memory: 4 MiB, fixed · 4 of 4 threads ready (4 connected, limit 8)");
      expect(info.textContent).toContain("rows by thread 3/2/2/1");
      expect(info.textContent).toContain("Parity: tables same, fanRows (solo same, parallel same)");
      // Threads that did not start are said, ready of requested.
      sky.shared.threads.ready = 3;
      update("sky", "threaded (worker)", "WASM (3 of 4 shared threads)");
      sky.shared = null;
      update("sky", "single (worker)", "WASM (1 worker) · fallback", null, "not-cross-origin-isolated");
      expect(view.component("sky").textContent).toContain("Fallback: page not cross-origin isolated");
      expect(info.textContent).toContain("Fallback: not-cross-origin-isolated");
      update("sky", "single (worker)", "WASM (1 worker) · fallback", null, "shared-core-retired: helper-timeout");
      expect(view.component("sky").textContent).toContain("Fallback: shared threads stopped (helper timeout)");
      update("sky", "typescript (page)", "TS (main) · fallback", null, "worker retired");
      expect(view.component("sky").textContent).toContain("Fallback: worker retired");
      expect(view.component("sky").dataset.runningImplementation).toBe("typescript");
    } finally { view.destroy(); }
  });

  it("makes a status failure visible after a successful report, then recovers", () => {
    let fail = false;
    const plans = Object.fromEntries(ids.map(id => [id, nativeCorePlan(settingsFor(), id)])) as Record<NativeCoreId, ReturnType<typeof nativeCorePlan>>;
    const view = createNativeStatusView(document, () => {
      if (fail) throw Error("report failed");
      return describeNativeCores({ plans, terrainDecode: () => null, skyEvaluation: () => null });
    }, { set: () => 1, clear: () => {} });
    document.body.append(view.element);
    try {
      fail = true; view.refresh();
      expect(view.element.querySelector('p')!.hidden).toBe(false);
      expect(view.element.textContent).toContain('Status unavailable: report failed');
      expect(view.summary('sky').textContent).toBe('Status unavailable');
      expect(view.component('sky').dataset.runningImplementation).toBe('unknown');
      fail = false; view.refresh();
      expect(view.element.querySelector('p')!.hidden).toBe(true);
      expect(view.summary('sky').textContent).toBe('No work yet');
    } finally { view.destroy(); }
  });

  it("says how many elevation tiles arrived in shared memory, and nothing when none did", () => {
    const raster = (sharedHeights: number) => nativeDetailText({ core: "raster", actual: "typescript",
      detail: { workers: 2, pageDecodes: 1, sharedHeights, perWorker: [{ tasks: 3, meanMs: 2 }, { tasks: 1, meanMs: 4 }] } } as unknown as NativeCoreReport);
    expect(raster(4)).toBe("2 workers · 4 decodes · mean 2.5 ms each, dispatch to reply · 1 on the page · 4 in shared memory");
    expect(raster(0)).toBe("2 workers · 4 decodes · mean 2.5 ms each, dispatch to reply · 1 on the page");
  });
  it("turns the sky's shared memory on and off with a slider, and reloads with it", () => {
    isolate();
    const { settings, reload, covers } = mount(settingsFor("set.native.threads=3"));
    const slider = document.querySelector<HTMLInputElement>('[data-execution-control="sky.shared"] input[type="range"]')!;
    const slide = (value: "0" | "1") => { slider.value = value; slider.dispatchEvent(new Event("input")); };
    const pending = document.querySelector<HTMLElement>(".foss-earth-execution-pending")!;
    const threads = document.querySelector<HTMLElement>('[data-execution-control="sky.threads"]')!;
    const next = () => document.querySelector('.foss-earth-execution-component[data-component="sky"] .foss-earth-execution-component__next')!.textContent;
    // On by default: the default WASM sky runs its shared build.
    expect(slider.value).toBe("1");
    expect(slider.disabled).toBe(false);
    expect(document.querySelector<HTMLElement>('[data-execution-control="sky.shared"] .foss-earth-choice-group__status')!.hidden).toBe(true);
    expect(nativeCorePlan(settings, "sky")).toMatchObject({ kernel: "threaded", sharedMemory: true, threads: 3 });
    expect(nativeCorePlan(settings, "raster").kernel).toBe("single");
    // The thread count is drawn once, in the sky, and only while shared memory is asked for.
    expect(covers.selection).toContain("native.threads");
    expect(covers.selection).not.toContain("native.workers");
    expect(covers.cores).toContain("native.sharedSky");
    expect(threads.hidden).toBe(false);
    expect(threads.textContent).toContain("Shared-memory threads");
    slide("0");
    expect(threads.hidden).toBe(true);
    expect([settings.get("native.sharedSky"), settings.get("native.core.sky")]).toEqual([false, "inherit"]);
    expect(nativeCorePlan(settings, "sky")).toMatchObject({ kernel: "single", sharedMemory: false });
    expect(pending.dataset.pending).toBe("true");
    expect(next()).toBe("After reload: WebAssembly · background workers · worker pools where supported");
    slide("1");
    expect(settings.get("native.sharedSky")).toBe(true);
    expect(pending.dataset.pending).toBe("false");
    // A thread count is pending on its own, and Discard restores it.
    settings.set("native.threads", 5);
    expect(pending.dataset.pending).toBe("true");
    pending.querySelectorAll<HTMLButtonElement>("button")[1]!.click();
    expect(settings.get("native.threads")).toBe(3);
    expect(pending.dataset.pending).toBe("false");
    // A sky that would not run WASM is asked for its shared build, and Off asks no more.
    settings.set("native.tier", "typescript");
    expect([slider.value, threads.hidden]).toEqual(["0", true]);
    slide("1");
    expect(settings.get("native.core.sky")).toBe("threaded");
    expect(nativeCorePlan(settings, "raster").kernel).toBe("typescript");
    expect(next()).toBe("After reload: Shared-memory WASM, 3 threads · background workers · worker pools where supported");
    slide("0");
    expect([settings.get("native.core.sky"), nativeCorePlan(settings, "sky").kernel]).toEqual(["inherit", "typescript"]);
    slide("1");
    pending.querySelector<HTMLButtonElement>("button")!.click();
    const url = new URL(reload.mock.calls[0][0]);
    expect(nativeCorePlan(settingsFor(url.search), "sky")).toMatchObject({ kernel: "threaded", sharedMemory: true, threads: 3 });
  });

  describe("Terrain heights in shared memory", () => {
    const withHeights = (search = "") => {
      const settings = settingsFor(search);
      settings.register([TERRAIN_SHARED_HEIGHTS_PARAMETER as ParameterSpec]);
      return settings;
    };
    const control = () => document.querySelector<HTMLElement>('[data-execution-control="raster.sharedHeights"]');
    it("is drawn only where the host registers it", () => {
      mount();
      expect(control()).toBeNull();
    });
    it("is Terrain heights' own switch, says when nothing would read a shared tile, and reloads with it", () => {
      isolate();
      const settings = withHeights();
      const { reload, covers } = mount(settings);
      const shared = control()!;
      expect(shared.closest("[data-execution-component]")?.getAttribute("data-execution-component")).toBe("raster");
      expect(shared.querySelector(".foss-earth-choices__heading")!.textContent).toBe("Shared memory");
      expect(shared.lastElementChild?.lastElementChild?.querySelector("button")?.textContent).toBe("?");
      expect(covers.cores).toContain("native.sharedHeights");
      const slider = shared.querySelector<HTMLInputElement>('input[type="range"]')!;
      const status = shared.querySelector<HTMLElement>(".foss-earth-choice-group__status")!;
      const pending = document.querySelector<HTMLElement>(".foss-earth-execution-pending")!;
      // On by default, and Terrain geometry runs in background workers by default, which read the shared tiles.
      expect([slider.value, slider.disabled, status.hidden]).toEqual(["1", false, true]);
      slider.value = "0";
      slider.dispatchEvent(new Event("input"));
      expect(settings.get("native.sharedHeights")).toBe(false);
      expect(pending.dataset.pending).toBe("true");
      expect(shared.closest("details")!.querySelector("summary")!.textContent).toContain("· Pending");
      // Geometry on the page, where a transfer already costs nothing, reads no shared tile.
      settings.set("native.tier", "typescript");
      expect([status.hidden, status.textContent]).toEqual([false, "Needs geometry workers"]);
      pending.querySelector<HTMLButtonElement>("button")!.click();
      expect(new URL(reload.mock.calls[0][0]).searchParams.get("set.native.sharedHeights")).toBe("false");
      pending.querySelectorAll<HTMLButtonElement>("button")[1]!.click();
      expect(settings.get("native.sharedHeights")).toBe(true);
      expect([slider.value, pending.dataset.pending, status.hidden]).toEqual(["1", "false", true]);
    });
    it("is not offered on a page that is not isolated, but a URL's request can be turned off", () => {
      const settings = withHeights("set.native.sharedHeights=true");
      mount(settings);
      const slider = control()!.querySelector<HTMLInputElement>('input[type="range"]')!;
      expect(control()!.querySelector(".foss-earth-choice-group__status")!.textContent).toBe("Not isolated");
      expect([slider.value, slider.disabled]).toEqual(["1", false]);
      slider.value = "0";
      slider.dispatchEvent(new Event("input"));
      expect(settings.get("native.sharedHeights")).toBe(false);
      expect(slider.disabled).toBe(true);
      expect(slider.title).toBe("Shared memory needs a cross-origin isolated page.");
    });
  });

  describe("Shared memory everywhere", () => {
    const withHeights = (search = "") => {
      const settings = settingsFor(search);
      settings.register([TERRAIN_SHARED_HEIGHTS_PARAMETER as ParameterSpec]);
      return settings;
    };
    const control = () => document.querySelector<HTMLElement>('[data-execution-control="global.shared"]')!;
    const parts = () => {
      const element = control();
      return { slider: element.querySelector<HTMLInputElement>('input[type="range"]')!, status: element.querySelector<HTMLElement>(".foss-earth-choice-group__status")! };
    };
    const slide = (slider: HTMLInputElement, value: "0" | "1") => { slider.value = value; slider.dispatchEvent(new Event("input")); };
    const explain = () => {
      control().querySelector<HTMLButtonElement>("button")!.click();
      return document.getElementById(control().querySelector("button")!.getAttribute("aria-controls")!)!.textContent;
    };

    it("turns on every use of shared memory at once, says when only some are on, and reloads with them", () => {
      isolate();
      const settings = withHeights();
      const { reload } = mount(settings);
      const { slider, status } = parts();
      const pending = document.querySelector<HTMLElement>(".foss-earth-execution-pending")!;
      // On by default.
      expect([slider.value, slider.disabled, status.hidden]).toEqual(["1", false, true]);
      expect(explain()).toContain("This page is cross-origin isolated, so shared memory can run.");
      slide(slider, "0");
      expect([settings.get("native.sharedSky"), settings.get("native.sharedHeights"), nativeCorePlan(settings, "sky").sharedMemory]).toEqual([false, false, false]);
      expect(pending.dataset.pending).toBe("true");
      // A component's own switch changes one use; the global one says so.
      slide(document.querySelector<HTMLInputElement>('[data-execution-control="raster.sharedHeights"] input[type="range"]')!, "1");
      expect([slider.value, status.hidden, status.textContent]).toEqual(["0", false, "Partly on"]);
      pending.querySelector<HTMLButtonElement>("button")!.click();
      const url = new URL(reload.mock.calls[0][0]);
      expect(url.searchParams.get("set.native.sharedHeights")).toBe("true");
      expect(nativeCorePlan(settingsFor(url.search), "sky").sharedMemory).toBe(false);
      slide(slider, "1");
      expect([settings.get("native.sharedSky"), settings.get("native.sharedHeights"), pending.dataset.pending]).toEqual([true, true, "false"]);
    });

    it("stays, grayed, on a page that is not isolated, and turns off a URL's request", () => {
      const settings = withHeights("set.native.core.sky=threaded");
      mount(settings);
      const { slider, status } = parts();
      expect([slider.value, slider.disabled, status.textContent]).toEqual(["1", false, "Not isolated"]);
      slide(slider, "0");
      expect([settings.get("native.core.sky"), settings.get("native.sharedHeights")]).toEqual(["inherit", false]);
      expect([slider.disabled, slider.title]).toEqual([true, "Shared memory needs a cross-origin isolated page."]);
      expect(explain()).toContain("This page can't share memory. In development the server's headers decide: start it with FOSS_EARTH_ISOLATION=enforce.");
    });

    it("says a page over http from a network address is not secure, and how to open it so it can share memory", () => {
      insecure();
      mount(withHeights());
      const { slider, status } = parts();
      expect([slider.value, slider.disabled, slider.title, status.textContent]).toEqual(["0", true, "Shared memory needs a secure (HTTPS) page.", "Not secure"]);
      expect(explain()).toContain("Only a secure page (HTTPS or localhost) can share memory, and this one");
      expect(explain()).toContain("a development server started with --host serves HTTPS");
      for (const component of ["sky.shared", "raster.sharedHeights"]) {
        expect(document.querySelector(`[data-execution-control="${component}"] .foss-earth-choice-group__status`)!.textContent, component).toBe("Not secure");
        // The default asks for shared memory, but only a request someone made shows On where it cannot run.
        const own = document.querySelector<HTMLInputElement>(`[data-execution-control="${component}"] input[type="range"]`)!;
        expect([own.value, own.disabled], component).toEqual(["0", true]);
      }
    });
  });

  it("gives a host section's Apply & reload the edited values, over the opening URL", () => {
    isolate();
    const { settings, reload, sectionReloads } = mount(settingsFor("set.native.threads=4&set.native.core.sky=threaded"));
    settings.set("native.threads", 2);
    expect(document.querySelectorAll(".foss-earth-execution-section")).toHaveLength(2);
    sectionReloads.cores!();
    const url = new URL(reload.mock.calls[0][0]);
    expect(url.searchParams.get("set.native.threads")).toBe("2");
    expect(nativeCorePlan(settingsFor(url.search), "sky")).toMatchObject({ sharedMemory: true, threads: 2 });
  });

  it("does not offer shared memory on a page that is not isolated, but lets a URL's request be turned off", () => {
    const { settings } = mount(settingsFor());
    const shared = document.querySelector<HTMLElement>('[data-execution-control="sky.shared"]')!;
    const slider = shared.querySelector<HTMLInputElement>('input[type="range"]')!;
    expect(slider.disabled).toBe(true);
    expect(slider.title).toBe("Shared memory needs a cross-origin isolated page.");
    expect(shared.querySelector<HTMLElement>(".foss-earth-choice-group__status")!.hidden).toBe(false);
    expect(shared.querySelector(".foss-earth-choice-group__status")!.textContent).toBe("Not isolated");
    shared.querySelector<HTMLButtonElement>("button")!.click();
    const help = document.getElementById(shared.querySelector("button")!.getAttribute("aria-controls")!)!;
    expect(help.textContent).toContain("This page isn't cross-origin isolated, so a shared-memory sky runs single-threaded WASM. In development the server's headers decide");
    // The runtime falls back the same way; After reload says so rather than promising threads.
    settings.set("native.core.sky", "threaded");
    expect(slider.disabled).toBe(false);
    expect(document.querySelector('.foss-earth-execution-component[data-component="sky"] .foss-earth-execution-component__next')!.textContent)
      .toBe("After reload: WebAssembly, 1 thread (page not cross-origin isolated) · background workers · worker pools where supported");
    expect(settings.get("native.core.sky")).toBe("threaded");
    slider.value = "0";
    slider.dispatchEvent(new Event("input"));
    expect(settings.get("native.core.sky")).toBe("inherit");
    expect(slider.disabled).toBe(true);
  });

  it("says a threaded request of a component without a shared build runs TypeScript", () => {
    const { settings } = mount(settingsFor());
    settings.set("native.tier", "threaded");
    expect(document.querySelector('.foss-earth-execution-component[data-component="raster"] .foss-earth-execution-component__next')!.textContent)
      .toBe("After reload: TypeScript (no shared-memory build) · background workers · worker pools where supported");
  });

  it("turns shared memory off for the sky even when the global selection is threaded", () => {
    isolate();
    const { settings } = mount(settingsFor("set.native.tier=threaded"));
    const slider = document.querySelector<HTMLInputElement>('[data-execution-control="sky.shared"] input[type="range"]')!;
    expect(slider.value).toBe("1");
    slider.value = "0";
    slider.dispatchEvent(new Event("input"));
    expect(settings.get("native.core.sky")).toBe("single");
    expect(nativeCorePlan(settings, "sky")).toMatchObject({ kernel: "single", sharedMemory: false });
    expect(slider.value).toBe("0");
  });

  it("overrides a stale opening URL while preserving the app route, other settings and camera fragment", () => {
    const settings = settingsFor("set.native.tier=single");
    settings.setMany({ "native.tier": "custom", "native.implementation": "typescript", "native.placement": "worker" });
    const url = new URL(componentExecutionReloadUrl(settings, "https://example.test/tour/minneapolis/?panoramaTest=1&set.native.tier=single#camera"));
    expect(url.pathname).toBe("/tour/minneapolis/");
    expect(url.hash).toBe("#camera");
    expect(url.searchParams.get("panoramaTest")).toBe("1");
    expect(nativeCorePlan(settingsFor(url.search), "sky")).toMatchObject({ kernel: "typescript", placement: "worker" });
  });

  it("does not offer the unavailable threaded tier and respects forced host settings", () => {
    const settings = settingsFor();
    settings.force("native.tier", "typescript", "Host requires the reference implementation");
    const { panel, clear } = mount(settings);
    expect(document.querySelector('input[value="threaded"]')).toBeNull();
    expect(document.querySelector<HTMLInputElement>('[data-execution-control="global.implementation"] input[value="wasm"]')!.disabled).toBe(true);
    panel.destroy();
    panel.destroy();
    expect(clear).toHaveBeenCalledOnce();
    settings.set("native.workers", 1); // no detached view subscriptions
  });
});
