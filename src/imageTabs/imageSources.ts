/**
 * An image document's pixels at their own size, one texture shared by every
 * tab that shows it (docs/proposals/shared-image-viewer-implementation.md §9).
 * Reading, decoding and uploading go through the session's broker, its pools
 * and its single uploader, as sphere images do.
 */
import type { BaseTexture } from "@babylonjs/core";
import { ResourceCapacityError, type CachedImageSource, type ImageKind, type ImageOperationScope, type ImageSessionBroker, type ImageSourceRequest } from "@foss-earth/images";
import { createImageFileService, type EncodedImageFile, type ImageTransferLimits } from "@foss-earth/images/browser";
import type { RectangleImageRepresentationRecord } from "@foss-earth/rectangle-image";
import { loadRectangleImage } from "@foss-earth/rectangle-image/browser";
import { createRectangleUploadAdapter } from "@foss-earth/rectangle-image/babylon";
import type { RectangleSurfaceTexture } from "@foss-earth/image-viewer/babylon";
import type { ImageTextureUploader } from "@foss-earth/renderer/babylon";
import type { ImageDocument } from "./imageDocuments";

export interface RectangleImageSource extends CachedImageSource {
  readonly texture: RectangleSurfaceTexture;
  readonly gpuBytes: number;
  /** False once the device or the session ended the operation that made it. */
  isCurrent(): boolean;
}

export interface RectangleImageSourcePorts {
  window: Window;
  broker: ImageSessionBroker;
  uploader: ImageTextureUploader;
  limits(): ImageTransferLimits;
  maxTextureSide(): number;
  /** Settles once the renderer can sample the texture. */
  whenReady(texture: BaseTexture, signal: AbortSignal): Promise<void>;
}

export type RectangleImageSourceLoader = (document: ImageDocument, scope: ImageOperationScope, request: ImageSourceRequest) => Promise<RectangleImageSource>;

/** The representation a session document stands for. A file has no address; its record names the session's own. */
export function rectangleImageRecord(document: ImageDocument): RectangleImageRepresentationRecord {
  return { id: "image", role: "image", projection: "rectangle", mimeType: document.mimeType, encodedBytes: document.encodedBytes,
    width: document.width, height: document.height,
    url: document.source.kind === "url" ? document.source.url : `session-file:${document.assetKey}` };
}

/** A chosen file's bytes, charged to the encoded pool while anything reads them. */
async function readFile(file: Blob, scope: ImageOperationScope, label: string): Promise<EncodedImageFile> {
  const reservation = scope.reserve("encoded", file.size, label);
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    scope.signal.throwIfAborted();
    return { bytes, contentType: file.type || null, retain: () => reservation.retain(), release: () => reservation.release() };
  } catch (error) { reservation.release(); throw error; }
}

export function createRectangleImageSourceLoader(ports: RectangleImageSourcePorts): RectangleImageSourceLoader {
  const { window, broker } = ports;
  const decode = async (bytes: Uint8Array, mimeType: ImageKind): Promise<ImageBitmap> => {
    // The Blob copies its input: charge the copy while the browser decodes it.
    const grant = broker.pools.reserve("encoded", bytes.byteLength, "image tab native Blob input");
    if (!grant.ok) throw new ResourceCapacityError(grant.pool, grant.reason);
    try {
      return await window.createImageBitmap(new Blob([new Uint8Array(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength)], { type: mimeType }),
        { colorSpaceConversion: "none", premultiplyAlpha: "none", imageOrientation: "from-image" });
    } finally { grant.reservation.release(); }
  };
  const files = createImageFileService({ broker, limits: ports.limits, priority: () => 10, fetch: window.fetch.bind(window), decode, cache: null });
  return async (document, scope, request) => {
    const record = rectangleImageRecord(document), source = document.source;
    const loaded = await loadRectangleImage(record, {
      broker, scope, overlap: request.overlap, maxTextureSide: ports.maxTextureSide(), label: `${document.title} (${document.id})`,
      obtain: (file, declaredBytes) => source.kind === "url"
        ? files.obtain(file, declaredBytes, scope, undefined, request.priority)
        : readFile(source.file, scope, `${document.title} file`),
      decode: (body, file) => files.decode(body, file, scope, request.priority),
      uploadRectangle: createRectangleUploadAdapter(ports.uploader, broker, scope),
      whenReady: (uploaded, signal) => ports.whenReady(uploaded.texture, signal),
    });
    const { texture } = loaded.texture;
    return {
      texture: { texture, width: loaded.texture.width, height: loaded.texture.height },
      gpuBytes: loaded.estimate.sourceGpu,
      isCurrent: () => scope.isCurrent(),
      dispose: loaded.dispose,
      settleReplacement: loaded.settleReplacement,
    };
  };
}
