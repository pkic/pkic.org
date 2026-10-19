const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export function uuid(): string {
  return crypto.randomUUID();
}

/** A UUIDv8 receipt identity scoped by the caller's canonical domain, resource, actor and operation. */
export async function deterministicUuid(parts: readonly string[]): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(parts)));
  const bytes = new Uint8Array(digest).slice(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x80;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function randomBase62(length: number): string {
  const chars: string[] = [];
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < length; i += 1) {
    chars.push(BASE62[bytes[i] % BASE62.length]);
  }
  return chars.join("");
}
