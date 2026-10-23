// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { validateHostTabs, type GlobeAppHostTab } from "./hostTabs";

describe("host window tab configuration", () => {
  const valid = (): GlobeAppHostTab => ({ id: "host:makerspaces", label: "Makerspaces", element: document.createElement("section") });
  it("keeps host content separate and snapshots metadata without moving the node", () => {
    const root = document.createElement("main"), original = valid(), parent = document.createElement("div");
    parent.append(original.element);
    const tabs = validateHostTabs([original], root);
    original.label = "Changed outside the application";
    expect(tabs[0].label).toBe("Makerspaces");
    expect(tabs[0].element).toBe(original.element);
    expect(original.element.parentElement).toBe(parent);
    expect(Object.isFrozen(tabs)).toBe(true);
  });
  it("cannot replace native or image-instance tab identities", () => {
    for (const id of ["scenes", "add-image", "dev", "image:1", "host:", "host:bad id"]) {
      expect(() => validateHostTabs([{ ...valid(), id } as GlobeAppHostTab], document.createElement("main"))).toThrow(/Host tab IDs/);
    }
  });
  it("rejects duplicates, blank labels and shared or invalid DOM content", () => {
    const root = document.createElement("main"), tab = valid();
    expect(() => validateHostTabs([tab, { ...valid(), id: tab.id }], root)).toThrow(/Duplicate/);
    expect(() => validateHostTabs([{ ...tab, label: "  " }], root)).toThrow(/label/);
    expect(() => validateHostTabs([tab, { ...tab, id: "host:other" }], root)).toThrow(/own element/);
    expect(() => validateHostTabs([{ ...tab, element: document.createTextNode("not HTML") as unknown as HTMLElement }], root)).toThrow(/HTML element/);
    expect(() => validateHostTabs([{ ...tab, element: root }], root)).toThrow(/separate/);
    root.append(tab.element);
    expect(() => validateHostTabs([tab], root)).toThrow(/separate/);
  });
  it("rejects nested host content in either tab order without moving it", () => {
    const root = document.createElement("main"), parent = valid(), child = { ...valid(), id: "host:child" as const };
    parent.element.append(child.element);
    for (const tabs of [[parent, child], [child, parent]]) {
      expect(() => validateHostTabs(tabs, root)).toThrow(/must not contain one another/);
      expect(child.element.parentElement).toBe(parent.element);
    }
  });
});
