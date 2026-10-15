/**
 * Photograph pose overrides, version 1. Memory is the source of drafts, counts
 * and exports. Storage is a backing copy: obtaining it or writing it can fail
 * without losing the session. This module has no globals, DOM or network.
 */

export const POSE_STORAGE_KEY = "foss-earth.pose-overrides.v1";
export const POSE_FORMAT = "foss-earth-pose-overrides";
export const POSE_VERSION = 1;
export const DEFAULT_POSE_EXPORT_PREFIX = "foss-earth-poses";
/** Quiet period before a drag's snapshot is written. */
export const POSE_COALESCE_MS = 300;
/** A continuous drag still writes at least this often. */
export const POSE_MAX_WAIT_MS = 1000;

const LON_LAT_DIGITS = 8;
const ANGLE_DIGITS = 4;
const METER_DIGITS = 3;
const LON_LAT_EPSILON = 1e-8;
const ANGLE_EPSILON = 1e-4;
const METER_EPSILON = 1e-3;
const OFFSET_MIN = -100_000;
const OFFSET_MAX = 1_000_000;

export type PoseMode = "ground-relative" | "capture-relative";
export type PosePersist = "schedule" | "now" | "memory";

export interface PoseCapture {
  longitudeDeg: number;
  latitudeDeg: number;
  heightMeters: number | null;
}

export interface PoseImage {
  headingDeg: number;
  pitchDeg: number;
  aligned: boolean;
}

export interface PoseAuthored {
  mode: PoseMode;
  longitudeDeg: number;
  latitudeDeg: number;
  heightMeters: number | null;
  headingDeg: number;
  pitchDeg: number;
  rollDeg: number;
  offsetM: number;
  aligned: boolean | null;
}

export interface PoseConfirmation {
  checkedAt: string;
  checkedAgainst: string;
}

export interface PoseEditRecord {
  entityId: string;
  title: string;
  mode: PoseMode;
  authoredRevision: string;
  updatedAt: string;
  capture: PoseCapture;
  imagePose: PoseImage;
  marker: { offsetM: number };
  authored: PoseAuthored;
  verification: { orientation: PoseConfirmation | null };
}

export interface PoseSceneRecord {
  sceneId: string;
  sceneUrl: string;
  edits: PoseEditRecord[];
}

export interface PoseEnvelope {
  format: typeof POSE_FORMAT;
  version: typeof POSE_VERSION;
  scenes: PoseSceneRecord[];
}

export interface PoseExport extends PoseEnvelope {
  exportedAt: string;
}

/** The published photograph a correction is compared with. Roll is read-only context. */
export interface PublishedBaseline {
  entityId: string;
  title: string;
  revision: string;
  mode: PoseMode;
  longitudeDeg: number;
  latitudeDeg: number;
  heightMeters: number | null;
  headingDeg: number;
  pitchDeg: number;
  rollDeg: number;
  offsetM: number;
  /** Null and false are both unconfirmed. */
  aligned: boolean | null;
  eastM: number;
  northM: number;
}

export interface DesiredNumbers {
  mode: PoseMode;
  longitudeDeg: number;
  latitudeDeg: number;
  heightMeters: number | null;
  headingDeg: number;
  pitchDeg: number;
  offsetM: number;
}

export interface PoseStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface PoseStoreOptions {
  storage: PoseStorage | null;
  nowIso(): string;
  nowMs(): number;
  schedule(run: () => void, delayMs: number): { cancel(): void };
  key?: string;
}

export interface PoseStoreStatus {
  /** `saved` means the last successful write matches memory, or there was nothing to write. */
  persistence: "saved" | "session" | "blocked" | "foreign";
  messages: readonly string[];
  skipped: readonly string[];
  /** The raw payload kept when it cannot be rewritten safely. */
  originalText: string | null;
  canReplaceSaved: boolean;
}

export interface PoseStore {
  status(): PoseStoreStatus;
  edits(sceneId: string, sceneUrl: string): readonly PoseEditRecord[];
  edit(sceneId: string, sceneUrl: string, entityId: string): PoseEditRecord | null;
  /** Every scene currently held in memory. */
  summary(): { edits: number };
  setNumbers(sceneId: string, sceneUrl: string, baseline: PublishedBaseline, desired: DesiredNumbers, persist: PosePersist): boolean;
  confirm(sceneId: string, sceneUrl: string, baseline: PublishedBaseline, reference: string, persist: PosePersist): { ok: true } | { ok: false; reason: string };
  unconfirm(sceneId: string, sceneUrl: string, baseline: PublishedBaseline, persist: PosePersist): void;
  setReference(sceneId: string, sceneUrl: string, entityId: string, reference: string, persist: PosePersist): { ok: true } | { ok: false; reason: string };
  /** Drops overrides that already match these published baselines. `memory` does not write. */
  reconcile(sceneId: string, sceneUrl: string, baselines: readonly PublishedBaseline[], persist: PosePersist): void;
  remove(sceneId: string, sceneUrl: string, entityId: string, persist: PosePersist): void;
  clearScene(sceneId: string, sceneUrl: string, persist: PosePersist): { blocked: boolean };
  replaceSaved(): { ok: boolean; message: string };
  exportDocument(exportedAt: string): { document: PoseExport; text: string; disclosures: readonly string[] };
  flush(): void;
  cancelPending(): void;
  observeExternal(raw: string | null): void;
  dispose(): void;
}

