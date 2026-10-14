import { describe, expect, it, vi } from "vitest";
import type { WindowSideSnapshot, WindowWorkspaceSnapshot } from "@foss-earth/ui/windowing";
import { createImageDocumentRegistry, imageTabDefinitions, IMAGE_JOIN_GROUP, OPEN_IMAGE_TAB, type ImageDocumentDescription } from "./imageDocuments";
import { imageParticipation, openImageTabs } from "./imageParticipation";

const description = (assetKey: string, revision = "4x3:100", title = assetKey): ImageDocumentDescription => ({
  assetKey, revision, title, source: { kind: "url", url: `https://example.org/${assetKey}.png` },
  width: 4, height: 3, mimeType: "image/png", encodedBytes: 100,
});

describe("image document registry", () => {
  it("opens a new tab each time, sharing one document per asset and revision", () => {
    const registry = createImageDocumentRegistry();
    const listener = vi.fn();
    registry.subscribe(listener);
    const first = registry.open(description("a")), second = registry.open(description("a"));
    const changed = registry.open(description("a", "8x6:200"));
    expect(first.tabId).not.toBe(second.tabId);
    expect(second.documentId).toBe(first.documentId);
    expect(changed.documentId).not.toBe(first.documentId);
    expect(registry.getSnapshot().documents.size).toBe(2);
    expect(registry.documentOf(second.tabId)?.title).toBe("a");
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("duplicates a tab as another view of its document", () => {
    const registry = createImageDocumentRegistry();
    const tab = registry.open(description("a"));
    const copy = registry.duplicate(tab.tabId)!;
    expect(copy.tabId).not.toBe(tab.tabId);
    expect(copy.documentId).toBe(tab.documentId);
    expect(registry.duplicate("image:missing")).toBeNull();
  });

  it("keeps a tab that has not reached a window yet, and forgets one that was closed", () => {
    const registry = createImageDocumentRegistry();
    const a = registry.open(description("a")), b = registry.open(description("b"));
    registry.retainOpen(new Set([a.tabId]));
    expect(registry.getSnapshot().tabs.map(tab => tab.tabId)).toEqual([a.tabId, b.tabId]);
    registry.retainOpen(new Set([a.tabId, b.tabId]));
    registry.retainOpen(new Set([b.tabId]));
    expect(registry.getSnapshot().tabs.map(tab => tab.tabId)).toEqual([b.tabId]);
    expect(registry.documentOf(a.tabId)).toBeNull();
    expect([...registry.getSnapshot().documents.values()].map(document => document.assetKey)).toEqual(["b"]);
  });

  it("keeps a document while another tab still shows it", () => {
    const registry = createImageDocumentRegistry();
    const a = registry.open(description("a")), copy = registry.duplicate(a.tabId)!;
    registry.retainOpen(new Set([a.tabId, copy.tabId]));
    registry.retainOpen(new Set([copy.tabId]));
    expect(registry.documentOf(copy.tabId)?.assetKey).toBe("a");
  });

  it("defines Open image and a joinable tab per instance, numbering a document's later tabs", () => {
    const registry = createImageDocumentRegistry();
    const a = registry.open(description("a")), copy = registry.duplicate(a.tabId)!;
    expect(imageTabDefinitions(registry.getSnapshot())).toEqual([
      { id: OPEN_IMAGE_TAB, label: "Open image" },
      { id: a.tabId, label: "a", surface: { joinGroup: IMAGE_JOIN_GROUP } },
      { id: copy.tabId, label: "a (2)", surface: { joinGroup: IMAGE_JOIN_GROUP } },
    ]);
  });
});

const side = (tabs: string[], extra: Partial<WindowSideSnapshot<string>> = {}): WindowSideSnapshot<string> =>
  ({ tabs, activeTab: tabs.at(-1) ?? null, collapsed: false, contextHidden: [], ...extra });
const workspace = (primary: WindowSideSnapshot<string>, secondary: WindowSideSnapshot<string>, extra: Partial<WindowWorkspaceSnapshot<string>> = {}): WindowWorkspaceSnapshot<string> =>
  ({ revision: 1, primary, secondary, focusedSide: null, compact: false, contextActive: false, ...extra });

describe("image participation", () => {
  const registry = createImageDocumentRegistry();
  const a = registry.open(description("a")), b = registry.open(description("b"));
  const documentOf = (tabId: string) => registry.documentOf(tabId);

  it("takes each expanded side's selected image tab", () => {
    const result = imageParticipation(workspace(side(["location", a.tabId]), side([b.tabId])), documentOf);
    expect(result.left).toMatchObject({ tabId: a.tabId, documentId: a.documentId, size: { width: 4, height: 3 } });
    expect(result.right).toMatchObject({ tabId: b.tabId });
    expect(result.right).not.toBeNull();
  });

  it("leaves out a collapsed side, another selected tab and a tab the context hid", () => {
    expect(imageParticipation(workspace(side([a.tabId], { collapsed: true }), side([b.tabId])), documentOf).left).toBeNull();
    expect(imageParticipation(workspace(side([a.tabId, "location"]), side([])), documentOf).left).toBeNull();
    expect(imageParticipation(workspace(side([a.tabId], { contextHidden: [a.tabId] }), side([])), documentOf).left).toBeNull();
  });

  it("names the last focused side, else the one that shows an image", () => {
    expect(imageParticipation(workspace(side([a.tabId]), side([b.tabId]), { focusedSide: "secondary" }), documentOf).focused).toBe("right");
    expect(imageParticipation(workspace(side([a.tabId]), side(["location"]), { focusedSide: "secondary" }), documentOf).focused).toBe("left");
    expect(imageParticipation(null, documentOf)).toEqual({ left: null, right: null, focused: null });
  });

  it("keeps both images when the snapshot is marked compact", () => {
    const result = imageParticipation(workspace(side([a.tabId]), side([b.tabId]), { compact: true }), documentOf);
    expect(result.left?.tabId).toBe(a.tabId);
    expect(result.right?.tabId).toBe(b.tabId);
    expect(imageParticipation(workspace(side([a.tabId]), side(["location"]), { compact: true }), documentOf).left?.tabId).toBe(a.tabId);
  });

  it("counts every image tab either side holds as open", () => {
    const open = openImageTabs(workspace(side([a.tabId, OPEN_IMAGE_TAB]), side(["location"], { contextHidden: [b.tabId] })));
    expect([...open].sort()).toEqual([a.tabId, b.tabId].sort());
  });
});
