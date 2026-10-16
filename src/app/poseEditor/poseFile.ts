/** Turns a placement edit into a scene-file change. No disk and no network. */

export interface PoseWrite {
  entityId: string;
  longitudeDeg: number;
  latitudeDeg: number;
  headingDeg: number;
  pitchDeg: number;
  /** Omitted leaves the file's roll. */
  rollDeg?: number;
  offsetM: number;
  /** Omitted leaves the file's capture height. Null clears it. */
  heightMeters?: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

/** The scene path under the app's public directory, or null when the URL is not one of its files. */
export function scenePublicPath(sceneUrl: string, baseUrl: string): string | null {
  let absolute: URL;
  let base: URL;
  try {
    base = new URL(baseUrl);
    absolute = new URL(sceneUrl, base);
  } catch {
    return null;
  }
  if (absolute.origin !== base.origin) return null;
  const basePath = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
  if (!absolute.pathname.startsWith(basePath)) return null;
  let relative = decodeURIComponent(absolute.pathname.slice(basePath.length));
  if (relative.startsWith("/")) relative = relative.slice(1);
  if (!relative.endsWith(".scene.json")) return null;
  if (relative.split("/").some(part => part === "" || part === "." || part === "..")) return null;
  return relative;
}

/** Applies one sphere's place and orientation. The rest of the document is kept. */
export function writePose(scene: unknown, edit: PoseWrite): { ok: true; scene: Record<string, unknown> } | { ok: false; error: string } {
  if (!isRecord(scene) || !Array.isArray(scene.entities)) return fail("The scene file has no entities.");
  if (!edit.entityId || typeof edit.entityId !== "string") return fail("The photograph has no id.");
  if (![edit.longitudeDeg, edit.latitudeDeg, edit.headingDeg, edit.pitchDeg, edit.offsetM].every(Number.isFinite)) return fail("The place has a value that is not a number.");
  if (edit.latitudeDeg < -90 || edit.latitudeDeg > 90) return fail("Latitude has to stay between −90 and 90.");
  if (edit.longitudeDeg < -180 || edit.longitudeDeg >= 180) return fail("Longitude has to stay from −180 up to, but not including, 180.");
  if (edit.headingDeg < 0 || edit.headingDeg >= 360) return fail("Heading has to stay from 0 up to, but not including, 360.");
  if (edit.pitchDeg < -90 || edit.pitchDeg > 90) return fail("Pitch has to stay between −90 and 90.");
  if (edit.rollDeg !== undefined && (!Number.isFinite(edit.rollDeg) || edit.rollDeg <= -180 || edit.rollDeg > 180)) return fail("Roll has to stay above −180 and up to 180.");
  if (edit.offsetM < -100_000 || edit.offsetM > 1_000_000) return fail("Altitude is outside the range a scene file can store.");
  if (edit.heightMeters !== undefined && edit.heightMeters !== null && !Number.isFinite(edit.heightMeters)) return fail("The capture height is not a number.");
  const copy = structuredClone(scene) as Record<string, unknown>;
  const entities = copy.entities as unknown[];
  const entity = entities.find(item => isRecord(item) && item.id === edit.entityId && item.type === "panorama");
  if (!isRecord(entity)) return fail(`The scene has no panorama named ${edit.entityId}.`);
  if (!isRecord(entity.capture) || !isRecord(entity.imagePose) || !isRecord(entity.marker)) return fail("That panorama is missing its place, orientation, or marker.");
  entity.capture.longitudeDeg = round(edit.longitudeDeg, 8);
  entity.capture.latitudeDeg = round(edit.latitudeDeg, 8);
  if (edit.heightMeters !== undefined) {
    if (edit.heightMeters === null) entity.capture.height = null;
    else if (isRecord(entity.capture.height)) entity.capture.height.meters = round(edit.heightMeters, 3);
    else entity.capture.height = { meters: round(edit.heightMeters, 3), datum: "WGS84-ellipsoid" };
  }
  const heading = round(edit.headingDeg, 4);
  entity.imagePose.headingDeg = heading >= 360 ? 0 : heading;
  entity.imagePose.pitchDeg = round(edit.pitchDeg, 4);
  if (edit.rollDeg !== undefined) entity.imagePose.rollDeg = round(edit.rollDeg, 4);
  entity.marker.offsetM = round(edit.offsetM, 3);
  return { ok: true, scene: copy };
}
