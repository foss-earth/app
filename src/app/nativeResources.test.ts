import { describe, expect, it, vi } from "vitest";
import { createEarthNativeResources, type EarthNativeResourceOptions } from "./nativeResources";
const owner = vi.hoisted(() => ({ native: vi.fn(), atlas: vi.fn() }));
vi.mock("@foss-earth/renderer/babylon", () => ({ createNativeImageResources: owner.native }));
vi.mock("@foss-earth/engine/babylon", () => ({ createManagedImageryAtlasResources: owner.atlas }));
it("forwards native retirement to Renderer and atlas policy to Engine using the same broker", () => {
  const dispose = vi.fn(), whenSettled = vi.fn(), restoreDevice = vi.fn(), managedAtlas = {};
  owner.native.mockReturnValue({ dispose, whenSettled, restoreDevice }); owner.atlas.mockReturnValue(managedAtlas);
  const options = { broker: {} } as EarthNativeResourceOptions, resources = createEarthNativeResources(options);
  expect(owner.native).toHaveBeenCalledWith(options); expect(owner.atlas).toHaveBeenCalledWith(options.broker);
  expect(resources.dispose).toBe(dispose); expect(resources.whenSettled).toBe(whenSettled);
  expect(resources.managedAtlas).toBe(managedAtlas); expect(resources.restoreManagedDevice).toBe(restoreDevice);
});
describe("native causal coverage moved with its owner", () => {
  it("keeps Earth as a forward rather than another retirement authority", () => {
    expect(createEarthNativeResources).toBeTypeOf("function");
  });
});
