import { JSDOM } from "jsdom";
import { expect, it, vi } from "vitest";
import { createWebGlThumbnailStage } from "./thumbnailWebGl";
it("uses one WebGL context, masks depth before projection and releases its own resources", () => {
  const dom = new JSDOM(), document = dom.window.document;
  const program = [{ id: "image" }, { id: "mask" }]; let programs = 0;
  const gl = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4, ARRAY_BUFFER: 5, STATIC_DRAW: 6, FLOAT: 7,
    TEXTURE_2D: 8, TEXTURE_MIN_FILTER: 9, TEXTURE_MAG_FILTER: 10, NEAREST: 11, TEXTURE_WRAP_S: 12, TEXTURE_WRAP_T: 13, CLAMP_TO_EDGE: 14,
    UNPACK_FLIP_Y_WEBGL: 15, RGBA: 16, UNSIGNED_BYTE: 17, DEPTH_TEST: 18, DEPTH_BUFFER_BIT: 19, ALWAYS: 20, LESS: 21, TRIANGLES: 22, NO_ERROR: 0, SCISSOR_TEST: 23,
    createShader: vi.fn(() => ({})), shaderSource: vi.fn(), compileShader: vi.fn(), getShaderParameter: vi.fn(() => true),
    createProgram: vi.fn(() => program[programs++]), attachShader: vi.fn(), linkProgram: vi.fn(), getProgramParameter: vi.fn(() => true), useProgram: vi.fn(),
    createBuffer: vi.fn(() => ({})), bindBuffer: vi.fn(), bufferData: vi.fn(), getAttribLocation: vi.fn(() => 0), enableVertexAttribArray: vi.fn(), vertexAttribPointer: vi.fn(),
    getUniformLocation: vi.fn((_program, name) => name), createTexture: vi.fn(() => ({})), bindTexture: vi.fn(), texParameteri: vi.fn(), pixelStorei: vi.fn(), texImage2D: vi.fn(), getError: vi.fn(() => 0),
    viewport: vi.fn(), scissor: vi.fn(), disable: vi.fn(), enable: vi.fn(), depthMask: vi.fn(), clearDepth: vi.fn(), clear: vi.fn(), uniform1f: vi.fn(), uniform2f: vi.fn(), uniform4fv: vi.fn(),
    depthFunc: vi.fn(), colorMask: vi.fn(), drawArrays: vi.fn(), isContextLost: vi.fn(() => false),
    deleteTexture: vi.fn(), deleteBuffer: vi.fn(), deleteProgram: vi.fn(), deleteShader: vi.fn(), getExtension: vi.fn(() => null),
  };
  const context = vi.spyOn(dom.window.HTMLCanvasElement.prototype, "getContext").mockReturnValue(gl as unknown as CanvasRenderingContext2D);
  const stage = createWebGlThumbnailStage(document);
  const texture = stage.upload({ naturalWidth: 384, naturalHeight: 64 } as HTMLImageElement);
  const uniforms = new Float32Array(32); uniforms[22] = 70; uniforms[23] = 16;
  gl.useProgram.mockClear();
  stage.draw(texture, uniforms, 88, 88);
  expect(gl.useProgram.mock.calls.map(call => call[0])).toEqual([program[1], program[0]]);
  expect(gl.colorMask.mock.calls).toEqual([[false, false, false, false], [true, true, true, true]]);
  expect(gl.depthFunc.mock.calls).toEqual([[gl.ALWAYS], [gl.LESS]]);
  expect(gl.scissor).toHaveBeenCalledWith(0, 72, 70, 16);
  expect(gl.drawArrays).toHaveBeenCalledTimes(2);
  stage.draw(texture, uniforms, 88, 88); expect(context).toHaveBeenCalledTimes(1);
  stage.release(texture); stage.destroy(); stage.destroy();
  expect(gl.deleteTexture).toHaveBeenCalledTimes(1); expect(gl.deleteProgram).toHaveBeenCalledTimes(2);
  dom.window.close();
});
