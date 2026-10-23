/** Application-owned content joins the existing window tabs. Shared UI owns docking and lifetime. */
export type HostTabId = `host:${string}`;
export interface GlobeAppHostTab {
  id: HostTabId;
  label: string;
  element: HTMLElement;
}

/** Snapshot configuration before startup; never adopt or mutate a host's element here. */
export function validateHostTabs(tabs: readonly GlobeAppHostTab[] | undefined, root: HTMLElement): readonly GlobeAppHostTab[] {
  const ids = new Set<string>(), elements = new Set<HTMLElement>();
  const ElementClass = root.ownerDocument.defaultView?.HTMLElement;
  return Object.freeze((tabs ?? []).map(tab => {
    if (!tab || typeof tab.id !== "string" || !/^host:[A-Za-z0-9][A-Za-z0-9._-]*$/.test(tab.id)) throw new Error("Host tab IDs must use host: followed by a nonempty letters/digits/dots/hyphens/underscores name.");
    if (ids.has(tab.id)) throw new Error(`Duplicate host tab ID: ${tab.id}`);
    if (typeof tab.label !== "string" || !tab.label.trim()) throw new Error("Host tabs need a nonempty label.");
    if (!ElementClass || !(tab.element instanceof ElementClass) || tab.element.ownerDocument !== root.ownerDocument) throw new Error("A host tab needs an HTML element from this application's document.");
    if (tab.element === root || tab.element.contains(root) || root.contains(tab.element)) throw new Error("A host tab element must be separate from the application's root.");
    if (elements.has(tab.element)) throw new Error("Each host tab needs its own element.");
    for (const element of elements) {
      if (element.contains(tab.element) || tab.element.contains(element)) throw new Error("Host tab elements must not contain one another; each tab needs independent content.");
    }
    ids.add(tab.id); elements.add(tab.element);
    return Object.freeze({ id: tab.id, label: tab.label.trim(), element: tab.element });
  }));
}
