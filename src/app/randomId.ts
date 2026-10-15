/** Enough of `crypto` to make an id. `randomUUID` is absent on a page served as plain HTTP. */
interface IdSource {
  randomUUID?: () => string;
  getRandomValues(bytes: Uint8Array): Uint8Array;
}

/**
 * A random id. Uses `crypto.randomUUID` where the page is a secure context, and
 * `crypto.getRandomValues` otherwise, so a phone opening the dev server over
 * HTTP on the LAN can still start.
 */
export function randomId(source: IdSource = crypto): string {
  if (typeof source.randomUUID === "function") return source.randomUUID();
  const bytes = new Uint8Array(16);
  source.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
