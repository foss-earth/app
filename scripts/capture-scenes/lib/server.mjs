// A static server for one build at /app/, on the loopback interface only,
// owned by the capture and closed with it. It sends no isolation headers: the
// build's own service worker isolates the page as it does when deployed.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".avif": "image/avif", ".ico": "image/x-icon", ".wasm": "application/wasm", ".bin": "application/octet-stream",
  ".ktx2": "image/ktx2", ".glb": "model/gltf-binary", ".txt": "text/plain; charset=utf-8", ".map": "application/json",
  ".woff2": "font/woff2", ".woff": "font/woff",
};

export async function serveBuild(directory, { port = 0, base = "/app/" } = {}) {
  const root = path.resolve(directory);
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (url.pathname === "/" || url.pathname === base.slice(0, -1)) {
        response.writeHead(302, { location: base }).end();
        return;
      }
      if (!url.pathname.startsWith(base)) { response.writeHead(404).end(); return; }
      let file = path.resolve(root, "." + decodeURIComponent(url.pathname.slice(base.length - 1)));
      if (file !== root && !file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
      let info = await stat(file).catch(() => null);
      if (info?.isDirectory()) { file = path.join(file, "index.html"); info = await stat(file).catch(() => null); }
      if (!info?.isFile()) { response.writeHead(404).end(); return; }
      response.writeHead(200, {
        "content-type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
        "content-length": info.size, "cache-control": "no-cache",
      });
      if (request.method === "HEAD") { response.end(); return; }
      createReadStream(file).pipe(response);
    } catch {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const sockets = new Set();
  server.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  return {
    // localhost, not 127.0.0.1: a browser key restricted to local pages names localhost.
    origin: `http://localhost:${server.address().port}`,
    close: () => new Promise(resolve => {
      for (const socket of sockets) socket.destroy();
      server.close(() => resolve());
    }),
  };
}
