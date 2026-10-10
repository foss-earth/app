export {};

declare global {
  interface FossEarthBench {
    getViewState(): { latDeg: number; lonDeg: number; headingDeg: number; pitchDeg: number; zoomMeters: number } | null;
    setViewState(partial: {
      latDeg?: number;
      lonDeg?: number;
      headingDeg?: number;
      pitchDeg?: number;
      zoomMeters?: number;
    }): void;
    runtime: { renderer: { mode: string } };
  }
  
  interface Window {
    __fossEarthBench?: FossEarthBench;
  }
  
  const __BUILD_TIME__: string;
  const __SOURCE_VERSION__: string;
  const __REPOSITORY_SLUG__: string;
  const __PAGES_REPOSITORY_SLUG__: string;
}
