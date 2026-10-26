// The captured PNG: a small reader (Chrome's screenshots are 8-bit RGB or
// RGBA, not interlaced), measurements that show a picture is not blank and
// where its Sun is, and the compact encodings.
import { execFile } from "node:child_process";
import { readFile, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { deflateSync, inflateSync } from "node:zlib";

export function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error("Not a PNG");
  let offset = 8, width = 0, height = 0, colorType = 0;
  const data = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset), type = buffer.toString("latin1", offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4); colorType = body[9];
      if (body[8] !== 8 || ![2, 6].includes(colorType) || body[12] !== 0) throw new Error("Only 8-bit, non-interlaced RGB or RGBA PNGs are read");
    } else if (type === "IDAT") data.push(body);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  const channels = colorType === 6 ? 4 : 3, stride = width * channels;
  const raw = inflateSync(Buffer.concat(data));
  const rgba = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride), row = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? row[x - channels] : 0, b = previous[x], c = x >= channels ? previous[x - channels] : 0;
      let predictor = 0;
      if (filter === 1) predictor = a;
      else if (filter === 2) predictor = b;
      else if (filter === 3) predictor = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      row[x] = (line[x] + predictor) & 255;
    }
    for (let x = 0; x < width; x++) {
      const to = (y * width + x) * 4, from = x * channels;
      rgba[to] = row[from]; rgba[to + 1] = row[from + 1]; rgba[to + 2] = row[from + 2]; rgba[to + 3] = channels === 4 ? row[from + 3] : 255;
    }
    [previous, row] = [row, previous];
  }
  return { width, height, rgba };
}

/** A rectangle of a decoded picture. */
export function cropImage({ width, rgba }, { x, y, width: w, height: h }) {
  const out = new Uint8Array(w * h * 4);
  for (let row = 0; row < h; row++) out.set(rgba.subarray(((y + row) * width + x) * 4, ((y + row) * width + x + w) * 4), row * w * 4);
  return { width: w, height: h, rgba: out };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
/** An 8-bit RGB PNG of a decoded picture (its alpha dropped: screenshots are opaque). */
export function encodePng({ width, height, rgba }) {
  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const from = (y * width + x) * 4, to = y * (width * 3 + 1) + 1 + x * 3;
    raw[to] = rgba[from]; raw[to + 1] = rgba[from + 1]; raw[to + 2] = rgba[from + 2];
  }
  const chunk = (type, body) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, "latin1");
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
    return Buffer.concat([head, body, tail]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

/**
 * Brightness statistics, and the Sun as the centroid of the brightest pixels:
 * a check against the predicted place, and that the frame is not blank.
 */
export function analyse({ width, height, rgba }) {
  const luma = new Float32Array(width * height);
  let sum = 0, sumSquares = 0, black = 0, clipped = 0, max = 0;
  for (let i = 0; i < width * height; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    luma[i] = y; sum += y; sumSquares += y * y;
    if (y < 6) black++;
    if (r >= 254 || g >= 254 || b >= 254) clipped++;
    if (y > max) max = y;
  }
  const n = width * height, mean = sum / n;
  let sx = 0, sy = 0, count = 0, minX = width, minY = height, maxX = 0, maxY = 0;
  const threshold = Math.max(200, max - 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (luma[y * width + x] < threshold) continue;
    sx += x; sy += y; count++;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  // Mean brightness of each tenth of the picture from the top: the sky above, the Earth below.
  const bands = Array.from({ length: 10 }, (_, band) => {
    let total = 0, pixels = 0;
    for (let y = Math.floor((band * height) / 10); y < Math.floor(((band + 1) * height) / 10); y++) for (let x = 0; x < width; x++) { total += luma[y * width + x]; pixels++; }
    return Math.round((total / pixels) * 10) / 10;
  });
  return {
    meanLuma: Math.round(mean * 10) / 10, lumaStdDev: Math.round(Math.sqrt(Math.max(0, sumSquares / n - mean * mean)) * 10) / 10,
    nearBlackFraction: Math.round((black / n) * 1000) / 1000, clippedFraction: Math.round((clipped / n) * 10000) / 10000,
    maxLuma: Math.round(max), rowBandMeans: bands,
    brightest: count ? { x: Math.round(sx / count), y: Math.round(sy / count), pixels: count, box: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }, threshold: Math.round(threshold) } : null,
  };
}

/**
 * The Sun's disc near where it is predicted: the centroid of the brightest
 * pixels in a window around that place. The whole picture's brightest pixels
 * can be the air's edge instead once the exposure brings it up.
 */
export function measureSun({ width, height, rgba }, predicted, radiusPx) {
  if (!predicted?.inFrame) return null;
  const x0 = Math.max(0, Math.floor(predicted.x - radiusPx)), x1 = Math.min(width - 1, Math.ceil(predicted.x + radiusPx));
  const y0 = Math.max(0, Math.floor(predicted.y - radiusPx)), y1 = Math.min(height - 1, Math.ceil(predicted.y + radiusPx));
  const lumaAt = (x, y) => { const i = (y * width + x) * 4; return 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2]; };
  let max = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) max = Math.max(max, lumaAt(x, y));
  const threshold = Math.max(200, max - 4);
  if (max < threshold) return { found: false, maxLuma: Math.round(max), windowPx: radiusPx };
  let sx = 0, sy = 0, count = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (lumaAt(x, y) >= threshold) { sx += x; sy += y; count++; }
  const x = sx / count, y = sy / count;
  return { found: true, x: Math.round(x), y: Math.round(y), pixels: count, diameterPx: Math.round(2 * Math.sqrt(count / Math.PI) * 10) / 10,
    offsetPx: Math.round(Math.hypot(x - predicted.x, y - predicted.y) * 10) / 10, windowPx: radiusPx };
}

function run(command, args) {
  return new Promise((resolve, reject) => execFile(command, args, { timeout: 120_000 }, (error, stdout, stderr) => error ? reject(new Error(`${command} failed: ${stderr || error.message}`)) : resolve(stdout)));
}

export async function hasCommand(command) {
  try { await run("/usr/bin/which", [command]); return true; } catch { return false; }
}

/** WebP with libwebp's cwebp: the sharp RGB→YUV conversion keeps thin coloured edges, such as the air's. */
export async function encodeWebp(png, out, quality) {
  if (!(await hasCommand("cwebp"))) throw new Error("cwebp not found: install libwebp (macOS: brew install webp)");
  await run("cwebp", ["-quiet", "-q", String(quality), "-m", "6", "-sharp_yuv", "-metadata", "none", png, "-o", out]);
  return (await stat(out)).size;
}

/** The WebP decoded back to PNG, to inspect what the page will show at full size. */
export async function decodeWebp(webp, out) {
  if (!(await hasCommand("dwebp"))) return false;
  await run("dwebp", ["-quiet", webp, "-o", out]);
  return true;
}

/** JPEG with macOS sips when present, otherwise the app's jpeg-js. */
export async function encodeJpeg(png, out, quality, appRoot) {
  if (process.platform === "darwin" && (await hasCommand("sips"))) {
    await run("sips", ["-s", "format", "jpeg", "-s", "formatOptions", String(quality), png, "--out", out]);
  } else {
    const jpeg = createRequire(`${appRoot}/package.json`)("jpeg-js");
    const { width, height, rgba } = decodePng(await readFile(png));
    await writeFile(out, jpeg.encode({ data: Buffer.from(rgba), width, height }, quality).data);
  }
  return (await stat(out)).size;
}