interface DesiredState {
  mode: PoseMode;
  longitudeDeg: number;
  latitudeDeg: number;
  heightMeters: number | null;
  headingDeg: number;
  pitchDeg: number;
  offsetM: number;
  aligned: boolean;
  verification: { orientation: PoseConfirmation | null };
}

const SESSION_MESSAGE = "Edits are in this session only. Export before leaving.";
const FOREIGN_MESSAGE = "Saved edits changed in another tab. Export this session before reloading.";
const BLOCKED_MESSAGE = "Saved edits could not be read. Persistence is blocked. Export keeps this session's edits.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** Longitude in [-180, 180) after rounding. Rounding can land on 180. */
export function normalizeLongitude(deg: number): number {
  const rounded = round(deg, LON_LAT_DIGITS);
  const wrapped = ((rounded + 180) % 360 + 360) % 360 - 180;
  return wrapped === 180 ? -180 : wrapped;
}

/** Heading in [0, 360) after rounding. Rounding can land on 360. */
export function normalizeHeading(deg: number): number {
  const rounded = round(deg, ANGLE_DIGITS);
  return ((rounded % 360) + 360) % 360;
}

/** Roll in (-180, 180]. A value that rounds to -180 is stored as +180. */
export function normalizeRoll(deg: number): number {
  const rounded = round(deg, ANGLE_DIGITS);
  const wrapped = ((rounded + 180) % 360 + 360) % 360 - 180;
  return wrapped === -180 ? 180 : wrapped;
}

function cyclic(a: number, b: number, period: number): number {
  const delta = Math.abs(a - b) % period;
  return Math.min(delta, period - delta);
}

function lonClose(a: number, b: number): boolean {
  return cyclic(normalizeLongitude(a), normalizeLongitude(b), 360) <= LON_LAT_EPSILON;
}

function latClose(a: number, b: number): boolean {
  return Math.abs(round(a, LON_LAT_DIGITS) - round(b, LON_LAT_DIGITS)) <= LON_LAT_EPSILON;
}

function headingClose(a: number, b: number): boolean {
  return cyclic(normalizeHeading(a), normalizeHeading(b), 360) <= ANGLE_EPSILON;
}

function angleClose(a: number, b: number): boolean {
  return Math.abs(round(a, ANGLE_DIGITS) - round(b, ANGLE_DIGITS)) <= ANGLE_EPSILON;
}

function rollClose(a: number, b: number): boolean {
  return cyclic(normalizeRoll(a), normalizeRoll(b), 360) <= ANGLE_EPSILON;
}

function metersClose(a: number, b: number): boolean {
  return Math.abs(round(a, METER_DIGITS) - round(b, METER_DIGITS)) <= METER_EPSILON;
}

/** Null is a missing height. It is not zero. */
export function heightClose(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === null && b === null;
  if (typeof a !== "number" || typeof b !== "number" || !Number.isFinite(a) || !Number.isFinite(b)) return false;
  return metersClose(a, b);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

function validIso(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const date = new Date(value);
  return !Number.isNaN(date.getTime())
    && date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day
    && date.getUTCHours() === hour && date.getUTCMinutes() === minute && date.getUTCSeconds() === second;
}

function validMode(value: unknown): value is PoseMode {
  return value === "ground-relative" || value === "capture-relative";
}

/** HTTP(S) URL with no credentials, query or fragment. Nothing is stripped on read. */
export function validStoredSceneUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value) return false;
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  return (url.protocol === "http:" || url.protocol === "https:")
    && !url.username && !url.password && !url.search && !url.hash && url.href === value;
}

