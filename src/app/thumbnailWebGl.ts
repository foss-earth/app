import { thumbnailCoverBounds } from "./thumbnailOcclusion";
import type { ThumbnailStage } from "./thumbnailProjection";

const VERTEX = `attribute vec2 position; uniform float depth; void main(){ gl_Position=vec4(position,depth,1.); }`;
const MASK = `precision highp float;
uniform vec4 cover0, cover1, radii, target;
bool inside(vec2 pos, vec4 box, float radius) {
  vec2 q = max(abs(pos - box.xy - box.zw * .5) - box.zw * .5 + vec2(radius), vec2(0.));
  return box.z > 0. && box.w > 0. && dot(q, q) <= radius * radius;
}
void main(){
  vec2 pos = vec2(gl_FragCoord.x, target.y - gl_FragCoord.y);
  if (!inside(pos, cover0, radii.x) && !inside(pos, cover1, radii.y)) discard;
  gl_FragColor = vec4(0.);
}`;
export const THUMBNAIL_GLSL = /* glsl */ `
precision highp float;
uniform sampler2D sheet;
uniform vec4 forward, right, up, strip, target;
uniform vec2 sheetSize;
void main() {
  vec2 xy = vec2(gl_FragCoord.x, target.y - gl_FragCoord.y) / target.xy;
  vec3 ray = forward.xyz + right.xyz * (2. * xy.x - 1.) + up.xyz * (1. - 2. * xy.y);
  vec3 a = abs(ray);
  float face, along, sc, tc;
  if (a.x >= a.y && a.x >= a.z) {
    face = ray.x >= 0. ? 0. : 1.; along = a.x; sc = ray.x >= 0. ? -ray.y : ray.y; tc = ray.z;
  } else if (a.y >= a.z) {
    face = ray.y >= 0. ? 2. : 3.; along = a.y; sc = ray.y >= 0. ? ray.x : -ray.x; tc = ray.z;
  } else {
    face = ray.z >= 0. ? 4. : 5.; along = a.z; sc = ray.x; tc = ray.z >= 0. ? -ray.y : ray.y;
  }
  vec2 uv = clamp(vec2(sc / along + 1., 1. - tc / along) * .5, 0., 1.);
  vec2 texel = floor(strip.xy + vec2(face * strip.z, 0.) + uv * (strip.z - 1.) + .5);
  gl_FragColor = vec4(texture2D(sheet, (texel + .5) / sheetSize).rgb, 1.);
}`;

