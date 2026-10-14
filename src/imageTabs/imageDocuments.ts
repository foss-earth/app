/**
 * The image documents this session opened and the tabs that show them
 * (docs/proposals/shared-image-viewer-implementation.md §4–5). A tab is one
 * window-tab instance; several may show one document, and one document's
 * pixels are loaded once for all of them.
 */
import type { ImageKind } from "@foss-earth/images";
import type { WindowTabDefinition } from "@foss-earth/ui/windowing";

/** The tab with the File and URL controls, offered under + in either window. */
export const OPEN_IMAGE_TAB = "open-image";
export type ImageInstanceTabId = `image:${string}`;
export type ImageTabId = typeof OPEN_IMAGE_TAB | ImageInstanceTabId;
/** Image tabs of either side join into one body. */
export const IMAGE_JOIN_GROUP = "image";

export function isImageInstanceTab(tabId: string | null | undefined): tabId is ImageInstanceTabId {
  return typeof tabId === "string" && tabId.startsWith("image:");
}

/**
 * Where a document's bytes come from. A URL is read again for every load; a
 * file belongs to this session and is gone after a reload.
 */
export type ImageDocumentSource =
  | { readonly kind: "url"; readonly url: string }
  | { readonly kind: "file"; readonly file: Blob; readonly name: string };

export interface ImageDocument {
  readonly id: string;
  /** Tabs of documents with one key share loaded pixels. */
  readonly assetKey: string;
  readonly revision: string;
  readonly title: string;
  readonly source: ImageDocumentSource;
  readonly width: number;
  readonly height: number;
  readonly mimeType: ImageKind;
  readonly encodedBytes: number;
}

export interface ImageTabInstance {
  readonly tabId: ImageInstanceTabId;
  readonly documentId: string;
}

export interface ImageDocumentsSnapshot {
  readonly revision: number;
  readonly documents: ReadonlyMap<string, ImageDocument>;
  /** In the order they were opened. */
  readonly tabs: readonly ImageTabInstance[];
}

export type ImageDocumentDescription = Omit<ImageDocument, "id">;

export interface ImageDocumentRegistry {
  getSnapshot(): ImageDocumentsSnapshot;
  subscribe(listener: () => void): () => void;
  /** A new tab for the document: the one already open with the same asset and revision, or a new one. */
  open(description: ImageDocumentDescription): ImageTabInstance;
  /** Another tab showing the same document. */
  duplicate(tabId: string): ImageTabInstance | null;
  documentOf(tabId: string | null | undefined): ImageDocument | null;
  /**
   * The image tabs the windows hold now. A tab they held before and hold no
   * longer was closed: it and any document no other tab shows are forgotten.
   * A tab not yet seen in a window is waiting to open and is kept.
   */
  retainOpen(open: ReadonlySet<string>): void;
}

export function createImageDocumentRegistry(): ImageDocumentRegistry {
  let snapshot: ImageDocumentsSnapshot = Object.freeze({ revision: 0, documents: new Map(), tabs: Object.freeze([]) });
  const listeners = new Set<() => void>();
  const seen = new Set<string>();
  let nextTab = 1, nextDocument = 1;
  const publish = (documents: ReadonlyMap<string, ImageDocument>, tabs: readonly ImageTabInstance[]): void => {
    snapshot = Object.freeze({ revision: snapshot.revision + 1, documents, tabs: Object.freeze([...tabs]) });
    for (const listener of [...listeners]) listener();
  };
  const addTab = (documents: ReadonlyMap<string, ImageDocument>, documentId: string): ImageTabInstance => {
    const tab = Object.freeze({ tabId: `image:${nextTab++}` as ImageInstanceTabId, documentId });
    publish(documents, [...snapshot.tabs, tab]);
    return tab;
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    open(description) {
      const existing = [...snapshot.documents.values()].find(document => document.assetKey === description.assetKey && document.revision === description.revision);
      if (existing) return addTab(snapshot.documents, existing.id);
      const document = Object.freeze({ ...description, id: `document:${nextDocument++}` });
      return addTab(new Map(snapshot.documents).set(document.id, document), document.id);
    },
    duplicate(tabId) {
      const tab = snapshot.tabs.find(entry => entry.tabId === tabId);
      return tab ? addTab(snapshot.documents, tab.documentId) : null;
    },
    documentOf(tabId) {
      const tab = snapshot.tabs.find(entry => entry.tabId === tabId);
      return tab ? snapshot.documents.get(tab.documentId) ?? null : null;
    },
    retainOpen(open) {
      for (const tab of snapshot.tabs) if (open.has(tab.tabId)) seen.add(tab.tabId);
      const tabs = snapshot.tabs.filter(tab => open.has(tab.tabId) || !seen.has(tab.tabId));
      if (tabs.length === snapshot.tabs.length) return;
      for (const tab of snapshot.tabs) if (!tabs.includes(tab)) seen.delete(tab.tabId);
      const shown = new Set(tabs.map(tab => tab.documentId));
      publish(new Map([...snapshot.documents].filter(([id]) => shown.has(id))), tabs);
    },
  };
}

/** Open image, then one tab per instance; a second tab of one document is numbered. */
export function imageTabDefinitions(snapshot: ImageDocumentsSnapshot): WindowTabDefinition<ImageTabId>[] {
  const seen = new Map<string, number>();
  return [{ id: OPEN_IMAGE_TAB, label: "Open image" }, ...snapshot.tabs.map(tab => {
    const count = (seen.get(tab.documentId) ?? 0) + 1;
    seen.set(tab.documentId, count);
    const title = snapshot.documents.get(tab.documentId)?.title ?? "Image";
    return { id: tab.tabId, label: count > 1 ? `${title} (${count})` : title, surface: { joinGroup: IMAGE_JOIN_GROUP }, icon: "image" as const };
  })];
}
