import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import type { NetworkInterfaceInfo } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import { certificateNames, devCertificate, networkHttps, reachableFromNetwork, shouldPrintDevQr, type CertificateMaker } from "./networkHttps";

const folders: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});
const scratchFolder = () => {
  const build = path.resolve(import.meta.dirname, "../build");
  mkdirSync(build, { recursive: true });
  const folder = realpathSync(mkdtempSync(path.join(build, "network-https-")));
  folders.push(folder);
  return folder;
};
/** Writes recognisable files instead of running openssl. */
const fakeMaker = () => vi.fn<CertificateMaker>((dir, names, days) => {
  writeFileSync(path.join(dir, "key.pem"), "key");
  writeFileSync(path.join(dir, "cert.pem"), `cert for ${names.join(",")} (${days} days)`);
});
const DAY = 24 * 3600 * 1000;

describe("network https", () => {
  it("is for a server other devices reach, not one on this machine only", () => {
    for (const host of [true, "0.0.0.0", "::", "192.168.0.103", "my-mac.local"]) expect(reachableFromNetwork(host), String(host)).toBe(true);
    for (const host of [undefined, false, "", "localhost", "127.0.0.1", "::1"]) expect(reachableFromNetwork(host), String(host)).toBe(false);
  });

  it("names loopback, this machine and its IPv4 network addresses", () => {
    const interfaces = {
      lo0: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
      en0: [{ address: "fe80::1", family: "IPv6", internal: false }, { address: "192.168.0.103", family: "IPv4", internal: false }],
    } as unknown as NodeJS.Dict<NetworkInterfaceInfo[]>;
    expect(certificateNames(interfaces, "Studio")).toEqual(["DNS:localhost", "DNS:Studio", "DNS:Studio.local", "IP:127.0.0.1", "IP:::1", "IP:192.168.0.103"]);
    // A name a certificate cannot hold is left out, not guessed at.
    expect(certificateNames(interfaces, "Felipe's Mac")).toEqual(["DNS:localhost", "IP:127.0.0.1", "IP:::1", "IP:192.168.0.103"]);
  });

  it("keeps a certificate until it nears its end or lacks an address, and keeps the old addresses in a new one", () => {
    const dir = path.join(scratchFolder(), "certificate"), make = fakeMaker(), now = Date.UTC(2026, 9, 19);
    expect(devCertificate(dir, ["DNS:localhost", "IP:192.168.0.103"], now, make)).toEqual({ key: "key", cert: "cert for DNS:localhost,IP:192.168.0.103 (90 days)", made: true });
    expect(devCertificate(dir, ["IP:192.168.0.103"], now + DAY, make).made).toBe(false);
    expect(make).toHaveBeenCalledOnce();
    // Another network: the address a phone already accepted stays in.
    expect(devCertificate(dir, ["DNS:localhost", "IP:10.0.0.5"], now + 2 * DAY, make).cert).toBe("cert for DNS:localhost,IP:192.168.0.103,IP:10.0.0.5 (90 days)");
    expect(devCertificate(dir, ["IP:10.0.0.5"], now + 80 * DAY, make).made).toBe(false);
    expect(devCertificate(dir, ["IP:10.0.0.5"], now + 86 * DAY, make).made).toBe(true);
    expect(JSON.parse(readFileSync(path.join(dir, "certificate.json"), "utf8")).expiresAt).toBe(now + 176 * DAY);
  });

  it("defaults dev to LAN HTTPS, respects explicit hosts and leaves builds alone", () => {
    const dir = path.join(scratchFolder(), "certificate"), make = fakeMaker();
    const plugin = networkHttps({ dir, make, names: () => ["DNS:localhost"] }, {});
    const config = plugin.config as (config: object, env: object) => Record<string, { https?: { key: string; cert: string } }> | undefined;
    const serve = { command: "serve", mode: "development" };
    expect(config({}, serve)).toHaveProperty("server.host", true);
    expect(config({ server: { host: true } }, serve)).toEqual({ server: { https: { key: "key", cert: "cert for DNS:localhost (90 days)" } } });
    const logger = { info: vi.fn(), warn: vi.fn() };
    (plugin.configResolved as (config: object) => void)({ logger });
    expect(logger.info.mock.calls[0][0]).toContain("a browser warns once per address");
    expect(config({ preview: { host: "0.0.0.0" } }, { ...serve, isPreview: true })).toHaveProperty("preview.https.key", "key");
    expect(config({ server: { host: "0.0.0.0" } }, { ...serve, isPreview: true })).toHaveProperty("preview.https.key", "key");
    for (const [user, env] of [[{ server: { host: "localhost" } }, serve], [{ server: { host: true } }, { command: "build", mode: "production" }],
      [{ server: { host: true, https: { key: "own", cert: "own" } } }, serve]] as const) expect(config(user, env)).toBeUndefined();
  });

  it("keeps HTTP only when explicitly asked and fails clearly if TLS setup fails", () => {
    const dir = path.join(scratchFolder(), "certificate");
    const off = networkHttps({ dir, make: fakeMaker() }, { FOSS_EARTH_DEV_HTTPS: "off" });
    expect((off.config as (config: object, env: object) => unknown)({ server: { host: true } }, { command: "serve", mode: "development" })).toBeUndefined();
    const broken = networkHttps({ dir, names: () => ["DNS:localhost"], make: () => { throw new Error("spawnSync openssl ENOENT"); } }, {});
    expect(() => (broken.config as (config: object, env: object) => unknown)({}, { command: "serve", mode: "development" })).toThrow("Cannot start HTTPS development server (spawnSync openssl ENOENT)");
    expect(() => networkHttps({}, { FOSS_EARTH_DEV_HTTPS: "on" })).toThrow("FOSS_EARTH_DEV_HTTPS");
  });
  it("prints a QR for the actual network port and app page after Vite prints its URLs", async () => {
    const plugin = networkHttps({ path: "/tour/" }, { FOSS_EARTH_DEV_QR: "on" });
    const info = vi.fn(), original = vi.fn();
    const server = {
      printUrls: original,
      resolvedUrls: { local: [], network: ["https://192.168.1.20:9876/"] },
      config: { logger: { info, warn: vi.fn() } },
    };
    (plugin.configureServer as (server: object) => void)(server);
    server.printUrls();
    expect(original).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(info).toHaveBeenCalledOnce());
    expect(info.mock.calls[0][0]).toContain("▄");
    expect(info.mock.calls[0][0]).not.toContain("Scan to open");
  });

  it("shows QR art only in interactive terminals unless explicitly overridden", () => {
    expect(shouldPrintDevQr({}, true)).toBe(true);
    expect(shouldPrintDevQr({}, false)).toBe(false);
    expect(shouldPrintDevQr({ CI: "true" }, true)).toBe(false);
    expect(shouldPrintDevQr({ FOSS_EARTH_DEV_QR: "off" }, true)).toBe(false);
    expect(shouldPrintDevQr({ FOSS_EARTH_DEV_QR: "on", CI: "true" }, false)).toBe(true);
    expect(() => shouldPrintDevQr({ FOSS_EARTH_DEV_QR: "invalid" })).toThrow("FOSS_EARTH_DEV_QR");
  });

  it("uses background-colored cells in Apple Terminal to avoid half-block seams", async () => {
    const plugin = networkHttps({}, { FOSS_EARTH_DEV_QR: "on", TERM_PROGRAM: "Apple_Terminal" });
    const info = vi.fn();
    const server = {
      printUrls: vi.fn(),
      resolvedUrls: { local: [], network: ["https://192.168.1.20:9876/"] },
      config: { logger: { info, warn: vi.fn() } },
    };
    (plugin.configureServer as (server: object) => void)(server);
    server.printUrls();
    await vi.waitFor(() => expect(info).toHaveBeenCalledOnce());
    const art = info.mock.calls[0][0] as string;
    expect(art).toContain("\u001b[40m  \u001b[0m");
    expect(art).toContain("\u001b[47m  \u001b[0m");
    expect(art).not.toMatch(/[▀▄█]/);
  });

  it("preserves the app network link without generating QR art for agents", async () => {
    const plugin = networkHttps({ path: "/fly/" }, { FOSS_EARTH_DEV_QR: "off" });
    const info = vi.fn(), warn = vi.fn(), original = vi.fn();
    const server = {
      printUrls: original,
      resolvedUrls: { local: [], network: ["https://192.168.1.20:7470/"] },
      config: { logger: { info, warn } },
    };
    (plugin.configureServer as (server: object) => void)(server);
    server.printUrls();
    await Promise.resolve();
    expect(original).toHaveBeenCalledOnce();
    expect(info).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });


  it.each(["/fly/", "/app/", "/tour/"])("prints the key in local/network %s URLs and encodes the identical network URL in the QR", async appPath => {
    const root = scratchFolder();
    writeFileSync(path.join(root, ".env.local"), 'GOOGLE_3D_TILES_KEY="synthetic-dev-key"\n');
    const plugin = networkHttps({ path: appPath, keyFiles: [path.join(root, ".env.local")] }, {
      FOSS_EARTH_DEV_HTTPS: "off", FOSS_EARTH_DEV_GKEY: "on", FOSS_EARTH_DEV_QR: "on",
    });
    (plugin.config as (config: object, env: object) => unknown)({}, { command: "serve" });
    const info = vi.fn();
    (plugin.configResolved as (config: object) => void)({ root, logger: { info } });
    const qr = createRequire(import.meta.url)("qrcode") as { toString(text: string, options: object): Promise<string> };
    const encoded = vi.spyOn(qr, "toString").mockResolvedValue("synthetic-qr");
    const originalUrls = {
      local: ["https://localhost:9876/", "https://host.local:9876/"],
      network: ["https://192.168.1.20:9876/"], networkInterfaceNames: ["en0"],
    };
    const printed = vi.fn();
    const server = {
      resolvedUrls: originalUrls,
      printUrls() { printed(structuredClone(this.resolvedUrls)); },
      config: { logger: { info, warn: vi.fn() } },
    };
    (plugin.configureServer as (server: object) => void)(server);
    server.printUrls();
    expect(printed).toHaveBeenCalledExactlyOnceWith({
      local: [`https://localhost:9876${appPath}?gkey=synthetic-dev-key`, `https://host.local:9876${appPath}?gkey=synthetic-dev-key`],
      network: [`https://192.168.1.20:9876${appPath}?gkey=synthetic-dev-key`], networkInterfaceNames: ["en0"],
    });
    expect(server.resolvedUrls).toBe(originalUrls);
    expect(encoded).toHaveBeenCalledExactlyOnceWith(`https://192.168.1.20:9876${appPath}?gkey=synthetic-dev-key`, { type: "terminal", small: true });
    await vi.waitFor(() => expect(info).toHaveBeenCalledExactlyOnceWith("synthetic-qr"));
    expect(plugin.transformIndexHtml).toBeUndefined();
  });

  it("omits the key for llm-dev, opt-out, build, preview, direct Vite, and missing configuration", () => {
    for (const [command, isPreview, setting, key] of [
      ["serve", false, "off", "synthetic-key"], ["build", false, "on", "synthetic-key"],
      ["serve", true, "on", "synthetic-key"], ["serve", false, undefined, "synthetic-key"],
      ["serve", false, "on", undefined],
    ] as const) {
      const plugin = networkHttps({ path: "/fly/", keyFiles: [] }, {
        FOSS_EARTH_DEV_HTTPS: "off", FOSS_EARTH_DEV_GKEY: setting,
        FOSS_EARTH_DEV_QR: "off", GOOGLE_3D_TILES_KEY: key,
      });
      (plugin.config as (config: object, env: object) => unknown)({}, { command, isPreview });
      (plugin.configResolved as (config: object) => void)({ root: scratchFolder(), logger: { info: vi.fn() } });
      const printed = vi.fn();
      const server = {
        resolvedUrls: { local: ["https://localhost:7470/"], network: [] as string[] },
        printUrls() { printed(structuredClone(this.resolvedUrls)); },
        config: { logger: { info: vi.fn() } },
      };
      (plugin.configureServer as (server: object) => void)(server);
      server.printUrls();
      expect(printed).toHaveBeenCalledExactlyOnceWith({ local: ["https://localhost:7470/fly/"], network: [] });
    }
  });

  it("URL-encodes the environment key without creating additional parameters", () => {
    const plugin = networkHttps({ keyFiles: [] }, {
      FOSS_EARTH_DEV_HTTPS: "off", FOSS_EARTH_DEV_GKEY: "on", FOSS_EARTH_DEV_QR: "off",
      GOOGLE_3D_TILES_KEY: "test+/&=?",
    });
    (plugin.config as (config: object, env: object) => unknown)({}, { command: "serve" });
    (plugin.configResolved as (config: object) => void)({ root: scratchFolder(), logger: { info: vi.fn() } });
    const printed = vi.fn();
    const server = {
      resolvedUrls: { local: ["https://localhost:3600/app/?scene=retained"], network: [] as string[] },
      printUrls() { printed(structuredClone(this.resolvedUrls)); },
      config: { logger: { info: vi.fn() } },
    };
    (plugin.configureServer as (server: object) => void)(server);
    server.printUrls();
    expect(printed).toHaveBeenCalledExactlyOnceWith({
      local: ["https://localhost:3600/app/?scene=retained&gkey=test%2B%2F%26%3D%3F"], network: [],
    });
  });
});
