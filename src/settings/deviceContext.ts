import { readDeviceContext as readBrowserDeviceContext } from "@foss-earth/ui/browser";
/** Legacy host convenience; UI owns the injected browser implementation. */
export function readDeviceContext() {
  return readBrowserDeviceContext({ navigator: typeof navigator === "undefined" ? null : navigator,
    window: typeof window === "undefined" ? null : window });
}
