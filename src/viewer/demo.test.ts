import { describe, expect, it } from "vitest";
import { pollRt4ksrJob, rt4ksrJobUrl, rt4ksrOutputUrl, rt4ksrRunnerUrl, rt4ksrSourceUrl } from "./demo";

describe("RT4KSR viewer addresses", () => {
  it("names the original, the half-resolution input, and one run's output", () => {
    expect(rt4ksrSourceUrl("http://127.0.0.1:8756/preview.html", "Original", "720p", "natural")).toBe(
      "http://127.0.0.1:8756/demo/source/Original?profile=720p&case=natural",
    );
    expect(rt4ksrSourceUrl("http://127.0.0.1:8756/preview.html", "Half-resolution", "1080p", "synthetic")).toBe(
      "http://127.0.0.1:8756/demo/source/Half-resolution?profile=1080p&case=synthetic",
    );
    expect(rt4ksrOutputUrl("http://127.0.0.1:8756/preview.html", "job-1")).toBe(
      "http://127.0.0.1:8756/demo/WebGPU%20output?run=job-1",
    );
    expect(rt4ksrRunnerUrl("http://127.0.0.1:8756/preview.html", "job-1", "720p", "natural")).toBe(
      "http://127.0.0.1:8756/preview.html?job=job-1&profile=720p&case=natural",
    );
    expect(rt4ksrJobUrl("http://127.0.0.1:8756/preview.html", "job-1")).toBe("http://127.0.0.1:8756/demo/jobs/job-1");
  });

  it("follows a run from waiting to done", async () => {
    const seen: string[] = [];
    let calls = 0;
    const fetch = (async () => {
      calls += 1;
      if (calls === 1) return new Response(null, { status: 404 });
      if (calls === 2) return Response.json({ state: "running", message: "Running the GPU path…" });
      return Response.json({ state: "done", message: "Done." });
    }) as typeof globalThis.fetch;
    const job = await pollRt4ksrJob(fetch, "http://127.0.0.1:8756/demo/jobs/job-1", new AbortController().signal, async () => {}, message => seen.push(message));
    expect(job).toEqual({ state: "done", message: "Done." });
    expect(seen).toEqual(["Running the GPU path…"]);
  });
});
