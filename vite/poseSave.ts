/** Writes a panorama's place into a scene file. The dev server only: builds and preview never install it. */
import { readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { Connect, Plugin } from "vite";
import { writePose, type PoseWrite } from "../src/app/poseEditor/poseFile.ts";

export const POSE_SAVE_PATH = "/__foss-earth/pose";

/** A scene file that really lives in `publicDir`, or null when the path leaves it. */
export function resolvePublicScene(publicDir: string, relative: string): string | null {
  if (typeof relative !== "string" || !relative.endsWith(".scene.json") || relative.includes("\\")) return null;
  if (relative.split("/").some(part => part === "" || part === "." || part === "..")) return null;
  let root: string;
  try { root = realpathSync(publicDir); } catch { return null; }
  let real: string;
  try {
    real = realpathSync(path.resolve(root, relative));
    if (!statSync(real).isFile()) return null;
  } catch { return null; }
  const fromRoot = path.relative(root, real);
  if (fromRoot.startsWith("..") || path.isAbsolute(fromRoot)) return null;
  return real;
}

export function savePoseFile(file: string, edit: PoseWrite): { ok: true } | { ok: false; error: string } {
  let scene: unknown;
  try { scene = JSON.parse(readFileSync(file, "utf8")) as unknown; }
  catch { return { ok: false, error: "The scene file could not be read." }; }
  const written = writePose(scene, edit);
  if (!written.ok) return written;
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(written.scene, null, 2)}\n`);
    renameSync(temporary, file);
  } catch {
    try { unlinkSync(temporary); } catch { /* The temporary file may not have been created. */ }
    return { ok: false, error: "The scene file could not be written." };
  }
  return { ok: true };
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer | string) => {
      const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      size += bytes.length;
      if (size > 1_000_000) { reject(new Error("The place is too large to save.")); req.destroy(); return; }
      chunks.push(bytes);
    });
    req.on("end", () => {
      try { resolve(Buffer.concat(chunks).toString("utf8")); }
      catch (error) { reject(error); }
    });
    req.on("error", reject);
  });
}

function isPoseWrite(value: unknown): value is PoseWrite & { file: string } {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.file === "string" && typeof record.entityId === "string"
    && [record.longitudeDeg, record.latitudeDeg, record.headingDeg, record.pitchDeg, record.offsetM].every(item => typeof item === "number");
}

/** Answers GET with `{ok:true}` and POST by rewriting one panorama in a public scene file. */
export function poseSaveMiddleware(publicDir: string): Connect.NextHandleFunction {
  return (req, res, next) => {
    const url = (req.originalUrl ?? req.url ?? "").split("?")[0];
    if (url !== POSE_SAVE_PATH) { next(); return; }
    if (req.method === "GET") { send(res, 200, { ok: true }); return; }
    if (req.method !== "POST") { send(res, 405, { ok: false, error: "Use GET to check, or POST to save." }); return; }
    void readBody(req).then(text => {
      let parsed: unknown;
      try { parsed = JSON.parse(text) as unknown; }
      catch { send(res, 400, { ok: false, error: "The place was not valid JSON." }); return; }
      if (!isPoseWrite(parsed)) { send(res, 400, { ok: false, error: "The place is missing a number it needs." }); return; }
      const file = resolvePublicScene(publicDir, parsed.file);
      if (!file) { send(res, 400, { ok: false, error: "That scene is not a file this dev server can write." }); return; }
      const saved = savePoseFile(file, parsed);
      send(res, saved.ok ? 200 : 400, saved.ok ? { ok: true } : saved);
    }).catch((error: unknown) => {
      send(res, 400, { ok: false, error: error instanceof Error ? error.message : "The place could not be saved." });
    });
  };
}

export function poseSave(options: { publicDir?: string } = {}): Plugin {
  const publicDir = options.publicDir ?? path.resolve(import.meta.dirname, "../public");
  return {
    name: "foss-earth-pose-save",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(poseSaveMiddleware(publicDir));
    },
  };
}