/** Resolves a scene URL against the app base and keeps only its HTTP(S) address. */
export function canonicalSceneUrl(sceneUrl: string, baseUrl: string): string | null {
  let url: URL;
  try { url = new URL(sceneUrl, baseUrl); } catch { return null; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return url.href;
}

export function poseExportFilename(prefix: string | undefined, exportedAt: string): string {
  const base = prefix && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(prefix) ? prefix : DEFAULT_POSE_EXPORT_PREFIX;
  const day = /^\d{4}-\d{2}-\d{2}/.test(exportedAt) ? exportedAt.slice(0, 10) : "0000-00-00";
  return `${base}-${day}.json`;
}

function inLon(value: number): boolean {
  return value >= -180 && value < 180;
}

function inLat(value: number): boolean {
  return value >= -90 && value <= 90;
}

function inHeading(value: number): boolean {
  return value >= 0 && value < 360;
}

function inRoll(value: number): boolean {
  return value > -180 && value <= 180;
}

function inOffset(value: number): boolean {
  return value >= OFFSET_MIN && value <= OFFSET_MAX;
}

/** Interactive edits are rounded and wrapped here. Stored documents that miss the range are rejected, not repaired. */
export function normalizeDesiredNumbers(input: DesiredNumbers): DesiredNumbers | null {
  if (!validMode(input.mode)) return null;
  if (![input.longitudeDeg, input.latitudeDeg, input.headingDeg, input.pitchDeg, input.offsetM].every(finite)) return null;
  if (input.heightMeters !== null && !finite(input.heightMeters)) return null;
  const offsetM = round(input.offsetM, METER_DIGITS);
  if (!inOffset(offsetM)) return null;
  const latitudeDeg = round(Math.min(90, Math.max(-90, input.latitudeDeg)), LON_LAT_DIGITS);
  const pitchDeg = round(Math.min(90, Math.max(-90, input.pitchDeg)), ANGLE_DIGITS);
  return {
    mode: input.mode,
    longitudeDeg: normalizeLongitude(input.longitudeDeg),
    latitudeDeg: Math.min(90, Math.max(-90, latitudeDeg)),
    heightMeters: input.heightMeters === null ? null : round(input.heightMeters, METER_DIGITS),
    headingDeg: normalizeHeading(input.headingDeg),
    pitchDeg: Math.min(90, Math.max(-90, pitchDeg)),
    offsetM,
  };
}

function numbersOf(record: PoseEditRecord): DesiredNumbers {
  return {
    mode: record.mode,
    longitudeDeg: record.capture.longitudeDeg,
    latitudeDeg: record.capture.latitudeDeg,
    heightMeters: record.capture.heightMeters,
    headingDeg: record.imagePose.headingDeg,
    pitchDeg: record.imagePose.pitchDeg,
    offsetM: record.marker.offsetM,
  };
}

function publishedNumbers(baseline: PublishedBaseline): DesiredNumbers {
  return {
    mode: baseline.mode,
    longitudeDeg: baseline.longitudeDeg,
    latitudeDeg: baseline.latitudeDeg,
    heightMeters: baseline.heightMeters,
    headingDeg: baseline.headingDeg,
    pitchDeg: baseline.pitchDeg,
    offsetM: baseline.offsetM,
  };
}

function orientationChanged(previous: DesiredNumbers, next: DesiredNumbers): boolean {
  return previous.mode !== next.mode
    || !lonClose(previous.longitudeDeg, next.longitudeDeg)
    || !latClose(previous.latitudeDeg, next.latitudeDeg)
    || !heightClose(previous.heightMeters, next.heightMeters)
    || !headingClose(previous.headingDeg, next.headingDeg)
    || !angleClose(previous.pitchDeg, next.pitchDeg);
}

/** Desired alignment matches the published one. False and null are both unconfirmed. */
export function alignmentClose(desired: boolean, published: boolean | null): boolean {
  return desired === (published === true);
}

/**
 * True when the desired place, the read-only roll and the desired alignment all
 * match the published photograph. A changed roll does not match.
 */
export function poseMatchesPublished(desired: DesiredState, published: PublishedBaseline, rollDeg: number): boolean {
  const numbers = normalizeDesiredNumbers(desired);
  const publishedNormalized = normalizeDesiredNumbers(publishedNumbers(published));
  if (!numbers || !publishedNormalized) return false;
  if (!Number.isFinite(rollDeg) || !Number.isFinite(published.rollDeg)) return false;
  return numbers.mode === publishedNormalized.mode
    && lonClose(numbers.longitudeDeg, publishedNormalized.longitudeDeg)
    && latClose(numbers.latitudeDeg, publishedNormalized.latitudeDeg)
    && heightClose(numbers.heightMeters, publishedNormalized.heightMeters)
    && headingClose(numbers.headingDeg, publishedNormalized.headingDeg)
    && angleClose(numbers.pitchDeg, publishedNormalized.pitchDeg)
    && metersClose(numbers.offsetM, publishedNormalized.offsetM)
    && rollClose(rollDeg, published.rollDeg)
    && alignmentClose(desired.aligned, published.aligned);
}

/** Fields of the immutable authored snapshot that no longer match the published photograph. */
export function conflictFields(authored: PoseAuthored, published: PublishedBaseline): readonly string[] {
  const fields: string[] = [];
  if (authored.mode !== published.mode) fields.push("mode");
  if (!lonClose(authored.longitudeDeg, published.longitudeDeg)) fields.push("longitudeDeg");
  if (!latClose(authored.latitudeDeg, published.latitudeDeg)) fields.push("latitudeDeg");
  if (!heightClose(authored.heightMeters, published.heightMeters)) fields.push("heightMeters");
  if (!headingClose(authored.headingDeg, published.headingDeg)) fields.push("headingDeg");
  if (!angleClose(authored.pitchDeg, published.pitchDeg)) fields.push("pitchDeg");
  if (!rollClose(authored.rollDeg, published.rollDeg)) fields.push("rollDeg");
  if (!metersClose(authored.offsetM, published.offsetM)) fields.push("offsetM");
  if ((authored.aligned === true) !== (published.aligned === true)) fields.push("aligned");
  return fields;
}

function inheritedAlignment(record: PoseEditRecord): boolean {
  if (record.authored.aligned !== true || record.mode !== record.authored.mode) return false;
  return lonClose(record.capture.longitudeDeg, record.authored.longitudeDeg)
    && latClose(record.capture.latitudeDeg, record.authored.latitudeDeg)
    && heightClose(record.capture.heightMeters, record.authored.heightMeters)
    && headingClose(record.imagePose.headingDeg, record.authored.headingDeg)
    && angleClose(record.imagePose.pitchDeg, record.authored.pitchDeg)
    && rollClose(record.authored.rollDeg, record.authored.rollDeg);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function recordJson(record: PoseEditRecord): PoseEditRecord {
  return {
    entityId: record.entityId,
    title: record.title,
    mode: record.mode,
    authoredRevision: record.authoredRevision,
    updatedAt: record.updatedAt,
    capture: { ...record.capture },
    imagePose: { ...record.imagePose },
    marker: { offsetM: record.marker.offsetM },
    authored: { ...record.authored },
    verification: { orientation: record.verification.orientation ? { ...record.verification.orientation } : null },
  };
}

export function serializePoseDocument(document: PoseEnvelope | PoseExport): string {
  const scenes = [...document.scenes].sort((a, b) => a.sceneId.localeCompare(b.sceneId) || a.sceneUrl.localeCompare(b.sceneUrl));
  const body: Record<string, unknown> = {
    format: POSE_FORMAT,
    version: POSE_VERSION,
  };
  if ("exportedAt" in document && document.exportedAt) body.exportedAt = document.exportedAt;
  body.scenes = scenes.map(scene => ({
    sceneId: scene.sceneId,
    sceneUrl: scene.sceneUrl,
    edits: [...scene.edits].sort((a, b) => a.entityId.localeCompare(b.entityId)).map(recordJson),
  }));
  return `${JSON.stringify(body, null, 2)}\n`;
}

function readNumber(value: unknown, range: (value: number) => boolean): number | null {
  return finite(value) && range(value) ? value : null;
}

function readHeight(value: unknown): number | null | undefined {
  if (value === null) return null;
  return finite(value) ? value : undefined;
}

function readConfirmation(value: unknown): PoseConfirmation | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || !validIso(value.checkedAt) || !nonempty(value.checkedAgainst)) return undefined;
  return { checkedAt: value.checkedAt, checkedAgainst: value.checkedAgainst };
}

