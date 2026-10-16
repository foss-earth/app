import { thumbnailCoverBounds } from "./thumbnailOcclusion";
/** Native WGSL: no GLSL translators, compute libraries or additional GPUDevice. */
import type { AbstractEngine, WebGPUEngine } from "@babylonjs/core";
import { BufferUsage, TextureUsage } from "@babylonjs/core/Engines/WebGPU/webgpuConstants.js";
import type { ThumbnailStage } from "./thumbnailProjection";

export const THUMBNAIL_WGSL = /* wgsl */ `
struct Params { forward: vec4f, right: vec4f, up: vec4f, sheet: vec4f, target: vec4f, cover0: vec4f, cover1: vec4f, radii: vec4f }
@group(0) @binding(0) var<uniform> p: Params;
@group(0) @binding(1) var sheet: texture_2d<f32>;
fn position(index: u32, depth: f32) -> vec4f {
  let x = f32((index << 1u) & 2u);
  let y = f32(index & 2u);
  return vec4f(x * 2.0 - 1.0, y * 2.0 - 1.0, depth, 1.0);
}
@vertex fn vertex(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f { return position(index, 0.5); }
@vertex fn maskVertex(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f { return position(index, 0.0); }
fn inside(pos: vec2f, box: vec4f, radius: f32) -> bool {
  let q = max(abs(pos - box.xy - box.zw * 0.5) - box.zw * 0.5 + vec2f(radius), vec2f(0.0));
  return box.z > 0.0 && box.w > 0.0 && dot(q, q) <= radius * radius;
}
@fragment fn mask(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  if (!inside(pos.xy, p.cover0, p.radii.x) && !inside(pos.xy, p.cover1, p.radii.y)) { discard; }
  return vec4f(0.0);
}
@fragment fn fragment(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let xy = pos.xy / p.target.xy;
  let ray = p.forward.xyz + p.right.xyz * (2.0 * xy.x - 1.0) + p.up.xyz * (1.0 - 2.0 * xy.y);
  let a = abs(ray);
  var face: f32; var along: f32; var sc: f32; var tc: f32;
  if (a.x >= a.y && a.x >= a.z) {
    face = select(1.0, 0.0, ray.x >= 0.0); along = a.x;
    sc = select(ray.y, -ray.y, ray.x >= 0.0); tc = ray.z;
  } else if (a.y >= a.z) {
    face = select(3.0, 2.0, ray.y >= 0.0); along = a.y;
    sc = select(-ray.x, ray.x, ray.y >= 0.0); tc = ray.z;
  } else {
    face = select(5.0, 4.0, ray.z >= 0.0); along = a.z;
    sc = ray.x; tc = select(ray.y, -ray.y, ray.z >= 0.0);
  }
  let uv = clamp(vec2f(sc / along + 1.0, 1.0 - tc / along) * 0.5, vec2f(0.0), vec2f(1.0));
  let texel = vec2i(floor(p.sheet.xy + vec2f(face * p.sheet.z, 0.0) + uv * (p.sheet.z - 1.0) + 0.5));
  return vec4f(textureLoad(sheet, texel, 0).rgb, 1.0);
}`;

export async function createWebGpuThumbnailStage(document: Document, engine: AbstractEngine): Promise<ThumbnailStage<GPUTexture>> {
  const device = (engine as WebGPUEngine)._device;
  if (!engine.isWebGPU || !device) throw Error("No host WebGPU device");
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("webgpu") as GPUCanvasContext | null;
  if (!context) throw Error("WebGPU canvas unavailable");
  const format = document.defaultView!.navigator.gpu!.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "opaque" });
  let buffer: GPUBuffer | null = null;
  try {
    const module = device.createShaderModule({ label: "scene-thumbnail", code: THUMBNAIL_WGSL });
    const pipeline = await device.createRenderPipelineAsync({ label: "scene-thumbnail", layout: "auto",
      vertex: { module, entryPoint: "vertex" }, fragment: { module, entryPoint: "fragment", targets: [{ format }] }, primitive: { topology: "triangle-list" }, depthStencil: { format: "depth24plus", depthWriteEnabled: false, depthCompare: "less" } });
    const maskPipeline = await device.createRenderPipelineAsync({ label: "scene-thumbnail-occlusion", layout: device.createPipelineLayout({ bindGroupLayouts: [pipeline.getBindGroupLayout(0)] }),
      vertex: { module, entryPoint: "maskVertex" }, fragment: { module, entryPoint: "mask", targets: [{ format, writeMask: 0 }] }, primitive: { topology: "triangle-list" },
      depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "always" } });
    buffer = device.createBuffer({ label: "scene-thumbnail-camera", size: 128, usage: BufferUsage.Uniform | BufferUsage.CopyDst, mappedAtCreation: false });
    const uniform = buffer;
    const groups = new Map<GPUTexture, GPUBindGroup>();
    let depth: GPUTexture | null = null;
    const state = { dead: false, lost: false, listeners: new Set<() => void>() };
    const weak = new WeakRef(state);
    void device.lost.then(() => {
      const current = weak.deref();
      if (!current || current.dead) return;
      current.lost = true;
      for (const listener of [...current.listeners]) listener();
    });
    return {
      upload(image) {
        if (state.dead || state.lost) throw Error("Thumbnail device unavailable");
        const texture = device.createTexture({ label: "scene-thumbnail-sheet", size: [image.naturalWidth, image.naturalHeight, 1], format: "rgba8unorm",
          usage: TextureUsage.TextureBinding | TextureUsage.CopyDst | TextureUsage.RenderAttachment });
        try {
          device.queue.copyExternalImageToTexture({ source: image, flipY: false }, { texture, colorSpace: "srgb" }, [image.naturalWidth, image.naturalHeight, 1]);
          groups.set(texture, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
            { binding: 0, resource: { buffer: uniform } }, { binding: 1, resource: texture.createView() },
          ] }));
          return texture;
        } catch (error) { texture.destroy(); throw error; }
      },
      draw(texture, values, width, height) {
        if (state.dead || state.lost) throw Error("Thumbnail device unavailable");
        if (!depth || canvas.width !== width || canvas.height !== height) {
          depth?.destroy(); canvas.width = width; canvas.height = height;
          depth = device.createTexture({ label: "scene-thumbnail-depth", size: [width, height, 1], format: "depth24plus", usage: TextureUsage.RenderAttachment });
        }
        device.queue.writeBuffer(uniform, 0, values as Float32Array<ArrayBuffer>);
        const encoder = device.createCommandEncoder({ label: "scene-thumbnail-frame" });
        const pass = encoder.beginRenderPass({ colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } }], depthStencilAttachment: { view: depth.createView(), depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "discard" } });
        pass.setBindGroup(0, groups.get(texture)!);
        const bounds = thumbnailCoverBounds(values, width, height);
        if (bounds) { pass.setScissorRect(...bounds); pass.setPipeline(maskPipeline); pass.draw(3); pass.setScissorRect(0, 0, width, height); }
        pass.setPipeline(pipeline); pass.draw(3); pass.end();
        device.queue.submit([encoder.finish()]);
        return canvas;
      },
      release(texture) { groups.delete(texture); texture.destroy(); },
      onLost(listener) { state.listeners.add(listener); return () => state.listeners.delete(listener); },
      destroy() { if (state.dead) return; state.dead = true; state.listeners.clear(); groups.clear(); depth?.destroy(); uniform.destroy(); context.unconfigure(); canvas.width = canvas.height = 0; },
    };
  } catch (error) { buffer?.destroy(); context.unconfigure(); throw error; }
}
