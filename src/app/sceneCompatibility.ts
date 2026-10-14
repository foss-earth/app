/** Earth composes the public envelope and representation owners for legacy callers. */
import {
  checkSceneFiles as checkDeclaredFiles,
  validateScene as validateEnvelope,
  type SceneExtensionHook,
  type SceneFileReport,
  type SceneLimits,
  type SceneRepresentationFileHook,
  type ValidatedScene as EnvelopeScene,
} from "@foss-earth/scenes";
import {
  createBuiltInRepresentations,
  validateViewerAsset,
  type BuiltInRepresentation,
} from "@foss-earth/image-viewer";
import { createPreviewSheetsExtensionHook } from "@foss-earth/preview-sheets/scene-extension";
import { PREVIEW_SHEETS_EXTENSION, type SheetRecord } from "@foss-earth/preview-sheets";
import { tiledCubeFilesWithLevel, type TiledCubeRepresentationRecord } from "@foss-earth/sphere-tiled-cubemap";
import type { SceneValidation, ValidatedScene } from "../scenes/format";

export type { SceneLimits, SceneFileReport };
export interface ValidateSceneOptions {
  baseUrl?: string | URL | null;
  limits?: Partial<SceneLimits>;
  /** Legacy hosts explicitly declare their opaque extensions; no renderer is created. */
  supportedExtensions?: readonly string[];
}

// Validation never evaluates residency estimates. These explicit zero inputs
// avoid constructing a resource policy merely to validate a scene document.
const representations = createBuiltInRepresentations(() => ({
  tileMemoryBytes: 0, responseBytes: 0, requests: 0, waiting: 0, uploadOutstandingBytes: 0,
})).map(entry => entry.hooks);

export function validateScene(input: unknown, options: ValidateSceneOptions = {}): SceneValidation {
  const extensions: SceneExtensionHook[] = [createPreviewSheetsExtensionHook()];
  for (const name of new Set(options.supportedExtensions ?? [])) {
    if (name === PREVIEW_SHEETS_EXTENSION) continue;
    extensions.push({ name, validateDocument: data => ({ data, warnings: [] }) });
  }
  const result = validateEnvelope(input, {
    baseUrl: options.baseUrl, limits: options.limits,
    representations, validateImageAsset: validateViewerAsset, extensionHooks: extensions,
  });
  if (!result.ok) return result;
  const sheets = result.scene.extensionData.get(PREVIEW_SHEETS_EXTENSION) as ReadonlyMap<string, SheetRecord> | undefined;
  // Only the fixed built-in owner hooks above produce these representation
  // structures. The compatibility shape adds the old sheets view without
  // moving sheet validation or any envelope/representation logic into Earth.
  return { ok: true, scene: { ...result.scene, sheets: sheets ?? new Map() } as ValidatedScene };
}

const fileHooks: readonly SceneRepresentationFileHook<BuiltInRepresentation>[] = representations.map(hook =>
  hook.projection === "tiled-cube" ? {
    ...hook,
    files: (record: TiledCubeRepresentationRecord) => Array.from(tiledCubeFilesWithLevel(record),
      file => ({ ...file, group: String(file.level) })),
    groups: (record: TiledCubeRepresentationRecord) => record.levelBytes.map((encodedBytes, level) => ({
      id: String(level), fieldPath: `.levelBytes[${level}]`, encodedBytes, filesLabel: `level ${level}'s tiles`,
    })),
  } : hook,
) as readonly SceneRepresentationFileHook<BuiltInRepresentation>[];

export function checkSceneFiles(scene: ValidatedScene, read: (url: string) => Uint8Array | null): SceneFileReport {
  const envelope = scene as ValidatedScene & Partial<EnvelopeScene<BuiltInRepresentation>>;
  const supplied: EnvelopeScene<BuiltInRepresentation> = {
    ...envelope,
    extensionData: envelope.extensionData ?? new Map([[PREVIEW_SHEETS_EXTENSION, scene.sheets]]),
  } as EnvelopeScene<BuiltInRepresentation>;
  return checkDeclaredFiles(supplied, read, {
    representations: fileHooks,
    extensionFiles: () => Array.from(scene.sheets.values(), sheet => ({
      path: `$.extensions.${PREVIEW_SHEETS_EXTENSION}.sheets[${sheet.id}]`, file: sheet, encodedBytes: sheet.encodedBytes,
    })),
  });
}
