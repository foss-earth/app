// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const boot = vi.hoisted(() => ({
  mount: vi.fn(), ready: vi.fn(), failed: vi.fn(), recoveryPage: vi.fn(() => false),
}));
vi.mock("./app/mountGlobeApp", () => ({ mountGlobeApp: boot.mount }));
vi.mock("@foss-earth/ui/browser", () => ({
  isBrowserRecoveryPage: boot.recoveryPage,
  markBrowserAppReady: boot.ready,
  reportBrowserAppFailure: boot.failed,
}));

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  document.body.innerHTML = '<div id="root"></div>';
  boot.recoveryPage.mockReturnValue(false);
  boot.mount.mockResolvedValue({});
});
afterEach(() => { vi.restoreAllMocks(); });

it("marks a mounted app ready for the early recovery watchdog", async () => {
  await import("./main");
  await vi.waitFor(() => expect(boot.ready).toHaveBeenCalledWith(document));
  expect(boot.failed).not.toHaveBeenCalled();
});

it("keeps the startup error visible and reports a failed boot without exposing keys", async () => {
  boot.mount.mockRejectedValue(new Error("Bad local state: apiKey=private-key"));
  vi.spyOn(console, "error").mockImplementation(() => {});
  await import("./main");
  await vi.waitFor(() => expect(boot.failed).toHaveBeenCalledWith(document, "Error: Bad local state: apiKey=[redacted]"));
  expect(document.querySelector(".boot-error")?.textContent).toContain("Bad local state");
  expect(document.querySelector(".boot-error")?.textContent).not.toContain("private-key");
  expect(boot.ready).not.toHaveBeenCalled();
});

it("leaves the standalone browser data review page free of app initialization", async () => {
  boot.recoveryPage.mockReturnValue(true);
  await import("./main");
  expect(boot.mount).not.toHaveBeenCalled();
  expect(boot.ready).not.toHaveBeenCalled();
  expect(boot.failed).not.toHaveBeenCalled();
});
