import type { SkyEvaluationKernel } from "@foss-earth/sky";

/** The shared sky core's stack slots: a coordinator and at most seven helpers. */
const MAX_THREADS = 8;

/** Worker.name carries the sky worker's kernel and thread count without making the bundler's URL dynamic. */
export function skyWorkerConfig(name: string): { kernel: SkyEvaluationKernel; threads: number } {
  try {
    const value: unknown = JSON.parse(name);
    if (value && typeof value === "object" && "kind" in value && value.kind === "earth-sky"
      && "kernel" in value && ["typescript", "single", "threaded"].includes(String(value.kernel))) {
      const kernel = value.kernel as SkyEvaluationKernel;
      const asked = "threads" in value ? Number(value.threads) : 1;
      const threads = kernel === "threaded" && Number.isSafeInteger(asked) ? Math.max(1, Math.min(MAX_THREADS, asked)) : 1;
      return { kernel, threads };
    }
  } catch { /* Missing startup policy runs the TypeScript reference. */ }
  return { kernel: "typescript", threads: 1 };
}

export function skyWorkerName(kernel: SkyEvaluationKernel, threads = 1): string {
  return JSON.stringify({ kind: "earth-sky", kernel, ...(kernel === "threaded" ? { threads } : {}) });
}
