import { navigationCurveShare } from "@foss-earth/engine";
import type { SettingsRegistry } from "@foss-earth/ui/settings";

/** Static SVG, redrawn on settings changes only. Shares the motion model's curve function. */
export function createNavigationCurvePreview(document: Document, settings: SettingsRegistry) {
  const element = document.createElement("figure");
  element.className = "navigation-curve-preview";
  element.style.cssText = "margin:0;padding:8px;border:1px solid var(--border-color, #bbb);border-radius:10px;display:grid;gap:6px";
  element.dataset.navigationCurve = "";
  const title = document.createElement("figcaption");
  title.textContent = "Keyboard speed";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 320 150");
  svg.setAttribute("role", "img");
  svg.style.cssText = "display:block;width:100%;max-width:480px;color:inherit";
  const description = document.createElement("p");
  description.className = "settings-line";
  description.style.margin = "0";
  element.append(title, svg, description);
  function draw() {
    const acceleration = settings.get<number>("input.navigation.accelerationTime");
    const slowdown = settings.get<number>("input.navigation.slowdownTime");
    const accelerationShape = settings.get<number>("input.navigation.accelerationShape");
    const slowdownShape = settings.get<number>("input.navigation.slowdownShape");
    const hold = Math.max(1000, acceleration), total = hold + slowdown + 200;
    const x = (ms: number) => 30 + ms / total * 280;
    const y = (speed: number) => 120 - speed * 95;
    const label = `Keyboard speed: accelerate over ${acceleration} milliseconds, hold until ${hold} milliseconds, then slow to zero over ${slowdown} milliseconds. Shapes ${accelerationShape} and ${slowdownShape}.`;
    svg.setAttribute("aria-label", label);
    svg.replaceChildren();
    const path = (d: string, color: string, width = "2") => {
      const node = document.createElementNS(svg.namespaceURI, "path");
      node.setAttribute("d", d); node.setAttribute("fill", "none"); node.setAttribute("stroke", color); node.setAttribute("stroke-width", width); svg.append(node);
    };
    const text = (content: string, px: number, py: number) => {
      const node = document.createElementNS(svg.namespaceURI, "text");
      node.setAttribute("x", String(px)); node.setAttribute("y", String(py)); node.setAttribute("font-size", "10"); node.setAttribute("fill", "currentColor"); node.textContent = content; svg.append(node);
    };
    path("M30 20 V120 H310", "currentColor", "0.7");
    path(`M${x(hold)} 20 V120`, "currentColor", "0.5");
    let rise = `M30 ${y(0)}`;
    for (let i = 0; i <= 80; i++) rise += ` L${x(hold * i / 80)} ${y(navigationCurveShare(acceleration > 0 ? hold * i / 80 / acceleration : 1, accelerationShape, false))}`;
    path(rise, "#2f9d91", "3");
    let fall = `M${x(hold)} ${y(1)}`;
    for (let i = 0; i <= 80; i++) fall += ` L${x(hold + slowdown * i / 80)} ${y(navigationCurveShare(slowdown > 0 ? i / 80 : 1, slowdownShape, true))}`;
    fall += ` L310 120`;
    path(fall, "#c36d91", "3");
    text("100%", 0, 24); text("0", 15, 123); text("Press", 30, 140); text("Release", Math.min(x(hold) - 15, 240), 140); text(`${(total / 1000).toFixed(1)} s`, 282, 140);
    description.textContent = `Hold ${(hold / 1000).toFixed(1)} s → release`;
  }
  draw();
  const off = settings.subscribe(changed => { if ([...changed].some(id => id.startsWith("input.navigation."))) draw(); });
  return { element, destroy: off };
}
