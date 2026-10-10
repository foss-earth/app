/** Public startup diagnostics retain the cause while omitting private locations. */
export function startupFailure(error: unknown): string {
  const seen = new Set<unknown>();
  const messages: string[] = [];
  for (let current = error; current != null && !seen.has(current) && messages.length < 4;) {
    seen.add(current);
    const message = current instanceof Error ? `${current.name}: ${current.message}` : String(current);
    messages.push(message
      .replace(/https?:\/\/[^\s"'<>]+/gi, "[request URL]")
      .replace(/(?:\/Users\/|\/private\/|[A-Z]:\\)[^\s"'<>]+/gi, "[private path]")
      .replace(/((?:api[-_]?key|token|secret|password)\s*[=:]\s*)[^\s,;]+/gi, "$1[redacted]")
      .slice(0, 300));
    current = current instanceof Error ? current.cause : null;
  }
  return messages.join(" → ") || "Unknown startup error";
}
