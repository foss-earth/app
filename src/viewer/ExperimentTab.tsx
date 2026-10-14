import { useRef, useState } from "react";
import { pollRt4ksrJob, rt4ksrJobUrl, rt4ksrRunnerUrl, RT4KSR_RUNNER, type Rt4ksrCase, type Rt4ksrProfile } from "./demo";

const PROFILES = ["720p", "1080p", "small"] as const;
const CASES = ["natural", "synthetic"] as const;

export function ExperimentTab({ profile, caseName, sourceError, onProfile, onCase, onFinished }: {
  profile: Rt4ksrProfile;
  caseName: Rt4ksrCase;
  sourceError: string | null;
  onProfile(profile: Rt4ksrProfile): void;
  onCase(caseName: Rt4ksrCase): void;
  /** The GPU frame is published. The viewer opens it beside the original from this run. */
  onFinished(job: string, profile: Rt4ksrProfile, caseName: Rt4ksrCase): Promise<void>;
}) {
  const [status, setStatus] = useState("Run RT4KSR fp32. The original stays on this side. The half-resolution input opens on the other, with the WebGPU output as another tab there.");
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);

  async function run(): Promise<void> {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setLink(null);
    const job = crypto.randomUUID();
    const runProfile = profile;
    const runCase = caseName;
    const runnerHref = rt4ksrRunnerUrl(RT4KSR_RUNNER, job, runProfile, runCase);
    setStatus("Opening the GPU runner…");
    window.open(runnerHref, "rt4ksr-run");
    setLink(runnerHref);
    try {
      const result = await pollRt4ksrJob(window.fetch.bind(window), rt4ksrJobUrl(RT4KSR_RUNNER, job), controller.signal,
        ms => new Promise(resolve => { window.setTimeout(resolve, ms); }), setStatus);
      if (controller.signal.aborted) return;
      if (result.state !== "done") { setStatus(result.message); return; }
      await onFinished(job, runProfile, runCase);
      if (controller.signal.aborted) return;
      setStatus(`${result.message}\n\nThe half-resolution input is on the other side. Select WebGPU output there to compare that instead. The selected tab on each side is the image that side shows.`);
    } catch (error) {
      if (!controller.signal.aborted) setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      if (abort.current === controller) setBusy(false);
    }
  }

  return <div className="viewer-experiment">
    <p>RT4KSR x2 at fp32. This machine's WebGPU output matches the stored reference. The full-frame check did not beat bicubic.</p>
    <div className="viewer-experiment__row">
      <label>Profile <select value={profile} disabled={busy} onChange={event => onProfile(event.target.value as Rt4ksrProfile)}>
        {PROFILES.map(item => <option key={item}>{item}</option>)}
      </select></label>
      <label>Case <select value={caseName} disabled={busy} onChange={event => onCase(event.target.value as Rt4ksrCase)}>
        {CASES.map(item => <option key={item}>{item}</option>)}
      </select></label>
      <button type="button" disabled={busy} onClick={() => void run()}>{busy ? "Running…" : "Run on GPU"}</button>
    </div>
    <p role="status">{sourceError ?? status}</p>
    {link ? <p><a href={link} target="rt4ksr-run">Open the runner</a> if its window did not appear.</p> : null}
  </div>;
}
