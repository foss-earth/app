import { mulMat3 } from "@foss-earth/images";
import { sphereViewBasis } from "@foss-earth/sphere-image";
import type { ScenePreviewFace } from "@foss-earth/scenes/browser";
import type { PreviewOcclusion } from "@foss-earth/scenes/panel";
import type { ViewRecord } from "@foss-earth/scenes";

/** The full viewer's local camera, rotated once before the fragment shader. */
export function thumbnailUniforms(face: ScenePreviewFace, look: ViewRecord, width: number, height: number, covers: PreviewOcclusion = []): Float32Array {
  const basis = sphereViewBasis(look, { width, height }), tan = Math.tan(basis.verticalFovRad / 2);
  const values = new Float32Array(32);
  [basis.forward, basis.right, basis.up].forEach((vector, index) => {
    const rotated = face.content ? mulMat3(face.content, vector) : vector;
    const scale = index === 1 ? tan * width / height : index === 2 ? tan : 1;
    rotated.forEach((value, axis) => { values[index * 4 + axis] = value * scale; });
  });
  values.set([face.originX ?? face.x, face.y, face.size, 0], 12);
  values.set([width, height, 0, 0], 16);
  covers.slice(0, 2).forEach((cover, index) => {
    values.set([cover.x * width, cover.y * height, cover.width * width, cover.height * height], 20 + index * 4);
    values[28 + index] = cover.radius * width;
  });
  return values;
}

export interface ThumbnailStage<T = unknown> {
  upload(image: HTMLImageElement): T;
  draw(texture: T, uniforms: Float32Array, width: number, height: number): HTMLCanvasElement;
  release(texture: T): void;
  onLost(listener: () => void): () => void;
  destroy(): void;
}
