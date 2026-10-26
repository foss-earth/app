/** Shared LAN HTTPS and terminal invitations for the three apps' dev servers.
 * Plain dev listens on every interface. Explicit loopback hosts remain local;
 * preview retains its opt-in host behavior. Certificates are cached per app.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname, networkInterfaces, type NetworkInterfaceInfo } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import type { Plugin } from "vite";
import { readGoogleKey } from "@foss-earth/engine/prepare-heights";

const qr = createRequire(import.meta.url)("qrcode") as {
  toString(text: string, options: { type: "terminal"; small: boolean }): Promise<string>;
};

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1"]);
const VALID_DAYS = 90;
const DAY_MS = 24 * 3600 * 1000;
/** A certificate this close to its end is replaced, so a session never outlives it. */
const RENEW_BEFORE_MS = 7 * DAY_MS;

/** True when a server's `host` lets other devices connect: `--host`, 0.0.0.0, :: or a network address. */
export function reachableFromNetwork(host: string | boolean | undefined): boolean {
  if (host === true) return true;
  return typeof host === "string" && host.trim() !== "" && !LOOPBACK.has(host.trim());
}

/** What a certificate names, as subjectAltName entries: loopback, this machine's name and its IPv4 network addresses. */
export function certificateNames(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces(), name = hostname()): string[] {
  const addresses = Object.values(interfaces).flatMap(list => list ?? [])
    .filter(entry => !entry.internal && (entry.family === "IPv4" || (entry.family as unknown) === 4)).map(entry => entry.address);
  const names = /^[a-z0-9-]+(\.[a-z0-9-]+)*$/i.test(name) ? [name, ...(name.endsWith(".local") ? [] : [`${name}.local`])] : [];
  return [...new Set(["DNS:localhost", ...names.map(entry => `DNS:${entry}`), "IP:127.0.0.1", "IP:::1", ...addresses.map(address => `IP:${address}`)])];
}

/** Writes key.pem and cert.pem for `names` into `dir`. */
export type CertificateMaker = (dir: string, names: string[], days: number) => void;

const openssl: CertificateMaker = (dir, names, days) => {
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256", "-days", String(days),
    "-subj", "/CN=FOSS Earth development server", "-addext", `subjectAltName=${names.join(",")}`, "-addext", "extendedKeyUsage=serverAuth",
    "-keyout", path.join(dir, "key.pem"), "-out", path.join(dir, "cert.pem")], { stdio: "pipe" });
};

/**
 * The certificate kept in `dir`, or a new one when there is none, it nears its
 * end, or it lacks one of `names`. A new one keeps the old names too, so an
 * address a phone already accepted stays valid when this machine changes networks.
 */
export function devCertificate(dir: string, names: string[], now = Date.now(), make: CertificateMaker = openssl): { key: string; cert: string; made: boolean } {
  const record = path.join(dir, "certificate.json");
  const read = () => ({ key: readFileSync(path.join(dir, "key.pem"), "utf8"), cert: readFileSync(path.join(dir, "cert.pem"), "utf8") });
  let saved: string[] = [];
  try {
    const kept = JSON.parse(readFileSync(record, "utf8")) as { names?: unknown; expiresAt?: unknown };
    saved = Array.isArray(kept.names) ? kept.names.filter((entry): entry is string => typeof entry === "string") : [];
    if (typeof kept.expiresAt === "number" && kept.expiresAt - now > RENEW_BEFORE_MS && names.every(entry => saved.includes(entry))) return { ...read(), made: false };
  } catch {
    // None yet, or unreadable: a new one.
  }
  const all = [...new Set([...saved, ...names])];
  mkdirSync(dir, { recursive: true });
  make(dir, all, VALID_DAYS);
  writeFileSync(record, `${JSON.stringify({ names: all, expiresAt: now + VALID_DAYS * DAY_MS })}\n`);
  return { ...read(), made: true };
}

export interface NetworkHttpsOptions {
  /** Where the certificate is kept. Default: node_modules/.cache/foss-earth-dev-https under the project's root. */
  dir?: string;
  /** Entry page for printed URLs and terminal QR. Defaults to Vite's base. */
  path?: string;
  /** Override the local key files, for isolated tests. */
  keyFiles?: string[];
  /** Test port: the names to certify. */
  names?: () => string[];
  /** Test port: makes the certificate. Default: the system's openssl. */
  make?: CertificateMaker;
}

