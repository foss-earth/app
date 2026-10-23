import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Start the project's Vite CLI in this process, preserving its shortcuts and signals. */
export async function startDevServer(argv = process.argv.slice(2)) {
  // Vite rejects unknown flags before loading plugins. Consume ours here.
  if (argv.includes("--no-qr")) process.env.FOSS_EARTH_DEV_QR = "off";
  process.env.FOSS_EARTH_DEV_GKEY = argv.includes("--no-gkey") || argv.includes("--no-key") ? "off" : "on";
  const args = argv.filter(arg => !["--no-qr", "--no-gkey", "--no-key"].includes(arg));
  const require = createRequire(path.resolve("package.json"));
  const vite = path.join(path.dirname(require.resolve("vite/package.json")), "bin/vite.js");
  process.argv = [process.execPath, vite, "--configLoader", "native", ...args];
  if (args.includes("--help") || args.includes("-h")) {
    console.log("App dev options:\n  --no-qr    Omit the terminal QR code.\n  --no-gkey  Skip the Google 3D Tiles key from the environment/.env.local (--no-key also works).\n");
  }
  await import(pathToFileURL(vite).href);
}
