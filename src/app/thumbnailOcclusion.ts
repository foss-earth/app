/** Bound the depth prepass to the opaque controls, usually only the top 16 px. */
export function thumbnailCoverBounds(values: Float32Array, width: number, height: number): readonly [number, number, number, number] | null {
  let left = width, top = height, right = 0, bottom = 0;
  for (const offset of [20, 24]) {
    if (!(values[offset + 2] > 0 && values[offset + 3] > 0)) continue;
    left = Math.min(left, values[offset]); top = Math.min(top, values[offset + 1]);
    right = Math.max(right, values[offset] + values[offset + 2]); bottom = Math.max(bottom, values[offset + 1] + values[offset + 3]);
  }
  left = Math.max(0, Math.floor(left)); top = Math.max(0, Math.floor(top));
  right = Math.min(width, Math.ceil(right)); bottom = Math.min(height, Math.ceil(bottom));
  return right > left && bottom > top ? [left, top, right - left, bottom - top] : null;
}