function readEdit(value: unknown): { record: PoseEditRecord } | { error: string } {
  if (!isRecord(value)) return { error: "An edit is not an object." };
  if (!nonempty(value.entityId) || !nonempty(value.title) || !nonempty(value.authoredRevision) || !validIso(value.updatedAt) || !validMode(value.mode)) {
    return { error: "An edit is missing its id, title, revision, time or mode." };
  }
  if (!isRecord(value.capture) || !isRecord(value.imagePose) || !isRecord(value.marker) || !isRecord(value.authored) || !isRecord(value.verification) || !("orientation" in value.verification)) {
    return { error: `The edit for ${value.entityId} is missing its place, orientation, marker, authored baseline or verification.` };
  }
  const longitudeDeg = readNumber(value.capture.longitudeDeg, inLon);
  const latitudeDeg = readNumber(value.capture.latitudeDeg, inLat);
  const heightMeters = readHeight(value.capture.heightMeters);
  const headingDeg = readNumber(value.imagePose.headingDeg, inHeading);
  const pitchDeg = readNumber(value.imagePose.pitchDeg, inLat);
  const offsetM = readNumber(value.marker.offsetM, inOffset);
  const authored = value.authored;
  const authoredLongitude = readNumber(authored.longitudeDeg, inLon);
  const authoredLatitude = readNumber(authored.latitudeDeg, inLat);
  const authoredHeight = readHeight(authored.heightMeters);
  const authoredHeading = readNumber(authored.headingDeg, inHeading);
  const authoredPitch = readNumber(authored.pitchDeg, inLat);
  const authoredRoll = readNumber(authored.rollDeg, inRoll);
  const authoredOffset = readNumber(authored.offsetM, inOffset);
  const orientation = readConfirmation(value.verification.orientation);
  const aligned = value.imagePose.aligned;
  const authoredAligned = authored.aligned;
  if (longitudeDeg === null || latitudeDeg === null || heightMeters === undefined || headingDeg === null || pitchDeg === null || offsetM === null
    || !validMode(authored.mode) || authoredLongitude === null || authoredLatitude === null || authoredHeight === undefined
    || authoredHeading === null || authoredPitch === null || authoredRoll === null || authoredOffset === null
    || orientation === undefined || typeof aligned !== "boolean" || (authoredAligned !== null && typeof authoredAligned !== "boolean")) {
    return { error: `The edit for ${value.entityId} has a missing or out-of-range value.` };
  }
  const record: PoseEditRecord = {
    entityId: value.entityId,
    title: value.title,
    mode: value.mode,
    authoredRevision: value.authoredRevision,
    updatedAt: value.updatedAt,
    capture: { longitudeDeg, latitudeDeg, heightMeters },
    imagePose: { headingDeg, pitchDeg, aligned },
    marker: { offsetM },
    authored: {
      mode: authored.mode, longitudeDeg: authoredLongitude, latitudeDeg: authoredLatitude, heightMeters: authoredHeight,
      headingDeg: authoredHeading, pitchDeg: authoredPitch, rollDeg: authoredRoll, offsetM: authoredOffset, aligned: authoredAligned,
    },
    verification: { orientation },
  };
  if (aligned && !orientation && !inheritedAlignment(record)) {
    return { error: `The edit for ${value.entityId} says north is checked without a confirmation or an inherited alignment.` };
  }
  if (!aligned && orientation) return { error: `The edit for ${value.entityId} confirms an orientation that is not aligned.` };
  return { record };
}

