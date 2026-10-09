/** Deprecated built-in scene specialization; every structure belongs to its provider. */
export { SCENE_FORMAT, SCENE_FORMAT_VERSION } from "@foss-earth/scenes";
export type { AttributionRecord, CaptureRecord, GroupRecord, HeightRecord, ImagePoseRecord,
  LinkRecord, MarkerRecord, OverviewRecord, PanoramaEntityRecord, ResolvedPanorama,
  SceneDiagnostic, SceneExtensions, UnsupportedEntity, ViewRecord } from "@foss-earth/scenes";
export type { CubeRepresentationRecord } from "@foss-earth/cubemap";
export type { EquirectRepresentationRecord } from "@foss-earth/equirectangular";
export type { TiledCubeRepresentationRecord } from "@foss-earth/tiled-cubemap";
export type { SheetRecord, SheetPlaceRecord, ResolvedSheetPlace } from "@foss-earth/preview-sheets/core";
import type { ImageRepresentation } from "@foss-earth/images";
import type { BuiltInRepresentation } from "@foss-earth/360";
import type { CubeRepresentationRecord } from "@foss-earth/cubemap";
import type { EquirectRepresentationRecord } from "@foss-earth/equirectangular";
import type { TiledCubeRepresentationRecord } from "@foss-earth/tiled-cubemap";
import type { ResolvedSheetPlace, SheetRecord } from "@foss-earth/preview-sheets/core";
import type { SceneDocument as EnvelopeDocument, PanoramaAssetRecord as EnvelopeAsset,
  ResolvedAsset as EnvelopeResolvedAsset, ValidatedScene as EnvelopeScene,
  SceneValidation as EnvelopeValidation } from "@foss-earth/scenes";
export type RepresentationRecord = BuiltInRepresentation;
export type ResolvedRepresentation = (CubeRepresentationRecord & { sheet?: ResolvedSheetPlace })
  | EquirectRepresentationRecord | TiledCubeRepresentationRecord;
export type ResolvedTiledCube = TiledCubeRepresentationRecord;
export type ResolvedWholeRepresentation = Exclude<ResolvedRepresentation, ResolvedTiledCube>;
export type PanoramaAssetRecord<R extends ImageRepresentation = RepresentationRecord> = EnvelopeAsset<R>;
export type SceneDocument<R extends ImageRepresentation = RepresentationRecord> = EnvelopeDocument<R>;
export type ResolvedAsset<R extends ImageRepresentation = ResolvedRepresentation> = EnvelopeResolvedAsset<R>;
/** The compatibility validator composes the public sheets extension and exposes this view. */
export type ValidatedScene<R extends ImageRepresentation = ResolvedRepresentation> = EnvelopeScene<R> & { sheets: ReadonlyMap<string, SheetRecord> };
export type SceneValidation = { ok: true; scene: ValidatedScene } | Extract<EnvelopeValidation, { ok: false }>;
