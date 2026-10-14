/**
 * Addresses for the existing image viewer. The original is open from the
 * start. A run adds the half-resolution input on the other side, and the
 * WebGPU output as another tab there. The selected tab on each side is the
 * image that side shows.
 */

export const RT4KSR_RUNNER = "http://127.0.0.1:8756/preview.html";
export type Rt4ksrProfile = "720p" | "1080p" | "small";
export type Rt4ksrCase = "natural" | "synthetic";
export type Rt4ksrJobState = "running" | "done" | "error";
export interface Rt4ksrJob {
  readonly state: Rt4ksrJobState;
  readonly message: string;
}

const JOB_MS = 180_000;

export function rt4ksrRunnerUrl(runnerPage: string, job: string, profile: string, caseName: string): string {
  const url = new URL(runnerPage);
  url.searchParams.set("job", job);
  url.searchParams.set("profile", profile);
  url.searchParams.set("case", caseName);
  return url.href;
}

export function rt4ksrJobUrl(runnerPage: string, job: string): string {
  const page = new URL(runnerPage);
  return new URL(`/demo/jobs/${encodeURIComponent(job)}`, page.origin).href;
}

/** The stored full-size frame, or the half-resolution input it was made from. */
export function rt4ksrSourceUrl(runnerPage: string, name: "Original" | "Half-resolution", profile: string, caseName: string): string {
  const page = new URL(runnerPage);
  const url = new URL(`/demo/source/${encodeURIComponent(name)}`, page.origin);
  url.searchParams.set("profile", profile);
  url.searchParams.set("case", caseName);
  return url.href;
}

/** The GPU frame published for one run. */
export function rt4ksrOutputUrl(runnerPage: string, job: string): string {
  const page = new URL(runnerPage);
  const url = new URL(`/demo/${encodeURIComponent("WebGPU output")}`, page.origin);
  url.searchParams.set("run", job);
  return url.href;
}

export async function pollRt4ksrJob(
  fetch: typeof globalThis.fetch,
  url: string,
  signal: AbortSignal,
  wait: (ms: number) => Promise<void>,
  onRunning: (message: string) => void,
  now: () => number = Date.now,
): Promise<Rt4ksrJob> {
  const deadline = now() + JOB_MS;
  while (!signal.aborted) {
    if (now() > deadline) return { state: "error", message: "The run did not finish. Leave the runner window open until it does." };
    let response: Response;
    try { response = await fetch(url, { cache: "no-store", signal }); }
    catch (error) {
      if (signal.aborted) return { state: "error", message: "Cancelled." };
      throw error;
    }
    if (response.status === 404) { await wait(400); continue; }
    if (!response.ok) return { state: "error", message: `Runner status was HTTP ${response.status}.` };
    const job = await response.json() as Partial<Rt4ksrJob>;
    if ((job.state !== "running" && job.state !== "done" && job.state !== "error") || typeof job.message !== "string") {
      return { state: "error", message: "Runner status was not a run record." };
    }
    if (job.state === "running") { onRunning(job.message); await wait(400); continue; }
    return { state: job.state, message: job.message };
  }
  return { state: "error", message: "Cancelled." };
}