export interface ParsedPoseStore {
  kind: "empty" | "ok" | "partial" | "blocked";
  scenes: PoseSceneRecord[];
  skipped: string[];
  message: string | null;
}

/** Reads one stored payload. Invalid entries are skipped; a wrong format or version blocks the key. */
export function parsePoseStore(raw: string): ParsedPoseStore {
  if (raw === "") return { kind: "empty", scenes: [], skipped: [], message: null };
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch {
    return { kind: "blocked", scenes: [], skipped: [], message: BLOCKED_MESSAGE };
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.scenes)) {
    return { kind: "blocked", scenes: [], skipped: [], message: BLOCKED_MESSAGE };
  }
  if (parsed.format !== POSE_FORMAT || parsed.version !== POSE_VERSION) {
    return { kind: "blocked", scenes: [], skipped: [], message: parsed.version !== POSE_VERSION
      ? "Saved edits use a format this page cannot update. Export this session before reloading."
      : BLOCKED_MESSAGE };
  }
  const skipped: string[] = [];
  const parsedScenes: PoseSceneRecord[] = [];
  parsed.scenes.forEach((value, index) => {
    if (!isRecord(value) || !nonempty(value.sceneId) || !validStoredSceneUrl(value.sceneUrl) || !Array.isArray(value.edits)) {
      skipped.push(`Scene entry ${index + 1} is missing its id, URL or edits.`);
      return;
    }
    const edits: PoseEditRecord[] = [];
    const counts = new Map<string, number>();
    value.edits.forEach((edit, editIndex) => {
      const read = readEdit(edit);
      if ("error" in read) {
        skipped.push(read.error || `Scene ${value.sceneId} edit ${editIndex + 1} was skipped.`);
        return;
      }
      counts.set(read.record.entityId, (counts.get(read.record.entityId) ?? 0) + 1);
      edits.push(read.record);
    });
    for (const [id, count] of counts) if (count > 1) skipped.push(`${id} is listed twice in ${value.sceneId} and was skipped.`);
    parsedScenes.push({
      sceneId: value.sceneId,
      sceneUrl: value.sceneUrl,
      edits: edits.filter(edit => counts.get(edit.entityId) === 1),
    });
  });
  const sceneCounts = new Map<string, number>();
  for (const scene of parsedScenes) {
    const key = `${scene.sceneId}\n${scene.sceneUrl}`;
    sceneCounts.set(key, (sceneCounts.get(key) ?? 0) + 1);
  }
  const scenes = parsedScenes.filter(scene => {
    const key = `${scene.sceneId}\n${scene.sceneUrl}`;
    if ((sceneCounts.get(key) ?? 0) < 2) return true;
    skipped.push(`Scene ${scene.sceneId} is listed twice and was skipped.`);
    return false;
  });
  const reported = [...new Set(skipped)];
  if (!reported.length) return { kind: scenes.length ? "ok" : "empty", scenes, skipped: reported, message: null };
  return {
    kind: "partial",
    scenes,
    skipped: reported,
    message: `Some saved records could not be read (${skipped.length}). Persistence is blocked until they are replaced. Export keeps this session's edits.`,
  };
}