/** Keep generated terminal art out of captured agent/CI logs by default. */
export function shouldPrintDevQr(env: Record<string, string | undefined>, isTTY = Boolean(process.stdout.isTTY)): boolean {
  const mode = env.FOSS_EARTH_DEV_QR?.trim() || "auto";
  if (!["auto", "on", "off"].includes(mode)) throw new TypeError("FOSS_EARTH_DEV_QR must be auto, on or off.");
  return mode === "on" || (mode === "auto" && isTTY && !env.CI);
}

export function networkHttps(options: NetworkHttpsOptions = {}, env: Record<string, string | undefined> = process.env): Plugin {
  const mode = env.FOSS_EARTH_DEV_HTTPS?.trim() || "auto";
  if (mode !== "auto" && mode !== "off") throw new TypeError("FOSS_EARTH_DEV_HTTPS must be auto or off.");
  const printQr = shouldPrintDevQr(env);
  let isDevServer = false;
  let googleKey: string | null = null;
  let note: { level: "info" | "warn"; text: string } | null = null;
  return {
    name: "foss-earth-network-https",
    config(config, { command, isPreview }) {
      isDevServer = command === "serve" && !isPreview;
      if (mode === "off" || command !== "serve") return;
      // A preview server takes the dev server's host and https unless it has its own.
      const host = isPreview ? config.preview?.host ?? config.server?.host : config.server?.host ?? true;
      const binding = !isPreview && config.server?.host == null ? { host: true as const } : {};
      const https = isPreview ? config.preview?.https ?? config.server?.https : config.server?.https;
      if (!reachableFromNetwork(host)) return;
      if (https) return !isPreview && config.server?.host == null ? { server: binding } : undefined;
      const dir = options.dir ?? path.resolve(config.root ?? process.cwd(), "node_modules/.cache/foss-earth-dev-https");
      try {
        const { key, cert } = devCertificate(dir, (options.names ?? certificateNames)(), Date.now(), options.make);
        note = { level: "info", text: `Serving https for other devices with a self-signed certificate (${path.relative(process.cwd(), dir) || dir}): a browser warns once per address, and past the warning the page is secure, so it can use WebGPU and shared memory.` };
        return isPreview ? { preview: { https: { key, cert } } } : { server: { ...binding, https: { key, cert } } };
      } catch (error) {
        const reason = (error instanceof Error ? error.message : String(error)).split("\n")[0];
        throw new Error(`Cannot start HTTPS development server (${reason}). Install openssl or explicitly use FOSS_EARTH_DEV_HTTPS=off for HTTP.`, { cause: error });
      }
    },
    configureServer(server) {
      const printUrls = server.printUrls.bind(server);
      server.printUrls = () => {
        const resolved = server.resolvedUrls;
        const invitation = (url: string) => {
          const target = new URL(options.path ?? url, url);
          if (googleKey) target.searchParams.set("gkey", googleKey);
          return target.href;
        };
        const invitations = resolved && {
          ...resolved,
          local: resolved.local.map(invitation),
          network: resolved.network.map(invitation),
        };
        // Keep Vite's own URL formatter (including interface labels), using the
        // same app link as the QR without changing internal server/HMR URLs.
        try {
          server.resolvedUrls = invitations;
          printUrls();
        } finally {
          server.resolvedUrls = resolved;
        }
        const targets = [...new Set(invitations?.network ?? [])];
        if (!targets.length) {
          server.config.logger.info("No network address available. Connect to Wi-Fi or Ethernet to test on another device.");
        }
        if (!printQr) return;
        // Runs after Vite resolves the listening address/port, including --port overrides.
        void (async () => {
          for (const url of targets) {
            // Apple Terminal can leave font seams between Unicode half-blocks.
            // Background-colored spaces fill the cells without relying on glyphs.
            server.config.logger.info(await qr.toString(url, { type: "terminal", small: env.TERM_PROGRAM !== "Apple_Terminal" }));
          }
        })().catch(error => server.config.logger.warn(`Could not print QR code: ${String(error)}`));
      };
    },
    configResolved(resolved) {
      if (note) resolved.logger[note.level](note.text, { timestamp: true });
      if (isDevServer && env.FOSS_EARTH_DEV_GKEY === "on") {
        const local = path.resolve(resolved.envDir || resolved.root, ".env.local");
        const shared = path.resolve(import.meta.dirname, "../.env.local");
        googleKey = readGoogleKey({ env, files: options.keyFiles ?? (resolved.envDir === false ? [] : [...new Set([local, shared])]) }).key;
      }
    },
  };
}
