import type { AbstractEngine } from "@babylonjs/core";
import type { PreviewBackend } from "@foss-earth/scenes/panel";
import { thumbnailUniforms, type ThumbnailStage } from "./thumbnailProjection";

/** Backend modules (and their shaders) are fetched only after selection and first use. */
export async function createThumbnailBackend(document: Document, engine: AbstractEngine): Promise<PreviewBackend> {
  if (engine.isWebGPU) {
    try {
      const { createWebGpuThumbnailStage } = await import("./thumbnailWebGpu");
      return createGpuPreviewBackend(document, await createWebGpuThumbnailStage(document, engine));
    } catch { /* A rejected WebGPU setup can still use WebGL before CPU fallback. */ }
  }
  const { createWebGlThumbnailStage } = await import("./thumbnailWebGl");
  return createGpuPreviewBackend(document, createWebGlThumbnailStage(document));
}

/** One decoded/uploaded texture per owned sheet; frame copies never read pixels into JS. */
export function createGpuPreviewBackend<T>(document: Document, stage: ThumbnailStage<T>): PreviewBackend {
  type Sheet = { owners: number; texture: T | null; image: HTMLImageElement; uploadFailed: boolean; ready: Promise<void> };
  const sheets = new Map<string, Sheet>(), failures = new Set<() => void>();
  let dead = false, lost = false;
  const offLost = stage.onLost(() => { lost = true; for (const failed of [...failures]) failed(); });
  const retire = (url: string, sheet: Sheet): void => {
    if (--sheet.owners) return;
    if (sheet.texture) stage.release(sheet.texture);
    sheet.texture = null; sheet.image.onload = sheet.image.onerror = null;
    if (sheets.get(url) === sheet) sheets.delete(url);
  };
  return {
    create(canvas, face, ready, failed) {
      if (dead || lost) throw Error("Thumbnail device unavailable");
      let sheet = sheets.get(face.url);
      if (!sheet) {
        const image = new document.defaultView!.Image();
        const owned: Sheet = { owners: 0, texture: null, image, uploadFailed: false, ready: Promise.resolve() };
        owned.ready = new Promise<void>((resolve, reject) => {
          image.onload = () => {
            if (dead || owned.owners === 0) return;
            try { owned.texture = stage.upload(image); resolve(); } catch (error) { owned.uploadFailed = true; reject(error); }
          };
          image.onerror = () => reject(Error("Thumbnail sheet unavailable"));
        });
        sheets.set(face.url, owned); sheet = owned;
        image.crossOrigin = "anonymous"; image.src = face.url;
      }
      sheet.owners++;
      const owned = sheet;
      let retired = false;
      let context: CanvasRenderingContext2D | null = null;
      const onFailure = () => failed();
      failures.add(onFailure);
      void owned.ready.then(() => { if (!retired && !dead) ready(); }, () => { if (!retired && !dead && owned.uploadFailed) failed(); });
      return {
        paint(look, covers) {
          if (retired || dead || lost || !owned.texture) return false;
          context ??= canvas.getContext("2d");
          if (!context) return false;
          const projected = stage.draw(owned.texture, thumbnailUniforms(face, look, canvas.width, canvas.height, covers), canvas.width, canvas.height);
          context.drawImage(projected, 0, 0);
          return true;
        },
        destroy() { if (retired) return; retired = true; failures.delete(onFailure); retire(face.url, owned); },
      };
    },
    destroy() {
      if (dead) return; dead = true; offLost(); failures.clear();
      for (const [url, sheet] of sheets) { sheet.owners = 1; retire(url, sheet); }
      stage.destroy();
    },
  };
}
