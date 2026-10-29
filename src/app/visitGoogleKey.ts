import { getGoogleApiKeyFromSearchParams } from "@foss-earth/engine/settings";

/** Set for this tab when the address bar supplied a Google key, so that visit keeps using it. */
export const VISIT_GOOGLE_KEY = "foss-earth.visit-google-key";

export function noteVisitGoogleKey(search: string): void {
  try {
    if (typeof sessionStorage === "undefined") return;
    if (getGoogleApiKeyFromSearchParams(new URLSearchParams(search))) sessionStorage.setItem(VISIT_GOOGLE_KEY, "1");
  } catch {
    // Storage can be blocked. The key still lands in the saved setting.
  }
}

export function visitSuppliedGoogleKey(): boolean {
  try {
    return sessionStorage.getItem(VISIT_GOOGLE_KEY) === "1";
  } catch {
    return false;
  }
}
