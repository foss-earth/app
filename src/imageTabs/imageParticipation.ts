/**
 * Which image documents a workspace shows, from its committed snapshot.
 * A side takes part when its selected tab is an image the context has not
 * hidden. Minimizing a window hides that window and leaves the selected
 * image on the view. Narrow-screen folding is presentation, not membership.
 */
import type { RectangleSide, RectangleSlotDocument } from "@foss-earth/sphere-image";
import type { WindowSideSnapshot, WindowWorkspaceSnapshot } from "@foss-earth/ui/windowing";
import { isImageInstanceTab, type ImageDocument } from "./imageDocuments";

export interface ImageParticipation {
  readonly left: RectangleSlotDocument | null;
  readonly right: RectangleSlotDocument | null;
  /** The side whose source native-pixel inspection names: the last focused side, else the survivor. */
  readonly focused: RectangleSide | null;
}

function slotDocument(side: WindowSideSnapshot<string>, documentOf: (tabId: string) => ImageDocument | null): RectangleSlotDocument | null {
  const tabId = side.activeTab;
  if (!isImageInstanceTab(tabId) || side.contextHidden.includes(tabId)) return null;
  const document = documentOf(tabId);
  return document ? { tabId, documentId: document.id, revision: document.revision, title: document.title,
    size: { width: document.width, height: document.height } } : null;
}

export function imageParticipation(snapshot: WindowWorkspaceSnapshot<string> | null, documentOf: (tabId: string) => ImageDocument | null): ImageParticipation {
  if (!snapshot) return { left: null, right: null, focused: null };
  const left = slotDocument(snapshot.primary, documentOf), right = slotDocument(snapshot.secondary, documentOf);
  const preferred: RectangleSide = snapshot.focusedSide === "secondary" ? "right" : "left";
  const focused: RectangleSide | null = (preferred === "left" ? left : right) ? preferred : left ? "left" : right ? "right" : null;
  // Narrow width is a presentation of these same sides. It does not drop a participant.
  return { left, right, focused };
}

/** Every image tab either side holds, selected or not, including tabs a context hid. */
export function openImageTabs(snapshot: WindowWorkspaceSnapshot<string> | null): Set<string> {
  const open = new Set<string>();
  if (!snapshot) return open;
  for (const side of [snapshot.primary, snapshot.secondary]) {
    for (const tabId of [...side.tabs, ...side.contextHidden]) if (isImageInstanceTab(tabId)) open.add(tabId);
  }
  return open;
}
