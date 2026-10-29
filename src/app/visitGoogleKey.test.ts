import { afterEach, describe, expect, it } from "vitest";
import { noteVisitGoogleKey, visitSuppliedGoogleKey, VISIT_GOOGLE_KEY } from "./visitGoogleKey";

describe("a Google key on this visit", () => {
  afterEach(() => sessionStorage.removeItem(VISIT_GOOGLE_KEY));

  it("remembers that the address supplied one, and not the key itself", () => {
    noteVisitGoogleKey("?scene=campus");
    expect(visitSuppliedGoogleKey()).toBe(false);
    noteVisitGoogleKey("?gkey=visit-key&scene=campus");
    expect(sessionStorage.getItem(VISIT_GOOGLE_KEY)).toBe("1");
    expect(visitSuppliedGoogleKey()).toBe(true);
  });
});