/** One staging context for the whole catalog on WebGL hosts, never one per photograph. */
export function createWebGlThumbnailStage(document: Document): ThumbnailStage<WebGLTexture> {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl", { alpha: false, antialias: false, depth: true, stencil: false, preserveDrawingBuffer: false });
  if (!gl) throw Error("WebGL preview unavailable");
  const shaders: WebGLShader[] = [];
  let program: WebGLProgram | null = null, maskProgram: WebGLProgram | null = null, buffer: WebGLBuffer | null = null;
  try {
    const shader = (type: number, code: string) => {
      const value = gl.createShader(type);
      if (!value) throw Error("Thumbnail shader allocation failed");
      shaders.push(value); gl.shaderSource(value, code); gl.compileShader(value);
      if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(value) ?? "Thumbnail shader failed");
      return value;
    };
    program = gl.createProgram();
    if (!program) throw Error("Thumbnail program allocation failed");
    gl.attachShader(program, shader(gl.VERTEX_SHADER, VERTEX)); gl.attachShader(program, shader(gl.FRAGMENT_SHADER, THUMBNAIL_GLSL));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program) ?? "Thumbnail shader link failed");
    maskProgram = gl.createProgram();
    if (!maskProgram) throw Error("Thumbnail mask allocation failed");
    gl.attachShader(maskProgram, shader(gl.VERTEX_SHADER, VERTEX)); gl.attachShader(maskProgram, shader(gl.FRAGMENT_SHADER, MASK));
    gl.linkProgram(maskProgram);
    if (!gl.getProgramParameter(maskProgram, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(maskProgram) ?? "Thumbnail mask failed");
    gl.useProgram(program);
    buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "position"); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const uniforms = ["forward", "right", "up", "strip", "target"].map(name => gl.getUniformLocation(program!, name));
    const maskUniforms = ["target", "cover0", "cover1", "radii"].map(name => gl.getUniformLocation(maskProgram!, name));
    const maskPosition = gl.getAttribLocation(maskProgram, "position");
    const maskDepth = gl.getUniformLocation(maskProgram, "depth"), imageDepth = gl.getUniformLocation(program, "depth");
    const size = gl.getUniformLocation(program, "sheetSize");
    const textures = new Map<WebGLTexture, readonly [number, number]>(), listeners = new Set<() => void>();
    const onLost = (event: Event) => { event.preventDefault(); for (const listener of [...listeners]) listener(); };
    canvas.addEventListener("webglcontextlost", onLost);
    let dead = false;
    return {
      upload(image) {
        const texture = gl.createTexture();
        if (!texture) throw Error("Thumbnail texture allocation failed");
        try {
          gl.bindTexture(gl.TEXTURE_2D, texture);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
          if (gl.getError() !== gl.NO_ERROR) throw Error("Thumbnail upload failed");
          textures.set(texture, [image.naturalWidth, image.naturalHeight]); return texture;
        } catch (error) { gl.deleteTexture(texture); throw error; }
      },
      draw(texture, values, width, height) {
        if (dead || gl.isContextLost()) throw Error("Thumbnail context lost");
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        gl.viewport(0, 0, width, height);
        gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.clearDepth(1); gl.clear(gl.DEPTH_BUFFER_BIT);
        const bounds = thumbnailCoverBounds(values, width, height);
        if (bounds) {
          gl.enable(gl.SCISSOR_TEST); gl.scissor(bounds[0], height - bounds[1] - bounds[3], bounds[2], bounds[3]);
          gl.useProgram(maskProgram); gl.uniform1f(maskDepth, -1);
          gl.enableVertexAttribArray(maskPosition); gl.vertexAttribPointer(maskPosition, 2, gl.FLOAT, false, 0, 0);
          maskUniforms.forEach((uniform, i) => gl.uniform4fv(uniform, values.subarray(16 + i * 4, 20 + i * 4)));
          gl.depthFunc(gl.ALWAYS); gl.colorMask(false, false, false, false); gl.drawArrays(gl.TRIANGLES, 0, 3);
        }
        gl.disable(gl.SCISSOR_TEST);
        gl.useProgram(program); gl.uniform1f(imageDepth, 0);
        gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
        gl.depthFunc(gl.LESS); gl.depthMask(false); gl.colorMask(true, true, true, true);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        uniforms.forEach((uniform, i) => gl.uniform4fv(uniform, values.subarray(i * 4, i * 4 + 4)));
        const dimensions = textures.get(texture)!; gl.uniform2f(size, dimensions[0], dimensions[1]);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        return canvas;
      },
      release(texture) { textures.delete(texture); gl.deleteTexture(texture); },
      onLost(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      destroy() { if (dead) return; dead = true; listeners.clear(); canvas.removeEventListener("webglcontextlost", onLost); gl.deleteBuffer(buffer); gl.deleteProgram(program); gl.deleteProgram(maskProgram); for (const value of shaders) gl.deleteShader(value); gl.getExtension("WEBGL_lose_context")?.loseContext(); canvas.width = canvas.height = 0; },
    };
  } catch (error) { gl.deleteBuffer(buffer); gl.deleteProgram(program); gl.deleteProgram(maskProgram); for (const value of shaders) gl.deleteShader(value); gl.getExtension("WEBGL_lose_context")?.loseContext(); throw error; }
}
