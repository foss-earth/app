import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import type { NetworkInterfaceInfo } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { certificateNames, devCertificate, networkHttps, reachableFromNetwork, type CertificateMaker } from "./networkHttps";

const folders: string[] = [];
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); });
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

  it("serves https only where other devices reach the server, and says so", () => {
    const dir = path.join(scratchFolder(), "certificate"), make = fakeMaker();
    const plugin = networkHttps({ dir, make, names: () => ["DNS:localhost"] }, {});
    const config = plugin.config as (config: object, env: object) => Record<string, { https?: { key: string; cert: string } }> | undefined;
    const serve = { command: "serve", mode: "development" };
    expect(config({ server: { host: true } }, serve)).toEqual({ server: { https: { key: "key", cert: "cert for DNS:localhost (90 days)" } } });
    const logger = { info: vi.fn(), warn: vi.fn() };
    (plugin.configResolved as (config: object) => void)({ logger });
    expect(logger.info.mock.calls[0][0]).toContain("a browser warns once per address");
    expect(config({ preview: { host: "0.0.0.0" } }, { ...serve, isPreview: true })).toHaveProperty("preview.https.key", "key");
    expect(config({ server: { host: "0.0.0.0" } }, { ...serve, isPreview: true })).toHaveProperty("preview.https.key", "key");
    for (const [user, env] of [[{}, serve], [{ server: { host: "localhost" } }, serve], [{ server: { host: true } }, { command: "build", mode: "production" }],
      [{ server: { host: true, https: { key: "own", cert: "own" } } }, serve]] as const) expect(config(user, env)).toBeUndefined();
  });

  it("keeps http when asked, or when no certificate can be made, and refuses unknown values", () => {
    const dir = path.join(scratchFolder(), "certificate");
    const off = networkHttps({ dir, make: fakeMaker() }, { FOSS_EARTH_DEV_HTTPS: "off" });
    expect((off.config as (config: object, env: object) => unknown)({ server: { host: true } }, { command: "serve", mode: "development" })).toBeUndefined();
    const broken = networkHttps({ dir, names: () => ["DNS:localhost"], make: () => { throw new Error("spawnSync openssl ENOENT"); } }, {});
    expect((broken.config as (config: object, env: object) => unknown)({ server: { host: true } }, { command: "serve", mode: "development" })).toBeUndefined();
    const logger = { info: vi.fn(), warn: vi.fn() };
    (broken.configResolved as (config: object) => void)({ logger });
    expect(logger.warn.mock.calls[0][0]).toContain("No https for other devices (spawnSync openssl ENOENT)");
    expect(() => networkHttps({}, { FOSS_EARTH_DEV_HTTPS: "on" })).toThrow("FOSS_EARTH_DEV_HTTPS");
  });
});
