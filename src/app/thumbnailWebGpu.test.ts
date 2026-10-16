import { JSDOM } from "jsdom";
import { expect, it, vi } from "vitest";
import type { AbstractEngine } from "@babylonjs/core";
import { createWebGpuThumbnailStage } from "./thumbnailWebGpu";

function host(rejectPipeline = false) {
  const dom = new JSDOM(), document = dom.window.document;
  const pipelines = [{ getBindGroupLayout: () => ({}) }, {}];
  const pass = { setScissorRect: vi.fn(), setPipeline: vi.fn(), setBindGroup: vi.fn(), draw: vi.fn(), end: vi.fn() };
  const encoder = { beginRenderPass: vi.fn(() => pass), finish: vi.fn(() => ({})) };
  const context = { configure: vi.fn(), unconfigure: vi.fn(), getCurrentTexture: () => ({ createView: () => ({}) }) };
  vi.spyOn(dom.window.HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
  Object.defineProperty(dom.window.navigator, "gpu", { value: { getPreferredCanvasFormat: () => "bgra8unorm" } });
  const buffer = { destroy: vi.fn() };
  let lose!: () => void;
  const textures: { createView: () => object; destroy: ReturnType<typeof vi.fn> }[] = [];
  const device = {
    createShaderModule: vi.fn(() => ({})),
    createRenderPipelineAsync: vi.fn(async () => { if (rejectPipeline) throw Error("Shader rejected"); return pipelines[device.createRenderPipelineAsync.mock.calls.length - 1]; }),
    createPipelineLayout: vi.fn(() => ({})), createBuffer: vi.fn(() => buffer),
    createTexture: vi.fn(() => { const texture = { createView: () => ({}), destroy: vi.fn() }; textures.push(texture); return texture; }),
    createBindGroup: vi.fn(() => ({})), createCommandEncoder: vi.fn(() => encoder),
    queue: { copyExternalImageToTexture: vi.fn(), writeBuffer: vi.fn(), submit: vi.fn() },
    lost: new Promise<void>(resolve => { lose = resolve; }), destroy: vi.fn(),
  };
  return { dom, document, device, engine: { isWebGPU: true, _device: device } as unknown as AbstractEngine, context, pass, encoder, pipelines, buffer, textures, lose };
}
it("borrows the host device, draws opaque covers into depth first and never owns the device lifetime", async () => {
  const hostGpu = host(), { device, context, pass, pipelines, buffer, textures } = hostGpu;
  const stage = await createWebGpuThumbnailStage(hostGpu.document, hostGpu.engine);
  expect(context.configure).toHaveBeenCalledWith({ device, format: "bgra8unorm", alphaMode: "opaque" });
  const descriptions = device.createRenderPipelineAsync.mock.calls as unknown as [GPURenderPipelineDescriptor][];
  expect(descriptions[0][0].depthStencil).toMatchObject({ depthWriteEnabled: false, depthCompare: "less" });
  expect(descriptions[1][0].depthStencil).toMatchObject({ depthWriteEnabled: true, depthCompare: "always" });
  expect(descriptions[1][0].fragment?.targets).toEqual([{ format: "bgra8unorm", writeMask: 0 }]);
  const texture = stage.upload({ naturalWidth: 384, naturalHeight: 64 } as HTMLImageElement);
  const values = new Float32Array(32); values[22] = 72; values[23] = 16;
  stage.draw(texture, values, 88, 88);
  expect(pass.setPipeline.mock.calls.map(call => call[0])).toEqual([pipelines[1], pipelines[0]]);
  expect(pass.setScissorRect.mock.calls).toEqual([[0, 0, 72, 16], [0, 0, 88, 88]]);
  expect(pass.draw).toHaveBeenCalledTimes(2); expect(device.queue.submit).toHaveBeenCalledTimes(1);
  stage.draw(texture, values, 88, 88);
  expect(device.createTexture).toHaveBeenCalledTimes(2); // sheet and reusable depth
  stage.release(texture); stage.destroy(); stage.destroy();
  expect(textures.every(value => value.destroy.mock.calls.length === 1)).toBe(true);
  expect(buffer.destroy).toHaveBeenCalledTimes(1); expect(device.destroy).not.toHaveBeenCalled();
  hostGpu.dom.window.close();
});
it("reports device loss and cleans up a rejected initialization for fallback", async () => {
  const live = host(), failed = vi.fn();
  const stage = await createWebGpuThumbnailStage(live.document, live.engine);
  stage.onLost(failed); live.lose(); await Promise.resolve();
  expect(failed).toHaveBeenCalledTimes(1);
  expect(() => stage.upload({} as HTMLImageElement)).toThrow("unavailable");
  stage.destroy(); live.dom.window.close();
  const rejected = host(true);
  await expect(createWebGpuThumbnailStage(rejected.document, rejected.engine)).rejects.toThrow("Shader rejected");
  expect(rejected.context.unconfigure).toHaveBeenCalledTimes(1);
  expect(rejected.device.destroy).not.toHaveBeenCalled(); rejected.dom.window.close();
});
