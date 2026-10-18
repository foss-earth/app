import type { RendererAdvice } from "@foss-earth/renderer";
import type { GameLogEntry } from "@foss-earth/ui";
import { describe, expect, it, vi } from "vitest";
import { printRendererStart, reportRendererStart } from "./rendererAdviceLog";

function fakeLog() {
  const lines: { entry: GameLogEntry; removed: boolean }[] = [];
  return {
    lines,
    print(entry: GameLogEntry) {
      const line = { entry, removed: false };
      lines.push(line);
      return { update: (next: GameLogEntry) => { line.entry = next; }, focusAction: () => undefined, remove: () => { line.removed = true; } };
    },
  };
}
const memory = () => {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
};
const action = (entry: GameLogEntry, label: string) => entry.actions!.find(item => item.label === label)!;

const insecure: RendererAdvice = { id: "insecure-origin", tone: "warning", text: "WebGPU needs HTTPS.", fix: ["Forward the port.", "Or mark the origin secure."], docs: "https://example.org/guide" };
const software: RendererAdvice = { id: "software-gl", tone: "warning", text: "The browser draws without the GPU.", fix: ["Turn acceleration on."] };
const note = { text: "The globe draws with WebGL2, because WebGPU needs a secure page.", tone: "warning" as const };

describe("the renderer's start in the log", () => {
  it("prints advice in place of the line it explains, with its fix and guide on request", () => {
    const log = fakeLog();
    const open = vi.fn();
    printRendererStart(log, note, [insecure], { storage: memory(), open });
    expect(log.lines.map(line => line.entry.text)).toEqual(["WebGPU needs HTTPS."]);
    const [line] = log.lines;
    expect(line!.entry.actions!.map(item => item.label)).toEqual(["How to fix", "Don't show again"]);
    action(line!.entry, "How to fix").onClick();
    expect(line!.entry.text).toBe("WebGPU needs HTTPS. Forward the port. Or mark the origin secure.");
    expect(line!.entry.actions!.map(item => item.label)).toEqual(["Open the guide", "Don't show again"]);
    action(line!.entry, "Open the guide").onClick();
    expect(open).toHaveBeenCalledWith("https://example.org/guide");
  });

  it("keeps the start line beside advice about the GPU, and prints the line alone without advice", () => {
    const log = fakeLog();
    printRendererStart(log, note, [software], { storage: memory(), open: vi.fn() });
    expect(log.lines.map(line => line.entry.text)).toEqual([note.text, software.text]);
    const bare = fakeLog();
    printRendererStart(bare, note, [], { storage: memory(), open: vi.fn() });
    expect(bare.lines.map(line => line.entry)).toEqual([note]);
    const quiet = fakeLog();
    printRendererStart(quiet, null, [], { storage: memory(), open: vi.fn() });
    expect(quiet.lines).toEqual([]);
  });

  it("does not show dismissed advice again, on this start or the next", () => {
    const storage = memory();
    const log = fakeLog();
    printRendererStart(log, note, [insecure, software], { storage, open: vi.fn() });
    action(log.lines[0]!.entry, "Don't show again").onClick();
    expect(log.lines[0]!.removed).toBe(true);
    const next = fakeLog();
    printRendererStart(next, note, [insecure, software], { storage, open: vi.fn() });
    expect(next.lines.map(line => line.entry.text)).toEqual([software.text]);
  });

  it("reads the browser, the GPU and the address for a host, and returns the advice for its Renderer tab", () => {
    const log = fakeLog();
    const browserWindow = {
      navigator: { userAgent: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36" },
      location: { hostname: "192.168.0.103" },
      open: vi.fn(),
    } as unknown as Window;
    const advice = reportRendererStart(log, { mode: "webgl2", requested: "auto", diagnostics: { navigatorGpuPresent: false, isSupportedAsyncResult: false, isSecureContext: false } },
      { getInfo: () => ({ renderer: "ANGLE (Qualcomm, Adreno (TM) 740, OpenGL ES 3.2)" }) }, browserWindow, memory());
    expect(advice.map(item => item.id)).toEqual(["insecure-origin"]);
    expect(log.lines.map(line => line.entry.text)).toEqual([advice[0]!.text]);
    action(log.lines[0]!.entry, "How to fix").onClick();
    action(log.lines[0]!.entry, "Open the guide").onClick();
    expect(browserWindow.open).toHaveBeenCalledWith(advice[0]!.docs, "_blank", "noopener");
  });
});
