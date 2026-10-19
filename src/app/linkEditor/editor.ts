import type { SceneController } from "@foss-earth/scenes/browser";
import { createHelpTooltip, createIconButton } from "@foss-earth/ui/browser";
import { linkGeometry, type LinkOverrides } from "./linkOverrides";
import "./link-editor.css";

export function createLinkEditor(document: Document, controller: SceneController, links: LinkOverrides) {
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node; };
  const element = el("div"); element.className = "foss-earth-link-editor";
  // "From [▾] To [▾] Both ways [switch] [Add] [?]": how linking works, behind ?.
  const help = createHelpTooltip({ label: "Explain image links", content: el("p", "Choose two photographs to connect. Nearby images appear first. Links with different capture positions appear in the direction of the destination.") });
  const sourceLabel = el("label", "From "), source = el("select"); source.setAttribute("aria-label", "Link from image"); sourceLabel.append(source);
  const targetLabel = el("label", "To "), target = el("select"); target.setAttribute("aria-label", "Link to image"); targetLabel.append(target);
  const bothLabel = el("label", "Both ways"), both = el("input"), knob = el("span"), toggle = el("span");
  both.type = "checkbox"; both.checked = true; knob.className = "foss-earth-switch__knob"; knob.setAttribute("aria-hidden", "true"); toggle.className = "foss-earth-choice foss-earth-switch"; toggle.append(both, knob); bothLabel.append(toggle);
  const button = (text: string, run: () => void) => { const b = el("button", text); b.type = "button"; b.className = "foss-earth-choice foss-earth-scene-button"; b.addEventListener("click", run); return b; };
  const add = button("Add", () => { links.add(source.value, target.value, both.checked); }); add.setAttribute("aria-label", "Add link");
  const controls = el("div"); controls.className = "foss-earth-link-editor__controls"; controls.append(sourceLabel, targetLabel, bothLabel, add, help.element);
  const icon = (name: "download" | "copy" | "reset", label: string, run: () => void) => { const b = createIconButton(document, { icon: name, label }); b.addEventListener("click", run); return b; };
  const list = el("div"), note = el("p"), message = el("p"); note.setAttribute("role", "status"); message.setAttribute("role", "status");
  const download = icon("download", "Download links", () => {
    const prepared = links.exportDocument(), view = document.defaultView!;
    const url = view.URL.createObjectURL(new view.Blob([prepared.text], { type: "application/json" }));
    const a = el("a"); a.href = url; a.download = prepared.filename; a.hidden = true; element.append(a); a.click(); a.remove();
    view.setTimeout(() => view.URL.revokeObjectURL(url), 0);
  });
  const copy = icon("copy", "Copy links as JSON", () => {
    const clipboard = document.defaultView?.navigator.clipboard;
    if (!clipboard) { message.textContent = "Clipboard unavailable. Use Download links."; return; }
    void clipboard.writeText(links.exportDocument().text).then(() => { message.textContent = "Links copied."; }, () => { message.textContent = "Clipboard unavailable. Use Download links."; });
  });
  const reset = icon("reset", "Reset this scene's links", () => links.reset());
  const actions = el("div"); actions.className = "foss-earth-link-editor__controls"; actions.append(download, copy, reset);
  element.append(controls, list, note, actions, message);
  let active: string | null = null, rendered = "";
  function render() {
    const status = controller.state().status, entries = status?.entries.filter(e => e.supported) ?? [];
    if (status?.active && status.active !== active) source.value = status.active;
    active = status?.active ?? null;
    const chosen = entries.find(e => e.id === source.value)?.id ?? active ?? entries[0]?.id ?? "";
    const key = JSON.stringify([entries.map(e => [e.id, e.title, e.capture, e.links]), chosen, links.additions(chosen), links.ready(), links.count(), links.note()]);
    if (key === rendered) return; rendered = key;
    source.replaceChildren(...entries.map(e => { const o = el("option", e.title); o.value = e.id; return o; })); source.value = chosen;
    const from = entries.find(e => e.id === chosen), oldTarget = target.value;
    const candidates = entries.filter(e => e.id !== chosen).map(e => ({ entry: e, distance: from?.capture && e.capture ? linkGeometry(from.capture, e.capture).distance : Infinity }));
    candidates.sort((a, b) => a.distance - b.distance || a.entry.title.localeCompare(b.entry.title));
    target.replaceChildren(...candidates.map(({ entry, distance }) => {
      const linked = from?.links.some(l => !l.externalDestination && l.target === entry.id);
      const suffix = Number.isFinite(distance) ? distance < 1000 ? ` · ${Math.round(distance)} m` : ` · ${(distance / 1000).toFixed(1)} km` : "";
      const o = el("option", entry.title + suffix + (linked ? " · linked" : "")); o.value = entry.id; return o;
    }));
    if (candidates.some(c => c.entry.id === oldTarget)) target.value = oldTarget;
    else target.value = candidates.find(c => !from?.links.some(l => !l.externalDestination && l.target === c.entry.id))?.entry.id ?? candidates[0]?.entry.id ?? "";
    list.replaceChildren(el("h3", "Links from this image"));
    const additions = links.additions(chosen);
    if (!from?.links.length) list.append(el("p", "No links from this image yet."));
    for (const link of from?.links ?? []) {
      const row = el("div"); row.className = "foss-earth-link-editor__controls";
      const go = button(link.label, () => { void controller.handle()?.enter(link.target); }); go.disabled = !link.enabled || !!link.externalDestination;
      row.append(go);
      if (additions.some(l => l.target === link.target)) row.append(button("Remove", () => links.remove(chosen, link.target)));
      else { const kept = el("span", "In scene"); kept.className = "foss-earth-link-editor__kept"; row.append(kept); }
      list.append(row);
    }
    note.textContent = `${links.count()} added links. ${links.note()}`;
    source.disabled = target.disabled = both.disabled = !links.ready();
    updateAdd(); download.disabled = copy.disabled = links.count() === 0; reset.disabled = !links.ready() || !entries.some(e => links.additions(e.id).length);
  }
  function updateAdd() {
    const from = controller.state().status?.entries.find(e => e.id === source.value), to = controller.state().status?.entries.find(e => e.id === target.value);
    const forward = from?.links.some(l => !l.externalDestination && l.target === target.value);
    const reverse = to?.links.some(l => !l.externalDestination && l.target === source.value);
    add.disabled = !links.ready() || !from || !to || !!forward && (!both.checked || !!reverse);
  }
  source.addEventListener("change", render); target.addEventListener("change", updateAdd); both.addEventListener("change", updateAdd);
  const off = controller.subscribe(render), offLinks = links.subscribe(render); render();
  let destroyed = false;
  return { element, destroy() { if (destroyed) return; destroyed = true; off(); offLinks(); help.destroy(); element.remove(); } };
}
