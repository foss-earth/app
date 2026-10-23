/** The VR tab: enter and leave a headset session, and what the controllers do there. */
import { createHelpTooltip } from "@foss-earth/ui/browser";
import type { HeadsetSession } from "./headsetSession";

export interface HeadsetPanel {
  readonly element: HTMLElement;
  destroy(): void;
}

export interface HeadsetPanelOptions {
  /** What VR shows, behind ?. */
  about?: string;
  /** Each control and what it does, in the order shown. */
  controls?: readonly (readonly [string, string])[];
}

/** The globe's: its windows and toolbar, its photographs and their links. */
export const HEADSET_CONTROLS: readonly (readonly [string, string])[] = [
  ["Trigger or pinch", "Press what you point at on a window or the toolbar. Elsewhere, go through the link you point at, or open the photograph you point at on the map."],
  ["Grip", "Hold a window to move it; let it go near its place to put it back. Elsewhere, leave the photograph for the map."],
  ["Thumbstick up or down", "Scroll the window you point at, or push a held window away and bring it near."],
  ["Thumbstick left or right", "Turn 30°."],
  ["+ on the toolbar", "Open a window, or a tab once both sides hold one."],
];

export function createHeadsetPanel(document: Document, headset: HeadsetSession, options: HeadsetPanelOptions = {}): HeadsetPanel {
  const element = document.createElement("div");
  element.className = "foss-earth-status-section foss-earth-choices foss-earth-headset";
  // "[Enter VR] Open this page in the headset's browser. [?]": what VR shows is behind ?.
  const where = document.createElement("p");
  where.className = "foss-earth-choices__note foss-earth-headset__where";
  where.textContent = "Open this page in the headset's browser.";
  const about = document.createElement("p");
  about.textContent = options.about ?? "See the globe and its photographs around you in a VR headset.";
  const help = createHelpTooltip({ label: "Explain VR", content: about });
  const button = document.createElement("button");
  button.type = "button";
  button.className = "foss-earth-parameter__action";
  const status = document.createElement("p");
  status.className = "foss-earth-choices__note";
  status.setAttribute("role", "status");
  const controls = document.createElement("dl");
  controls.className = "foss-earth-headset__controls";
  for (const [input, action] of options.controls ?? HEADSET_CONTROLS) {
    const term = document.createElement("dt");
    term.textContent = input;
    const detail = document.createElement("dd");
    detail.textContent = action;
    controls.append(term, detail);
  }
  element.append(button, where, help.element, status, controls);

  const show = (): void => {
    const presenting = headset.state === "presenting";
    button.textContent = presenting ? "Exit VR" : headset.state === "starting" ? "Starting VR…" : "Enter VR";
    button.disabled = !presenting && headset.state !== "ready";
    status.textContent = headset.state === "checking" ? "Looking for a headset…"
      : headset.state === "presenting" ? "Showing in the headset."
        : headset.reason ?? "";
    status.hidden = status.textContent === "";
  };
  const onClick = (): void => { void (headset.state === "presenting" ? headset.exit() : headset.enter()); };
  button.addEventListener("click", onClick);
  const off = headset.subscribe(show);
  show();
  return {
    element,
    destroy() { off(); button.removeEventListener("click", onClick); help.destroy(); },
  };
}

export const HEADSET_TAB_OFFERED_KEY = "foss-earth.vr-tab-offered";

/**
 * Opens the VR tab once on a device where a headset session can start, so a
 * headset's browser shows the way in; later visits leave the tabs as they were.
 */
export function offerHeadsetTab(headset: Pick<HeadsetSession, "state" | "subscribe">, open: () => void,
  storage: Pick<Storage, "getItem" | "setItem"> | null): () => void {
  let done = false;
  let off: (() => void) | null = null;
  const offer = (): void => {
    if (done || headset.state !== "ready") return;
    done = true;
    off?.();
    try {
      if (!storage || storage.getItem(HEADSET_TAB_OFFERED_KEY)) return;
      storage.setItem(HEADSET_TAB_OFFERED_KEY, "1");
    } catch { return; }
    open();
  };
  off = headset.subscribe(offer);
  offer();
  if (done) off();
  return () => { done = true; off?.(); };
}
