import { describe, expect, it } from "vitest";
import { randomId } from "./randomId";

describe("randomId", () => {
  it("uses randomUUID when the page provides it", () => {
    expect(randomId({ randomUUID: () => "given", getRandomValues: bytes => bytes })).toBe("given");
  });

  it("builds an id from getRandomValues when randomUUID is missing", () => {
    const bytes = new Uint8Array(16);
    const id = randomId({
      getRandomValues(target) {
        target.set(bytes);
        return target;
      },
    });
    expect(id).toBe("00000000-0000-4000-8000-000000000000");
  });
});
