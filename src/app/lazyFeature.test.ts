// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLazyFeatures, type LazyFeatureEnvironment } from "./lazyFeature";
import { LAZY_FEATURES_ELEMENT_ID, type LazyFeatureChunks } from "./lazyFeatureChunks";

afterEach(() => { document.head.replaceChildren(); document.body.replaceChildren(); });

/** A built page's feature map, a page that may be hidden and a connection, with idle callbacks run by hand. */
function page(map: Record<string, LazyFeatureChunks>, options: { search?: string; saveData?: boolean; effectiveType?: string } = {}) {
  const script = document.createElement("script");
  script.type = "application/json";
  script.id = LAZY_FEATURES_ELEMENT_ID;
  script.textContent = JSON.stringify(map);
  document.head.append(script);
  let hidden = false;
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
  const idle: (() => void)[] = [];
  const environment: LazyFeatureEnvironment = {
    document, search: options.search ?? "",
    connection: () => ({ saveData: options.saveData, effectiveType: options.effectiveType }),
    idle: callback => { idle.push(callback); },
  };
  const links = () => [...document.head.querySelectorAll<HTMLLinkElement>('link[rel="modulepreload"]')];
  return {
    features: createLazyFeatures(() => environment),
    links: () => links().map(link => new URL(link.href).pathname),
    /** The newest link finishes loading. */
    finish() { links().at(-1)!.dispatchEvent(new Event("load")); },
    runIdle() { while (idle.length) idle.shift()!(); },
    setHidden(next: boolean) { hidden = next; document.dispatchEvent(new Event("visibilitychange")); },
  };
}

const MAP = {
  editor: { urls: ["/app/assets/editor.js", "/app/assets/shared.js"], bytes: 42_000 },
  previews: { urls: ["/app/assets/previews.js", "/app/assets/shared.js"], bytes: 2_000 },
  dev: { urls: ["/app/assets/dev.js"], bytes: 9_000 },
};

describe("lazy features", () => {
  it("loads once, and tries again after a failed load", async () => {
    const { features } = page(MAP);
    const load = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ mount: "editor" });
    const feature = features.define({ id: "editor", prefetch: "never", load });
    await expect(feature.load()).rejects.toThrow("offline");
    const [first, second] = [feature.load(), feature.load()];
    expect(first).toBe(second);
    await expect(first).resolves.toEqual({ mount: "editor" });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("fetches a feature's chunks one at a time without running them, and each chunk once", () => {
    const { features, links, finish } = page(MAP);
    const load = vi.fn();
    const editor = features.define({ id: "editor", prefetch: "intent", load });
    const previews = features.define({ id: "previews", prefetch: "intent", load });
    editor.prefetch();
    expect(links()).toEqual(["/app/assets/editor.js"]);
    finish();
    expect(links()).toEqual(["/app/assets/editor.js", "/app/assets/shared.js"]);
    finish();
    previews.prefetch();
    editor.prefetch();
    finish();
    // The shared chunk is not asked for twice.
    expect(links()).toEqual(["/app/assets/editor.js", "/app/assets/shared.js", "/app/assets/previews.js"]);
    expect(load).not.toHaveBeenCalled();
  });

  it("fetches the idle features once the page has settled, in order, when it is idle, and intent first", () => {
    const { features, links, finish, runIdle } = page(MAP);
    features.define({ id: "editor", prefetch: "idle", tabs: ["controls"], load: vi.fn() });
    features.define({ id: "previews", prefetch: "idle", load: vi.fn() });
    features.define({ id: "dev", prefetch: "intent", tabs: ["dev"], load: vi.fn() });
    runIdle();
    expect(links()).toEqual([]);
    features.startIdle();
    expect(links()).toEqual([]);
    runIdle();
    expect(links()).toEqual(["/app/assets/editor.js"]);
    // The pointer reaches the Dev tab's button: its feature goes next, without waiting for idle.
    const button = document.createElement("button");
    button.dataset.tabId = "dev";
    button.append(document.createElement("span"));
    document.body.append(button);
    const stop = features.watchTabIntent(document);
    button.firstElementChild!.dispatchEvent(new Event("pointerover", { bubbles: true }));
    finish();
    expect(links()).toEqual(["/app/assets/editor.js", "/app/assets/dev.js"]);
    finish();
    runIdle();
    finish();
    runIdle();
    expect(links()).toEqual(["/app/assets/editor.js", "/app/assets/dev.js", "/app/assets/shared.js", "/app/assets/previews.js"]);
    stop();
  });

  it("waits while the page is hidden, and fetches nothing on a saving or 2G connection", () => {
    const hidden = page(MAP);
    const editor = hidden.features.define({ id: "editor", prefetch: "intent", load: vi.fn() });
    hidden.setHidden(true);
    editor.prefetch();
    expect(hidden.links()).toEqual([]);
    hidden.setHidden(false);
    expect(hidden.links()).toEqual(["/app/assets/editor.js"]);
    document.head.replaceChildren();

    for (const connection of [{ saveData: true }, { effectiveType: "2g" }, { effectiveType: "slow-2g" }]) {
      const slow = page(MAP, connection);
      slow.features.define({ id: "editor", prefetch: "intent", load: vi.fn() }).prefetch();
      expect(slow.links()).toEqual([]);
      document.head.replaceChildren();
    }
  });

  it("keeps developer tools to dev pages", () => {
    const visitor = page(MAP);
    visitor.features.define({ id: "dev", prefetch: "idle", devOnly: true, load: vi.fn() }).prefetch();
    visitor.features.startIdle();
    visitor.runIdle();
    expect(visitor.links()).toEqual([]);
    document.head.replaceChildren();

    const developer = page(MAP, { search: "?dev=1" });
    developer.features.define({ id: "dev", prefetch: "idle", devOnly: true, load: vi.fn() });
    developer.features.startIdle();
    developer.runIdle();
    expect(developer.links()).toEqual(["/app/assets/dev.js"]);
  });

  it("does nothing without the build's map, and says what a load cost where a log is given", async () => {
    const { features } = page(MAP);
    const lines: string[] = [];
    features.setLog(text => lines.push(text));
    await features.define({ id: "editor", label: "the pose editor", prefetch: "never", load: async () => ({}) }).load();
    expect(lines).toEqual(["Loaded the pose editor (42 KB)"]);
    document.head.replaceChildren();

    const bare = createLazyFeatures(() => ({ document, search: "", connection: () => undefined, idle: callback => callback() }));
    bare.define({ id: "editor", prefetch: "intent", load: vi.fn() }).prefetch();
    expect(document.head.querySelector("link")).toBeNull();
  });
});