function authoredFrom(baseline: PublishedBaseline): PoseAuthored {
  const numbers = normalizeDesiredNumbers(publishedNumbers(baseline));
  return {
    mode: baseline.mode,
    longitudeDeg: numbers?.longitudeDeg ?? baseline.longitudeDeg,
    latitudeDeg: numbers?.latitudeDeg ?? baseline.latitudeDeg,
    heightMeters: numbers?.heightMeters ?? baseline.heightMeters,
    headingDeg: numbers?.headingDeg ?? baseline.headingDeg,
    pitchDeg: numbers?.pitchDeg ?? baseline.pitchDeg,
    rollDeg: normalizeRoll(baseline.rollDeg),
    offsetM: numbers?.offsetM ?? baseline.offsetM,
    aligned: baseline.aligned,
  };
}

function desiredFromPublished(baseline: PublishedBaseline): DesiredState | null {
  const numbers = normalizeDesiredNumbers(publishedNumbers(baseline));
  if (!numbers) return null;
  return { ...numbers, aligned: baseline.aligned === true, verification: { orientation: null } };
}

function desiredFromRecord(record: PoseEditRecord): DesiredState {
  return { ...numbersOf(record), aligned: record.imagePose.aligned, verification: clone(record.verification) };
}

function sameDesired(a: DesiredState, b: DesiredState): boolean {
  return !orientationChanged(a, b)
    && metersClose(a.offsetM, b.offsetM)
    && a.aligned === b.aligned
    && (a.verification.orientation?.checkedAgainst ?? null) === (b.verification.orientation?.checkedAgainst ?? null)
    && Boolean(a.verification.orientation) === Boolean(b.verification.orientation);
}

