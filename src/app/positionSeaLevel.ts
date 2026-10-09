/** Earth app projects the Engine geoid model into the Toolbar reading port. */
import { createGeoidLoader } from "@foss-earth/engine/browser";
import type { GeoidGridId, GeoidModel } from "@foss-earth/engine";
import type { PositionSeaLevelPort } from "@foss-earth/toolbar";

export function createEarthPositionSeaLevelPort(
  loadGeoid: (grid: GeoidGridId) => Promise<GeoidModel>,
): PositionSeaLevelPort & { dispose(): void } {
  const listeners = new Set<() => void>();
  let disposed = false;
  let geoid: { grid: GeoidGridId; model: GeoidModel | null; error: string | null } | null = null;
  return {
    read(reading, grid) {
      if ((reading.heightDatum ?? "geoid") === "geoid") return { baseMeters: 0 };
      if (grid !== "60" && grid !== "30" && grid !== "15") return { baseMeters: null, note: "Sea level data is unavailable." };
      if (geoid?.grid !== grid) {
        const asked: NonNullable<typeof geoid> = { grid, model: null, error: null };
        geoid = asked;
        void loadGeoid(grid).then(
          model => { asked.model = model; },
          (error: unknown) => { asked.error = error instanceof Error ? error.message : String(error); },
        ).then(() => {
          if (geoid !== asked || disposed) return;
          for (const listener of [...listeners]) {
            try { listener(); } catch (error) { console.error(error); }
          }
        });
      }
      return { baseMeters: geoid.model?.heightMeters(reading.latDeg, reading.lonDeg) ?? null,
        ...(geoid.model ? {} : { note: geoid.error ? `The sea level grid could not load: ${geoid.error}` : "Loading the sea level grid." }) };
    },
    subscribe(listener) { if (!disposed) listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispose() { disposed = true; listeners.clear(); geoid = null; },
  };
}

export function createBrowserPositionSeaLevelPort() {
  const loader = createGeoidLoader({
    fetch: url => window.fetch(url),
    async gunzip(bytes) {
      const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    },
  });
  return createEarthPositionSeaLevelPort(loader.loadGeoid);
}
