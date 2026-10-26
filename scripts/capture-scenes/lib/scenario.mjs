// Scenario files: JSON describing one picture. A scenario may `extends` another
// (a path relative to itself); objects merge, everything else replaces.
// `--set a.b=value` overrides any field after merging; the value is read as
// JSON when it parses, otherwise as text. `settings.<parameter id>=value`
// keeps the dots of the parameter id.
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);

function merge(base, over) {
  if (!isObject(base) || !isObject(over)) return over;
  const out = { ...base };
  for (const [key, value] of Object.entries(over)) out[key] = key in base ? merge(base[key], value) : value;
  return out;
}

async function loadFile(file, seen = []) {
  const real = path.resolve(file);
  if (seen.includes(real)) throw new Error(`Scenario extends itself: ${[...seen, real].join(" -> ")}`);
  const json = JSON.parse(await readFile(real, "utf8"));
  const { extends: parent, ...own } = json;
  if (!parent) return own;
  const base = await loadFile(path.resolve(path.dirname(real), parent), [...seen, real]);
  // A name, description and publish destination belong to the file that says them.
  delete base.name; delete base.description; delete base.publish;
  return merge(base, own);
}

/** A scenario argument: a path, or the name of a file in the scenarios directory. */
export function scenarioPath(argument, scenariosDirectory) {
  if (/[/\\]/.test(argument) || argument.endsWith(".json")) return path.resolve(argument);
  return path.join(scenariosDirectory, `${argument}.json`);
}

function parseValue(text) {
  try { return JSON.parse(text); } catch { return text; }
}

export function applyOverride(scenario, assignment) {
  const at = assignment.indexOf("=");
  if (at < 1) throw new Error(`--set needs path=value, got "${assignment}"`);
  const key = assignment.slice(0, at), value = parseValue(assignment.slice(at + 1));
  const parts = key.startsWith("settings.") ? ["settings", key.slice("settings.".length)] : key.split(".");
  let node = scenario;
  for (const part of parts.slice(0, -1)) {
    if (!isObject(node[part])) node[part] = {};
    node = node[part];
  }
  node[parts.at(-1)] = value;
}

/** Expands `~` and resolves a destination against the scenario's directory. */
export function resolveDestination(value, scenarioFile) {
  if (typeof value !== "string" || !value) return null;
  const expanded = value.startsWith("~/") ? path.join(homedir(), value.slice(2)) : value;
  return path.resolve(path.dirname(scenarioFile), expanded);
}

const finite = (value, name, min = -Infinity, max = Infinity) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error(`Scenario ${name} must be a number from ${min} to ${max}`);
  return value;
};

/** Checks a merged scenario and fills the defaults the capture relies on. */
export function validateScenario(raw) {
  const s = structuredClone(raw);
  if (typeof s.name !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(s.name)) throw new Error("Scenario name must be lower-case letters, digits and hyphens");
  const utcMs = Date.parse(s.time?.utc ?? "");
  if (!Number.isFinite(utcMs) || !/Z$|[+-]\d\d:\d\d$/.test(s.time.utc)) throw new Error("Scenario time.utc must be an ISO instant with a zone, e.g. 2026-10-25T22:16:00Z");
  s.time.utcMs = utcMs;
  const observer = s.observer ?? {};
  finite(observer.altitudeKm, "observer.altitudeKm", 0.01, 100000);
  if (observer.fromReference) {
    if (!s.reference) throw new Error("observer.fromReference needs a reference place");
    const from = observer.fromReference;
    if ((from.distanceKm == null) === (from.sunAboveLimbDeg == null)) throw new Error("observer.fromReference needs one of distanceKm or sunAboveLimbDeg");
    if (from.distanceKm != null) finite(from.distanceKm, "observer.fromReference.distanceKm", 0, 20000);
    else finite(from.sunAboveLimbDeg, "observer.fromReference.sunAboveLimbDeg", -10, 80);
    const bearing = observer.fromReference.bearingDeg;
    if (bearing !== "away-from-sun" && bearing !== "towards-sun") finite(bearing, "observer.fromReference.bearingDeg", -360, 360);
  } else {
    finite(observer.latDeg, "observer.latDeg", -90, 90);
    finite(observer.lonDeg, "observer.lonDeg", -180, 180);
  }
  if (s.reference) { finite(s.reference.latDeg, "reference.latDeg", -90, 90); finite(s.reference.lonDeg, "reference.lonDeg", -180, 180); }
  const camera = s.camera ?? {};
  if (camera.headingDeg !== "sun") finite(camera.headingDeg, "camera.headingDeg", -360, 360);
  camera.headingOffsetDeg = finite(camera.headingOffsetDeg ?? 0, "camera.headingOffsetDeg", -180, 180);
  finite(camera.verticalFovDeg, "camera.verticalFovDeg", 10, 120);
  if (camera.limbAtY !== undefined) finite(camera.limbAtY, "camera.limbAtY", 0, 1);
  else finite(camera.elevationDeg, "camera.elevationDeg", -89, -1);
  s.camera = camera;
  const image = s.image ?? {};
  for (const key of ["width", "height"]) if (!Number.isSafeInteger(image[key]) || image[key] < 64 || image[key] > 4096) throw new Error(`Scenario image.${key} must be an integer from 64 to 4096`);
  s.scenery = { basemap: "google", requireMode: "google-tiles", renderer: "auto", ...s.scenery };
  // null unsets a setting a parent scenario gave, leaving the app's default.
  s.settings = Object.fromEntries(Object.entries(s.settings ?? {}).filter(([, value]) => value !== null));
  for (const [id, value] of Object.entries(s.settings)) {
    if (!/^[a-zA-Z][\w.]*$/.test(id) || id.startsWith("map.source.googleKey")) throw new Error(`Setting "${id}" cannot be passed by a scenario`);
    if (!["string", "number", "boolean"].includes(typeof value)) throw new Error(`Setting "${id}" must be text, a number or true/false`);
  }
  // Whether the map's attribution chip stays in the picture. Without it, the
  // page showing the picture must credit the map itself (the report says how).
  s.attribution ??= true;
  if (typeof s.attribution !== "boolean") throw new Error("Scenario attribution must be true (keep the map's credit in the picture) or false (no interface at all)");
  // Scene meshes that are interface rather than world: the horizon compass's letters and needle.
  s.hideSceneMeshes ??= ["orbit-compass"];
  if (!Array.isArray(s.hideSceneMeshes) || s.hideSceneMeshes.some(prefix => typeof prefix !== "string" || !prefix)) throw new Error("Scenario hideSceneMeshes must be a list of mesh name prefixes");
  s.encode = { webpQuality: 82, jpegQuality: 84, ...s.encode };
  s.readiness = { timeoutSec: 240, pollMs: 250, stablePolls: 8, attempts: 3, allowNightLightFailures: false, ...s.readiness };
  finite(s.readiness.timeoutSec, "readiness.timeoutSec", 10, 1800);
  return s;
}

export async function loadScenario(file, overrides = []) {
  const scenario = await loadFile(file);
  for (const assignment of overrides) applyOverride(scenario, assignment);
  return validateScenario(scenario);
}
