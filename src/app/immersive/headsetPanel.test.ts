// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createHeadsetPanel, HEADSET_TAB_OFFERED_KEY, offerHeadsetTab } from "./headsetPanel";
import type { HeadsetBranch, HeadsetSession, HeadsetState } from "./headsetSession";

function fakeHeadset(state: HeadsetState, reason: string | null = null, branch: HeadsetBranch | null = null) {
  const listeners = new Set<() => void>();
  const headset = {
    state, reason, branch, presenting: false,
    subscribe: vi.fn((listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; }),
    enter: vi.fn(async () => {}), exit: vi.fn(async () => {}), viewport: () => null, inspect: () => null, dispose: () => {},
    set(next: HeadsetState, nextReason: string | null = null, nextBranch: HeadsetBranch | null = headset.branch) {
      headset.state = next; headset.reason = nextReason; headset.branch = nextBranch; headset.presenting = next === "presenting";
      for (const listener of [...listeners]) listener();
    },
    listeners,
  };
  return headset satisfies HeadsetSession & object;
}

const labels = (panel: { element: HTMLElement }) => [...panel.element.querySelectorAll("dt")].map(term => term.textContent);

function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

describe("createHeadsetPanel", () => {
  it("offers Enter VR only once a headset is ready, and Exit VR while presenting", () => {
    const headset = fakeHeadset("checking");
    const panel = createHeadsetPanel(document, headset);
    const button = panel.element.querySelector("button")!;
    const status = panel.element.querySelector('[role="status"]')!;
    expect(button.disabled).toBe(true);
    expect(status.textContent).toBe("Looking for a headset…");

    headset.set("unavailable", "Choose WebGL 2 in the Renderer tab, then reload");
    expect(button.disabled).toBe(true);
    expect(status.textContent).toContain("WebGL 2");

    headset.set("ready");
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe("Enter VR");
    button.click();
    expect(headset.enter).toHaveBeenCalledOnce();

    headset.set("starting");
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe("Starting VR…");

    headset.set("presenting");
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe("Exit VR");
    button.click();
    expect(headset.exit).toHaveBeenCalledOnce();
  });

  it("lists the controller controls while that session presents, and stops listening when destroyed", () => {
    const headset = fakeHeadset("presenting", null, "controller");
    const panel = createHeadsetPanel(document, headset);
    // "[Exit VR] Open this page in the headset's browser. [?]"
    expect([...panel.element.children].slice(0, 3).map(child => child.querySelector("button")?.getAttribute("aria-label") ?? child.textContent))
      .toEqual(["Exit VR", "Open this page in the headset's browser.", "Explain VR"]);
    expect(labels(panel)).toEqual(["Trigger", "Grip", "Thumbstick up or down", "Thumbstick left or right", "+ on the toolbar"]);
    panel.destroy();
    expect(headset.listeners.size).toBe(0);
  });

  it("lists a pinch while a controllerless session presents", () => {
    const headset = fakeHeadset("presenting", null, "controllerless");
    const panel = createHeadsetPanel(document, headset);
    expect(labels(panel)).toEqual(["Pinch", "+ on the toolbar"]);
    headset.set("presenting", null, "controller");
    expect(labels(panel)).toEqual(["Trigger", "Grip", "Thumbstick up or down", "Thumbstick left or right", "+ on the toolbar"]);
  });

  it("hides the control list until a session is presenting", () => {
    const headset = fakeHeadset("ready");
    const panel = createHeadsetPanel(document, headset);
    const controls = panel.element.querySelector(".foss-earth-headset__controls") as HTMLElement;
    expect(controls.hidden).toBe(true);
    expect(labels(panel)).toEqual([]);
    headset.set("presenting", null, "controllerless");
    expect(controls.hidden).toBe(false);
    expect(labels(panel)).toEqual(["Pinch", "+ on the toolbar"]);
    headset.set("ready", null, null);
    expect(controls.hidden).toBe(true);
    expect(labels(panel)).toEqual([]);
  });
});

describe("offerHeadsetTab", () => {
  it("opens the tab the first time a headset is ready on this device", () => {
    const storage = memoryStorage();
    const headset = fakeHeadset("checking");
    const open = vi.fn();
    offerHeadsetTab(headset, open, storage);
    expect(open).not.toHaveBeenCalled();
    headset.set("ready");
    headset.set("presenting");
    headset.set("ready");
    expect(open).toHaveBeenCalledOnce();
    expect(storage.getItem(HEADSET_TAB_OFFERED_KEY)).toBe("1");
    expect(headset.listeners.size).toBe(0);

    const again = vi.fn();
    offerHeadsetTab(fakeHeadset("ready"), again, storage);
    expect(again).not.toHaveBeenCalled();
  });

  it("opens nothing where no headset can present, or without storage", () => {
    const open = vi.fn();
    const headset = fakeHeadset("unavailable");
    const stop = offerHeadsetTab(headset, open, memoryStorage());
    stop();
    headset.set("ready");
    offerHeadsetTab(fakeHeadset("ready"), open, null);
    expect(open).not.toHaveBeenCalled();
  });
});