export function createPoseStore(options: PoseStoreOptions): PoseStore {
  const key = options.key ?? POSE_STORAGE_KEY;
  const scenes = new Map<string, PoseSceneRecord>();
  let persistence: PoseStoreStatus["persistence"] = options.storage ? "saved" : "session";
  let blocked: "damaged" | "partial" | null = null;
  let foreign = false;
  let skipped: string[] = [];
  let message: string | null = options.storage ? null : SESSION_MESSAGE;
  let originalText: string | null = null;
  let acknowledged: string | null = null;
  let epoch = 0;
  let timer: { cancel(): void } | null = null;
  let waitStarted: number | null = null;
  let disposed = false;

  const identity = (sceneId: string, sceneUrl: string) => `${sceneId}\n${sceneUrl}`;

  function envelope(): PoseEnvelope {
    return {
      format: POSE_FORMAT,
      version: POSE_VERSION,
      scenes: [...scenes.values()].map(scene => ({ ...scene, edits: scene.edits.map(record => clone(record)) })),
    };
  }

  function load(): void {
    if (!options.storage) return;
    let raw: string | null;
    try { raw = options.storage.getItem(key); }
    catch { persistence = "session"; message = SESSION_MESSAGE; return; }
    acknowledged = raw;
    if (raw === null || raw === "") return;
    const parsed = parsePoseStore(raw);
    if (parsed.kind === "blocked") {
      blocked = "damaged";
      persistence = "blocked";
      message = parsed.message;
      originalText = raw;
      return;
    }
    for (const scene of parsed.scenes) scenes.set(identity(scene.sceneId, scene.sceneUrl), clone(scene));
    if (parsed.kind === "partial") {
      blocked = "partial";
      persistence = "blocked";
      skipped = parsed.skipped;
      message = parsed.message;
      originalText = raw;
    }
  }

  function readPersistence(): PoseStoreStatus["persistence"] {
    return persistence;
  }

  function canWrite(): boolean {
    return Boolean(options.storage) && !disposed && !blocked && !foreign && persistence !== "session";
  }

  function writeNow(): void {
    timer = null;
    waitStarted = null;
    if (!canWrite() || !options.storage) return;
    let current: string | null;
    try { current = options.storage.getItem(key); }
    catch { persistence = "session"; message = SESSION_MESSAGE; return; }
    if (current !== acknowledged) {
      foreign = true;
      persistence = "foreign";
      message = FOREIGN_MESSAGE;
      return;
    }
    const text = serializePoseDocument(envelope());
    try { options.storage.setItem(key, text); }
    catch { persistence = "session"; message = SESSION_MESSAGE; return; }
    acknowledged = text;
    persistence = "saved";
    if (!blocked && !foreign) message = null;
  }

  function cancelTimer(): void {
    epoch += 1;
    timer?.cancel();
    timer = null;
    waitStarted = null;
  }

  function schedulePersist(): void {
    if (!canWrite()) return;
    const ticket = epoch;
    const started = waitStarted ?? options.nowMs();
    waitStarted = started;
    if (options.nowMs() - started >= POSE_MAX_WAIT_MS) {
      timer?.cancel();
      timer = null;
      writeNow();
      return;
    }
    timer?.cancel();
    const elapsed = options.nowMs() - started;
    const delay = Math.min(POSE_COALESCE_MS, POSE_MAX_WAIT_MS - elapsed);
    timer = options.schedule(() => {
      if (ticket !== epoch) return;
      writeNow();
    }, delay);
  }

  function persist(mode: PosePersist): void {
    if (mode === "memory") return;
    if (mode === "now") { cancelTimer(); writeNow(); return; }
    schedulePersist();
  }

  function sceneOf(sceneId: string, sceneUrl: string): PoseSceneRecord {
    const id = identity(sceneId, sceneUrl);
    let scene = scenes.get(id);
    if (!scene) {
      scene = { sceneId, sceneUrl, edits: [] };
      scenes.set(id, scene);
    }
    return scene;
  }

  function dropSceneIfEmpty(scene: PoseSceneRecord): void {
    if (!scene.edits.length) scenes.delete(identity(scene.sceneId, scene.sceneUrl));
  }

  function put(sceneId: string, sceneUrl: string, baseline: PublishedBaseline, desired: DesiredState, previous: PoseEditRecord | null, persistMode: PosePersist): void {
    if (poseMatchesPublished(desired, baseline, previous?.authored.rollDeg ?? baseline.rollDeg)) {
      if (previous) {
        const scene = scenes.get(identity(sceneId, sceneUrl));
        if (scene) {
          scene.edits = scene.edits.filter(edit => edit.entityId !== baseline.entityId);
          dropSceneIfEmpty(scene);
        }
        persist(persistMode);
      }
      return;
    }
    const scene = sceneOf(sceneId, sceneUrl);
    const record: PoseEditRecord = {
      entityId: baseline.entityId,
      title: baseline.title,
      mode: desired.mode,
      authoredRevision: previous?.authoredRevision ?? baseline.revision,
      updatedAt: options.nowIso(),
      capture: { longitudeDeg: desired.longitudeDeg, latitudeDeg: desired.latitudeDeg, heightMeters: desired.heightMeters },
      imagePose: { headingDeg: desired.headingDeg, pitchDeg: desired.pitchDeg, aligned: desired.aligned },
      marker: { offsetM: desired.offsetM },
      authored: previous?.authored ?? authoredFrom(baseline),
      verification: clone(desired.verification),
    };
    if (previous && sameDesired(desiredFromRecord(previous), desired)) return;
    const index = scene.edits.findIndex(edit => edit.entityId === baseline.entityId);
    if (index >= 0) scene.edits[index] = record;
    else scene.edits.push(record);
    persist(persistMode);
  }

  load();

  return {
    status() {
      return {
        persistence: foreign ? "foreign" : blocked ? "blocked" : persistence,
        messages: [foreign ? FOREIGN_MESSAGE : message].filter((item): item is string => Boolean(item)),
        skipped: [...skipped],
        originalText,
        canReplaceSaved: Boolean(blocked) && !foreign && persistence !== "session" && Boolean(options.storage),
      };
    },
    edits(sceneId, sceneUrl) {
      return (scenes.get(identity(sceneId, sceneUrl))?.edits ?? []).map(record => clone(record));
    },
    edit(sceneId, sceneUrl, entityId) {
      const record = scenes.get(identity(sceneId, sceneUrl))?.edits.find(item => item.entityId === entityId);
      return record ? clone(record) : null;
    },
    summary() {
      let edits = 0;
      for (const scene of scenes.values()) edits += scene.edits.length;
      return { edits };
    },
    setNumbers(sceneId, sceneUrl, baseline, desired, persistMode) {
      if (disposed || !baseline.entityId) return false;
      const numbers = normalizeDesiredNumbers(desired);
      const starting = desiredFromPublished(baseline);
      if (!numbers || !starting || baseline.entityId.length === 0) return false;
      const previous = scenes.get(identity(sceneId, sceneUrl))?.edits.find(item => item.entityId === baseline.entityId) ?? null;
      const current = previous ? desiredFromRecord(previous) : starting;
      const next: DesiredState = orientationChanged(current, numbers)
        ? { ...numbers, aligned: false, verification: { orientation: null } }
        : { ...numbers, aligned: current.aligned, verification: clone(current.verification) };
      put(sceneId, sceneUrl, baseline, next, previous, persistMode);
      return true;
    },
    confirm(sceneId, sceneUrl, baseline, reference, persistMode) {
      const checkedAgainst = reference.trim();
      if (!checkedAgainst) return { ok: false, reason: "Name what north was checked against." };
      const starting = desiredFromPublished(baseline);
      if (!starting) return { ok: false, reason: "This photograph has no published place to confirm." };
      const previous = scenes.get(identity(sceneId, sceneUrl))?.edits.find(item => item.entityId === baseline.entityId) ?? null;
      const current = previous ? desiredFromRecord(previous) : starting;
      put(sceneId, sceneUrl, baseline, {
        ...current,
        aligned: true,
        verification: { orientation: { checkedAt: options.nowIso(), checkedAgainst } },
      }, previous, persistMode);
      return { ok: true };
    },
    unconfirm(sceneId, sceneUrl, baseline, persistMode) {
      const starting = desiredFromPublished(baseline);
      if (!starting) return;
      const previous = scenes.get(identity(sceneId, sceneUrl))?.edits.find(item => item.entityId === baseline.entityId) ?? null;
      const current = previous ? desiredFromRecord(previous) : starting;
      put(sceneId, sceneUrl, baseline, { ...current, aligned: false, verification: { orientation: null } }, previous, persistMode);
    },
    setReference(sceneId, sceneUrl, entityId, reference, persistMode) {
      const checkedAgainst = reference.trim();
      if (!checkedAgainst) return { ok: false, reason: "Name what north was checked against." };
      const scene = scenes.get(identity(sceneId, sceneUrl));
      const index = scene?.edits.findIndex(item => item.entityId === entityId) ?? -1;
      const previous = index >= 0 ? scene!.edits[index] : undefined;
      if (!previous?.verification.orientation) return { ok: false, reason: "North is not checked." };
      if (previous.verification.orientation.checkedAgainst === checkedAgainst) return { ok: true };
      scene!.edits[index] = {
        ...previous,
        updatedAt: options.nowIso(),
        verification: { orientation: { ...previous.verification.orientation, checkedAgainst } },
      };
      persist(persistMode);
      return { ok: true };
    },
    reconcile(sceneId, sceneUrl, baselines, persistMode) {
      const scene = scenes.get(identity(sceneId, sceneUrl));
      if (!scene) return;
      const byId = new Map(baselines.map(baseline => [baseline.entityId, baseline]));
      const before = scene.edits.length;
      scene.edits = scene.edits.filter(record => {
        const baseline = byId.get(record.entityId);
        if (!baseline || baseline.mode !== record.mode) return true;
        return !poseMatchesPublished(desiredFromRecord(record), baseline, record.authored.rollDeg);
      });
      dropSceneIfEmpty(scene);
      if (scene.edits.length !== before) persist(persistMode);
    },
    remove(sceneId, sceneUrl, entityId, persistMode) {
      const scene = scenes.get(identity(sceneId, sceneUrl));
      if (!scene) return;
      const next = scene.edits.filter(edit => edit.entityId !== entityId);
      if (next.length === scene.edits.length) return;
      scene.edits = next;
      dropSceneIfEmpty(scene);
      persist(persistMode);
    },
    clearScene(sceneId, sceneUrl, persistMode) {
      const id = identity(sceneId, sceneUrl);
      if (!scenes.has(id)) return { blocked: Boolean(blocked) || foreign || persistence === "session" };
      scenes.delete(id);
      if (blocked || foreign || persistence === "session" || !options.storage) return { blocked: true };
      persist(persistMode);
      const after = readPersistence();
      return { blocked: after === "session" || Boolean(blocked) || foreign };
    },
    replaceSaved() {
      if (!blocked) return { ok: false, message: "Saved data is already readable." };
      if (foreign) return { ok: false, message: FOREIGN_MESSAGE };
      if (!options.storage || persistence === "session") return { ok: false, message: SESSION_MESSAGE };
      blocked = null;
      skipped = [];
      message = null;
      originalText = null;
      writeNow();
      const after = readPersistence();
      if (after === "session" || blocked || foreign) return { ok: false, message: "The saved data could not be replaced. Export before leaving." };
      return { ok: true, message: "Unreadable saved records were discarded and replaced with this session." };
    },
    exportDocument(exportedAt) {
      const document: PoseExport = { ...envelope(), exportedAt };
      const disclosures = [...skipped];
      if (blocked || persistence === "session") disclosures.push(message ?? SESSION_MESSAGE);
      if (foreign) disclosures.push(FOREIGN_MESSAGE);
      return { document, text: serializePoseDocument(document), disclosures };
    },
    flush() { if (!disposed) { cancelTimer(); writeNow(); } },
    cancelPending() { cancelTimer(); },
    observeExternal(raw) {
      if (raw === acknowledged) return;
      foreign = true;
      persistence = "foreign";
      message = FOREIGN_MESSAGE;
      cancelTimer();
    },
    dispose() {
      if (disposed) return;
      cancelTimer();
      writeNow();
      disposed = true;
    },
  };
}
