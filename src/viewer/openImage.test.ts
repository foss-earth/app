import { describe, expect, it } from "vitest";
import type { ImageSurfaceHost } from "../imageTabs/imageSurfaceHost";
import { openImageOnSide } from "./openImage";

describe("opening an image on a side", () => {
  it("returns the tab the host added on that side", async () => {
    const tabs = [{ tabId: "image:1" }];
    const host = {
      registry: { getSnapshot: () => ({ tabs }) },
      openUrl: async (_url: string, slot: string) => {
        expect(slot).toBe("secondary");
        tabs.push({ tabId: "image:2" });
        return true;
      },
    } as unknown as ImageSurfaceHost;
    expect(await openImageOnSide(host, "http://frames.example/half", "secondary")).toBe("image:2");
  });

  it("returns nothing when the host refuses the address", async () => {
    const host = {
      registry: { getSnapshot: () => ({ tabs: [] }) },
      openUrl: async () => false,
    } as unknown as ImageSurfaceHost;
    expect(await openImageOnSide(host, "http://frames.example/missing", "primary")).toBeNull();
  });
});
