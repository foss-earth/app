import { expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { sphereRay } from "@foss-earth/sphere-image";
import { imagePoseMatrix, mulMat3, transpose3 } from "@foss-earth/images";
import { thumbnailUniforms } from "./thumbnailProjection";
import { createGpuPreviewBackend } from "./thumbnailBackend";

const look = { headingDeg: 38, pitchDeg: 85, verticalFovDeg: 76 };
const face = { url: "https://example.com/sheet.jpg", originX: 384, x: 512, y: 64, size: 64, sheetWidth: 1024, sheetHeight: 1024, content: transpose3(imagePoseMatrix({ headingDeg: 17, pitchDeg: 11, rollDeg: -9 })) };
it("GPU uniforms use the full viewer's local rays, including zenith, aspect and image pose", () => {
  const values = thumbnailUniforms(face, look, 176, 88);
  for (const [x, y] of [[.5, .5], [0, 0], [.2, .8], [1, 1]]) {
    const ray = [0, 1, 2].map(i => values[i] + values[4 + i] * (2 * x - 1) + values[8 + i] * (1 - 2 * y));
    const length = Math.hypot(...ray);
    const reference = mulMat3(face.content, sphereRay(look, { width: 176, height: 88 }, { x: x * 176, y: y * 88 }));
    reference.forEach((value, i) => expect(ray[i] / length).toBeCloseTo(value, 6));
  }
  expect([...values.slice(12, 15)]).toEqual([384, 64, 64]);
});
it("shares one GPU upload per sheet, copies frames without CPU pixel reads and releases last owner", async () => {
  const dom = new JSDOM(), document = dom.window.document;
  const images: { onload: (() => void) | null; src: string }[] = [];
  vi.spyOn(dom.window, "Image").mockImplementation(function () {
    const image = { onload: null, onerror: null, src: "", naturalWidth: 1024, naturalHeight: 1024 };
    images.push(image); return image;
  } as unknown as typeof Image);
  const drawImage = vi.fn();
  vi.spyOn(dom.window.HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
  const stage = { upload: vi.fn(() => ({})), draw: vi.fn(() => document.createElement("canvas")), release: vi.fn(), destroy: vi.fn(), onLost: vi.fn(() => () => {}) };
  const backend = createGpuPreviewBackend(document, stage);
  const ready = vi.fn(), failed = vi.fn();
  const a = backend.create(document.createElement("canvas"), face, ready, failed);
  const b = backend.create(document.createElement("canvas"), face, ready, failed);
  expect(images).toHaveLength(1);
  expect(a.paint(look)).toBe(false);
  images[0].onload!(); await Promise.resolve(); await Promise.resolve();
  expect(stage.upload).toHaveBeenCalledTimes(1); expect(ready).toHaveBeenCalledTimes(2);
  expect(a.paint(look)).toBe(true); expect(b.paint(look)).toBe(true);
  expect(drawImage).toHaveBeenCalledTimes(2);
  a.destroy(); expect(stage.release).not.toHaveBeenCalled();
  b.destroy(); expect(stage.release).toHaveBeenCalledTimes(1);
  backend.destroy(); expect(stage.destroy).toHaveBeenCalledTimes(1);
  dom.window.close();
});
it("packs normalized opaque covers for the depth prepass without changing the camera", () => {
  const covers = [{ x: 0, y: 0, width: .8, height: .25, radius: 0 }, { x: .8, y: 0, width: .2, height: .2, radius: .1 }];
  const values = thumbnailUniforms(face, look, 100, 100, covers);
  expect([...values.slice(20)]).toEqual([0, 0, 80, 25, 80, 0, 20, 20, 0, 10, 0, 0]);
  expect([...values.slice(0, 20)]).toEqual([...thumbnailUniforms(face, look, 100, 100).slice(0, 20)]);
});
it("does not request a different algorithm for a network failure and keeps loss notification after one owner closes", async () => {
  const dom = new JSDOM(), document = dom.window.document;
  const images: { onload: (() => void) | null; onerror: (() => void) | null }[] = [];
  vi.spyOn(dom.window, "Image").mockImplementation(function () {
    const image = { onload: null, onerror: null, src: "" }; images.push(image); return image;
  } as unknown as typeof Image);
  const stage = { upload: vi.fn(() => ({})), draw: vi.fn(() => document.createElement("canvas")), release: vi.fn(), destroy: vi.fn(), onLost: vi.fn((listener: () => void) => { void listener; return () => {}; }) };
  const backend = createGpuPreviewBackend(document, stage);
  const failed = vi.fn();
  const a = backend.create(document.createElement("canvas"), face, () => {}, failed);
  const b = backend.create(document.createElement("canvas"), face, () => {}, failed);
  images[0].onerror!(); await Promise.resolve(); await Promise.resolve();
  expect(failed).not.toHaveBeenCalled(); expect(stage.upload).not.toHaveBeenCalled();
  a.destroy(); stage.onLost.mock.calls[0][0]();
  expect(failed).toHaveBeenCalledTimes(1);
  b.destroy(); backend.destroy(); dom.window.close();
});
