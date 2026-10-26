// Which FOSS Earth build a capture shows, and what it was built from.
//
// By default the newest existing build is reused: this script's own build
// (build/capture-scenes/app-dist) or the app's dist/. Without either, or with
// --rebuild, the app is built from the working tree into this script's own
// directory, so the shared dist/ another task may be using is never replaced.
// Either way the report compares the build's recorded commits with the
// checkouts now, so an old build is not described as current source.
import { spawn, execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { access, readFile, realpath } from "node:fs/promises";
import path from "node:path";

const BUILT_FROM = /<script type="application\/json" id="foss-earth-built-from">([^<]*)<\/script>/;

export async function readBuiltFrom(distDirectory) {
  let html;
  try { html = await readFile(path.join(distDirectory, "index.html"), "utf8"); } catch { return null; }
  const match = BUILT_FROM.exec(html);
  if (!match) return { built: null, app: null, unrecorded: true };
  try { return JSON.parse(match[1]); } catch { return { built: null, app: null, unrecorded: true }; }
}

function git(directory, args) {
  try { return execFileSync("git", ["-C", directory, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return null; }
}

/** Where a recorded part's source is checked out now: the app itself, or the linked package. */
async function checkoutOf(appRoot, part) {
  if (part.from === "app") return appRoot;
  if (part.from !== "checkout") return null;
  try { return await realpath(path.join(appRoot, "node_modules", part.name)); } catch { return null; }
}

/** Each recorded checkout against its directory now. */
export async function describeProvenance(appRoot, distDirectory, builtFrom) {
  if (!builtFrom?.app) return { dist: distDirectory, recorded: false, summary: ["The build does not record what it was built from."], stale: true, parts: [] };
  const recorded = [builtFrom.app, ...(builtFrom.app.parts ?? [])].filter(part => part.from === "app" || part.from === "checkout");
  const parts = [];
  for (const part of recorded) {
    const directory = await checkoutOf(appRoot, part);
    const head = directory ? git(directory, ["rev-parse", "HEAD"]) : null;
    const status = directory ? git(directory, ["status", "--porcelain"]) : null;
    const behind = directory && part.commit && head && head !== part.commit ? git(directory, ["rev-list", "--count", `${part.commit}..${head}`]) : null;
    parts.push({
      name: part.name, directory, builtCommit: part.commit ?? null, builtDirty: Boolean(part.dirty), builtUnpushed: Boolean(part.unpushed),
      headCommit: head, commitsSinceBuild: head === part.commit ? 0 : behind === null ? null : Number(behind),
      uncommittedFilesNow: status === null ? null : status.split("\n").filter(Boolean).length,
    });
  }
  const summary = [];
  for (const part of parts) {
    const notes = [];
    if (part.builtDirty) notes.push("built with uncommitted changes");
    if (part.headCommit && part.headCommit !== part.builtCommit) notes.push(`checkout now at ${part.headCommit.slice(0, 12)}${part.commitsSinceBuild === null ? "" : `, ${part.commitsSinceBuild} commit(s) later`}`);
    if (part.uncommittedFilesNow) notes.push(`${part.uncommittedFilesNow} uncommitted file(s) in the checkout now`);
    if (notes.length) summary.push(`${part.name} built from ${part.builtCommit?.slice(0, 12) ?? "no commit"}: ${notes.join("; ")}`);
  }
  const stale = parts.some(part => part.builtDirty || (part.headCommit && part.headCommit !== part.builtCommit) || part.uncommittedFilesNow);
  // behind: a checkout has commits the build lacks. uncommitted: the build or a checkout has work no commit records,
  // so the picture cannot be reproduced from commits alone (and uncommitted files may have changed since the build).
  const behind = parts.some(part => part.headCommit && part.headCommit !== part.builtCommit);
  const uncommitted = parts.some(part => part.builtDirty || part.uncommittedFilesNow);
  const verdict = behind ? "older than the checkouts now" : uncommitted ? "the working tree at its commits, including uncommitted changes" : "the committed source now";
  return {
    dist: distDirectory, recorded: true, built: builtFrom.built, appVersion: builtFrom.app.version ?? null,
    appCommit: builtFrom.app.commit ?? null, stale, behind, uncommitted, verdict,
    summary: summary.length ? summary : ["Every recorded checkout is at the commit it was built from, with no uncommitted changes."],
    parts,
  };
}

/** Builds the app from the working tree into `outDir`, logging to `logFile`. Bounded; killed with the capture. */
export function buildApp(appRoot, outDir, logFile, { timeoutMs = 15 * 60_000, onChild } = {}) {
  return new Promise((resolve, reject) => {
    const log = createWriteStream(logFile);
    // npm applies the app's .npmrc node options, which load the linked libraries from source.
    const child = spawn("npm", ["exec", "--no", "--", "vite", "build", "--configLoader", "native", "--outDir", outDir, "--emptyOutDir"], {
      cwd: appRoot, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, FORCE_COLOR: "0" }, detached: false,
    });
    onChild?.(child);
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error(`Build exceeded ${Math.round(timeoutMs / 60000)} min; see ${logFile}`)); }, timeoutMs);
    child.on("error", error => { clearTimeout(timer); log.end(); reject(error); });
    child.on("exit", code => {
      clearTimeout(timer);
      log.end();
      onChild?.(null);
      if (code === 0) resolve();
      else reject(new Error(`Build failed (exit ${code}); see ${logFile}`));
    });
  });
}

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

/**
 * The build to serve: an explicit directory, the newest existing one, or a
 * new one. Returns the directory, how it was chosen, and its provenance.
 */
export async function resolveBuild({ appRoot, ownDist, explicitDist, rebuild, buildLog, onChild, log }) {
  let chosen = null, how;
  if (explicitDist) {
    if (!(await exists(path.join(explicitDist, "index.html")))) throw new Error(`No index.html in ${explicitDist}`);
    chosen = explicitDist; how = "given with --app-dist";
  } else if (!rebuild) {
    const candidates = [];
    for (const directory of [ownDist, path.join(appRoot, "dist")]) {
      const record = await readBuiltFrom(directory);
      if (record && (await exists(path.join(directory, "assets")))) candidates.push({ directory, built: Date.parse(record.built ?? "") || 0 });
    }
    candidates.sort((a, b) => b.built - a.built);
    if (candidates.length) { chosen = candidates[0].directory; how = "reused: the newest existing build"; }
  }
  if (!chosen) {
    how = rebuild ? "built now (--rebuild) from the working tree" : "built now: no usable build existed";
    log(`Building FOSS Earth into ${path.relative(appRoot, ownDist)} (log: ${path.relative(appRoot, buildLog)})...`);
    const started = Date.now();
    await buildApp(appRoot, ownDist, buildLog, { onChild });
    log(`Built in ${Math.round((Date.now() - started) / 1000)} s.`);
    chosen = ownDist;
  }
  const provenance = await describeProvenance(appRoot, chosen, await readBuiltFrom(chosen));
  return { directory: chosen, how, provenance };
}
