/**
 * Compatibility forwarding entry for About's generic Node build provenance.
 * Only the Earth app's dirty-source scope remains in this host wrapper.
 */
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  builtFrom as sharedBuiltFrom,
  describeBuild as sharedDescribeBuild,
  nodeBuildReader,
  rebuildReason as sharedRebuildReason,
  recordBuildInputs as sharedRecordBuildInputs,
  type BuiltFromOptions,
  type BuildPartInput,
  type DescribeBuildInput,
  type RebuildReasonOptions,
  type RecordBuildInputsOptions,
} from "@foss-earth/about/vite";
import { deployedIsolation, pageIsolation } from "./crossOriginIsolation.ts";
export * from "@foss-earth/about/vite";

const EARTH_APP_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const EARTH_APP_SOURCE_FILES = ["src", "vite", "package.json", "package-lock.json"] as const;

function withEarthSourcePolicy<T extends BuiltFromOptions>(options: T): T {
  const reader = options.reader ?? nodeBuildReader;
  const siteRoot = reader.real(EARTH_APP_ROOT);
  return {
    ...options,
    sourceFiles(part: BuildPartInput) {
      const supplied = options.sourceFiles?.(part);
      return supplied === undefined && part.dir === siteRoot ? EARTH_APP_SOURCE_FILES : supplied;
    },
  };
}

export function builtFrom(options: BuiltFromOptions = {}) {
  return sharedBuiltFrom(withEarthSourcePolicy(options));
}

export function describeBuild(input: DescribeBuildInput) {
  return sharedDescribeBuild(withEarthSourcePolicy(input));
}

export function recordBuildInputs(options: RecordBuildInputsOptions) {
  return sharedRecordBuildInputs(withEarthSourcePolicy(options));
}

/**
 * About's rebuildReason, with the Earth app's dirty-source scope, and the
 * isolation a build's worker is made for, which FOSS_EARTH_ISOLATION sets and
 * the page says (deployedIsolation).
 */
export function rebuildReason(options: RebuildReasonOptions) {
  const reason = sharedRebuildReason(withEarthSourcePolicy(options));
  if (reason || !options.page) return reason;
  const published = pageIsolation(options.page), wanted = deployedIsolation(options.env);
  return published === wanted ? undefined : `the published build isolates as ${published}, and FOSS_EARTH_ISOLATION asks for ${wanted}`;
}
