/** Earth binds presentation owners to its document and existing frame notifications. */
import {
  appendHostSections, checkChoice, createChoiceGroup, createChoiceNote,
  createDial, createExternalLinkIcon, createParameterControl,
  createParameterSection, createSectionsElement, createTrack, wrapTurn,
} from "@foss-earth/ui/browser";
import type { SettingsRegistry, SettingsStorage } from "@foss-earth/ui/settings";
import type { RendererPanelUiPort } from "@foss-earth/renderer/panel";

export function createEarthUiHost(settings: SettingsRegistry, document: Document) {
  const listeners = new Set<() => void>();
  let disposed = false;
  let storage: SettingsStorage | null;
  try { storage = document.defaultView?.localStorage ?? null; } catch { storage = null; }
  const refresh = {
    nowMs: () => performance.now(),
    subscribe(listener: () => void) {
      if (!disposed) listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
  const emit = () => {
    if (!disposed) for (const listener of [...listeners]) listener();
  };
  const stopSettings = settings.subscribe(emit);
  const parameterSection = (options: Omit<Parameters<typeof createParameterSection>[1], "document" | "refresh" | "panelStorage">) =>
    createParameterSection(settings, { ...options, document, refresh, panelStorage: storage });
  const sections = (entries: Parameters<typeof createSectionsElement>[0]) =>
    createSectionsElement(entries, { document, storage });
  const renderer: RendererPanelUiPort = {
    document,
    isInput: (value): value is HTMLInputElement => value instanceof document.defaultView!.HTMLInputElement,
    createChoiceGroup: (name, heading, choices) => createChoiceGroup(name, heading, choices, document),
    createChoiceNote: text => createChoiceNote(text, document),
    checkChoice,
    createParameterSection: (registry, options) => createParameterSection(registry, { ...options, document, refresh, panelStorage: storage }),
    createSectionsElement: sections,
    appendHostSections: (registry, tab, target, own) => appendHostSections(registry, tab, target, own, { document, refresh, panelStorage: storage }),
  };
  return {
    document, storage, refresh, emit, parameterSection, sections, renderer,
    control: (registry: SettingsRegistry, id: string) => createParameterControl(registry, id, document),
    /** Owners whose interfaces already include document/refresh retain their public signatures. */
    publicUi: { appendHostSections, checkChoice, createChoiceGroup, createChoiceNote,
      createParameterSection, createSectionsElement, createDial, wrapTurn },
    createTrack, externalLinkIcon: () => createExternalLinkIcon(document),
    dispose() { if (disposed) return; disposed = true; stopSettings(); listeners.clear(); },
  };
}
