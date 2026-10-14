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
  recordBuildInputs as sharedRecordBuildInputs,
  type BuiltFromOptions,
  type BuildPartInput,
  type DescribeBuildInput,
  type RecordBuildInputsOptions,
} from "@foss-earth/about/vite";
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
