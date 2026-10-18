import {
  adviseRenderer, describeRendererStart, dismissAdvice, identifyBrowser, readDismissedAdvice,
  type RendererAdvice, type RendererPreferenceStorage, type RendererSelection, type RendererStartNote,
} from "@foss-earth/renderer";
import type { GameLog, GameLogAction } from "@foss-earth/ui";

export interface RendererAdviceLogPorts {
  storage: RendererPreferenceStorage;
  /** Opens a guide in a new tab. */
  open(url: string): void;
}

/**
 * Prints the renderer's start in the game log: each piece of advice the visitor has not dismissed, with
 * "How to fix" and "Don't show again", or else the line that says why the globe draws with WebGL. Advice
 * about drawing without the GPU is printed beside that line, since it is about the GPU, not WebGPU.
 */
export function printRendererStart(log: Pick<GameLog, "print">, note: RendererStartNote | null, advice: readonly RendererAdvice[], ports: RendererAdviceLogPorts): void {
  if (note && !advice.some(item => item.id !== "software-gl")) log.print(note);
  const dismissed = readDismissedAdvice(ports.storage);
  for (const item of advice) {
    if (dismissed.has(item.id)) continue;
    const hide: GameLogAction = { label: "Don't show again", onClick: () => { dismissAdvice(ports.storage, item.id); line.remove(); } };
    const guide: GameLogAction[] = item.docs ? [{ label: "Open the guide", onClick: () => ports.open(item.docs!) }] : [];
    const line = log.print({
      text: item.text, tone: item.tone,
      actions: [{ label: "How to fix", onClick: () => line.update({ text: `${item.text} ${item.fix.join(" ")}`, tone: item.tone, actions: [...guide, hide] }) }, hide],
    });
  }
}

type UserAgentData = Parameters<typeof identifyBrowser>[1];

/**
 * What a host does once its renderer has started (docs/proposals/startup-loading.md, section 3): prints
 * why the globe draws with WebGL, and how to get WebGPU where it can be had, in the log. Returns the
 * advice, for the Renderer tab (`createRendererPanel`'s `advice`).
 */
export function reportRendererStart(
  log: Pick<GameLog, "print">,
  renderer: Pick<RendererSelection, "requested" | "mode" | "fallbackReason" | "diagnostics">,
  /** Babylon's engine: its renderer string tells a software renderer. */
  engine: { getInfo?(): { renderer: string } },
  browserWindow: Window,
  storage: RendererPreferenceStorage,
): RendererAdvice[] {
  const advice = adviseRenderer({
    renderer,
    browser: identifyBrowser(browserWindow.navigator.userAgent, (browserWindow.navigator as Navigator & { userAgentData?: UserAgentData }).userAgentData),
    gpu: engine.getInfo?.().renderer,
    hostname: browserWindow.location.hostname,
  });
  printRendererStart(log, describeRendererStart(renderer), advice, { storage, open: url => { browserWindow.open(url, "_blank", "noopener"); } });
  return advice;
}
