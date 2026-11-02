/** Document identifiers shared across independently rendered UI roots; never security tokens. */
let sequence = 0;
export function nextDomId(prefix: string): string {
  sequence += 1;
  // Server-rendered templates are later cloned beside client-rendered roots.
  // Their independent counters must never produce the same document identifier.
  const runtime = typeof document === "undefined" ? "server" : "client";
  return `${prefix}-${runtime}-${sequence}`;
}
