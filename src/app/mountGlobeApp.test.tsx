// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { createGlobeApp, type GlobeAppHandle } from "./createGlobeApp";
import { trackViewportInsets } from "@foss-earth/ui/browser";
import { mountGlobeApp } from "./mountGlobeApp";

vi.mock("react-dom/client", () => ({ createRoot: vi.fn() }));
vi.mock("./createGlobeApp", () => ({ createGlobeApp: vi.fn(), getAppIdentity: vi.fn() }));
vi.mock("@foss-earth/ui/browser", async importOriginal => ({ ...await importOriginal<typeof import("@foss-earth/ui/browser")>(), trackViewportInsets: vi.fn() }));
vi.mock("../shell/WindowOverlay", () => ({ WindowOverlay: () => null }));
vi.mock("../settings/appSettings", () => ({ getAppSettings: vi.fn() }));
vi.mock("./reportOnly", () => ({ wantsReportOnly: () => false, showReportOnly: vi.fn() }));

describe("mounted globe resource lifetime", () => {
  const order: string[] = [];
  let root: HTMLElement;
  const destroy = vi.fn(() => { order.push("app"); root.replaceChildren(); });
  const unmount = vi.fn(() => { order.push("overlay"); });
  const dispose = vi.fn(() => { order.push("viewport"); });
  const render = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks(); order.length = 0;
    unmount.mockImplementation(() => { order.push("overlay"); });
    dispose.mockImplementation(() => { order.push("viewport"); });
    root = document.createElement("main"); root.innerHTML = '<div class="globe-shell"></div>';
    vi.mocked(createGlobeApp).mockResolvedValue({ destroy } as unknown as GlobeAppHandle);
    vi.mocked(trackViewportInsets).mockReturnValue({ refresh() {}, dispose });
    vi.mocked(createRoot).mockReturnValue({ render, unmount });
  });

  it("unmounts the overlay and releases viewport observation before app resources, once", async () => {
    const app = await mountGlobeApp(root);
    expect(root.querySelector(".foss-earth-overlay-root")).not.toBeNull();
    app.destroy(); app.destroy();
    expect(order).toEqual(["overlay", "viewport", "app"]);
    expect(unmount).toHaveBeenCalledTimes(1); expect(dispose).toHaveBeenCalledTimes(1); expect(destroy).toHaveBeenCalledTimes(1);
    expect(root.childElementCount).toBe(0);
  });

  it("releases viewport observation if app startup fails", async () => {
    const failure = new Error("startup failed");
    vi.mocked(createGlobeApp).mockRejectedValue(failure);
    await expect(mountGlobeApp(root)).rejects.toBe(failure);
    expect(dispose).toHaveBeenCalledTimes(1); expect(createRoot).not.toHaveBeenCalled(); expect(destroy).not.toHaveBeenCalled();
  });

  it("still destroys app resources if React unmount reports a cleanup error", async () => {
    const app = await mountGlobeApp(root), failure = new Error("overlay cleanup failed");
    unmount.mockImplementation(() => { order.push("overlay"); throw failure; });
    expect(() => app.destroy()).toThrow(failure);
    expect(order).toEqual(["overlay", "viewport", "app"]);
    app.destroy(); expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("removes the partial overlay and releases app resources if root creation fails", async () => {
    const failure = new Error("root creation failed");
    vi.mocked(createRoot).mockImplementation(() => { throw failure; });
    await expect(mountGlobeApp(root)).rejects.toBe(failure);
    expect(order).toEqual(["viewport", "app"]); expect(root.childElementCount).toBe(0);
  });

  it("retains the startup failure and cleanup failure while releasing the remaining resources", async () => {
    const startup = new Error("root creation failed"), cleanup = new Error("viewport cleanup failed");
    vi.mocked(createRoot).mockImplementation(() => { throw startup; });
    dispose.mockImplementation(() => { order.push("viewport"); throw cleanup; });
    const failure = await mountGlobeApp(root).catch(error => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure.errors).toEqual([startup, cleanup]);
    expect(order).toEqual(["viewport", "app"]);
    expect(root.childElementCount).toBe(0);
  });
});
